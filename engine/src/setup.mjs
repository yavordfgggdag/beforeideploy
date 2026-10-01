// Setup Center — detects every tool/account the workflow needs and fixes what is missing
import fs from 'node:fs';
import path from 'node:path';
import { HOME, ENGINE_DIR, CACHE_DIR, APP_DIR, EngineError, ev, emit, sh, which, runStream, ensureDir, exists, readJSON } from './util.mjs';
import { netlifyAuth, netlifyLogin } from './netlify.mjs';
import { spaceshipConnected } from './spaceship.mjs';
import { providerStatus } from './hosting.mjs';
import { t, msg } from './i18n.mjs';
import { cloudDoctor, cloudSetupItems } from './cloud.mjs';
import { aiKeysStatus } from './aikeys.mjs';
import { listProjects } from './store.mjs';
import { cliEnv } from './isolation.mjs';
import { gitAvailable, resolveNpm, TOOL_PACKAGES, installManaged, installGitHub, setupLock, setupPreflight } from './setup-tools.mjs';

/** VIP/admin only (docs/PLANS-AND-CREDITS-BG.md): the last profile seen says which role this Mac has. */
function ownKeyAllowed() {
  const role = readJSON(path.join(APP_DIR, 'profile.json'), null)?.role;
  return role === 'vip' || role === 'admin';
}

function fileHas(file, re) {
  try {
    return re.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

const npmInstall = (pkg) => ({ type: 'run', label: t('setup.action.install'), display: t('setup.managedInstall'), package: pkg });

export async function setupStatus() {
  const git = gitAvailable();
  const commands = ['node', 'git', 'brew', 'netlify', 'gh', 'vercel', 'wrangler', 'codex', 'claude'];
  const npm = resolveNpm();
  const [pairs, npmVersion, ghToken, gitName, gitEmail] = await Promise.all([
    Promise.all(commands.map(async cmd => {
      const binary = cmd === 'node' ? process.execPath : cmd === 'git' ? git : which(cmd);
      if (!binary) return [cmd, null];
      const r = await runStream(binary, ['--version'], { timeout: 4000, quiet: true });
      return [cmd, r.code === 0 ? r.tail[0] || 'OK' : null];
    })),
    npm ? runStream(npm.cmd, [...npm.args, '--version'], { timeout: 4000, quiet: true }) : null,
    which('gh') ? runStream('gh', ['auth', 'token'], { timeout: 4000, quiet: true }) : null,
    git ? runStream(git, ['config', '--global', 'user.name'], { timeout: 4000, quiet: true, captureStdout: true }) : null,
    git ? runStream(git, ['config', '--global', 'user.email'], { timeout: 4000, quiet: true, captureStdout: true }) : null,
  ]);
  const versions = Object.fromEntries(pairs);
  const version = cmd => versions[cmd];
  const installed = cmd => !!versions[cmd];
  const projects = listProjects();
  const providers = new Set(projects.length ? projects.map(p => p.hosting || 'netlify') : ['netlify']);
  const gitRequired = providers.has('ghpages') || projects.some(p => exists(path.join(p.path, '.git')) || p.github);
  const requiredIds = new Set(['node', 'npm']);
  if (providers.has('netlify')) ['netlify-cli', 'netlify-login'].forEach(id => requiredIds.add(id));
  if (providers.has('vercel')) ['vercel', 'vercel-auth'].forEach(id => requiredIds.add(id));
  if (providers.has('cloudflare')) ['wrangler', 'wrangler-auth'].forEach(id => requiredIds.add(id));
  if (gitRequired) ['git', 'git-identity'].forEach(id => requiredIds.add(id));
  if (providers.has('ghpages')) ['gh', 'gh-auth'].forEach(id => requiredIds.add(id));
  const items = [];
  const add = (group, id, title, ok, detail, action = null) => {
    const required = requiredIds.has(id);
    items.push({ group, id, title, ok, detail, action: ok ? null : action, optional: !required, required,
      state: ok ? 'ok' : id.endsWith('auth') || id.endsWith('login') ? 'needs_login' : 'missing' });
  };
  // ---------------------------------------------------------------- base
  add(t('setup.group.base'), 'node', 'Node.js', true, process.env.BID_NODE_RUNTIME === 'bundled' ? t('setup.bundledNode', { version: process.version }) : process.version, {
    type: 'open',
    label: t('setup.action.download'),
    url: 'https://nodejs.org/en/download',
  });
  add(t('setup.group.base'), 'npm', 'npm', npmVersion?.code === 0, npmVersion?.code === 0 ? npmVersion.tail[0] : t('setup.npmMissing'));
  add(t('setup.group.base'), 'git', 'Git', installed('git'), installed('git') ? version('git') : t('setup.git.detail'), {
    type: 'run',
    label: t('setup.action.install'),
    display: t('setup.cltWaiting'),
  });
  const name = installed('git') && gitName?.code === 0 ? gitName.stdout.trim() : '';
  const email = installed('git') && gitEmail?.code === 0 ? gitEmail.stdout.trim() : '';
  add(t('setup.group.base'), 'git-identity', t('setup.identity.label'), !!(name && email), name && email ? `${name} <${email}>` : t('setup.identity.detail'), {
    type: 'run',
    label: t('setup.action.fromGitHub'),
    display: t('setup.display.fromProfile'),
  });
  const brew = installed('brew');
  add(t('setup.group.base'), 'brew', 'Homebrew', !!brew, brew ? t('setup.brew.installed') : t('setup.brew.detail'), {
    type: 'open',
    label: t('setup.action.download'),
    url: 'https://brew.sh',
  }, true);

  // ---------------------------------------------------------------- hosting & git
  const nlCli = installed('netlify');
  add(t('setup.group.hosting'), 'netlify-cli', 'Netlify CLI', !!nlCli, nlCli ? version('netlify') : t('setup.netlifyCli.detail'), npmInstall('netlify-cli'));
  const na = netlifyAuth();
  add(t('setup.group.hosting'), 'netlify-login', t('setup.netlifyAccount.title'), na.loggedIn, na.loggedIn ? na.email || t('setup.loggedIn') : t('setup.netlifyAccount.detail'), {
    type: 'run',
    label: t('setup.action.browserLogin'),
    display: t('setup.display.opensBrowser'),
  });
  const gh = installed('gh');
  add(
    t('setup.group.hosting'),
    'gh',
    'GitHub CLI',
    !!gh,
    gh ? version('gh') : t('setup.gh.detail'),
    { type: 'run', label: t('setup.action.install'), display: t('setup.managedInstall') }
  );
  const ghAuth = gh && ghToken?.code === 0;
  add(t('setup.group.hosting'), 'gh-auth', t('setup.ghAccount.title'), ghAuth, ghAuth ? t('setup.loggedIn') : t('setup.ghAccount.detail'), {
    type: 'run',
    label: t('setup.action.browserLogin'),
    display: 'github.com/login/device',
  });
  const identityItem = items.find(i => i.id === 'git-identity');
  if (!ghAuth && !identityItem.ok) identityItem.action = { type: 'app', label: t('setup.identity.enter'), appAction: 'git-identity' };
  add(t('setup.group.hosting'), 'spaceship', t('setup.spaceship.title'), spaceshipConnected(), spaceshipConnected() ? t('setup.connected') : t('setup.spaceship.detail'), {
    type: 'app',
    label: t('setup.action.connect'),
    appAction: 'spaceship-connect',
  }, true);

  const vc = installed('vercel');
  add(t('setup.group.hosting'), 'vercel', 'Vercel CLI', !!vc, vc ? version('vercel') : t('setup.vercel.detail'), npmInstall('vercel'), true);
  const vcAuth = providerStatus('vercel').loggedIn;
  add(t('setup.group.hosting'), 'vercel-auth', t('setup.vercelAccount.title'), vcAuth, vcAuth ? t('setup.loggedIn') : vc ? t('setup.action.browserLogin') : t('setup.vercelAccount.installFirst'), vc ? { type: 'run', label: t('setup.action.browserLogin'), cmd: 'vercel', args: ['login'], display: t('setup.display.opensBrowser') } : null, true);
  const wr = installed('wrangler');
  add(t('setup.group.hosting'), 'wrangler', 'Cloudflare Wrangler', !!wr, wr ? version('wrangler') : t('setup.wrangler.detail'), npmInstall('wrangler'), true);
  const wrAuth = providerStatus('cloudflare').loggedIn;
  add(t('setup.group.hosting'), 'wrangler-auth', t('setup.cloudflareAccount.title'), wrAuth, wrAuth ? t('setup.loggedIn') : wr ? t('setup.action.browserLogin') : t('setup.cloudflareAccount.installFirst'), wr ? { type: 'run', label: t('setup.action.browserLogin'), cmd: 'wrangler', args: ['login'], display: t('setup.display.opensBrowser') } : null, true);

  // ---------------------------------------------------------------- AI
  if (ownKeyAllowed()) {
    const keys = aiKeysStatus();
    const keyOn = keys.find((k) => k.connected);
    add(t('setup.group.ai'), 'ai-key', t('setup.aiKey.title'), !!keyOn, keyOn ? t('setup.aiKey.ok', { name: keyOn.name, hint: keyOn.hint || '' }) : t('setup.aiKey.detail'), {
      type: 'app',
      label: t('setup.action.addKey'),
      appAction: 'ai-key',
      display: t('setup.display.keychain'),
    }, true);
  }
  const codex = installed('codex');
  add(t('setup.group.ai'), 'codex', 'Codex CLI', !!codex, codex ? version('codex') : t('setup.codex.detail'), npmInstall('@openai/codex'), true);
  const codexAuth = exists(path.join(HOME, '.codex', 'auth.json')) || !!process.env.OPENAI_API_KEY;
  add(t('setup.group.ai'), 'codex-auth', t('setup.codexAuth.title'), codexAuth, codexAuth ? t('setup.loggedIn') : codex ? t('setup.codexAuth.detail') : t('setup.codexAuth.installFirst'), codex ? {
    type: 'terminal',
    label: t('setup.action.login'),
    script: 'codex login',
  } : null, true);
  const claude = installed('claude');
  add(t('setup.group.ai'), 'claude-code', 'Claude Code', !!claude, claude ? version('claude') : t('setup.claude.detail'), npmInstall('@anthropic-ai/claude-code'), true);
  const claudeAuth = fileHas(path.join(HOME, '.claude.json'), /oauthAccount|primaryApiKey/) || !!process.env.ANTHROPIC_API_KEY;
  add(t('setup.group.ai'), 'claude-auth', t('setup.claudeAuth.title'), claudeAuth, claudeAuth ? t('setup.loggedIn') : claude ? t('setup.claudeAuth.detail') : t('setup.claudeAuth.installFirst'), claude ? {
    type: 'terminal',
    label: t('setup.action.login'),
    script: `echo "${t('setup.claudeAuth.script')}"; claude`,
  } : null, true);

  const required = items.filter((i) => !i.optional);
  return {
    items,
    ready: required.every((i) => i.ok),
    missingRequired: required.filter((i) => !i.ok).length,
    missingOptional: items.filter((i) => i.optional && !i.ok).length,
  };
}

/** `setupStatus()` plus the cloud rows (network, ≤ 5 s when the project is unreachable) — what the Setup screen shows. */
export async function setupStatusFull() {
  const st = await setupStatus();
  const admin = readJSON(path.join(APP_DIR, 'profile.json'), null)?.role === 'admin';
  if (!admin && !exists(path.join(APP_DIR, 'cloud.json')) && !process.env.BID_SUPABASE_URL) return st;
  const cloud = cloudSetupItems(await cloudDoctor()).map(i => ({ ...i, optional: true, required: false }));
  const items = [...cloud, ...st.items];
  const required = items.filter((i) => !i.optional);
  return {
    items,
    ready: required.every((i) => i.ok),
    missingRequired: required.filter((i) => !i.ok).length,
    missingOptional: items.filter((i) => i.optional && !i.ok).length,
    cloudReady: cloud.filter((i) => ['cloud-config', 'cloud-schema', 'cloud-functions'].includes(i.id)).every((i) => i.ok),
  };
}

function setupDir() {
  return ensureDir(path.join(CACHE_DIR, 'setup'));
}

function writeCommand(name, body) {
  const file = path.join(setupDir(), `${name}.command`);
  const envFile = path.join(ENGINE_DIR, 'env.zsh');
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`; // a home folder with ' in its name must not break the script
  fs.writeFileSync(
    file,
    `#!/bin/zsh\n# Before I Deploy — ${t('setup.command.title')}\n[ -f ${q(envFile)} ] && source ${q(envFile)}\nclear\n${body}\necho\necho ${q(t('setup.command.done'))}\n`
  );
  fs.chmodSync(file, 0o755);
  return file;
}

export async function setupTerminal(id) {
  const st = await setupStatus();
  const todo = id === 'all' ? st.items.filter((i) => !i.ok && i.action?.type === 'terminal' && !i.optional) : st.items.filter((i) => i.id === id);
  if (!todo.length) throw new EngineError(msg('setup.terminal.nothing'), 'nothing');
  const body = todo
    .filter((i) => i.action?.type === 'terminal')
    .map((i) => `echo "━━━ ${i.title} ━━━"\n${i.action.script}\necho`)
    .join('\n');
  if (!body) throw new EngineError(msg('setup.terminal.notTerminal'), 'usage', 2);
  return { commandFile: writeCommand(id, body) };
}

const DEPENDENCIES = { 'netlify-login': ['netlify-cli'], 'gh-auth': ['gh'], 'git-identity': ['git', 'gh-auth'], 'vercel-auth': ['vercel'], 'wrangler-auth': ['wrangler'] };

export async function setupRun(id, { yes = false } = {}) {
  if (!yes) throw new EngineError(msg('setup.run.confirmRequired'), 'confirm_required', 2);
  const unlock = setupLock();
  try { return await runItem(id); } finally { unlock(); }
}

async function runItem(id, known) {
  const item = known || (await setupStatus()).items.find(i => i.id === id);
  if (!item) throw new EngineError(msg('setup.unknownStep', { id }), 'usage', 2);
  if (item.ok) { ev.step(id, { label: item.title, status: 'skipped' }); return { id, ok: true, skipped: true }; }
  if (item.action?.type !== 'run') throw new EngineError(msg('setup.notRunnable'), 'not_runnable');
  const log = path.join(setupDir(), `${id}.log`);
  const started = Date.now();
  ev.step(id, { label: item.title, status: 'running', summary: item.action.display, log });
  const heartbeat = setInterval(() => ev.step(id, { elapsed: Math.floor((Date.now() - started) / 1000) }), 5000);
  try {
    if (TOOL_PACKAGES[id]) await installManaged(id, { logFile: log });
    else if (id === 'gh') await installGitHub({ logFile: log });
    else if (id === 'git') await installCLT(id, log);
    else if (id === 'gh-auth') await ghDeviceLogin();
    else if (id === 'git-identity') await gitIdentityFromGitHub();
    else if (id === 'netlify-login') await netlifyLogin({ stepId: id, manageSteps: false });
    else {
      const r = await runStream(item.action.cmd, item.action.args, { step: id, cwd: HOME, logFile: log, timeout: 360000 });
      if (r.code !== 0) throw new EngineError(msg('setup.installFailed', { title: item.title }), 'install_failed');
      if (!(await setupStatus()).items.find(i => i.id === id)?.ok) throw new EngineError(msg('setup.toolFailed'), 'install_failed');
    }
    ev.step(id, { label: item.title, status: 'pass', summary: t('setup.installed'), log });
    return { id, ok: true };
  } catch (e) {
    ev.step(id, { label: item.title, status: 'fail', summary: e.message, log });
    throw e;
  } finally { clearInterval(heartbeat); }
}

/** Each announced step reaches a terminal state; readiness is independent of process exit success. */
export async function setupAuto({ yes = false, includeOptional = false, preflight = setupPreflight } = {}) {
  if (!yes) throw new EngineError(msg('setup.auto.confirmRequired'), 'confirm_required', 2);
  const unlock = setupLock();
  try {
    const st = await setupStatus();
    const ORDER = ['git', 'netlify-cli', 'gh', 'vercel', 'wrangler', 'codex', 'claude-code', 'gh-auth', 'git-identity', 'netlify-login'];
    const rank = id => ORDER.includes(id) ? ORDER.indexOf(id) : 50;
    const todo = st.items.filter(i => !i.ok && (includeOptional || !i.optional)).sort((a,b) => rank(a.id)-rank(b.id));
    const steps = [], installed = [], failed = [], blocked = [];
    for (const i of todo) ev.step(i.id, { label: i.title, status: 'pending', summary: i.action?.display });
    if (todo.some(i => i.action?.type === 'run')) {
      ev.step('preflight', { label: t('setup.preflight'), status: 'running' });
      try {
        await preflight();
        ev.step('preflight', { status: 'pass' });
      } catch (e) {
        ev.step('preflight', { status: 'fail', summary: e.message });
        for (const i of todo) {
          steps.push({ id: i.id, status: 'skipped', reason: e.code });
          ev.step(i.id, { status: 'skipped', reason: e.code, summary: e.message });
        }
        return { ok: false, code: e.code, error: e.message, steps, installed, failed, blocked, interactive: todo, commandFile: null, status: st };
      }
    }
    const ready = new Set(st.items.filter(i => i.ok).map(i => i.id));
    for (const i of todo) {
      const missing = (DEPENDENCIES[i.id] || []).filter(id => !ready.has(id));
      if (missing.length || i.action?.type !== 'run') {
        const reason = missing.length ? missing.join(', ') : 'user_action';
        steps.push({ id: i.id, status: 'blocked', reason }); blocked.push(i.id);
        ev.step(i.id, { status: 'blocked', reason, summary: t('setup.requires', { items: reason }) });
        continue;
      }
      try {
        await runItem(i.id, i); installed.push(i.id); ready.add(i.id); steps.push({ id: i.id, status: 'pass' });
      } catch (e) { failed.push(i.id); steps.push({ id: i.id, status: 'fail', reason: e.code }); }
    }
    const after = await setupStatus();
    const interactive = after.items.filter(i => !i.ok && (includeOptional || !i.optional));
    const complete = after.ready && failed.length === 0 && blocked.length === 0;
    const incomplete = new EngineError(msg('setup.incomplete'), 'setup_incomplete');
    return { ok: complete, ...(complete ? {} : { code: incomplete.code, error: incomplete.message }), steps, installed, failed, blocked, interactive, commandFile: null, status: after };
  } finally { unlock(); }
}

// ---------------------------------------------------------------- GitHub device login (browser, no typing)

export async function ghDeviceLogin() {
  if (!which('gh')) throw new EngineError(msg('setup.gh.installFirst'), 'missing_cli');
  let announced = false, received = '';
  const r = await runStream('gh', ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https'], {
    step: 'gh-auth', logFile: path.join(setupDir(), 'gh-auth.log'), input: true, timeout: 300000,
    env: { ...cliEnv(), GH_PROMPT_DISABLED: '1', NO_COLOR: '1', BROWSER: 'echo' },
    onChunk(text, stdin) {
      received = (received + text).slice(-8192);
      const code = received.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i);
      if (code && !announced) {
        announced = true;
        emit({ type: 'devicecode', service: 'GitHub', code: code[1], url: 'https://github.com/login/device', expiresIn: 300 });
        ev.step('gh-auth', { label: t('setup.gh.label'), status: 'waiting_user', summary: t('setup.gh.code', { code: code[1] }) });
      }
      if (/Press Enter/i.test(received)) { stdin?.write('\n'); received = ''; }
    },
  });
  const ok = r.code === 0 && sh('gh', ['auth', 'token'], { timeout: 4000 }).code === 0;
  if (!ok) {
    throw new EngineError(msg('setup.gh.failed'), 'login_failed');
  }
  sh('gh', ['auth', 'setup-git'], { timeout: 15000 });
  return { id: 'gh-auth', ok: true };
}

export async function gitIdentityFromGitHub() {
  if (!gitAvailable() || !which('gh') || sh('gh', ['auth', 'token'], { timeout: 4000 }).code !== 0) {
    throw new EngineError(msg('setup.identity.needsLogin'), 'not_logged_in');
  }
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
  return { id: 'git-identity', ok: true, name, email };
}

async function installCLT(id, logFile) {
  if (process.platform !== 'darwin') throw new EngineError(msg('setup.notRunnable'), 'not_runnable');
  const launched = await runStream('/usr/bin/xcode-select', ['--install'], { step: id, logFile, timeout: 10000 });
  if (launched.code !== 0 && !gitAvailable()) throw new EngineError(msg('setup.toolFailed'), 'install_failed');
  ev.step(id, { status: 'waiting_user', summary: t('setup.cltWaiting') });
  const until = Date.now() + 30 * 60 * 1000;
  while (Date.now() < until) {
    if (gitAvailable()) return;
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new EngineError(msg('setup.cltWaiting'), 'setup_incomplete');
}

export function setupIdentity({ name, email, yes = false } = {}) {
  if (!yes) throw new EngineError(msg('setup.run.confirmRequired'), 'confirm_required', 2);
  if (!gitAvailable()) throw new EngineError(msg('setup.git.detail'), 'missing_cli');
  if (typeof name !== 'string' || typeof email !== 'string' || !name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n\0]/.test(name + email)) throw new EngineError(msg('setup.identity.invalid'), 'usage', 2);
  const unlock = setupLock();
  try {
    for (const [key, value] of [['user.name', name.trim()], ['user.email', email.trim()]]) {
      if (sh('git', ['config', '--global', key, value], { timeout: 5000 }).code !== 0) throw new EngineError(msg('setup.identity.failed'), 'github_failed');
    }
    return { ok: true };
  } finally { unlock(); }
}
