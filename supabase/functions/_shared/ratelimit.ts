// Shared, atomic rate limits for the expensive actions (WP03, audit C4). The count-and-record happens in one
// Postgres function (bid_rate_hit, schema.sql) under an advisory lock, so every Edge Function instance sees
// the same numbers — a limit kept in one isolate's memory would not hold across workers.
import { type DbClient, json } from "./db.ts";

/** action → [calls, window in seconds]. ai-fix keeps its own per-plan limits (settings.ai.rate). */
export const RATE_LIMITS: Record<string, [number, number]> = {
  "billing.checkout": [5, 60],
  "billing.portal": [5, 60],
  "billing.sync": [5, 60],
  "billing.confirm-change": [5,60],
  "billing.meter": [120,60],
  "billing.estimate": [120,60],
  "billing.sites": [30,60],
  "billing.site_activate": [30,60],
  "billing.site_pause": [30,60],
  "billing.boost": [5,60],
  "billing.domain_request": [5,60],
  "monitor.register": [120, 3600], // an agency registers its whole portfolio at once
  "monitor.test": [10, 60],
  "account.export": [3, 3600],
  "admin.write": [60, 60],
};

/**
 * null when the call may go ahead; a 429 response when the limit is reached.
 * A database that does not have the function yet (schema not updated) lets the call through and says so in
 * the log — every other database error refuses the call rather than skip the limit.
 */
export async function rateLimited(db: DbClient, userId: string, action: string): Promise<Response | null> {
  const [limit, windowSeconds] = RATE_LIMITS[action] ?? [30, 60];
  const { data, error } = await db.rpc("bid_rate_hit", { p_user: userId, p_action: action, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      console.error(`rate limit unavailable (${action}): bid_rate_hit is missing — apply supabase/schema.sql`);
      return null;
    }
    console.error(`rate limit check failed (${action}): ${error.message}`);
    return json(503, { error: "rate limit check failed, try again", code: "rate_limit_unavailable" });
  }
  if (data === false) return json(429, { error: `too many requests: ${action}`, code: "rate_limited", limit, windowSeconds });
  return null;
}
