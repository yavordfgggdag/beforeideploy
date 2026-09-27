// deno test supabase/functions   (no network, no env: the database is in memory)
import assert from "node:assert/strict";
import { FakeDb, fakeDeps, post } from "../_shared/fake_supabase.ts";
import { createAdminHandler } from "./handler.ts";

const ADMIN = { id: "u-admin", email: "admin@example.com" };
const NORMAL = { id: "u-normal", email: "ivan@example.com" };

function world(callerId: string | null = ADMIN.id) {
  const db = new FakeDb({
    profiles: [
      { user_id: ADMIN.id, email: ADMIN.email, display_name: "Admin", role: "admin", plan: "free", ai_disabled: false, created_at: "2026-01-01T00:00:00Z" },
      { user_id: NORMAL.id, email: NORMAL.email, display_name: "Ivan", role: "normal", plan: "free", ai_disabled: false, created_at: "2026-02-01T00:00:00Z" },
    ],
    credit_balance: [{ user_id: NORMAL.id, balance: 1200 }],
    ai_usage: [{ user_id: NORMAL.id, created_at: "2026-09-01T10:00:00Z", charged_tokens: 100 }],
    credit_ledger: [],
    admin_audit: [],
    subscriptions: [],
    settings: [],
  }, callerId === ADMIN.id ? ADMIN : callerId === NORMAL.id ? NORMAL : null);
  return { db, handle: createAdminHandler(fakeDeps(db)) };
}

Deno.test("admin: only POST", async () => {
  const { handle } = world();
  const res = await handle(new Request("http://functions.local/admin"));
  assert.equal(res.status, 405);
});

Deno.test("admin: invalid JSON → 400", async () => {
  const { handle } = world();
  const res = await handle(post("admin", "{oops"));
  assert.equal(res.status, 400);
});

Deno.test("admin: no session → 401", async () => {
  const { handle } = world(null);
  assert.equal((await handle(post("admin", { action: "list_users" }, null))).status, 401);
  assert.equal((await handle(post("admin", { action: "list_users" }, "expired"))).status, 401);
});

Deno.test("admin: a normal user is refused with 403", async () => {
  const { handle } = world(NORMAL.id);
  const res = await handle(post("admin", { action: "list_users" }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "forbidden");
});

Deno.test("admin: list_users joins balances and the last AI use, and filters by query", async () => {
  const { handle } = world();
  const res = await handle(post("admin", { action: "list_users" }));
  assert.equal(res.status, 200);
  const { users } = await res.json();
  assert.equal(users.length, 2);
  const ivan = users.find((u: { user_id: string }) => u.user_id === NORMAL.id);
  assert.equal(ivan.balance, 1200);
  assert.equal(ivan.last_ai_at, "2026-09-01T10:00:00Z");
  const admin = users.find((u: { user_id: string }) => u.user_id === ADMIN.id);
  assert.equal(admin.balance, 0);
  assert.equal(admin.last_ai_at, null);

  const filtered = await (await handle(post("admin", { action: "list_users", query: "IVAN" }))).json();
  assert.deepEqual(filtered.users.map((u: { email: string }) => u.email), [NORMAL.email]);
});

Deno.test("admin: set_role updates the profile and writes an audit row", async () => {
  const { db, handle } = world();
  const res = await handle(post("admin", { action: "set_role", user_id: NORMAL.id, role: "vip" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.role, "vip");
  assert.equal(db.rows("profiles").find((p) => p.user_id === NORMAL.id)?.role, "vip");
  const audit = db.rows("admin_audit");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].admin_id, ADMIN.id);
  assert.equal(audit[0].action, "set_role");
  assert.equal(audit[0].target, NORMAL.id);
  assert.deepEqual(audit[0].payload, { role: "vip" });
});

Deno.test("admin: set_role rejects unknown roles and self-demotion", async () => {
  const { handle } = world();
  assert.equal((await handle(post("admin", { action: "set_role", user_id: NORMAL.id, role: "king" }))).status, 400);
  const res = await handle(post("admin", { action: "set_role", user_id: ADMIN.id, role: "normal" }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /own admin role/);
});

Deno.test("admin: grant_credits inserts a top-up ledger row", async () => {
  const { db, handle } = world();
  const res = await handle(post("admin", { action: "grant_credits", user_id: NORMAL.id, delta: 500.7, reason: "beta tester" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).balance, 1200); // the view is static in the fake; the ledger row is what matters
  const ledger = db.rows("credit_ledger");
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].delta, 500);
  assert.equal(ledger[0].bucket, "topup");
  assert.equal(ledger[0].reason, "admin_grant");
  assert.equal(ledger[0].ref, "beta tester");
  assert.equal((await handle(post("admin", { action: "grant_credits", user_id: NORMAL.id, delta: 0 }))).status, 400);
});

Deno.test("admin: set_plan_manual records a manual subscription", async () => {
  const { db, handle } = world();
  assert.equal((await handle(post("admin", { action: "set_plan_manual", user_id: NORMAL.id, plan: "high" }))).status, 200);
  assert.equal(db.rows("profiles").find((p) => p.user_id === NORMAL.id)?.plan, "high");
  let subs = db.rows("subscriptions");
  assert.equal(subs.length, 1);
  assert.equal(subs[0].provider, "manual");
  assert.equal(subs[0].tier, "high");
  assert.equal(subs[0].status, "active");
  assert.equal((await handle(post("admin", { action: "set_plan_manual", user_id: NORMAL.id, plan: "free" }))).status, 200);
  subs = db.rows("subscriptions");
  assert.equal(subs[1].status, "canceled");
});

Deno.test("admin: disable_ai flips the flag", async () => {
  const { db, handle } = world();
  const res = await handle(post("admin", { action: "disable_ai", user_id: NORMAL.id, disabled: true }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.ai_disabled, true);
  assert.equal(db.rows("admin_audit")[0].payload.disabled, true);
});

Deno.test("admin: set_settings upserts by key; get_settings reads back", async () => {
  const { db, handle } = world();
  assert.equal((await (await handle(post("admin", { action: "set_settings", settings: { "ai.dailyCapPercent": 20 } }))).json()).saved, 1);
  assert.equal((await handle(post("admin", { action: "set_settings", settings: { "ai.dailyCapPercent": 25, "ai.rate": { perMinute: 3 } } }))).status, 200);
  assert.equal(db.rows("settings").length, 2);
  const { settings } = await (await handle(post("admin", { action: "get_settings" }))).json();
  assert.equal(settings["ai.dailyCapPercent"], 25);
  assert.deepEqual(settings["ai.rate"], { perMinute: 3 });
  assert.equal((await handle(post("admin", { action: "set_settings", settings: {} }))).status, 400);
});

Deno.test("admin: audit_log lists newest first", async () => {
  const { handle } = world();
  await handle(post("admin", { action: "set_role", user_id: NORMAL.id, role: "vip" }));
  await handle(post("admin", { action: "disable_ai", user_id: NORMAL.id, disabled: true }));
  const { entries } = await (await handle(post("admin", { action: "audit_log" }))).json();
  assert.deepEqual(entries.map((e: { action: string }) => e.action), ["disable_ai", "set_role"]);
});

Deno.test("admin: unknown action → 400, get_user on a missing user → 404", async () => {
  const { handle } = world();
  assert.equal((await handle(post("admin", { action: "explode" }))).status, 400);
  assert.equal((await handle(post("admin", { action: "get_user", user_id: "nobody" }))).status, 404);
  const res = await handle(post("admin", { action: "get_user", user_id: NORMAL.id }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.balance, 1200);
});

Deno.test("admin: a database error becomes 500 with the message", async () => {
  const { db, handle } = world();
  db.failures.credit_ledger = { message: "relation is on fire" };
  const res = await handle(post("admin", { action: "grant_credits", user_id: NORMAL.id, delta: 10 }));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, "relation is on fire");
});
