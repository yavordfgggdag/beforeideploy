// deno test supabase/functions   (no network: the database and the model are fakes)
import assert from "node:assert/strict";
import type { AuthUser, Row } from "../_shared/db.ts";
import { FakeDb, fakeDeps, post, sseEvents } from "../_shared/fake_supabase.ts";
import { creditsFor, DEFAULTS, type Plan, type Role } from "../ai-fix/handler.ts";
import { createSiteGenHandler, siteModels } from "./handler.ts";

const USER: AuthUser = { id: "u-1", email: "iva@example.com" };

const BRIEF = { schema: "bid.site-brief/1", theme: "mentor", lang: "bg", name: "Ива Петрова", offer: "Помагам на хора да сменят посоката.", services: [{ name: "Единична сесия", price: "120 лв.", text: "60 минути" }], contacts: { email: "iva@example.com" }, photos: [] };
const RECIPE = {
  tagline: "менторство", description: "Описание", nav: [["За мен", "/about.html"], ["Контакт", "/contact.html"]], headerCta: ["Запази разговор", "/contact.html"],
  pages: {
    index: {
      hero: { eyebrow: "за хора на кръстопът", title: "Помагам ви да стигнете *там*", lead: "Lead.", cta: ["Запази", "/contact.html"], card: { title: "Какво получавате", rows: [["Сесия", "60 мин."]], note: "Онлайн." } },
      sections: [
        { type: "cards", id: "who", title: "За кого е", items: [["users", "Предприемачи", "Текст"], ["chart", "Специалисти", "Текст"]] },
        { type: "quotes", title: "Отзиви", items: [["„Чудесно“", "Мария"]] },
        { type: "pricing", id: "programs", items: [{ name: "Единична сесия", price: "120 лв.", features: ["60 минути"], cta: ["Запази", "/contact.html"] }] },
        { type: "cta", h: "Да започнем", p: "30 минути.", button: ["Запази", "/contact.html"] },
      ],
    },
    contact: { title: "Контакт", description: "Запазете разговор.", pagehead: ["Запазете разговор", "Напишете ни."], sections: [{ type: "contact", rows: [["mail", "Имейл", "iva@example.com", "mailto:iva@example.com"]], send: "Изпрати" }] },
  },
};
const BODY = { brief: BRIEF, recipe: RECIPE, operationId: "op-site-0001" };

function sse(events: Row[]): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

/** The fake model answers each step with schema-shaped JSON built from the prompt, like a careful writer would. */
function answerFor(body: Row): string {
  const prompt = String(body.messages[0].content);
  if (/The owner wants to change their site/.test(prompt)) return JSON.stringify({ summary: "Промених увода.", ops: [{ op: "set_text", page: "index", section: null, field: "lead", value: "Нов увод от модела.", items: null, type: null, after: null, title: null, intro: null, style: null, palette: null }] });
  if (/Decide for every section/.test(prompt)) return JSON.stringify({ tone: "warm and concrete", styleSuggestion: "calm", sections: [{ page: "index", index: 1, keep: false, note: "no reviews in the brief" }] });
  if (/^Review this site/m.test(prompt)) return prompt.slice(prompt.indexOf("Content:\n") + 9);
  const recipe = JSON.parse(prompt.slice(prompt.indexOf("Recipe:\n") + 8));
  return JSON.stringify({
    description: "AI описание", tagline: "AI слоган", nav: recipe.nav, headerCta: "Запази час",
    pages: recipe.pages.map((p: Row) => ({
      id: p.id, title: p.title, description: p.description, pagehead: p.pagehead,
      hero: p.hero ? { ...p.hero, title: "AI *заглавие*", lead: "AI lead." } : null,
      sections: p.sections.map((s: Row) => ({ index: s.index, keep: s.type !== "quotes", title: s.title ? `AI ${s.title}` : null, intro: null, h: s.h ? `AI ${s.h}` : null, p: s.p ?? null, button: s.button ?? null, items: s.items ?? null, plans: s.plans ?? null, groups: null, posts: null, body: null, send: null, note: null })),
    })),
  });
}

interface UpstreamOpts { status?: number; throws?: boolean; truncate?: boolean; garbage?: boolean }

function fakeAnthropic(opts: UpstreamOpts = {}) {
  const calls: { body: Row }[] = [];
  const f = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ body });
    if (opts.throws) throw new TypeError("connection refused");
    if (opts.status) return new Response("{}", { status: opts.status });
    const text = opts.garbage ? "not json" : answerFor(body);
    const events = [
      { type: "message_start", message: { model: body.model, usage: { input_tokens: 3000, output_tokens: 1 } } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(0, 20) } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(20) } },
      { type: "message_delta", delta: { stop_reason: opts.truncate ? "max_tokens" : "end_turn" }, usage: { output_tokens: 1200 } },
      { type: "message_stop" },
    ];
    return new Response(sse(events), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

interface WorldOpts { role?: Role; plan?: Plan; balance?: number; upstream?: UpstreamOpts; key?: string; usage?: Row[] }

function world(o: WorldOpts = {}) {
  const db = new FakeDb({
    profiles: [{ user_id: USER.id, email: USER.email, role: o.role ?? "normal", plan: o.plan ?? "high", ai_disabled: false }],
    ai_usage: o.usage ?? [],
    credit_ledger: [{ user_id: USER.id, delta: o.balance ?? 100000, bucket: "plan", reason: "plan_grant", ref: "t0" }],
    settings: [],
    subscriptions: [],
  }, USER);
  const up = fakeAnthropic(o.upstream);
  const handle = createSiteGenHandler({ ...fakeDeps(db), anthropicKey: o.key ?? "sk-ant-test", anthropicBase: "https://anthropic.local", fetch: up.fetch });
  return { db, handle, up };
}

async function events(res: Response) {
  assert.equal(res.status, 200, await res.clone().text());
  return sseEvents(await res.text());
}

Deno.test("site-gen: three steps, the words merged into the recipe, billed once for all steps", async () => {
  const { db, handle, up } = world({ plan: "high" });
  const ev = await events(await handle(post("site-gen", BODY)));
  // steps in order, each reported to the client
  assert.deepEqual(ev.filter((e) => e.type === "step" && e.status === "running").map((e) => e.id), ["plan", "content", "review"]);
  assert.equal(up.calls.length, 3);
  const m = siteModels(DEFAULTS, "high");
  assert.deepEqual(up.calls.map((c) => c.body.model), [m.plan, m.content, m.review]);
  assert.equal(m.content, "claude-opus-5-5");
  assert.ok(up.calls.every((c) => c.body.output_config?.format?.type === "json_schema"), "structured outputs on every step");
  assert.ok(!("effort" in (up.calls[0].body.output_config ?? {})), "no effort for Haiku");
  // the result keeps the recipe's structure and takes the model's words
  const result = ev.find((e) => e.type === "result")!;
  const content = result.content as Row;
  assert.equal(content.description, "AI описание");
  assert.equal(content.pages.index.hero.title, "AI *заглавие*");
  assert.deepEqual(content.pages.index.hero.cta, ["Запази", "/contact.html"], "links come from the recipe, never the model");
  assert.deepEqual(content.headerCta, ["Запази час", "/contact.html"]);
  const types = content.pages.index.sections.map((s: Row) => s.type);
  assert.deepEqual(types, ["cards", "pricing", "cta"], "a dropped section (no reviews in the brief) is gone");
  assert.equal(content.pages.index.sections[0].title, "AI За кого е");
  assert.equal(content.pages.index.sections[0].items[0][0], "users", "icons stay");
  assert.equal(content.pages.contact.sections[0].rows[0][3], "mailto:iva@example.com", "contact rows stay");
  assert.equal(result.styleSuggestion, "calm");
  // one ai_usage row, one settlement with the sum of the three steps
  const usage = ev.find((e) => e.type === "usage")!;
  assert.equal(usage.steps.length, 3);
  const expected = creditsFor(DEFAULTS, "high", m.plan, 3000, 1200).credits + creditsFor(DEFAULTS, "high", m.content, 3000, 1200).credits + creditsFor(DEFAULTS, "high", m.review, 3000, 1200).credits;
  assert.equal(usage.charged, expected);
  const rows = db.rows("ai_usage");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[0].charged_tokens, expected);
  assert.equal(rows[0].step, "site.create");
  const ledger = db.rows("credit_ledger").filter((r) => r.reason === "action");
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].delta, -expected);
  assert.equal(db.rows("usage_events")[0].action, "ai.site.create");
  assert.ok(ev.some((e) => e.type === "done"));
});

Deno.test("site-gen: Flash writes with Sonnet; Free without credits is refused", async () => {
  const flash = world({ plan: "flash" });
  const ev = await events(await flash.handle(post("site-gen", BODY)));
  assert.equal(flash.up.calls[1].body.model, "claude-sonnet-5-5");
  assert.ok(ev.some((e) => e.type === "result"));
  const free = world({ plan: "free", balance: 0 });
  const res = await free.handle(post("site-gen", BODY));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "no_plan");
  assert.equal(free.up.calls.length, 0);
});

Deno.test("site-gen: 400 without a brief or recipe, 401 without a session, 500 without the key, 409 on a repeated operation", async () => {
  const { handle, db } = world();
  assert.equal((await handle(post("site-gen", { brief: { name: "" }, recipe: RECIPE }))).status, 400);
  assert.equal((await handle(post("site-gen", { brief: BRIEF, recipe: { pages: {} } }))).status, 400);
  assert.equal((await handle(post("site-gen", BODY, null))).status, 401);
  assert.equal((await world({ key: "" }).handle(post("site-gen", BODY))).status, 500);
  await events(await handle(post("site-gen", BODY)));
  assert.equal(db.rows("ai_usage").length, 1);
  const again = await handle(post("site-gen", BODY));
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, "duplicate_operation");
});

Deno.test("site-gen: a model failure bills only the steps that ran and reports an error event", async () => {
  // the plan step is advice: a garbage answer there is tolerated; garbage from the content step is an error
  const { db, handle, up } = world({ upstream: { garbage: true } });
  const ev = await events(await handle(post("site-gen", BODY)));
  assert.equal(up.calls.length, 2, "plan (tolerated) + content (fatal)");
  const err = ev.find((e) => e.type === "error")!;
  assert.equal(err.code, "ai_bad_answer");
  assert.ok(!ev.some((e) => e.type === "result"));
  const rows = db.rows("ai_usage");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "error");
  assert.ok(rows[0].charged_tokens > 0, "the tokens the model produced are paid");
  // an upstream that refuses the connection: nothing ran, the hold is released and no row stays
  const down = world({ upstream: { throws: true } });
  const ev2 = await events(await down.handle(post("site-gen", BODY)));
  assert.ok(ev2.some((e) => e.type === "error"));
  assert.equal(down.db.rows("ai_usage").length, 0, "nothing to bill → the pending row goes");
  assert.equal(down.db.rows("credit_ledger").filter((r) => r.reason === "action").length, 0);
});

Deno.test("site-gen: 402 without credits, 429 over the rate limit", async () => {
  const empty = world({ balance: 0 });
  const res = await empty.handle(post("site-gen", BODY));
  assert.equal(res.status, 402);
  assert.equal((await res.json()).code, "quota_exhausted");
  const recent = new Date().toISOString();
  const busy = world({ usage: Array.from({ length: 8 }, () => ({ user_id: USER.id, created_at: recent, charged_tokens: 10, status: "ok" })) });
  const r = await busy.handle(post("site-gen", BODY));
  assert.equal(r.status, 429);
  assert.equal(busy.up.calls.length, 0);
});

Deno.test("site-gen: edit mode — one call on the fast model, ops back, billed under ai.site.edit", async () => {
  const { db, handle, up } = world({ plan: "high" });
  const ev = await events(await handle(post("site-gen", { mode: "edit", brief: BRIEF, content: RECIPE, look: { style: "calm", palette: null, palettes: { calm: ["sand"] } }, say: "направи увода по-приятелски", operationId: "op-edit-0001" })));
  assert.equal(up.calls.length, 1);
  assert.equal(up.calls[0].body.model, "claude-sonnet-5-5", "the fast model, whatever the plan");
  assert.equal(up.calls[0].body.max_tokens, 6000);
  assert.ok(/направи увода по-приятелски/.test(up.calls[0].body.messages[0].content));
  const result = ev.find((e) => e.type === "result")!;
  assert.equal(result.summary, "Промених увода.");
  assert.equal((result.ops as Row[])[0].field, "lead");
  const usage = ev.find((e) => e.type === "usage")!;
  assert.equal(usage.charged, creditsFor(DEFAULTS, "high", "claude-sonnet-5-5", 3000, 1200).credits);
  assert.equal(db.rows("usage_events")[0].action, "ai.site.edit");
  assert.equal(db.rows("ai_usage")[0].step, "site.edit");
  // without the words, or without content: 400 and no model call
  const bad = world();
  assert.equal((await bad.handle(post("site-gen", { mode: "edit", brief: BRIEF, content: RECIPE }))).status, 400);
  assert.equal((await bad.handle(post("site-gen", { mode: "edit", brief: BRIEF, say: "x" }))).status, 400);
  assert.equal(bad.up.calls.length, 0);
});

// ---------------------------------------------------------------- the Codex engine (OpenAI) for the site texts

function fakeOpenAI(opts: { truncate?: boolean } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: Row }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body });
    // the same answers as the Claude fake, from the user message of the chat-completions body
    const text = answerFor({ ...body, messages: [{ content: (body.messages as Row[]).find((m) => m.role === "user")!.content }] });
    const chunks = [
      { model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: text.slice(0, 20) }, finish_reason: null }] },
      { model: body.model, choices: [{ index: 0, delta: { content: text.slice(20) }, finish_reason: null }] },
      { model: body.model, choices: [{ index: 0, delta: {}, finish_reason: opts.truncate ? "length" : "stop" }] },
      { model: body.model, choices: [], usage: { prompt_tokens: 3000, completion_tokens: 1200 } },
    ];
    return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

function codexWorld(o: { plan?: Plan; openaiKey?: string; truncate?: boolean } = {}) {
  const db = new FakeDb({
    profiles: [{ user_id: USER.id, email: USER.email, role: "normal", plan: o.plan ?? "high", ai_disabled: false }],
    ai_usage: [], credit_ledger: [{ user_id: USER.id, delta: 100000, bucket: "plan", reason: "plan_grant", ref: "t0" }], settings: [], subscriptions: [],
  }, USER);
  const up = fakeOpenAI({ truncate: o.truncate });
  const handle = createSiteGenHandler({ ...fakeDeps(db), anthropicKey: "sk-ant-test", anthropicBase: "https://anthropic.local", openaiKey: o.openaiKey ?? "sk-openai-test", openaiBase: "https://openai.local", fetch: up.fetch });
  return { db, handle, up };
}

Deno.test("site-gen: engine codex → three steps on OpenAI with JSON-schema answers, billed once at the Codex prices", async () => {
  const { handle, up, db } = codexWorld({ plan: "high" });
  const ev = await events(await handle(post("site-gen", { ...BODY, engine: "codex" })));
  assert.equal(up.calls.length, 3);
  assert.ok(up.calls.every((c) => c.url.startsWith("https://openai.local/v1/chat/completions")));
  assert.ok(up.calls.every((c) => c.headers.authorization === "Bearer sk-openai-test"));
  assert.ok(up.calls.every((c) => (c.body.response_format as Row)?.type === "json_schema"), "structured output on every step");
  assert.deepEqual(up.calls.map((c) => c.body.model), ["gpt-5-mini", "gpt-5", "gpt-5-mini"], "cheap plan/review, the plan's Codex model for the writing");
  const result = ev.find((e) => e.type === "result")!;
  assert.equal((result.content as Row).description, "AI описание");
  const usage = ev.find((e) => e.type === "usage")!;
  assert.equal(usage.model, "gpt-5");
  assert.equal(usage.charged, creditsFor(DEFAULTS, "high", "gpt-5-mini", 3000, 1200).credits * 2 + creditsFor(DEFAULTS, "high", "gpt-5", 3000, 1200).credits);
  assert.equal((db.tables.ai_usage[0] as Row).status, "ok");
  assert.deepEqual(siteModels(DEFAULTS, "flash", "codex"), { plan: "gpt-5-mini", content: "gpt-5-mini", review: "gpt-5-mini", edit: "gpt-5-mini" });
});

Deno.test("site-gen: engine codex without a key → 503 engine_unavailable before any hold", async () => {
  const { handle, up, db } = codexWorld({ openaiKey: "" });
  const res = await handle(post("site-gen", { ...BODY, engine: "codex" }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "engine_unavailable");
  assert.equal(up.calls.length, 0);
  assert.equal(db.tables.ai_usage.length, 0);
});

Deno.test("site-gen: engine codex edit mode → one chat-completions call, ops back", async () => {
  const { handle, up } = codexWorld();
  const ev = await events(await handle(post("site-gen", { mode: "edit", brief: BRIEF, content: RECIPE, look: { style: "calm" }, say: "смени увода", operationId: "op-codex-edit-1", engine: "codex" })));
  assert.equal(up.calls.length, 1);
  assert.equal(up.calls[0].body.model, "gpt-5-mini", "the fast Codex model for an edit");
  const result = ev.find((e) => e.type === "result")!;
  assert.equal((result.ops as Row[])[0].op, "set_text");
});
