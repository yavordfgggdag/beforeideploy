#!/usr/bin/env node
// i18n consistency check for the engine catalogs (engine/i18n/*.json) and the app (App/Resources/*.lproj).
//   node scripts/i18n-check.mjs [--allow-cyrillic]
// Fails when: a language misses a key the English catalog has (or has extra ones), placeholders differ,
// a key used in the code is missing, a catalog key is unused, or Swift code has a hard-coded Cyrillic literal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrings as parseStringsText, stringsFormats, braces } from './i18n-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowCyrillic = process.argv.includes('--allow-cyrillic');
const errors = [];
const warn = [];

const cFormats = stringsFormats;

function parseStrings(text, file) {
  const { entries, duplicates } = parseStringsText(text, file);
  for (const k of duplicates) errors.push(`${file}: duplicate key ${k}`);
  return entries;
}

function compare(label, catalogs, placeholders) {
  const en = catalogs.en;
  if (!en) {
    errors.push(`${label}: no English catalog`);
    return;
  }
  for (const [lang, cat] of Object.entries(catalogs)) {
    if (lang === 'en') continue;
    // plural categories differ by language (pl has few/many, ja only other) — only `.other` is mandatory
    const isCategory = (k, other) => /\.(zero|one|two|few|many)$/.test(k) && `${k.replace(/\.[a-z]+$/, '')}.other` in other;
    const missing = Object.keys(en).filter((k) => !(k in cat) && !isCategory(k, cat));
    const extra = Object.keys(cat).filter((k) => !(k in en) && !isCategory(k, en));
    if (missing.length) errors.push(`${label} ${lang}: missing ${missing.length} key(s): ${missing.slice(0, 10).join(', ')}`);
    if (extra.length) errors.push(`${label} ${lang}: ${extra.length} key(s) not in en: ${extra.slice(0, 10).join(', ')}`);
    for (const k of Object.keys(en)) {
      if (!(k in cat)) continue;
      if (typeof cat[k] !== 'string' || !cat[k]) errors.push(`${label} ${lang}: empty ${k}`);
      else if (placeholders(cat[k]) !== placeholders(en[k])) errors.push(`${label} ${lang}: placeholders differ in ${k}`);
    }
  }
}

// ---------------------------------------------------------------- engine

const engineDir = path.join(ROOT, 'engine', 'i18n');
const engine = {};
for (const f of fs.readdirSync(engineDir).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(fs.readFileSync(path.join(engineDir, f), 'utf8'));
  delete data._meta;
  engine[f.slice(0, -5)] = data;
}
compare('engine', engine, braces);

// ---------------------------------------------------------------- app

const resDir = path.join(ROOT, 'App', 'Resources');
const app = {};
if (fs.existsSync(resDir)) {
  for (const d of fs.readdirSync(resDir).filter((d) => d.endsWith('.lproj'))) {
    const file = path.join(resDir, d, 'Localizable.strings');
    if (fs.existsSync(file)) app[d.slice(0, -6)] = parseStrings(fs.readFileSync(file, 'utf8'), path.relative(ROOT, file));
  }
}
compare('app', app, (s) => String(cFormats(s)));

const swiftDir = path.join(ROOT, 'App', 'Sources');
const swiftFiles = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.swift')) swiftFiles.push(p);
  }
};
walk(swiftDir);

const used = new Set();
const pluralBases = new Set();
let cyrillic = 0;
for (const f of swiftFiles) {
  const text = fs.readFileSync(f, 'utf8');
  // L("key", count: n) → plural forms `key.one`, `key.few`, `key.many`, `key.other` (V10 L4)
  const pluralHere = new Set([...text.matchAll(/\bL\(\s*"([^"\\]+)"\s*,\s*count:/g)].map((m) => m[1]));
  for (const k of pluralHere) pluralBases.add(k);
  for (const m of text.matchAll(/\bL\(\s*"([^"\\]+)"/g)) if (!pluralHere.has(m[1])) used.add(m[1]);
  // keys passed around as plain strings (e.g. `titleKey: "sheet.commit.title"`) count as used too
  for (const m of text.matchAll(/"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)"/g)) if (app.en && m[1] in app.en) used.add(m[1]);
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const lit of code.match(/"(?:[^"\\]|\\.)*"/g) || []) {
      if (/[\u0400-\u04FF]/.test(lit)) {
        cyrillic++;
        if (!allowCyrillic && cyrillic <= 20) errors.push(`${path.relative(ROOT, f)}:${i + 1}: hard-coded text ${lit.slice(0, 60)}`);
      }
    }
    // English sentences handed straight to the UI (`Text("ready to deploy")`, `label: "blocked"`) — the
    // catalogs must own every visible word, otherwise the other languages silently show English.
    for (const m of code.matchAll(/\b(?:Text|Label|Button|label|placeholder|title|subtitle|help)\s*[:(]\s*"([a-z]+(?: [a-z]+)+)"/g)) {
      errors.push(`${path.relative(ROOT, f)}:${i + 1}: English text outside the catalog "${m[1]}" — use L("key")`);
    }
  });
}
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
if (app.en) {
  for (const base of pluralBases) {
    for (const [lang, cat] of Object.entries(app)) {
      if (!(`${base}.other` in cat)) errors.push(`app ${lang}: plural "${base}" needs "${base}.other"`);
    }
    for (const c of PLURAL_CATEGORIES) if (`${base}.${c}` in app.en) used.add(`${base}.${c}`);
  }
  const unknown = [...used].filter((k) => !(k in app.en));
  if (unknown.length) errors.push(`app: ${unknown.length} key(s) used in Swift but missing in en: ${unknown.slice(0, 15).join(', ')}`);
  // `_meta.*` keys describe the catalog itself (e.g. `_meta.reviewed`), the app reads them by name
  const unused = Object.keys(app.en).filter((k) => !used.has(k) && !k.startsWith('_meta.'));
  for (const [lang, cat] of Object.entries(app)) {
    if (!['true', 'false'].includes(cat['_meta.reviewed'])) errors.push(`app ${lang}: "_meta.reviewed" must be "true" or "false"`);
  }
  if (unused.length) errors.push(`app: ${unused.length} unused key(s): ${unused.slice(0, 15).join(', ')}`);
}
if (cyrillic && allowCyrillic) warn.push(`${cyrillic} hard-coded Cyrillic literal(s) left in Swift`);
if (cyrillic > 20 && !allowCyrillic) errors.push(`… ${cyrillic} hard-coded Cyrillic literals in total`);

const langs = (o) => Object.keys(o).sort().join(', ') || '—';
console.log(`engine: ${Object.keys(engine.en || {}).length} keys [${langs(engine)}] · app: ${Object.keys(app.en || {}).length} keys [${langs(app)}]`);
for (const w of warn) console.log(`⚠️  ${w}`);
for (const e of errors) console.log(`❌ ${e}`);
if (errors.length) process.exit(1);
console.log('✅ i18n ok');
