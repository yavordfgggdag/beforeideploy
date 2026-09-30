// Before I Deploy — `admin` Edge Function, request handler (V10 WP2, testable since L6).
// Every request carries the caller's user JWT; we check profiles.role = 'admin', then act with the
// service role and write a row to admin_audit. The engine calls it via `bid admin <action>`.
import { callerOf, type DbClient, type Deps, internalError, json, readJson } from "../_shared/db.ts";
import { rateLimited } from "../_shared/ratelimit.ts";

/** Project secrets the functions need. Diagnostics reports only yes / no — never a value or a prefix. */
export const REQUIRED_SECRETS = ["ANTHROPIC_API_KEY", "PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET", "PADDLE_ENV", "MONITOR_CRON_SECRET"];

export interface AdminDeps extends Deps {
  /** Whether a project secret is set (index.ts reads Deno.env); tests pass a map. */
  hasSecret?: (name: string) => boolean;
  now?: () => Date;
}

/** Settings an admin may change (audit C14); anything else is a typo or an attempt to plant data. */
export const SETTINGS_KEYS = [
  "billing.catalog", "plans", "ai.models", "ai.creditEur", "ai.usdToEur", "ai.sessionHours", "ai.sessionCapPercent", "ai.rate", "ai.promptMaxChars", "ai.prices",
  "release.url", "help.url", "legal.privacy", "legal.terms", "legal.refund", "support.email",
];

export type Role = "normal" | "vip" | "admin";
export type Plan = "free" | "flash" | "high" | "knight";
export const ROLES: Role[] = ["normal", "vip", "admin"];
export const PLANS: Plan[] = ["free", "flash", "high", "knight"];

export interface AdminBody {
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
  email?: string;
  locale?: string;
}

async function balanceOf(db: DbClient, userId: string): Promise<number> {
  const { data } = await db.from("credit_balance").select("balance").eq("user_id", userId).maybeSingle();
  return Number(data?.balance ?? 0);
}

async function userRow(db: DbClient, userId: string) {
  const { data, error } = await db.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, balance: await balanceOf(db, userId) };
}

export function createAdminHandler(deps: AdminDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const body = await readJson<AdminBody>(req);
    if (!body) return json(400, { error: "invalid JSON" });
    if (typeof body.action !== "string") return json(400, { error: "action required" });

    const who = await callerOf(req, deps);
    if (!who) return json(401, { error: "no session" });
    const { data: profile } = await who.asUser.from("profiles").select("role").eq("user_id", who.user.id).maybeSingle();
    if (!profile) return json(403, { error: "no profile", code: "no_profile" });
    if (profile.role !== "admin") return json(403, { error: "admin only", code: "forbidden" });
    const me = { id: who.user.id, role: profile.role as Role };

    const db = deps.service();
    const audit = (target: string | null, payload: unknown) =>
      db.from("admin_audit").insert({ admin_id: me.id, action: body.action, target, payload });
    // writes are limited per admin too: a stolen admin session cannot rewrite every account in a loop (WP03)
    if (!["list_users", "get_user", "get_usage", "get_settings", "audit_log", "diagnostics"].includes(body.action)) {
      const limited = await rateLimited(db, me.id, "admin.write");
      if (limited) return limited;
    }

    try {
      switch (body.action) {
        case "list_users": {
          let q = db.from("profiles").select("*").order("created_at", { ascending: false }).limit(Math.min(body.limit ?? 200, 1000));
          // PostgREST filter syntax: commas, brackets and wildcards in the search text would change the filter
          const term = String(body.query ?? "").replace(/[,()%*\\]/g, "").trim().slice(0, 100);
          if (term) q = q.or(`email.ilike.%${term}%,display_name.ilike.%${term}%`);
          const { data: users, error } = await q;
          if (error) throw error;
          const { data: balances } = await db.from("credit_balance").select("user_id,balance");
          const byUser = new Map((balances ?? []).map((b) => [b.user_id as string, Number(b.balance)]));
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
          const unknown = entries.map(([k]) => k).filter((k) => !SETTINGS_KEYS.includes(k));
          if (unknown.length) return json(400, { error: `unknown settings: ${unknown.join(", ")}`, code: "unknown_setting" });
          const rows = entries.map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
          const { error } = await db.from("settings").upsert(rows, { onConflict: "key" });
          if (error) throw error;
          await audit(null, { keys: entries.map(([k]) => k) });
          return json(200, { saved: entries.length });
        }

        case "invite": {
          // WP5: friends and clients get an invitation email instead of signing up themselves
          const email = String(body.email ?? "").trim().toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "a valid email is required" });
          const role = (body.role ?? "vip") as Role;
          if (!ROLES.includes(role)) return json(400, { error: "unknown role" });
          if (!db.auth.admin?.inviteUserByEmail) throw new Error("service client without admin API");
          const { data, error } = await db.auth.admin.inviteUserByEmail(email, { data: { locale: body.locale ?? "en" } });
          if (error || !data.user) return json(409, { error: error?.message ?? "invite failed", code: "invite_failed" });
          const { error: upErr } = await db.from("profiles").update({ role }).eq("user_id", data.user.id);
          if (upErr) throw upErr;
          await audit(data.user.id, { email, role });
          return json(200, { user: await userRow(db, data.user.id) });
        }

        case "diagnostics": {
          // what the owner must still configure, without exposing any secret or the infrastructure (WP03)
          const now = deps.now?.() ?? new Date();
          const secrets = Object.fromEntries(REQUIRED_SECRETS.map((n) => [n, !!deps.hasSecret?.(n)]));
          const { data: beat } = await db.from("monitor_heartbeat").select("at").order("at", { ascending: false }).limit(1).maybeSingle();
          const lastBeat = beat?.at ? String(beat.at) : null;
          const ageMin = lastBeat ? Math.round((now.getTime() - Date.parse(lastBeat)) / 60000) : null;
          const { data: settingsRows } = await db.from("settings").select("key,value");
          const settings = Object.fromEntries((settingsRows ?? []).map((r) => [r.key, r.value]));
          const catalog = (settings["billing.catalog"] ?? {}) as { plans?: Record<string, { paddlePriceId?: string | null; yearly?: { paddlePriceId?: string | null } }>; packs?: { id?: string; paddlePriceId?: string | null }[] };
          const missingPrices: string[] = [];
          for (const [id, plan] of Object.entries(catalog.plans ?? {})) {
            if (!plan?.paddlePriceId) missingPrices.push(`${id}.monthly`);
            if (plan?.yearly && !plan.yearly.paddlePriceId) missingPrices.push(`${id}.yearly`);
          }
          for (const pack of catalog.packs ?? []) if (!pack?.paddlePriceId) missingPrices.push(`pack.${pack?.id ?? "?"}`);
          const links = Object.fromEntries(["legal.privacy", "legal.terms", "legal.refund", "support.email", "release.url", "help.url"].map((k) => [k, !!settings[k]]));
          const fnProbe = async (fn: string, args: Record<string, unknown>) => {
            const { error } = await db.rpc(fn, args);
            return !error || !(error.code === "PGRST202" || error.code === "42883");
          };
          const functions = {
            bid_rate_hit: await fnProbe("bid_rate_hit", { p_user: me.id, p_action: "admin.diagnostics", p_limit: 1000, p_window_seconds: 1 }),
            bid_prune: await fnProbe("bid_prune", { p_batch: 0 }),
          };
          const scheduler = { lastRunAt: lastBeat, ageMinutes: ageMin, state: lastBeat == null ? "never" : ageMin != null && ageMin > 15 ? "stale" : "ok" };
          const todo = [
            ...Object.entries(secrets).filter(([, v]) => !v).map(([k]) => `secret:${k}`),
            ...(scheduler.state === "ok" ? [] : ["scheduler"]),
            ...missingPrices.map((p) => `price:${p}`),
            ...Object.entries(links).filter(([k, v]) => !v && k.startsWith("legal.")).map(([k]) => `setting:${k}`),
            ...Object.entries(functions).filter(([, v]) => !v).map(([k]) => `schema:${k}`),
          ];
          return json(200, { secrets, scheduler, missingPrices, links, functions, todo, ready: todo.length === 0 });
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
      return internalError("admin", e);
    }
  };
}
