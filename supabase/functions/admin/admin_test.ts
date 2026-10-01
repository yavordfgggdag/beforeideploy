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
  assert.match(ledger[0].ref, /^[0-9a-f-]{36}$/);
  assert.equal(db.rpcCalls.find(c=>c.fn==="bid_grant")?.args.p_credits,500);
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
  assert.equal((await (await handle(post("admin", { action: "set_settings", settings: { "ai.sessionCapPercent": 20 } }))).json()).saved, 1);
  assert.equal((await handle(post("admin", { action: "set_settings", settings: { "ai.sessionCapPercent": 25, "ai.rate": { perMinute: 3 } } }))).status, 200);
  assert.equal(db.rows("settings").length, 2);
  const { settings } = await (await handle(post("admin", { action: "get_settings" }))).json();
  assert.equal(settings["ai.sessionCapPercent"], 25);
  assert.deepEqual(settings["ai.rate"], { perMinute: 3 });
  assert.equal((await handle(post("admin", { action: "set_settings", settings: {} }))).status, 400);
  const bad = await handle(post("admin", { action: "set_settings", settings: { "ai.rate": {}, "evil.key": 1 } }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "unknown_setting");
  assert.equal(db.rows("settings").length, 2, "nothing is saved when one key is unknown");
});

Deno.test("admin: list_users search text cannot inject PostgREST filters", async () => {
  const { handle } = world();
  const res = await handle(post("admin", { action: "list_users", query: "x%,role.eq.admin" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).users.length, 0);
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

Deno.test("admin: a database error becomes a generic 500 (details stay in the log)", async () => {
  const { db, handle } = world();
  db.failures.credit_ledger = { message: "relation is on fire" };
  const res = await handle(post("admin", { action: "grant_credits", user_id: NORMAL.id, delta: 10 }));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "internal error", code: "internal" });
});

Deno.test("admin: invite creates the user with the role, audits, refuses duplicates and bad input", async () => {
  const { db, handle } = world();
  const res = await handle(post("admin", { action: "invite", email: "Friend@Example.com", role: "vip", locale: "bg" }));
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.email, "friend@example.com");
  assert.equal(user.role, "vip");
  assert.equal(user.locale, "bg");
  assert.deepEqual(db.invited[0], { email: "friend@example.com", data: { locale: "bg" } });
  assert.equal(db.rows("admin_audit")[0].action, "invite");
  const dup = await handle(post("admin", { action: "invite", email: NORMAL.email }));
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).code, "invite_failed");
  assert.equal((await handle(post("admin", { action: "invite", email: "nope" }))).status, 400);
  assert.equal((await handle(post("admin", { action: "invite", email: "a@b.co", role: "king" }))).status, 400);
});

Deno.test("admin (WP03): diagnostics says what is missing with yes/no only — never a secret value", async () => {
  const { db } = world();
  db.tables.settings = [{ key: "billing.catalog", value: { plans: { flash: { price: 9.99, paddlePriceId: "pri_f", yearly: { price: 99.9, paddlePriceId: null } }, high: { price: 29.99, paddlePriceId: null } }, packs: [{ id: "pack-100k", paddlePriceId: null }] } }, { key: "legal.privacy", value: "https://x/privacy" }];
  db.tables.monitor_heartbeat = [{ at: "2026-10-01T09:55:00Z", checked: 1 }];
  const secrets: Record<string, string> = { ANTHROPIC_API_KEY: "sk-ant-real-looking", MONITOR_CRON_SECRET: "cron" };
  const handle = createAdminHandler({ ...fakeDeps(db), hasSecret: (n) => !!secrets[n], now: () => new Date("2026-10-01T10:00:00Z") });
  const res = await handle(post("admin", { action: "diagnostics" }));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes("sk-ant") && !text.includes("cron\""), "no secret value in the answer");
  const j = JSON.parse(text);
  assert.deepEqual(j.secrets, { ANTHROPIC_API_KEY: true, PADDLE_API_KEY: false, PADDLE_WEBHOOK_SECRET: false, PADDLE_ENV: false, MONITOR_CRON_SECRET: true });
  assert.equal(j.scheduler.state, "ok");
  assert.deepEqual(j.missingPrices.sort(), ["flash.yearly", "high.monthly", "pack.pack-100k"]);
  assert.equal(j.links["legal.privacy"], true);
  assert.equal(j.links["legal.terms"], false);
  assert.deepEqual(j.functions, { bid_rate_hit: true, bid_prune: true });
  assert.equal(j.ready, false);
  assert.ok(j.todo.includes("secret:PADDLE_API_KEY") && j.todo.includes("price:high.monthly") && j.todo.includes("setting:legal.terms"));
  db.missingFunctions.push("bid_prune");
  const j2 = await (await handle(post("admin", { action: "diagnostics" }))).json();
  assert.equal(j2.functions.bid_prune, false);
  assert.ok(j2.todo.includes("schema:bid_prune"));
  const normal = createAdminHandler({ ...fakeDeps(world(NORMAL.id).db), hasSecret: () => true });
  assert.equal((await normal(post("admin", { action: "diagnostics" }))).status, 403, "admins only");
});

Deno.test("admin V12: financial settings reject invalid prices, free-action fees and ungated Netlify credits", async()=>{
 const {handle}=world();
 for(const settings of [
  {"pricing.actions":{"deploy.rollback":{credits:10,window:false}}},
  {"pricing.actions":{"deploy.preview":{credits:150,window:false}}},
  {"pricing.actions":{"ai.chat":{credits:1,window:true}}},
  {"ai.prices":{"model":[0,0]}},{"ai.creditEur":0},{"ai.usdToEur":-1},
  {"plans":{"high":{"tokens":300000}}}
 ])assert.equal((await handle(post("admin",{action:"set_settings",settings}))).status,400);
 assert.equal((await handle(post("admin",{action:"set_settings",settings:{"features.netlifyCredits":true}}))).status,409);
 assert.equal((await handle(post("admin",{action:"set_settings",settings:{"pricing.actions":{"deploy.preview":{credits:150,window:true}},"pricing.version":"2026-10"}}))).status,200);
});
