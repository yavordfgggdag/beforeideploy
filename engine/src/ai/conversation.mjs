import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from '../util.mjs';
import { redact } from '../aifix.mjs';

const directory = () => path.join(APP_DIR, 'chats');
const file = key => path.join(directory(), `${key}.jsonl`);
// Machine references the engine and the app use to find things again after a restart: patch and undo
// files (absolute, often under HOME), ids and project-relative paths. Redaction is for display text; run
// over these it turns `/Users/me/Library/…` into `~/Library/…`, and Apply/Review/Undo can no longer find
// the file (V13 P0). Only string values under these keys are kept verbatim — every other string is redacted.
const INTERNAL_REFS = new Set(['patchFile', 'undoFile', 'historyId', 'conversation', 'path', 'files', 'issue']);
function redacted(value, key = null) {
  if (typeof value === 'string') return key && INTERNAL_REFS.has(key) ? value : redact(value);
  if (Array.isArray(value)) return value.map((v) => redacted(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, redacted(v, k)]));
  return value;
}

function mutate(key, update) {
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const lock = `${file(key)}.lock`, deadline = Date.now() + 2000;
  let owned = false;
  while (!owned) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); owned = true; fs.writeFileSync(path.join(lock, 'pid'), String(process.pid)); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const pid = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
        if (pid > 0) { try { process.kill(pid, 0); } catch (e) { stale = e.code === 'ESRCH'; } }
      } catch { try { stale = Date.now() - fs.statSync(lock).mtimeMs > 5000; } catch {} }
      if (stale) { fs.rmSync(lock, { recursive: true, force: true }); continue; }
      if (Date.now() >= deadline) throw new Error('Conversation history is busy');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return update(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

function save(key, entries) {
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const lines = entries.slice(-200).map(e => JSON.stringify(redacted(e)));
  let bytes = lines.reduce((n,l) => n + Buffer.byteLength(l) + 1, 0);
  while (bytes > 2 * 1024 * 1024 && lines.length > 1) bytes -= Buffer.byteLength(lines.shift()) + 1;
  const target = file(key), temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, lines.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(temp, target);
}
export function assistantHistory(project, { limit = 50 } = {}) {
  let entries = [];
  try { entries = fs.readFileSync(file(project.key), 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch {}
  const conversation = entries.at(-1)?.conversation ?? null;
  const count = Math.min(200, Math.max(1, Number(limit) || 50));
  return { project: project.key, conversation, hasMore: entries.length > count, entries: entries.slice(-count) };
}
export function appendHistory(key, entry) {
  return mutate(key, () => save(key, [...assistantHistory({ key }, { limit: 200 }).entries, entry]));
}
export function assistantReset(project) {
  mutate(project.key, () => fs.rmSync(file(project.key), { force: true }));
  return { project: project.key, cleared: true };
}
/** Provider messages are bounded, redacted and limited to this conversation only. */
export function conversationMessages(entries, conversation) {
  const turns = entries.filter(e => e.conversation === conversation && e.valid && e.summary).slice(-6);
  let remaining = 4000;
  const selected = [];
  for (const e of turns.reverse()) {
    const question = redact(String(e.message || '')).slice(0, Math.min(700, remaining));
    remaining -= question.length;
    const answer = redact(String(e.summary || '')).slice(0, Math.min(700, remaining));
    remaining -= answer.length;
    if (question && answer) selected.unshift({ role: 'user', content: question }, { role: 'assistant', content: answer });
    if (remaining <= 0) break;
  }
  return selected;
}
export function historyResult(result) {
  let left = 16000;
  const bounded = value => {
    if (typeof value === 'string') { const s = redact(value).slice(0, Math.max(0, left)); left -= s.length; return s; }
    if (Array.isArray(value)) return value.slice(0, 40).map(bounded);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !['changes', 'base_hashes'].includes(k)).map(([k,v]) => [k, bounded(v)]));
    return value;
  };
  return { ...result, output: bounded(result.output), errors: result.errors?.slice(0, 5),
    files: result.files };
}
/** Applying or undoing a proposal updates the saved turn as well as the current UI. */
export function updateConversationPatch(key, patchFile, update) {
  return mutate(key, () => {
  const entries = assistantHistory({ key }, { limit: 200 }).entries;
  let changed = false;
  for (const entry of entries) if (entry.result && entry.patchFile === patchFile) { Object.assign(entry.result, update); changed = true; }
  if (changed) save(key, entries);
  });
}
export function updateConversationUndo(key, undoFile, restored, skipped) {
  return mutate(key, () => {
  const entries = assistantHistory({ key }, { limit: 200 }).entries;
  let changed = false;
  for (const entry of entries) if (entry.result?.applied?.undoFile === undoFile) {
    entry.result.undone = skipped.length === 0;
    entry.result.verified = false;
    entry.result.applied = skipped.length ? { ...entry.result.applied, skipped } : null;
    changed = true;
  }
  if (changed) save(key, entries);
  });
}

/** Discarding changes the saved proposal's presentation; it never mutates project files. */
export function discardConversationPatch(project, patchFile) {
  const entry = assistantHistory(project, { limit: 200 }).entries.find(e => e.patchFile === patchFile && e.result && !e.result.applied);
  if (!entry) return { discarded: false };
  updateConversationPatch(project.key, patchFile, { discarded: true });
  return { discarded: true };
}
