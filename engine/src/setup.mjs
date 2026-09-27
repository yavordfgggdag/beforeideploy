// Setup Center — detects every tool/account the workflow needs and fixes what is missing
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { HOME, ENGINE_DIR, CACHE_DIR, EngineError, ev, emit, sh, which, runStream, ensureDir, exists, readJSON } from './util.mjs';
import { netlifyAuth, netlifyLogin } from './netlify.mjs';
import { spaceshipConnected } from './spaceship.mjs';
import { providerStatus } from './hosting.mjs';
import { t, msg } from './i18n.mjs';

function fileHas(file, re) {
  try {
    return re.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

function version(cmd, args = ['--version']) {
  const r = sh(cmd, args, { timeout: 15000 });
  return r.code === 0 ? (r.stdout || r.stderr).trim().split('\n')[0] : null;
}

const npmInstall = (pkg) => ({ type: 'run', label: 'Инсталирай', cmd: 'npm', args: ['install', '-g', pkg], display: `npm i -g ${pkg}` });

export function setupStatus() {
  const items = [];
  const add = (group, id, title, ok, detail, action = null, optional = false) =>
    items.push({ group, id, title, ok, detail, action: ok ? null : action, optional });

  // ---------------------------------------------------------------- base
  add('Основа', 'node', 'Node.js', !!which('node'), which('node') ? version('node') : 'Нужен за всички проекти', {
    type: 'open',
    label: 'Изтегли',
    url: 'https://nodejs.org/en/download',
  });
  add('Основа', 'git', 'Git', !!which('git'), which('git') ? version('git') : 'Нужен за GitHub', {
    type: 'terminal',
    label: 'Инсталирай',
    script: 'xcode-select --install',
  });
  const name = which('git') ? sh('git', ['config', '--global', 'user.name']).stdout.trim() : '';
  const email = which('git') ? sh('git', ['config', '--global', 'user.email']).stdout.trim() : '';
  add('Основа', 'git-identity', 'Git име и имейл', !!(name && email), name && email ? `${name} <${email}>` : 'Ще ги взема автоматично от GitHub акаунта ти', {
    type: 'run',
    label: 'Вземи от GitHub',
    display: 'от GitHub профила',
  });
  const brew = which('brew');
  add('Основа', 'brew', 'Homebrew', !!brew, brew ? 'Инсталиран' : 'По желание — улеснява инсталирането на gh', {
    type: 'terminal',
    label: 'Инсталирай',
    script: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
  }, true);

  // ---------------------------------------------------------------- hosting & git
  const nlCli = which('netlify');
  add('Hosting & GitHub', 'netlify-cli', 'Netlify CLI', !!nlCli, nlCli ? version('netlify') : 'Без него всяка команда минава през по-бавния npx', npmInstall('netlify-cli'));
  const na = netlifyAuth();
  add('Hosting & GitHub', 'netlify-login', 'Netlify акаунт', na.loggedIn, na.loggedIn ? na.email || 'Влязъл' : 'Нужен за deploy', {
    type: 'run',
    label: 'Вход в браузъра',
    display: 'отваря браузъра',
  });
  const gh = which('gh');
  add(
    'Hosting & GitHub',
    'gh',
    'GitHub CLI',
    !!gh,
    gh ? version('gh') : 'За автоматично създаване на repo и CI статус',
    brew ? { type: 'run', label: 'Инсталирай', cmd: 'brew', args: ['install', 'gh'], display: 'brew install gh' } : { type: 'open', label: 'Изтегли', url: 'https://cli.github.com' }
  );
  const ghAuth = gh ? sh('gh', ['auth', 'status'], { timeout: 12000 }).code === 0 : false;
  add('Hosting & GitHub', 'gh-auth', 'GitHub акаунт', ghAuth, ghAuth ? 'Влязъл' : 'Отваря браузъра — само потвърждаваш', {
    type: 'run',
    label: 'Вход в браузъра',
    display: 'github.com/login/device',
  });
  add('Hosting & GitHub', 'spaceship', 'Spaceship (домейни & DNS)', spaceshipConnected(), spaceshipConnected() ? 'Свързан' : 'API ключ от Spaceship → домейни, DNS, изтичане', {
    type: 'app',
    label: 'Свържи',
    appAction: 'spaceship-connect',
  }, true);

  const vc = which('vercel');
  add('Hosting & GitHub', 'vercel', 'Vercel CLI', !!vc, vc ? version('vercel') : 'Хостинг за Next.js и SSR проекти', npmInstall('vercel'), true);
  const vcAuth = providerStatus('vercel').loggedIn;
  add('Hosting & GitHub', 'vercel-auth', 'Vercel акаунт', vcAuth, vcAuth ? 'Влязъл' : vc ? 'Вход в браузъра' : 'Първо инсталирай Vercel CLI', vc ? { type: 'terminal', label: 'Вход в браузъра', script: 'vercel login' } : null, true);
  const wr = which('wrangler');
  add('Hosting & GitHub', 'wrangler', 'Cloudflare Wrangler', !!wr, wr ? version('wrangler') : 'Хостинг на статични сайтове в Cloudflare Pages', npmInstall('wrangler'), true);
  const wrAuth = providerStatus('cloudflare').loggedIn;
  add('Hosting & GitHub', 'wrangler-auth', 'Cloudflare акаунт', wrAuth, wrAuth ? 'Влязъл' : wr ? 'Вход в браузъра' : 'Първо инсталирай Wrangler', wr ? { type: 'terminal', label: 'Вход в браузъра', script: 'wrangler login' } : null, true);

  // ---------------------------------------------------------------- AI
  const codex = which('codex');
  add('AI помощници', 'codex', 'Codex CLI', !!codex, codex ? version('codex') : 'AI Fix директно в проекта (ChatGPT акаунт)', npmInstall('@openai/codex'), true);
  const codexAuth = exists(path.join(HOME, '.codex', 'auth.json')) || !!process.env.OPENAI_API_KEY;
  add('AI помощници', 'codex-auth', 'Codex вход', codexAuth, codexAuth ? 'Влязъл' : codex ? 'Влез с ChatGPT акаунта' : 'Първо инсталирай Codex', codex ? {
    type: 'terminal',
    label: 'Вход',
    script: 'codex login',
  } : null, true);
  const claude = which('claude');
  add('AI помощници', 'claude-code', 'Claude Code', !!claude, claude ? version('claude') : 'AI Fix директно в проекта (Claude акаунт)', npmInstall('@anthropic-ai/claude-code'), true);
  const claudeAuth = fileHas(path.join(HOME, '.claude.json'), /oauthAccount|primaryApiKey/) || !!process.env.ANTHROPIC_API_KEY;
  add('AI помощници', 'claude-auth', 'Claude Code вход', claudeAuth, claudeAuth ? 'Влязъл' : claude ? 'Отвори Claude Code веднъж, за да влезеш' : 'Първо инсталирай Claude Code', claude ? {
    type: 'terminal',
    label: 'Вход',
    script: 'echo "Влез в Claude Code, после напиши /exit"; claude',
  } : null, true);

  const required = items.filter((i) => !i.optional);
  return {
    items,
    ready: required.every((i) => i.ok),
    missingRequired: required.filter((i) => !i.ok).length,
    missingOptional: items.filter((i) => i.optional && !i.ok).length,
  };
}

function setupDir() {
  return ensureDir(path.join(CACHE_DIR, 'setup'));
}

function writeCommand(name, body) {
  const file = path.join(setupDir(), `${name}.command`);
  const envFile = path.join(ENGINE_DIR, 'env.zsh');
  fs.writeFileSync(
    file,
    `#!/bin/zsh\n# Before I Deploy — Настройка\n[ -f '${envFile}' ] && source '${envFile}'\nclear\n${body}\necho\necho "Можеш да затвориш прозореца и да натиснеш „Обнови“ в Before I Deploy."\n`
  );
  fs.chmodSync(file, 0o755);
  return file;
}

export function setupTerminal(id) {
  const st = setupStatus();
  const todo = id === 'all' ? st.items.filter((i) => !i.ok && i.action?.type === 'terminal' && !i.optional) : st.items.filter((i) => i.id === id);
  if (!todo.length) throw new EngineError(msg('setup.terminal.nothing'), 'nothing');
  const body = todo
    .filter((i) => i.action?.type === 'terminal')
    .map((i) => `echo "━━━ ${i.title} ━━━"\n${i.action.script}\necho`)
    .join('\n');
  if (!body) throw new EngineError(msg('setup.terminal.notTerminal'), 'usage', 2);
  return { commandFile: writeCommand(id, body) };
}

export async function setupRun(id, { yes = false } = {}) {
  if (!yes) throw new EngineError(msg('setup.run.confirmRequired'), 'confirm_required', 2);
  const item = setupStatus().items.find((i) => i.id === id);
  if (!item) throw new EngineError(msg('setup.unknownStep', { id }), 'usage', 2);
  if (item.ok) return { id, ok: true, skipped: true };
  if (item.action?.type !== 'run') throw new EngineError(msg('setup.notRunnable'), 'not_runnable');
  if (id === 'gh-auth') return ghDeviceLogin();
  if (id === 'git-identity') return gitIdentityFromGitHub();
  if (id === 'netlify-login') {
    await netlifyLogin();
    return { id, ok: true };
  }
  ev.step(id, { label: item.title, status: 'running', summary: item.action.display });
  const r = await runStream(item.action.cmd, item.action.args, { step: id, cwd: HOME, logFile: path.join(setupDir(), `${id}.log`), timeout: 10 * 60 * 1000 });
  const ok = r.code === 0;
  ev.step(id, { label: item.title, status: ok ? 'pass' : 'fail', summary: ok ? t('setup.installed') : t('setup.errorCode', { code: r.code }), details: ok ? [] : r.tail.slice(-10) });
  if (!ok) throw new EngineError(msg('setup.installFailed', { title: item.title }), 'install_failed');
  return { id, ok: true };
}

/** Installs every missing non-interactive item, then returns what still needs a Terminal/browser/app step. */
export async function setupAuto({ yes = false, includeOptional = false } = {}) {
  if (!yes) throw new EngineError(msg('setup.auto.confirmRequired'), 'confirm_required', 2);
  const st = setupStatus();
  const ORDER = ['netlify-cli', 'gh', 'vercel', 'wrangler', 'codex', 'claude-code', 'gh-auth', 'git-identity', 'netlify-login'];
  const rank = (id) => (ORDER.includes(id) ? ORDER.indexOf(id) : 50);
  const runnable = st.items
    .filter((i) => !i.ok && i.action?.type === 'run' && (includeOptional || !i.optional))
    .sort((a, b) => rank(a.id) - rank(b.id));
  for (const i of runnable) ev.step(i.id, { label: i.title, status: 'pending', summary: i.action.display });
  const failed = [];
  for (const i of runnable) {
    try {
      await setupRun(i.id, { yes: true });
    } catch {
      failed.push(i.id);
    }
  }
  const after = setupStatus();
  const interactive = after.items.filter((i) => !i.ok && (includeOptional || !i.optional) && i.action && i.action.type !== 'run');
  let commandFile = null;
  const term = interactive.filter((i) => i.action.type === 'terminal');
  if (term.length) {
    commandFile = writeCommand('auto', term.map((i) => `echo "━━━ ${i.title} ━━━"\n${i.action.script}\necho`).join('\n'));
  }
  return { installed: runnable.map((i) => i.id).filter((id) => !failed.includes(id)), failed, interactive, commandFile, status: after };
}

// ---------------------------------------------------------------- GitHub device login (browser, no typing)

export async function ghDeviceLogin() {
  if (!which('gh')) throw new EngineError(msg('setup.gh.installFirst'), 'missing_cli');
  ev.step('gh-auth', { label: t('setup.gh.label'), status: 'running', summary: t('setup.gh.opening') });
  let announced = false;
  const r = await new Promise((resolve) => {
    const child = spawn('gh', ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https'], {
      env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const onData = (buf) => {
      const text = buf.toString();
      for (const line of text.split('\n')) if (line.trim()) ev.log('gh-auth', line.trim());
      const code = text.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i);
      if (code && !announced) {
        announced = true;
        emit({ type: 'devicecode', service: 'GitHub', code: code[1], url: 'https://github.com/login/device' });
        ev.step('gh-auth', { label: t('setup.gh.label'), status: 'running', summary: t('setup.gh.code', { code: code[1] }) });
      }
      if (/Press Enter/i.test(text)) child.stdin.write('\n');
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill('SIGTERM'), 5 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  const ok = sh('gh', ['auth', 'status'], { timeout: 15000 }).code === 0;
  if (!ok) {
    ev.step('gh-auth', { label: t('setup.gh.label'), status: 'fail', summary: t('setup.gh.notConfirmed', { code: r }) });
    throw new EngineError(msg('setup.gh.failed'), 'login_failed');
  }
  sh('gh', ['auth', 'setup-git'], { timeout: 15000 });
  ev.step('gh-auth', { label: t('setup.gh.label'), status: 'pass', summary: t('setup.gh.connected') });
  const id = sh('git', ['config', '--global', 'user.email']).stdout.trim();
  if (!id) await gitIdentityFromGitHub();
  return { id: 'gh-auth', ok: true };
}

export async function gitIdentityFromGitHub() {
  if (!which('gh') || sh('gh', ['auth', 'status'], { timeout: 15000 }).code !== 0) {
    ev.step('git-identity', { label: t('setup.identity.label'), status: 'running', summary: t('setup.identity.needsLogin') });
    await ghDeviceLogin();
  }
  ev.step('git-identity', { label: t('setup.identity.label'), status: 'running', summary: t('setup.identity.reading') });
  const r = sh('gh', ['api', 'user'], { timeout: 20000 });
  let u = null;
  try {
    u = JSON.parse(r.stdout);
  } catch {}
  if (!u?.login) throw new EngineError(msg('setup.identity.failed'), 'github_failed');
  const name = u.name || u.login;
  // GitHub's private noreply address — commits still count for your profile, your real email stays hidden
  const email = u.email || `${u.id}+${u.login}@users.noreply.github.com`;
  sh('git', ['config', '--global', 'user.name', name]);
  sh('git', ['config', '--global', 'user.email', email]);
  ev.step('git-identity', { label: t('setup.identity.label'), status: 'pass', summary: `${name} <${email}>` });
  return { id: 'git-identity', ok: true, name, email };
}
