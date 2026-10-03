// deno test supabase/functions   (no network: the database and the model are fakes)
import assert from "node:assert/strict";
import type { AuthUser, Row } from "../_shared/db.ts";
import { FakeDb, fakeDeps, post, sseEvents } from "../_shared/fake_supabase.ts";
import { createAiFixHandler, creditsFor, DEFAULTS, type Plan, type Role } from "./handler.ts";

/** What the fake stream (4000 in / 2000 out, reported as Sonnet 5.5) costs on a plan. */
const charge = (plan: string, model = "claude-sonnet-5-5", input = 4000, output = 2000) => creditsFor(DEFAULTS, plan, model, input, output).credits;

const USER: AuthUser = { id: "u-1", email: "ivan@example.com" };
const PROMPT = { prompt: "Build failed:\nTypeError: x is not a function", step: "build", project: { key: "p1", framework: "vite" }, mode: "fix" };

function anthropicSse(events: Row[]): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

const OK_STREAM = anthropicSse([
  { type: "message_start", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 4000, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
  { type: "ping" },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2000 } },
  { type: "message_stop" },
]);

interface UpstreamOpts {
  status?: number;
  body?: string;
  throws?: boolean;
  /** The model does not answer until this resolves (lets a test line requests up before any of them settles). */
  holdUntil?: Promise<void>;
}

function fakeAnthropic(opts: UpstreamOpts = {}) {
  const calls: { url: string; headers: Record<string, string>; body: Row; signal?: AbortSignal | null }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)), signal: init?.signal });
    if (opts.throws) throw new TypeError("connection refused");
    if (opts.holdUntil) await opts.holdUntil;
    return new Response(opts.body ?? OK_STREAM, { status: opts.status ?? 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

interface WorldOpts {
  role?: Role;
  plan?: Plan;
  balance?: number;
  usage?: Row[];
  settings?: Row[];
  aiDisabled?: boolean;
  user?: AuthUser | null;
  noProfile?: boolean;
  upstream?: UpstreamOpts;
  key?: string;
  ledger?: Row[];
  subs?: Row[];
}

function world(o: WorldOpts = {}) {
  const db = new FakeDb({
    profiles: o.noProfile ? [] : [{ user_id: USER.id, email: USER.email, role: o.role ?? "normal", plan: o.plan ?? "high", ai_disabled: !!o.aiDisabled }],
    ai_usage: o.usage ?? [],
    credit_ledger: o.ledger ?? [{ user_id: USER.id, delta: o.balance ?? 100000, bucket: "plan", reason: "plan_grant", ref: "t0" }],
    settings: o.settings ?? [],
    subscriptions: o.subs ?? [],
  }, o.user === undefined ? USER : o.user);
  const up = fakeAnthropic(o.upstream);
  const handle = createAiFixHandler({ ...fakeDeps(db), anthropicKey: o.key ?? "sk-ant-test", anthropicBase: "https://anthropic.local", fetch: up.fetch });
  return { db, handle, up };
}

async function events(res: Response) {
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  return sseEvents(await res.text());
}

Deno.test("ai-fix: 500 when the central key is missing", async () => {
  const { handle } = world({ key: "" });
  const res = await handle(post("ai-fix", PROMPT));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).code, "not_configured");
});

Deno.test("ai-fix: 400 without a prompt, 401 without a session", async () => {
  const { handle } = world();
  assert.equal((await handle(post("ai-fix", { prompt: "   " }))).status, 400);
  assert.equal((await handle(post("ai-fix", "nope"))).status, 400);
  assert.equal((await handle(post("ai-fix", PROMPT, null))).status, 401);
  const anon = world({ user: null });
  assert.equal((await anon.handle(post("ai-fix", PROMPT))).status, 401);
});

Deno.test("ai-fix: 403 no_profile / disabled / no_plan", async () => {
  let res = await world({ noProfile: true }).handle(post("ai-fix", PROMPT));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "no_profile");
  res = await world({ aiDisabled: true }).handle(post("ai-fix", PROMPT));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "disabled");
  res = await world({ plan: "free", balance:0 }).handle(post("ai-fix", PROMPT));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "no_plan");
  // vip on the free plan is fine (own key or cloud — the cloud path is allowed by role)
  const vip = world({ role: "vip", plan: "free" });
  assert.equal((await vip.handle(post("ai-fix", PROMPT))).status, 200);
});

Deno.test("ai-fix: 402 quota_exhausted with the renewal date", async () => {
  const { handle, up } = world({ balance: 0 });
  const res = await handle(post("ai-fix", PROMPT));
  assert.equal(res.status, 402);
  const j = await res.json();
  assert.equal(j.code, "quota_exhausted");
  assert.match(j.renewsAt, /^\d{4}-\d{2}-01T00:00:00/);
  assert.equal(up.calls.length, 0);
});

Deno.test("ai-fix: 429 after 6 requests in a minute", async () => {
  const recent = new Date(Date.now() - 10_000).toISOString();
  const usage = Array.from({ length: 6 }, () => ({ user_id: USER.id, created_at: recent, charged_tokens: 10 }));
  const res = await world({ usage }).handle(post("ai-fix", PROMPT));
  assert.equal(res.status, 429);
  assert.equal((await res.json()).code, "rate_limited");
  // a stranger's usage does not count
  const other = usage.map((u) => ({ ...u, user_id: "u-other" }));
  assert.equal((await world({ usage: other }).handle(post("ai-fix", PROMPT))).status, 200);
});

Deno.test("ai-fix: a V3 refusal (release / 24 h guard) is a 403 with the reason and the time the task can start", async () => {
  // The rules themselves are proved in SQL (tests/rls/credits-v13.mjs); the function relays the receipt untouched
  // and keeps no model call or usage row behind.
  for (const [code, reason] of [["credits_release", "release"], ["guard_24h", "guard24h"], ["guard_7d", "guard7d"], ["pack_rate", "packRate"]]) {
    const w = world();
    w.db.rpcResponses.bid_hold = { ok: false, code, reason, readyAt: "2026-10-02T14:30:00Z", resetsAt: "2026-10-02T14:30:00Z", availableNow: 120 };
    const res = await w.handle(post("ai-fix", PROMPT));
    assert.equal(res.status, 403);
    const j = await res.json();
    assert.equal(j.code, code); assert.equal(j.reason, reason); assert.equal(j.readyAt, "2026-10-02T14:30:00Z");
    assert.equal(w.up.calls.length, 0, "no model call");
    assert.equal(w.db.rows("ai_usage").length, 0, "the pending usage row is removed");
  }
  // the 5 h session window is gone: heavy recent usage alone does not refuse a request
  const usage = [{ user_id: USER.id, created_at: new Date(Date.now() - 2 * 3600_000).toISOString(), charged_tokens: 60000 }];
  assert.equal((await world({ usage }).handle(post("ai-fix", PROMPT))).status, 200);
});

Deno.test("ai-fix: credits follow the model's real price and the shared V2 rate, so the owner's cap holds", () => {
  // one typical fix on High (Opus 5.5, 4 $ / 20 $ per MTok): 0.048 $ → 0.04416 € → 1767 credits at 0.000025 €
  const high = creditsFor(DEFAULTS, "high", "claude-opus-5-5", 4500, 1500);
  assert.ok(Math.abs(high.costUsd - 0.048) < 1e-9);
  assert.equal(high.credits, 1767);
  // Flash pays Sonnet 5.5 prices at the shared rate: 0.024 $ → 0.02208 € → 884 credits at 0.000025 €
  assert.equal(creditsFor(DEFAULTS, "flash", "claude-sonnet-5-5", 4500, 1500).credits, 884);
  // the whole monthly grant can never cost more than the cap (catalog v13): Free 10 000 × 0.000025 = 0.25 €,
  // Flash 40 000 = 1.00 €, High 100 000 = 2.50 €, Knight 800 000 = 20 €
  for (const [plan, cap] of [["free", 0.25], ["flash", 1], ["high", 2.5], ["knight", 20]] as const) {
    assert.ok(Math.abs(DEFAULTS.plans[plan].tokens * Number(DEFAULTS["ai.creditEur"]) - cap) < 1e-6, plan);
  }
  // an answer that produced nothing costs nothing; anything that reached the model costs at least one credit
  assert.equal(creditsFor(DEFAULTS, "high", "claude-opus-5-5", 0, 0).credits, 0);
  assert.equal(creditsFor(DEFAULTS, "high", "claude-opus-5-5", 1, 0).credits, 1);
});

Deno.test("ai-fix: 413 for an oversized prompt", async () => {
  const res = await world().handle(post("ai-fix", { ...PROMPT, prompt: "x".repeat(68001) }));
  assert.equal(res.status, 413);
  assert.equal((await res.json()).code, "prompt_too_long");
  // the system prompt counts too (audit C1)
  const sys = await world().handle(post("ai-fix", { ...PROMPT, prompt: "x".repeat(50000), system: "y".repeat(20000) }));
  assert.equal(sys.status, 413);
});

Deno.test("ai-fix: streams deltas, bills the real tokens and records usage", async () => {
  const { db, handle, up } = world();
  const ev = await events(await handle(post("ai-fix", PROMPT)));
  assert.equal(ev.filter((e) => e.type === "delta").map((e) => e.text).join(""), "Hello world");
  const usage = ev.find((e) => e.type === "usage")!;
  assert.equal(usage.input, 4000);
  assert.equal(usage.output, 2000);
  assert.equal(usage.charged, charge("high"));
  assert.equal(usage.balance, 100000 - charge("high"));
  assert.equal(usage.model, "claude-sonnet-5-5");
  assert.equal(usage.status, "ok");
  assert.deepEqual(ev.at(-1), { type: "done", stopReason: "ok" });

  const rows = db.rows("ai_usage");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, USER.id);
  assert.equal(rows[0].project_key, "p1");
  assert.equal(rows[0].step, "build");
  assert.equal(rows[0].input_tokens, 4000);
  assert.equal(rows[0].output_tokens, 2000);
  assert.equal(rows[0].charged_tokens, charge("high"));
  assert.equal(rows[0].charged_tokens, 1031); // 0.028 $ × 0.92 / 0.000025 €, rounded up
  assert.ok(Math.abs(rows[0].cost_usd - 0.028) < 1e-9);
  const ledger = db.rows("credit_ledger").filter((r) => r.reason === "action");
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].delta, -charge("high"));
  assert.equal(ledger[0].bucket, "plan");
  assert.equal(ledger[0].ref, rows[0].id);

  assert.equal(up.calls.length, 1);
  assert.equal(up.calls[0].url, "https://anthropic.local/v1/messages");
  assert.equal(up.calls[0].headers["x-api-key"], "sk-ant-test");
  assert.equal(up.calls[0].body.model, "claude-opus-5-5");
  assert.equal(up.calls[0].body.max_tokens, 8000);
  assert.equal(up.calls[0].body.stream, true);
  assert.deepEqual(up.calls[0].body.output_config, { effort: "medium" });
  assert.equal(up.calls[0].body.messages[0].content, PROMPT.prompt);
});

Deno.test("ai-fix: deep fix uses the strongest model at xhigh effort for Knight, is ignored for High; credits follow the model that answered", async () => {
  const knight = world({ plan: "knight" });
  const ev = await events(await knight.handle(post("ai-fix", { ...PROMPT, deep: true })));
  assert.equal(knight.up.calls[0].body.model, "claude-opus-5-5");
  assert.deepEqual(knight.up.calls[0].body.output_config, { effort: "xhigh" });
  // the fake stream reports Sonnet 5.5 as the model that answered, so that is what is charged
  assert.equal(ev.find((e) => e.type === "usage")!.charged, charge("knight"));
  assert.equal(knight.db.rows("credit_ledger").find((r) => r.reason === "action")!.delta, -charge("knight"));

  const high = world({ plan: "high" });
  await events(await high.handle(post("ai-fix", { ...PROMPT, deep: true })));
  assert.equal(high.up.calls[0].body.model, "claude-opus-5-5");
  assert.deepEqual(high.up.calls[0].body.output_config, { effort: "medium" });
  assert.equal(high.db.rows("credit_ledger").find((r) => r.reason === "action")!.delta, -charge("high"));
});

Deno.test("ai-fix: explain mode takes the fast model without output_config", async () => {
  const w = world({ plan: "knight" });
  await events(await w.handle(post("ai-fix", { ...PROMPT, mode: "explain" })));
  assert.equal(w.up.calls[0].body.model, "claude-haiku-4-5");
  assert.equal(w.up.calls[0].body.max_tokens, 1500);
  assert.equal(w.up.calls[0].body.output_config, undefined);
});

Deno.test("ai-fix: the settings table overrides models, multipliers and limits", async () => {
  const settings = [
    { key: "ai.models", value: { flash: "claude-haiku-4-5", high: "claude-opus-5-5", knight: "claude-opus-5-5", deep: "claude-opus-5-5" } },
    { key: "ai.creditEur", value: { default: 0.000025, knight: 0.00005 } },
    { key: "ai.rate", value: { perMinute: 1, perHour: 60 } },
  ];
  const w = world({ plan: "high", settings });
  await events(await w.handle(post("ai-fix", PROMPT)));
  assert.equal(w.up.calls[0].body.model, "claude-opus-5-5");
  // perMinute: 1 → the second request is rate limited
  assert.equal((await w.handle(post("ai-fix", PROMPT))).status, 429);

  const k = world({ plan: "knight", settings });
  await events(await k.handle(post("ai-fix", { ...PROMPT, deep: true })));
  // a Knight credit worth twice as much → half the credits for the same answer
  const halved = creditsFor({ ...DEFAULTS, "ai.creditEur": { default: 0.000025, knight: 0.00005 } }, "knight", "claude-sonnet-5-5", 4000, 2000).credits;
  assert.equal(halved, Math.ceil(charge("knight") / 2));
  assert.equal(k.db.rows("credit_ledger").find((r) => r.reason === "action")!.delta, -halved);
});

Deno.test("ai-fix: an upstream failure is a 502 and bills nothing", async () => {
  const w = world({ upstream: { status: 529, body: '{"type":"error","error":{"type":"overloaded_error"}}' } });
  const res = await w.handle(post("ai-fix", PROMPT));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, "upstream");
  assert.equal(w.db.rows("ai_usage").length, 0);
  const n = world({ upstream: { throws: true } });
  assert.equal((await n.handle(post("ai-fix", PROMPT))).status, 502);
});

Deno.test("ai-fix: a model error mid-stream is forwarded and recorded", async () => {
  const body = anthropicSse([
    { type: "message_start", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 100 } } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
    { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
  ]);
  const w = world({ upstream: { body } });
  const ev = await events(await w.handle(post("ai-fix", PROMPT)));
  // the upstream text stays in the server log; the client gets a stable code
  assert.equal(ev.find((e) => e.type === "error")!.code, "model_error");
  assert.equal(ev.find((e) => e.type === "usage")!.status, "error");
  assert.equal(w.db.rows("ai_usage")[0].status, "error");
  // no final output count: the 7 streamed characters are billed as an estimate (⌈7 / 3.5⌉ = 2 tokens) at the model's price
  assert.equal(w.db.rows("ai_usage")[0].charged_tokens, charge("high", "claude-sonnet-5-5", 100, 2));
});

Deno.test("ai-fix: truncated and refused answers are marked", async () => {
  const body = anthropicSse([
    { type: "message_start", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 10 } } },
    { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 8000 } },
  ]);
  const w = world({ upstream: { body } });
  const ev = await events(await w.handle(post("ai-fix", PROMPT)));
  assert.deepEqual(ev.at(-1), { type: "done", stopReason: "truncated" });
});

Deno.test("ai-fix: plan tokens are spent first, the rest comes from top-up packs", async () => {
  const w = world({ ledger: [
    { user_id: USER.id, delta: 500, bucket: "plan", reason: "plan_grant", ref: "t" },
    { user_id: USER.id, delta: 10000, bucket: "topup", reason: "topup", ref: "p" },
  ] });
  await events(await w.handle(post("ai-fix", PROMPT)));
  const charges = w.db.rows("credit_ledger").filter((r) => r.reason === "action");
  assert.deepEqual(charges.map((r) => [r.bucket, r.delta]), [["plan", -500], ["topup", -(charge("high") - 500)]]);
});

// ---------------------------------------------------------------- audit batch 2 (C1, C6, C9, C10)

Deno.test("ai-fix: parallel requests see each other's reservations and cannot all overspend", async () => {
  // each request reserves ≈ 5,900 credits (prompt estimate + a full 8,000-token Opus answer); the model is
  // held back until all three have made their reservation, so with 6,000 left the third one always sees
  // the two other holds and is refused — no settle can sneak in between (that is the race the hold prevents)
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const { db, handle, up } = world({ balance: 6000, upstream: { holdUntil: gate } });
  const pending = [1, 2, 3].map(() => handle(post("ai-fix", PROMPT)));
  await new Promise((r) => setTimeout(r, 50));
  open();
  const rs = await Promise.all(pending);
  const passed = rs.filter((r) => r.status === 200);
  assert.ok(passed.length < 3, `at most two of three get through (got ${passed.length})`);
  assert.ok(rs.every((r) => r.status === 200 || r.status === 402));
  for (const r of rs) await r.text();
  assert.equal(up.calls.length, passed.length);
  assert.equal(db.rows("credit_ledger").filter((r) => r.bucket === "hold").reduce((n,r)=>n+r.delta,0), 0, "holds are settled or released");
  assert.equal(db.rows("ai_usage").length, passed.length, "a refused request leaves no usage row");
});

Deno.test("ai-fix: the hold disappears after the answer and after an upstream failure", async () => {
  const ok = world();
  await events(await ok.handle(post("ai-fix", PROMPT)));
  assert.equal(ok.db.rows("credit_ledger").filter((r) => r.bucket === "hold").reduce((n,r)=>n+r.delta,0), 0);
  const bad = world({ upstream: { status: 500, body: "boom" } });
  assert.equal((await bad.handle(post("ai-fix", PROMPT))).status, 502);
  assert.equal(bad.db.rows("credit_ledger").reduce((n,r)=>n+r.delta,0), 100000, "reservation returned; original grant intact");
});

Deno.test("ai-fix: closing the answer aborts the model request", async () => {
  const { handle, up } = world();
  const res = await handle(post("ai-fix", PROMPT));
  await res.body!.cancel();
  assert.equal(up.calls[0].signal?.aborted, true);
});

Deno.test("ai-fix: Free with bought token packs may still use AI", async () => {
  const w = world({ plan: "free", ledger: [{ user_id: USER.id, delta: 100000, bucket: "topup", reason: "topup", ref: "txn:pri_pack" }] });
  const ev = await events(await w.handle(post("ai-fix", PROMPT)));
  assert.equal(ev.find((e) => e.type === "usage")!.charged, charge("free"));
  assert.equal(w.db.rows("credit_ledger").find((r) => r.reason === "action")!.bucket, "topup");
});

Deno.test("ai-fix: an ended trial stops AI here too, not only in billing status", async () => {
  const past = new Date(Date.now() - 86400_000).toISOString();
  const w = world({ plan: "high", ledger:[{user_id:USER.id,delta:100000,bucket:"plan",reason:"trial_grant",ref:"s1"}], subs: [{ id: "s1", user_id: USER.id, provider: "trial", tier: "high", status: "trial", period_end: past }] });
  const res = await w.handle(post("ai-fix", PROMPT));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "no_plan");
  assert.equal(w.db.rows("profiles")[0].plan, "free");
  assert.equal(w.db.rows("subscriptions")[0].status, "expired");
});

// ---------------------------------------------------------------- V11 RC: idempotent operations, orphaned holds, pricing version

Deno.test("ai-fix: the same operation id never bills twice; a retry gets the recorded outcome", async () => {
  const { db, handle } = world();
  const first = await events(await handle(post("ai-fix", { ...PROMPT, operationId: "op-12345678" })));
  assert.equal(first.at(-1)?.type, "done");
  const row = db.rows("ai_usage")[0];
  assert.equal(row.operation_id, "op-12345678");
  assert.equal(row.pricing_version, "2026-10");
  assert.ok(db.rows("credit_ledger").filter((r) => r.reason === "action").every((r) => r.pricing_version === row.pricing_version), "charges carry the price table version");
  const spent = db.rows("credit_ledger").filter((r) => r.reason === "action").reduce((a, r) => a + Number(r.delta), 0);
  const retry = await handle(post("ai-fix", { ...PROMPT, operationId: "op-12345678" }));
  assert.equal(retry.status, 409);
  const j = await retry.json();
  assert.equal(j.code, "duplicate_operation");
  assert.equal(j.usage.charged, Number(row.charged_tokens));
  assert.equal(db.rows("ai_usage").length, 1, "no second usage row");
  assert.equal(db.rows("credit_ledger").filter((r) => r.reason === "action").reduce((a, r) => a + Number(r.delta), 0), spent, "no second charge");
  // an operation still in flight is reported as such
  db.tables.ai_usage.push({ id: "u-run", user_id: USER.id, operation_id: "op-running1", status: "pending", created_at: new Date().toISOString() });
  const running = await handle(post("ai-fix", { ...PROMPT, operationId: "op-running1" }));
  assert.equal((await running.json()).code, "operation_in_progress");
  // a malformed id is ignored (not an error): the request runs without idempotency
  const loose = await handle(post("ai-fix", { ...PROMPT, operationId: "x" }));
  assert.equal(loose.status, 200);
});

Deno.test("ai-fix: a hold abandoned by a crashed request is released before the next request reserves", async () => {
  const stale = new Date(Date.now() - 20 * 60_000).toISOString();
  const { db, handle } = world({
    balance: 40000,
    usage: [{ id: "u-dead", user_id: USER.id, status: "pending", charged_tokens: 0, created_at: stale, step: "build" }],
  });
  db.tables.credit_ledger.push({ id: "h-dead", user_id: USER.id, delta: -39000, bucket: "hold", reason: "hold", ref: "u-dead", created_at: stale });
  // without reconciliation the balance would be 1000 and the request would be refused with quota_exhausted
  const res = await handle(post("ai-fix", PROMPT));
  assert.equal(res.status, 200);
  await res.text();
  assert.equal(db.rows("ai_usage").find((r) => r.id === "u-dead")?.status, "orphaned");
  assert.equal(db.rows("credit_ledger").filter((r) => r.bucket === "hold").reduce((n,r)=>n+r.delta,0), 0, "the abandoned hold is gone and the new one settled");
  // a fresh in-flight hold is NOT released
  const fresh = world({ balance: 100000, usage: [{ id: "u-live", user_id: USER.id, status: "pending", charged_tokens: 0, created_at: new Date().toISOString() }] });
  fresh.db.tables.credit_ledger.push({ id: "h-live", user_id: USER.id, delta: -1000, bucket: "hold", reason: "hold", ref: "u-live", created_at: new Date().toISOString() });
  await (await fresh.handle(post("ai-fix", PROMPT))).text();
  assert.equal(fresh.db.rows("credit_ledger").filter((r) => r.reason === "hold" && r.ref === "u-live").length, 1);
});

Deno.test("ai-fix V12: accounting unavailable fails closed before contacting the model",async()=>{
  for(const fn of ["bid_enforce_sites","bid_credit_status","bid_hold"]) {
    const w=world(); w.db.missingFunctions=[fn];
    const res=await w.handle(post("ai-fix",PROMPT));
    assert.equal(res.status,503); assert.equal((await res.json()).code,"meter_unavailable");
    assert.equal(w.up.calls.length,0);
  }
});
Deno.test("ai-fix V12: cancellation residual credits work and insufficient worst-case reserve never reaches the model",async()=>{
  const residual=world({plan:"free",balance:100000});
  await events(await residual.handle(post("ai-fix",PROMPT)));
  const low=world({balance:100}); const denied=await low.handle(post("ai-fix",PROMPT));
  assert.equal(denied.status,402); assert.equal((await denied.json()).code,"quota_exhausted");
  assert.equal(low.up.calls.length,0); assert.equal(low.db.rows("ai_usage").length,0);
  assert.equal(low.db.rows("credit_ledger").reduce((n,r)=>n+r.delta,0),100);
});

Deno.test("ai-fix V12: missing model prices fail before the upstream call and before reserving credits", async()=>{
 const w=world({settings:[{key:"ai.prices",value:{}}]});
 const res=await w.handle(post("ai-fix",PROMPT));
 assert.equal(res.status,503);assert.equal((await res.json()).code,"meter_unavailable");
 assert.equal(w.up.calls.length,0);assert.equal(w.db.rows("credit_holds").length,0);
});

// ---------------------------------------------------------------- the Codex engine (OpenAI), chosen per request

/** An OpenAI chat-completions stream: text in `choices[0].delta.content`, the counts in the last chunk, then [DONE]. */
function openaiSse(model = "gpt-5", finish = "stop"): string {
  const chunks = [
    { id: "c1", model, choices: [{ index: 0, delta: { role: "assistant", content: "Hello " }, finish_reason: null }] },
    { id: "c1", model, choices: [{ index: 0, delta: { content: "codex" }, finish_reason: null }] },
    { id: "c1", model, choices: [{ index: 0, delta: {}, finish_reason: finish }] },
    { id: "c1", model, choices: [], usage: { prompt_tokens: 4000, completion_tokens: 2000 } },
  ];
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}

function codexWorld(o: WorldOpts & { openaiKey?: string; stream?: string } = {}) {
  const db = new FakeDb({
    profiles: [{ user_id: USER.id, email: USER.email, role: o.role ?? "normal", plan: o.plan ?? "high", ai_disabled: false }],
    ai_usage: [], credit_ledger: [{ user_id: USER.id, delta: o.balance ?? 100000, bucket: "plan", reason: "plan_grant", ref: "t0" }], settings: o.settings ?? [], subscriptions: [],
  }, USER);
  const calls: { url: string; headers: Record<string, string>; body: Row }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const url = String(input);
    return new Response(url.includes("openai") ? (o.stream ?? openaiSse()) : OK_STREAM, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  const handle = createAiFixHandler({ ...fakeDeps(db), anthropicKey: "sk-ant-test", anthropicBase: "https://anthropic.local", openaiKey: o.openaiKey, openaiBase: "https://openai.local", fetch: f });
  return { db, handle, calls };
}

Deno.test("ai-fix: engine codex → 503 engine_unavailable when the cloud has no Codex key; claude keeps working", async () => {
  const { handle, calls } = codexWorld({ openaiKey: "" });
  const res = await handle(post("ai-fix", { ...PROMPT, engine: "codex" }));
  assert.equal(res.status, 503);
  const j = await res.json();
  assert.equal(j.code, "engine_unavailable");
  assert.equal(j.engine, "codex");
  assert.equal(calls.length, 0, "no model call, nothing reserved");
  const ok = await handle(post("ai-fix", { ...PROMPT, engine: "claude" }));
  assert.equal(ok.status, 200);
  assert.ok(calls[0].url.startsWith("https://anthropic.local/"));
});

Deno.test("ai-fix: engine codex → OpenAI chat completions with the plan's Codex model, the stream normalized, billed at the Codex price", async () => {
  const { handle, calls, db } = codexWorld({ openaiKey: "sk-openai-test", plan: "high" });
  const res = await handle(post("ai-fix", { ...PROMPT, engine: "codex", operationId: "op-codex-0001" }));
  const ev = await events(res);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith("https://openai.local/v1/chat/completions"), calls[0].url);
  assert.equal(calls[0].headers.authorization, "Bearer sk-openai-test");
  assert.equal(calls[0].body.model, "gpt-5", "High plan → gpt-5 on Codex");
  assert.equal(calls[0].body.stream, true);
  assert.deepEqual(calls[0].body.stream_options, { include_usage: true });
  assert.equal((calls[0].body.messages as Row[])[0].role, "system");
  assert.equal(ev.filter((e) => e.type === "delta").map((e) => e.text).join(""), "Hello codex");
  const usage = ev.find((e) => e.type === "usage")!;
  assert.equal(usage.model, "gpt-5");
  assert.equal(usage.input, 4000);
  assert.equal(usage.output, 2000);
  assert.equal(usage.charged, charge("high", "gpt-5"), "the Codex price, not Claude's");
  assert.equal(ev.at(-1)!.type, "done");
  const row = db.tables.ai_usage[0] as Row;
  assert.equal(row.model, "gpt-5");
  assert.equal(row.status, "ok");
});

Deno.test("ai-fix: engine codex explain → the cheap Codex model; an unknown engine value means Claude", async () => {
  const { handle, calls } = codexWorld({ openaiKey: "sk-openai-test" });
  await events(await handle(post("ai-fix", { ...PROMPT, mode: "explain", engine: "codex" })));
  assert.equal(calls[0].body.model, "gpt-5-mini");
  await events(await handle(post("ai-fix", { ...PROMPT, engine: "gemini" })));
  assert.ok(calls[1].url.startsWith("https://anthropic.local/"), "unknown engine → Claude");
});

Deno.test("ai-fix: engine codex — a cut-off answer (finish_reason length) is billed as truncated", async () => {
  const { handle, db } = codexWorld({ openaiKey: "sk-openai-test", stream: openaiSse("gpt-5", "length") });
  const ev = await events(await handle(post("ai-fix", { ...PROMPT, engine: "codex" })));
  assert.equal(ev.find((e) => e.type === "usage")!.status, "truncated");
  assert.equal((db.tables.ai_usage[0] as Row).status, "truncated");
});
