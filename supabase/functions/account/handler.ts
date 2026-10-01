// Before I Deploy — `account` Edge Function, request handler (V10 WP5, testable since L6):
//   { "action": "export" } → every row the cloud holds for the caller (profile, subscriptions, credit
//                            ledger, AI usage, project metadata, monitoring targets / probes / incidents),
//                            paged so nothing is cut at PostgREST's 1000 rows (WP03)
//   { "action": "delete" } → cancels active subscriptions (409 when a Paddle one cannot be cancelled here),
//                            writes an audit row (e-mail hashed), drops billing events and deletes the auth
//                            user; profiles/subscriptions/credit_ledger/ai_usage/bid_projects cascade.
//                            Local projects on the Mac are untouched (the engine only drops its session).
import { allRows, callerOf, type Deps, internalError, json, must, readJson, sha256Hex } from "../_shared/db.ts";
import { rateLimited } from "../_shared/ratelimit.ts";

export interface AccountDeps extends Deps {
  /** Cancels a Paddle subscription immediately (index.ts calls the Paddle API); absent → local cancel only. */
  cancelPaddleSubscription?: (subscriptionId: string) => Promise<void>;
}

export function createAccountHandler(deps: AccountDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const body = await readJson<{ action?: string }>(req);
    if (!body) return json(400, { error: "invalid JSON" });
    const who = await callerOf(req, deps);
    if (!who) return json(401, { error: "no session" });
    const user = who.user;
    const db = deps.service();

    const rows = (table: string, order = "created_at") => allRows(() => db.from(table).select("*").eq("user_id", user.id).order(order, { ascending: true }));

    try {
      switch (body.action) {
        case "export": {
          const limited = await rateLimited(db, user.id, "account.export");
          if (limited) return limited;
          const [profile, subscriptions, ledger, usage, projects, monitorTargets, monitorProbes, monitorIncidents] = await Promise.all([
            db.from("profiles").select("*").eq("user_id", user.id).maybeSingle().then((r) => r.data),
            rows("subscriptions", "updated_at"),
            rows("credit_ledger"),
            rows("ai_usage"),
            rows("bid_projects", "key"),
            rows("monitor_targets", "project_key"),
            rows("monitor_probes", "at"),
            rows("monitor_incidents", "opened_at"),
          ]);
          const v2Tables={credit_refunds:"created_at",cloud_reports:"created_at",credit_periods:"starts_at",credit_accounts:"migrated_at",credit_grants:"granted_at",credit_holds:"created_at",credit_allocations:"hold_id",sites:"created_at",usage_events:"created_at",usage_windows:"opened_at",usage_daily:"day",usage_nudges:"shown_at",domain_orders:"created_at",netlify_allocations:"period_ref",billing_changes:"created_at"};
          const creditData=Object.fromEntries(await Promise.all(Object.entries(v2Tables).map(async([table,order])=>[table,await rows(table,order)])));
          return json(200, {
            ...creditData,
            exportedAt: new Date().toISOString(),
            user: { id: user.id, email: user.email, created_at: user.created_at },
            profile,
            subscriptions,
            credit_ledger: ledger,
            ai_usage: usage,
            projects,
            monitor_targets: monitorTargets,
            monitor_probes: monitorProbes,
            monitor_incidents: monitorIncidents,
          });
        }
        case "delete": {
          // cancel at the provider first, so a deleted account is never charged again (audit C11)
          const { data: active } = await db.from("subscriptions").select("id,provider,provider_ref").eq("user_id", user.id).in("status", ["active", "trial", "past_due", "paused"]);
          const paddleSubs = (active ?? []).filter((s) => s.provider === "paddle" && s.provider_ref);
          if (paddleSubs.length && !deps.cancelPaddleSubscription) {
            return json(409, { error: "cancel the subscription first (Manage subscription), then delete the account", code: "subscription_active" });
          }
          for (const sub of paddleSubs) await deps.cancelPaddleSubscription!(sub.provider_ref);
          if (active?.length) {
            must(await db.from("subscriptions").update({ status: "canceled", cancel_at: new Date().toISOString() }).eq("user_id", user.id));
          }
          // the audit row outlives the account: it keeps only a hash of the address, not the address
          const emailHash = user.email ? await sha256Hex(user.email.trim().toLowerCase()) : null;
          must(await db.from("admin_audit").insert({ admin_id: user.id, action: "delete_me", target: user.id, payload: { email_hash: emailHash, subscriptions: active?.length ?? 0 } }));
          // billing events carry the payment payload (address, country) and do not cascade
          must(await db.from("billing_events").delete().eq("user_id", user.id));
          if (!db.auth.admin) throw new Error("service client without admin API");
          const { error: delErr } = await db.auth.admin.deleteUser(user.id);
          if (delErr) throw delErr;
          return json(200, { deleted: true });
        }
        default:
          return json(400, { error: `unknown action: ${body.action}` });
      }
    } catch (e) {
      return internalError("account", e);
    }
  };
}
