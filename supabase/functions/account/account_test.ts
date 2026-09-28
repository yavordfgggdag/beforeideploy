// deno test supabase/functions   (no network, no env: the database is in memory)
import assert from "node:assert/strict";
import { FakeDb, fakeDeps, post } from "../_shared/fake_supabase.ts";
import { createAccountHandler } from "./handler.ts";

const ME = { id: "u-me", email: "me@example.com", created_at: "2026-03-01T00:00:00Z" };
const OTHER = "u-other";

const cancelled: string[] = [];
const cancelOk = (id: string) => {
  cancelled.push(id);
  return Promise.resolve();
};

function world(loggedIn = true) {
  const db = new FakeDb({
    profiles: [
      { user_id: ME.id, email: ME.email, role: "normal", plan: "high" },
      { user_id: OTHER, email: "other@example.com", role: "normal", plan: "free" },
    ],
    subscriptions: [
      { id: "s1", user_id: ME.id, provider: "paddle", provider_ref: "sub_1", status: "active", tier: "high" },
      { id: "s2", user_id: ME.id, provider: "manual", provider_ref: null, status: "canceled", tier: "flash" },
      { id: "s3", user_id: OTHER, provider: "paddle", provider_ref: "sub_9", status: "active", tier: "knight" },
    ],
    credit_ledger: [{ user_id: ME.id, delta: 1000000, bucket: "plan", reason: "monthly_grant" }, { user_id: OTHER, delta: 5, bucket: "topup", reason: "admin_grant" }],
    ai_usage: [{ user_id: ME.id, charged_tokens: 6000, model: "claude-sonnet-5" }],
    bid_projects: [{ user_id: ME.id, key: "p1", name: "My site" }, { user_id: OTHER, key: "p2", name: "Theirs" }],
    admin_audit: [],
    billing_events: [{ id: "evt_me", user_id: ME.id, payload: { data: { address: "x" } } }, { id: "evt_other", user_id: OTHER, payload: {} }],
  }, loggedIn ? ME : null);
  return { db, handle: createAccountHandler({ ...fakeDeps(db), cancelPaddleSubscription: cancelOk }) };
}

Deno.test("account: only POST, JSON and a session", async () => {
  const { handle } = world();
  assert.equal((await handle(new Request("http://functions.local/account"))).status, 405);
  assert.equal((await handle(post("account", "{"))).status, 400);
  assert.equal((await handle(post("account", { action: "export" }, null))).status, 401);
  assert.equal((await world(false).handle(post("account", { action: "export" }))).status, 401);
  assert.equal((await handle(post("account", { action: "teleport" }))).status, 400);
});

Deno.test("account: export returns only the caller's rows, from every table", async () => {
  const { handle } = world();
  const res = await handle(post("account", { action: "export" }));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.user, { id: ME.id, email: ME.email, created_at: ME.created_at });
  assert.match(j.exportedAt, /^\d{4}-/);
  assert.equal(j.profile.plan, "high");
  assert.deepEqual(j.subscriptions.map((s: { id: string }) => s.id), ["s1", "s2"]);
  assert.equal(j.credit_ledger.length, 1);
  assert.equal(j.credit_ledger[0].delta, 1000000);
  assert.equal(j.ai_usage.length, 1);
  assert.deepEqual(j.projects.map((p: { key: string }) => p.key), ["p1"]);
});

Deno.test("account: delete cancels active subscriptions, audits and removes the auth user", async () => {
  const { db, handle } = world();
  const res = await handle(post("account", { action: "delete" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: true });
  assert.deepEqual(db.deletedUsers, [ME.id]);
  // the caller's rows are gone (cascade), the other user's stay
  assert.equal(db.rows("profiles").length, 1);
  assert.equal(db.rows("bid_projects")[0].key, "p2");
  assert.equal(db.rows("subscriptions").find((s) => s.id === "s3")?.status, "active");
  const audit = db.rows("admin_audit");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "delete_me");
  assert.equal(audit[0].admin_id, ME.id);
  assert.equal(audit[0].target, ME.id);
  assert.equal(audit[0].payload.subscriptions, 1);
  assert.match(audit[0].payload.email_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(audit).includes(ME.email), "the audit row keeps no address");
  assert.deepEqual(db.rows("billing_events").map((e) => e.id), ["evt_other"]);
});

Deno.test("account: delete marks the subscriptions canceled before the user goes", async () => {
  const { db, handle } = world();
  // keep the rows around to inspect the update: no admin API → the handler fails after the update
  db.auth.admin = undefined as unknown as typeof db.auth.admin;
  const res = await handle(post("account", { action: "delete" }));
  assert.equal(res.status, 500);
  const mine = db.rows("subscriptions").filter((s) => s.user_id === ME.id);
  assert.ok(mine.every((s) => s.status === "canceled"));
  assert.ok(mine.find((s) => s.id === "s1")?.cancel_at);
});

Deno.test("account: delete cancels the Paddle subscription at the provider first", async () => {
  const { db } = world();
  const cancelled: string[] = [];
  const handle = createAccountHandler({ ...fakeDeps(db), cancelPaddleSubscription: (id) => { cancelled.push(id); return Promise.resolve(); } });
  assert.equal((await handle(post("account", { action: "delete" }))).status, 200);
  assert.deepEqual(cancelled, ["sub_1"]);
});

Deno.test("account: a failing provider cancel stops the deletion", async () => {
  const { db } = world();
  const handle = createAccountHandler({ ...fakeDeps(db), cancelPaddleSubscription: () => Promise.reject(new Error("Paddle down")) });
  const res = await handle(post("account", { action: "delete" }));
  assert.equal(res.status, 500);
  assert.deepEqual(db.deletedUsers, []);
});

Deno.test("account: without a way to cancel at Paddle the deletion is refused, nothing changes", async () => {
  const { db } = world();
  const handle = createAccountHandler(fakeDeps(db));
  const res = await handle(post("account", { action: "delete" }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "subscription_active");
  assert.deepEqual(db.deletedUsers, []);
  assert.equal(db.rows("subscriptions").find((s) => s.id === "s1")?.status, "active");
});

Deno.test("account: errors do not leak database details", async () => {
  const { db, handle } = world();
  db.failures.ai_usage = { message: "relation ai_usage is on fire" };
  const res = await handle(post("account", { action: "export" }));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "internal error", code: "internal" });
});
