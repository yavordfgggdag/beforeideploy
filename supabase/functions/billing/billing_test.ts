// deno test supabase/functions   (no network: database and Paddle are fakes)
import assert from "node:assert/strict";
import type { AuthUser, Row } from "../_shared/db.ts";
import { FakeDb, fakeDeps, post } from "../_shared/fake_supabase.ts";
import { createBillingHandler, signPaddle, verifyPaddleSignature } from "./handler.ts";

const USER: AuthUser = { id: "u-1", email: "ivan@example.com" };
const SECRET = "pdl_ntfset_test_secret";
const NOW = new Date("2026-10-10T12:00:00Z");
const CATALOG = {
  currency: "EUR",
  trial: { days: 7, plan: "high", tokens: 150000 },
  plans: { flash: { price: 4.99, paddlePriceId: "pri_flash" }, high: { price: 9.99, paddlePriceId: "pri_high", yearly: { price: 95.9, paddlePriceId: "pri_high_year" } }, knight: { price: 19.99, paddlePriceId: null } },
  packs: [{ id: "pack-500k", tokens: 500000, price: 4.99, paddlePriceId: "pri_pack" }],
};

function world(o: { user?: AuthUser | null; ledger?: Row[]; subs?: Row[]; role?: string; plan?: string; now?: Date; apiKey?: string } = {}) {
  const db = new FakeDb({
    profiles: [{ user_id: USER.id, email: USER.email, role: o.role ?? "normal", plan: o.plan ?? "free" }],
    subscriptions: o.subs ?? [],
    credit_ledger: o.ledger ?? [],
    billing_events: [],
    ai_usage: [{ user_id: USER.id, created_at: "2026-10-09T10:00:00Z", step: "build", model: "claude-sonnet-5", charged_tokens: 6000, project_key: "p1" }],
    settings: [{ key: "billing.catalog", value: CATALOG }],
  }, o.user === undefined ? USER : o.user);
  const calls: { url: string; body: Row; auth: string }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")), auth: (init?.headers as Record<string, string>).authorization });
    if (url.endsWith("/transactions")) return Response.json({ data: { id: "txn_1", checkout: { url: "https://pay.example/checkout?_ptxn=txn_1" } } });
    if (url.includes("/portal-sessions")) return Response.json({ data: { urls: { general: { overview: "https://customer-portal.paddle.com/x" } } } });
    return Response.json({ error: { detail: "nope" } }, { status: 400 });
  }) as unknown as typeof globalThis.fetch;
  const handle = createBillingHandler({ ...fakeDeps(db), paddleApiKey: o.apiKey ?? "pdl_test_key", paddleWebhookSecret: SECRET, paddleApiBase: "https://sandbox-api.paddle.test", fetch, now: () => o.now ?? NOW });
  return { db, handle, calls };
}

async function webhook(handle: (r: Request) => Promise<Response>, event: Row, opts: { secret?: string; at?: Date } = {}) {
  const body = JSON.stringify(event);
  const sig = await signPaddle(body, opts.secret ?? SECRET, opts.at ?? NOW);
  return handle(new Request("http://functions.local/billing", { method: "POST", headers: { "paddle-signature": sig, "content-type": "application/json" }, body }));
}

const sum = (rows: Row[], bucket?: string) => rows.filter((r) => !bucket || r.bucket === bucket).reduce((a, r) => a + Number(r.delta), 0);

function subEvent(id: string, status: string, price = "pri_high", extra: Row = {}) {
  return {
    event_id: id, event_type: status === "canceled" ? "subscription.canceled" : "subscription.updated",
    data: { id: "sub_1", status, customer_id: "ctm_1", custom_data: { user_id: USER.id }, items: [{ price: { id: price } }],
      current_billing_period: { starts_at: "2026-10-10T00:00:00Z", ends_at: "2026-11-10T00:00:00Z" }, ...extra },
  };
}

Deno.test("billing: signature check (valid, wrong secret, stale timestamp, garbage)", async () => {
  const body = '{"a":1}';
  assert.ok(await verifyPaddleSignature(await signPaddle(body, SECRET, NOW), body, SECRET, NOW));
  assert.ok(!(await verifyPaddleSignature(await signPaddle(body, "other", NOW), body, SECRET, NOW)));
  assert.ok(!(await verifyPaddleSignature(await signPaddle(body, SECRET, new Date(NOW.getTime() - 600_000)), body, SECRET, NOW)));
  assert.ok(!(await verifyPaddleSignature(await signPaddle(body, SECRET, NOW), body + " ", SECRET, NOW)));
  assert.ok(!(await verifyPaddleSignature("nonsense", body, SECRET, NOW)));
  assert.ok(!(await verifyPaddleSignature(null, body, SECRET, NOW)));
});

Deno.test("billing: webhook with a bad signature → 401 and nothing changes", async () => {
  const { db, handle } = world();
  const res = await webhook(handle, subEvent("evt_1", "active"), { secret: "forged" });
  assert.equal(res.status, 401);
  assert.equal(db.rows("subscriptions").length, 0);
  assert.equal(db.rows("billing_events").length, 0);
});

Deno.test("billing: subscription.updated active → subscription row + plan high; canceled → free", async () => {
  const { db, handle } = world();
  assert.equal((await webhook(handle, subEvent("evt_1", "active"))).status, 200);
  const sub = db.rows("subscriptions")[0];
  assert.equal(sub.provider_ref, "sub_1");
  assert.equal(sub.customer_ref, "ctm_1");
  assert.equal(sub.tier, "high");
  assert.equal(sub.period_end, "2026-11-10T00:00:00Z");
  assert.equal(db.rows("profiles")[0].plan, "high");

  await webhook(handle, subEvent("evt_2", "canceled"));
  assert.equal(db.rows("subscriptions").length, 1, "same subscription is updated, not duplicated");
  assert.equal(db.rows("subscriptions")[0].status, "canceled");
  assert.equal(db.rows("profiles")[0].plan, "free");
});

Deno.test("billing: a repeated event is processed once", async () => {
  const { db, handle } = world();
  const txn = { event_id: "evt_t1", event_type: "transaction.completed", data: { id: "txn_9", custom_data: { user_id: USER.id }, items: [{ price: { id: "pri_high" }, quantity: 1 }] } };
  await webhook(handle, txn);
  const again = await (await webhook(handle, txn)).json();
  assert.equal(again.duplicate, true);
  assert.equal(sum(db.rows("credit_ledger")), 300000);
  // same transaction under a new event id (Paddle resends) → still one grant
  await webhook(handle, { ...txn, event_id: "evt_t2" });
  assert.equal(sum(db.rows("credit_ledger")), 300000);
});

Deno.test("billing: a new period retains unexpired V2 grants; packs add top-up", async () => {
  const { db, handle } = world({ ledger: [
    { user_id: USER.id, delta: 1000000, bucket: "plan", reason: "plan_grant", ref: "txn_old" },
    { user_id: USER.id, delta: -400000, bucket: "plan", reason: "ai_fix", ref: "u1" },
    { user_id: USER.id, delta: 200000, bucket: "topup", reason: "topup", ref: "txn_pack_old" },
  ] });
  await webhook(handle, { event_id: "evt_r", event_type: "transaction.completed", data: { id: "txn_renew", custom_data: { user_id: USER.id }, items: [{ price: { id: "pri_high" } }] } });
  const ledger = db.rows("credit_ledger");
  assert.equal(ledger.some((r) => r.reason === "expiry"), false);
  assert.equal(sum(ledger, "plan"), 900000, "new month plus the unexpired previous grant");
  assert.equal(sum(ledger, "topup"), 200000, "top-up is untouched");

  await webhook(handle, { event_id: "evt_p", event_type: "transaction.completed", data: { id: "txn_pack", custom_data: { user_id: USER.id }, items: [{ price: { id: "pri_pack" }, quantity: 2 }] } });
  assert.equal(sum(db.rows("credit_ledger"), "topup"), 1200000);
});

Deno.test("billing: events without a user or with an unknown price are acknowledged and ignored", async () => {
  const { db, handle } = world();
  const r1 = await (await webhook(handle, { event_id: "e1", event_type: "subscription.updated", data: { id: "sub_x", status: "active", items: [{ price: { id: "pri_high" } }] } })).json();
  assert.match(r1.ignored, /user_id/);
  const r2 = await (await webhook(handle, subEvent("e2", "active", "pri_unknown"))).json();
  assert.match(r2.ignored, /unknown price/);
  assert.equal(db.rows("subscriptions").length, 0);
});

Deno.test("billing: catalog lists prices, tokens and what is on sale", async () => {
  const { handle } = world();
  const res = await handle(post("billing", { action: "catalog" }));
  assert.equal(res.status, 200);
  const c = await res.json();
  assert.equal(c.currency, "EUR");
  assert.deepEqual(c.plans.map((p: Row) => [p.id, p.price, p.tokens, p.available]), [["flash", 4.99, 100000, true], ["high", 9.99, 300000, true], ["knight", 19.99, 1000000, false]]);
  assert.deepEqual(c.plans.map((p: Row) => [p.yearlyPrice, p.yearlyAvailable]), [[99.9, false], [95.9, true], [999.9, false]]);
  assert.equal(c.packs[0].id, "pack-500k");
  assert.equal(c.trial.days, 7);
});

Deno.test("billing: user actions need a session", async () => {
  assert.equal((await world({ user: null }).handle(post("billing", { action: "status" }))).status, 401);
  assert.equal((await world().handle(post("billing", "{"))).status, 400);
  assert.equal((await world().handle(post("billing", { action: "nope" }))).status, 400);
});

Deno.test("billing: checkout creates a Paddle transaction with the user id", async () => {
  const { handle, calls } = world();
  const res = await handle(post("billing", { action: "checkout", plan: "high" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, "https://pay.example/checkout?_ptxn=txn_1");
  assert.equal(calls[0].url, "https://sandbox-api.paddle.test/transactions");
  assert.equal(calls[0].auth, "Bearer pdl_test_key");
  assert.deepEqual(calls[0].body, { items: [{ price_id: "pri_high", quantity: 1 }], custom_data: { user_id: USER.id } });
  const pack = await handle(post("billing", { action: "checkout", pack: "pack-500k" }));
  assert.equal(pack.status, 200);
  // knight has no Paddle price yet
  const knight = await handle(post("billing", { action: "checkout", plan: "knight" }));
  assert.equal(knight.status, 409);
  assert.equal((await knight.json()).code, "not_available");
  assert.equal((await handle(post("billing", { action: "checkout", plan: "gold" }))).status, 400);
  const noKey = world({ apiKey: "" });
  const r = await noKey.handle(post("billing", { action: "checkout", plan: "high" }));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "not_configured");
});

Deno.test("billing: trial once — plan high for 7 days with a grant; expires lazily", async () => {
  const { db, handle } = world();
  const st0 = await (await handle(post("billing", { action: "status" }))).json();
  assert.equal(st0.trialAvailable, true);
  assert.equal(st0.plan, "free");
  const st = await (await handle(post("billing", { action: "trial" }))).json();
  assert.equal(st.plan, "high");
  assert.equal(st.subscription.provider, "trial");
  assert.equal(st.subscription.endsAt, "2026-10-17T12:00:00.000Z");
  assert.equal(st.balance.plan, 150000);
  assert.equal(st.trialAvailable, false);
  const again = await handle(post("billing", { action: "trial" }));
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, "trial_used");

  // eight days later
  const later = createBillingHandler({ ...fakeDeps(db), paddleApiKey: "k", paddleWebhookSecret: SECRET, paddleApiBase: "x", fetch: globalThis.fetch, now: () => new Date("2026-10-18T12:00:00Z") });
  const expired = await (await later(post("billing", { action: "status" }))).json();
  assert.equal(expired.plan, "free");
  assert.equal(expired.subscription, null);
  assert.equal(expired.balance.plan, 0);
  assert.equal(db.rows("profiles")[0].plan, "free");
});

Deno.test("billing: status shows balances by bucket, renewal and recent usage", async () => {
  const { handle } = world({
    plan: "high",
    subs: [{ id: "s1", user_id: USER.id, provider: "paddle", provider_ref: "sub_1", customer_ref: "ctm_1", tier: "high", status: "active", period_end: "2026-11-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z" }],
    ledger: [{ user_id: USER.id, delta: 1000000, bucket: "plan", reason: "plan_grant", ref: "t" }, { user_id: USER.id, delta: -6000, bucket: "plan", reason: "ai_fix", ref: "u" }, { user_id: USER.id, delta: 500000, bucket: "topup", reason: "topup", ref: "p" }],
  });
  const st = await (await handle(post("billing", { action: "status" }))).json();
  assert.deepEqual(st.balance, { plan: 994000, topup: 500000, total: 1494000, available: 1494000 });
  assert.equal(st.subscription.renewsAt, "2026-11-10T00:00:00Z");
  assert.equal(st.subscription.manageable, true);
  assert.equal(st.trialAvailable, false, "a paying customer gets no trial");
  assert.equal(st.usage[0].tokens, 6000);
});

Deno.test("billing: portal needs a Paddle customer", async () => {
  const none = world();
  const r = await none.handle(post("billing", { action: "portal" }));
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, "no_subscription");
  const w = world({ subs: [{ id: "s1", user_id: USER.id, provider: "paddle", provider_ref: "sub_1", customer_ref: "ctm_1", tier: "high", status: "active", updated_at: "2026-10-10T00:00:00Z" }] });
  const ok = await w.handle(post("billing", { action: "portal" }));
  assert.equal((await ok.json()).url, "https://customer-portal.paddle.com/x");
  assert.equal(w.calls[0].url, "https://sandbox-api.paddle.test/customers/ctm_1/portal-sessions");
});

Deno.test("billing: an approved refund takes back what is left of the transaction's grant, once", async () => {
  const { db, handle } = world({ ledger: [
    { user_id: USER.id, delta: 500000, bucket: "topup", reason: "topup", ref: "txn_pack" },
    { user_id: USER.id, delta: -200000, bucket: "topup", reason: "ai_fix", ref: "u1" },
  ] });
  const refund = { event_id: "evt_ref", event_type: "adjustment.updated", data: { id: "adj_1", action: "refund", status: "approved", transaction_id: "txn_pack" } };
  const r = await (await webhook(handle, refund)).json();
  assert.deepEqual(r.taken, [{ tokens: 300000 }]);
  assert.equal(sum(db.rows("credit_ledger"), "topup"), 0);
  await webhook(handle, { ...refund, event_id: "evt_ref2" });
  assert.equal(db.rows("credit_ledger").filter((x) => x.reason === "grant_refund").length, 1, "same adjustment is not applied twice");
  // a pending refund changes nothing
  const pending = await (await webhook(handle, { event_id: "evt_p", event_type: "adjustment.created", data: { id: "adj_2", action: "refund", status: "pending_approval", transaction_id: "txn_pack" } })).json();
  assert.equal(pending.ignored, true);
});

Deno.test("billing: yearly checkout uses the yearly price", async () => {
  const { handle, calls } = world();
  assert.equal((await handle(post("billing", { action: "checkout", plan: "high", interval: "year" }))).status, 200);
  assert.equal(calls[0].body.items[0].price_id, "pri_high_year");
  const flash = await handle(post("billing", { action: "checkout", plan: "flash", interval: "year" }));
  assert.equal(flash.status, 409, "no yearly price for flash yet");
});

Deno.test("billing: a yearly plan grants the monthly tokens every month, once each", async () => {
  const { db, handle } = world();
  const yearSub = subEvent("evt_y", "active", "pri_high_year", { billing_cycle: { interval: "year", frequency: 1 }, current_billing_period: { starts_at: "2026-10-10T00:00:00Z", ends_at: "2027-10-10T00:00:00Z" } });
  await webhook(handle, yearSub);
  await webhook(handle, { event_id: "evt_yt", event_type: "transaction.completed", data: { id: "txn_year", custom_data: { user_id: USER.id }, items: [{ price: { id: "pri_high_year" } }] } });
  assert.equal(sum(db.rows("credit_ledger"), "plan"), 300000, "month 0 with the payment");

  const at = (iso: string) => createBillingHandler({ ...fakeDeps(db), paddleApiKey: "k", paddleWebhookSecret: SECRET, paddleApiBase: "x", fetch: globalThis.fetch, now: () => new Date(iso) });
  const st0 = await (await at("2026-10-25T00:00:00Z")(post("billing", { action: "status" }))).json();
  assert.equal(st0.subscription.interval, "year");
  assert.equal(db.rows("credit_ledger").filter((r) => r.reason === "plan_grant").length, 1, "still month 0");

  await at("2026-11-12T00:00:00Z")(post("billing", { action: "status" }));
  await at("2026-11-20T00:00:00Z")(post("billing", { action: "status" }));
  const grants = db.rows("credit_ledger").filter((r) => r.reason === "plan_grant");
  assert.deepEqual(grants.map((r) => r.ref), ["txn_year", "txn_year:m1"], "month 1 granted once");
  assert.equal(sum(db.rows("credit_ledger"), "plan"), 600000, "both High grants remain valid for three months");

  await at("2027-12-01T00:00:00Z")(post("billing", { action: "status" }));
  assert.equal(db.rows("credit_ledger").filter((r) => r.reason === "plan_grant").length, 12, "all twelve paid slices accrue even if the app stayed closed");
});

// ---------------------------------------------------------------- audit batch 2 (C4–C6, C12)

Deno.test("billing: an older subscription event does not undo a newer one", async () => {
  const { db, handle } = world();
  await webhook(handle, { ...subEvent("evt_new", "active"), occurred_at: "2026-10-10T12:00:00Z" });
  const late = await (await webhook(handle, { ...subEvent("evt_old", "canceled"), occurred_at: "2026-10-01T12:00:00Z" })).json();
  assert.match(late.ignored, /older/);
  assert.equal(db.rows("subscriptions")[0].status, "active");
  assert.equal(db.rows("profiles")[0].plan, "high");
});

Deno.test("billing: a failed write is a 500, and Paddle's retry processes the event again", async () => {
  const { db, handle } = world();
  const txn = { event_id: "evt_f", event_type: "transaction.completed", data: { id: "txn_f", custom_data: { user_id: USER.id }, items: [{ price: { id: "pri_pack" } }] } };
  db.writeFailures.credit_ledger = { message: "disk full" };
  const res = await webhook(handle, txn);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "internal error", code: "internal" }, "no database details leak");
  assert.equal(db.rows("billing_events").length, 0, "the claim is removed");
  delete db.writeFailures.credit_ledger;
  assert.equal((await webhook(handle, txn)).status, 200);
  assert.equal(sum(db.rows("credit_ledger"), "topup"), 500000);
});

Deno.test("billing: two deliveries of one transaction at the same time grant once", async () => {
  const { db, handle } = world();
  const txn = (id: string) => ({ event_id: id, event_type: "transaction.completed", data: { id: "txn_c", custom_data: { user_id: USER.id }, items: [{ price: { id: "pri_high" } }] } });
  await Promise.all([webhook(handle, txn("evt_c1")), webhook(handle, txn("evt_c2")), webhook(handle, txn("evt_c1"))]);
  assert.equal(sum(db.rows("credit_ledger")), 300000);
});

Deno.test("billing: a proration charge on a plan change does not buy a new month", async () => {
  const { db, handle } = world();
  const r = await (await webhook(handle, { event_id: "evt_pr", event_type: "transaction.completed", data: { id: "txn_pr", origin: "subscription_update", custom_data: { user_id: USER.id }, items: [{ price: { id: "pri_high" } }] } })).json();
  assert.match(r.ignored, /origin/);
  assert.equal(db.rows("credit_ledger").length, 0);
});

Deno.test("billing: a partial refund takes back its share of the grant", async () => {
  const { db, handle } = world();
  await webhook(handle, { event_id: "evt_pk", event_type: "transaction.completed", data: { id: "txn_pk", custom_data: { user_id: USER.id }, details: { totals: { total: "1000" } }, items: [{ price: { id: "pri_pack" } }] } });
  const r = await (await webhook(handle, { event_id: "evt_half", event_type: "adjustment.updated", data: { id: "adj_h", action: "refund", status: "approved", transaction_id: "txn_pk", totals: { total: "500" } } })).json();
  assert.equal(r.share, 0.5);
  assert.equal(sum(db.rows("credit_ledger"), "topup"), 250000);
});

Deno.test("billing: one trial per e-mail, even after the account is deleted and created again", async () => {
  const { db, handle } = world();
  assert.equal((await handle(post("billing", { action: "trial" }))).status, 200);
  await db.auth.admin.deleteUser(USER.id);
  // same address, new account
  const again: AuthUser = { id: "u-2", email: "Ivan@Example.com" };
  db.user = again;
  db.tables.profiles.push({ user_id: again.id, email: again.email, role: "normal", plan: "free" });
  const st = await (await handle(post("billing", { action: "status" }))).json();
  assert.equal(st.trialAvailable, false);
  const res = await handle(post("billing", { action: "trial" }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "trial_used");
  assert.equal(db.rows("trial_claims").length, 1);
  assert.ok(!JSON.stringify(db.rows("trial_claims")).includes("example.com"), "only a hash is stored");
});

Deno.test("billing: two trial requests at once start one trial", async () => {
  const { db, handle } = world();
  const rs = await Promise.all([handle(post("billing", { action: "trial" })), handle(post("billing", { action: "trial" }))]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(sum(db.rows("credit_ledger"), "plan"), 150000);
});

Deno.test("billing: several subscription items — the highest plan decides", async () => {
  const { db, handle } = world();
  const ev = subEvent("evt_multi", "active", "pri_flash", { items: [{ price: { id: "pri_flash" } }, { price: { id: "pri_high" } }] });
  await webhook(handle, ev);
  assert.equal(db.rows("subscriptions")[0].tier, "high");
  assert.equal(db.rows("profiles")[0].plan, "high");
});

Deno.test("billing: a plan an admin granted by hand survives a cancelled Paddle subscription", async () => {
  const { db, handle } = world({ subs: [{ id: "m1", user_id: USER.id, provider: "manual", tier: "knight", status: "active", period_end: null }] });
  await webhook(handle, { ...subEvent("evt_a", "active"), occurred_at: "2026-10-01T00:00:00Z" });
  await webhook(handle, { ...subEvent("evt_c", "canceled"), occurred_at: "2026-10-02T00:00:00Z" });
  assert.equal(db.rows("profiles")[0].plan, "knight");
});

// ---------------------------------------------------------------- V11 RC: usage, sync

Deno.test("billing: usage is server-authoritative — period, included / used / reserved / remaining, purchased apart, limits, pricing version, history", async () => {
  const { db, handle } = world({
    plan: "high",
    subs: [{ id: "s1", user_id: USER.id, provider: "paddle", provider_ref: "sub_1", customer_ref: "ctm_1", tier: "high", status: "active", period_start: "2026-10-10T00:00:00Z", period_end: "2026-11-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z" }],
    ledger: [
      { id: "l1", user_id: USER.id, delta: 1000000, bucket: "plan", reason: "plan_grant", ref: "sub_1:m0", created_at: "2026-10-10T00:00:01Z" },
      { id: "l2", user_id: USER.id, delta: 500000, bucket: "topup", reason: "topup", ref: "txn_9", created_at: "2026-10-10T00:00:02Z" },
      { id: "l3", user_id: USER.id, delta: -6000, bucket: "plan", reason: "ai_fix", ref: "u1", pricing_version: "p-old", created_at: "2026-10-12T10:00:00Z" },
      { id: "l4", user_id: USER.id, delta: -30000, bucket: "hold", reason: "hold", ref: "u-live", created_at: "2026-10-15T11:59:00Z" },
      { id: "l5", user_id: USER.id, delta: -30000, bucket: "hold", reason: "hold", ref: "u-dead", created_at: "2026-10-15T10:00:00Z" },
    ],
    now: new Date("2026-10-15T12:00:00Z"),
  });
  db.tables.ai_usage = [
    { id: "u1", user_id: USER.id, created_at: "2026-10-12T10:00:00Z", step: "build", model: "claude-sonnet-5", charged_tokens: 6000, status: "ok", project_key: "p1", pricing_version: "p-old" },
    { id: "u0", user_id: USER.id, created_at: "2026-10-01T10:00:00Z", step: "build", model: "claude-sonnet-5", charged_tokens: 999, status: "ok", project_key: "p1" },
    { id: "u-live", user_id: USER.id, created_at: "2026-10-15T11:59:00Z", step: "lint", status: "pending", charged_tokens: 0 },
    { id: "u-dead", user_id: USER.id, created_at: "2026-10-15T10:00:00Z", step: "lint", status: "pending", charged_tokens: 0 },
  ];
  const res = await handle(post("billing", { action: "usage" }));
  assert.equal(res.status, 200);
  const u = await res.json();
  assert.equal(u.unit, "credits");
  assert.equal(u.plan, "high");
  assert.deepEqual(u.period, { start: "2026-10-10T00:00:00Z", end: "2026-11-10T00:00:00Z", renewsAt: "2026-11-10T00:00:00Z", source: "subscription" });
  assert.equal(u.included.tokens, 300000);
  assert.deepEqual(u.used, { tokens: 6000, operations: 1 }, "only settled charges inside the period; u0 is before it");
  assert.deepEqual(u.reserved, { tokens: 30000, operations: 1 }, "the live hold is reserved, the abandoned one was released");
  assert.equal(u.reconciled.releasedHolds, 1);
  assert.equal(db.rows("ai_usage").find((r) => r.id === "u-dead")?.status, "orphaned");
  assert.equal(db.rows("credit_ledger").filter((r) => r.reason === "hold").length, 1);
  assert.deepEqual(u.remaining, { plan: 994000, purchased: 500000, total: 1494000, available: 1464000 });
  assert.equal(u.purchased.tokens, 500000, "purchased packs are shown apart from the plan tokens");
  assert.equal(u.limits.perMinute, 6);
  // the 5-hour session: 20 % of 300 000 = 60 000; u1 (three days ago) is outside it, the live hold is not charged yet
  assert.equal(u.limits.sessionCap, 60000);
  assert.deepEqual(u.session, { windowHours: 5, capPercent: 20, cap: 60000, used: 0, remaining: 60000, resetsAt: "2026-10-15T16:59:00.000Z" });
  assert.deepEqual(u.byModel, [{ model: "claude-sonnet-5", tokens: 6000, operations: 1 }]);
  assert.match(u.pricing.version, /^p-[0-9a-f]{12}$/, "a hash of the price table when no explicit version is set");
  assert.deepEqual(u.pricing.spendOrder, ["plan", "topup"]);
  assert.equal(u.history.operations.length, 4);
  assert.equal(u.history.operations[0].id, "u-live");
  assert.equal(u.history.ledger.length, 4);
  assert.equal(u.history.ledger.find((l: Row) => l.ref === "u1").pricingVersion, "p-old");
  // an explicit pricing version setting wins
  db.tables.settings.push({ key: "pricing.version", value: "2026-10" });
  const u2 = await (await handle(post("billing", { action: "usage" }))).json();
  assert.equal(u2.pricing.version, "2026-10");
  // Free without a subscription: calendar period, nothing renews
  const free = world({ plan: "free", now: new Date("2026-10-15T12:00:00Z") });
  const f = await (await free.handle(post("billing", { action: "usage" }))).json();
  assert.deepEqual(f.period, { start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z", renewsAt: null, source: "calendar" });
  assert.equal(f.included.tokens, 0);
  assert.equal(f.limits.sessionCap, null);
  assert.equal(f.session, null);
});

Deno.test("billing: sync recovers a missed webhook from the provider's current subscription state", async () => {
  const w = world({
    plan: "high",
    subs: [{ id: "s1", user_id: USER.id, provider: "paddle", provider_ref: "sub_1", customer_ref: "ctm_1", tier: "high", status: "active", period_start: "2026-09-10T00:00:00Z", period_end: "2026-10-10T00:00:00Z", raw: { billing_cycle: { interval: "month" } }, updated_at: "2026-09-10T00:00:00Z" }],
    now: new Date("2026-10-15T12:00:00Z"),
  });
  const db = w.db;
  const remote: Row = { id: "sub_1", status: "active", current_billing_period: { starts_at: "2026-10-10T00:00:00Z", ends_at: "2026-11-10T00:00:00Z" }, billing_cycle: { interval: "month" }, items: [{ price: { id: "pri_flash" } }], scheduled_change: null };
  const handle = createBillingHandler({
    ...fakeDeps(db),
    paddleApiKey: "pdl_test_key",
    paddleWebhookSecret: SECRET,
    paddleApiBase: "https://sandbox-api.paddle.test",
    now: () => new Date("2026-10-15T12:00:00Z"),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      assert.equal(init?.method, "GET");
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer pdl_test_key");
      if (url.endsWith("/subscriptions/sub_1")) return Response.json({ data: remote });
      return Response.json({ error: { detail: "nope" } }, { status: 404 });
    }) as unknown as typeof globalThis.fetch,
  });
  const res = await handle(post("billing", { action: "sync" }));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.synced, ["sub_1"]);
  const s = db.rows("subscriptions")[0];
  assert.equal(s.period_end, "2026-11-10T00:00:00Z", "the new period arrived without a webhook");
  assert.equal(s.tier, "flash", "the plan changed at the provider");
  assert.equal(db.rows("profiles")[0].plan, "flash");
  assert.equal(j.status.subscription.renewsAt, "2026-11-10T00:00:00Z");
  // cancelled at the provider → cancel_at set, status carried over
  remote.status = "canceled";
  remote.canceled_at = "2026-10-14T00:00:00Z";
  const j2 = await (await handle(post("billing", { action: "sync" }))).json();
  assert.equal(db.rows("subscriptions")[0].status, "canceled");
  assert.equal(db.rows("subscriptions")[0].cancel_at, "2026-10-14T00:00:00Z");
  assert.equal(j2.status.subscription, null);
  // nothing to sync for a trial-only account
  const t = world({ plan: "high", subs: [{ id: "t1", user_id: USER.id, provider: "trial", tier: "high", status: "trial", period_end: "2026-10-20T00:00:00Z" }] });
  assert.deepEqual((await (await t.handle(post("billing", { action: "sync" }))).json()).synced, []);
});

Deno.test("billing (WP03): checkout is rate limited per user in the database; a missing function lets it through, a database error refuses", async () => {
  const { db, handle, calls } = world();
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await handle(post("billing", { action: "checkout", plan: "high" }))).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  assert.equal(calls.filter((c) => c.url.endsWith("/transactions")).length, 5, "the refused call never reached Paddle");
  const body = await (await handle(post("billing", { action: "portal" }))).json();
  assert.notEqual(body.code, "rate_limited", "other actions have their own counters");
  // schema not updated yet: the limiter is skipped (logged), not the checkout
  const w2 = world();
  w2.db.missingFunctions.push("bid_rate_hit");
  assert.equal((await w2.handle(post("billing", { action: "checkout", plan: "high" }))).status, 200);
  // a real database error: refuse rather than skip the limit
  const w3 = world();
  w3.db.rpcErrors.bid_rate_hit = { message: "connection reset", code: "08006" };
  const r3 = await w3.handle(post("billing", { action: "checkout", plan: "high" }));
  assert.equal(r3.status, 503);
  assert.equal((await r3.json()).code, "rate_limit_unavailable");
  assert.equal(w3.calls.length, 0);
  void db;
});

Deno.test("billing (WP04): the schema seed is the same catalog and plan credits as the function defaults", async () => {
  const { DEFAULT_CATALOG, DEFAULT_PLAN_TOKENS } = await import("./handler.ts");
  const sql = await Deno.readTextFile(new URL("../../schema.sql", import.meta.url));
  const seed = (key: string) => {
    const m = new RegExp(`\\('${key.replace(".", "\\.")}',\\s*'([\\s\\S]*?)'\\)`).exec(sql);
    assert.ok(m, `seed for ${key} in schema.sql`);
    return JSON.parse(m![1]);
  };
  assert.deepEqual(seed("billing.catalog"), DEFAULT_CATALOG);
  assert.deepEqual(seed("plans"), DEFAULT_PLAN_TOKENS);
});

Deno.test("billing: catalog is public and incomplete sales configuration is read-only", async () => {
  const w = world({ user: null, apiKey: "" });
  const response = await w.handle(post("billing", { action: "catalog" }));
  assert.equal(response.status, 200);
  const c = await response.json();
  assert.equal(c.source, "cloud");
  assert.ok(c.plans.every((p: Row) => !p.available && !p.yearlyAvailable));
  assert.equal(c.plans.find((p: Row) => p.id === "high").activeSites, 3);
  assert.ok(c.packs.every((p: Row) => !p.available));
  assert.equal(w.calls.length, 0);
});

Deno.test("billing: a migrated offer whose provider price differs cannot be sold", async () => {
  const w = world();
  w.db.tables.settings = [{ key: "billing.catalog", value: { ...CATALOG, packs: [{ ...CATALOG.packs[0], needsReconciliation: true }] } }];
  const c = await (await w.handle(post("billing", { action: "catalog" }))).json();
  assert.equal(c.packs[0].available, false);
  assert.equal((await w.handle(post("billing", { action: "checkout", pack: "pack-500k" }))).status, 409);
  assert.equal(w.calls.length, 0);
});

Deno.test("billing: engine, cloud and generated schema share the approved catalog", async () => {
  const { DEFAULT_CATALOG, DEFAULT_PLAN_TOKENS } = await import("./handler.ts");
  const { DEFAULTS } = await import("../ai-fix/handler.ts");
  const engine = JSON.parse(await Deno.readTextFile(new URL("../../../engine/src/plans-data.json", import.meta.url)));
  assert.deepEqual(engine, DEFAULT_CATALOG);
  assert.deepEqual(Object.fromEntries(Object.entries(DEFAULT_PLAN_TOKENS).map(([id,p]) => [id,p.tokens])), Object.fromEntries(Object.entries(DEFAULTS.plans).map(([id,p]) => [id,p.tokens])));
  assert.deepEqual(engine.packs.map((p: Row) => p.price), [4.99,19.99,39.99]);
});

Deno.test("billing: trial reports the actual gift and yearly usage is a calendar month slice", async () => {
  const trial = world();
  await trial.handle(post("billing", { action: "trial" }));
  const u = await (await trial.handle(post("billing", { action: "usage" }))).json();
  assert.equal(u.included.tokens, CATALOG.trial.tokens);
  assert.equal(u.session.cap, CATALOG.trial.tokens*0.2);
  const w = world({ plan: "high", now: new Date("2026-03-02T12:00:00Z"), subs: [{ id:"year",user_id:USER.id,provider:"paddle",provider_ref:"sub_year",tier:"high",status:"active",period_start:"2026-01-31T10:00:00Z",period_end:"2027-01-31T10:00:00Z",raw:{billing_cycle:{interval:"year"}} }] });
  w.db.tables.ai_usage = [
    { id:"old",user_id:USER.id,created_at:"2026-02-01T10:00:00Z",status:"ok",charged_tokens:2000 },
    { id:"current",user_id:USER.id,created_at:"2026-03-01T10:00:00Z",status:"ok",charged_tokens:3000 }
  ];
  const current = await (await w.handle(post("billing", { action:"usage" }))).json();
  assert.equal(current.period.start, "2026-02-28T10:00:00.000Z");
  assert.equal(current.period.end, "2026-03-31T10:00:00.000Z");
  assert.equal(current.used.tokens, 3000);
  assert.equal(current.remaining.available, (await (await w.handle(post("billing",{action:"status"}))).json()).balance.available);
});

Deno.test("billing: yearly month grants do not collide at the following year's renewal", async () => {
  const { ensureMonthlyGrant } = await import("../_shared/credits.ts");
  const w = world({ subs:[{id:"year",user_id:USER.id,provider:"paddle",provider_ref:"sub_year",tier:"high",status:"active",period_start:"2026-01-31T10:00:00Z",period_end:"2027-01-31T10:00:00Z",raw:{billing_cycle:{interval:"year"}}}] });
  assert.ok(await ensureMonthlyGrant(w.db,USER.id,{high:{tokens:300000}},new Date("2026-02-28T10:00:00Z")));
  assert.equal(await ensureMonthlyGrant(w.db,USER.id,{high:{tokens:300000}},new Date("2026-02-28T10:01:00Z")),null);
  w.db.tables.subscriptions[0].period_start="2027-01-31T10:00:00Z";
  w.db.tables.subscriptions[0].period_end="2028-01-31T10:00:00Z";
  assert.ok(await ensureMonthlyGrant(w.db,USER.id,{high:{tokens:300000}},new Date("2027-02-28T10:00:00Z")));
});

Deno.test("billing: checkout on an existing plan previews then confirms a PATCH, never another subscription", async () => {
  const w=world({plan:"flash",subs:[{id:"s1",user_id:USER.id,provider:"paddle",provider_ref:"sub_existing",tier:"flash",status:"active"}]});
  const calls: {url:string;method:string}[]=[];
  let remote:Row={id:"sub_existing",status:"active",items:[{price:{id:"pri_flash"},quantity:1}],current_billing_period:{starts_at:"2026-10-01T00:00:00Z",ends_at:"2026-11-01T00:00:00Z"}};
  const handle=createBillingHandler({...fakeDeps(w.db),paddleApiKey:"test",paddleWebhookSecret:SECRET,paddleApiBase:"https://sandbox-api.paddle.test",now:()=>NOW,fetch:(async(input,init)=>{
    const url=String(input);const method=init?.method ?? "GET";calls.push({url,method});
    if(url.endsWith("/preview")) return Response.json({data:{currency_code:"EUR",immediate_transaction:{details:{totals:{grand_total:"1200",currency_code:"EUR"}}},next_transaction:{details:{totals:{grand_total:"2999"}}}}});
    if(method === "PATCH") remote={...remote,items:[{price:{id:"pri_high"},quantity:1}]};
    return Response.json({data:remote});
  }) as typeof fetch});
  const first=await(await handle(post("billing",{action:"checkout",plan:"high"}))).json();
  assert.ok(first.preview?.id);
  assert.equal((await handle(post("billing",{action:"confirm-change",previewId:first.preview.id}))).status,200);
  assert.equal(calls.filter(c=>c.url.endsWith("/sub_existing") && c.method === "PATCH").length,1);
  assert.ok(calls.every(c=>!c.url.endsWith("/transactions")));
});

Deno.test("billing: canceling an old Paddle subscription retains another active paid plan",async()=>{
  const w=world({plan:"high",subs:[{id:"other",user_id:USER.id,provider:"paddle",provider_ref:"sub_keep",tier:"high",status:"active",period_end:"2026-11-10T00:00:00Z"}]});
  const r=await(await webhook(w.handle,subEvent("cancel_old","canceled","pri_flash"))).json();
  assert.equal(r.plan,"high");
  assert.equal(w.db.rows("profiles")[0].plan,"high");
});

Deno.test("billing V12: usage v2 is an authenticated SQL receipt; ETag skips unchanged content",async()=>{
  const w=world({plan:"high"});
  const receipt={v:2,unit:"credits",serverTime:NOW.toISOString(),plan:"high",period:{used:1234},remaining:{available:28766},windows:{session:{used:1234,cap:60000}},pricing:{version:"2026-10"},sites:{active:1,limit:3},byAction:[{action:"ai.chat",credits:1234,count:1}]};
  w.db.rpcResponses.bid_usage_summary=receipt;
  const res=await w.handle(post("billing",{action:"usage",v:2}));assert.equal(res.status,200);
  const payload=await res.json(); assert.equal(payload.remaining.available,28766);assert.deepEqual(payload.byAction,receipt.byAction);
  assert.deepEqual(w.db.rpcCalls.find(c=>c.fn==="bid_usage_summary")?.args,{p_user:USER.id,p_now:NOW.toISOString()});
  const tag=res.headers.get("etag");assert.ok(tag);
  const req=post("billing",{action:"usage",v:2});req.headers.set("if-none-match",tag);
  assert.equal((await w.handle(req.clone())).status,304);
  w.db.rpcResponses.bid_usage_summary={...receipt,remaining:{available:28000}};
  const changed=await w.handle(req);assert.equal(changed.status,200);assert.notEqual(changed.headers.get("etag"),tag);
  w.db.missingFunctions=["bid_usage_summary"];
  const unavailable=await w.handle(post("billing",{action:"usage",v:2}));assert.equal(unavailable.status,503);
  assert.equal((await unavailable.json()).code,"meter_unavailable");
});
