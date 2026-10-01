// Token ledger helpers shared by `billing` and `ai-fix` (V10 WP4, hardened after the V10 audit C3/C4/C10).
import { monthlySlice } from "./billing-period.ts";
import { type DbClient, isDuplicate, must, type Row } from "./db.ts";

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

/**
 * A new plan period replaces what is left of the previous one. The grant goes in first — the unique index
 * credit_ledger_once makes a second, concurrent grant for the same ref fail — and only then the rest of the
 * previous period expires, so a duplicate can never expire tokens twice.
 * Returns false when this ref was already granted.
 */
export async function grantPlanTokens(db: DbClient, userId: string, tokens: number, reason: string, ref: string): Promise<boolean> {
  const rest = await bucketBalance(db, userId, "plan");
  if (tokens > 0 && !(await insertOnce(db, { user_id: userId, delta: tokens, bucket: "plan", reason, ref }))) return false;
  if (rest > 0) await insertOnce(db, { user_id: userId, delta: -rest, bucket: "plan", reason: "expiry", ref });
  return true;
}


/**
 * Yearly subscriptions are paid once but grant tokens every month. Month 0 comes with the payment
 * (transaction.completed); months 1…11 are granted lazily here — whenever billing status or an AI fix
 * looks at the account — with the ref `<subscription>:m<k>`, exactly once thanks to the unique index.
 */
export async function ensureMonthlyGrant(db: DbClient, userId: string, planTokens: Record<string, { tokens: number }>, now: Date) {
  const { data: subs } = await db.from("subscriptions").select("*").eq("user_id", userId).eq("provider", "paddle");
  const sub = (subs ?? []).find((s: Row) => ["active", "past_due"].includes(s.status) && s.raw?.billing_cycle?.interval === "year");
  if (!sub?.period_start || !sub.period_end || now.getTime() >= Date.parse(sub.period_end)) return null;
  const k = monthlySlice(sub.period_start, sub.period_end, now).month;
  if (k < 1 || k > 11) return null;
  const tier = await effectiveSubscriptionTier(db,userId,sub,now);
  const tokens = planTokens[tier]?.tokens ?? 0;
  const granted = await grantPlanTokens(db, userId, tokens, "plan_grant", `${sub.provider_ref}:${sub.period_start}:m${k}`);
  return granted ? { month: k, tokens } : null;
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
  if (best === "free" && profile?.role !== "normal") return profile?.plan ?? best;
  must(await db.from("profiles").update({plan:best}).eq("user_id",userId));
  return best;
}

/**
 * Lazy expiry (audit C5/C10), used by billing status AND ai-fix so an ended trial or subscription stops
 * granting AI everywhere: a trial or past-due subscription whose period ended, or an "active" one more
 * than 3 days past its period end without a renewal webhook, becomes expired; a normal user drops to
 * Free and the unused plan tokens expire. Returns the plan after the check.
 */
export async function expireDue(db: DbClient, userId: string, now: Date): Promise<string | null> {
  const { data: profile } = await db.from("profiles").select("plan,role").eq("user_id", userId).maybeSingle();
  const { data: subs } = await db.from("subscriptions").select("*").eq("user_id", userId);
  let plan: string | null = profile?.plan ?? null;
  for (const s of (subs ?? []) as Row[]) {
    if (!s.period_end || !["active", "trial", "past_due"].includes(s.status)) continue;
    const end = new Date(s.period_end).getTime();
    const grace = s.status === "active" && s.provider === "paddle" ? 3 * 86400_000 : 0;
    if (end + grace >= now.getTime()) continue;
    must(await db.from("subscriptions").update({ status: "expired", updated_at: now.toISOString() }).eq("id", s.id));
    const rest = await bucketBalance(db, userId, "plan");
    if (rest > 0) await insertOnce(db, { user_id: userId, delta: -rest, bucket: "plan", reason: "expiry", ref: `expired:${s.id}` });
    const stillActive = ((subs ?? []) as Row[]).some((o) => o.id !== s.id && ["active", "trial", "past_due"].includes(o.status) && new Date(o.period_end ?? 0).getTime() > now.getTime());
    if (!stillActive && (profile?.role ?? "normal") === "normal") {
      must(await db.from("profiles").update({ plan: "free" }).eq("user_id", userId));
      plan = "free";
    }
  }
  // A queued downgrade takes effect on time even if its next webhook is delayed.
  const {data:changes} = await db.from("billing_changes").select("id").eq("user_id",userId).in("status",["applying","applied"]).limit(1);
  if (changes?.length) return reconcilePlan(db,userId,now);
  return plan;
}

/** How long an AI request may keep a hold before it counts as abandoned (a crashed function, a lost client). */
export const HOLD_TTL_MS = 15 * 60_000;

/**
 * Orphaned holds (V11 RC): a hold whose ai_usage row never settled within HOLD_TTL_MS is released and the
 * usage row marked `orphaned`, so an abandoned request cannot keep credits reserved forever. Idempotent;
 * runs at the start of every AI request and of every usage read. Returns how many holds were released.
 */
export async function reconcileHolds(db: DbClient, userId: string, now: Date): Promise<{ released: number; reservedTokens: number; open: number }> {
  const { data: holds } = await db.from("credit_ledger").select("id,ref,delta,created_at").eq("user_id", userId).eq("reason", "hold");
  let released = 0;
  let reservedTokens = 0;
  let open = 0;
  for (const h of (holds ?? []) as Row[]) {
    const { data: usage } = await db.from("ai_usage").select("id,status,created_at").eq("id", h.ref).maybeSingle();
    const startedAt = Date.parse(String(usage?.created_at ?? h.created_at ?? now.toISOString()));
    const inFlight = !!usage && (!usage.status || usage.status === "pending");
    if (!usage || !inFlight || now.getTime() - startedAt > HOLD_TTL_MS) {
      await db.from("credit_ledger").delete().eq("id", h.id);
      if (usage && inFlight) await db.from("ai_usage").update({ status: "orphaned" }).eq("id", usage.id);
      released++;
    } else {
      reservedTokens += -Number(h.delta ?? 0);
      open++;
    }
  }
  return { released, reservedTokens, open };
}

/** Version label of the price table in force: an explicit `pricing.version` setting, else a hash of the table. */
export async function pricingVersion(settings: Record<string, unknown>): Promise<string> {
  const explicit = settings["pricing.version"];
  if (typeof explicit === "string" && explicit) return explicit;
  const text = JSON.stringify({ prices: settings["ai.prices"] ?? null, creditEur: settings["ai.creditEur"] ?? null, usdToEur: settings["ai.usdToEur"] ?? null, plans: settings["plans"] ?? null });
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return "p-" + [...d.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
