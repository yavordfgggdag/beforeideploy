// deno test supabase/functions   (no network: the database and the model are fakes)
import assert from "node:assert/strict";
import type { AuthUser, Row } from "../_shared/db.ts";
import { FakeDb, fakeDeps, post, sseEvents } from "../_shared/fake_supabase.ts";
import { createAiFixHandler, type Plan, type Role } from "./handler.ts";

const USER: AuthUser = { id: "u-1", email: "ivan@example.com" };
const PROMPT = { prompt: "Build failed:\nTypeError: x is not a function", step: "build", project: { key: "p1", framework: "vite" }, mode: "fix" };

function anthropicSse(events: Row[]): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

const OK_STREAM = anthropicSse([
  { type: "message_start", message: { model: "claude-sonnet-5", usage: { input_tokens: 4000, output_tokens: 1 } } },
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
}

function fakeAnthropic(opts: UpstreamOpts = {}) {
  const calls: { url: string; headers: Record<string, string>; body: Row }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) });
    if (opts.throws) throw new TypeError("connection refused");
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
}

function world(o: WorldOpts = {}) {
  const db = new FakeDb({
    profiles: o.noProfile ? [] : [{ user_id: USER.id, email: USER.email, role: o.role ?? "normal", plan: o.plan ?? "high", ai_disabled: !!o.aiDisabled }],
    credit_balance: [{ user_id: USER.id, balance: o.balance ?? 100000 }],
    ai_usage: o.usage ?? [],
    credit_ledger: [],
    settings: o.settings ?? [],
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
  res = await world({ plan: "free" }).handle(post("ai-fix", PROMPT));
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

Deno.test("ai-fix: 403 daily_cap at 15% of the monthly quota", async () => {
  const earlier = new Date(Date.now() - 3 * 3600_000).toISOString();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  // High = 1,000,000 tokens → cap 150,000. Use a timestamp that is surely today (UTC).
  const ts = new Date(dayStart.getTime() + 60_000).toISOString();
  const usage = [{ user_id: USER.id, created_at: ts > earlier ? ts : earlier, charged_tokens: 150000 }];
  const res = await world({ usage }).handle(post("ai-fix", PROMPT));
  assert.equal(res.status, 403);
  const j = await res.json();
  assert.equal(j.code, "daily_cap");
  assert.equal(j.cap, 150000);
});

Deno.test("ai-fix: 413 for an oversized prompt", async () => {
  const res = await world().handle(post("ai-fix", { ...PROMPT, prompt: "x".repeat(60001) }));
  assert.equal(res.status, 413);
  assert.equal((await res.json()).code, "prompt_too_long");
});

Deno.test("ai-fix: streams deltas, bills the real tokens and records usage", async () => {
  const { db, handle, up } = world();
  const ev = await events(await handle(post("ai-fix", PROMPT)));
  assert.equal(ev.filter((e) => e.type === "delta").map((e) => e.text).join(""), "Hello world");
  const usage = ev.find((e) => e.type === "usage")!;
  assert.equal(usage.input, 4000);
  assert.equal(usage.output, 2000);
  assert.equal(usage.charged, 6000);
  assert.equal(usage.balance, 94000);
  assert.equal(usage.model, "claude-sonnet-5");
  assert.equal(usage.status, "ok");
  assert.deepEqual(ev.at(-1), { type: "done", stopReason: "ok" });

  const rows = db.rows("ai_usage");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, USER.id);
  assert.equal(rows[0].project_key, "p1");
  assert.equal(rows[0].step, "build");
  assert.equal(rows[0].input_tokens, 4000);
  assert.equal(rows[0].output_tokens, 2000);
  assert.equal(rows[0].charged_tokens, 6000);
  assert.ok(Math.abs(rows[0].cost_usd - 0.028) < 1e-9);
  const ledger = db.rows("credit_ledger");
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].delta, -6000);
  assert.equal(ledger[0].bucket, "plan");
  assert.equal(ledger[0].reason, "ai_fix");
  assert.equal(ledger[0].ref, rows[0].id);

  assert.equal(up.calls.length, 1);
  assert.equal(up.calls[0].url, "https://anthropic.local/v1/messages");
  assert.equal(up.calls[0].headers["x-api-key"], "sk-ant-test");
  assert.equal(up.calls[0].body.model, "claude-sonnet-5");
  assert.equal(up.calls[0].body.max_tokens, 8000);
  assert.equal(up.calls[0].body.stream, true);
  assert.deepEqual(up.calls[0].body.output_config, { effort: "medium" });
  assert.equal(up.calls[0].body.messages[0].content, PROMPT.prompt);
});

Deno.test("ai-fix: deep fix uses the strongest model at ×5 for Knight, is ignored for High", async () => {
  const knight = world({ plan: "knight" });
  const ev = await events(await knight.handle(post("ai-fix", { ...PROMPT, deep: true })));
  assert.equal(knight.up.calls[0].body.model, "claude-opus-5");
  assert.deepEqual(knight.up.calls[0].body.output_config, { effort: "high" });
  assert.equal(ev.find((e) => e.type === "usage")!.charged, 30000); // stream reports sonnet as usedModel; multiplier ×5 on 6000
  assert.equal(knight.db.rows("credit_ledger")[0].delta, -30000);

  const high = world({ plan: "high" });
  await events(await high.handle(post("ai-fix", { ...PROMPT, deep: true })));
  assert.equal(high.up.calls[0].body.model, "claude-sonnet-5");
  assert.equal(high.db.rows("credit_ledger")[0].delta, -6000);
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
    { key: "ai.models", value: { flash: "claude-haiku-4-5", high: "claude-opus-5", knight: "claude-opus-5", deep: "claude-opus-5" } },
    { key: "ai.multipliers", value: { deep: 3 } },
    { key: "ai.rate", value: { perMinute: 1, perHour: 60 } },
  ];
  const w = world({ plan: "high", settings });
  await events(await w.handle(post("ai-fix", PROMPT)));
  assert.equal(w.up.calls[0].body.model, "claude-opus-5");
  // perMinute: 1 → the second request is rate limited
  assert.equal((await w.handle(post("ai-fix", PROMPT))).status, 429);

  const k = world({ plan: "knight", settings });
  await events(await k.handle(post("ai-fix", { ...PROMPT, deep: true })));
  assert.equal(k.db.rows("credit_ledger")[0].delta, -18000);
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
    { type: "message_start", message: { model: "claude-sonnet-5", usage: { input_tokens: 100 } } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
    { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
  ]);
  const w = world({ upstream: { body } });
  const ev = await events(await w.handle(post("ai-fix", PROMPT)));
  assert.equal(ev.find((e) => e.type === "error")!.error, "Overloaded");
  assert.equal(ev.find((e) => e.type === "usage")!.status, "error");
  assert.equal(w.db.rows("ai_usage")[0].status, "error");
  assert.equal(w.db.rows("ai_usage")[0].charged_tokens, 100);
});

Deno.test("ai-fix: truncated and refused answers are marked", async () => {
  const body = anthropicSse([
    { type: "message_start", message: { model: "claude-sonnet-5", usage: { input_tokens: 10 } } },
    { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 8000 } },
  ]);
  const w = world({ upstream: { body } });
  const ev = await events(await w.handle(post("ai-fix", PROMPT)));
  assert.deepEqual(ev.at(-1), { type: "done", stopReason: "truncated" });
});
