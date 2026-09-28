// Before I Deploy — `billing` Edge Function (V10 WP4). Two kinds of callers:
//
// 1. Paddle webhooks (header `Paddle-Signature`, no JWT): subscription.* and transaction.completed.
//    Verified with HMAC-SHA256 over `<ts>:<raw body>`, deduplicated by event_id (table billing_events).
//    subscription.*       → upsert `subscriptions`, set `profiles.plan` (active/trialing/past_due → tier, else free)
//    transaction.completed → plan price: monthly grant (expires the unused rest of the previous grant);
//                            pack price: top-up tokens. Idempotent by transaction id as well.
//    adjustment.* (approved refund) → takes back what is left of that transaction's grant.
// 2. The engine with the user's JWT, `{ "action": … }`:
//    catalog  → plans (price, tokens), packs, currency, trial offer
//    status   → plan, subscription, balances by bucket, renewal date, whether the trial is still available;
//               an expired trial/subscription drops the plan to free here (lazy expiry)
//    checkout → { plan | pack } → Paddle transaction with custom_data.user_id → hosted checkout URL
//    trial    → once per account: plan from catalog.trial for N days + a token grant
//    portal   → Paddle customer portal URL (change card, cancel, invoices)
//
// Prices and Paddle price ids live in `settings.billing.catalog`, token amounts in `settings.plans`.
import { callerOf, type DbClient, type Deps, json, type Row } from "../_shared/db.ts";

export type Plan = "free" | "flash" | "high" | "knight";
const PAID: Plan[] = ["flash", "high", "knight"];

export interface Catalog {
  currency: string;
  trial?: { days: number; plan: Plan; tokens: number } | null;
  plans: Record<string, { price: number; paddlePriceId?: string | null }>;
  packs: { id: string; tokens: number; price: number; paddlePriceId?: string | null }[];
}

export const DEFAULT_CATALOG: Catalog = {
  currency: "EUR",
  trial: { days: 7, plan: "high", tokens: 150000 },
  plans: { flash: { price: 4.99, paddlePriceId: null }, high: { price: 9.99, paddlePriceId: null }, knight: { price: 19.99, paddlePriceId: null } },
  packs: [
    { id: "pack-500k", tokens: 500000, price: 4.99, paddlePriceId: null },
    { id: "pack-2m", tokens: 2000000, price: 14.99, paddlePriceId: null },
  ],
};
export const DEFAULT_PLAN_TOKENS: Record<string, { tokens: number }> = { flash: { tokens: 250000 }, high: { tokens: 1000000 }, knight: { tokens: 2500000 } };

export interface BillingDeps extends Deps {
  paddleApiKey: string;
  paddleWebhookSecret: string;
  paddleApiBase: string; // https://api.paddle.com or https://sandbox-api.paddle.com
  fetch: typeof globalThis.fetch;
  now?: () => Date;
}

// ---------------------------------------------------------------- helpers

const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Paddle-Signature: `ts=1671552777;h1=<hex>` — h1 = HMAC-SHA256(secret, `${ts}:${body}`), 5 min tolerance. */
export async function verifyPaddleSignature(header: string | null, body: string, secret: string, now = new Date()): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(";").map((p) => p.split("=", 2) as [string, string]));
  const ts = Number(parts.ts);
  if (!parts.h1 || !Number.isFinite(ts)) return false;
  if (Math.abs(now.getTime() / 1000 - ts) > 300) return false;
  return safeEqual(await hmacHex(secret, `${parts.ts}:${body}`), parts.h1);
}

export async function signPaddle(body: string, secret: string, now = new Date()): Promise<string> {
  const ts = Math.floor(now.getTime() / 1000);
  return `ts=${ts};h1=${await hmacHex(secret, `${ts}:${body}`)}`;
}

async function loadCatalog(db: DbClient): Promise<{ catalog: Catalog; planTokens: Record<string, { tokens: number }> }> {
  const { data } = await db.from("settings").select("key,value");
  const map = Object.fromEntries((data ?? []).map((r: Row) => [r.key, r.value]));
  return {
    catalog: { ...DEFAULT_CATALOG, ...(map["billing.catalog"] ?? {}) } as Catalog,
    planTokens: { ...DEFAULT_PLAN_TOKENS, ...(map["plans"] ?? {}) },
  };
}

function tierForPrice(catalog: Catalog, priceId: string | undefined): Plan | null {
  if (!priceId) return null;
  for (const [tier, p] of Object.entries(catalog.plans)) if (p.paddlePriceId === priceId) return tier as Plan;
  return null;
}

function packForPrice(catalog: Catalog, priceId: string | undefined) {
  return priceId ? catalog.packs.find((p) => p.paddlePriceId === priceId) ?? null : null;
}

async function bucketBalance(db: DbClient, userId: string, bucket: string): Promise<number> {
  const { data } = await db.from("credit_ledger").select("delta,bucket").eq("user_id", userId).eq("bucket", bucket);
  return (data ?? []).reduce((a: number, r: Row) => a + Number(r.delta ?? 0), 0);
}

/** A new plan period replaces what is left of the previous one: expire the rest, then grant the new amount. */
async function grantPlanTokens(db: DbClient, userId: string, tokens: number, reason: string, ref: string) {
  const rest = await bucketBalance(db, userId, "plan");
  if (rest > 0) await db.from("credit_ledger").insert({ user_id: userId, delta: -rest, bucket: "plan", reason: "expiry", ref });
  if (tokens > 0) await db.from("credit_ledger").insert({ user_id: userId, delta: tokens, bucket: "plan", reason, ref });
}

async function alreadyGranted(db: DbClient, userId: string, ref: string): Promise<boolean> {
  const { data } = await db.from("credit_ledger").select("id,reason").eq("user_id", userId).eq("ref", ref);
  return (data ?? []).some((r: Row) => r.reason !== "expiry");
}

const ACTIVE = ["active", "trialing", "past_due"];

// ---------------------------------------------------------------- webhook

async function handleWebhook(req: Request, deps: BillingDeps): Promise<Response> {
  const raw = await req.text();
  const now = deps.now?.() ?? new Date();
  if (!(await verifyPaddleSignature(req.headers.get("paddle-signature"), raw, deps.paddleWebhookSecret, now))) {
    return json(401, { error: "bad signature", code: "bad_signature" });
  }
  let event: Row;
  try {
    event = JSON.parse(raw);
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  const db = deps.service();
  const eventId = String(event.event_id ?? "");
  const type = String(event.event_type ?? "");
  if (!eventId || !type) return json(400, { error: "event_id and event_type required" });
  const { data: seen } = await db.from("billing_events").select("id").eq("id", eventId).maybeSingle();
  if (seen) return json(200, { ok: true, duplicate: true });

  const d = (event.data ?? {}) as Row;
  const userId: string | undefined = d.custom_data?.user_id;
  const { catalog, planTokens } = await loadCatalog(db);
  let result: Row = { ignored: true };

  try {
    if (type.startsWith("subscription.")) {
      if (!userId) return json(200, { ok: true, ignored: "no custom_data.user_id" });
      const priceId = d.items?.[0]?.price?.id;
      const tier = tierForPrice(catalog, priceId);
      if (!tier) return json(200, { ok: true, ignored: `unknown price ${priceId}` });
      const status = String(d.status ?? "active");
      const row = {
        user_id: userId,
        provider: "paddle",
        provider_ref: String(d.id),
        customer_ref: d.customer_id ?? null,
        tier,
        status: status === "trialing" ? "trial" : status,
        period_start: d.current_billing_period?.starts_at ?? null,
        period_end: d.current_billing_period?.ends_at ?? null,
        cancel_at: d.scheduled_change?.action === "cancel" ? d.scheduled_change.effective_at : (d.canceled_at ?? null),
        raw: d,
        updated_at: now.toISOString(),
      };
      const { data: existing } = await db.from("subscriptions").select("id").eq("provider", "paddle").eq("provider_ref", row.provider_ref).maybeSingle();
      if (existing) await db.from("subscriptions").update(row).eq("id", existing.id);
      else await db.from("subscriptions").insert(row);
      const plan: Plan = ACTIVE.includes(status) ? tier : "free";
      await db.from("profiles").update({ plan }).eq("user_id", userId);
      result = { subscription: row.provider_ref, plan };
    } else if (type === "transaction.completed") {
      if (!userId) return json(200, { ok: true, ignored: "no custom_data.user_id" });
      const txn = String(d.id);
      if (await alreadyGranted(db, userId, txn)) {
        result = { duplicateTransaction: txn };
      } else {
        const granted: Row[] = [];
        for (const item of (d.items ?? []) as Row[]) {
          const priceId = item.price?.id ?? item.price_id;
          const qty = Number(item.quantity ?? 1);
          const tier = tierForPrice(catalog, priceId);
          const pack = packForPrice(catalog, priceId);
          if (tier) {
            const tokens = planTokens[tier]?.tokens ?? 0;
            await grantPlanTokens(db, userId, tokens, "plan_grant", txn);
            granted.push({ tier, tokens });
          } else if (pack) {
            await db.from("credit_ledger").insert({ user_id: userId, delta: pack.tokens * qty, bucket: "topup", reason: "topup", ref: txn });
            granted.push({ pack: pack.id, tokens: pack.tokens * qty });
          }
        }
        result = { transaction: txn, granted };
      }
    }
    else if ((type === "adjustment.created" || type === "adjustment.updated") && d.action === "refund" && d.status === "approved") {
      // a refund takes back what is left of the tokens that transaction granted (spent tokens stay spent)
      const txn = String(d.transaction_id ?? "");
      const { data: grants } = await db.from("credit_ledger").select("user_id,delta,bucket,reason").eq("ref", txn);
      const granted = (grants ?? []).filter((g: Row) => g.reason === "plan_grant" || g.reason === "topup");
      const refundRef = `refund:${d.id ?? txn}`;
      const { data: done } = await db.from("credit_ledger").select("id").eq("ref", refundRef);
      const taken: Row[] = [];
      if (!(done ?? []).length) {
        for (const g of granted) {
          const left = await bucketBalance(db, g.user_id, g.bucket);
          const take = Math.min(Number(g.delta), Math.max(0, left));
          if (take > 0) {
            await db.from("credit_ledger").insert({ user_id: g.user_id, delta: -take, bucket: g.bucket, reason: "refund", ref: refundRef });
            taken.push({ bucket: g.bucket, tokens: take });
          }
        }
      }
      result = { refund: txn, taken };
    }
    await db.from("billing_events").insert({ id: eventId, provider: "paddle", type, payload: event });
    return json(200, { ok: true, ...result });
  } catch (e) {
    console.error("billing webhook", e);
    return json(500, { error: (e as Error).message ?? "internal error" }); // Paddle retries
  }
}

// ---------------------------------------------------------------- Paddle API

async function paddle(deps: BillingDeps, path: string, body: unknown): Promise<Row> {
  if (!deps.paddleApiKey) throw Object.assign(new Error("PADDLE_API_KEY is not configured"), { status: 503, code: "not_configured" });
  const res = await deps.fetch(`${deps.paddleApiBase}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${deps.paddleApiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j?.error?.detail ?? `Paddle ${res.status}`), { status: 502, code: "provider_error" });
  return j.data ?? {};
}

// ---------------------------------------------------------------- user actions

async function statusOf(db: DbClient, userId: string, catalog: Catalog, now: Date) {
  const { data: profile } = await db.from("profiles").select("plan,role").eq("user_id", userId).maybeSingle();
  const { data: subs } = await db.from("subscriptions").select("*").eq("user_id", userId).order("updated_at", { ascending: false });
  const list = (subs ?? []) as Row[];
  let plan = (profile?.plan ?? "free") as Plan;
  let current = list.find((s) => ["active", "trial", "past_due"].includes(s.status)) ?? null;

  // lazy expiry: a trial or a subscription whose period ended without a renewal webhook
  if (current?.period_end && new Date(current.period_end).getTime() < now.getTime() && (current.provider === "trial" || current.status === "past_due")) {
    await db.from("subscriptions").update({ status: "expired", updated_at: now.toISOString() }).eq("id", current.id);
    const rest = await bucketBalance(db, userId, "plan");
    if (rest > 0) await db.from("credit_ledger").insert({ user_id: userId, delta: -rest, bucket: "plan", reason: "expiry", ref: String(current.id) });
    if (profile?.role === "normal" || !profile?.role) {
      await db.from("profiles").update({ plan: "free" }).eq("user_id", userId);
      plan = "free";
    }
    current = null;
  }

  const planBalance = await bucketBalance(db, userId, "plan");
  const topupBalance = await bucketBalance(db, userId, "topup");
  const { data: usage } = await db.from("ai_usage").select("created_at,step,model,charged_tokens,project_key").eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
  return {
    plan,
    subscription: current
      ? { provider: current.provider, tier: current.tier, status: current.status, renewsAt: current.cancel_at ? null : current.period_end, endsAt: current.cancel_at ?? (current.provider === "trial" ? current.period_end : null), manageable: current.provider === "paddle" && !!current.customer_ref }
      : null,
    balance: { plan: Math.max(0, planBalance), topup: Math.max(0, topupBalance), total: Math.max(0, planBalance + topupBalance) },
    trialAvailable: !!catalog.trial && !list.some((s) => s.provider === "trial" || s.provider === "paddle"),
    usage: (usage ?? []).map((u: Row) => ({ at: u.created_at, step: u.step, model: u.model, tokens: Number(u.charged_tokens ?? 0), project: u.project_key })),
  };
}

export function createBillingHandler(deps: BillingDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    if (req.headers.has("paddle-signature")) return handleWebhook(req, deps);

    let body: Row;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid JSON" });
    }
    const who = await callerOf(req, deps);
    if (!who) return json(401, { error: "no session" });
    const userId = who.user.id;
    const db = deps.service();
    const now = deps.now?.() ?? new Date();
    const { catalog, planTokens } = await loadCatalog(db);

    try {
      switch (body.action) {
        case "catalog":
          return json(200, {
            currency: catalog.currency,
            plans: PAID.map((id) => ({ id, price: catalog.plans[id]?.price ?? null, tokens: planTokens[id]?.tokens ?? 0, available: !!catalog.plans[id]?.paddlePriceId })),
            packs: catalog.packs.map((p) => ({ id: p.id, tokens: p.tokens, price: p.price, available: !!p.paddlePriceId })),
            trial: catalog.trial ?? null,
          });

        case "status":
          return json(200, await statusOf(db, userId, catalog, now));

        case "checkout": {
          const planId = typeof body.plan === "string" ? body.plan : null;
          const packId = typeof body.pack === "string" ? body.pack : null;
          const priceId = planId ? catalog.plans[planId]?.paddlePriceId : packId ? catalog.packs.find((p) => p.id === packId)?.paddlePriceId : null;
          if (!planId && !packId) return json(400, { error: "plan or pack required" });
          if (planId && !PAID.includes(planId as Plan)) return json(400, { error: `unknown plan ${planId}` });
          if (!priceId) return json(409, { error: "this item is not on sale yet", code: "not_available" });
          const txn = await paddle(deps, "/transactions", {
            items: [{ price_id: priceId, quantity: 1 }],
            custom_data: { user_id: userId },
          });
          const url = txn.checkout?.url;
          if (!url) return json(502, { error: "Paddle returned no checkout URL", code: "provider_error" });
          return json(200, { url, transaction: txn.id ?? null });
        }

        case "trial": {
          const st = await statusOf(db, userId, catalog, now);
          if (!st.trialAvailable || !catalog.trial) return json(409, { error: "the trial was already used", code: "trial_used" });
          const t = catalog.trial;
          const end = new Date(now.getTime() + t.days * 86400_000).toISOString();
          const { data: sub } = await db.from("subscriptions").insert({
            user_id: userId, provider: "trial", tier: t.plan, status: "trial", period_start: now.toISOString(), period_end: end, updated_at: now.toISOString(),
          }).select("id").maybeSingle();
          await db.from("profiles").update({ plan: t.plan }).eq("user_id", userId);
          await grantPlanTokens(db, userId, t.tokens, "trial_grant", String(sub?.id ?? "trial"));
          return json(200, await statusOf(db, userId, catalog, now));
        }

        case "portal": {
          const { data: subs } = await db.from("subscriptions").select("customer_ref,provider,updated_at").eq("user_id", userId).eq("provider", "paddle").order("updated_at", { ascending: false });
          const customer = (subs ?? []).find((s: Row) => s.customer_ref)?.customer_ref;
          if (!customer) return json(404, { error: "no Paddle customer for this account", code: "no_subscription" });
          const session = await paddle(deps, `/customers/${customer}/portal-sessions`, {});
          const url = session.urls?.general?.overview;
          if (!url) return json(502, { error: "Paddle returned no portal URL", code: "provider_error" });
          return json(200, { url });
        }

        default:
          return json(400, { error: `unknown action: ${body.action}` });
      }
    } catch (e) {
      const err = e as Error & { status?: number; code?: string };
      if (err.status) return json(err.status, { error: err.message, code: err.code });
      console.error("billing", e);
      return json(500, { error: err.message ?? "internal error" });
    }
  };
}
