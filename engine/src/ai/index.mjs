// Built-in AI Fix (V10 WP3): `bid ai fix|explain|apply|usage`.
// The model only proposes; nothing in the project changes before `bid ai apply --yes` (invariant 15).
import fs from 'node:fs';
import path from 'node:path';
import { ev, emit, EngineError, logDir, nowISO, sh, readJSON, writeJSON, APP_DIR } from '../util.mjs';
import { t, msg, currentLang } from '../i18n.mjs';
import { detect } from '../detect.mjs';
import { addHistory, getState, setState } from '../store.mjs';
import { runChecks } from '../checks.mjs';
import { recordCost, listLedger } from '../costs.mjs';
import { accountStatus } from '../account.mjs';
import { buildPrompt } from '../aifix.mjs';
import { chooseProvider, stream } from './providers.mjs';
import { parseAnswer, plan as planPatch, apply as applyPatch, reasonKey } from './patch.mjs';

/** Fallbacks when the cloud `settings` table has no `ai.models` (Admin panel edits it without a release). */
export const DEFAULT_MODELS = { fast: 'claude-haiku-4-5', standard: 'claude-sonnet-5', deep: 'claude-opus-5', openai: 'gpt-5' };
const PATCH_TTL_MS = 7 * 86400000;

function pickModel({ provider, deep, explicit, status, mode }) {
  if (explicit && explicit !== true) return explicit;
  const m = { ...DEFAULT_MODELS, ...(status?.settings?.['ai.models'] || {}) };
  if (provider === 'cloud') return null; // the Edge Function picks by plan
  if (provider === 'openai') return m.openai;
  if (mode === 'explain') return m.fast;
  return deep ? m.deep : m.standard;
}

function prunePatches(key) {
  const dir = logDir(key);
  for (const f of fs.readdirSync(dir)) {
    if (!/^ai-patch-.*\.json$/.test(f)) continue;
    try {
      if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > PATCH_TTL_MS) fs.unlinkSync(path.join(dir, f));
    } catch {}
  }
}

/**
 * Streams a fix (or a short explanation) for a failed step. Emits `ai` events with the text as it arrives,
 * then returns the parsed patch plan (files, diffs, what is applicable) without writing anything.
 */
export async function aiFix(project, { step, model, deep = false, provider: requested, mode = 'fix' } = {}) {
  if (!step || step === true) throw new EngineError(msg('aifix.missingStep'), 'usage', 2);
  const status = await accountStatus();
  const provider = chooseProvider({ features: status.features || null, requested });
  const chosenModel = pickModel({ provider, deep, explicit: model, status, mode });
  const { prompt, stepLabel } = buildPrompt(project, step);
  const system = t(mode === 'explain' ? 'ai.system.explain' : 'ai.system.fix');
  const d = detect(project.path);
  const label = t(mode === 'explain' ? 'ai.step.explainLabel' : 'ai.step.label');
  ev.step('ai', { label, category: 'AI', status: 'running', summary: t('ai.step.thinking', { model: chosenModel || t('ai.step.cloudModel'), provider }) });

  let text = '';
  const usage = { input: 0, output: 0, model: chosenModel };
  const t0 = Date.now();
  try {
    const params =
      provider === 'cloud'
        ? { prompt, system, step, project: { framework: d.framework, pm: d.packageManager }, locale: currentLang(), deep, model: model && model !== true ? model : undefined, mode }
        : { model: chosenModel, system, messages: [{ role: 'user', content: prompt }], maxTokens: mode === 'explain' ? 1500 : 8000, effort: deep ? 'high' : 'medium' };
    for await (const e of stream(provider, params)) {
      if (e.type === 'delta') {
        text += e.text;
        emit({ type: 'ai', delta: e.text });
      } else if (e.type === 'usage') {
        if (e.input != null) usage.input = e.input;
        if (e.output != null) usage.output = e.output;
        if (e.model) usage.model = e.model;
        if (e.charged != null) usage.charged = e.charged;
        if (e.balance != null) usage.balance = e.balance;
      }
    }
  } catch (e) {
    ev.step('ai', { label, category: 'AI', status: 'fail', summary: e.message, duration: (Date.now() - t0) / 1000 });
    addHistory({ project: project.key, projectName: project.name, kind: 'ai-fix', status: 'fail', message: `${stepLabel}: ${e.message}` });
    throw e;
  }
  const duration = (Date.now() - t0) / 1000;
  const tokens = usage.charged ?? usage.input + usage.output;

  let result = { provider, model: usage.model, mode, step, stepLabel, answer: text, usage, duration };
  if (mode === 'fix') {
    const parsed = parseAnswer(text);
    const planned = planPatch(project.path, parsed);
    const files = planned.map(({ after, ...rest }) => rest); // file bodies stay in the patch file, not in the result
    const applicable = files.filter((f) => f.applicable).length;
    const patchFile = path.join(logDir(project.key), `ai-patch-${step}-${Date.now()}.json`);
    writeJSON(patchFile, { project: project.key, projectPath: project.path, step, model: usage.model, provider, createdAt: nowISO(), parsed, planned });
    prunePatches(project.key);
    result = { ...result, explanation: parsed.explanation, patchFile, files, applicable };
    ev.step('ai', {
      label,
      category: 'AI',
      status: files.length ? 'pass' : 'warn',
      summary: files.length ? t('ai.step.done', { count: applicable, total: files.length }) : t('ai.step.noChanges'),
      details: files.map((f) => `${f.applicable ? '✓' : '✗'} ${f.path} (+${f.additions} −${f.deletions})${f.error ? ` — ${t(reasonKey(f.error))}` : ''}`),
      duration,
    });
  } else {
    result.explanation = text.trim();
    ev.step('ai', { label, category: 'AI', status: 'pass', summary: t('ai.step.explained'), duration });
  }
  addHistory({ project: project.key, projectName: project.name, kind: 'ai-fix', status: 'ok', message: `${mode}: ${stepLabel}`, duration });
  recordCost({ project: project.key, projectName: project.name, service: provider === 'cloud' ? 'ai-cloud' : `ai-${provider}`, op: mode, amount: tokens, unit: 'tokens', estimated: false, ref: usage.model });
  return result;
}

/** Applies a patch produced by `aiFix`. Re-plans against the current files first, so a file edited since is reported, not clobbered. */
export async function aiApply(project, { patchFile, files, yes = false, commit = false, recheck = false } = {}) {
  if (!yes) throw new EngineError(msg('ai.apply.confirmRequired'), 'confirm_required', 2);
  if (!patchFile || patchFile === true) throw new EngineError(msg('ai.apply.missingPatch'), 'usage', 2);
  const abs = path.resolve(patchFile);
  const dir = path.resolve(logDir(project.key)) + path.sep;
  const patch = abs.startsWith(dir) && abs.endsWith('.json') ? readJSON(abs, null) : null;
  if (!patch || patch.project !== project.key || !patch.parsed) throw new EngineError(msg('ai.apply.badPatch'), 'bad_patch');

  const fresh = planPatch(project.path, patch.parsed);
  const before = new Map((patch.planned || []).map((p) => [p.path, p.after]));
  for (const p of fresh) p.changedSince = p.applicable && before.has(p.path) && before.get(p.path) !== p.after;
  const selected = files && files !== true ? String(files).split(',').map((s) => s.trim()).filter(Boolean) : null;
  ev.step('ai-apply', { label: t('ai.apply.label'), category: 'AI', status: 'running' });
  // undo record (V11): what every file looked like before, so `ai undo` can put it back
  const willWrite = fresh.filter((p) => p.applicable && (!selected || selected.includes(p.path)));
  const undo = willWrite.map((p) => {
    let before = null;
    try {
      before = fs.readFileSync(path.join(project.path, p.path), 'utf8');
    } catch {}
    return { path: p.path, before, after: p.after ?? null, action: p.action };
  });
  const { applied, skipped } = applyPatch(project.path, fresh, selected);
  let undoFile = null;
  if (applied.length) {
    undoFile = writeUndoRecord(project.key, { project: project.key, step: patch.step, at: nowISO(), files: undo.filter((u) => applied.includes(u.path)) });
    setState(project.key, { aiUndo: { file: undoFile, at: nowISO(), step: patch.step, applied } });
  }

  let committed = null;
  if (commit && applied.length && detect(project.path).git.isRepo) {
    const add = sh('git', ['add', '--', ...applied], { cwd: project.path });
    const c = add.code === 0 ? sh('git', ['commit', '-m', `AI fix (${patch.step}): ${applied.join(', ')}`], { cwd: project.path }) : add;
    committed = c.code === 0 ? sh('git', ['rev-parse', '--short', 'HEAD'], { cwd: project.path }).stdout.trim() : null;
  }
  const relevantSkips = skipped.filter((s) => s.reason !== 'not_selected');
  ev.step('ai-apply', {
    label: t('ai.apply.label'),
    category: 'AI',
    status: applied.length ? 'pass' : 'fail',
    summary: applied.length ? t('ai.apply.done', { count: applied.length }) : t('ai.apply.nothing'),
    details: relevantSkips.map((s) => `✗ ${s.path} — ${t(reasonKey(s.reason))}`),
  });
  addHistory({ project: project.key, projectName: project.name, kind: 'ai-apply', status: applied.length ? 'ok' : 'fail', message: applied.join(', ') || t('ai.apply.nothing') });
  if (applied.length && !relevantSkips.length) {
    try {
      fs.unlinkSync(abs); // everything landed — the proposal is no longer needed
    } catch {}
  }
  const out = { applied, skipped, committed, changedSince: fresh.filter((p) => p.changedSince).map((p) => p.path), undoFile };
  if (recheck && applied.length) out.recheck = await verifyAfterFix(project, patch.step);
  return out;
}

/**
 * Undo records hold the previous content of the user's files (V11 RC). They live apart from logs and caches —
 * `~/Library/Application Support/BeforeIDeploy/undo/<project>/`, folder 0700, files 0600 — so the support
 * report (which only packs *.log under the cache folder), the AI context (project files only) and telemetry
 * never see them. Retention: the newest 10 per project and nothing older than 30 days.
 */
export const UNDO_DIR = (key) => path.join(APP_DIR, 'undo', key);
const UNDO_KEEP = 10;
const UNDO_MAX_AGE_MS = 30 * 86400_000;

export function writeUndoRecord(key, record) {
  const dir = UNDO_DIR(key);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {}
  const file = path.join(dir, `ai-undo-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
  pruneUndo(key);
  return file;
}

export function pruneUndo(key) {
  const dir = UNDO_DIR(key);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.startsWith('ai-undo-') && f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const removed = [];
  const now = Date.now();
  names.forEach((f, i) => {
    const stamp = Number(f.slice('ai-undo-'.length, -'.json'.length));
    const old = Number.isFinite(stamp) && now - stamp > UNDO_MAX_AGE_MS;
    if (old || i < names.length - UNDO_KEEP) {
      try {
        fs.rmSync(path.join(dir, f), { force: true });
        removed.push(f);
      } catch {}
    }
  });
  return removed;
}

/** Re-runs the checks after an AI patch and says whether the step it targeted now passes. Never marks a fix verified on a failed run. */
async function verifyAfterFix(project, step) {
  const check = await runChecks(project, { stopOnFail: false });
  const s = check.steps.find((x) => x.id === step);
  const stepOk = !!s && ['pass', 'warn', 'info'].includes(s.status);
  const out = { status: check.status, step, stepStatus: s?.status || null, verified: stepOk, at: check.at };
  setState(project.key, { lastRecheck: { kind: 'ai', ...out } });
  return out;
}

/** Restores the files of the last `ai apply` (V11). A file the user edited since is left alone and reported. */
export async function aiUndo(project, { yes = false } = {}) {
  if (!yes) throw new EngineError(msg('ai.undo.confirmRequired'), 'confirm_required', 2);
  const st = getState(project.key);
  const rec = st.aiUndo?.file ? readJSON(st.aiUndo.file, null) : null;
  if (!rec || rec.project !== project.key) throw new EngineError(msg('ai.undo.nothing'), 'nothing');
  const restored = [];
  const skipped = [];
  for (const f of rec.files) {
    const abs = path.join(project.path, f.path);
    let current = null;
    try {
      current = fs.readFileSync(abs, 'utf8');
    } catch {}
    if (current !== f.after) {
      skipped.push({ path: f.path, reason: 'changed_since' });
      continue;
    }
    try {
      if (f.before === null) fs.rmSync(abs, { force: true });
      else fs.writeFileSync(abs, f.before);
      restored.push(f.path);
    } catch (e) {
      skipped.push({ path: f.path, reason: e.code || 'write_failed' });
    }
  }
  if (!skipped.length) {
    try {
      fs.unlinkSync(st.aiUndo.file);
    } catch {}
    setState(project.key, { aiUndo: undefined });
  }
  ev.step('ai-undo', { label: t('ai.undo.label'), category: 'AI', status: restored.length ? 'pass' : 'fail', summary: t('ai.undo.done', { count: restored.length }), details: skipped.map((s) => `✗ ${s.path} — ${s.reason}`) });
  addHistory({ project: project.key, projectName: project.name, kind: 'ai-undo', status: restored.length ? 'ok' : 'fail', message: restored.join(', ') || t('ai.undo.nothingShort') });
  return { restored, skipped };
}

/** Credits (cloud) plus the local token ledger for this month. */
export async function aiUsage() {
  const status = await accountStatus();
  const month = new Date().toISOString().slice(0, 7);
  const entries = listLedger({ limit: 2000 }).filter((e) => e.ts.startsWith(month) && /^ai-/.test(e.service));
  const byProvider = {};
  for (const e of entries) {
    const k = e.service.replace(/^ai-/, '');
    byProvider[k] = byProvider[k] || { requests: 0, tokens: 0 };
    byProvider[k].requests++;
    byProvider[k].tokens += e.amount || 0;
  }
  return {
    month,
    role: status.role || null,
    plan: status.plan || null,
    credits: status.credits || null,
    features: status.features || null,
    local: { requests: entries.length, tokens: entries.reduce((a, e) => a + (e.amount || 0), 0), byProvider },
  };
}
