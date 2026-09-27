// Before I Deploy — `ai-fix` Edge Function (V10 WP3): the metered AI proxy for normal users.
// The central Anthropic key lives only here (Supabase secret ANTHROPIC_API_KEY). The engine sends the
// redacted prompt + the user's JWT; we check role/plan/credits/limits, stream the model's answer back as
// normalized SSE ({type: delta|usage|done|error}) and bill the real token counts to credit_ledger.
//
// Deploy:  supabase functions deploy ai-fix
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-…   (SUPABASE_* are injected automatically)
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type Plan = "free" | "flash" | "high" | "knight";
type Role = "normal" | "vip" | "admin";

interface Body {
  prompt: string;
  system?: string;
  step?: string;
  project?: { framework?: string; pm?: string; key?: string };
  locale?: string;
  deep?: boolean;
  model?: string;
  mode?: "fix" | "explain";
}

// Defaults; every key can be overridden from the Admin panel (table `settings`).
const DEFAULTS = {
  "ai.models": { flash: "claude-haiku-4-5", high: "claude-sonnet-5", knight: "claude-sonnet-5", deep: "claude-opus-5" } as Record<string, string>,
  "ai.multipliers": { deep: 5 } as Record<string, number>,
  "ai.dailyCapPercent": 15,
  "ai.promptMaxChars": 60000,
  "ai.rate": { perMinute: 6, perHour: 60 },
  // USD per million tokens (input / output) — used for cost_usd bookkeeping only
  "ai.prices": { "claude-haiku-4-5": [1, 5], "claude-sonnet-5": [2, 10], "claude-opus-5": [5, 25] } as Record<string, [number, number]>,
  plans: { flash: { tokens: 250000 }, high: { tokens: 1000000 }, knight: { tokens: 2500000 } } as Record<string, { tokens: number }>,
};

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const anthropicBase = Deno.env.get("ANTHROPIC_API_BASE") ?? "https://api.anthropic.com";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function loadSettings(db: SupabaseClient) {
  const { data } = await db.from("settings").select("key,value");
  const s: Record<string, unknown> = { ...DEFAULTS };
  for (const row of data ?? []) s[row.key] = row.value;
  return s as typeof DEFAULTS & Record<string, unknown>;
}

function startOfMonthUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!anthropicKey) return json(500, { error: "ANTHROPIC_API_KEY is not configured" });
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  if (typeof body.prompt !== "string" || !body.prompt.trim()) return json(400, { error: "prompt required" });

  // ---- who is asking
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "no session" });
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: userErr } = await asUser.auth.getUser();
  if (userErr || !user) return json(401, { error: "no session" });

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: profile } = await db.from("profiles").select("role,plan,ai_disabled").eq("user_id", user.id).maybeSingle();
  if (!profile) return json(403, { error: "no profile", code: "no_profile" });
  const role = profile.role as Role;
  const plan = profile.plan as Plan;
  if (profile.ai_disabled) return json(403, { error: "AI is disabled for this account", code: "disabled" });
  if (role === "normal" && plan === "free") return json(403, { error: "a paid plan is required", code: "no_plan" });

  const settings = await loadSettings(db);
  if (body.prompt.length > Number(settings["ai.promptMaxChars"])) return json(413, { error: "prompt too long", code: "prompt_too_long" });

  // ---- credits, rate limits, daily cap
  const { data: bal } = await db.from("credit_balance").select("balance").eq("user_id", user.id).maybeSingle();
  const balance = Number(bal?.balance ?? 0);
  if (balance <= 0) {
    const renewsAt = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString();
    return json(402, { error: "no credits left", code: "quota_exhausted", renewsAt, balance });
  }
  const now = Date.now();
  const rate = settings["ai.rate"] as { perMinute: number; perHour: number };
  const { count: lastHour } = await db.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", new Date(now - 3600_000).toISOString());
  const { count: lastMinute } = await db.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", new Date(now - 60_000).toISOString());
  if ((lastMinute ?? 0) >= rate.perMinute || (lastHour ?? 0) >= rate.perHour) return json(429, { error: "too many requests", code: "rate_limited" });

  const monthly = (settings.plans as Record<string, { tokens: number }>)[plan]?.tokens ?? 0;
  if (monthly > 0) {
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const { data: today } = await db.from("ai_usage").select("charged_tokens").eq("user_id", user.id).gte("created_at", dayStart.toISOString());
    const spentToday = (today ?? []).reduce((a, r) => a + Number(r.charged_tokens ?? 0), 0);
    const cap = Math.floor((monthly * Number(settings["ai.dailyCapPercent"])) / 100);
    if (spentToday >= cap) return json(403, { error: "daily limit reached", code: "daily_cap", cap, spentToday });
  }

  // ---- model by plan (deep = strongest model, only for Knight / vip / admin)
  const models = settings["ai.models"] as Record<string, string>;
  const deepAllowed = plan === "knight" || role !== "normal";
  const deep = !!body.deep && deepAllowed;
  const model = deep ? models.deep : body.mode === "explain" ? models.flash : (models[plan] ?? models.high);
  const multiplier = deep ? Number((settings["ai.multipliers"] as Record<string, number>).deep ?? 5) : 1;
  const effort = deep ? "high" : "medium";

  // ---- call the model (streaming)
  const upstreamBody: Record<string, unknown> = {
    model,
    max_tokens: body.mode === "explain" ? 1500 : 8000,
    system: body.system ?? "",
    messages: [{ role: "user", content: body.prompt }],
    stream: true,
  };
  if (!/haiku/i.test(model)) upstreamBody.output_config = { effort };
  const upstream = await fetch(`${anthropicBase}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(upstreamBody),
  });
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    console.error("anthropic", upstream.status, text.slice(0, 300));
    return json(502, { error: `model request failed (${upstream.status})`, code: "upstream" });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let input = 0;
  let output = 0;
  let usedModel = model;
  let status = "ok";
  let finished = false;

  const record = async () => {
    if (finished) return;
    finished = true;
    const charged = Math.round((input + output) * multiplier);
    const [pin, pout] = (settings["ai.prices"] as Record<string, [number, number]>)[usedModel] ?? [0, 0];
    const costUsd = (input * pin + output * pout) / 1_000_000;
    const { data: usage } = await db
      .from("ai_usage")
      .insert({ user_id: user.id, project_key: body.project?.key ?? null, step: body.step ?? null, model: usedModel, input_tokens: input, output_tokens: output, cost_usd: costUsd, charged_tokens: charged, status })
      .select("id")
      .maybeSingle();
    if (charged > 0) await db.from("credit_ledger").insert({ user_id: user.id, delta: -charged, bucket: "plan", reason: "ai_fix", ref: usage?.id ?? null });
    return { charged, balance: balance - charged };
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let buf = "";
      try {
        const reader = upstream.body!.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
            if (!data) continue;
            let j: Record<string, unknown>;
            try {
              j = JSON.parse(data);
            } catch {
              continue;
            }
            const type = j.type as string;
            if (type === "message_start") {
              const m = j.message as { usage?: { input_tokens?: number }; model?: string };
              input = m.usage?.input_tokens ?? 0;
              usedModel = m.model ?? model;
            } else if (type === "content_block_delta") {
              const d = j.delta as { type?: string; text?: string };
              if (d.type === "text_delta" && d.text) send({ type: "delta", text: d.text });
            } else if (type === "message_delta") {
              const u = j.usage as { output_tokens?: number } | undefined;
              if (u?.output_tokens != null) output = u.output_tokens;
              const stop = (j.delta as { stop_reason?: string })?.stop_reason;
              if (stop === "refusal") status = "refused";
              if (stop === "max_tokens") status = "truncated";
            } else if (type === "error") {
              status = "error";
              send({ type: "error", error: (j.error as { message?: string })?.message ?? "model error" });
            }
          }
        }
        const billed = await record();
        send({ type: "usage", input, output, model: usedModel, charged: billed?.charged ?? 0, balance: billed?.balance ?? balance, status });
        send({ type: "done", stopReason: status });
      } catch (e) {
        status = "error";
        await record(); // bill what the model actually produced before the stream broke
        send({ type: "error", error: (e as Error).message });
      } finally {
        controller.close();
      }
    },
    cancel() {
      status = "cancelled";
      record().catch(() => {});
    },
  });

  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
});
