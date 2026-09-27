// Safe auto-fixes — listed with a preview, applied only with --yes (the app asks first)
import fs from 'node:fs';
import path from 'node:path';
import { EngineError, ev, sh, exists, runStream, logDir, which } from './util.mjs';
import { detect } from './detect.mjs';
import { addHistory } from './store.mjs';

const BG = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya' };

export function repoSlug(name) {
  const t = String(name)
    .toLowerCase()
    .split('')
    .map((c) => BG[c] ?? c)
    .join('')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return t || 'project';
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
      title: 'Създай .gitignore',
      description: 'Проектът няма .gitignore. Ще създам такъв с node_modules, .env файлове, .netlify и системни файлове.',
      preview: ESSENTIALS.join('\n'),
      risk: 'safe',
    });
  } else {
    const missing = missingEssentials(gi);
    const needsEnv = !envIgnored(dir, d.git.isRepo);
    if (needsEnv || missing.some((m) => m.startsWith('node_modules') || m.startsWith('.netlify'))) {
      fixes.push({
        id: 'gitignore.env',
        title: 'Защити .env и служебните папки',
        description: 'Ще добавя липсващите редове в края на .gitignore. Нищо съществуващо няма да бъде променено.',
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
        title: 'Спри проследяването на .env',
        description:
          'Ще махна файловете от Git индекса (git rm --cached) — остават на диска. ВАЖНО: ако вече са качени в GitHub, смени ключовете в тях.',
        preview: tracked.join('\n'),
        risk: 'caution',
      });
    }
  } else if (which('git')) {
    fixes.push({
      id: 'git.init',
      title: 'Инициализирай Git',
      description: 'Ще изпълня git init -b main (и ще създам .gitignore, ако липсва). Без commit и без remote.',
      preview: 'git init -b main',
      risk: 'safe',
    });
  }

  if (d.hasPackageJson && !d.hasNodeModules) {
    fixes.push({
      id: 'deps.install',
      title: 'Инсталирай зависимостите',
      description: `Ще изпълня ${d.packageManager} install в папката на проекта.`,
      preview: `${d.packageManager} install`,
      risk: 'safe',
    });
  }

  if (d.git.isRepo && !d.git.remote && which('gh') && sh('gh', ['auth', 'status'], { timeout: 12000 }).code === 0) {
    const repo = repoSlug(path.basename(dir));
    fixes.push({
      id: 'github.create',
      title: 'Създай GitHub repo',
      description: `Ще създам ЧАСТНО repo „${repo}“ в твоя GitHub акаунт, ще го добавя като origin и ще кача кода. Ако няма commit, първо ще направя „Initial commit“.`,
      preview: `gh repo create ${repo} --private --source . --remote origin --push`,
      risk: 'safe',
    });
  }

  if (!d.netlifyLinked) {
    fixes.push({
      id: 'netlify.link',
      title: 'Свържи с Netlify',
      description: 'Свържи папката със съществуващ Netlify сайт или създай нов (без CI от GitHub).',
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

export async function applyFix(project, id, { yes = false } = {}) {
  if (!yes) throw new EngineError('Auto-fix изисква потвърждение (--yes).', 'confirm_required', 2);
  const dir = project.path;
  const d = detect(dir);
  ev.step('fix', { label: id, status: 'running' });
  let summary = '';

  switch (id) {
    case 'gitignore.create':
    case 'gitignore.env': {
      const added = ensureGitignore(dir);
      summary = added.length ? `Добавени: ${added.join(', ')}` : '.gitignore вече е наред';
      break;
    }
    case 'env.untrack': {
      const tracked = trackedEnvFiles(dir);
      ensureGitignore(dir);
      if (tracked.length) {
        const r = sh('git', ['rm', '--cached', '--quiet', '--', ...tracked], { cwd: dir });
        if (r.code !== 0) throw new EngineError(r.stderr.trim() || 'git rm --cached се провали', 'fix_failed');
      }
      summary = `Махнати от индекса: ${tracked.join(', ')}. Направи commit, за да влезе в сила.`;
      break;
    }
    case 'git.init': {
      if (d.git.isRepo) {
        summary = 'Вече е Git repository';
        break;
      }
      ensureGitignore(dir);
      let r = sh('git', ['init', '-b', 'main'], { cwd: dir });
      if (r.code !== 0) r = sh('git', ['init'], { cwd: dir });
      if (r.code !== 0) throw new EngineError(r.stderr.trim() || 'git init се провали', 'fix_failed');
      summary = 'Git е инициализиран (branch main)';
      break;
    }
    case 'deps.install': {
      const logFile = path.join(logDir(project.key), 'install.log');
      const r = await runStream(d.packageManager || 'npm', ['install'], { cwd: dir, step: 'fix', logFile, timeout: 15 * 60 * 1000 });
      if (r.code !== 0) {
        ev.step('fix', { label: id, status: 'fail', summary: 'install се провали', details: r.tail.slice(-15), log: logFile });
        throw new EngineError('Инсталацията на зависимостите се провали.', 'fix_failed');
      }
      summary = 'Зависимостите са инсталирани';
      break;
    }
    case 'github.create': {
      if (!which('gh')) throw new EngineError('Няма GitHub CLI — инсталирай го от „Настройка“.', 'missing_cli');
      if (d.git.remote) {
        summary = 'Вече има origin remote';
        break;
      }
      if (sh('git', ['rev-parse', 'HEAD'], { cwd: dir }).code !== 0) {
        ensureGitignore(dir);
        sh('git', ['add', '-A'], { cwd: dir });
        const c = sh('git', ['commit', '-m', 'Initial commit'], { cwd: dir });
        if (c.code !== 0) throw new EngineError(c.stderr.trim() || 'Initial commit се провали', 'fix_failed');
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
        ev.step('fix', { label: id, status: 'fail', summary: 'gh repo create се провали', details: r.tail.slice(-10), log: logFile });
        throw new EngineError('GitHub repo не беше създадено (може името да е заето).', 'fix_failed');
      }
      summary = `Създадено частно repo ${repo} и кодът е качен`;
      break;
    }
    case 'netlify.link':
      throw new EngineError('Свързването с Netlify става от панела Netlify Setup.', 'ui_action');
    default:
      throw new EngineError(`Непознат fix: ${id}`, 'usage', 2);
  }
  ev.step('fix', { label: id, status: 'pass', summary });
  addHistory({ project: project.key, projectName: project.name, kind: 'fix', status: 'ok', message: `${id}: ${summary}` });
  return { id, summary };
}
