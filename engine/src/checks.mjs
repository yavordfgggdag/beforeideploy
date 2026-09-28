// Pre-deploy checks: Git → Secrets → Dependencies → Lint → Typecheck → Build → Hosting
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ev, sh, which, runStream, logDir, nowISO, exists } from './util.mjs';
import { detect, pmRunArgs } from './detect.mjs';
import { getState, setState, addHistory, updateProject } from './store.mjs';
import { t } from './i18n.mjs';

export const STEPS = [
  { id: 'git', label: t('check.step.git'), category: 'Source Control' },
  { id: 'secrets', label: t('check.step.secrets'), category: 'Security' },
  { id: 'deps', label: t('check.step.deps'), category: 'Dependencies' },
  { id: 'lint', label: t('check.step.lint'), category: 'Code Quality' },
  { id: 'typecheck', label: t('check.step.typecheck'), category: 'Code Quality' },
  { id: 'build', label: t('check.step.build'), category: 'Build' },
  { id: 'hosting', label: t('check.step.hosting'), category: 'Hosting' },
];

const ENV_FILE_RE = /(^|\/)\.env(\.[^/]+)?$/;
const ENV_SAFE_RE = /\.(example|sample|template|dist|defaults)$/i;

// ---------------------------------------------------------------- secrets scan

const SECRET_PATTERNS = [
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Stripe live key', re: /\b(sk|rk)_live_[0-9a-zA-Z]{16,}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'GitHub PAT', re: /\bgithub_pat_[A-Za-z0-9_]{50,}/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private key', re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/ },
  { name: 'OpenAI / Anthropic key', re: /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Netlify token', re: /\bnfp_[A-Za-z0-9]{36,}/ },
  { name: 'Discord bot token', re: /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}/ },
  { name: 'Supabase service key', re: /service_role["'\s:=]+eyJ[A-Za-z0-9_-]{20,}/ },
];

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.icns', '.pdf', '.zip', '.gz', '.tgz', '.mp4', '.mov',
  '.mp3', '.wav', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.lockb', '.psd', '.sketch', '.fig', '.heic', '.webm',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.netlify', '.output', '.svelte-kit', '.astro', '.cache', '_site', 'coverage', '.vercel']);
const SKIP_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock']);

function listCandidateFiles(dir, isRepo) {
  if (isRepo) {
    const tracked = sh('git', ['ls-files', '-z'], { cwd: dir }).stdout.split('\0');
    const untracked = sh('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: dir }).stdout.split('\0');
    return [...new Set([...tracked, ...untracked])].filter(Boolean);
  }
  const out = [];
  const walk = (rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length > 5000) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(r);
      } else if (e.isFile()) out.push(r);
    }
  };
  walk('');
  return out;
}

function mask(s) {
  if (s.length <= 10) return '•••';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export function scanSecrets(dir, isRepo) {
  const findings = [];
  const files = listCandidateFiles(dir, isRepo);
  for (const rel of files) {
    const base = path.basename(rel);
    if (SKIP_FILES.has(base)) continue;
    if (rel.split('/').some((seg) => SKIP_DIRS.has(seg))) continue;
    if (BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
    if (ENV_FILE_RE.test(rel) && !ENV_SAFE_RE.test(rel)) continue; // handled separately
    if (ENV_SAFE_RE.test(rel)) continue;
    const abs = path.join(dir, rel);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > 512 * 1024) continue;
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 4000 || line.includes('bid-ignore')) continue;
      for (const p of SECRET_PATTERNS) {
        const m = line.match(p.re);
        if (m) {
          findings.push({ file: rel, line: i + 1, kind: p.name, sample: mask(m[0]) });
          break;
        }
      }
      if (findings.length >= 25) return findings;
    }
  }
  return findings;
}

function envFilesAtRoot(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /^\.env(\..+)?$/.test(f) && !ENV_SAFE_RE.test(f));
  } catch {
    return [];
  }
}

function isIgnored(dir, rel) {
  return sh('git', ['check-ignore', '-q', rel], { cwd: dir }).code === 0;
}

// ---------------------------------------------------------------- steps

async function stepGit(ctx) {
  const { dir, d } = ctx;
  if (!which('git')) return { status: 'warn', summary: t('check.git.notInstalled') };
  if (!d.git.isRepo) return { status: 'info', summary: t('git.notRepo'), fixes: ['git.init'] };
  const details = [];
  const conflicts = sh('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: dir }).stdout.trim();
  if (conflicts) {
    const list = conflicts.split('\n');
    return { status: 'fail', summary: t('check.git.conflicts', { count: list.length }), details: list.slice(0, 20) };
  }
  details.push(`Branch: ${d.git.branch}`);
  details.push(d.git.remote ? `Remote: ${d.git.githubUrl || d.git.remote}` : t('check.git.noRemote'));
  const changes = sh('git', ['status', '--porcelain'], { cwd: dir }).stdout.split('\n').filter(Boolean);
  if (changes.length) {
    return {
      status: 'warn',
      summary: t('check.git.uncommitted', { count: changes.length }),
      details: [...details, ...changes.slice(0, 15).map((l) => l.trim())],
    };
  }
  return { status: 'pass', summary: t('check.git.clean'), details };
}

async function stepSecrets(ctx) {
  const { dir, d } = ctx;
  const details = [];
  const fixes = [];
  let status = 'pass';

  if (d.git.isRepo) {
    const tracked = sh('git', ['ls-files'], { cwd: dir })
      .stdout.split('\n')
      .filter((f) => ENV_FILE_RE.test(f) && !ENV_SAFE_RE.test(f));
    if (tracked.length) {
      status = 'fail';
      details.push(...tracked.map((f) => t('check.secrets.tracked', { file: f })));
      fixes.push('env.untrack');
    }
  }

  const envFiles = envFilesAtRoot(dir);
  if (envFiles.length) {
    const unignored = d.git.isRepo
      ? envFiles.filter((f) => !isIgnored(dir, f))
      : envFiles.filter(() => {
          const gi = exists(path.join(dir, '.gitignore')) ? fs.readFileSync(path.join(dir, '.gitignore'), 'utf8') : '';
          return !/^\.env/m.test(gi);
        });
    if (unignored.length) {
      if (status !== 'fail') status = 'warn';
      details.push(...unignored.map((f) => t('check.secrets.notIgnored', { file: f })));
      fixes.push(d.hasGitignore ? 'gitignore.env' : 'gitignore.create');
    }
  }

  const findings = scanSecrets(dir, d.git.isRepo);
  if (findings.length) {
    status = 'fail';
    details.push(...findings.map((f) => `${f.file}:${f.line} — ${f.kind} (${f.sample})`));
  }

  const summary =
    status === 'pass'
      ? t('check.secrets.none')
      : findings.length
        ? t('check.secrets.found', { count: findings.length })
        : status === 'fail'
          ? t('check.secrets.envTracked')
          : t('check.secrets.envNotIgnored');
  return { status, summary, details, fixes };
}

async function stepDeps(ctx) {
  const { d } = ctx;
  if (!d.hasPackageJson) {
    return { status: 'info', summary: d.framework === 'static' ? t('check.deps.static') : t('check.deps.noPackageJson') };
  }
  const details = [];
  const node = which('node');
  if (!node) return { status: 'fail', summary: t('check.deps.noNode') };
  details.push(`Node ${sh('node', ['--version']).stdout.trim()}`);
  if (!which(d.packageManager)) {
    return { status: 'fail', summary: t('check.deps.pmMissing', { pm: d.packageManager }), details };
  }
  details.push(`Package manager: ${d.packageManager}`);
  if (!d.hasNodeModules) {
    const needs = d.buildScript || d.lintScript || d.typecheckScript;
    return {
      status: needs ? 'fail' : 'warn',
      summary: t('check.deps.notInstalled'),
      details,
      fixes: ['deps.install'],
    };
  }
  return { status: 'pass', summary: t('check.deps.ok', { pm: d.packageManager }), details };
}

async function runScript(ctx, stepId, script, okText) {
  const { dir, d, key } = ctx;
  const logFile = path.join(logDir(key), `${stepId}.log`);
  const [cmd, args] = pmRunArgs(d.packageManager, script);
  const r = await runStream(cmd, args, { cwd: dir, logFile, step: stepId, env: { ...process.env, CI: '1' }, timeout: 15 * 60 * 1000 });
  if (r.code === 0) return { status: 'pass', summary: okText, log: logFile, duration: r.duration };
  return {
    status: 'fail',
    summary: t('check.script.failed', { script, code: r.code }),
    details: r.tail.slice(-25),
    log: logFile,
    duration: r.duration,
  };
}

async function stepLint(ctx) {
  if (!ctx.d.lintScript) return { status: 'info', summary: t('check.lint.none') };
  return runScript(ctx, 'lint', ctx.d.lintScript, t('check.lint.pass'));
}

async function stepTypecheck(ctx) {
  if (!ctx.d.typecheckScript) return { status: 'info', summary: t('check.typecheck.none') };
  return runScript(ctx, 'typecheck', ctx.d.typecheckScript, t('check.typecheck.pass'));
}

async function stepBuild(ctx) {
  const { d, dir } = ctx;
  if (!d.buildScript) {
    if (exists(path.join(dir, d.publishDir || '.', 'index.html'))) {
      return { status: 'pass', summary: t('check.build.static') };
    }
    return { status: 'info', summary: t('check.build.noScript') };
  }
  const r = await runScript(ctx, 'build', d.buildScript, t('check.build.pass'));
  if (r.status === 'pass') {
    const after = detect(dir);
    ctx.d = after;
    if (!after.ssr && !after.publishReady) {
      return {
        ...r,
        status: 'warn',
        summary: t('check.build.noIndex', { dir: after.publishDir }),
      };
    }
    r.details = [`Output: ${after.publishDir}`];
  }
  return r;
}

async function stepHosting(ctx) {
  const { d } = ctx;
  const { findProject } = await import('./store.mjs');
  const { providerStatus, projectLink, PROVIDERS } = await import('./hosting.mjs');
  const proj = findProject(ctx.key);
  const id = proj?.hosting || 'netlify';
  const st = providerStatus(id);
  if (id !== 'netlify') {
    if (!st.installed) return { status: 'warn', summary: t('check.hosting.cliMissing', { name: st.name }), details: [t('check.hosting.installFromSetup')] };
    if (!st.loggedIn) return { status: 'warn', summary: t('check.hosting.notLoggedIn', { name: st.name }) };
    if ((d.ssr || d.hasFunctions) && !PROVIDERS[id].ssr) return { status: 'fail', summary: t('check.hosting.noSsr', { name: st.name }) };
    const link = projectLink(proj, id);
    return { status: 'pass', summary: t(link.linked ? 'check.hosting.linked' : 'check.hosting.willCreate', { name: st.name }), details: [PROVIDERS[id].free] };
  }
  const cli = which('netlify') ? 'netlify' : which('npx') ? 'npx netlify-cli' : null;
  if (!cli) return { status: 'warn', summary: t('check.hosting.noNetlifyCli') };
  if (!d.netlifyLinked) return { status: 'info', summary: t('check.hosting.netlifyNotLinked'), fixes: ['netlify.link'] };
  return { status: 'pass', summary: t('check.hosting.netlifyLinked'), details: [`Site ID: ${d.siteId}`, `CLI: ${cli}`] };
}

const RUNNERS = {
  git: stepGit,
  secrets: stepSecrets,
  deps: stepDeps,
  lint: stepLint,
  typecheck: stepTypecheck,
  build: stepBuild,
  hosting: stepHosting,
};

// ---------------------------------------------------------------- incremental check (WP6.2)

/** Steps whose passing result may be reused while the source tree and toolchain are unchanged. */
const CACHEABLE = new Set(['lint', 'typecheck', 'build']);
/** Consecutive steps that may run concurrently (neither writes to the project). */
const PARALLEL_GROUPS = [['lint', 'typecheck']];
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];

function statSig(dir, rel) {
  try {
    const st = fs.statSync(path.join(dir, rel));
    return `${rel}:${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return `${rel}:-`;
  }
}

/** Identity of the source tree (HEAD + working-tree diff + untracked files), lockfiles, project config and Node. */
export function fingerprint(dir, d) {
  const parts = [];
  if (d.git.isRepo) {
    parts.push(sh('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim());
    parts.push(sh('git', ['diff', 'HEAD', '--no-color', '--no-ext-diff'], { cwd: dir }).stdout);
    const untracked = sh('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: dir }).stdout.split('\0').filter(Boolean);
    for (const f of untracked.slice(0, 5000)) parts.push(statSig(dir, f));
  } else {
    for (const f of listCandidateFiles(dir, false)) parts.push(statSig(dir, f));
  }
  for (const lock of LOCKFILES) if (exists(path.join(dir, lock))) parts.push(statSig(dir, lock));
  if (exists(path.join(dir, 'bid.config.json'))) parts.push(fs.readFileSync(path.join(dir, 'bid.config.json'), 'utf8'));
  parts.push(sh('node', ['--version']).stdout.trim());
  return crypto.createHash('sha1').update(parts.join('\u0000')).digest('hex');
}

// ---------------------------------------------------------------- orchestration

export function overallStatus(steps) {
  const counts = { pass: 0, info: 0, warn: 0, fail: 0 };
  for (const s of steps) if (counts[s.status] !== undefined) counts[s.status]++;
  const status = counts.fail > 0 ? 'blocked' : counts.warn > 0 ? 'warnings' : 'ready';
  return { status, counts };
}

export async function runChecks(project, { stopOnFail = false, skip = [], force = false } = {}) {
  const dir = project.path;
  const ctx = { dir, key: project.key, d: detect(dir) };
  const started = Date.now();
  const results = [];
  let halted = false;
  // lint/typecheck/build are reused from the last passing run while nothing relevant changed (--force runs everything)
  const prevCache = getState(project.key).stepCache || {};
  const stepCache = { ...prevCache };
  const fp = fingerprint(dir, ctx.d);

  for (const s of STEPS) ev.step(s.id, { label: s.label, category: s.category, status: 'pending' });

  // One step: skipped, reused from the cache, or run. Returns the full result (events are emitted here).
  const execute = async (s) => {
    if (halted || skip.includes(s.id)) {
      const r = { id: s.id, label: s.label, category: s.category, status: 'skipped', summary: halted ? t('check.skippedAfterFail') : t('check.skipped') };
      ev.step(s.id, r);
      return r;
    }
    const hit = !force && CACHEABLE.has(s.id) ? prevCache[s.id] : null;
    if (hit && hit.fingerprint === fp && hit.result?.status === 'pass' && (s.id !== 'build' || ctx.d.ssr || ctx.d.publishReady)) {
      const full = { id: s.id, label: s.label, category: s.category, details: [], fixes: [], ...hit.result, duration: 0, cached: true, summary: t('check.cachedSummary', { summary: hit.result.summary || '' }) };
      ev.step(s.id, full);
      return full;
    }
    ev.step(s.id, { label: s.label, category: s.category, status: 'running' });
    const t0 = Date.now();
    let r;
    try {
      r = await RUNNERS[s.id](ctx);
    } catch (e) {
      r = { status: 'fail', summary: t('check.internalError', { error: e.message }) };
    }
    const full = { id: s.id, label: s.label, category: s.category, details: [], fixes: [], duration: (Date.now() - t0) / 1000, ...r };
    ev.step(s.id, full);
    if (CACHEABLE.has(s.id)) {
      if (full.status === 'pass') stepCache[s.id] = { fingerprint: fp, result: { status: full.status, summary: full.summary, details: full.details, log: full.log, duration: full.duration } };
      else delete stepCache[s.id];
    }
    return full;
  };

  // Steps in one group only read the project, so they run at the same time (lint + typecheck, V10.1);
  // results keep the STEPS order, and stop-on-fail applies after the whole group.
  for (let i = 0; i < STEPS.length; ) {
    const group = PARALLEL_GROUPS.find((g) => g[0] === STEPS[i].id && STEPS.slice(i, i + g.length).every((st, k) => st.id === g[k]));
    const batch = group ? STEPS.slice(i, i + group.length) : [STEPS[i]];
    const out = await Promise.all(batch.map(execute));
    for (const full of out) {
      results.push(full);
      if (full.status === 'fail' && stopOnFail) halted = true;
    }
    i += batch.length;
  }

  const { status, counts } = overallStatus(results);
  const check = { status, at: nowISO(), counts, steps: results, duration: (Date.now() - started) / 1000, cached: results.filter((r) => r.cached).map((r) => r.id) };
  setState(project.key, { check, stepCache });
  updateProject(project.key, { framework: ctx.d.framework, packageManager: ctx.d.packageManager, publishDir: ctx.d.publishDir });
  addHistory({
    project: project.key,
    projectName: project.name,
    kind: 'check',
    status: status === 'blocked' ? 'fail' : 'ok',
    message: status === 'ready' ? t('check.history.ready') : status === 'warnings' ? t('check.history.warnings', { count: counts.warn }) : t('check.history.errors', { count: counts.fail }),
    duration: check.duration,
    log: results.find((r) => r.status === 'fail' && r.log)?.log || null,
  });
  return check;
}
