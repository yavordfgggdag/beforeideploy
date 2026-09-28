// AI patches (V10 WP3). The model answers with explanation text plus edit blocks:
//
//   <<<FILE src/app.js>>>              edit an existing file with one or more search/replace pairs
//   <<<<<<< SEARCH
//   exact lines to find (must match once)
//   =======
//   replacement lines
//   >>>>>>> REPLACE
//   <<<NEW FILE src/new.js>>>          create a file (content until <<<END FILE>>>)
//   ...
//   <<<END FILE>>>
//   <<<DELETE FILE old.js>>>           delete a file
//
// Exact search/replace is far more reliable from a model than hand-written unified diffs; the unified
// diff shown in the app is computed here from before/after. Nothing is written without `apply(..., yes)`.
import fs from 'node:fs';
import path from 'node:path';

const FILE_RE = /^<<<(FILE|NEW FILE|DELETE FILE) (.+?)>>>\s*$/;

/** Why a planned change cannot be applied → catalog key (the app shows the text). */
export const REASON_KEYS = {
  outside_project: 'ai.apply.reason.outside_project',
  not_found: 'ai.apply.reason.not_found',
  exists: 'ai.apply.reason.exists',
  ambiguous: 'ai.apply.reason.ambiguous',
  search_not_found: 'ai.apply.reason.search_not_found',
  not_applicable: 'ai.apply.reason.not_applicable',
  not_selected: 'ai.apply.reason.not_selected',
};
export const reasonKey = (reason) => REASON_KEYS[reason] || 'ai.apply.reason.other';
const BLOCKED_DIRS = new Set(['node_modules', '.git', '.netlify', '.vercel', '.next', 'dist', 'build']);

/** Splits the model answer into { explanation, files[] } without touching the disk. */
export function parseAnswer(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const explanation = [];
  const files = [];
  let cur = null; // { path, action, edits, content }
  let mode = null; // 'search' | 'replace' | 'content'
  let search = [];
  let replace = [];
  let content = [];
  const finishEdit = () => {
    if (cur && (search.length || replace.length)) cur.edits.push({ search: search.join('\n'), replace: replace.join('\n') });
    search = [];
    replace = [];
    mode = null;
  };
  const finishFile = () => {
    if (!cur) return;
    if (mode === 'search' || mode === 'replace') finishEdit();
    if (cur.action === 'create') cur.content = content.join('\n');
    files.push(cur);
    cur = null;
    content = [];
    mode = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const m = FILE_RE.exec(line);
    if (m) {
      finishFile();
      const action = m[1] === 'FILE' ? 'edit' : m[1] === 'NEW FILE' ? 'create' : 'delete';
      cur = { path: m[2].trim().replace(/^`|`$/g, ''), action, edits: [], content: null };
      if (action === 'create') mode = 'content';
      if (action === 'delete') finishFile();
      continue;
    }
    if (cur?.action === 'create') {
      if (line === '<<<END FILE>>>') finishFile();
      else content.push(raw);
      continue;
    }
    if (cur?.action === 'edit') {
      if (/^<{7} SEARCH\s*$/.test(line)) {
        if (mode) finishEdit();
        mode = 'search';
        continue;
      }
      if (/^={7}\s*$/.test(line) && mode === 'search') {
        mode = 'replace';
        continue;
      }
      if (/^>{7} REPLACE\s*$/.test(line) && mode === 'replace') {
        finishEdit();
        continue;
      }
      if (mode === 'search') search.push(raw);
      else if (mode === 'replace') replace.push(raw);
      else if (line && !/^```/.test(line)) explanation.push(raw); // prose between blocks
      continue;
    }
    if (!/^```/.test(line)) explanation.push(raw);
  }
  finishFile();
  return { explanation: explanation.join('\n').trim(), files: files.filter((f) => f.action !== 'edit' || f.edits.length) };
}

// ---------------------------------------------------------------- safety

/** Resolves `rel` inside `dir`; returns null for anything that escapes the project or points at tooling dirs. */
export function safePath(dir, rel) {
  if (!rel || path.isAbsolute(rel) || rel.includes('\0')) return null;
  const abs = path.resolve(dir, rel);
  const root = path.resolve(dir) + path.sep;
  if (!abs.startsWith(root)) return null;
  const parts = path.relative(dir, abs).split(path.sep);
  if (parts.some((p) => BLOCKED_DIRS.has(p) || p === '..')) return null;
  // a symlink anywhere on the way could point outside the project
  let probe = path.resolve(dir);
  for (const p of parts) {
    probe = path.join(probe, p);
    try {
      if (fs.lstatSync(probe).isSymbolicLink()) return null;
    } catch {
      break; // not created yet — fine
    }
  }
  return abs;
}

// ---------------------------------------------------------------- matching & diff

const norm = (s) => s.replace(/[ \t]+$/gm, '');

/** Finds `search` in `text` exactly once; falls back to a trailing-whitespace-insensitive match. Returns [start, end] or null. */
function locate(text, search) {
  if (!search) return null;
  let i = text.indexOf(search);
  if (i !== -1 && text.indexOf(search, i + 1) === -1) return [i, i + search.length];
  if (i !== -1) return 'ambiguous';
  const normText = norm(text);
  const s = norm(search);
  i = normText.indexOf(s);
  if (i === -1) return null;
  if (normText.indexOf(s, i + 1) !== -1) return 'ambiguous';
  // map back: normalized text keeps line count, so translate by line numbers
  const lineOf = (str, idx) => str.slice(0, idx).split('\n').length - 1;
  const startLine = lineOf(normText, i);
  const endLine = lineOf(normText, i + s.length);
  const lines = text.split('\n');
  const start = lines.slice(0, startLine).join('\n').length + (startLine ? 1 : 0);
  const end = lines.slice(0, endLine + 1).join('\n').length;
  return [start, end];
}

function hunk(before, after, startLine, path_) {
  const b = before.split('\n');
  const a = after.split('\n');
  const ctx = 3;
  const all = path_.split('\n');
  const from = Math.max(0, startLine - ctx);
  const to = Math.min(all.length, startLine + b.length + ctx);
  const pre = all.slice(from, startLine).map((l) => ' ' + l);
  const post = all.slice(startLine + b.length, to).map((l) => ' ' + l);
  const body = [...pre, ...b.map((l) => '-' + l), ...a.map((l) => '+' + l), ...post];
  return `@@ -${from + 1},${pre.length + b.length + post.length} +${from + 1},${pre.length + a.length + post.length} @@\n${body.join('\n')}`;
}

/** Applies the parsed files against the project on disk (in memory only) and describes what would change. */
export function plan(dir, parsed) {
  return parsed.files.map((f) => {
    const out = { path: f.path, action: f.action, additions: 0, deletions: 0, diff: '', applicable: false, error: null };
    const abs = safePath(dir, f.path);
    if (!abs) return { ...out, error: 'outside_project' };
    let current = null;
    try {
      current = fs.readFileSync(abs, 'utf8');
    } catch {}
    if (f.action === 'delete') {
      if (current === null) return { ...out, error: 'not_found' };
      const n = current.split('\n').length;
      return { ...out, deletions: n, diff: `--- a/${f.path}\n+++ /dev/null\n@@ -1,${n} +0,0 @@\n${current.split('\n').map((l) => '-' + l).join('\n')}`, applicable: true, after: null };
    }
    if (f.action === 'create') {
      if (current !== null) return { ...out, error: 'exists' };
      const c = f.content ?? '';
      const n = c.split('\n').length;
      return { ...out, additions: n, diff: `--- /dev/null\n+++ b/${f.path}\n@@ -0,0 +1,${n} @@\n${c.split('\n').map((l) => '+' + l).join('\n')}`, applicable: true, after: c };
    }
    if (current === null) return { ...out, error: 'not_found' };
    let text = current;
    const hunks = [];
    for (const e of f.edits) {
      const where = locate(text, e.search);
      if (where === 'ambiguous') return { ...out, error: 'ambiguous' };
      if (!where) return { ...out, error: 'search_not_found' };
      const [s, en] = where;
      const startLine = text.slice(0, s).split('\n').length - 1;
      hunks.push(hunk(text.slice(s, en), e.replace, startLine, text));
      text = text.slice(0, s) + e.replace + text.slice(en);
      out.deletions += e.search.split('\n').length;
      out.additions += e.replace.split('\n').length;
    }
    return { ...out, diff: `--- a/${f.path}\n+++ b/${f.path}\n${hunks.join('\n')}`, applicable: true, after: text };
  });
}

/** Writes the planned changes for `selected` paths (all applicable ones when null). Returns { applied, skipped }. */
export function apply(dir, planned, selected = null) {
  const applied = [];
  const skipped = [];
  for (const p of planned) {
    // the real problem is more useful to the user than "not selected"
    if (!p.applicable) {
      skipped.push({ path: p.path, reason: p.error || 'not_applicable' });
      continue;
    }
    if (selected && !selected.includes(p.path)) {
      skipped.push({ path: p.path, reason: 'not_selected' });
      continue;
    }
    const abs = safePath(dir, p.path);
    if (!abs) {
      skipped.push({ path: p.path, reason: 'outside_project' });
      continue;
    }
    if (p.action === 'delete') fs.unlinkSync(abs);
    else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, p.after);
    }
    applied.push(p.path);
  }
  return { applied, skipped };
}
