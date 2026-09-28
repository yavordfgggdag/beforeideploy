// Before I Deploy — `ai-fix` Edge Function, request handler (V10 WP3, testable since L6): the metered
// AI proxy for normal users. The central Anthropic key lives only in Supabase secrets. The engine sends
// the redacted prompt + the user's JWT; we check role/plan/credits/limits, stream the model's answer
// back as normalized SSE ({type: delta|usage|done|error}) and bill the real token counts to credit_ledger.
import { callerOf, type DbClient, type Deps, json, must, readJson, type Row } from "../_shared/db.ts";
import { bucketBalance, ensureMonthlyGrant, expireDue } from "../_shared/credits.ts";

export type Plan = "free" | "flash" | "high" | "knight";
export type Role = "normal" | "vip" | "admin";

export interface AiFixBody {
  prompt: string;
  system?: string;
  step?: string;
  project?: { framework?: string; pm?: string; key?: string };
  locale?: string;
  deep?: boolean;
  model?: string;
  mode?: "fix" | "explain";
}

export interface AiFixDeps extends Deps {
  now?: () => Date;
  anthropicKey: string;
  anthropicBase: string;
  fetch: typeof globalThis.fetch;
}

// Defaults; every key can be overridden from the Admin panel (table `settings`).
export const DEFAULTS = {
  "ai.models": { flash: "claude-haiku-4-5", high: "claude-sonnet-5", knight: "claude-sonnet-5", deep: "claude-opus-5" } as Record<string, string>,
  "ai.multipliers": { deep: 5 } as Record<string, number>,
  "ai.dailyCapPercent": 15,
  "ai.promptMaxChars": 60000,
  "ai.rate": { perMinute: 6, perHour: 60 },
  // USD per million tokens (input / output) — used for cost_usd bookkeeping only
  "ai.prices": { "claude-haiku-4-5": [1, 5], "claude-sonnet-5": [2, 10], "claude-opus-5": [5, 25] } as Record<string, [number, number]>,
  plans: { flash: { tokens: 250000 }, high: { tokens: 1000000 }, knight: { tokens: 2500000 } } as Record<string, { tokens: number }>,
};

export type Settings = typeof DEFAULTS & Record<string, unknown>;

/** Rough size of a token for estimates (reservation, interrupted streams). */
const CHARS_PER_TOKEN = 3.5;
/** Room for the system prompt on top of ai.promptMaxChars. */
const SYSTEM_ALLOWANCE = 8000;

export async function loadSettings(db: DbClient): Promise<Settings> {
  const { data } = await db.from("settings").select("key,value");
  const s: Record<string, unknown> = { ...DEFAULTS };
  for (const row of data ?? []) s[row.key] = row.value;
  return s as Settings;
}

/** Model, cost multiplier and effort for this request. Deep = strongest model, only for Knight / vip / admin. */
export function chooseModel(settings: Settings, role: Role, plan: Plan, body: Pick<AiFixBody, "deep" | "mode">) {
  const models = settings["ai.models"];
  const deepAllowed = plan === "knight" || role !== "normal";
  const deep = !!body.deep && deepAllowed;
  const model = deep ? models.deep : body.mode === "explain" ? models.flash : (models[plan] ?? models.high);
  const multiplier = deep ? Number(settings["ai.multipliers"].deep ?? 5) : 1;
  return { model, multiplier, effort: deep ? "high" : "medium", deep };
}

export function createAiFixHandler(deps: AiFixDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    if (!deps.anthropicKey) return json(500, { error: "ANTHROPIC_API_KEY is not configured", code: "not_configured" });
    const body = await readJson<AiFixBody>(req);
    if (!body) return json(400, { error: "invalid JSON" });
    if (typeof body.prompt !== "string" || !body.prompt.trim()) return json(400, { error: "prompt required" });

    // ---- who is asking
    const who = await callerOf(req, deps);
    if (!who) return json(401, { error: "no session" });
    const user = who.user;
    const db = deps.service();
    const now = deps.now?.() ?? new Date();
    const { data: profile } = await db.from("profiles").select("role,plan,ai_disabled").eq("user_id", user.id).maybeSingle();
    if (!profile) return json(403, { error: "no profile", code: "no_profile" });
    const role = profile.role as Role;
    if (profile.ai_disabled) return json(403, { error: "AI is disabled for this account", code: "disabled" });

    const settings = await loadSettings(db);
    // an ended trial / subscription stops here too, not only in billing status (audit C10)
    const plan = ((await expireDue(db, user.id, now)) ?? profile.plan) as Plan;
    // a yearly plan's monthly tokens are granted here when due
    await ensureMonthlyGrant(db, user.id, settings.plans, now);
    // Free with bought token packs may still use them (audit C9)
    if (role === "normal" && plan === "free" && (await bucketBalance(db, user.id, "topup")) <= 0) {
      return json(403, { error: "a paid plan is required", code: "no_plan" });
    }

    // the whole input counts, not just the prompt (audit C1)
    const inputChars = body.prompt.length + (typeof body.system === "string" ? body.system.length : 0);
    if (body.system !== undefined && typeof body.system !== "string") return json(400, { error: "system must be text" });
    if (inputChars > Number(settings["ai.promptMaxChars"]) + SYSTEM_ALLOWANCE) return json(413, { error: "prompt too long", code: "prompt_too_long" });

    const balanceOf = async () => Number((await db.from("credit_balance").select("balance").eq("user_id", user.id).maybeSingle()).data?.balance ?? 0);
    const balance = await balanceOf();
    // plan tokens renew with the next monthly grant; the app shows the date
    const renewsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const quota = () => json(402, { error: "no credits left", code: "quota_exhausted", renewsAt, balance });
    if (balance <= 0) return quota();

    // ---- model by plan
    const { model, multiplier, effort } = chooseModel(settings, role, plan, body);
    const maxTokens = body.mode === "explain" ? 1500 : 8000;
    const estInput = Math.ceil(inputChars / CHARS_PER_TOKEN);
    const estimate = Math.round((estInput + maxTokens) * multiplier);

    // ---- reserve first, check after (audit C1): the usage row counts for the rate limits and the hold
    // counts in the balance at once, so parallel requests see each other and cannot all pass.
    const usageIns = must(await db.from("ai_usage").insert({
      user_id: user.id, project_key: body.project?.key ?? null, step: body.step ?? null, model, status: "pending", charged_tokens: 0,
    }).select("id").maybeSingle());
    const usageId = String((usageIns.data as Row | null)?.id ?? crypto.randomUUID());
    must(await db.from("credit_ledger").insert({ user_id: user.id, delta: -estimate, bucket: "hold", reason: "hold", ref: usageId }));
    // a request that never reached the model leaves nothing behind: no hold, no usage row
    const release = async (why: string) => {
      await db.from("credit_ledger").delete().eq("user_id", user.id).eq("ref", usageId).eq("reason", "hold");
      await db.from("ai_usage").delete().eq("id", usageId);
      if (why === "upstream") console.warn("ai-fix released", usageId, why);
    };

    const t = now.getTime();
    const rate = settings["ai.rate"];
    const { count: lastHour } = await db.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", new Date(t - 3600_000).toISOString());
    const { count: lastMinute } = await db.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", new Date(t - 60_000).toISOString());
    if ((lastMinute ?? 0) > rate.perMinute || (lastHour ?? 0) > rate.perHour) {
      await release("rate_limited");
      return json(429, { error: "too many requests", code: "rate_limited" });
    }
    const monthly = settings.plans[plan]?.tokens ?? 0;
    if (monthly > 0) {
      const dayStart = new Date(t);
      dayStart.setUTCHours(0, 0, 0, 0);
      const { data: today } = await db.from("ai_usage").select("charged_tokens").eq("user_id", user.id).gte("created_at", dayStart.toISOString());
      const spentToday = (today ?? []).reduce((a: number, r: Row) => a + Number(r.charged_tokens ?? 0), 0);
      const cap = Math.floor((monthly * Number(settings["ai.dailyCapPercent"])) / 100);
      if (spentToday >= cap) {
        await release("daily_cap");
        return json(403, { error: "daily limit reached", code: "daily_cap", cap, spentToday });
      }
    }
    // other requests' holds are visible now: without them in flight this one would have credits left
    if ((await balanceOf()) + estimate <= 0) {
      await release("quota");
      return quota();
    }

    // ---- call the model (streaming); aborted when the client goes away (audit C6)
    const upstreamBody: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: body.system ?? "",
      messages: [{ role: "user", content: body.prompt }],
      stream: true,
    };
    if (!/haiku/i.test(model)) upstreamBody.output_config = { effort };
    const abort = new AbortController();
    let upstream: Response;
    try {
      upstream = await deps.fetch(`${deps.anthropicBase}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": deps.anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(upstreamBody),
        signal: abort.signal,
      });
    } catch (e) {
      console.error("anthropic", (e as Error).message);
      await release("upstream");
      return json(502, { error: "model request failed (network)", code: "upstream" });
    }
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      console.error("anthropic", upstream.status, text.slice(0, 300));
      await release("upstream");
      return json(502, { error: `model request failed (${upstream.status})`, code: "upstream" });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let input = 0;
    let output = 0;
    let outputReported = false;
    let deltaChars = 0;
    let usedModel = model;
    let status = "ok";
    let settled: Promise<{ charged: number; balance: number }> | null = null;

    // Bills what was really used: reported tokens, or — when the stream broke before the final count —
    // an estimate from the text received (never less than the input). Idempotent.
    const record = () => {
      settled ??= (async () => {
        const inTok = input || estInput;
        const outTok = outputReported ? output : Math.max(output, Math.ceil(deltaChars / CHARS_PER_TOKEN));
        const charged = Math.round((inTok + outTok) * multiplier);
        const [pin, pout] = settings["ai.prices"][usedModel] ?? [0, 0];
        const costUsd = (inTok * pin + outTok * pout) / 1_000_000;
        await db.from("credit_ledger").delete().eq("user_id", user.id).eq("ref", usageId).eq("reason", "hold");
        must(await db.from("ai_usage").update({ model: usedModel, input_tokens: inTok, output_tokens: outTok, cost_usd: costUsd, charged_tokens: charged, status }).eq("id", usageId));
        if (charged > 0) {
          // the monthly plan tokens are spent first, then the top-up packs (they last 12 months)
          const planLeft = Math.max(0, await bucketBalance(db, user.id, "plan"));
          const fromPlan = Math.min(charged, planLeft);
          const fromTopup = charged - fromPlan;
          const rows: Row[] = [];
          if (fromPlan > 0) rows.push({ user_id: user.id, delta: -fromPlan, bucket: "plan", reason: "ai_fix", ref: usageId });
          if (fromTopup > 0) rows.push({ user_id: user.id, delta: -fromTopup, bucket: "topup", reason: "ai_fix", ref: usageId });
          must(await db.from("credit_ledger").insert(rows));
        }
        return { charged, balance: await balanceOf() };
      })();
      return settled;
    };

    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          } catch {
            closed = true;
          }
        };
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
                const m = j.message as { usage?: { input_tokens?: number; output_tokens?: number }; model?: string };
                input = m.usage?.input_tokens ?? 0;
                output = m.usage?.output_tokens ?? 0;
                usedModel = m.model ?? model;
              } else if (type === "content_block_delta") {
                const d = j.delta as { type?: string; text?: string };
                if (d.type === "text_delta" && d.text) {
                  deltaChars += d.text.length;
                  send({ type: "delta", text: d.text });
                }
              } else if (type === "message_delta") {
                const u = j.usage as { output_tokens?: number } | undefined;
                if (u?.output_tokens != null) {
                  output = u.output_tokens;
                  outputReported = true;
                }
                const stop = (j.delta as { stop_reason?: string })?.stop_reason;
                if (stop === "refusal") status = "refused";
                if (stop === "max_tokens") status = "truncated";
              } else if (type === "error") {
                status = "error";
                console.error("anthropic stream", JSON.stringify(j.error ?? {}).slice(0, 300));
                send({ type: "error", error: "The model reported an error.", code: "model_error" });
              }
            }
          }
          const billed = await record();
          send({ type: "usage", input: input || estInput, output, model: usedModel, charged: billed.charged, balance: billed.balance, status });
          send({ type: "done", stopReason: status });
        } catch (e) {
          if (status === "ok") status = closed ? "cancelled" : "error";
          console.error("ai-fix stream", (e as Error).message);
          await record().catch((err) => console.error("ai-fix record", err)); // bill what the model produced before the break
          send({ type: "error", error: "The answer was interrupted.", code: "interrupted" });
        } finally {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch { /* already closed */ }
          }
        }
      },
      cancel() {
        closed = true;
        status = "cancelled";
        abort.abort(); // stop the model — nobody reads the answer any more
      },
    });

    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
  };
}
