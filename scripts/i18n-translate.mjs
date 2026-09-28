#!/usr/bin/env node
// Machine-translates the English catalogs into other languages with Claude (V10 WP1).
//
//   cd scripts && npm install            # once — installs @anthropic-ai/sdk
//   node scripts/i18n-translate.mjs de fr pt-BR [--force] [--dry-run]
//
// Credentials come from the environment (ANTHROPIC_API_KEY, or an `ant auth login` profile) — never
// from the repo. Only keys missing in a language are sent (all of them with --force). Output:
//   engine/i18n/<lang>.json                       (_meta.reviewed = false)
//   App/Resources/<lang>.lproj/Localizable.strings
// plus the language is added to CFBundleLocalizations in App/Info.plist. A native speaker reviews the
// texts and sets "reviewed": true. Run `node scripts/i18n-check.mjs` afterwards.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, ENGINE_I18N, APP_RESOURCES, readStrings, writeStrings, stringsFormats, braces } from './i18n-lib.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const langs = args.filter((a) => !a.startsWith('--'));
if (!langs.length) {
  console.log('usage: node scripts/i18n-translate.mjs <lang> [<lang> …] [--force] [--dry-run]');
  process.exit(2);
}

const MODEL = 'claude-opus-5';
const BATCH = 40;

const GLOSSARY = `Keep these exactly as written (product, service and technical names):
Before I Deploy, Mission Control, Smart Deploy, Local Preview, Draft Preview, Draft preview, Production, LIVE,
DEPLOY, READY TO DEPLOY, BLOCKED, Netlify, Vercel, Cloudflare, Cloudflare Pages, Wrangler, GitHub, GitHub Pages,
Git, Spaceship, Supabase, ChatGPT, Claude, Claude Code, Codex, Homebrew, Node.js, npm, npx, pnpm, yarn, bun,
CLI, API, DNS, SSL, URL, SQL, SPA, SSR, CI, macOS, Keychain, Finder, Terminal, Cursor, VS Code, README,
.gitignore, .env, node_modules, package.json, main, origin, anon key, API key, API secret, device code.
Common developer words (build, lint, typecheck, commit, push, remote, repo, deploy, preview, prompt, framework,
package manager, working tree, log) may stay in English when that is how developers in the target language
normally say them; otherwise translate them.`;

function systemPrompt(lang, kind) {
  const placeholders =
    kind === 'engine'
      ? 'Placeholders look like {name}. Keep every placeholder exactly, with the same names; you may move them.'
      : 'Placeholders look like %@ or %1$@. Keep exactly as many as the source has. If the target language needs a different order, switch to positional ones (%1$@, %2$@ …) numbered by their order in the English source.';
  return `You translate the user interface of "Before I Deploy", a macOS app that checks and deploys web projects, from English into the language with the BCP 47 tag "${lang}".

Write natural, concise UI text the way a native developer tool in that language would: short labels stay short, sentences stay sentences, the same tone (friendly, direct, informal "you" where the language distinguishes it). Keep punctuation, emoji, arrows (→ ←), keyboard symbols (⌘ ⇧ ⌥), quotes style and line breaks (\\n) as in the source unless the language's typography requires otherwise.

${placeholders}

${GLOSSARY}

You receive a JSON object of key → English text (the key hints at where the text appears). Answer with the same keys, each mapped to its translation. Translate every key; never add, drop or rename keys.`;
}

// ---------------------------------------------------------------- catalogs

const readJSON = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

function engineCatalog(lang) {
  const data = readJSON(path.join(ENGINE_I18N, `${lang}.json`)) || {};
  const { _meta, ...entries } = data;
  return { meta: _meta || null, entries };
}

function writeEngine(lang, entries, meta) {
  const out = { _meta: meta };
  for (const k of Object.keys(entries).sort()) out[k] = entries[k];
  fs.writeFileSync(path.join(ENGINE_I18N, `${lang}.json`), JSON.stringify(out, null, 2) + '\n');
}

const appFile = (lang) => path.join(APP_RESOURCES, `${lang}.lproj`, 'Localizable.strings');

function addToInfoPlist(lang) {
  const file = path.join(ROOT, 'App', 'Info.plist');
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/(<key>CFBundleLocalizations<\/key><array>)(.*?)(<\/array>)/s);
  if (!m || m[2].includes(`<string>${lang}</string>`)) return;
  fs.writeFileSync(file, text.replace(m[0], `${m[1]}${m[2]}<string>${lang}</string>${m[3]}`));
}

// ---------------------------------------------------------------- Claude

let client = null;
async function getClient() {
  if (!client) {
    let Anthropic;
    try {
      ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
    } catch {
      console.error('Missing @anthropic-ai/sdk — run `cd scripts && npm install` first.');
      process.exit(1);
    }
    client = new Anthropic(); // ANTHROPIC_API_KEY or an `ant auth login` profile
  }
  return client;
}

async function translateBatch(lang, kind, batch) {
  const keys = Object.keys(batch);
  const schema = {
    type: 'object',
    properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])),
    required: keys,
    additionalProperties: false,
  };
  const anthropic = await getClient();
  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // a declined request is re-run on Anthropic's recommended fallback model
    system: systemPrompt(lang, kind),
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: JSON.stringify(batch, null, 2) }],
  });
  if (response.stop_reason === 'refusal') throw new Error(`declined (${response.stop_details?.category ?? 'no category'})`);
  if (response.stop_reason === 'max_tokens') throw new Error('answer was cut off (max_tokens)');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

/** Translates `todo` (key → English) in batches; keeps only answers whose placeholders match the source. */
async function translateAll(lang, kind, todo) {
  const signature = kind === 'engine' ? braces : stringsFormats;
  const done = {};
  const failed = [];
  const keys = Object.keys(todo);
  for (let i = 0; i < keys.length; i += BATCH) {
    let batch = Object.fromEntries(keys.slice(i, i + BATCH).map((k) => [k, todo[k]]));
    for (let attempt = 1; attempt <= 2 && Object.keys(batch).length; attempt++) {
      let answer = {};
      try {
        answer = await translateBatch(lang, kind, batch);
      } catch (e) {
        console.warn(`  ${lang} ${kind}: batch ${i / BATCH + 1}, attempt ${attempt}: ${e.message}`);
      }
      const retry = {};
      for (const [k, en] of Object.entries(batch)) {
        const t = answer[k];
        if (typeof t === 'string' && t.trim() && String(signature(t)) === String(signature(en))) done[k] = t;
        else retry[k] = en;
      }
      batch = retry;
    }
    failed.push(...Object.keys(batch));
    process.stdout.write(`  ${lang} ${kind}: ${Math.min(i + BATCH, keys.length)}/${keys.length}\r`);
  }
  process.stdout.write('\n');
  return { done, failed };
}

// ---------------------------------------------------------------- main

const engineEn = engineCatalog('en').entries;
const appEn = readStrings(appFile('en'));

for (const lang of langs) {
  if (lang === 'en') continue;
  const name = new Intl.DisplayNames([lang], { type: 'language' }).of(lang) || lang;

  const engine = engineCatalog(lang);
  const engineTodo = Object.fromEntries(Object.entries(engineEn).filter(([k]) => force || !(k in engine.entries)));
  const app = readStrings(appFile(lang));
  const appTodo = Object.fromEntries(Object.entries(appEn).filter(([k]) => !k.startsWith('_meta.') && (force || !(k in app))));
  console.log(`${lang} (${name}): ${Object.keys(engineTodo).length} engine + ${Object.keys(appTodo).length} app texts to translate`);
  if (dryRun) continue;

  const e = await translateAll(lang, 'engine', engineTodo);
  const a = await translateAll(lang, 'app', appTodo);

  // drop keys that no longer exist in English; keep the rest
  const engineOut = Object.fromEntries(Object.entries({ ...engine.entries, ...e.done }).filter(([k]) => k in engineEn));
  const appOut = Object.fromEntries(Object.entries({ ...app, ...a.done }).filter(([k]) => k in appEn));
  // the app shows a "beta translation" badge until a person reviews the texts and sets this to "true"
  appOut['_meta.reviewed'] = Object.keys(a.done).length ? 'false' : (app['_meta.reviewed'] ?? 'false');
  const meta = { language: name, reviewed: false, ...(engine.meta || {}), machineTranslated: MODEL };
  if (Object.keys(e.done).length) meta.reviewed = false; // new machine texts need a review again
  writeEngine(lang, engineOut, meta);
  writeStrings(appFile(lang), appOut, `Before I Deploy — ${name}. Machine translated (${MODEL}), not reviewed yet.`);
  addToInfoPlist(lang);

  const failed = [...e.failed.map((k) => `engine ${k}`), ...a.failed.map((k) => `app ${k}`)];
  if (failed.length) console.warn(`  ${failed.length} text(s) not translated (English is shown instead): ${failed.slice(0, 10).join(', ')}`);
  console.log(`  ✓ ${lang}: engine ${Object.keys(engineOut).length}/${Object.keys(engineEn).length}, app ${Object.keys(appOut).length}/${Object.keys(appEn).length}`);
}
