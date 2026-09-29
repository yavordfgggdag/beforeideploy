// Embedded AI assistant (V11 RC): one conversation per project, a fixed set of actions, structured answers.
//
//   bid ai chat --project P --action ask|diagnose|propose|review|explain|readiness|triage|fix
//               [--message "…"] [--issue ID] [--files a,b] [--patch-file F] [--budget N] [--yes] [--new]
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
// for low-risk patches, is bounded by iterations and a token budget, stops on no progress, and undoes a
// change that made the check worse. Deploy, restore, billing, secrets and project deletion are not tools
// of the assistant at all.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_DIR, EngineError, ev, emit, logDir, nowISO, readJSON, writeJSON, sh } from '../util.mjs';
import { t, msg, currentLang } from '../i18n.mjs';
import { detect } from '../detect.mjs';
import { getState, setState, addHistory, listHistory } from '../store.mjs';
import { deriveIssues } from '../issues.mjs';
import { redact } from '../aifix.mjs';
import { safePath, plan as planPatch } from './patch.mjs';
import { chooseProvider, stream } from './providers.mjs';
import { accountStatus } from '../account.mjs';
import { loadPrompt, renderPrompt, extractJSON, validateOutput, listPrompts } from './prompts.mjs';
import { aiApply, aiUndo } from './index.mjs';
import { listOps, capabilities } from '../release.mjs';
import { listIncidents } from '../monitor.mjs';
import { recordCost } from '../costs.mjs';

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
};
const SETTINGS_FILE = () => path.join(APP_DIR, 'ai-settings.json');
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
  writeJSON(SETTINGS_FILE(), next);
  return next;
}

// ---------------------------------------------------------------- conversation history (per project, owner-only)

const CHAT_DIR = () => path.join(APP_DIR, 'chats');
const chatFile = (key) => path.join(CHAT_DIR(), `${key}.jsonl`);

function appendHistory(key, entry) {
  fs.mkdirSync(CHAT_DIR(), { recursive: true, mode: 0o700 });
  fs.appendFileSync(chatFile(key), JSON.stringify(entry) + '\n', { mode: 0o600 });
}

export function assistantHistory(project, { limit = 50 } = {}) {
  let lines = [];
  try {
    lines = fs.readFileSync(chatFile(project.key), 'utf8').split('\n').filter(Boolean);
  } catch {}
  const entries = lines.slice(-limit).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
  const conv = entries.length ? entries[entries.length - 1].conversation : null;
  return { project: project.key, conversation: conv, entries };
}

export function assistantReset(project) {
  try {
    fs.rmSync(chatFile(project.key), { force: true });
  } catch {}
  return { project: project.key, cleared: true };
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

/** One redacted, capped evidence block. `redactions` counts what was masked so the app can say so. */
function block(list, kind, label, raw, cap) {
  const text = String(raw || '');
  const red = redact(text);
  const redactions = (red.match(/\[[A-Z_]+\]/g) || []).length - (text.match(/\[[A-Z_]+\]/g) || []).length;
  const cut = red.length > cap ? red.slice(0, cap) + `\n… (${red.length - cap} chars omitted)` : red;
  const id = `E${list.length + 1}`;
  list.push({ id, kind, label, chars: cut.length, redactions: Math.max(0, redactions), text: cut });
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
  for (const rel of files.slice(0, settings.maxFiles)) {
    const abs = safePath(project.path, rel);
    if (!abs) throw new EngineError(msg('assistant.badPath', { path: rel }), 'bad_path', 2);
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      throw new EngineError(msg('assistant.fileMissing', { path: rel }), 'not_found', 2);
    }
    const hash = sha256(content);
    const id = block(evidence, 'file', rel, content, settings.maxFileChars);
    out.push({ path: rel, hash, id, chars: content.length });
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

function evidenceText(list) {
  return list.map((e) => `[${e.id}] ${e.kind}: ${e.label}\n${e.text}`).join('\n\n');
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

async function callModel({ provider, model, system, prompt, action, project, settings, budget }) {
  const estimate = Math.ceil((system.length + prompt.length) / 4);
  if (budget.used + estimate > budget.limit) throw new EngineError(msg('assistant.budgetExceeded', { need: estimate, left: Math.max(0, budget.limit - budget.used) }), 'budget_exceeded');
  const d = detect(project.path);
  const params =
    provider === 'cloud'
      ? { prompt, system, step: `assistant:${action}`, project: { framework: d.framework, pm: d.packageManager }, locale: currentLang(), deep: false, model: model || undefined, mode: 'assistant' }
      : { model, system, messages: [{ role: 'user', content: prompt }], maxTokens: 6000, effort: 'medium' };
  let text = '';
  const usage = { input: 0, output: 0, model };
  const run = (async () => {
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
  })();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new EngineError(msg('assistant.timeout', { seconds: Math.round(settings.callTimeoutMs / 1000) }), 'ai_timeout')), settings.callTimeoutMs);
  });
  try {
    await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
  if (!usage.input) usage.input = estimate;
  if (!usage.output) usage.output = Math.ceil(text.length / 4);
  budget.used += usage.charged ?? usage.input + usage.output;
  budget.calls++;
  return { text, usage };
}

/** Parse + validate, with one bounded repair round on an invalid answer. */
async function structured(ctx, prompt, refs, vars) {
  const rendered = renderPrompt(prompt, vars);
  let { text, usage } = await callModel({ ...ctx, prompt: rendered });
  let output = extractJSON(text);
  let v = output ? validateOutput(prompt, output, refs) : { ok: false, errors: ['no JSON object in the answer'] };
  let repairs = 0;
  if (!v.ok && ctx.budget.used < ctx.budget.limit) {
    repairs = 1;
    ev.step(`assistant-${ctx.action}`, { label: t('assistant.stage.analyze'), category: 'AI', status: 'running', summary: t('assistant.repairing', { count: v.errors.length }) });
    const fix = `${rendered}\n\nYour previous answer was rejected by the application:\n- ${v.errors.slice(0, 12).join('\n- ')}\n\nReturn only the corrected JSON object with exactly the required fields.`;
    const second = await callModel({ ...ctx, prompt: fix });
    usage = { input: usage.input + second.usage.input, output: usage.output + second.usage.output, model: second.usage.model || usage.model, charged: (usage.charged || 0) + (second.usage.charged || 0), balance: second.usage.balance ?? usage.balance };
    text = second.text;
    output = extractJSON(text);
    v = output ? validateOutput(prompt, output, refs) : { ok: false, errors: ['no JSON object in the answer'] };
  }
  return { output: v.ok ? output : null, valid: v.ok, errors: v.errors, repairs, usage, raw: text };
}

// ---------------------------------------------------------------- actions

export async function assistantChat(project, opts = {}) {
  const action = opts.action || 'ask';
  if (!ACTIONS.includes(action)) throw new EngineError(msg('assistant.unknownAction', { action }), 'usage', 2);
  const settings = assistantSettings();
  const status = await accountStatus();
  const provider = chooseProvider({ features: status.features || null, requested: opts.provider });
  const model = provider === 'cloud' ? null : opts.model && opts.model !== true ? opts.model : provider === 'openai' ? (status.settings?.['ai.models']?.openai || 'gpt-5') : (status.settings?.['ai.models']?.standard || 'claude-sonnet-5');
  const budget = { limit: Math.min(settings.maxTokensPerOperation, Number(opts.budget) || settings.maxTokensPerOperation), used: 0, calls: 0 };
  const history = assistantHistory(project, { limit: 1 });
  const conversation = opts.newConversation || !history.conversation ? crypto.randomBytes(6).toString('hex') : history.conversation;
  const system = renderPrompt(loadPrompt('system'), { locale: currentLang(), project_name: project.name, tools: TOOLS.map((x) => `- ${x}`).join('\n') });
  const ctx = { provider, model, system, action, project, settings, budget };
  const message = opts.message && opts.message !== true ? String(opts.message) : '';
  const started = Date.now();
  let stopped = null;
  const entry = { at: nowISO(), conversation, action, message, provider };
  process.on('exit', (code) => {
    if (code === 130 && !entry.done) appendHistory(project.key, { ...entry, stopped: 'cancelled', done: true, usage: { tokens: budget.used } });
  });

  const evidence = [];
  const refs = { evidence: new Set() };
  const stage = (id, fields) => ev.step(`assistant-${id}`, { category: 'AI', label: STAGE_LABELS()[id], ...fields });
  const finish = (result) => {
    entry.done = true;
    const summary = result.output ? summarize(action, result.output) : null;
    appendHistory(project.key, { ...entry, template: result.template, valid: result.valid, stopped: result.stopped, summary, usage: result.usage, duration: (Date.now() - started) / 1000, patchFile: result.patchFile || null });
    addHistory({ project: project.key, projectName: project.name, kind: 'assistant', status: result.valid && !result.stopped ? 'ok' : 'fail', message: `${action}${summary ? `: ${summary.slice(0, 120)}` : ''}${result.stopped ? ` (${result.stopped})` : ''}`, duration: (Date.now() - started) / 1000 });
    if (result.usage?.input || result.usage?.output) {
      recordCost({ project: project.key, projectName: project.name, service: provider === 'cloud' ? 'ai-cloud' : `ai-${provider}`, op: `assistant:${action}`, amount: result.usage.charged ?? result.usage.input + result.usage.output, unit: 'tokens', estimated: false, ref: result.usage.model || null });
    }
    return { conversation, action, provider, model: result.usage?.model || model, ...result, budget: { ...budget }, duration: (Date.now() - started) / 1000 };
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
        if (Math.ceil((system.length + evidence.reduce((n, e) => n + e.chars, 0)) / 4) <= settings.maxContextChars / 4) break;
      }
    }
  };

  const meta = metadata(project);
  const checks = checkSummary(project);
  const { issue, issues } = issueById(project, opts.issue && opts.issue !== true ? String(opts.issue) : null);
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
    if (d.git.isRepo) block(evidence, 'git', 'git diff --stat HEAD', sh('git', ['diff', '--stat', 'HEAD'], { cwd: project.path }).stdout, 2000);
    for (const e of evidence) refs.evidence.add(e.id);
    stage('analyze', { status: 'running', summary: t('assistant.stage.analyzing', { model: model || t('ai.step.cloudModel') }) });
    announce({ template: `${prompt.id}.v${prompt.version}` });
    vars = action === 'ask'
      ? { question: message, evidence: evidenceText(evidence), project_metadata: meta, check_results: checks }
      : { issue: `${issue.id}: ${issue.title}\n${issue.impact}`, question: message, evidence: evidenceText(evidence), project_metadata: meta, check_results: checks };
    const r = await structured(ctx, prompt, refs, vars);
    stage('analyze', { status: r.valid ? 'pass' : 'fail', summary: r.valid ? summarize(action, r.output) : t('assistant.invalidOutput', { count: r.errors.length }), details: r.valid ? [] : r.errors.slice(0, 10) });
    return finish({ template: `${prompt.id}.v${prompt.version}`, output: r.output, valid: r.valid, errors: r.errors, repairs: r.repairs, usage: r.usage, stopped: r.valid ? null : 'invalid_output', evidence: evidence.map(({ text: _t, ...e }) => e) });
  }

  if (action === 'propose' || action === 'fix') {
    if (!issue) throw new EngineError(msg('assistant.issueRequired'), 'usage', 2);
    prompt = loadPrompt('propose_patch');
    const targetFiles = [...new Set([...issueFiles(project, issue), ...files])];
    if (!targetFiles.length) throw new EngineError(msg('assistant.noFiles'), 'usage', 2);
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
      refs.allowed_paths = new Set(snaps.map((s) => s.path));
      refs.allowed_dirs = new Set(snaps.map((s) => (path.posix.dirname(s.path) === '.' ? '' : path.posix.dirname(s.path) + '/')));
      stage('propose', { status: 'running', summary: t('assistant.stage.proposing', { iteration: iter, max: maxIter }) });
      announce({ template: `${prompt.id}.v${prompt.version}` });
      const pkg = readJSON(path.join(project.path, 'package.json'), null);
      vars = {
        confirmed_issue: `${issue.id}: ${issue.title}\n${issue.impact}\n${message}`,
        allowed_paths: snaps.map((s) => `- ${s.path}`).join('\n'),
        file_snapshots: snaps.map((s) => `[${s.id}] ${s.path} (sha256 ${s.hash})\n${evidence.find((e) => e.id === s.id).text}`).join('\n\n'),
        project_conventions: `${meta}\nscripts: ${JSON.stringify(pkg?.scripts || {})}\nNo new dependencies. Keep the file's existing style.`,
        feedback,
      };
      let r;
      try {
        r = await structured(ctx, prompt, refs, vars);
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
      const parsed = {
        explanation: out.summary,
        files: out.changes.map((c) => (c.action === 'delete' ? { path: c.path, action: 'delete', edits: [], content: null } : c.action === 'create' ? { path: c.path, action: 'create', edits: [], content: c.content ?? '' } : { path: c.path, action: 'edit', edits: [{ search: fs.readFileSync(path.join(project.path, c.path), 'utf8'), replace: c.content ?? '' }], content: null })),
      };
      const planned = planPatch(project.path, parsed);
      const patchFile = path.join(logDir(project.key), `ai-patch-${issue.step}-${Date.now()}.json`);
      writeJSON(patchFile, { project: project.key, projectPath: project.path, step: issue.step, model: r.usage.model, provider, createdAt: nowISO(), parsed, planned, assistant: { template: `${prompt.id}.v${prompt.version}`, risk: out.risk, verification_plan: out.verification_plan, rollback_notes: out.rollback_notes, issue: issue.id } });
      const filesOut = planned.map(({ after, ...rest }) => rest);
      stage('propose', { status: 'pass', summary: t('assistant.proposed', { count: filesOut.filter((f) => f.applicable).length, risk: out.risk }), details: filesOut.map((f) => `${f.applicable ? '✓' : '✗'} ${f.path} (+${f.additions} −${f.deletions})${f.error ? ` — ${f.error}` : ''}`) });
      const base = { template: `${prompt.id}.v${prompt.version}`, output: out, valid: true, errors: [], repairs: lastResult.repairs, usage: lastResult.usage, patchFile, files: filesOut, risk: out.risk, verificationPlan: out.verification_plan, rollbackNotes: out.rollback_notes };
      if (action === 'propose') return finish({ ...base, stopped: null, iterations: iter });

      // ---- fix: apply only with consent (or auto-apply for low risk), then verify
      const mayApply = !!opts.yes || (settings.autoApplyLowRisk && out.risk === 'low');
      if (!mayApply) {
        stage('apply', { status: 'skipped', summary: t('assistant.needsConfirmation', { risk: out.risk }) });
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
      feedback = `Attempt ${iter} was applied and verified by the engine: step ${issue.step} is now "${recheck?.stepStatus}" (check status ${recheck?.status}). Still failing steps: ${failingNow || 'none'}. Log tail:\n${issue.evidence?.log ? tailText(issue.evidence.log, 40) : ''}`;
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
    vars = { candidate_diff: evidenceText(evidence), original_issue: `${patch.step}: ${patch.parsed?.explanation || ''}\n${message}`, project_constraints: `${meta}\nNo new dependencies, no config or secret changes.`, available_tests: Object.keys(pkg?.scripts || {}).filter((s) => /test|lint|check|build/.test(s)).join(', ') || 'none' };
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
    vars = { engine_verification_result: JSON.stringify(result, null, 1), locale: currentLang(), note: message };
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
    vars = { snapshot: JSON.stringify({ fingerprint: check?.fingerprint || null, buildConfig: check?.buildConfig || null, artifact: check?.artifact || null }, null, 1), check_results: checks, preview_results: JSON.stringify(ops.map((o) => ({ id: o.id, state: o.state, preview: o.preview, smoke: o.smoke ? { ok: o.smoke.ok, checks: o.smoke.checks?.length } : null, failure: o.failure })), null, 1), provider_capabilities: JSON.stringify(caps), engine_release_gates: JSON.stringify(gates, null, 1), note: message };
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
    vars = { incident_timeline: incidents.map((i) => `${i.openedAt} ${i.kind} ${i.status}${i.resolvedAt ? ` → ${i.resolvedAt}` : ''} (${i.detail || ''})`).join('\n'), recent_deployments: deploys.map((h) => `${h.at} ${h.kind} ${h.status} ${h.url || ''} ${h.message || ''}`).join('\n') || 'none recorded', probe_evidence: evidenceText(evidence), rollback_supported: caps.rollback ? 'yes (files only)' : 'no', note: message };
    const r = await structured(ctx, prompt, refs, vars);
    stage('analyze', { status: r.valid ? 'pass' : 'fail', summary: r.valid ? r.output.observed_impact : t('assistant.invalidOutput', { count: r.errors.length }), details: r.valid ? [] : r.errors.slice(0, 10) });
    return finish({ template: `${prompt.id}.v${prompt.version}`, output: r.output, valid: r.valid, errors: r.errors, repairs: r.repairs, usage: r.usage, stopped: r.valid ? null : 'invalid_output' });
  }
  throw new EngineError(msg('assistant.unknownAction', { action }), 'usage', 2);
}

function mergeUsage(a, b) {
  if (!a) return b;
  return { input: (a.input || 0) + (b.input || 0), output: (a.output || 0) + (b.output || 0), model: b.model || a.model, charged: (a.charged || 0) + (b.charged || 0) || undefined, balance: b.balance ?? a.balance };
}

function summarize(action, out) {
  if (!out) return null;
  return out.summary || out.answer || out.observed_impact || (Array.isArray(out.findings) ? `${out.findings.length} findings` : null);
}

export { listPrompts };
