import {REPORT_ACTIONS,reportAction,type ReportDeps} from "./reports.ts";
import {METER_ACTIONS,meterAction} from "./meter.ts";
import { previewChange, confirmChange } from "./subscription-change.ts";
import { addMonths } from "../_shared/billing-period.ts";
import actionPrices from "../_shared/pricing-actions.json" with { type: "json" };
import catalogData from "../_shared/plans-catalog.json" with { type: "json" };
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
import { creditRpc, creditStatus, bucketBalance, ensureUpgradeGrants, reconcilePlan, effectiveSubscriptionTier, ensureMonthlyGrant, expireDue, grantPlanTokens, insertOnce, pricingVersion, reconcileHolds } from "../_shared/credits.ts";

export type Plan = "free" | "flash" | "high" | "knight";
const PAID: Plan[] = ["flash", "high", "knight"];

export interface Catalog {
  currency: string;
  version?: string;
  taxInclusive?: boolean;
  trial?: { days: number; plan: Plan; tokens: number } | null;
  plans: Record<string, { price: number; paddlePriceId?: string | null; needsReconciliation?: boolean; yearly?: { price: number; paddlePriceId?: string | null; needsReconciliation?: boolean } | null; credits?: number; activeSites?: number; activeSitesMax?: number; validityMonths?: number; window5h?: number; weekly?: number; extras?: Record<string, boolean> }>;
  packs: { id: string; tokens: number; price: number; paddlePriceId?: string | null; needsReconciliation?: boolean }[];
}

export const DEFAULT_CATALOG: Catalog = { ...catalogData, trial: { ...catalogData.trial, plan: "high" } };
export const DEFAULT_PLAN_TOKENS: Record<string, { tokens: number }> = Object.fromEntries(Object.entries(catalogData.plans).map(([id, p]) => [id, { tokens: p.credits, max_active_sites: p.activeSites, fair_use_sites: p.activeSitesMax, validity_months: p.validityMonths }]));

export interface BillingDeps extends ReportDeps {
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

async function loadCatalog(db: DbClient): Promise<{ catalog: Catalog; planTokens: Record<string, { tokens: number }>; pricing:Row }> {
  const { data } = await db.from("settings").select("key,value");
  const map = Object.fromEntries((data ?? []).map((r: Row) => [r.key, r.value]));
  return {
    catalog: { ...DEFAULT_CATALOG, ...(map["billing.catalog"] ?? {}), plans: Object.fromEntries(PAID.map(id => { const p={ ...DEFAULT_CATALOG.plans[id], ...(map["billing.catalog"]?.plans?.[id] ?? {}) }; const policy=map.plans?.[id]; return [id,{...p,...(policy ? {credits:policy.tokens,activeSites:policy.max_active_sites ?? p.activeSites,activeSitesMax:policy.fair_use_sites ?? p.activeSitesMax,validityMonths:policy.validity_months ?? p.validityMonths,window5h:Math.floor(policy.tokens*0.2),weekly:Math.floor(policy.tokens*0.4)} : {}),extras:{...p.extras,domain:id==="knight" && map["features.knightDomain"]!==false,netlifyCredits:false}}]; })) } as Catalog,
    pricing:{version:await pricingVersion(map),actions:{...actionPrices,...map["pricing.actions"]}},
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
          past_due_since: null as string | null,
          raw: d,
          updated_at: now.toISOString(),
        };
        const { data: existing } = await db.from("subscriptions").select("*").eq("provider", "paddle").eq("provider_ref", row.provider_ref).maybeSingle();
        // B6: the 7-day past_due grace counts from the first failed payment, kept across retries
        if (row.status === "past_due") row.past_due_since = existing?.status === "past_due" && existing.past_due_since ? existing.past_due_since : occurredAt;
        // Paddle does not promise order: an older event must not undo a newer one (audit C5)
        if (existing?.event_at && new Date(existing.event_at).getTime() > new Date(occurredAt).getTime()) {
          result = { ignored: "older than the stored state", subscription: row.provider_ref };
        } else {
          // A verified external portal upgrade also gets its proportional grant. Match an in-app
          // change first so a webhook racing the PATCH response cannot mint a second grant.
          if(existing && status==="active" && PAID.indexOf(tier)>PAID.indexOf(await effectiveSubscriptionTier(db,userId,existing,now) as Plan)) {
            const {data:changes}=await db.from("billing_changes").select("*").eq("user_id",userId).eq("provider_ref",row.provider_ref).eq("to_tier",tier).in("status",["applying","applied"]).order("created_at",{ascending:false}).limit(1);
            const recent=changes?.[0];
            if(recent && (recent.status==="applying" || Date.parse(recent.created_at)>=Date.parse(occurredAt)-5*60_000)) {
              must(await db.from("billing_changes").update({status:"applied"}).eq("id",recent.id));
            } else {
              const fingerprint=`webhook:${eventId}`;
              const {data:saved}=await db.from("billing_changes").select("id").eq("user_id",userId).eq("fingerprint",fingerprint).maybeSingle();
              if(!saved) must(await db.from("billing_changes").insert({id:crypto.randomUUID(),user_id:userId,provider_ref:row.provider_ref,from_tier:existing.tier,to_tier:tier,status:"applied",request:{},quote:{periodStart:existing.period_start,periodEnd:existing.period_end},fingerprint,effective_at:occurredAt,expires_at:now.toISOString(),created_at:now.toISOString()}));
            }
          }
          if (existing) must(await db.from("subscriptions").update(row).eq("id", existing.id));
          else must(await db.from("subscriptions").insert(row));
          const plan = await reconcilePlan(db,userId,now);
          await ensureUpgradeGrants(db,userId,now);
          result = { subscription: row.provider_ref, plan };
        }
      }
    } else if (type === "transaction.completed") {
      const txn = String(d.id);
      // proration charges on a plan change must not buy a whole new month of tokens (audit C12)
      const grantable = !d.origin || ["web", "api", "subscription_recurring", "subscription_charge"].includes(String(d.origin));
      if (!userId) result = { ignored: "no custom_data.user_id" };
      else if (!grantable) {
        if(d.origin==="subscription_update" && d.subscription_id) {
          const tiers=((d.items??[]) as Row[]).map(item=>tierForPrice(catalog,item.price?.id??item.price_id)).filter(Boolean);
          const {data:changes}=must(await db.from("billing_changes").select("id,quote,to_tier,effective_at,status").eq("user_id",userId).eq("provider_ref",d.subscription_id).in("status",["applying","applied"]).lt("effective_at",new Date(Date.parse(occurredAt)+1).toISOString()).order("effective_at",{ascending:false}).limit(1));
          const change=changes?.[0];
          if(change && tiers.includes(change.to_tier) && Date.parse(occurredAt)-Date.parse(change.effective_at)<10*60_000) {
            if(change.quote?.paymentRef && change.quote.paymentRef!==txn) throw new Error("Subscription change payment requires reconciliation");
            must(await db.from("billing_changes").update({quote:{...change.quote,paymentRef:txn}}).eq("id",change.id));
            await ensureUpgradeGrants(db,userId,now);
          }
        }
        result = { ignored: `origin ${d.origin}`, transaction: txn };
      }
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
            const {data:knownSubs}=await db.from("subscriptions").select("provider_ref,period_start,period_end,tier,status").eq("user_id",userId).eq("provider","paddle").eq("tier",tier).order("updated_at",{ascending:false}).limit(1);
            const known=knownSubs?.[0];
            const start=new Date(d.billing_period?.starts_at ?? known?.period_start ?? occurredAt);
            const interval=catalog.plans[tier]?.yearly?.paddlePriceId===priceId?"year":"month";
            const end=d.billing_period?.ends_at ?? known?.period_end ?? addMonths(start,interval==="year"?12:1).toISOString();
            const receipt=await creditRpc(db,"bid_record_payment",{p_user:userId,p_transaction:txn,p_subscription:d.subscription_id??known?.provider_ref??null,p_tier:tier,p_interval:interval,p_credits:tokens,p_start:start.toISOString(),p_end:end,p_now:now.toISOString()});
            if (!receipt.duplicate) granted.push({ tier, tokens });
            else duplicate = true;
          } else if (pack) {
            if (!(await creditRpc(db,"bid_grant",{p_user:userId,p_credits:pack.tokens*qty,p_source:"topup",p_ref:`${txn}:${priceId}`,p_granted_at:occurredAt,p_now:now.toISOString()})).duplicate) {
              granted.push({ pack: pack.id, tokens: pack.tokens * qty });
            } else duplicate = true;
          }
        }
        await creditRpc(db,"bid_v12_payment_refunds",{p_user:userId,p_ref:txn,p_now:now.toISOString()});
        result = duplicate && !granted.length ? { duplicateTransaction: txn } : { transaction: txn, granted };
      }
    } else if ((type === "adjustment.created" || type === "adjustment.updated") && d.action === "refund" && d.status === "approved") {
      // A refund is applied per Paddle line item (plan vs pack) by bid_v12_apply_adjustment (B2): it takes
      // what is left of the matching lots and records spent credits as debt. Without line items the
      // refunded share of the whole transaction applies (audit C12).
      const txn = String(d.transaction_id ?? "");
      const users = await adjustmentOwners(db, catalog, txn);
      const taken: Row[] = [];
      let share: unknown = null, debt = 0;
      for (const owner of users) {
        const receipt=await creditRpc(db,"bid_v12_apply_adjustment",{p_user:owner,p_adjustment:{...d,id:String(d.id ?? txn)},p_now:now.toISOString()});
        if(Number(receipt.taken)>0) taken.push({tokens:Number(receipt.taken)});
        debt += Number(receipt.debt ?? 0); share = receipt.share ?? share;
      }
      result = { refund: txn, taken, share, debt };
    }
    return json(200, { ok: true, ...result });
  } catch (e) {
    await db.from("billing_events").delete().eq("id", eventId); // let Paddle's retry process it again
    return internalError("billing webhook", e);
  }
}

/** Accounts a Paddle transaction granted credits to: the lots it created, else the stored payment's owner. */
async function adjustmentOwners(db: DbClient, catalog: Catalog, txn: string): Promise<string[]> {
  const { data: paid } = await db.from("billing_events").select("user_id").eq("type", "transaction.completed").eq("ref", txn).limit(1);
  // every ref this transaction can have granted under: the plan (txn) and each pack (txn:price)
  const refs = [txn, ...catalog.packs.filter((p) => p.paddlePriceId).map((p) => `${txn}:${p.paddlePriceId}`)];
  const { data: rows } = await db.from("credit_ledger").select("user_id,reason,ref").in("ref", refs);
  const users = [...new Set((rows ?? []).filter((g: Row) => g.reason === "plan_grant" || g.reason === "topup").map((g: Row) => String(g.user_id)))];
  const owner = (paid ?? [])[0]?.user_id;
  if (!users.length && owner) users.push(String(owner));
  return users;
}

// ---------------------------------------------------------------- Paddle API

async function paddle(deps: BillingDeps, path: string, body?: unknown, method = "POST"): Promise<Row> {
  if (new URL(deps.paddleApiBase).hostname === "api.paddle.com") throw Object.assign(new Error("Live payments are disabled in V12 review"), {status:503,code:"not_configured"});
  if (!deps.paddleApiKey) throw Object.assign(new Error("PADDLE_API_KEY is not configured"), { status: 503, code: "not_configured" });
  const res = await deps.fetch(`${deps.paddleApiBase}${path}`, {
    method,
    signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${deps.paddleApiKey}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j?.error?.detail ?? `Paddle ${res.status}`), { status: 502, code: "provider_error", definite: res.status >= 400 && res.status < 500 });
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

  const credits = await creditStatus(db,userId,now);
  const {data:scheduled}=must(await db.from("billing_changes").select("to_tier,effective_at").eq("user_id",userId).eq("status","applied").gte("effective_at",now.toISOString()).order("effective_at").limit(1));
  const change=scheduled?.[0];
  const { data: usage } = await db.from("ai_usage").select("id,created_at,step,model,charged_tokens,project_key").eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
  return {
    plan,
    subscription: current
      ? { provider: current.provider, tier: current.tier, status: current.status, interval: current.raw?.billing_cycle?.interval ?? "month", renewsAt: current.cancel_at ? null : current.period_end, endsAt: current.cancel_at ?? (current.provider === "trial" ? current.period_end : null), manageable: current.provider === "paddle" && !!current.customer_ref }
      : null,
    entitlements: credits.entitlements ?? null,
    scheduledChange:change?{plan:change.to_tier,effectiveAt:change.effective_at,siteLimit:catalog.plans[change.to_tier]?.activeSites??0}:null,
    balance: { plan: credits.plan, topup: credits.topup, total: credits.total, available: credits.available },
    trialAvailable: !!catalog.trial && !claim && !list.some((s) => s.provider === "trial" || s.provider === "paddle"),
    usage: (usage ?? []).map((u: Row) => ({ id:u.id, at: u.created_at, step: u.step, model: u.model, tokens: Number(u.charged_tokens ?? 0), project: u.project_key })),
  };
}

/** GET at Paddle (subscription lookups for `sync`). */
async function paddleGet(deps: BillingDeps, path: string): Promise<Row> {
  if (new URL(deps.paddleApiBase).hostname === "api.paddle.com") throw Object.assign(new Error("Live payments are disabled in V12 review"), {status:503,code:"not_configured"});
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
    if (body.action === "catalog") {
      try {
        const { catalog, planTokens, pricing } = await loadCatalog(deps.service());
        return json(200, {
            source: "cloud", taxInclusive: true, version: catalog.version, pricing,
            currency: catalog.currency,
            plans: PAID.map((id) => ({
              id,
              activeSites: catalog.plans[id]?.activeSites, activeSitesMax: catalog.plans[id]?.activeSitesMax,
              validityMonths: catalog.plans[id]?.validityMonths, window5h: catalog.plans[id]?.window5h, weekly: catalog.plans[id]?.weekly, extras: catalog.plans[id]?.extras,
              price: catalog.plans[id]?.price ?? null,
              tokens: planTokens[id]?.tokens ?? 0,
              available: !!deps.paddleApiKey && !!catalog.plans[id]?.paddlePriceId && !catalog.plans[id]?.needsReconciliation,
              yearlyPrice: catalog.plans[id]?.yearly?.price ?? null,
              yearlyAvailable: !!deps.paddleApiKey && !!catalog.plans[id]?.yearly?.paddlePriceId && !catalog.plans[id]?.yearly?.needsReconciliation,
            })),
            packs: catalog.packs.map((p) => ({ id: p.id, tokens: p.tokens, price: p.price, validityMonths: 12, available: !!deps.paddleApiKey && !!p.paddlePriceId && !p.needsReconciliation })),
            trial: catalog.trial ?? null,
          });

      } catch (error) { return internalError("billing catalog", error); }
    }
    const who = await callerOf(req, deps);
    if (!who) return json(401, { error: "no session" });
    const userId = who.user.id;
    const email: string | null = who.user.email ?? null;
    const db = deps.service();
    const now = deps.now?.() ?? new Date();
    const { catalog, planTokens } = await loadCatalog(db);

    // checkout / portal create a Paddle session per call, sync calls the Paddle API: limited per user (WP03)
    if (body.action === "checkout" || body.action === "confirm-change" || body.action === "portal" || body.action === "sync") {
      const limited = await rateLimited(db, userId, `billing.${body.action}`);
      if (limited) return limited;
    }

    try {
      if(REPORT_ACTIONS.includes(body.action)) return await reportAction(db,userId,body,now,deps);
      if(METER_ACTIONS.includes(body.action)) return await meterAction(db,userId,body,now);
      switch (body.action) {

        case "status":
          await ensureMonthlyGrant(db, userId, planTokens, now);
          return json(200, await statusOf(db, userId, email, catalog, now));

        case "usage": {
          const cleanup=await reconcileHolds(db,userId,now);
          await ensureMonthlyGrant(db, userId, planTokens, now);
          const { data: rows } = await db.from("settings").select("key,value");
          const settings: Row = {};
          for (const r of (rows ?? []) as Row[]) settings[String(r.key)] = r.value;
          if (!settings.plans) settings.plans = planTokens;
          const status=await statusOf(db,userId,email,catalog,now);
          const report=await creditRpc(db,"bid_usage_summary",{p_user:userId,p_now:now.toISOString()});
          Object.assign(report,{reconciled:{releasedHolds:cleanup.released},subscription:status.subscription,scheduledChange:status.scheduledChange,trialAvailable:status.trialAvailable,pricing:{...report.pricing,version:await pricingVersion(settings),actions:{...actionPrices,...settings["pricing.actions"]}}});
          // V1 keeps the same required decoder fields; both versions now use the exact SQL counters.
          if(Number(body.v)!==2) { const legacy={...report};delete legacy.v;return json(200,legacy); }
          const {serverTime:_,...stable}=report;
          const etag=`"${await sha256Hex(JSON.stringify(stable))}"`;
          if(req.headers.get("if-none-match")===etag) return new Response(null,{status:304,headers:{etag,"cache-control":"private, no-cache"}});
          const res=json(200,report); res.headers.set("etag",etag); res.headers.set("cache-control","private, no-cache"); return res;
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
            patch.past_due_since = patch.status === "past_due" ? (s.status === "past_due" && s.past_due_since ? s.past_due_since : now.toISOString()) : null;
            const tier = ((remote.items ?? []) as Row[]).map(i=>tierForPrice(catalog,i.price?.id)).filter((p):p is Plan=>!!p).sort((a,b)=>PAID.indexOf(b)-PAID.indexOf(a))[0];
            if (tier) patch.tier = tier;
            must(await db.from("subscriptions").update(patch).eq("id", s.id));
            if (["active", "trial", "past_due"].includes(String(patch.status))) must(await db.from("profiles").update({ plan: patch.tier ?? s.tier }).eq("user_id", userId));
            const {data:changes} = await db.from("billing_changes").select("id,request").eq("user_id",userId).eq("provider_ref",s.provider_ref).eq("status","applying");
            for (const change of changes ?? []) {
              const normalize = (items: Row[]) => items.map(i => `${i.price?.id ?? i.price_id}:${i.quantity ?? 1}`).sort().join("|");
              if (normalize(remote.items ?? []) === normalize(change.request?.items ?? [])) must(await db.from("billing_changes").update({status:"applied"}).eq("id",change.id));
            }
            updated.push(String(s.provider_ref));
          }
          if (!updated.length) return json(200, { synced: [], status: await statusOf(db, userId, email, catalog, now) });
          await expireDue(db, userId, now);
          await reconcilePlan(db, userId, now);
          return json(200, { synced: updated, status: await statusOf(db, userId, email, catalog, now) });
        }

        case "confirm-change": {
          if (typeof body.previewId !== "string") return json(400,{error:"previewId required"});
          return await confirmChange(db,userId,body.previewId,(path,body,method)=>paddle(deps,path,body,method),now);
        }
        case "checkout": {
          const planId = typeof body.plan === "string" ? body.plan : null;
          const packId = typeof body.pack === "string" ? body.pack : null;
          const yearly = body.interval === "year";
          const priceId = planId
            ? (yearly ? catalog.plans[planId]?.yearly?.paddlePriceId : catalog.plans[planId]?.paddlePriceId)
            : packId ? catalog.packs.find((p) => p.id === packId)?.paddlePriceId : null;
          if ((!planId && !packId) || (planId && packId)) return json(400, { error: "plan or pack required" });
          if (planId && !PAID.includes(planId as Plan)) return json(400, { error: `unknown plan ${planId}` });
          const offer = planId ? (yearly ? catalog.plans[planId]?.yearly : catalog.plans[planId]) : catalog.packs.find(p => p.id === packId);
          if (!priceId || offer?.needsReconciliation) return json(409, { error: "this item is not on sale yet", code: "not_available" });
          if (planId) {
            const {data:subscriptions} = await db.from("subscriptions").select("*").eq("user_id",userId).eq("provider","paddle");
            const active = (subscriptions ?? []).filter(s => ["active","trial","past_due","paused","expired"].includes(s.status));
            if (active.length > 1) return json(409,{code:"billing_conflict",error:"Multiple subscriptions require reconciliation in the customer portal"});
            if (active.length === 1) {
              const prices = Object.values(catalog.plans).flatMap(p=>[p.paddlePriceId,p.yearly?.paddlePriceId]).filter((p):p is string=>!!p);
              return await previewChange(db,userId,{...active[0],tier:await effectiveSubscriptionTier(db,userId,active[0],now)},planId,priceId,prices,(path,body,method)=>paddle(deps,path,body,method),now,yearly?"year":"month");
            }
          }
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
          const started=await creditRpc(db,"bid_start_trial",{p_user:userId,p_email_hash:await sha256Hex(email.trim().toLowerCase()),p_tier:t.plan,p_days:t.days,p_credits:t.tokens,p_now:now.toISOString()});
          if(!started.ok)return json(409,{error:"The trial was already used",...started});
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
