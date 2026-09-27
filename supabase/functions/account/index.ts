// Before I Deploy — `account` Edge Function (V10 WP5): GDPR export and account deletion for the caller.
//   { "action": "export" } → every row the cloud holds for this user (profile, subscriptions, credit ledger,
//                            AI usage, project metadata)
//   { "action": "delete" } → deletes the auth user; profiles/subscriptions/credit_ledger/ai_usage/bid_projects
//                            cascade. Local projects on the Mac are untouched (the engine only drops its session).
// Deploy: supabase functions deploy account
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "no session" });
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error } = await asUser.auth.getUser();
  if (error || !user) return json(401, { error: "no session" });
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

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
        return json(200, { user: { id: user.id, email: user.email, created_at: user.created_at }, profile, subscriptions, credit_ledger: ledger, ai_usage: usage, projects });
      }
      case "delete": {
        // WP4: cancel an active subscription at the provider (Paddle / App Store) before deleting.
        const { data: active } = await db.from("subscriptions").select("id,provider,provider_ref").eq("user_id", user.id).in("status", ["active", "trial", "past_due"]);
        if (active?.length) await db.from("subscriptions").update({ status: "canceled", cancel_at: new Date().toISOString() }).eq("user_id", user.id);
        await db.from("admin_audit").insert({ admin_id: user.id, action: "delete_me", target: user.id, payload: { email: user.email, subscriptions: active?.length ?? 0 } });
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
});
