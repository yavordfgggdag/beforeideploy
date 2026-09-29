// Safe auto-fixes — listed with a preview, applied only with --yes (the app asks first)
import fs from 'node:fs';
import path from 'node:path';
import { EngineError, ev, sh, exists, runStream, logDir, which } from './util.mjs';
import { detect } from './detect.mjs';
import { addHistory, getState, setState } from './store.mjs';
import { t, msg } from './i18n.mjs';

const BG = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya' };

export function repoSlug(name) {
  const slug = String(name)
    .toLowerCase()
    .split('')
    .map((c) => BG[c] ?? c)
    .join('')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'project';
}

const ESSENTIALS = ['node_modules/', '.env', '.env.*', '!.env.example', '.netlify/', '.DS_Store', '*.log'];

function gitignoreText(dir) {
  const f = path.join(dir, '.gitignore');
  return exists(f) ? fs.readFileSync(f, 'utf8') : null;
}

function missingEssentials(text) {
  const lines = new Set((text || '').split('\n').map((l) => l.trim()));
  return ESSENTIALS.filter((e) => !lines.has(e) && !lines.has(e.replace(/\/$/, '')) && !lines.has('/' + e));
}

function trackedEnvFiles(dir) {
  return sh('git', ['ls-files'], { cwd: dir })
    .stdout.split('\n')
    .filter((f) => /(^|\/)\.env(\.[^/]+)?$/.test(f) && !/\.(example|sample|template|dist|defaults)$/i.test(f));
}

function envIgnored(dir, isRepo) {
  if (isRepo) {
    // test with a hypothetical path so it works even when no .env exists yet
    return sh('git', ['check-ignore', '-q', '--no-index', '.env'], { cwd: dir }).code === 0;
  }
  return /^\.env/m.test(gitignoreText(dir) || '');
}

export function listFixes(dir) {
  const d = detect(dir);
  const fixes = [];
  const gi = gitignoreText(dir);

  if (gi === null) {
    fixes.push({
      id: 'gitignore.create',
      title: t('fix.gitignoreCreate.title'),
      description: t('fix.gitignoreCreate.description'),
      preview: ESSENTIALS.join('\n'),
      risk: 'safe',
    });
  } else {
    const missing = missingEssentials(gi);
    const needsEnv = !envIgnored(dir, d.git.isRepo);
    if (needsEnv || missing.some((m) => m.startsWith('node_modules') || m.startsWith('.netlify'))) {
      fixes.push({
        id: 'gitignore.env',
        title: t('fix.gitignoreEnv.title'),
        description: t('fix.gitignoreEnv.description'),
        preview: missing.join('\n'),
        risk: 'safe',
      });
    }
  }

  if (d.git.isRepo) {
    const tracked = trackedEnvFiles(dir);
    if (tracked.length) {
      fixes.push({
        id: 'env.untrack',
        title: t('fix.envUntrack.title'),
        description: t('fix.envUntrack.description'),
        preview: tracked.join('\n'),
        risk: 'caution',
      });
    }
  } else if (which('git')) {
    fixes.push({
      id: 'git.init',
      title: t('fix.gitInit.title'),
      description: t('fix.gitInit.description'),
      preview: 'git init -b main',
      risk: 'safe',
    });
  }

  if (d.hasPackageJson && !d.hasNodeModules) {
    fixes.push({
      id: 'deps.install',
      title: t('fix.deps.title'),
      description: t('fix.deps.description', { pm: d.packageManager }),
      preview: `${d.packageManager} install`,
      risk: 'safe',
    });
  }

  if (d.git.isRepo && !d.git.remote && which('gh') && sh('gh', ['auth', 'status'], { timeout: 12000 }).code === 0) {
    const repo = repoSlug(path.basename(dir));
    fixes.push({
      id: 'github.create',
      title: t('fix.github.title'),
      description: t('fix.github.description', { repo }),
      preview: `gh repo create ${repo} --private --source . --remote origin --push`,
      risk: 'safe',
    });
  }

  if (!d.netlifyLinked) {
    fixes.push({
      id: 'netlify.link',
      title: t('fix.netlifyLink.title'),
      description: t('fix.netlifyLink.description'),
      action: 'ui:netlify-setup',
      risk: 'safe',
    });
  }
  return fixes;
}

function ensureGitignore(dir) {
  const f = path.join(dir, '.gitignore');
  const text = gitignoreText(dir);
  if (text === null) {
    fs.writeFileSync(f, `# Before I Deploy\n${ESSENTIALS.join('\n')}\n`);
    return ESSENTIALS;
  }
  const missing = missingEssentials(text);
  if (missing.length) {
    const sep = text.endsWith('\n') || text === '' ? '' : '\n';
    fs.appendFileSync(f, `${sep}\n# Before I Deploy\n${missing.join('\n')}\n`);
  }
  return missing;
}

export async function applyFix(project, id, { yes = false, recheck = false } = {}) {
  if (!yes) throw new EngineError(msg('fix.confirmRequired'), 'confirm_required', 2);
  const dir = project.path;
  const d = detect(dir);
  ev.step('fix', { label: id, status: 'running' });
  let summary = '';

  switch (id) {
    case 'gitignore.create':
    case 'gitignore.env': {
      const added = ensureGitignore(dir);
      summary = added.length ? t('fix.gitignore.added', { files: added.join(', ') }) : t('fix.gitignore.ok');
      break;
    }
    case 'env.untrack': {
      const tracked = trackedEnvFiles(dir);
      ensureGitignore(dir);
      if (tracked.length) {
        const r = sh('git', ['rm', '--cached', '--quiet', '--', ...tracked], { cwd: dir });
        if (r.code !== 0) throw new EngineError(r.stderr.trim() || msg('fix.untrack.failed'), 'fix_failed');
      }
      summary = t('fix.untrack.done', { files: tracked.join(', ') });
      break;
    }
    case 'git.init': {
      if (d.git.isRepo) {
        summary = t('fix.gitInit.already');
        break;
      }
      ensureGitignore(dir);
      let r = sh('git', ['init', '-b', 'main'], { cwd: dir });
      if (r.code !== 0) r = sh('git', ['init'], { cwd: dir });
      if (r.code !== 0) throw new EngineError(r.stderr.trim() || msg('fix.gitInit.failed'), 'fix_failed');
      summary = t('fix.gitInit.done');
      break;
    }
    case 'deps.install': {
      const logFile = path.join(logDir(project.key), 'install.log');
      const r = await runStream(d.packageManager || 'npm', ['install'], { cwd: dir, step: 'fix', logFile, timeout: 15 * 60 * 1000 });
      if (r.code !== 0) {
        ev.step('fix', { label: id, status: 'fail', summary: t('fix.deps.stepFailed'), details: r.tail.slice(-15), log: logFile });
        throw new EngineError(msg('fix.deps.failed'), 'fix_failed');
      }
      summary = t('fix.deps.done');
      break;
    }
    case 'github.create': {
      if (!which('gh')) throw new EngineError(msg('fix.github.noCli'), 'missing_cli');
      if (d.git.remote) {
        summary = t('fix.github.hasRemote');
        break;
      }
      if (sh('git', ['rev-parse', 'HEAD'], { cwd: dir }).code !== 0) {
        ensureGitignore(dir);
        sh('git', ['add', '-A'], { cwd: dir });
        const c = sh('git', ['commit', '-m', 'Initial commit'], { cwd: dir });
        if (c.code !== 0) throw new EngineError(c.stderr.trim() || msg('fix.github.initialCommitFailed'), 'fix_failed');
      }
      const repo = repoSlug(path.basename(dir));
      const logFile = path.join(logDir(project.key), 'github-create.log');
      const r = await runStream('gh', ['repo', 'create', repo, '--private', '--source', '.', '--remote', 'origin', '--push'], {
        cwd: dir,
        step: 'fix',
        logFile,
        timeout: 180000,
      });
      if (r.code !== 0) {
        ev.step('fix', { label: id, status: 'fail', summary: t('fix.github.stepFailed'), details: r.tail.slice(-10), log: logFile });
        throw new EngineError(msg('fix.github.failed'), 'fix_failed');
      }
      summary = t('fix.github.done', { repo });
      break;
    }
    case 'netlify.link':
      throw new EngineError(msg('fix.netlifyLink.ui'), 'ui_action');
    default:
      throw new EngineError(msg('fix.unknown', { id }), 'usage', 2);
  }
  ev.step('fix', { label: id, status: 'pass', summary });
  addHistory({ project: project.key, projectName: project.name, kind: 'fix', status: 'ok', message: `${id}: ${summary}` });
  const out = { id, summary };
  if (recheck) out.recheck = await verifyFix(project, id);
  return out;
}

/**
 * Re-runs the checks after a safe fix and compares the issues it targeted (V11): `verified` is true only
 * when every issue this fix was meant to remove is gone. A run that still fails is reported, never hidden.
 */
async function verifyFix(project, id) {
  const { runChecks } = await import('./checks.mjs');
  const { deriveIssues, compareIssues, FIX_VERIFIES } = await import('./issues.mjs');
  const before = deriveIssues(getState(project.key).check).issues;
  const targets = new Set(before.filter((i) => i.fix?.type === 'safe' && i.fix.id === id).map((i) => i.id));
  const check = await runChecks(project, { stopOnFail: false });
  const after = deriveIssues(check).issues;
  const cmp = compareIssues(before, after, targets);
  const steps = FIX_VERIFIES[id] || [];
  const stepsOk = steps.every((sid) => ['pass', 'warn', 'info'].includes(check.steps.find((s) => s.id === sid)?.status));
  const out = { status: check.status, at: check.at, steps, verified: cmp.verified && stepsOk, resolved: cmp.resolved, unresolved: cmp.unresolved };
  setState(project.key, { lastRecheck: { kind: 'fix', fix: id, ...out } });
  return out;
}
