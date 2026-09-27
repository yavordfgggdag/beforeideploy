// Before I Deploy — `admin` Edge Function (V10 WP2).
// Every request carries the caller's user JWT; the function checks profiles.role = 'admin', then acts
// with the service role and writes a row to admin_audit. The engine calls it via `bid admin <action>`.
//
// Deploy:  supabase functions deploy admin --no-verify-jwt=false
// Secrets: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type Role = "normal" | "vip" | "admin";
type Plan = "free" | "flash" | "high" | "knight";
const ROLES: Role[] = ["normal", "vip", "admin"];
const PLANS: Plan[] = ["free", "flash", "high", "knight"];

interface Body {
  action: string;
  user_id?: string;
  query?: string;
  role?: Role;
  plan?: Plan;
  delta?: number;
  reason?: string;
  disabled?: boolean;
  settings?: Record<string, unknown>;
  limit?: number;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function caller(req: Request): Promise<{ id: string; role: Role } | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error } = await asUser.auth.getUser();
  if (error || !user) return null;
  const { data: profile } = await asUser.from("profiles").select("role").eq("user_id", user.id).maybeSingle();
  return profile ? { id: user.id, role: profile.role as Role } : null;
}

async function balanceOf(db: SupabaseClient, userId: string): Promise<number> {
  const { data } = await db.from("credit_balance").select("balance").eq("user_id", userId).maybeSingle();
  return Number(data?.balance ?? 0);
}

async function userRow(db: SupabaseClient, userId: string) {
  const { data, error } = await db.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, balance: await balanceOf(db, userId) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  const me = await caller(req);
  if (!me) return json(401, { error: "no session" });
  if (me.role !== "admin") return json(403, { error: "admin only" });

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const audit = (target: string | null, payload: unknown) =>
    db.from("admin_audit").insert({ admin_id: me.id, action: body.action, target, payload });

  try {
    switch (body.action) {
      case "list_users": {
        let q = db.from("profiles").select("*").order("created_at", { ascending: false }).limit(Math.min(body.limit ?? 200, 1000));
        if (body.query) q = q.or(`email.ilike.%${body.query}%,display_name.ilike.%${body.query}%`);
        const { data: users, error } = await q;
        if (error) throw error;
        const { data: balances } = await db.from("credit_balance").select("user_id,balance");
        const byUser = new Map((balances ?? []).map((b) => [b.user_id, Number(b.balance)]));
        const { data: lastUse } = await db.from("ai_usage").select("user_id,created_at").order("created_at", { ascending: false }).limit(1000);
        const lastByUser = new Map<string, string>();
        for (const u of lastUse ?? []) if (!lastByUser.has(u.user_id)) lastByUser.set(u.user_id, u.created_at);
        return json(200, {
          users: (users ?? []).map((u) => ({ ...u, balance: byUser.get(u.user_id) ?? 0, last_ai_at: lastByUser.get(u.user_id) ?? null })),
        });
      }

      case "get_user": {
        if (!body.user_id) return json(400, { error: "user_id required" });
        const user = await userRow(db, body.user_id);
        if (!user) return json(404, { error: "no such user" });
        const { data: subs } = await db.from("subscriptions").select("*").eq("user_id", body.user_id).order("updated_at", { ascending: false });
        const { data: ledger } = await db.from("credit_ledger").select("*").eq("user_id", body.user_id).order("created_at", { ascending: false }).limit(50);
        return json(200, { user, subscriptions: subs ?? [], ledger: ledger ?? [] });
      }

      case "set_role": {
        if (!body.user_id || !ROLES.includes(body.role as Role)) return json(400, { error: "user_id and role required" });
        if (body.user_id === me.id && body.role !== "admin") return json(400, { error: "you cannot remove your own admin role" });
        const { error } = await db.from("profiles").update({ role: body.role }).eq("user_id", body.user_id);
        if (error) throw error;
        await audit(body.user_id, { role: body.role });
        return json(200, { user: await userRow(db, body.user_id) });
      }

      case "set_plan_manual": {
        if (!body.user_id || !PLANS.includes(body.plan as Plan)) return json(400, { error: "user_id and plan required" });
        const { error } = await db.from("profiles").update({ plan: body.plan }).eq("user_id", body.user_id);
        if (error) throw error;
        await db.from("subscriptions").insert({ user_id: body.user_id, provider: "manual", tier: body.plan, status: body.plan === "free" ? "canceled" : "active", raw: { by: me.id } });
        await audit(body.user_id, { plan: body.plan });
        return json(200, { user: await userRow(db, body.user_id) });
      }

      case "grant_credits": {
        const delta = Number(body.delta);
        if (!body.user_id || !Number.isFinite(delta) || delta === 0) return json(400, { error: "user_id and a non-zero delta required" });
        const { error } = await db.from("credit_ledger").insert({ user_id: body.user_id, delta: Math.trunc(delta), bucket: "topup", reason: "admin_grant", ref: body.reason ?? null });
        if (error) throw error;
        await audit(body.user_id, { delta: Math.trunc(delta), reason: body.reason ?? null });
        return json(200, { balance: await balanceOf(db, body.user_id) });
      }

      case "disable_ai": {
        if (!body.user_id) return json(400, { error: "user_id required" });
        const { error } = await db.from("profiles").update({ ai_disabled: !!body.disabled }).eq("user_id", body.user_id);
        if (error) throw error;
        await audit(body.user_id, { disabled: !!body.disabled });
        return json(200, { user: await userRow(db, body.user_id) });
      }

      case "get_usage": {
        if (!body.user_id) return json(400, { error: "user_id required" });
        const { data, error } = await db.from("ai_usage").select("*").eq("user_id", body.user_id).order("created_at", { ascending: false }).limit(Math.min(body.limit ?? 200, 1000));
        if (error) throw error;
        return json(200, { usage: data ?? [] });
      }

      case "get_settings": {
        const { data, error } = await db.from("settings").select("key,value,updated_at");
        if (error) throw error;
        return json(200, { settings: Object.fromEntries((data ?? []).map((s) => [s.key, s.value])) });
      }

      case "set_settings": {
        const entries = Object.entries(body.settings ?? {});
        if (!entries.length) return json(400, { error: "settings required" });
        const rows = entries.map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
        const { error } = await db.from("settings").upsert(rows, { onConflict: "key" });
        if (error) throw error;
        await audit(null, { keys: entries.map(([k]) => k) });
        return json(200, { saved: entries.length });
      }

      case "audit_log": {
        const { data, error } = await db.from("admin_audit").select("*").order("created_at", { ascending: false }).limit(Math.min(body.limit ?? 200, 1000));
        if (error) throw error;
        return json(200, { entries: data ?? [] });
      }

      default:
        return json(400, { error: `unknown action: ${body.action}` });
    }
  } catch (e) {
    console.error(e);
    return json(500, { error: (e as Error).message ?? "internal error" });
  }
});
