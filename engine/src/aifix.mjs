// AI Fix — builds a redacted, self-contained prompt for a failed step and hands it to ChatGPT / Claude / Codex / Claude Code
import fs from 'node:fs';
import path from 'node:path';
import { HOME, ENGINE_DIR, EngineError, sh, which, logDir, readJSON, exists } from './util.mjs';
import { detect } from './detect.mjs';
import { getState } from './store.mjs';
import { recordCost } from './costs.mjs';

const STEP_NAMES = {
  git: 'Git проверка',
  secrets: 'проверка за secrets',
  deps: 'инсталиране на зависимости',
  lint: 'lint',
  typecheck: 'typecheck',
  build: 'production build',
  hosting: 'Netlify hosting',
  deploy: 'Netlify deploy',
  local: 'локален сървър',
};

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
  [/((?:api|secret|token|password|passwd|pwd|auth)[_-]?(?:key)?\s*[:=]\s*)["']?[^\s"'`]{6,}["']?/gi, '$1[REDACTED]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/https?:\/\/[^\s/]*:[^\s@/]+@/g, 'https://[creds]@'],
];

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
    if (!found.has(rel) && exists(path.join(dir, rel))) found.set(rel, m[2] ? Number(m[2]) : null);
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
  parts.push(`### ${isWarn ? '⚠️ Предупреждение' : '❌ Грешка'}: ${STEP_NAMES[stepId] || stepId}${step?.summary ? ` — ${step.summary}` : ''}`);
  if (step?.details?.length) parts.push(step.details.slice(0, 20).map((l) => `- ${l}`).join('\n'));
  if (log) parts.push(`Лог (последните редове):\n\`\`\`\n${log}\n\`\`\``);
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
  if (!ids.length) throw new EngineError('Няма грешки или предупреждения в последната проверка.', 'nothing');
  const blocks = ids.map((id) => stepBlock(project, id));
  const onlyWarnings = blocks.every((b) => b.isWarn);
  const pkg = readJSON(path.join(dir, 'package.json'), null);
  const node = sh('node', ['--version']).stdout.trim();
  const diffStat = d.git.isRepo ? sh('git', ['diff', '--stat', 'HEAD'], { cwd: dir }).stdout.trim().split('\n').slice(-15).join('\n') : '';
  const recent = d.git.isRepo ? sh('git', ['log', '-3', '--format=%h %s (%cr)'], { cwd: dir }).stdout.trim() : '';
  const files = mentionedFiles(dir, blocks.map((b) => b.log).join('\n'));

  const parts = [];
  parts.push(
    `Ти си senior full-stack web developer и DevOps инженер. Помогни ми да ${onlyWarnings ? 'изчистя предупрежденията' : 'оправя грешката'} в моя уеб проект, преди да го публикувам. Отговаряй на български, кратко и конкретно.`
  );
  parts.push(
    `## Среда\n- macOS, deploy ръчно с Netlify CLI (без CI от GitHub)\n- Framework: ${d.framework}\n- Package manager: ${d.packageManager || '—'}\n- Node: ${node}\n- Build output: ${d.publishDir}\n- Git: ${d.git.isRepo ? `${d.git.branch}${d.git.remote ? ', има GitHub remote' : ', без remote'}` : 'няма repo'}`
  );
  parts.push(`## Проблеми от проверката „Before I Deploy“\n\n${blocks.map((b) => b.text).join('\n\n')}`);
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    parts.push(
      `## package.json\nScripts:\n\`\`\`json\n${JSON.stringify(pkg.scripts || {}, null, 2)}\n\`\`\`\nЗависимости: ${Object.entries(deps)
        .slice(0, 40)
        .map(([k, v]) => `${k}@${v}`)
        .join(', ')}`
    );
  }
  for (const f of files) parts.push(`## Файл: ${f.rel}${f.line ? ` (около ред ${f.line})` : ''}\n\`\`\`\n${f.body}\n\`\`\``);
  if (diffStat) parts.push(`## Неприбрани промени (git diff --stat)\n\`\`\`\n${diffStat}\n\`\`\``);
  if (recent) parts.push(`## Последни commit-и\n${recent}`);
  parts.push(
    `## Как да отговориш\n1. **Причина** — 1–3 изречения какво точно не е наред.\n2. **Поправка** — минималната промяна като diff или пълен код на засегнатия участък. Не пипай несвързани файлове и не сменяй framework/версии без нужда.\n3. **Команди** — ако трябва (install, git и т.н.), точно какво да пусна в Terminal в папката на проекта.\n4. **Проверка** — как да се уверя, че е оправено (в Before I Deploy натискам „Провери“).\n5. Ако ти липсва информация — кажи точно кой файл да ти покажа.\nНикога не ми предлагай да слагам ключове/пароли в кода или в Git.`
  );
  const label = ids.length > 1 ? `${ids.length} проблема` : STEP_NAMES[ids[0]] || ids[0];
  return { prompt: redact(parts.join('\n\n')), stepLabel: label };
}

// ---------------------------------------------------------------- launch

const URL_LIMIT = 7000;

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function aifix(project, { step, target }) {
  if (!step || step === true) throw new EngineError('Липсва --step', 'usage', 2);
  const t = target && target !== true ? target : 'chatgpt';
  const { prompt, stepLabel } = buildPrompt(project, step);
  const dir = logDir(project.key);
  const promptFile = path.join(dir, `aifix-${step}.md`);
  fs.writeFileSync(promptFile, prompt);

  const out = { target: t, step, prompt, promptFile, url: null, clipboard: false, commandFile: null, chars: prompt.length };

  if (t === 'chatgpt' || t === 'claude') {
    const base = t === 'chatgpt' ? 'https://chatgpt.com/?q=' : 'https://claude.ai/new?q=';
    const full = base + encodeURIComponent(prompt);
    if (full.length <= URL_LIMIT) {
      out.url = full;
    } else {
      out.clipboard = true;
      out.url =
        base +
        encodeURIComponent(`Ще ти поставя (Cmd+V) пълния контекст за грешка при ${stepLabel} в моя ${detect(project.path).framework} проект. Изчакай го и тогава отговори.`);
    }
  } else if (t === 'codex' || t === 'claude-code') {
    const bin = t === 'codex' ? 'codex' : 'claude';
    if (!which(bin)) {
      throw new EngineError(
        `${bin} CLI не е инсталиран. Инсталирай го от „Настройка“ (npm i -g ${t === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code'}).`,
        'missing_cli'
      );
    }
    const cmdFile = path.join(dir, `aifix-${t}.command`);
    fs.writeFileSync(
      cmdFile,
      [
        '#!/bin/zsh',
        `# Before I Deploy — AI Fix (${t})`,
        `[ -f ${shellQuote(path.join(ENGINE_DIR, 'env.zsh'))} ] && source ${shellQuote(path.join(ENGINE_DIR, 'env.zsh'))}`,
        `cd ${shellQuote(project.path)} || exit 1`,
        'clear',
        `echo "🤖 ${bin} — поправка на: ${stepLabel}"`,
        'echo',
        `${bin} "$(cat ${shellQuote(promptFile)})"`,
        '',
      ].join('\n')
    );
    fs.chmodSync(cmdFile, 0o755);
    out.commandFile = cmdFile;
  } else if (t === 'copy') {
    out.clipboard = true;
  } else {
    throw new EngineError(`Непознат target: ${t}`, 'usage', 2);
  }

  if (t !== 'copy') {
    recordCost({
      project: project.key,
      projectName: project.name,
      service: { chatgpt: 'chatgpt', claude: 'claude', codex: 'codex', 'claude-code': 'claude' }[t],
      op: `aifix:${step}`,
    });
  }
  return out;
}
