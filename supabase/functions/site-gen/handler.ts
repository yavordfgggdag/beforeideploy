// Before I Deploy — `site-gen` Edge Function, request handler (Site Builder S3): the metered AI that writes a
// site's texts. The engine sends the brief and the theme recipe (one language, with the owner's services and
// contacts already in place) + the user's JWT; we check plan/credits/limits, run the three pipeline steps
// (_shared/site-ai.mjs — the same code the engine runs on an own key), stream progress as SSE
// ({type: step|usage|result|done|error}) and bill the real token counts once, under `ai.site.create`.
import { callerOf, type DbClient, json, must, readJson, type Row } from "../_shared/db.ts";
import { creditRpc, creditStatus, ensureMonthlyGrant, expireDue, pricingVersion, reconcileHolds } from "../_shared/credits.ts";
import { type AiFixDeps, creditsFor, loadSettings, type Plan, type Role, type Settings } from "../ai-fix/handler.ts";
// deno-lint-ignore no-explicit-any
import * as siteAi from "../_shared/site-ai.mjs";

export interface SiteGenBody {
  brief: Row;
  /** create: the theme recipe the model rewrites */
  recipe?: Row;
  /** edit (S4): the site's current content, its look and the owner's words */
  content?: Row;
  look?: Row;
  say?: string;
  locale?: string;
  mode?: "create" | "edit";
  operationId?: string;
}

export type SiteGenDeps = AiFixDeps;

/** Rough size of a token for estimates. */
const CHARS_PER_TOKEN = 3.5;
/** The recipe + brief the function accepts (characters of JSON). */
const MAX_INPUT_CHARS = 120_000;
const STEP_MAX = siteAi.STEP_MAX_TOKENS as Record<string, number>;

/** Models per step for this plan: the cheap steps on the explain model, the writing on the plan's model. */
export function siteModels(settings: Settings, plan: Plan): Record<string, string> {
  const m = settings["ai.models"];
  const cheap = m.explain ?? "claude-haiku-4-5";
  return { plan: cheap, content: m[plan] ?? m.high, review: cheap };
}

interface StepUsage { input: number; output: number; model: string }

/** One step against the Messages API: structured output, streamed so the connection stays alive, text joined. */
async function callModel(deps: SiteGenDeps, signal: AbortSignal, p: { model: string; system: string; prompt: string; schema: unknown; maxTokens: number; effort: string }): Promise<{ json: unknown; usage: StepUsage; stop: string | null }> {
  const body: Record<string, unknown> = {
    model: p.model,
    max_tokens: p.maxTokens,
    system: p.system,
    messages: [{ role: "user", content: p.prompt }],
    stream: true,
    output_config: { format: { type: "json_schema", schema: p.schema }, ...(/haiku/i.test(p.model) ? {} : { effort: p.effort }) },
  };
  const res = await deps.fetch(`${deps.anthropicBase}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": deps.anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`model request failed (${res.status}) ${text.slice(0, 200)}`), { code: "upstream", status: res.status });
  }
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = "";
  let text = "";
  const usage: StepUsage = { input: 0, output: 0, model: p.model };
  let stop: string | null = null;
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
      try { j = JSON.parse(data); } catch { continue; }
      const type = j.type as string;
      if (type === "message_start") {
        const m = j.message as { usage?: { input_tokens?: number }; model?: string };
        usage.input = m.usage?.input_tokens ?? 0;
        usage.model = m.model ?? p.model;
      } else if (type === "content_block_delta") {
        const d = j.delta as { type?: string; text?: string };
        if (d.type === "text_delta" && d.text) text += d.text;
      } else if (type === "message_delta") {
        const u = j.usage as { output_tokens?: number } | undefined;
        if (u?.output_tokens != null) usage.output = u.output_tokens;
        stop = (j.delta as { stop_reason?: string })?.stop_reason ?? stop;
      } else if (type === "error") {
        throw Object.assign(new Error("the model reported an error"), { code: "model_error" });
      }
    }
  }
  if (!usage.output) usage.output = Math.ceil(text.length / CHARS_PER_TOKEN);
  // tokens the model produced are billed even when the answer is unusable: the error carries the usage
  if (stop === "refusal") throw Object.assign(new Error("the model declined this brief"), { code: "refused", usage });
  if (stop === "max_tokens") throw Object.assign(new Error("the answer did not fit"), { code: "truncated", usage });
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { throw Object.assign(new Error("the model did not return JSON"), { code: "ai_bad_answer", usage }); }
  return { json: parsed, usage, stop };
}

export function createSiteGenHandler(deps: SiteGenDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    if (!deps.anthropicKey) return json(500, { error: "ANTHROPIC_API_KEY is not configured", code: "not_configured" });
    const body = await readJson<SiteGenBody>(req);
    if (!body) return json(400, { error: "invalid JSON" });
    const brief = body.brief;
    const edit = body.mode === "edit";
    const recipe = edit ? body.content : body.recipe;
    const say = typeof body.say === "string" ? body.say.trim().slice(0, 400) : "";
    if (!brief || typeof brief !== "object" || typeof brief.name !== "string" || !brief.name.trim()) return json(400, { error: "brief.name required" });
    if (!recipe || typeof recipe !== "object" || !recipe.pages || typeof recipe.pages !== "object" || !(recipe.pages as Row).index) return json(400, { error: edit ? "content.pages.index required" : "recipe.pages.index required" });
    if (edit && !say) return json(400, { error: "say required" });
    const inputChars = JSON.stringify(brief).length + JSON.stringify(recipe).length + say.length;
    if (inputChars > MAX_INPUT_CHARS) return json(413, { error: "brief or recipe too large", code: "too_large" });

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
    const plan = ((await expireDue(db, user.id, now)) ?? profile.plan) as Plan;
    await ensureMonthlyGrant(db, user.id, settings.plans, now);
    // Free may create a site with bought credits or the starter bonus; nothing else
    if (role === "normal" && plan === "free" && Number((await creditStatus(db, user.id, now)).available) <= 0) {
      return json(403, { error: "a paid plan is required", code: "no_plan" });
    }
    await reconcileHolds(db, user.id, now);
    const operationId = typeof body.operationId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.operationId) ? body.operationId : null;
    if (operationId) {
      const { data: prior } = await db.from("ai_usage").select("id,status,charged_tokens,model").eq("user_id", user.id).eq("operation_id", operationId).maybeSingle();
      if (prior) {
        const done = !!prior.status && prior.status !== "pending";
        return json(409, { error: done ? "this operation was already completed" : "this operation is still running", code: done ? "duplicate_operation" : "operation_in_progress", operationId });
      }
    }
    const priceVersion = await pricingVersion(settings as unknown as Record<string, unknown>);
    const balanceOf = async () => Number((await creditStatus(db, user.id, now)).balance ?? 0);
    const balance = await balanceOf();
    const renewsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    if (balance <= 0) return json(402, { error: "no credits left", code: "quota_exhausted", renewsAt, balance });

    // ---- the hold: worst case of all three steps at their models
    const models = siteModels(settings, plan);
    const estInput = Math.ceil(inputChars / CHARS_PER_TOKEN) + 1500;
    // an edit is one short call on the fast model; a creation is the three steps
    const EDIT_MAX = 6000;
    const editModel = settings["ai.models"].flash ?? models.content;
    const estimate = edit
      ? creditsFor(settings, plan, editModel, estInput, EDIT_MAX).credits
      : (siteAi.STEPS as string[]).reduce((sum, step) => sum + creditsFor(settings, plan, models[step], estInput + (step === "review" ? STEP_MAX.content : 0), STEP_MAX[step]).credits, 0);
    const action = edit ? "ai.site.edit" : "ai.site.create";
    const usageIns = must(await db.from("ai_usage").insert({
      user_id: user.id, project_key: null, step: edit ? "site.edit" : "site.create", model: edit ? editModel : models.content, status: "pending", charged_tokens: 0, operation_id: operationId, pricing_version: priceVersion,
    }).select("id").maybeSingle());
    const usageId = String((usageIns.data as Row | null)?.id ?? crypto.randomUUID());
    const accountingId = operationId ?? usageId;
    let held: Row;
    try { held = await creditRpc(db, "bid_hold", { p_user: user.id, p_action: action, p_credits: estimate, p_operation_id: accountingId, p_counts_window: true, p_pricing_version: priceVersion, p_ai_usage: usageId, p_now: now.toISOString() }); }
    catch (error) { await db.from("ai_usage").delete().eq("id", usageId); throw error; }
    if (!held.ok) {
      await db.from("ai_usage").delete().eq("id", usageId);
      return json(held.code === "quota_exhausted" ? 402 : 403, { error: "Credit limit reached", ...held });
    }
    const release = async () => {
      await creditRpc(db, "bid_release", { p_user: user.id, p_operation_id: accountingId });
      await db.from("ai_usage").delete().eq("id", usageId);
    };
    const t = now.getTime();
    const rate = settings["ai.rate"];
    const { count: lastHour } = await db.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", new Date(t - 3600_000).toISOString());
    const { count: lastMinute } = await db.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", new Date(t - 60_000).toISOString());
    if ((lastMinute ?? 0) > rate.perMinute || (lastHour ?? 0) > rate.perHour) {
      await release();
      return json(429, { error: "too many requests", code: "rate_limited" });
    }

    // ---- run the pipeline, streaming progress; bill once at the end for every step that reached the model
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(8 * 60_000)]);
    const encoder = new TextEncoder();
    const steps: StepUsage[] = [];
    let closed = false;
    let status = "ok";
    let settled: Promise<{ charged: number; balance: number }> | null = null;
    const record = () => {
      settled ??= (async () => {
        if (!steps.length) { await release(); return { charged: 0, balance: await balanceOf() }; }
        let charged = 0;
        let costUsd = 0;
        let input = 0;
        let output = 0;
        for (const s of steps) {
          const priced = settings["ai.prices"]?.[s.model] ? s.model : models.content;
          const c = creditsFor(settings, plan, priced, s.input, s.output);
          charged += c.credits;
          costUsd += c.costUsd;
          input += s.input;
          output += s.output;
        }
        const receipt = await creditRpc(db, "bid_settle", { p_user: user.id, p_operation_id: accountingId, p_credits: charged, p_ai: { model: edit ? editModel : models.content, input, output, costUsd, status } });
        if (!receipt.ok) throw new Error("Credit settlement was not accepted");
        return { charged: Number(receipt.charged), balance: Number(receipt.balance ?? await balanceOf()) };
      })();
      return settled;
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { closed = true; }
        };
        try {
          const call = async (p: { step: string; model: string; system: string; prompt: string; schema: unknown; maxTokens: number; effort: string }) => {
            try {
              const r = await callModel(deps, signal, p);
              steps.push(r.usage);
              return { json: r.json, usage: r.usage };
            } catch (e) {
              const u = (e as { usage?: StepUsage }).usage;
              if (u) steps.push(u);
              throw e;
            }
          };
          if (edit) {
            // S4: the owner's words → a short list of operations; the engine applies them to its document
            send({ type: "step", id: "edit", status: "running", model: editModel, error: null });
            const r = await call({ step: "edit", model: editModel, system: siteAi.SYSTEM as string, prompt: (siteAi.editPrompt as (b: Row, c: Row, l: Row, s: string) => string)(brief, recipe, body.look ?? {}, say), schema: siteAi.EDIT_SCHEMA, maxTokens: EDIT_MAX, effort: "low" });
            const answer = r.json as { ops?: unknown; summary?: unknown } | null;
            if (!answer || !Array.isArray(answer.ops)) throw Object.assign(new Error("no ops"), { code: "ai_bad_answer" });
            send({ type: "step", id: "edit", status: "pass", model: r.usage.model, error: null });
            const billed = await record();
            send({ type: "result", ops: answer.ops, summary: typeof answer.summary === "string" ? answer.summary : "" });
            send({ type: "usage", input: r.usage.input, output: r.usage.output, model: r.usage.model, charged: billed.charged, balance: billed.balance, status, steps: [{ model: r.usage.model, input: r.usage.input, output: r.usage.output }] });
            send({ type: "done", stopReason: status });
            return;
          }
          const result = await (siteAi.runPipeline as unknown as (o: Row) => Promise<Row>)({
            brief, recipe, call, models,
            onStep: (id: string, state: string, info: Row) => send({ type: "step", id, status: state, model: info?.model ?? null, error: info?.error ?? null }),
          });
          const billed = await record();
          const input = steps.reduce((a, s) => a + s.input, 0);
          const output = steps.reduce((a, s) => a + s.output, 0);
          send({ type: "result", content: result.content, plan: result.plan, styleSuggestion: result.styleSuggestion, version: result.version });
          send({ type: "usage", input, output, model: models.content, charged: billed.charged, balance: billed.balance, status, steps: steps.map((s) => ({ model: s.model, input: s.input, output: s.output })) });
          send({ type: "done", stopReason: status });
        } catch (e) {
          const err = e as Error & { code?: string };
          status = closed ? "cancelled" : "error";
          console.error("site-gen", err.code ?? "error", err.message?.slice(0, 200));
          await record().catch((x) => console.error("site-gen record", x)); // the steps that ran are billed; none → the hold is released
          send({ type: "error", error: err.code === "refused" ? "The model declined this brief." : err.code === "ai_bad_answer" ? "The model did not return usable site texts." : "The site texts could not be written.", code: err.code ?? "error" });
        } finally {
          if (!closed) { closed = true; try { controller.close(); } catch { /* already closed */ } }
        }
      },
      cancel() {
        closed = true;
        status = "cancelled";
        abort.abort();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
    } catch (error) {
      const e = error as Error & { status?: number; code?: string };
      console.error("site-gen request", e.code ?? "internal");
      return json(e.status ?? 500, { error: "The request could not be completed", code: e.code === "23505" ? "operation_in_progress" : e.code ?? "internal" });
    }
  };
}
