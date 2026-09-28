// Token ledger helpers shared by `billing` and `ai-fix` (V10 WP4 / V10.1 yearly plans).
import type { DbClient, Row } from "./db.ts";

export async function bucketBalance(db: DbClient, userId: string, bucket: string): Promise<number> {
  const { data } = await db.from("credit_ledger").select("delta,bucket").eq("user_id", userId).eq("bucket", bucket);
  return (data ?? []).reduce((a: number, r: Row) => a + Number(r.delta ?? 0), 0);
}

/** A new plan period replaces what is left of the previous one: expire the rest, then grant the new amount. */
export async function grantPlanTokens(db: DbClient, userId: string, tokens: number, reason: string, ref: string) {
  const rest = await bucketBalance(db, userId, "plan");
  if (rest > 0) await db.from("credit_ledger").insert({ user_id: userId, delta: -rest, bucket: "plan", reason: "expiry", ref });
  if (tokens > 0) await db.from("credit_ledger").insert({ user_id: userId, delta: tokens, bucket: "plan", reason, ref });
}

const MONTH_MS = 30.44 * 86400_000;

/**
 * Yearly subscriptions are paid once but grant tokens every month. Month 0 comes with the payment
 * (transaction.completed); months 1…11 are granted lazily here — whenever billing status or an AI fix
 * looks at the account — with the ref `<subscription>:m<k>`, so each month is granted exactly once.
 */
export async function ensureMonthlyGrant(db: DbClient, userId: string, planTokens: Record<string, { tokens: number }>, now: Date) {
  const { data: subs } = await db.from("subscriptions").select("*").eq("user_id", userId).eq("provider", "paddle");
  const sub = (subs ?? []).find((s: Row) => ["active", "past_due"].includes(s.status) && s.raw?.billing_cycle?.interval === "year");
  if (!sub?.period_start) return null;
  const k = Math.floor((now.getTime() - new Date(sub.period_start).getTime()) / MONTH_MS);
  if (k < 1 || k > 11) return null;
  const ref = `${sub.provider_ref}:m${k}`;
  const { data: done } = await db.from("credit_ledger").select("id,reason").eq("user_id", userId).eq("ref", ref);
  if ((done ?? []).some((r: Row) => r.reason === "plan_grant")) return null;
  const tokens = planTokens[sub.tier]?.tokens ?? 0;
  await grantPlanTokens(db, userId, tokens, "plan_grant", ref);
  return { month: k, tokens };
}
