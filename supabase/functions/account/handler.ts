// Before I Deploy — `account` Edge Function, request handler (V10 WP5, testable since L6):
//   { "action": "export" } → every row the cloud holds for the caller (profile, subscriptions,
//                            credit ledger, AI usage, project metadata)
//   { "action": "delete" } → cancels active subscriptions, writes an audit row and deletes the auth
//                            user; profiles/subscriptions/credit_ledger/ai_usage/bid_projects cascade.
//                            Local projects on the Mac are untouched (the engine only drops its session).
import { callerOf, type Deps, json, readJson } from "../_shared/db.ts";

export function createAccountHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const body = await readJson<{ action?: string }>(req);
    if (!body) return json(400, { error: "invalid JSON" });
    const who = await callerOf(req, deps);
    if (!who) return json(401, { error: "no session" });
    const user = who.user;
    const db = deps.service();

    const rows = async (table: string) => {
      const { data, error: e } = await db.from(table).select("*").eq("user_id", user.id);
      if (e) throw e;
      return data ?? [];
    };

    try {
      switch (body.action) {
        case "export": {
          const [profile, subscriptions, ledger, usage, projects] = await Promise.all([
            db.from("profiles").select("*").eq("user_id", user.id).maybeSingle().then((r) => r.data),
            rows("subscriptions"),
            rows("credit_ledger"),
            rows("ai_usage"),
            rows("bid_projects"),
          ]);
          return json(200, {
            exportedAt: new Date().toISOString(),
            user: { id: user.id, email: user.email, created_at: user.created_at },
            profile,
            subscriptions,
            credit_ledger: ledger,
            ai_usage: usage,
            projects,
          });
        }
        case "delete": {
          // WP4: also cancel an active subscription at the provider (Paddle / App Store) before deleting.
          const { data: active } = await db.from("subscriptions").select("id,provider,provider_ref").eq("user_id", user.id).in("status", ["active", "trial", "past_due"]);
          if (active?.length) {
            await db.from("subscriptions").update({ status: "canceled", cancel_at: new Date().toISOString() }).eq("user_id", user.id);
          }
          await db.from("admin_audit").insert({ admin_id: user.id, action: "delete_me", target: user.id, payload: { email: user.email, subscriptions: active?.length ?? 0 } });
          if (!db.auth.admin) throw new Error("service client without admin API");
          const { error: delErr } = await db.auth.admin.deleteUser(user.id);
          if (delErr) throw delErr;
          return json(200, { deleted: true });
        }
        default:
          return json(400, { error: `unknown action: ${body.action}` });
      }
    } catch (e) {
      console.error(e);
      return json(500, { error: (e as Error).message ?? "internal error" });
    }
  };
}
