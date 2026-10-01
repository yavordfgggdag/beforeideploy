// Token ledger helpers shared by `billing` and `ai-fix` (V10 WP4, hardened after the V10 audit C3/C4/C10).
import { allRows, type DbClient, isDuplicate, must, type Row } from "./db.ts";

/** Sum of one bucket, computed in Postgres (view credit_bucket_balance) — summing rows here would stop at
 * PostgREST's 1000-row page for an active user (audit C8). */
export async function bucketBalance(db: DbClient, userId: string, bucket: string): Promise<number> {
  const { data } = await db.from("credit_bucket_balance").select("balance").eq("user_id", userId).eq("bucket", bucket).maybeSingle();
  return Number(data?.balance ?? 0);
}

/** Inserts a ledger row that must happen once per (user, ref, reason); false when it already exists. */
export async function insertOnce(db: DbClient, row: Row): Promise<boolean> {
  const r = await db.from("credit_ledger").insert(row);
  if (r.error) {
    if (isDuplicate(r.error)) return false;
    must(r);
  }
  return true;
}

/** Monetary RPCs fail closed: missing migrations must never fall back to the V1 ledger writes. */
export async function creditRpc(db: DbClient, name: string, args: Row): Promise<Row> {
  const r = await db.rpc(name, args);
  if (r.error) throw Object.assign(new Error("Credit accounting is temporarily unavailable"), { status: 503, code: "meter_unavailable", cause: r.error });
  return r.data ?? {};
}

export async function creditStatus(db: DbClient, userId: string, now = new Date()): Promise<Row> {
  return await creditRpc(db, "bid_credit_status", { p_user: userId, p_now: now.toISOString() });
}

export async function grantPlanTokens(db: DbClient, userId: string, tokens: number, reason: string, ref: string,
  options: { tier?: string; at?: Date; expiresAt?: string; now?: Date } = {}): Promise<boolean> {
  const now = options.now ?? new Date();
  const tier = options.tier ?? (await db.from("profiles").select("plan").eq("user_id",userId).maybeSingle()).data?.plan ?? "flash";
  const result = await creditRpc(db,"bid_grant",{p_user:userId,p_credits:tokens,p_source:reason,p_ref:ref,p_tier:tier,p_granted_at:(options.at ?? now).toISOString(),p_expires_at:options.expiresAt ?? null,p_now:now.toISOString()});
  return !result.duplicate;
}

/** A paid annual period earns each monthly slice even if the app was closed for several months.
 * Grant dates/expiry use the original calendar anchor, and references include the paid year. */
export async function ensureMonthlyGrant(db: DbClient, userId: string, planTokens: Record<string, { tokens: number }>, now: Date) {
  await creditRpc(db,"bid_accrue_periods",{p_user:userId,p_now:now.toISOString()});
  const { data: subs } = await db.from("subscriptions").select("*").eq("user_id", userId).eq("provider", "paddle");
  const sub = (subs ?? []).find((s: Row) => s.status === "active" && s.raw?.billing_cycle?.interval === "year" && s.period_start && s.period_end && now.getTime()<Date.parse(s.period_end));
  if (!sub) return null;
  const {data:paid}=await db.from("credit_periods").select("transaction_ref").eq("user_id",userId).eq("interval","year").eq("starts_at",new Date(sub.period_start).toISOString()).limit(1);
  if(paid?.length)return null; // The SQL scheduler/receipt owns this paid year's monthly accrual.
  throw Object.assign(new Error("The annual payment needs reconciliation before more credits can be granted"), {status:409,code:"billing_conflict"});
}

/** A downgrade changes provider items now, while the paid entitlement lasts to the reviewed renewal. */
export async function effectiveSubscriptionTier(db: DbClient, userId: string, sub: Row, now: Date): Promise<string> {
  const {data:changes} = await db.from("billing_changes").select("from_tier,to_tier,effective_at,created_at,status").eq("user_id",userId).eq("provider_ref",sub.provider_ref ?? "").in("status",["applying","applied"]).order("created_at",{ascending:false}).limit(1);
  const pending = changes?.[0];
  return pending && pending.to_tier === sub.tier && Date.parse(pending.effective_at)>now.getTime() ? pending.from_tier : sub.tier;
}

export async function reconcilePlan(db: DbClient, userId: string, now: Date): Promise<string> {
  const {data:subs} = await db.from("subscriptions").select("*").eq("user_id",userId);
  const tiers = ["free","flash","high","knight"];
  let best = "free";
  for (const sub of subs ?? []) {
    if (!["active","trial","past_due"].includes(sub.status)) continue;
    const grace = sub.provider === "paddle" && sub.status === "active" ? 3*86400_000 : 0;
    if (sub.period_end && Date.parse(sub.period_end)+grace < now.getTime()) continue;
    const tier = await effectiveSubscriptionTier(db,userId,sub,now);
    if (tiers.indexOf(tier)>tiers.indexOf(best)) best=tier;
  }
  const {data:profile} = await db.from("profiles").select("plan,role").eq("user_id",userId).maybeSingle();
  if (best === "free" && (profile?.role ?? "normal") !== "normal") return profile?.plan ?? best;
  must(await db.from("profiles").update({plan:best}).eq("user_id",userId));
  return best;
}

/** Provider-confirmed changes are credited once, including recovery after a lost confirmation response. */
export async function ensureUpgradeGrants(db:DbClient,userId:string,now:Date) {
  const changes=await allRows(()=>db.from("billing_changes").select("id,effective_at").eq("user_id",userId).eq("status","applied").order("created_at"));
  for(const change of changes) if(Date.parse(change.effective_at)<=now.getTime()) {
    const receipt=await creditRpc(db,"bid_upgrade_grant",{p_user:userId,p_change:change.id,p_now:now.toISOString()});
    if(!receipt.ok) throw Object.assign(new Error("Subscription credit period needs reconciliation"),{status:409,code:"billing_conflict"});
  }
  if(changes.length) await creditRpc(db,"bid_accrue_periods",{p_user:userId,p_now:now.toISOString()});
}

/** Ending a subscription changes entitlements, not the expiry dates of already paid credit lots. */
export async function expireDue(db: DbClient, userId: string, now: Date): Promise<string | null> {
  const {data:profile} = await db.from("profiles").select("plan,role").eq("user_id",userId).maybeSingle();
  const {data:subs} = await db.from("subscriptions").select("*").eq("user_id",userId);
  let changed = false;
  for(const sub of subs ?? []) {
    if(!sub.period_end || !["active","trial","past_due"].includes(sub.status)) continue;
    const grace = sub.provider === "paddle" && ["active","past_due"].includes(sub.status) ? 3*86400_000 : 0;
    if(Date.parse(sub.period_end)+grace>now.getTime()) continue;
    must(await db.from("subscriptions").update({status:"expired",updated_at:now.toISOString()}).eq("id",sub.id));
    changed = true;
  }
  const {data:changes} = await db.from("billing_changes").select("id").eq("user_id",userId).in("status",["applying","applied"]).limit(1);
  const plan = changed || changes?.length ? await reconcilePlan(db,userId,now) : profile?.plan ?? null;
  await ensureUpgradeGrants(db,userId,now);
  await creditRpc(db,"bid_enforce_sites",{p_user:userId,p_now:now.toISOString()});
  return plan;
}

export const HOLD_TTL_MS = 15 * 60_000;
export async function reconcileHolds(db: DbClient, userId: string, now: Date): Promise<{ released: number; reservedTokens: number; open: number }> {
  const s=await creditStatus(db,userId,now);
  return {released:Number(s.released ?? 0),reservedTokens:Number(s.reservedTokens ?? 0),open:Number(s.open ?? 0)};
}

/** Version label of the price table in force: an explicit `pricing.version` setting, else a hash of the table. */
export async function pricingVersion(settings: Record<string, unknown>): Promise<string> {
  const explicit = settings["pricing.version"];
  if (typeof explicit === "string" && explicit) return explicit;
  const text = JSON.stringify({ prices: settings["ai.prices"] ?? null, creditEur: settings["ai.creditEur"] ?? null, usdToEur: settings["ai.usdToEur"] ?? null, plans: settings["plans"] ?? null });
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return "p-" + [...d.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
