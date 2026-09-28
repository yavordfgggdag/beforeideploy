// Netlify: auth, teams, sites, link/create (NO `netlify init` — never enables CI), manual deploys
import path from 'node:path';
import { HOME, EngineError, ev, which, runStream, logDir, readJSON, extractJSON, nowISO } from './util.mjs';
import { detect } from './detect.mjs';
import { fingerprint } from './checks.mjs';
import { getState, setState, updateProject, addHistory } from './store.mjs';
import { recordCost } from './costs.mjs';
import { gitHead } from './git.mjs';
import { t, msg } from './i18n.mjs';

const CHECK_MAX_AGE_MIN = 30;

export function netlifyCommand() {
  if (which('netlify')) return { cmd: 'netlify', pre: [], label: 'netlify' };
  if (which('npx')) return { cmd: 'npx', pre: ['--yes', 'netlify-cli'], label: 'npx netlify-cli' };
  return null;
}

function requireCli() {
  const c = netlifyCommand();
  if (!c) throw new EngineError(msg('netlify.noCli'), 'no_cli');
  return c;
}

async function nl(project, args, opts = {}) {
  const c = requireCli();
  const logFile = opts.logFile || path.join(logDir(project?.key || 'global'), 'netlify.log');
  return runStream(c.cmd, [...c.pre, ...args], {
    cwd: project?.path || HOME,
    step: opts.step || 'netlify',
    logFile,
    captureStdout: opts.captureStdout,
    timeout: opts.timeout ?? 10 * 60 * 1000,
    quiet: opts.quiet,
  });
}

// ---------------------------------------------------------------- auth

export function netlifyAuth() {
  const cli = netlifyCommand();
  if (process.env.NETLIFY_AUTH_TOKEN) return { loggedIn: true, email: null, cli: cli?.label || null, via: 'env' };
  const candidates = [
    path.join(HOME, 'Library', 'Preferences', 'netlify', 'config.json'),
    path.join(HOME, '.config', 'netlify', 'config.json'),
    path.join(HOME, '.netlify', 'config.json'),
  ];
  for (const f of candidates) {
    const cfg = readJSON(f, null);
    if (!cfg?.users) continue;
    const user = cfg.users[cfg.userId] || Object.values(cfg.users).find((u) => u?.auth?.token);
    if (user?.auth?.token) return { loggedIn: true, email: user.email || null, name: user.name || null, cli: cli?.label || null };
  }
  return { loggedIn: false, email: null, cli: cli?.label || null };
}

export async function netlifyLogin() {
  ev.step('login', { label: t('netlify.login.label'), status: 'running', summary: t('netlify.login.opening') });
  const r = await nl(null, ['login'], { step: 'login', timeout: 5 * 60 * 1000 });
  const auth = netlifyAuth();
  if (!auth.loggedIn) {
    ev.step('login', { label: t('netlify.login.label'), status: 'fail', summary: t('netlify.login.notConfirmed') });
    throw new EngineError(msg('netlify.login.failed'), 'login_failed');
  }
  ev.step('login', { label: t('netlify.login.label'), status: 'pass', summary: auth.email || t('netlify.login.loggedIn') });
  return { ...auth, code: r.code };
}

function requireAuth() {
  const a = netlifyAuth();
  if (!a.loggedIn) throw new EngineError(msg('netlify.notLoggedIn'), 'not_logged_in', 5);
  return a;
}

// ---------------------------------------------------------------- teams & sites

export async function netlifyTeams() {
  requireAuth();
  const r = await nl(null, ['api', 'listAccountsForUser'], { captureStdout: true, quiet: true, timeout: 120000 });
  const data = extractJSON(r.stdout);
  if (!Array.isArray(data)) throw new EngineError(msg('netlify.teamsFailed'), 'netlify_failed');
  return data.map((team) => ({ slug: team.slug, name: team.name || team.slug })).filter((team) => team.slug);
}

export async function netlifySites() {
  requireAuth();
  const r = await nl(null, ['sites:list', '--json'], { captureStdout: true, quiet: true, timeout: 120000 });
  const data = extractJSON(r.stdout);
  if (!Array.isArray(data)) throw new EngineError(msg('netlify.sitesFailed'), 'netlify_failed');
  return data
    .map((s) => ({ id: s.id || s.site_id, name: s.name, url: s.ssl_url || s.url || null, adminUrl: s.admin_url || null }))
    .filter((s) => s.id && s.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function netlifyInfo(project) {
  const d = detect(project.path);
  if (!d.netlifyLinked) return { linked: false };
  requireAuth();
  const r = await nl(project, ['api', 'getSite', '--data', JSON.stringify({ site_id: d.siteId })], {
    captureStdout: true,
    quiet: true,
    timeout: 120000,
  });
  const s = extractJSON(r.stdout);
  if (!s || !s.id) throw new EngineError(msg('netlify.siteFailed'), 'netlify_failed');
  const info = {
    linked: true,
    siteId: s.id,
    siteName: s.name,
    liveUrl: s.ssl_url || s.url || null,
    adminUrl: s.admin_url || null,
    lastPublishedAt: s.published_deploy?.published_at || s.published_deploy?.created_at || null,
    repoLinked: !!s.build_settings?.repo_url,
  };
  updateProject(project.key, { netlify: info });
  return info;
}

export async function netlifyLink(project, { id, name }) {
  requireAuth();
  const args = ['link'];
  if (id && id !== true) args.push('--id', id);
  else if (name && name !== true) args.push('--name', name);
  else throw new EngineError(msg('netlify.link.missingArgs'), 'usage', 2);
  ev.step('link', { label: t('netlify.link.label'), status: 'running' });
  const r = await nl(project, args, { step: 'link', timeout: 180000 });
  const d = detect(project.path);
  if (r.code !== 0 || !d.netlifyLinked) {
    ev.step('link', { label: t('netlify.link.label'), status: 'fail', summary: r.tail.slice(-1)[0] || t('netlify.failedShort') });
    throw new EngineError(msg('netlify.link.failed'), 'netlify_failed');
  }
  ev.step('link', { label: t('netlify.link.label'), status: 'pass', summary: `Site ID ${d.siteId}` });
  let info = { linked: true, siteId: d.siteId };
  try {
    info = await netlifyInfo(project);
  } catch {}
  addHistory({ project: project.key, projectName: project.name, kind: 'netlify-link', status: 'ok', url: info.liveUrl || null });
  return info;
}

export async function netlifyCreate(project, { name, team }) {
  requireAuth();
  if (!name || name === true) throw new EngineError(msg('netlify.create.missingName'), 'usage', 2);
  const slug = String(name).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const args = ['sites:create', '--name', slug];
  if (team && team !== true) args.push('--account-slug', team);
  ev.step('create', { label: t('netlify.create.creating', { site: `${slug}.netlify.app` }), status: 'running' });
  const r = await nl(project, args, { step: 'create', timeout: 180000 });
  if (r.code !== 0) {
    ev.step('create', { label: t('netlify.create.label'), status: 'fail', summary: r.tail.slice(-1)[0] || t('netlify.failedShort'), details: r.tail.slice(-8) });
    throw new EngineError(msg('netlify.create.failed'), 'netlify_failed');
  }
  ev.step('create', { label: t('netlify.create.label'), status: 'pass', summary: `${slug}.netlify.app` });
  let d = detect(project.path);
  if (!d.netlifyLinked) {
    const sites = await netlifySites();
    const site = sites.find((s) => s.name === slug);
    if (!site) throw new EngineError(msg('netlify.create.notFound'), 'netlify_failed');
    return netlifyLink(project, { id: site.id });
  }
  let info = { linked: true, siteId: d.siteId, siteName: slug };
  try {
    info = await netlifyInfo(project);
  } catch {}
  addHistory({ project: project.key, projectName: project.name, kind: 'netlify-create', status: 'ok', url: info.liveUrl || null });
  return info;
}

// ---------------------------------------------------------------- deploy

export function deployGuard(project) {
  const check = getState(project.key).check;
  if (!check) throw new EngineError(msg('deploy.needsCheck'), 'needs_check', 3);
  const age = (Date.now() - Date.parse(check.at)) / 60000;
  // an unreadable date counts as stale, never as fresh
  if (!Number.isFinite(age) || age > CHECK_MAX_AGE_MIN) throw new EngineError(msg('deploy.staleCheck', { minutes: Number.isFinite(age) ? Math.round(age) : '?' }), 'stale_check', 3);
  if (check.status === 'blocked') throw new EngineError(msg('deploy.blocked'), 'blocked', 3);
  // the code must still be the code that was checked (audit E7)
  if (check.fingerprint && fingerprint(project.path, detect(project.path)) !== check.fingerprint) {
    throw new EngineError(msg('deploy.changedSinceCheck'), 'stale_check', 3);
  }
  return check;
}

export async function netlifyDeploy(project, { prod = false, confirm = null } = {}) {
  if (prod && confirm !== 'DEPLOY') {
    throw new EngineError(msg('deploy.confirmRequired'), 'confirm_required', 2);
  }
  deployGuard(project);
  requireAuth();
  const d = detect(project.path);
  if (!d.netlifyLinked) throw new EngineError(msg('netlify.notLinked'), 'not_linked', 4);

  const label = t(prod ? 'deploy.label.production' : 'deploy.label.draft');
  const stepId = 'deploy';
  const message = `Before I Deploy — ${new Date().toLocaleString('bg-BG')}`;
  const args = ['deploy', '--json', '--message', message];
  const useStatic = !d.ssr && !d.hasFunctions && d.publishReady;
  if (useStatic) args.push('--no-build', '--dir', d.publishDir);
  if (prod) args.push('--prod');

  ev.step(stepId, {
    label,
    category: 'Hosting',
    status: 'running',
    summary: useStatic ? t('netlify.deploy.uploading', { dir: d.publishDir }) : 'Netlify build + upload',
  });

  const logFile = path.join(logDir(project.key), prod ? 'deploy-prod.log' : 'deploy-draft.log');
  const t0 = Date.now();
  const r = await nl(project, args, { step: stepId, logFile, captureStdout: true, timeout: 20 * 60 * 1000 });
  const duration = (Date.now() - t0) / 1000;
  const json = extractJSON(r.stdout);

  if (r.code !== 0 || !json) {
    ev.step(stepId, { label, category: 'Hosting', status: 'fail', summary: t('deploy.failed'), details: r.tail.slice(-15), log: logFile, duration });
    addHistory({ project: project.key, projectName: project.name, kind: prod ? 'production' : 'draft', status: 'fail', duration, log: logFile });
    ev.notify(`❌ ${project.name}`, t('deploy.notify.failed', { label }), null);
    throw new EngineError(msg('deploy.failedSeeLog', { label }), 'deploy_failed');
  }

  const url = prod ? json.url || json.deploy_url : json.deploy_url || json.url;
  const record = { url, at: nowISO(), deployId: json.deploy_id || null, logs: json.logs || null, sha: gitHead(project.path) };
  if (prod) {
    setState(project.key, { lastProd: record });
    updateProject(project.key, { netlify: { liveUrl: json.url || url, siteName: json.site_name || undefined } });
  } else {
    setState(project.key, { lastDraft: record });
  }
  addHistory({ project: project.key, projectName: project.name, kind: prod ? 'production' : 'draft', status: 'ok', url, duration, log: logFile });
  const cost = recordCost({ project: project.key, projectName: project.name, service: 'netlify', op: prod ? 'production' : 'draft', ref: record.deployId });
  ev.step(stepId, { label, category: 'Hosting', status: 'pass', summary: url, duration, log: logFile });
  ev.notify(prod ? t('deploy.notify.live', { project: project.name }) : t('deploy.notify.previewReady', { project: project.name }), url, url);
  return { prod, url, deployId: record.deployId, adminLogs: record.logs, duration, cost };
}
