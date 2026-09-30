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
import { callerOf, type DbClient, type Deps, internalError, isDuplicate, json, must, type Row, sha256Hex } from "../_shared/db.ts";
import { rateLimited } from "../_shared/ratelimit.ts";
import { bucketBalance, ensureMonthlyGrant, expireDue, grantPlanTokens, insertOnce, pricingVersion, reconcileHolds } from "../_shared/credits.ts";

export type Plan = "free" | "flash" | "high" | "knight";
const PAID: Plan[] = ["flash", "high", "knight"];

export interface Catalog {
  currency: string;
  trial?: { days: number; plan: Plan; tokens: number } | null;
  plans: Record<string, { price: number; paddlePriceId?: string | null; yearly?: { price: number; paddlePriceId?: string | null } | null }>;
  packs: { id: string; tokens: number; price: number; paddlePriceId?: string | null }[];
}

export const DEFAULT_CATALOG: Catalog = {
  currency: "EUR",
  // docs/PLANS-AND-CREDITS-BG.md: Flash 9.99 € / 100 000 credits, High 29.99 € / 250 000, Knight 99.99 € / 1 000 000;
  // yearly = 10 months; trial = 7 days of High with 50 000 credits; packs at the owner's cost plus a margin
  trial: { days: 7, plan: "high", tokens: 50000 },
  plans: {
    flash: { price: 9.99, paddlePriceId: null, yearly: { price: 99.9, paddlePriceId: null } },
    high: { price: 29.99, paddlePriceId: null, yearly: { price: 299.9, paddlePriceId: null } },
    knight: { price: 99.99, paddlePriceId: null, yearly: { price: 999.9, paddlePriceId: null } },
  },
  packs: [
    { id: "pack-100k", tokens: 100000, price: 3.99, paddlePriceId: null },
    { id: "pack-500k", tokens: 500000, price: 17.99, paddlePriceId: null },
    { id: "pack-1m", tokens: 1000000, price: 33.99, paddlePriceId: null },
  ],
};
export const DEFAULT_PLAN_TOKENS: Record<string, { tokens: number }> = { flash: { tokens: 100000 }, high: { tokens: 250000 }, knight: { tokens: 1000000 } };

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
  const pairs = header.split(";").map((p) => p.split("=", 2) as [string, string]);
  const tsText = pairs.find(([k]) => k === "ts")?.[1] ?? "";
  const ts = Number(tsText);
  // several h1 values arrive while the webhook secret is being rotated — any match is enough
  const signatures = pairs.filter(([k, v]) => k === "h1" && v).map(([, v]) => v);
  if (!signatures.length || !Number.isFinite(ts)) return false;
  if (Math.abs(now.getTime() / 1000 - ts) > 300) return false;
  const expected = await hmacHex(secret, `${tsText}:${body}`);
  return signatures.some((h) => safeEqual(expected, h));
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
  for (const [tier, p] of Object.entries(catalog.plans)) if (p.paddlePriceId === priceId || p.yearly?.paddlePriceId === priceId) return tier as Plan;
  return null;
}

function packForPrice(catalog: Catalog, priceId: string | undefined) {
  return priceId ? catalog.packs.find((p) => p.paddlePriceId === priceId) ?? null : null;
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

  const d = (event.data ?? {}) as Row;
  const userId: string | undefined = d.custom_data?.user_id;

  // Idempotency (audit C4): claim the event first — a concurrent or repeated delivery hits the primary
  // key and stops here. If processing fails the claim is removed, so Paddle's retry runs it again.
  const ref = type.startsWith("transaction.") ? String(d.id ?? "") || null : null;
  const claim = await db.from("billing_events").insert({ id: eventId, provider: "paddle", type, user_id: userId ?? null, ref, payload: event });
  if (claim.error) {
    if (isDuplicate(claim.error)) return json(200, { ok: true, duplicate: true });
    return internalError("billing claim", claim.error);
  }
  const { data: seenBefore } = await db.from("billing_events").select("id").eq("id", eventId);
  if ((seenBefore ?? []).length > 1) return json(200, { ok: true, duplicate: true });

  const { catalog, planTokens } = await loadCatalog(db);
  let result: Row = { ignored: true };
  const occurredAt = String(event.occurred_at ?? d.updated_at ?? now.toISOString());

  try {
    if (type.startsWith("subscription.")) {
      // a subscription can carry several items (plan + add-ons): the highest known plan decides (audit C15)
      const tiers = ((d.items ?? []) as Row[]).map((it) => tierForPrice(catalog, it.price?.id)).filter(Boolean) as Plan[];
      const tier = tiers.sort((a, b) => PAID.indexOf(b) - PAID.indexOf(a))[0] ?? null;
      const priceId = d.items?.[0]?.price?.id;
      if (!userId) result = { ignored: "no custom_data.user_id" };
      else if (!tier) result = { ignored: `unknown price ${priceId}` };
      else {
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
          event_at: occurredAt,
          raw: d,
          updated_at: now.toISOString(),
        };
        const { data: existing } = await db.from("subscriptions").select("id,event_at").eq("provider", "paddle").eq("provider_ref", row.provider_ref).maybeSingle();
        // Paddle does not promise order: an older event must not undo a newer one (audit C5)
        if (existing?.event_at && new Date(existing.event_at).getTime() > new Date(occurredAt).getTime()) {
          result = { ignored: "older than the stored state", subscription: row.provider_ref };
        } else {
          if (existing) must(await db.from("subscriptions").update(row).eq("id", existing.id));
          else must(await db.from("subscriptions").insert(row));
          let plan: Plan = ACTIVE.includes(status) ? tier : "free";
          if (plan === "free") {
            // a plan an admin granted by hand (provider "manual") outlives the Paddle subscription (audit C15)
            const { data: manual } = await db.from("subscriptions").select("tier,status,period_end").eq("user_id", userId).eq("provider", "manual");
            const keep = ((manual ?? []) as Row[]).find((m) => m.status === "active" && (!m.period_end || new Date(m.period_end).getTime() > now.getTime()));
            if (keep?.tier) plan = keep.tier as Plan;
          }
          // a VIP/admin keeps the plan an admin gave them; normal users follow the subscription
          const { data: prof } = await db.from("profiles").select("role").eq("user_id", userId).maybeSingle();
          if ((prof?.role ?? "normal") === "normal" || plan !== "free") must(await db.from("profiles").update({ plan }).eq("user_id", userId));
          result = { subscription: row.provider_ref, plan };
        }
      }
    } else if (type === "transaction.completed") {
      const txn = String(d.id);
      // proration charges on a plan change must not buy a whole new month of tokens (audit C12)
      const grantable = !d.origin || ["web", "api", "subscription_recurring", "subscription_charge"].includes(String(d.origin));
      if (!userId) result = { ignored: "no custom_data.user_id" };
      else if (!grantable) result = { ignored: `origin ${d.origin}`, transaction: txn };
      else {
        const granted: Row[] = [];
        let duplicate = false;
        for (const item of (d.items ?? []) as Row[]) {
          const priceId = item.price?.id ?? item.price_id;
          const qty = Number(item.quantity ?? 1);
          const tier = tierForPrice(catalog, priceId);
          const pack = packForPrice(catalog, priceId);
          if (tier) {
            const tokens = planTokens[tier]?.tokens ?? 0;
            if (await grantPlanTokens(db, userId, tokens, "plan_grant", txn)) granted.push({ tier, tokens });
            else duplicate = true;
          } else if (pack) {
            if (await insertOnce(db, { user_id: userId, delta: pack.tokens * qty, bucket: "topup", reason: "topup", ref: `${txn}:${priceId}` })) {
              granted.push({ pack: pack.id, tokens: pack.tokens * qty });
            } else duplicate = true;
          }
        }
        result = duplicate && !granted.length ? { duplicateTransaction: txn } : { transaction: txn, granted };
      }
    } else if ((type === "adjustment.created" || type === "adjustment.updated") && d.action === "refund" && d.status === "approved") {
      // a refund takes back what is left of the tokens that transaction granted (spent tokens stay spent),
      // in proportion when only part of the payment is refunded (audit C12)
      const txn = String(d.transaction_id ?? "");
      const { data: paid } = await db.from("billing_events").select("user_id,payload").eq("type", "transaction.completed").eq("ref", txn).limit(1);
      const originalEvent = (paid ?? [])[0] as Row | undefined;
      const original = originalEvent?.payload?.data as Row | undefined;
      // every ref this transaction can have granted under: the plan (txn) and each pack (txn:price)
      const refs = [txn, ...catalog.packs.filter((p) => p.paddlePriceId).map((p) => `${txn}:${p.paddlePriceId}`)];
      const { data: rows } = await db.from("credit_ledger").select("user_id,delta,bucket,reason,ref").in("ref", refs);
      const granted = (rows ?? []).filter((g: Row) => g.reason === "plan_grant" || g.reason === "topup");
      const refunded = Number(d.totals?.total ?? 0);
      const total = Number(original?.details?.totals?.total ?? original?.totals?.total ?? 0);
      const share = refunded > 0 && total > 0 ? Math.min(1, refunded / total) : 1;
      const taken: Row[] = [];
      for (const g of granted) {
        const left = await bucketBalance(db, g.user_id, g.bucket);
        const take = Math.min(Math.round(Number(g.delta) * share), Math.max(0, left));
        if (take > 0 && (await insertOnce(db, { user_id: g.user_id, delta: -take, bucket: g.bucket, reason: "refund", ref: `refund:${d.id ?? txn}:${g.ref}` }))) {
          taken.push({ bucket: g.bucket, tokens: take });
        }
      }
      result = { refund: txn, taken, share };
    }
    return json(200, { ok: true, ...result });
  } catch (e) {
    await db.from("billing_events").delete().eq("id", eventId); // let Paddle's retry process it again
    return internalError("billing webhook", e);
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

async function statusOf(db: DbClient, userId: string, email: string | null, catalog: Catalog, now: Date) {
  const { data: profile } = await db.from("profiles").select("plan,role").eq("user_id", userId).maybeSingle();
  // an ended trial or subscription expires here too (shared with ai-fix, audit C5/C10)
  const plan = ((await expireDue(db, userId, now)) ?? profile?.plan ?? "free") as Plan;
  const { data: subs } = await db.from("subscriptions").select("*").eq("user_id", userId).order("updated_at", { ascending: false });
  const list = (subs ?? []) as Row[];
  const current = list.find((s) => ["active", "trial", "past_due"].includes(s.status)) ?? null;
  const emailHash = email ? await sha256Hex(email.trim().toLowerCase()) : null;
  const { data: claim } = emailHash ? await db.from("trial_claims").select("email_hash").eq("email_hash", emailHash).maybeSingle() : { data: null };

  const planBalance = await bucketBalance(db, userId, "plan");
  const topupBalance = await bucketBalance(db, userId, "topup");
  const { data: usage } = await db.from("ai_usage").select("created_at,step,model,charged_tokens,project_key").eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
  return {
    plan,
    subscription: current
      ? { provider: current.provider, tier: current.tier, status: current.status, interval: current.raw?.billing_cycle?.interval ?? "month", renewsAt: current.cancel_at ? null : current.period_end, endsAt: current.cancel_at ?? (current.provider === "trial" ? current.period_end : null), manageable: current.provider === "paddle" && !!current.customer_ref }
      : null,
    balance: { plan: Math.max(0, planBalance), topup: Math.max(0, topupBalance), total: Math.max(0, planBalance + topupBalance) },
    trialAvailable: !!catalog.trial && !claim && !list.some((s) => s.provider === "trial" || s.provider === "paddle"),
    usage: (usage ?? []).map((u: Row) => ({ at: u.created_at, step: u.step, model: u.model, tokens: Number(u.charged_tokens ?? 0), project: u.project_key })),
  };
}

/**
 * Server-authoritative usage (V11 RC): what the app's "Plan & usage" screen shows. Tokens, product credits
 * and money are never mixed: everything here is in tokens (the product's credit unit); prices live in the
 * catalog. Reserved = holds of requests in flight (abandoned ones are released first), used = settled
 * charges in the current period, remaining = plan tokens + purchased packs minus holds.
 */
async function usageOf(db: DbClient, userId: string, email: string | null, catalog: Catalog, planTokens: Record<string, { tokens: number }>, settings: Row, now: Date) {
  const reconciled = await reconcileHolds(db, userId, now);
  const status = await statusOf(db, userId, email, catalog, now);
  const sub = status.subscription;
  const { data: subs } = await db.from("subscriptions").select("period_start,period_end,status,provider").eq("user_id", userId);
  const active = ((subs ?? []) as Row[]).find((s) => ["active", "trial", "past_due"].includes(s.status));
  const calendarStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const calendarEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const period = active?.period_start && active?.period_end
    ? { start: active.period_start, end: active.period_end, renewsAt: sub?.renewsAt ?? null, source: "subscription" }
    : { start: calendarStart, end: calendarEnd, renewsAt: status.plan === "free" ? null : calendarEnd, source: "calendar" };
  const { data: ops } = await db.from("ai_usage").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
  const { data: inPeriod } = await db.from("ai_usage").select("charged_tokens,status,created_at,model").eq("user_id", userId).gte("created_at", period.start);
  const settledInPeriod = ((inPeriod ?? []) as Row[]).filter((u) => u.status && !["pending", "orphaned"].includes(String(u.status)) && String(u.created_at) < period.end);
  const usedTokens = settledInPeriod.reduce((a, u) => a + Number(u.charged_tokens ?? 0), 0);
  const { data: ledger } = await db.from("credit_ledger").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
  const included = planTokens[status.plan]?.tokens ?? 0;
  const rate = (settings["ai.rate"] as Row | undefined) ?? { perMinute: 6, perHour: 60 };
  // the rolling session, as the ai-fix function enforces it: N hours, a share of the monthly credits
  const sessionHours = Number(settings["ai.sessionHours"] ?? 5);
  const capPercent = Number(settings["ai.sessionCapPercent"] ?? 20);
  const windowStart = new Date(now.getTime() - sessionHours * 3600_000).toISOString();
  const { data: recent } = await db.from("ai_usage").select("charged_tokens,created_at,status").eq("user_id", userId).gte("created_at", windowStart);
  const inSession = ((recent ?? []) as Row[]).filter((u) => String(u.created_at) >= windowStart && u.status !== "orphaned");
  const sessionUsed = inSession.reduce((a, u) => a + Number(u.charged_tokens ?? 0), 0);
  const sessionCap = included > 0 ? Math.floor((included * capPercent) / 100) : null;
  const oldest = inSession.map((u) => String(u.created_at)).sort()[0];
  const session = sessionCap === null ? null : {
    windowHours: sessionHours,
    capPercent,
    cap: sessionCap,
    used: sessionUsed,
    remaining: Math.max(0, sessionCap - sessionUsed),
    resetsAt: oldest ? new Date(new Date(oldest).getTime() + sessionHours * 3600_000).toISOString() : null,
  };
  // per model inside the period (what Claude shows as "all models" vs "Opus")
  const byModelMap = new Map<string, { model: string; tokens: number; operations: number }>();
  for (const u of settledInPeriod as Row[]) {
    const key = String((u as Row).model ?? "unknown");
    const cur = byModelMap.get(key) ?? { model: key, tokens: 0, operations: 0 };
    cur.tokens += Number(u.charged_tokens ?? 0);
    cur.operations += 1;
    byModelMap.set(key, cur);
  }
  const byModel = [...byModelMap.values()].sort((a, b) => b.tokens - a.tokens);
  const version = await pricingVersion(settings as unknown as Record<string, unknown>);
  const available = Math.max(0, status.balance.total - reconciled.reservedTokens);
  return {
    serverTime: now.toISOString(),
    unit: "credits",
    plan: status.plan,
    subscription: sub,
    trialAvailable: status.trialAvailable,
    period,
    included: { tokens: included },
    used: { tokens: usedTokens, operations: settledInPeriod.length },
    reserved: { tokens: reconciled.reservedTokens, operations: reconciled.open },
    remaining: { plan: status.balance.plan, purchased: status.balance.topup, total: status.balance.total, available },
    purchased: { tokens: status.balance.topup, expires: "12 months after purchase" },
    session,
    byModel,
    limits: { perMinute: Number(rate.perMinute ?? 6), perHour: Number(rate.perHour ?? 60), sessionHours, sessionCapPercent: capPercent, sessionCap, sessionUsed },
    pricing: { version, prices: settings["ai.prices"] ?? null, creditEur: settings["ai.creditEur"] ?? null, usdToEur: settings["ai.usdToEur"] ?? null, spendOrder: ["plan", "topup"] },
    reconciled: { releasedHolds: reconciled.released },
    history: {
      operations: ((ops ?? []) as Row[]).map((u) => ({ id: u.id, at: u.created_at, step: u.step, project: u.project_key, model: u.model, status: u.status, tokens: Number(u.charged_tokens ?? 0), input: u.input_tokens ?? null, output: u.output_tokens ?? null, pricingVersion: u.pricing_version ?? null, operationId: u.operation_id ?? null })),
      ledger: ((ledger ?? []) as Row[]).map((l) => ({ id: l.id, at: l.created_at, delta: Number(l.delta), bucket: l.bucket, reason: l.reason, ref: l.ref ?? null, pricingVersion: l.pricing_version ?? null })),
    },
  };
}

/** GET at Paddle (subscription lookups for `sync`). */
async function paddleGet(deps: BillingDeps, path: string): Promise<Row> {
  if (!deps.paddleApiKey) throw Object.assign(new Error("PADDLE_API_KEY is not configured"), { status: 503, code: "not_configured" });
  const res = await deps.fetch(`${deps.paddleApiBase}${path}`, { method: "GET", headers: { authorization: `Bearer ${deps.paddleApiKey}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j?.error?.detail ?? `Paddle ${res.status}`), { status: res.status === 404 ? 404 : 502, code: res.status === 404 ? "not_found" : "provider_error" });
  return j.data ?? j;
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
    const email: string | null = who.user.email ?? null;
    const db = deps.service();
    const now = deps.now?.() ?? new Date();
    const { catalog, planTokens } = await loadCatalog(db);

    // checkout / portal create a Paddle session per call, sync calls the Paddle API: limited per user (WP03)
    if (body.action === "checkout" || body.action === "portal" || body.action === "sync") {
      const limited = await rateLimited(db, userId, `billing.${body.action}`);
      if (limited) return limited;
    }

    try {
      switch (body.action) {
        case "catalog":
          return json(200, {
            currency: catalog.currency,
            plans: PAID.map((id) => ({
              id,
              price: catalog.plans[id]?.price ?? null,
              tokens: planTokens[id]?.tokens ?? 0,
              available: !!catalog.plans[id]?.paddlePriceId,
              yearlyPrice: catalog.plans[id]?.yearly?.price ?? null,
              yearlyAvailable: !!catalog.plans[id]?.yearly?.paddlePriceId,
            })),
            packs: catalog.packs.map((p) => ({ id: p.id, tokens: p.tokens, price: p.price, available: !!p.paddlePriceId })),
            trial: catalog.trial ?? null,
          });

        case "status":
          await ensureMonthlyGrant(db, userId, planTokens, now);
          return json(200, await statusOf(db, userId, email, catalog, now));

        case "usage": {
          await ensureMonthlyGrant(db, userId, planTokens, now);
          const { data: rows } = await db.from("settings").select("key,value");
          const settings: Row = {};
          for (const r of (rows ?? []) as Row[]) settings[String(r.key)] = r.value;
          if (!settings.plans) settings.plans = planTokens;
          return json(200, await usageOf(db, userId, email, catalog, planTokens, settings, now));
        }

        case "sync": {
          // recovery after a missed webhook: the provider's current state wins (V11 RC)
          const { data: mine } = await db.from("subscriptions").select("*").eq("user_id", userId).eq("provider", "paddle");
          const updated: string[] = [];
          for (const s of (mine ?? []) as Row[]) {
            if (!s.provider_ref) continue;
            const remote = await paddleGet(deps, `/subscriptions/${s.provider_ref}`);
            const status = String(remote.status ?? s.status);
            const patch: Row = {
              status: status === "trialing" ? "trial" : status,
              period_start: remote.current_billing_period?.starts_at ?? s.period_start,
              period_end: remote.current_billing_period?.ends_at ?? s.period_end,
              cancel_at: remote.scheduled_change?.action === "cancel" ? remote.scheduled_change.effective_at : (status === "canceled" ? (remote.canceled_at ?? s.cancel_at ?? now.toISOString()) : null),
              raw: { ...(s.raw ?? {}), billing_cycle: remote.billing_cycle ?? s.raw?.billing_cycle },
              updated_at: now.toISOString(),
            };
            const tier = tierForPrice(catalog, remote.items?.[0]?.price?.id ?? null);
            if (tier) patch.tier = tier;
            must(await db.from("subscriptions").update(patch).eq("id", s.id));
            if (["active", "trial", "past_due"].includes(String(patch.status))) must(await db.from("profiles").update({ plan: patch.tier ?? s.tier }).eq("user_id", userId));
            updated.push(String(s.provider_ref));
          }
          if (!updated.length) return json(200, { synced: [], status: await statusOf(db, userId, email, catalog, now) });
          await expireDue(db, userId, now);
          return json(200, { synced: updated, status: await statusOf(db, userId, email, catalog, now) });
        }

        case "checkout": {
          const planId = typeof body.plan === "string" ? body.plan : null;
          const packId = typeof body.pack === "string" ? body.pack : null;
          const yearly = body.interval === "year";
          const priceId = planId
            ? (yearly ? catalog.plans[planId]?.yearly?.paddlePriceId : catalog.plans[planId]?.paddlePriceId)
            : packId ? catalog.packs.find((p) => p.id === packId)?.paddlePriceId : null;
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
          const st = await statusOf(db, userId, email, catalog, now);
          if (!st.trialAvailable || !catalog.trial || !email) return json(409, { error: "the trial was already used", code: "trial_used" });
          const t = catalog.trial;
          // one trial per e-mail address, even after the account is deleted and created again (audit C6)
          const claim = await db.from("trial_claims").insert({ email_hash: await sha256Hex(email.trim().toLowerCase()), claimed_at: now.toISOString() });
          if (claim.error) {
            if (isDuplicate(claim.error)) return json(409, { error: "the trial was already used", code: "trial_used" });
            must(claim);
          }
          const end = new Date(now.getTime() + t.days * 86400_000).toISOString();
          const sub = await db.from("subscriptions").insert({
            user_id: userId, provider: "trial", tier: t.plan, status: "trial", period_start: now.toISOString(), period_end: end, updated_at: now.toISOString(),
          }).select("id").maybeSingle();
          if (sub.error) {
            if (isDuplicate(sub.error)) return json(409, { error: "the trial was already used", code: "trial_used" });
            must(sub);
          }
          must(await db.from("profiles").update({ plan: t.plan }).eq("user_id", userId));
          await grantPlanTokens(db, userId, t.tokens, "trial_grant", String(sub.data?.id ?? `trial:${userId}`));
          return json(200, await statusOf(db, userId, email, catalog, now));
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
      return internalError("billing", e);
    }
  };
}
