#!/usr/bin/env node
// Every error code the engine can emit (`new EngineError(message, code)`) must have a row in
// docs/errors.md, and every documented code must still exist (ROADMAP invariant 20). The app shows the
// code in the toast and links `<help.url>/<code>`, so the page and the code are one contract.
//
//   node scripts/error-codes.mjs            # exit 1 with the missing / stale codes
//   node scripts/error-codes.mjs --list     # print the codes and where they are raised
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const list = process.argv.includes('--list');

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

/** The text between the parentheses of the call that starts at `open` (balanced, strings ignored). */
function callArgs(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** Top-level split by commas (ignores commas inside brackets and strings). */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') cur += s[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---- engine codes
const raised = new Map(); // code → [file:line]
for (const f of walk(path.join(ROOT, 'engine', 'src'), '.mjs')) {
  const text = fs.readFileSync(f, 'utf8');
  const re = /new EngineError\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    const args = callArgs(text, m.index + m[0].length - 1);
    if (args == null) continue;
    const second = splitArgs(args)[1];
    const line = text.slice(0, m.index).split('\n').length;
    const where = `${path.relative(ROOT, f)}:${line}`;
    const codes = [];
    if (second == null) codes.push('error'); // default code in EngineError's constructor
    else if (/^'[a-z_]+'$/.test(second)) codes.push(second.slice(1, -1));
    else if (second.includes('?')) for (const t of second.matchAll(/[?:]\s*'([a-z_]+)'/g)) codes.push(t[1]);
    else codes.push(`<dynamic:${second.slice(0, 40)}>`);
    for (const c of codes) raised.set(c, [...(raised.get(c) || []), where]);
  }
}

// ---- codes the Edge Functions return in JSON (`code: "…"`), surfaced by the engine as-is in some paths
const cloud = new Set();
for (const f of walk(path.join(ROOT, 'supabase', 'functions'), 'handler.ts')) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bcode:\s*"([a-z_]+)"/g)) cloud.add(m[1]);
}

// ---- documented
const docFile = path.join(ROOT, 'docs', 'errors.md');
const doc = fs.existsSync(docFile) ? fs.readFileSync(docFile, 'utf8') : '';
const documented = new Set([...doc.matchAll(/^\| `([a-z_]+)`/gm)].map((m) => m[1]));

const appOnly = new Set(['missing']); // raised by the app itself (engine not installed)
const dynamic = [...raised.keys()].filter((c) => c.startsWith('<dynamic'));
const engineCodes = [...raised.keys()].filter((c) => !c.startsWith('<dynamic')).sort();
const missing = engineCodes.filter((c) => !documented.has(c));
const missingCloud = [...cloud].filter((c) => !documented.has(c));
const stale = [...documented].filter((c) => !raised.has(c) && !cloud.has(c) && !appOnly.has(c));

if (list) {
  for (const c of engineCodes) console.log(`${c.padEnd(18)} ${raised.get(c).join(', ')}`);
  console.log(`cloud: ${[...cloud].sort().join(', ')}`);
}
console.log(`engine codes: ${engineCodes.length} · cloud codes: ${cloud.size} · documented: ${documented.size}`);
let bad = false;
if (dynamic.length) console.log(`⚠️  ${dynamic.length} EngineError call(s) with a non-literal code: ${dynamic.join(' ')}`);
if (missing.length) { bad = true; console.log(`❌ not documented in docs/errors.md: ${missing.join(', ')}`); }
if (missingCloud.length) { bad = true; console.log(`❌ cloud codes not documented: ${missingCloud.join(', ')}`); }
if (stale.length) { bad = true; console.log(`❌ documented but no longer raised: ${stale.join(', ')}`); }
if (bad) process.exit(1);
console.log('✅ error codes ok');
