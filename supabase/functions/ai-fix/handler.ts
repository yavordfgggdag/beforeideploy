import catalogData from "../_shared/plans-catalog.json" with { type: "json" };
// Before I Deploy — `ai-fix` Edge Function, request handler (V10 WP3, testable since L6): the metered
// AI proxy for normal users. The central Anthropic key lives only in Supabase secrets. The engine sends
// the redacted prompt + the user's JWT; we check role/plan/credits/limits, stream the model's answer
// back as normalized SSE ({type: delta|usage|done|error}) and bill the real token counts to credit_ledger.
import { callerOf, type DbClient, type Deps, json, must, readJson, type Row } from "../_shared/db.ts";
import { creditRpc, creditStatus, ensureMonthlyGrant, expireDue, pricingVersion, reconcileHolds } from "../_shared/credits.ts";
import { type CloudEngine, DEFAULT_CODEX_MODELS, DEFAULT_CODEX_PRICES, engineConfigured, engineOf, modelsFor, parseStreamEvent, sseData, upstreamRequest } from "../_shared/engines.ts";

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
  mode?: "fix" | "explain" | "assistant";
  /** Client-generated id of the logical operation: a retry with the same id never bills twice (V11 RC). */
  operationId?: string;
  /** Which AI answers: Claude (default) or Codex — the owner's choice in the app (_shared/engines.ts). */
  engine?: CloudEngine;
}

export interface AiFixDeps extends Deps {
  now?: () => Date;
  anthropicKey: string;
  anthropicBase: string;
  /** Codex (OpenAI) — optional; without a key the engine `codex` is refused with `engine_unavailable` */
  openaiKey?: string;
  openaiBase?: string;
  fetch: typeof globalThis.fetch;
}

// Defaults; every key can be overridden from the Admin panel (table `settings`).
export const DEFAULTS = {
  // model per plan (docs/PLANS-AND-CREDITS-BG.md §1); `explain` is the cheap model for explanations, `deep` the Knight-only deep fix
  "ai.models": { flash: "claude-sonnet-5-5", high: "claude-opus-5-5", knight: "claude-opus-5-5", deep: "claude-opus-5-5", explain: "claude-haiku-4-5" } as Record<string, string>,
  // the same per plan when the owner picks Codex
  "ai.modelsCodex": DEFAULT_CODEX_MODELS,
  // One EUR rate for all V2 plans; legacy admin objects remain readable during migration.
  "ai.creditEur": 0.000025 as number | Record<string, number>,
  "pricing.version": "2026-10",
  "ai.usdToEur": 0.92,
  // V12 session window: no longer enforced (credit model V3 — release curve and guards live in SQL, credits-v13.sql)
  "ai.sessionHours": 5,
  "ai.sessionCapPercent": 20,
  "ai.promptMaxChars": 60000,
  "ai.rate": { perMinute: 6, perHour: 60 },
  // USD per million tokens (input / output) — used for cost_usd bookkeeping only
  "ai.prices": { "claude-haiku-4-5": [1, 5], "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20], ...DEFAULT_CODEX_PRICES } as Record<string, [number, number]>,
  // credits per month per plan (the ledger column is still called tokens)
  plans: Object.fromEntries([["free", catalogData.free], ...Object.entries(catalogData.plans)].map(([id, p]) => [id, { tokens: (p as { credits: number }).credits }])) as Record<string, { tokens: number }>,
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

/** Model and effort for this request. Deep = the strongest model at the highest effort, only for Knight / vip / admin. */
export function chooseModel(settings: Settings, role: Role, plan: Plan, body: Pick<AiFixBody, "deep" | "mode" | "engine">) {
  const models = modelsFor(settings, engineOf(body.engine));
  const deepAllowed = plan === "knight" || role !== "normal";
  const deep = !!body.deep && deepAllowed;
  const model = deep ? models.deep : body.mode === "explain" ? (models.explain ?? models.flash) : (models[plan] ?? models.high);
  return { model, effort: deep ? "xhigh" : "medium", deep };
}

/**
 * Credits for a request: the model's real price (USD per million tokens) converted to EUR and divided by what one
 * credit costs the owner on this plan — so the plan's credits can never cost the owner more than their cap
 * (docs/PLANS-AND-CREDITS-BG.md §2). At least one credit for any request that reached the model.
 */
export function creditsFor(settings: Settings, plan: string, model: string, inputTokens: number, outputTokens: number) {
  const price = settings["ai.prices"]?.[model];
  if (!Array.isArray(price) || price.length !== 2 || price.some(x => !Number.isFinite(x) || x <= 0)) throw Object.assign(new Error("AI model pricing is unavailable"), {status:503,code:"meter_unavailable"});
  const [pin, pout] = price;
  const costUsd = (inputTokens * pin + outputTokens * pout) / 1_000_000;
  const rates = settings["ai.creditEur"] ?? {};
  const rate = Number(typeof rates === "number" ? rates : rates[plan] ?? rates.default ?? 0.000025);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid AI credit rate");
  const exchange = Number(settings["ai.usdToEur"] ?? 0.92);
  if (!Number.isFinite(exchange) || exchange <= 0) throw Object.assign(new Error("AI exchange rate is unavailable"), {status:503,code:"meter_unavailable"});
  const costEur = costUsd * exchange;
  const credits = costUsd > 0 ? Math.max(1, Math.ceil(costEur / rate - 1e-9)) : 0; // 1e-9 absorbs float noise on exact quotients
  return { costUsd, costEur, rate, credits };
}

export function createAiFixHandler(deps: AiFixDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    if (!deps.anthropicKey) return json(500, { error: "ANTHROPIC_API_KEY is not configured", code: "not_configured" });
    const body = await readJson<AiFixBody>(req);
    if (!body) return json(400, { error: "invalid JSON" });
    if (typeof body.prompt !== "string" || !body.prompt.trim()) return json(400, { error: "prompt required" });
    const engine = engineOf(body.engine);
    if (!engineConfigured(deps, engine)) return json(503, { error: `the ${engine} engine is not configured on this cloud`, code: "engine_unavailable", engine });

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
    if (role === "normal" && plan === "free" && Number((await creditStatus(db,user.id,now)).available) <= 0) {
      return json(403, { error: "a paid plan is required", code: "no_plan" });
    }

    // abandoned holds from earlier requests are released before anything is reserved (V11 RC)
    await reconcileHolds(db, user.id, now);
    // one logical operation is billed once: a retry with the same operationId gets the recorded outcome
    const operationId = typeof body.operationId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.operationId) ? body.operationId : null;
    if (operationId) {
      const { data: prior } = await db.from("ai_usage").select("id,status,charged_tokens,model").eq("user_id", user.id).eq("operation_id", operationId).maybeSingle();
      if (prior) {
        const done = !!prior.status && prior.status !== "pending";
        return json(409, {
          error: done ? "this operation was already completed" : "this operation is still running",
          code: done ? "duplicate_operation" : "operation_in_progress",
          operationId,
          usage: done ? { charged: Number(prior.charged_tokens ?? 0), model: prior.model, status: prior.status } : null,
        });
      }
    }
    const priceVersion = await pricingVersion(settings as unknown as Record<string, unknown>);

    // the whole input counts, not just the prompt (audit C1)
    const inputChars = body.prompt.length + (typeof body.system === "string" ? body.system.length : 0);
    if (body.system !== undefined && typeof body.system !== "string") return json(400, { error: "system must be text" });
    if (inputChars > Number(settings["ai.promptMaxChars"]) + SYSTEM_ALLOWANCE) return json(413, { error: "prompt too long", code: "prompt_too_long" });

    const balanceOf = async () => Number((await creditStatus(db,user.id,now)).balance ?? 0);
    const balance = await balanceOf();
    // plan tokens renew with the next monthly grant; the app shows the date
    const renewsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const quota = () => json(402, { error: "no credits left", code: "quota_exhausted", renewsAt, balance });
    if (balance <= 0) return quota();

    // ---- model by plan
    const { model, effort } = chooseModel(settings, role, plan, body);
    const maxTokens = body.mode === "explain" ? 1500 : 8000;
    const estInput = Math.ceil(inputChars / CHARS_PER_TOKEN);
    // the hold reserves the worst case: the whole input plus a full-length answer at this model's price
    const estimate = creditsFor(settings, plan, model, estInput, maxTokens).credits;

    // ---- reserve first, check after (audit C1): the usage row counts for the rate limits and the hold
    // counts in the balance at once, so parallel requests see each other and cannot all pass.
    const usageIns = must(await db.from("ai_usage").insert({
      user_id: user.id, project_key: body.project?.key ?? null, step: body.step ?? null, model, status: "pending", charged_tokens: 0, operation_id: operationId, pricing_version: priceVersion,
    }).select("id").maybeSingle());
    const usageId = String((usageIns.data as Row | null)?.id ?? crypto.randomUUID());
    const accountingId = operationId ?? usageId;
    const action = body.deep && plan === "knight" ? "ai.fix.deep" : body.mode === "assistant" ? "ai.chat" : "ai.fix";
    let held: Row;
    try { held = await creditRpc(db,"bid_hold",{p_user:user.id,p_action:action,p_credits:estimate,p_operation_id:accountingId,p_counts_window:true,p_pricing_version:priceVersion,p_ai_usage:usageId,p_now:now.toISOString()}); }
    catch(error) { await db.from("ai_usage").delete().eq("id",usageId); throw error; }
    if(!held.ok) {
      await db.from("ai_usage").delete().eq("id",usageId);
      return json(held.code === "quota_exhausted" ? 402 : 403,{error:"Credit limit reached",...held});
    }
    // No model call has happened yet; release the reservation if any preflight/provider step fails.
    const release = async (why: string) => {
      await creditRpc(db,"bid_release",{p_user:user.id,p_operation_id:accountingId});
      await db.from("ai_usage").delete().eq("id",usageId);
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
    // ---- call the model (streaming); aborted when the client goes away (audit C6)
    const up = upstreamRequest(deps, engine, { model, system: body.system ?? "", prompt: body.prompt, maxTokens, effort });
    const abort = new AbortController();
    let upstream: Response;
    try {
      upstream = await deps.fetch(up.url, {
        method: "POST",
        headers: up.headers,
        body: JSON.stringify(up.body),
        signal: AbortSignal.any([abort.signal,AbortSignal.timeout(5*60_000)]),
      });
    } catch (e) {
      console.error(engine, (e as Error).message);
      await release("upstream");
      return json(502, { error: "model request failed (network)", code: "upstream" });
    }
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      console.error(engine, upstream.status, text.slice(0, 300));
      await release("upstream");
      return json(502, { error: `model request failed (${upstream.status})`, code: "upstream" });
    }

    const encoder = new TextEncoder();
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
        const { credits: charged, costUsd } = creditsFor(settings, plan, settings["ai.prices"]?.[usedModel] ? usedModel : model, inTok, outTok);
        const receipt = await creditRpc(db,"bid_settle",{p_user:user.id,p_operation_id:accountingId,p_credits:charged,p_ai:{model:usedModel,input:inTok,output:outTok,costUsd,status}});
        if(!receipt.ok) throw new Error("Credit settlement was not accepted");
        return {charged:Number(receipt.charged),balance:Number(receipt.balance ?? await balanceOf())};
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
        try {
          for await (const j of sseData(upstream.body!)) {
            for (const ev of parseStreamEvent(engine, j)) {
              if (ev.model) usedModel = ev.model;
              if (ev.input != null) input = ev.input;
              if (ev.output != null) { output = ev.output; outputReported = true; }
              if (ev.text) { deltaChars += ev.text.length; send({ type: "delta", text: ev.text }); }
              if (ev.stop === "refused") status = "refused";
              if (ev.stop === "truncated") status = "truncated";
              if (ev.stop === "error") {
                status = "error";
                console.error(`${engine} stream`, ev.errorDetail ?? "");
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
    } catch(error) {
      const e=error as Error & {status?:number;code?:string};
      console.error("ai-fix request",e.code ?? "internal");
      return json(e.status ?? 500,{error:"The request could not be completed",code:e.code === "23505" ? "operation_in_progress" : e.code ?? "internal"});
    }
  };
}
