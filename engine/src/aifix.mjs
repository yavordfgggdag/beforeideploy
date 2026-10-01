// AI Fix — builds a redacted, self-contained prompt for a failed step and hands it to ChatGPT / Claude / Codex / Claude Code
import fs from 'node:fs';
import { fitPrompt } from './ai/fit.mjs';
import path from 'node:path';
import { HOME, ENGINE_DIR, EngineError, sh, which, logDir, readJSON, exists } from './util.mjs';
import { detect } from './detect.mjs';
import { getState } from './store.mjs';
import { recordCost } from './costs.mjs';
import { t, msg } from './i18n.mjs';
import { gitSh } from './gitbin.mjs';

const STEP_KEYS = { git: 'aifix.step.git', secrets: 'aifix.step.secrets', deps: 'aifix.step.deps', lint: 'aifix.step.lint', typecheck: 'aifix.step.typecheck', build: 'aifix.step.build', hosting: 'aifix.step.hosting', deploy: 'aifix.step.deploy', local: 'aifix.step.local' };
export const stepName = (id) => (STEP_KEYS[id] ? t(STEP_KEYS[id]) : id);

// ---------------------------------------------------------------- redaction

const REDACTIONS = [
  [/\bAKIA[0-9A-Z]{16}\b/g, '[AWS_KEY]'],
  [/\b(sk|rk)_live_[0-9a-zA-Z]{8,}/g, '[STRIPE_KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[GITHUB_TOKEN]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[GITHUB_TOKEN]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[SLACK_TOKEN]'],
  [/\bsk-(ant-|proj-)?[A-Za-z0-9_-]{16,}/g, '[API_KEY]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[GOOGLE_KEY]'],
  [/\bnfp_[A-Za-z0-9]{20,}/g, '[NETLIFY_TOKEN]'],
  [/\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}/g, '[DISCORD_TOKEN]'],
  [/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g, '[JWT]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[PRIVATE_KEY]'],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}/g, '[SUPABASE_KEY]'],
  [/\b(sk|rk|pk)_test_[0-9a-zA-Z]{8,}/g, '[STRIPE_KEY]'],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [REDACTED]'],
  // key = value, "key": "value", KEY=value — also *_KEY / *_TOKEN / *_SECRET names and quoted JSON keys
  [/((?:api|secret|token|password|passwd|pwd|auth|access|private|client)[_-]?(?:key|secret|token)?["']?\s*[:=]\s*)["']?[^\s"'`,}]{6,}["']?/gi, '$1[REDACTED]'],
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*)[^\s"'`]{4,}/g, '$1[REDACTED]'],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, '$1[creds]@'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
];

/** The placeholders redaction writes (`[REDACTED]`, `[email]` …) — a model answer that reproduces one wrote over a secret it never saw. */
export const REDACTION_MARKERS = [...new Set(REDACTIONS.flatMap(([, rep]) => rep.match(/\[[A-Za-z_]+\]/g) || []))];

export function redact(text) {
  let out = String(text || '');
  const home = HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  out = out.replace(new RegExp(home, 'g'), '~');
  out = out.replace(/\/Users\/[^/\s]+/g, '~');
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return out;
}

// ---------------------------------------------------------------- context

function tailFile(file, lines = 80) {
  try {
    const all = fs.readFileSync(file, 'utf8').split('\n');
    return all.slice(-lines).join('\n').trim();
  } catch {
    return '';
  }
}

const FILE_RE = /(?:^|[\s("'`])((?:\.\/)?(?:src|app|pages|components|lib|public|content|styles|layouts|netlify|functions|server|utils)\/[^\s:()"'`]+?\.(?:tsx?|jsx?|mjs|cjs|astro|vue|svelte|css|scss|json|html|md|mdx))(?::(\d+))?/g;

function mentionedFiles(dir, log) {
  const found = new Map();
  let m;
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(log)) && found.size < 3) {
    const rel = m[1].replace(/^\.\//, '');
    const abs = path.resolve(dir, rel);
    if (!abs.startsWith(path.resolve(dir) + path.sep) || rel.split('/').includes('..')) continue; // never outside the project
    if (!found.has(rel) && exists(abs)) found.set(rel, m[2] ? Number(m[2]) : null);
  }
  const out = [];
  for (const [rel, line] of found) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, rel), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    const from = line ? Math.max(0, line - 40) : 0;
    const to = line ? Math.min(lines.length, line + 40) : Math.min(lines.length, 150);
    const body = lines
      .slice(from, to)
      .map((l, i) => `${String(from + i + 1).padStart(4)}| ${l}`)
      .join('\n');
    out.push({ rel, line, body, truncated: to < lines.length || from > 0 });
  }
  return out;
}

function stepInfo(project, stepId) {
  const st = getState(project.key);
  const step = st.check?.steps?.find((s) => s.id === stepId) || null;
  let logFile = step?.log || null;
  if (!logFile) {
    const cands = {
      deploy: ['deploy-prod.log', 'deploy-draft.log'],
      local: ['local.log'],
      deps: ['install.log'],
    }[stepId] || [`${stepId}.log`];
    const dir = logDir(project.key);
    const existing = cands.map((c) => path.join(dir, c)).filter(exists);
    existing.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    logFile = existing[0] || null;
  }
  return { step, logFile };
}

function stepBlock(project, stepId) {
  const { step, logFile } = stepInfo(project, stepId);
  const isWarn = step?.status === 'warn';
  const log = logFile ? tailFile(logFile, isWarn ? 40 : 80) : '';
  const parts = [];
  parts.push(`### ${t(isWarn ? 'aifix.prompt.warning' : 'aifix.prompt.error')}: ${stepName(stepId)}${step?.summary ? ` — ${step.summary}` : ''}`);
  if (step?.details?.length) parts.push(step.details.slice(0, 20).map((l) => `- ${l}`).join('\n'));
  if (log) parts.push(`${t('aifix.prompt.logTail')}\n\`\`\`\n${log}\n\`\`\``);
  return { text: parts.join('\n\n'), log: `${log}\n${(step?.details || []).join('\n')}`, isWarn };
}

export function buildPrompt(project, stepId) {
  const dir = project.path;
  const d = detect(dir);
  const check = getState(project.key).check;
  const ids =
    stepId === 'all'
      ? (check?.steps || []).filter((s) => s.status === 'fail' || s.status === 'warn').map((s) => s.id)
      : [stepId];
  if (!ids.length) throw new EngineError(msg('aifix.nothing'), 'nothing');
  const blocks = ids.map((id) => stepBlock(project, id));
  const onlyWarnings = blocks.every((b) => b.isWarn);
  const pkg = readJSON(path.join(dir, 'package.json'), null);
  const node = sh('node', ['--version']).stdout.trim();
  const diffStat = d.git.isRepo ? gitSh(['diff', '--stat', 'HEAD'], { cwd: dir }).stdout.trim().split('\n').slice(-15).join('\n') : '';
  const recent = d.git.isRepo ? gitSh(['log', '-3', '--format=%h %s (%cr)'], { cwd: dir }).stdout.trim() : '';
  const files = mentionedFiles(dir, blocks.map((b) => b.log).join('\n'));

  const parts = [];
  parts.push(t(onlyWarnings ? 'aifix.prompt.introWarnings' : 'aifix.prompt.introErrors'));
  const git = d.git.isRepo ? `${d.git.branch}${t(d.git.remote ? 'aifix.prompt.gitRemote' : 'aifix.prompt.gitNoRemote')}` : t('aifix.prompt.gitNoRepo');
  parts.push(t('aifix.prompt.environment', { framework: d.framework, pm: d.packageManager || '—', node, publishDir: d.publishDir, git }));
  parts.push(`${t('aifix.prompt.problems')}\n\n${blocks.map((b) => b.text).join('\n\n')}`);
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    parts.push(
      `## package.json\nScripts:\n\`\`\`json\n${JSON.stringify(pkg.scripts || {}, null, 2)}\n\`\`\`\n${t('aifix.prompt.dependencies')}: ${Object.entries(deps)
        .slice(0, 40)
        .map(([k, v]) => `${k}@${v}`)
        .join(', ')}`
    );
  }
  for (const f of files) parts.push(`## ${t('aifix.prompt.file')}: ${f.rel}${f.line ? ` (${t('aifix.prompt.aroundLine', { line: f.line })})` : ''}\n\`\`\`\n${f.body}\n\`\`\``);
  if (diffStat) parts.push(`## ${t('aifix.prompt.uncommitted')}\n\`\`\`\n${diffStat}\n\`\`\``);
  if (recent) parts.push(`## ${t('aifix.prompt.recentCommits')}\n${recent}`);
  parts.push(t('aifix.prompt.howToAnswer'));
  const label = ids.length > 1 ? t('aifix.prompt.problemsCount', { count: ids.length }) : stepName(ids[0]);
  return { prompt: fitPrompt(redact(parts.join('\n\n'))), stepLabel: label };
}

// ---------------------------------------------------------------- launch

const URL_LIMIT = 7000;

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const KNOWN_STEPS = new Set(['all', 'git', 'secrets', 'deps', 'lint', 'typecheck', 'build', 'hosting']);

export function aifix(project, { step, target }) {
  if (!step || step === true) throw new EngineError(msg('aifix.missingStep'), 'usage', 2);
  // the step id ends up in a file name and in a shell script — only known ids
  if (!KNOWN_STEPS.has(step)) throw new EngineError(msg('aifix.missingStep'), 'usage', 2);
  const tgt = target && target !== true ? target : 'chatgpt';
  const { prompt, stepLabel } = buildPrompt(project, step);
  const dir = logDir(project.key);
  const promptFile = path.join(dir, `aifix-${step}.md`);
  fs.writeFileSync(promptFile, prompt);

  const out = { target: tgt, step, prompt, promptFile, url: null, clipboard: false, commandFile: null, chars: prompt.length };

  if (tgt === 'chatgpt' || tgt === 'claude') {
    const base = tgt === 'chatgpt' ? 'https://chatgpt.com/?q=' : 'https://claude.ai/new?q=';
    const full = base + encodeURIComponent(prompt);
    if (full.length <= URL_LIMIT) {
      out.url = full;
    } else {
      out.clipboard = true;
      out.url =
        base +
        encodeURIComponent(t('aifix.pasteIntro', { step: stepLabel, framework: detect(project.path).framework }));
    }
  } else if (tgt === 'codex' || tgt === 'claude-code') {
    const bin = tgt === 'codex' ? 'codex' : 'claude';
    if (!which(bin)) {
      throw new EngineError(
        msg('aifix.cliMissing', { bin, pkg: tgt === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code' }),
        'missing_cli'
      );
    }
    const cmdFile = path.join(dir, `aifix-${tgt}.command`);
    fs.writeFileSync(
      cmdFile,
      [
        '#!/bin/zsh',
        `# Before I Deploy — AI Fix (${tgt})`,
        `[ -f ${shellQuote(path.join(ENGINE_DIR, 'env.zsh'))} ] && source ${shellQuote(path.join(ENGINE_DIR, 'env.zsh'))}`,
        `cd ${shellQuote(project.path)} || exit 1`,
        'clear',
        `echo "🤖 ${bin} — ${t('aifix.command.fixing', { step: stepLabel })}"`,
        'echo',
        `${bin} "$(cat ${shellQuote(promptFile)})"`,
        '',
      ].join('\n')
    );
    fs.chmodSync(cmdFile, 0o755);
    out.commandFile = cmdFile;
  } else if (tgt === 'copy') {
    out.clipboard = true;
  } else {
    throw new EngineError(msg('aifix.unknownTarget', { target: tgt }), 'usage', 2);
  }

  if (tgt !== 'copy') {
    recordCost({
      project: project.key,
      projectName: project.name,
      service: { chatgpt: 'chatgpt', claude: 'claude', codex: 'codex', 'claude-code': 'claude' }[tgt],
      op: `aifix:${step}`,
    });
  }
  return out;
}
