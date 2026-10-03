// Embedded AI assistant (V11 RC): one conversation per project, a fixed set of actions, structured answers.
//
//   bid ai chat --project P --action ask|diagnose|propose|review|explain|readiness|triage|fix
//               [--message "…"] [--issue ID] [--files a,b] [--patch-file F] [--allow-create a,b] [--budget N] [--yes] [--new]
//   bid ai history --project P [--limit N]        bid ai settings [--json '{…}']       bid ai prompts
//
// What the model gets is decided here, never by the model: evidence blocks with ids (issue, check logs,
// selected files, git, deployments, incidents), each redacted (aifix.redact) and size-capped, listed to the
// app in an `info` event BEFORE the request goes out. What comes back is a JSON object validated against
// the prompt's output schema (engine/prompts/*.json): unknown evidence ids, paths outside the allowed set,
// an "engine status" the model changed — all rejected. One bounded repair round is allowed; a still-invalid
// answer ends the operation as `invalid_output`, never as a guess.
//
// Actions never execute anything on their own. `propose` writes a patch file the user applies with
// `ai apply --yes`; `fix` (analyze → patch → apply → verify) runs only with --yes or the auto-apply setting
// for patches the ENGINE rates low-risk (never config, scripts or new files), is bounded by iterations and a token budget, stops on no progress, and undoes a
// change that made the check worse. Deploy, restore, billing, secrets and project deletion are not tools
// of the assistant at all.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_DIR, EngineError, ev, emit, logDir, nowISO, readJSON, writeJSON, sh, appendBounded } from '../util.mjs';
import { t, msg, currentLang } from '../i18n.mjs';
import { detect } from '../detect.mjs';
import { getState, setState, addHistory, listHistory } from '../store.mjs';
import { deriveIssues } from '../issues.mjs';
import { redact, REDACTION_MARKERS } from '../aifix.mjs';
import { newNonce, clean, fence, untrusted, restateRules } from './untrusted.mjs';
import { safePath, plan as planPatch } from './patch.mjs';
import { resolveInProject } from '../pathpolicy.mjs';
import { chooseProvider, stream } from './providers.mjs';
import { accountStatus } from '../account.mjs';
import { loadPrompt, renderPrompt, extractJSON, validateOutput, listPrompts } from './prompts.mjs';
import { aiApply, aiUndo } from './index.mjs';
import { listOps, capabilities } from '../release.mjs';
import { listIncidents } from '../monitor.mjs';
import { recordCost } from '../costs.mjs';
import { AnswerStream } from './answer-stream.mjs';
import { assistantHistory, assistantReset, appendHistory, conversationMessages, historyResult } from './conversation.mjs';
import { gitSh } from '../gitbin.mjs';
export { assistantHistory, assistantReset } from './conversation.mjs';

/** Stage labels as literal keys (scripts/i18n-check.mjs proves both languages have them). */
const STAGE_LABELS = () => ({ analyze: t('assistant.stage.analyze'), propose: t('assistant.stage.propose'), apply: t('assistant.stage.apply'), verify: t('assistant.stage.verify') });

export const ACTIONS = ['ask', 'diagnose', 'propose', 'review', 'explain', 'readiness', 'triage', 'fix'];
const TEMPLATE_FOR = { ask: 'ask', diagnose: 'diagnose_issue', propose: 'propose_patch', review: 'review_patch', explain: 'explain_verification', readiness: 'release_readiness', triage: 'incident_triage', fix: 'propose_patch' };

/** Tools the app may run after validating an answer — informative for the model, enforced by the engine. */
const TOOLS = ['run_check(project) — re-run the project checks', 'apply_patch(patch_file) — requires the user\'s confirmation (--yes) unless auto-apply for low-risk patches is on', 'verify_fix(step) — re-run the check for one step', 'undo_last_change() — restore the files of the last applied patch'];

export const DEFAULT_SETTINGS = {
  autoApplyLowRisk: false, // apply a low-risk patch without a per-patch confirmation (never deploy/restore/billing)
  maxIterations: 3, // analyze → patch → verify rounds per `fix`
  maxTokensPerOperation: 60000, // input + output across all rounds
  maxContextChars: 48000, // evidence sent per request
  maxFileChars: 24000, // one file snapshot
  maxFiles: 8,
  callTimeoutMs: 120000,
  cloudEngine: 'claude', // which AI answers through the cloud: claude (Anthropic) or codex (OpenAI)
};
export const CLOUD_ENGINES = ['claude', 'codex'];
const SETTINGS_FILE = () => path.join(APP_DIR, 'ai-settings.json');
/** The engine the owner chose for the cloud AI (ai-fix, the assistant, site-gen); Claude unless set. */
export function cloudEngine() {
  const v = assistantSettings().cloudEngine;
  return CLOUD_ENGINES.includes(v) ? v : 'claude';
}
export function assistantSettings() {
  return { ...DEFAULT_SETTINGS, ...(readJSON(SETTINGS_FILE(), {}) || {}) };
}
export function setAssistantSettings(patch) {
  const cur = assistantSettings();
  const next = { ...cur };
  if (patch.autoApplyLowRisk !== undefined) next.autoApplyLowRisk = !!patch.autoApplyLowRisk;
  if (patch.maxIterations !== undefined) next.maxIterations = Math.min(5, Math.max(1, Math.round(Number(patch.maxIterations) || 1)));
  if (patch.maxTokensPerOperation !== undefined) next.maxTokensPerOperation = Math.min(400000, Math.max(4000, Math.round(Number(patch.maxTokensPerOperation) || 4000)));
  if (patch.callTimeoutMs !== undefined) next.callTimeoutMs = Math.min(600000, Math.max(1000, Math.round(Number(patch.callTimeoutMs) || 1000)));
  if (patch.maxContextChars !== undefined) next.maxContextChars = Math.min(200000, Math.max(4000, Math.round(Number(patch.maxContextChars) || 4000)));
  if (patch.cloudEngine !== undefined) next.cloudEngine = CLOUD_ENGINES.includes(patch.cloudEngine) ? patch.cloudEngine : 'claude';
  writeJSON(SETTINGS_FILE(), next);
  return next;
}

// ---------------------------------------------------------------- evidence

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function tailText(file, lines) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/**
 * One redacted, capped evidence block. `redactions` counts what was masked so the app can say so.
 * `altered` / `truncated` (and `omitted`, set when the context is trimmed) mean the model did not see the
 * file as it is on disk — such a file is read-only for a patch (V13 S5). `list.nonce` is the request's
 * fence nonce; the text is neutralized against it.
 */
function block(list, kind, label, raw, cap) {
  const text = String(raw || '');
  const red = clean(text, list.nonce);
  const redactions = (red.match(/\[[A-Z_]+\]/g) || []).length - (text.match(/\[[A-Z_]+\]/g) || []).length;
  const truncated = red.length > cap;
  const cut = truncated ? red.slice(0, cap) + `\n… (${red.length - cap} chars omitted)` : red;
  const id = `E${list.length + 1}`;
  list.push({ id, kind, label, chars: cut.length, redactions: Math.max(0, redactions), text: cut, altered: red !== text, truncated, omitted: false });
  return id;
}

function issueById(project, id) {
  const st = getState(project.key);
  const d = detect(project.path);
  const issues = deriveIssues(st.check, { gitInstalled: true, hasGitignore: !!d.hasGitignore, hostingLoggedIn: true }).issues;
  if (!id) return { issues, issue: null };
  const issue = issues.find((i) => i.id === id);
  if (!issue) throw new EngineError(msg('assistant.issueNotFound', { id }), 'not_found');
  return { issues, issue };
}

function fileSnapshots(project, files, settings, evidence) {
  const out = [];
  for (let rel of files.slice(0, settings.maxFiles)) {
    // secrets never enter a model context, however they were selected (WP01)
    const r = resolveInProject(project.path, rel, { op: 'read' });
    if (!r.ok && r.reason === 'secret') throw new EngineError(msg('assistant.secretFile', { path: rel }), 'secret_file', 2);
    if (!r.ok) throw new EngineError(msg('assistant.badPath', { path: rel }), 'bad_path', 2);
    const abs = r.abs;
    rel = r.rel;
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      throw new EngineError(msg('assistant.fileMissing', { path: rel }), 'not_found', 2);
    }
    const hash = sha256(content);
    const id = block(evidence, 'file', rel, content, settings.maxFileChars);
    out.push({ path: rel, hash, id, chars: content.length, content });
  }
  return out;
}

function metadata(project) {
  const d = detect(project.path);
  const git = d.git.isRepo ? `${d.git.branch || '?'}${d.git.remote ? ' (remote)' : ' (no remote)'}` : 'no git';
  return `name: ${project.name}\nframework: ${d.framework || 'static'}\npackage manager: ${d.packageManager || '—'}\npublish dir: ${d.publishDir || '—'}\nssr: ${d.ssr ? 'yes' : 'no'}\nhosting: ${project.hosting || 'netlify'}\ngit: ${git}\nlive url: ${project.liveUrl || project.netlify?.liveUrl || '—'}`;
}

function checkSummary(project) {
  const st = getState(project.key);
  const c = st.check;
  if (!c) return 'no check has run yet';
  return [`status: ${c.status} (${c.at})`, ...c.steps.map((s) => `- ${s.id}: ${s.status}${s.summary ? ` — ${s.summary}` : ''}`)].join('\n');
}

/** Evidence blocks, each fenced with the request's nonce (V13 S1). */
function evidenceText(list) {
  return list.map((e) => fence(list.nonce, `[${e.id}] ${e.kind}: ${clean(e.label, list.nonce)}`, e.text)).join('\n\n') || 'No evidence blocks were selected. Only the supplied project metadata and check results are available.';
}

// ---------------------------------------------------------------- patch scope and risk (V13)

const OMISSION_MARKERS = [/… \(\d+ chars omitted\)/g, /\(omitted: \d+ chars/g, /UNTRUSTED_DATA/g, /\[nonce\]/g];
const count = (text, m) => (typeof m === 'string' ? String(text).split(m).length - 1 : (String(text).match(m) || []).length);

/**
 * What a valid patch may still not do, checked in code after the schema: change a file the model saw only
 * redacted/truncated/omitted, create a file the user did not allow, empty a file with a content-less
 * replace, or write a redaction placeholder / omission marker it never saw on disk (V13 S4, S5, S3).
 */
function patchProblems(out, scope, nonce) {
  const errors = [];
  if (!out || out.status !== 'patch' || !Array.isArray(out.changes)) return errors;
  out.changes.forEach((c, i) => {
    if (!c || typeof c !== 'object') return;
    const at = `$.changes[${i}]`;
    if (scope.readOnly.has(c.path)) errors.push(`${at}.path: ${c.path} was shown redacted or truncated (READ-ONLY) and cannot be changed`);
    if (c.action === 'create' && !scope.allowNew.has(c.path)) errors.push(`${at}: creating ${c.path} was not allowed by the user`);
    if (c.action !== 'create' && scope.allowNew.has(c.path)) errors.push(`${at}: ${c.path} does not exist yet; it can only be created`);
    if (c.action !== 'replace' && c.action !== 'create') return;
    if (typeof c.content !== 'string') return errors.push(`${at}.content: required for ${c.action}`);
    if (c.action === 'replace' && !c.content.trim()) errors.push(`${at}.content: empty — a replace carries the complete new file; use delete to remove a file`);
    const before = scope.original.get(c.path) ?? '';
    for (const m of [...REDACTION_MARKERS, ...OMISSION_MARKERS, nonce]) {
      if (m && count(c.content, m) > count(before, m)) errors.push(`${at}.content: contains ${typeof m === 'string' ? (m === nonce ? 'the request nonce' : m) : 'an omission marker'} — a placeholder for content the model never saw`);
    }
  });
  return errors;
}

const RISK = ['low', 'medium', 'high'];
const SCRIPT_PATH = /(^|\/)(scripts?|bin|\.husky|\.github|hooks)\/|\.(sh|bash|zsh|command|ps1|bat|cmd)$|(^|\/)(makefile|dockerfile|procfile|justfile)$/i;
const SERVER_PATH = /(^|\/)(api|functions|edge-functions|server|middleware)(\/|\.)/i;
const REMOTE_SCRIPT = /<script\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i;
const RUNS_CODE = /\bchild_process\b|\bexecSync\s*\(|\bspawnSync?\s*\(|\beval\s*\(|\bnew\s+Function\s*\(|\bimport\s*\(\s*["'`]https?:/;
const NETWORK = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|\bWebSocket\s*\(|\bhttps?\.(request|get)\s*\(/;

/** Lines added and removed (as multisets — order-insensitive, good enough for a size/risk estimate). */
function lineDelta(before, after) {
  const left = new Map();
  for (const l of String(before).split('\n')) left.set(l, (left.get(l) || 0) + 1);
  const added = [];
  for (const l of String(after).split('\n')) {
    const n = left.get(l) || 0;
    if (n) left.set(l, n - 1);
    else added.push(l);
  }
  const removed = [...left.values()].reduce((a, n) => a + n, 0);
  return { added, removed };
}

/**
 * The patch's risk, decided by the engine from what the planned change does — never by the model, which
 * can only raise it (V13 S2). `autoApply` is false for anything that touches config or scripts, creates or
 * deletes files, adds a remote <script> or code that runs programs: auto-apply never covers those.
 */
export function engineRisk(planned, original, modelRisk = null) {
  let level = 0;
  let autoApply = true;
  const reasons = [];
  const raise = (l, reason, noAuto = false) => {
    level = Math.max(level, RISK.indexOf(l));
    reasons.push(reason);
    if (noAuto) autoApply = false;
  };
  let changed = 0;
  for (const p of planned) {
    const before = p.action === 'create' ? '' : original.get(p.path) ?? '';
    const { added, removed } = p.action === 'delete' ? { added: [], removed: before.split('\n').length } : lineDelta(before, p.after ?? '');
    changed += added.length + removed;
    const addedText = added.join('\n');
    if (p.cls === 'config' || p.needsApproval) raise('high', `config: ${p.path}`, true);
    if (SCRIPT_PATH.test(p.path)) raise('high', `script: ${p.path}`, true);
    if (p.action === 'create') raise('high', `new file: ${p.path}`, true);
    if (p.action === 'delete') raise('high', `deleted: ${p.path}`, true);
    if (REMOTE_SCRIPT.test(addedText)) raise('high', `remote script: ${p.path}`, true);
    if (RUNS_CODE.test(addedText)) raise('high', `runs code: ${p.path}`, true);
    if (SERVER_PATH.test(p.path)) raise('medium', `server code: ${p.path}`);
    if (NETWORK.test(addedText)) raise('medium', `network call: ${p.path}`);
  }
  if (planned.length > 2) raise('medium', `${planned.length} files`);
  if (changed > 200) raise('high', `${changed} changed lines`);
  else if (changed > 40) raise('medium', `${changed} changed lines`);
  if (RISK.indexOf(modelRisk) > level) raise(modelRisk, `model: ${modelRisk}`);
  return { level: RISK[level], reasons, autoApply: autoApply && level === 0 };
}

/** Files the issue points at (its evidence file + files mentioned in the failing step log). */
function issueFiles(project, issue) {
  const out = new Set();
  if (issue?.evidence?.file && safePath(project.path, issue.evidence.file) && fs.existsSync(path.join(project.path, issue.evidence.file))) out.add(issue.evidence.file);
  const log = issue?.evidence?.log ? tailText(issue.evidence.log, 120) : '';
  for (const m of log.matchAll(/(?:^|[\s"'(])((?:src|app|pages|components|lib|public)\/[\w./-]+\.[a-z]{1,5})/g)) {
    if (safePath(project.path, m[1]) && fs.existsSync(path.join(project.path, m[1]))) out.add(m[1]);
  }
  return [...out].slice(0, 6);
}

// ---------------------------------------------------------------- the model call

async function callModel({ provider, model, system, prompt, action, project, settings, budget, conversation = [], field = 'answer', calls }) {
  // last line of defence: whatever an action put into the prompt, secrets never leave the Mac (V13 S6)
  prompt = redact(prompt);
  conversation = conversation.map((m) => ({ ...m, content: redact(m.content) }));
  const estimate = Math.ceil((system.length + prompt.length + conversation.reduce((n, m) => n + m.content.length, 0)) / 4);
  if (budget.used + estimate > budget.limit) throw new EngineError(msg('assistant.budgetExceeded', { need: estimate, left: Math.max(0, budget.limit - budget.used) }), 'budget_exceeded');
  const d = detect(project.path);
  const controller = new AbortController();
  const params = provider === 'cloud'
    ? { prompt, system, operationId: crypto.randomUUID(), step: `assistant:${action}`, project: { key: project.key, framework: d.framework, pm: d.packageManager }, locale: currentLang(), deep: false, model: model || undefined, mode: 'assistant' }
    : { model, system, messages: [...conversation, { role: 'user', content: prompt }], maxTokens: Math.max(1, Math.min(6000, budget.limit - budget.used - estimate)), effort: 'medium' };
  params.signal = controller.signal;
  params.idleMs = Math.min(settings.callTimeoutMs, Number(process.env.BID_AI_IDLE_MS) || Infinity);
  let text = '', expired = 0;
  let idleTimer;
  const armIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { expired = params.idleMs / 1000; controller.abort(); }, params.idleMs); };
  armIdle();
  const usage = { input: 0, output: 0, model };
  const answer = new AnswerStream(field);
  const timer = setTimeout(() => { expired = 300; controller.abort(); }, 300000);
  budget.calls++;
  try {
    for await (const e of stream(provider, params)) {
      armIdle();
      if (e.type === 'delta') {
        text += e.text;
        if (text.length > 256000) { controller.abort(); throw new EngineError(msg('assistant.invalidOutput', { count: 1 }), 'ai_failed'); }
        const delta = answer.push(e.text);
        if (delta) emit({ type: 'ai', field: 'answer', delta });
      } else if (e.type === 'usage') {
        for (const key of ['input', 'output', 'model', 'charged', 'balance']) if (e[key] != null) usage[key] = e[key];
      }
    }
    if (!usage.input) usage.input = estimate;
    if (!usage.output) usage.output = Math.ceil(text.length / 4);
    return { text, usage };
  } catch (error) {
    if (expired) throw new EngineError(msg('assistant.timeout', { seconds: Math.round(expired) }), 'ai_timeout');
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(idleTimer);
    controller.abort();
    // The generation budget is a text-size limit; provider credits have a separate monetary unit.
    budget.used += usage.input + usage.output;
    calls.push({ ...usage, ...(params.operationId ? {operationId:params.operationId} : {}) });
  }
}

/** Parse + validate, with one bounded repair round on an invalid answer. */
async function structured(ctx, prompt, refs, vars, { rules = [], extraCheck = null } = {}) {
  const conversation = ctx.provider === 'cloud' && ctx.conversation.length ? untrusted(ctx.nonce, 'conversation history', JSON.stringify(ctx.conversation)) : '';
  // the rules come again AFTER the data, so nothing inside a data block is the last word (V13 S1)
  const rendered = `${renderPrompt(prompt, { ...vars, conversation })}\n\n${restateRules(ctx.nonce, { evidenceIds: [...(refs.evidence || [])], extra: rules })}`;
  ctx = { ...ctx, field: ['answer', 'summary', 'observed_impact'].find(k => prompt.output?.properties?.[k]?.type === 'string') || '__none__' };
  const validate = (output) => {
    if (!output) return { ok: false, errors: ['no JSON object in the answer'] };
    const v = validateOutput(prompt, output, refs);
    const more = extraCheck ? extraCheck(output) : [];
    return more.length ? { ok: false, errors: [...v.errors, ...more] } : v;
  };
  emit({ type: 'ai', reset: true });
  let { text, usage } = await callModel({ ...ctx, prompt: rendered });
  let output = extractJSON(text);
  let v = validate(output);
  let repairs = 0;
  if (!v.ok && ctx.budget.used < ctx.budget.limit) {
    repairs = 1;
    ev.step(`assistant-${ctx.stageId || 'analyze'}`, { label: STAGE_LABELS()[ctx.stageId || 'analyze'], category: 'AI', status: 'running', summary: t('assistant.repairing', { count: v.errors.length }) });
    emit({ type: 'ai', reset: true });
    const fix = `${rendered}\n\nYour previous answer was rejected by the application:\n- ${v.errors.slice(0, 12).join('\n- ')}\n\nReturn only the corrected JSON object with exactly the required fields.`;
    const second = await callModel({ ...ctx, prompt: fix });
    usage = mergeUsage(usage, second.usage);
    text = second.text;
    output = extractJSON(text);
    v = validate(output);
  }
  return { output: v.ok ? output : null, valid: v.ok, errors: v.errors, repairs, usage, raw: text };
}

// ---------------------------------------------------------------- actions

export async function assistantChat(project, opts = {}) {
  const action = opts.action || 'ask';
  if (!ACTIONS.includes(action)) throw new EngineError(msg('assistant.unknownAction', { action }), 'usage', 2);
  const settings = assistantSettings();
  const history = assistantHistory(project, { limit: 200 });
  const conversation = opts.newConversation || !history.conversation ? crypto.randomBytes(6).toString('hex') : history.conversation;
  const message = opts.message && opts.message !== true ? String(opts.message) : '';
  const started = Date.now();
  const entry = { historyId: crypto.randomUUID(), at: nowISO(), conversation, action, message,
    request: { action, message, issue: typeof opts.issue === 'string' ? opts.issue : null, files: typeof opts.files === 'string' ? opts.files : null,
      provider: typeof opts.provider === 'string' ? opts.provider : null, model: typeof opts.model === 'string' ? opts.model : null, patchFile: typeof opts.patchFile === 'string' ? opts.patchFile : null, allowCreate: typeof opts.allowCreate === 'string' ? opts.allowCreate : null } };
  // The UI must keep the durable identity even when provider selection or generation fails.
  emit({ type: 'info', historyId: entry.historyId, conversation });
  let status, provider, model;
  try {
    status = await accountStatus();
    provider = chooseProvider({ features: status.features || null, requested: opts.provider });
    model = provider === 'cloud' ? null : opts.model && opts.model !== true ? opts.model : provider === 'openai' ? (status.settings?.['ai.models']?.openai || 'gpt-5') : (status.settings?.['ai.models']?.standard || 'claude-opus-5-5');
    entry.provider = provider;
  } catch (error) {
    appendHistory(project.key, { ...entry, valid: false, error: error.message, code: error.code, duration: (Date.now() - started) / 1000 });
    throw error;
  }
  const budget = { limit: Math.min(settings.maxTokensPerOperation, Number(opts.budget) || settings.maxTokensPerOperation), used: 0, calls: 0 };
  const system = renderPrompt(loadPrompt('system'), { locale: currentLang() === 'bg' ? 'Bulgarian (bg)' : 'English (en)', project_name: 'selected website', tools: TOOLS.map((x) => `- ${x}`).join('\n') });
  // one random fence nonce per request: untrusted data cannot close its block or forge one (V13 S1)
  const nonce = newNonce();
  const ctx = { provider, model, system, action, project, settings, budget, nonce, calls: [], conversation: conversationMessages(history.entries, conversation) };
  let stopped = null;
  const evidence = [];
  evidence.nonce = nonce;
  const data = (header, raw) => untrusted(nonce, header, raw);
  const refs = { evidence: new Set() };
  const stages = new Map();
  const stage = (id, fields) => { ctx.stageId = id; stages.set(id, fields.status); ev.step(`assistant-${id}`, { category: 'AI', label: STAGE_LABELS()[id], ...fields }); };
  const cancel = () => {
    if (entry.done) return;
    entry.done = true;
    for (const [id, state] of stages) if (state === 'running') stage(id, { status: 'skipped', summary: t('run.cancelled') });
    try { appendHistory(project.key, { ...entry, valid: false, stopped: 'cancelled', code: 'cancelled', done: true, usage: { input: budget.used, output: 0 } }); } catch {}
  };
  // Run before util's signal handler emits the single final result and exits.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.prependOnceListener(signal, cancel);

  const finish = (result) => {
    entry.done = true;
    const summary = result.output ? summarize(action, result.output) : null;
    const full = { historyId: entry.historyId, conversation, action, provider, model: result.usage?.model || model, ...result,
      evidence: evidence.map(({ text: _t, ...e }) => e), budget: { ...budget }, duration: (Date.now() - started) / 1000 };
    appendHistory(project.key, { ...entry, template: result.template, valid: result.valid, stopped: result.stopped,
      summary, usage: result.usage, duration: full.duration, patchFile: result.patchFile || null, result: historyResult(full) });
    addHistory({ project: project.key, projectName: project.name, kind: 'assistant', status: result.valid && !result.stopped ? 'ok' : 'fail', message: `${action}${summary ? `: ${summary.slice(0, 120)}` : ''}${result.stopped ? ` (${result.stopped})` : ''}`, duration: (Date.now() - started) / 1000 });
    if (result.usage?.input || result.usage?.output) {
      recordCost({ project: project.key, projectName: project.name, service: provider === 'cloud' ? 'ai-cloud' : `ai-${provider}`, op: `assistant:${action}`, amount: result.usage.charged ?? result.usage.input + result.usage.output, unit: result.usage.charged != null ? 'credits' : 'tokens', estimated: false, ref: result.usage.model || null });
    }
    return full;
  };
  const announce = (extra = {}) => {
    const estimate = Math.ceil((system.length + evidence.reduce((n, e) => n + e.chars, 0)) / 4);
    emit({ type: 'info', message: t('assistant.contextReady', { items: evidence.length, tokens: estimate }), context: { evidence: evidence.map(({ text: _t, ...e }) => e), estimateTokens: estimate, budget: { limit: budget.limit, used: budget.used }, provider, model, template: extra.template || null } });
    if (estimate > settings.maxContextChars / 4) {
      // drop the largest file blocks first until the context fits
      const files = evidence.filter((e) => e.kind === 'file').sort((a, b) => b.chars - a.chars);
      for (const f of files) {
        f.text = `(omitted: ${f.chars} chars, over the context budget)`;
        f.chars = f.text.length;
        f.omitted = true;
        if (Math.ceil((system.length + evidence.reduce((n, e) => n + e.chars, 0)) / 4) <= settings.maxContextChars / 4) break;
      }
    }
  };

  try {
  const meta = metadata(project);
  const checks = checkSummary(project);
  // A review is bound to its saved patch, even after the selected/current issue has changed.
  const { issue, issues } = issueById(project, action !== 'review' && opts.issue && opts.issue !== true ? String(opts.issue) : null);
  const files = opts.files && opts.files !== true ? String(opts.files).split(',').map((s) => s.trim()).filter(Boolean) : [];

  // ---- evidence per action
  let prompt;
  let vars;
  if (action === 'ask' || action === 'diagnose') {
    prompt = loadPrompt(TEMPLATE_FOR[action]);
    if (action === 'diagnose' && !issue) throw new EngineError(msg('assistant.issueRequired'), 'usage', 2);
    if (action === 'ask' && !message) throw new EngineError(msg('assistant.messageRequired'), 'usage', 2);
    if (issue) {
      block(evidence, 'issue', issue.title, `${issue.severity} / ${issue.kind} / ${issue.confidence}\n${issue.impact}\n${issue.evidence?.detail || ''}`, 4000);
      if (issue.evidence?.log) block(evidence, 'log', path.basename(issue.evidence.log), tailText(issue.evidence.log, 80), 6000);
    } else if (action === 'ask') {
      for (const i of issues.slice(0, 8)) block(evidence, 'issue', i.title, `${i.severity} / ${i.kind}: ${i.impact}`, 600);
    }
    fileSnapshots(project, [...new Set([...(issue ? issueFiles(project, issue) : []), ...files])], settings, evidence);
    const d = detect(project.path);
    if (d.git.isRepo) block(evidence, 'git', 'git diff --stat HEAD', gitSh(['diff', '--stat', 'HEAD'], { cwd: project.path }).stdout, 2000);
    for (const e of evidence) refs.evidence.add(e.id);
    stage('analyze', { status: 'running', summary: t('assistant.stage.analyzing', { model: model || t('ai.step.cloudModel') }) });
    announce({ template: `${prompt.id}.v${prompt.version}` });
    vars = action === 'ask'
      ? { question: message, evidence: evidenceText(evidence), project_metadata: data('project metadata', meta), check_results: data('check results', checks) }
      : { issue: clean(`${issue.id}: ${issue.title}\n${issue.impact}`, nonce), question: message, evidence: evidenceText(evidence), project_metadata: data('project metadata', meta), check_results: data('check results', checks) };
    const r = await structured(ctx, prompt, refs, vars);
    stage('analyze', { status: r.valid ? 'pass' : 'fail', summary: r.valid ? summarize(action, r.output) : t('assistant.invalidOutput', { count: r.errors.length }), details: r.valid ? [] : r.errors.slice(0, 10) });
    return finish({ template: `${prompt.id}.v${prompt.version}`, output: r.output, valid: r.valid, errors: r.errors, repairs: r.repairs, usage: r.usage, stopped: r.valid ? null : 'invalid_output', evidence: evidence.map(({ text: _t, ...e }) => e) });
  }

  if (action === 'propose' || action === 'fix') {
    if (!issue) throw new EngineError(msg('assistant.issueRequired'), 'usage', 2);
    prompt = loadPrompt('propose_patch');
    const targetFiles = [...new Set([...issueFiles(project, issue), ...files])];
    if (!targetFiles.length) throw new EngineError(msg('assistant.noFiles'), 'usage', 2);
    // new files only where the user explicitly allowed them (--allow-create a,b), never "anything in the folder" (V13 S3)
    const allowNew = new Set();
    for (const rel of opts.allowCreate && opts.allowCreate !== true ? String(opts.allowCreate).split(',').map((x) => x.trim()).filter(Boolean) : []) {
      const r = resolveInProject(project.path, rel, { op: 'create' });
      if (!r.ok && r.reason !== 'config_needs_approval') throw new EngineError(msg('assistant.badPath', { path: rel }), 'bad_path', 2);
      if (fs.existsSync(path.join(project.path, r.rel))) throw new EngineError(msg('assistant.createExists', { path: r.rel }), 'bad_path', 2);
      allowNew.add(r.rel);
    }
    const maxIter = action === 'fix' ? settings.maxIterations : 1;
    let feedback = '';
    let lastResult = null;
    const failingBefore = new Set((getState(project.key).check?.steps || []).filter((s) => s.status === 'fail').map((s) => s.id));
    let lastFailing = null;
    let applied = null;
    let recheck = null;
    let undone = false;
    for (let iter = 1; iter <= maxIter; iter++) {
      evidence.length = 0;
      refs.evidence = new Set();
      block(evidence, 'issue', issue.title, `${issue.severity} / ${issue.kind} / ${issue.confidence}\n${issue.impact}\n${issue.evidence?.detail || ''}`, 4000);
      if (issue.evidence?.log) block(evidence, 'log', path.basename(issue.evidence.log), tailText(issue.evidence.log, 80), 6000);
      const snaps = fileSnapshots(project, targetFiles, settings, evidence);
      for (const e of evidence) refs.evidence.add(e.id);
      stage('propose', { status: 'running', summary: t('assistant.stage.proposing', { iteration: iter, max: maxIter }) });
      announce({ template: `${prompt.id}.v${prompt.version}` });
      // exactly the listed files the model saw verbatim; a redacted, truncated or omitted file is read-only (V13 S3, S5)
      const blockOf = (s) => evidence.find((e) => e.id === s.id);
      const readOnly = new Set(snaps.filter((s) => { const e = blockOf(s); return e.altered || e.truncated || e.omitted; }).map((s) => s.path));
      const writable = snaps.filter((s) => !readOnly.has(s.path)).map((s) => s.path);
      refs.allowed_paths = new Set([...writable, ...allowNew]);
      if (!refs.allowed_paths.size) throw new EngineError(msg('assistant.readOnlyContext', { files: [...readOnly].join(', ') }), 'read_only_context', 2);
      const scope = { readOnly, allowNew, original: new Map(snaps.map((s) => [s.path, s.content])) };
      const list = (xs) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- (none)');
      const pkg = readJSON(path.join(project.path, 'package.json'), null);
      vars = {
        confirmed_issue: `${clean(`${issue.id}: ${issue.title}\n${issue.impact}`, nonce)}\n${message}`,
        allowed_paths: `Files you may change (exactly these):\n${list(writable)}\nNew files you may create:\n${list([...allowNew])}\nRead-only files (shown redacted or truncated; never change them):\n${list([...readOnly])}`,
        file_snapshots: snaps.map((s) => fence(nonce, `[${s.id}] ${s.path} (sha256 ${s.hash})${readOnly.has(s.path) ? ' READ-ONLY' : ''}`, blockOf(s).text)).join('\n\n'),
        project_conventions: `${data('project metadata', meta)}\n${data('package.json scripts', JSON.stringify(pkg?.scripts || {}))}\nNo new dependencies. Keep the file's existing style.`,
        feedback,
      };
      const rules = [
        `Files you may change: ${writable.join(', ') || 'none'} (exactly these files, not their folders).`,
        `New files you may create: ${[...allowNew].join(', ') || 'none'}.`,
        ...(readOnly.size ? [`Read-only files (never change them): ${[...readOnly].join(', ')}.`] : []),
        'replace and create carry the complete new file content; never write redaction placeholders or omission markers.',
      ];
      let r;
      try {
        r = await structured(ctx, prompt, refs, vars, { rules, extraCheck: (o) => patchProblems(o, scope, nonce) });
      } catch (e) {
        if (e.code === 'budget_exceeded') {
          stage('propose', { status: 'fail', summary: e.message });
          return finish({ template: `${prompt.id}.v${prompt.version}`, output: lastResult?.output || null, valid: !!lastResult?.valid, errors: [e.message], usage: lastResult?.usage || null, stopped: 'budget', iterations: iter - 1, applied, recheck });
        }
        throw e;
      }
      lastResult = lastResult ? { ...r, usage: mergeUsage(lastResult.usage, r.usage), repairs: lastResult.repairs + r.repairs } : r;
      if (!r.valid) {
        stage('propose', { status: 'fail', summary: t('assistant.invalidOutput', { count: r.errors.length }), details: r.errors.slice(0, 10) });
        return finish({ template: `${prompt.id}.v${prompt.version}`, output: null, valid: false, errors: r.errors, repairs: lastResult.repairs, usage: lastResult.usage, stopped: 'invalid_output', iterations: iter, applied, recheck });
      }
      const out = r.output;
      if (out.status !== 'patch' || !out.changes.length) {
        stage('propose', { status: 'warn', summary: out.status === 'needs_input' ? t('assistant.needsInput') : t('assistant.noChange'), details: out.missing_context || [] });
        return finish({ template: `${prompt.id}.v${prompt.version}`, output: out, valid: true, errors: [], repairs: lastResult.repairs, usage: lastResult.usage, stopped: out.status === 'needs_input' ? 'needs_input' : 'no_change', iterations: iter, applied, recheck });
      }
      // base hashes: every replaced/deleted file must still be what the model saw
      const stale = out.changes.filter((c) => c.action !== 'create').filter((c) => {
        const snap = snaps.find((s) => s.path === c.path);
        const claimed = out.base_hashes?.[c.path];
        return !snap || claimed !== snap.hash || sha256(fs.readFileSync(path.join(project.path, c.path), 'utf8')) !== snap.hash;
      });
      if (stale.length) {
        stage('propose', { status: 'fail', summary: t('assistant.staleBase', { files: stale.map((c) => c.path).join(', ') }) });
        return finish({ template: `${prompt.id}.v${prompt.version}`, output: out, valid: false, errors: stale.map((c) => `${c.path}: base hash does not match the file`), repairs: lastResult.repairs, usage: lastResult.usage, stopped: 'stale_base_hash', iterations: iter, applied, recheck });
      }
      // to the existing patch pipeline (plan → patch file → ai apply → undo record)
      // validated above: replace/create always carry content (a missing one would have emptied the file — V13 S4)
      if (out.changes.some((c) => c.action !== 'delete' && typeof c.content !== 'string')) throw new EngineError(msg('assistant.invalidOutput', { count: 1 }), 'ai_failed');
      const parsed = {
        explanation: out.summary,
        files: out.changes.map((c) => (c.action === 'delete' ? { path: c.path, action: 'delete', edits: [], content: null } : c.action === 'create' ? { path: c.path, action: 'create', edits: [], content: c.content } : { path: c.path, action: 'edit', edits: [{ search: fs.readFileSync(path.join(project.path, c.path), 'utf8'), replace: c.content }], content: null })),
      };
      const planned = planPatch(project.path, parsed);
      // the engine decides the risk from what the change does; the model's own rating can only raise it (V13 S2)
      const risk = engineRisk(planned, scope.original, out.risk);
      const patchFile = path.join(logDir(project.key), `ai-patch-${issue.step}-${Date.now()}.json`);
      writeJSON(patchFile, { project: project.key, projectPath: project.path, step: issue.step, model: r.usage.model, provider, createdAt: nowISO(), parsed, planned, assistant: { template: `${prompt.id}.v${prompt.version}`, risk: risk.level, riskReasons: risk.reasons, modelRisk: out.risk, autoApply: risk.autoApply, verification_plan: out.verification_plan, rollback_notes: out.rollback_notes, issue: issue.id } });
      const filesOut = planned.map(({ after, ...rest }) => rest);
      stage('propose', { status: 'pass', summary: t('assistant.proposed', { count: filesOut.filter((f) => f.applicable).length, risk: risk.level }), details: filesOut.map((f) => `${f.applicable ? '✓' : '✗'} ${f.path} (+${f.additions} −${f.deletions})${f.error ? ` — ${f.error}` : ''}`) });
      const base = { template: `${prompt.id}.v${prompt.version}`, output: out, valid: true, errors: [], repairs: lastResult.repairs, usage: lastResult.usage, patchFile, files: filesOut, risk: risk.level, riskReasons: risk.reasons, modelRisk: out.risk, verificationPlan: out.verification_plan, rollbackNotes: out.rollback_notes };
      if (action === 'propose') return finish({ ...base, stopped: null, iterations: iter });

      // ---- fix: apply only with consent (or auto-apply for an engine-rated low-risk patch), then verify.
      // Auto-apply is off by default and never covers config, scripts, new/deleted files or remote scripts.
      const mayApply = !!opts.yes || (settings.autoApplyLowRisk === true && risk.level === 'low' && risk.autoApply);
      if (!mayApply) {
        stage('apply', { status: 'skipped', summary: t('assistant.needsConfirmation', { risk: risk.level }) });
        return finish({ ...base, stopped: 'needs_confirmation', iterations: iter });
      }
      stage('apply', { status: 'running' });
      const ap = await aiApply(project, { patchFile, yes: true, recheck: true });
      applied = { applied: ap.applied, skipped: ap.skipped, undoFile: ap.undoFile };
      recheck = ap.recheck || null;
      stage('apply', { status: ap.applied.length ? 'pass' : 'fail', summary: ap.applied.join(', ') || t('ai.apply.nothing') });
      stage('verify', { status: recheck ? (recheck.verified ? 'pass' : 'fail') : 'skipped', summary: recheck ? (recheck.verified ? t('assistant.verified', { step: issue.step }) : t('assistant.unverified', { step: issue.step, status: recheck.stepStatus || '—' })) : t('ai.apply.nothing') });
      if (!ap.applied.length) return finish({ ...base, stopped: 'not_applicable', iterations: iter, applied, recheck });
      if (recheck?.verified) return finish({ ...base, stopped: null, iterations: iter, applied, recheck, verified: true });
      // worse than before → undo and stop; same as before → no progress after the first retry
      const failingIds = (getState(project.key).check?.steps || []).filter((s) => s.status === 'fail').map((s) => s.id).sort();
      const failingNow = failingIds.join(',');
      const worse = failingIds.some((id) => !failingBefore.has(id));
      if (worse) {
        const u = await aiUndo(project, { yes: true });
        undone = true;
        stage('verify', { status: 'fail', summary: t('assistant.regressionUndone', { files: u.restored.join(', ') }) });
        return finish({ ...base, stopped: 'regression', iterations: iter, applied, recheck, undone });
      }
      if (lastFailing !== null && failingNow === lastFailing) {
        return finish({ ...base, stopped: 'no_progress', iterations: iter, applied, recheck });
      }
      lastFailing = failingNow;
      // the log tail is untrusted and may hold secrets: redacted and fenced like any evidence (V13 S6)
      feedback = `Attempt ${iter} was applied and verified by the engine: step ${issue.step} is now "${recheck?.stepStatus}" (check status ${recheck?.status}). Still failing steps: ${failingNow || 'none'}. Log tail:\n${data('log tail', issue.evidence?.log ? tailText(issue.evidence.log, 40) : '')}`;
    }
    return finish({ template: `${prompt.id}.v${prompt.version}`, output: lastResult?.output || null, valid: !!lastResult?.valid, errors: [], repairs: lastResult?.repairs || 0, usage: lastResult?.usage || null, stopped: 'max_iterations', iterations: maxIter, applied, recheck });
  }

  if (action === 'review') {
    prompt = loadPrompt('review_patch');
    const pf = opts.patchFile && opts.patchFile !== true ? path.resolve(String(opts.patchFile)) : null;
    const dir = path.resolve(logDir(project.key)) + path.sep;
    const patch = pf && pf.startsWith(dir) ? readJSON(pf, null) : null;
    if (!patch || patch.project !== project.key) throw new EngineError(msg('ai.apply.badPatch'), 'bad_patch');
    const diff = (patch.planned || []).map((p) => p.diff).filter(Boolean).join('\n');
    block(evidence, 'diff', path.basename(pf), diff, 20000);
    const pkg = readJSON(path.join(project.path, 'package.json'), null);
    for (const e of evidence) refs.evidence.add(e.id);
    stage('analyze', { status: 'running', summary: t('assistant.stage.reviewing') });
    announce({ template: `${prompt.id}.v${prompt.version}` });
    vars = { candidate_diff: evidenceText(evidence), original_issue: `${patch.step}: ${data('proposal summary', patch.parsed?.explanation || '')}\n${message}`, project_constraints: `${data('project metadata', meta)}\nNo new dependencies, no config or secret changes.`, available_tests: clean(Object.keys(pkg?.scripts || {}).filter((s) => /test|lint|check|build/.test(s)).join(', ') || 'none', nonce) };
    const r = await structured(ctx, prompt, refs, vars);
    stage('analyze', { status: r.valid ? 'pass' : 'fail', summary: r.valid ? summarize(action, r.output) : t('assistant.invalidOutput', { count: r.errors.length }) });
    return finish({ template: `${prompt.id}.v${prompt.version}`, output: r.output, valid: r.valid, errors: r.errors, repairs: r.repairs, usage: r.usage, stopped: r.valid ? null : 'invalid_output', patchFile: pf });
  }

  if (action === 'explain') {
    prompt = loadPrompt('explain_verification');
    const st = getState(project.key);
    const result = st.lastRecheck || (st.check ? { status: st.check.status, at: st.check.at, steps: st.check.steps.map((s) => ({ id: s.id, status: s.status, summary: s.summary })), verified: null, note: 'full check result; no fix verification recorded' } : null);
    if (!result) throw new EngineError(msg('assistant.nothingToExplain'), 'nothing');
    refs.engine_status = String(result.status);
    stage('analyze', { status: 'running', summary: t('assistant.stage.explaining') });
    announce({ template: `${prompt.id}.v${prompt.version}` });
    vars = { engine_verification_result: clean(JSON.stringify(result, null, 1), nonce), locale: currentLang(), note: message };
    const r = await structured(ctx, prompt, refs, vars);
    stage('analyze', { status: r.valid ? 'pass' : 'fail', summary: r.valid ? r.output.summary : t('assistant.invalidOutput', { count: r.errors.length }), details: r.valid ? [] : r.errors.slice(0, 10) });
    return finish({ template: `${prompt.id}.v${prompt.version}`, output: r.output, valid: r.valid, errors: r.errors, repairs: r.repairs, usage: r.usage, stopped: r.valid ? null : 'invalid_output', engineStatus: refs.engine_status });
  }

  if (action === 'readiness') {
    prompt = loadPrompt('release_readiness');
    const st = getState(project.key);
    const ops = listOps(project.key, { limit: 3 });
    const caps = capabilities(project.hosting || 'netlify');
    const check = st.check;
    const d = detect(project.path);
    const gate = !check ? 'unchecked' : check.status === 'blocked' ? 'blocked' : d.ssr && !caps.publishArtifact ? 'unsupported' : 'ready';
    const gates = { status: gate, checkStatus: check?.status || null, checkedAt: check?.at || null, artifact: check?.artifact?.hash || null, identity: !d.ssr ? 'artifact' : caps.publishArtifact ? 'deployId' : 'none', requires: ['typed DEPLOY confirmation', 'unchanged source, build config and artifact since the preview', 'smoke checks on the preview'] };
    refs.engine_status = gate;
    stage('analyze', { status: 'running', summary: t('assistant.stage.readiness') });
    announce({ template: `${prompt.id}.v${prompt.version}` });
    vars = { snapshot: clean(JSON.stringify({ fingerprint: check?.fingerprint || null, buildConfig: check?.buildConfig || null, artifact: check?.artifact || null }, null, 1), nonce), check_results: data('check results', checks), preview_results: data('preview results', JSON.stringify(ops.map((o) => ({ id: o.id, state: o.state, preview: o.preview, smoke: o.smoke ? { ok: o.smoke.ok, checks: o.smoke.checks?.length } : null, failure: o.failure })), null, 1)), provider_capabilities: JSON.stringify(caps), engine_release_gates: clean(JSON.stringify(gates, null, 1), nonce), note: message };
    const r = await structured(ctx, prompt, refs, vars);
    stage('analyze', { status: r.valid ? 'pass' : 'fail', summary: r.valid ? r.output.summary : t('assistant.invalidOutput', { count: r.errors.length }), details: r.valid ? [] : r.errors.slice(0, 10) });
    return finish({ template: `${prompt.id}.v${prompt.version}`, output: r.output, valid: r.valid, errors: r.errors, repairs: r.repairs, usage: r.usage, stopped: r.valid ? null : 'invalid_output', gates });
  }

  if (action === 'triage') {
    prompt = loadPrompt('incident_triage');
    const incidents = listIncidents({ project: project.key, limit: 10 });
    if (!incidents.length) throw new EngineError(msg('assistant.noIncidents'), 'nothing');
    const deploys = listHistory({ key: project.key, limit: 30 }).filter((h) => ['production', 'release', 'rollback', 'draft'].includes(h.kind)).slice(0, 8);
    for (const i of incidents.slice(0, 5)) block(evidence, 'incident', `${i.kind} ${i.status}`, `opened ${i.openedAt}${i.resolvedAt ? `, resolved ${i.resolvedAt}` : ''}, seen ${i.count || 1}×, detail: ${i.detail || '—'}, url: ${i.url || '—'}`, 800);
    for (const e of evidence) refs.evidence.add(e.id);
    const caps = capabilities(project.hosting || 'netlify');
    stage('analyze', { status: 'running', summary: t('assistant.stage.triage') });
    announce({ template: `${prompt.id}.v${prompt.version}` });
    vars = { incident_timeline: data('incident timeline', incidents.map((i) => `${i.openedAt} ${i.kind} ${i.status}${i.resolvedAt ? ` → ${i.resolvedAt}` : ''} (${i.detail || ''})`).join('\n')), recent_deployments: data('recent deployments', deploys.map((h) => `${h.at} ${h.kind} ${h.status} ${h.url || ''} ${h.message || ''}`).join('\n') || 'none recorded'), probe_evidence: evidenceText(evidence), rollback_supported: caps.rollback ? 'yes (files only)' : 'no', note: message };
    const r = await structured(ctx, prompt, refs, vars);
    stage('analyze', { status: r.valid ? 'pass' : 'fail', summary: r.valid ? r.output.observed_impact : t('assistant.invalidOutput', { count: r.errors.length }), details: r.valid ? [] : r.errors.slice(0, 10) });
    return finish({ template: `${prompt.id}.v${prompt.version}`, output: r.output, valid: r.valid, errors: r.errors, repairs: r.repairs, usage: r.usage, stopped: r.valid ? null : 'invalid_output' });
  }
  throw new EngineError(msg('assistant.unknownAction', { action }), 'usage', 2);
  } catch (error) {
    for (const [id, status] of stages) if (status === 'running') stage(id, { status: 'fail', summary: error.message });
    const usage = ctx.calls.reduce(mergeUsage, null);
    if (!entry.done) {
      entry.done = true;
      appendHistory(project.key, { ...entry, valid: false, error: error.message, code: error.code, usage, duration: (Date.now() - started) / 1000 });
      if (usage && (usage.input || usage.output || usage.charged)) recordCost({ project: project.key, projectName: project.name,
        service: provider === 'cloud' ? 'ai-cloud' : `ai-${provider}`, op: `assistant:${action}`, amount: usage.charged ?? usage.input + usage.output,
        unit: usage.charged != null ? 'credits' : 'tokens', estimated: false, ref: usage.model || null });
    }
    throw error;
  }
}

function mergeUsage(a, b) {
  if (!a) return b;
  return { input: (a.input || 0) + (b.input || 0), output: (a.output || 0) + (b.output || 0), model: b.model || a.model, charged: a.charged == null && b.charged == null ? undefined : (a.charged || 0) + (b.charged || 0), balance: b.balance ?? a.balance };
}

function summarize(action, out) {
  if (!out) return null;
  return out.summary || out.answer || out.observed_impact || (Array.isArray(out.findings) ? `${out.findings.length} findings` : null);
}

export { listPrompts };
