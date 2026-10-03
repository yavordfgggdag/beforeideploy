#!/usr/bin/env node
// Site Builder AI — the quality check an owner runs with their own key (S7). Writes the texts of the sample briefs in
// tests/site-evals/briefs.json through the same pipeline the app uses, and scores what comes back with the same
// checker the pipeline uses on itself: invented numbers and claims, clichés, a wrong language, texts that are too long,
// repeats — before and after the review step. Nothing is written to disk and no key is ever stored.
//
//   ANTHROPIC_API_KEY=… node scripts/site-ai-eval.mjs                 every brief, the app's models
//   ANTHROPIC_API_KEY=… node scripts/site-ai-eval.mjs en-vet-minimal  one brief
//   node scripts/site-ai-eval.mjs --offline                         no key: a writer that over-reaches, to test the harness
//   --model claude-opus-5-5   the writing model      --json   machine-readable result
// Exit code 1 when an invented number, claim or placeholder survives the pipeline in any brief.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.BID_LANG = 'en';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--model');

const A = await import(path.join(ROOT, 'engine', 'src', 'sitegen', 'ai.mjs'));
const { loadTheme, aiTheme } = await import(path.join(ROOT, 'engine', 'src', 'sitegen', 'themes.mjs'));
const { normalizeBrief, applyBrief } = await import(path.join(ROOT, 'engine', 'src', 'sitegen', 'brief.mjs'));
const fixtures = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'site-evals', 'briefs.json'), 'utf8')).filter((f) => !only.length || only.includes(f.id));

// ---------------------------------------------------------------- the model: the owner's key, or the offline stand-in
async function anthropic(key) {
  return async ({ model, system, prompt, schema, maxTokens, effort }) => {
    const body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }], output_config: { format: { type: 'json_schema', schema }, ...(/haiku/i.test(model) ? {} : { effort }) } };
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(`${r.status} ${j?.error?.message || ''}`);
    const text = (j.content || []).map((c) => c.text || '').join('');
    return { json: JSON.parse(text), usage: { input: j.usage?.input_tokens || 0, output: j.usage?.output_tokens || 0, model: j.model } };
  };
}

/** A writer that over-reaches the way a weak model does: invented numbers, claims, clichés, exclamation marks. */
function offlineModel() {
  return async ({ step, prompt }) => {
    if (step === 'plan') return { json: { tone: 'plain', styleSuggestion: null, sections: [] }, usage: { input: 1, output: 1, model: 'offline' } };
    if (step === 'content') {
      const recipe = JSON.parse(prompt.slice(prompt.indexOf('Recipe:\n') + 8));
      return { json: { description: 'Над 500 доволни клиенти!', tagline: recipe.tagline, nav: recipe.nav, headerCta: null, pages: recipe.pages.map((p) => ({ id: p.id, title: null, description: null, pagehead: null, hero: p.hero ? { eyebrow: null, title: 'The best in town!!!', lead: 'Over 1000 happy clients. Cutting-edge solutions.', cta: null, cta2: null, cardTitle: null, cardRows: null, cardNote: null, chips: null } : null, sections: [] })) }, usage: { input: 1, output: 1, model: 'offline' } };
    }
    // review: replace every flagged text with a plain one
    const bg = /Language: Bulgarian/.test(prompt);
    const tag = (n) => String.fromCharCode(97 + (n % 26)) + String.fromCharCode(97 + Math.floor(n / 26)); // letters only: no digit for the checker to find
    const fixes = [...prompt.matchAll(/^(t\d+): /gm)].map((m, n) => ({ id: m[1], text: bg ? `Ясно и честно описание на услугата, ${tag(n)}.` : `A clear and honest line about the service, ${tag(n)}.` }));
    return { json: { fixes }, usage: { input: 1, output: 1, model: 'offline' } };
  };
}

const key = process.env.ANTHROPIC_API_KEY;
if (!flag('--offline') && !key) {
  console.error('Set ANTHROPIC_API_KEY (your own key — it is only used for this run), or use --offline to test the harness.');
  process.exit(2);
}
const call = flag('--offline') ? offlineModel() : await anthropic(key);
const models = opt('--model') ? { content: opt('--model') } : {};

// ---------------------------------------------------------------- run and score
const rows = [];
let bad = 0;
for (const f of fixtures) {
  const theme = loadTheme(f.brief.theme);
  if (!theme) { console.log(`- ${f.id}: theme "${f.brief.theme}" is not installed, skipped`); continue; }
  const brief = normalizeBrief(f.brief);
  const recipe = applyBrief(theme, { ...brief, photos: [] }, []);
  const t0 = Date.now();
  let out;
  try { out = await A.runPipeline({ brief: { ...brief, ...aiTheme(theme) }, recipe, call, models }); } catch (e) { rows.push({ id: f.id, error: e.message }); bad++; console.log(`✗ ${f.id}: ${e.message}`); continue; }
  const left = A.auditContent(brief, out.content);
  const hard = left.filter((i) => i.kinds.some((k) => ['number', 'claim', 'placeholder', 'language'].includes(k)));
  const soft = left.filter((i) => !hard.includes(i));
  if (hard.length) bad++;
  rows.push({ id: f.id, texts: A.textsOf(out.content).length, found: out.audit.found, fixed: out.audit.fixed, cut: out.audit.cut, hard: hard.length, soft: soft.length, seconds: Math.round((Date.now() - t0) / 100) / 10, tokens: out.usage.input + out.usage.output, issues: left.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.detail[0]}`) });
}
if (flag('--json')) console.log(JSON.stringify(rows, null, 2));
else {
  console.log(`\n${'brief'.padEnd(22)} texts  found fixed  cut  hard  soft   secs  tokens`);
  for (const r of rows) console.log(r.error ? `${r.id.padEnd(22)} ERROR ${r.error}` : `${r.id.padEnd(22)} ${String(r.texts).padStart(5)} ${String(r.found).padStart(6)} ${String(r.fixed).padStart(5)} ${String(r.cut).padStart(4)} ${String(r.hard).padStart(5)} ${String(r.soft).padStart(5)} ${String(r.seconds).padStart(6)} ${String(r.tokens).padStart(7)}`);
  for (const r of rows) for (const i of r.issues || []) console.log(`  ${r.id}: ${i}`);
  console.log(bad ? `\n✗ ${bad} brief(s) kept an invented number, claim or placeholder (or failed)` : '\n✓ no invented number, claim, placeholder or wrong language survived');
}
process.exit(bad ? 1 : 0);
