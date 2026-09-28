// Hosting adapters — Netlify, Vercel, Cloudflare Pages, GitHub Pages behind one interface.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, CACHE_DIR, EngineError, ev, sh, which, runStream, logDir, readJSON, exists, nowISO } from './util.mjs';
import { detect } from './detect.mjs';
import { getState, setState, updateProject, addHistory, findProject } from './store.mjs';
import { netlifyAuth, netlifyDeploy, deployGuard } from './netlify.mjs';
import { recordCost } from './costs.mjs';
import { gitHead } from './git.mjs';
import { t, msg } from './i18n.mjs';

function fileHas(file, re) {
  try {
    return re.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

export const PROVIDERS = {
  netlify: {
    id: 'netlify',
    name: 'Netlify',
    cli: 'netlify',
    npm: 'netlify-cli',
    ssr: true,
    preview: true,
    commercialFree: true,
    free: t('hosting.netlify.free'),
    note: t('hosting.netlify.note'),
    pricing: 'https://www.netlify.com/pricing/',
  },
  vercel: {
    id: 'vercel',
    name: 'Vercel',
    cli: 'vercel',
    npm: 'vercel',
    ssr: true,
    preview: true,
    commercialFree: false,
    free: t('hosting.vercel.free'),
    note: t('hosting.vercel.note'),
    pricing: 'https://vercel.com/pricing',
  },
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare Pages',
    cli: 'wrangler',
    npm: 'wrangler',
    ssr: false,
    preview: true,
    commercialFree: true,
    free: t('hosting.cloudflare.free'),
    note: t('hosting.cloudflare.note'),
    pricing: 'https://www.cloudflare.com/plans/developer-platform/',
  },
  ghpages: {
    id: 'ghpages',
    name: 'GitHub Pages',
    cli: 'gh',
    npm: null,
    ssr: false,
    preview: false,
    commercialFree: true,
    free: t('hosting.ghpages.free'),
    note: t('hosting.ghpages.note'),
    pricing: 'https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits',
  },
};

// ---------------------------------------------------------------- auth / install

function vercelAuthed() {
  if (process.env.VERCEL_TOKEN) return true;
  return [
    path.join(HOME, 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'),
    path.join(HOME, '.local', 'share', 'com.vercel.cli', 'auth.json'),
  ].some((f) => fileHas(f, /"token"\s*:\s*"[^"]+"/));
}

function wranglerAuthed() {
  if (process.env.CLOUDFLARE_API_TOKEN) return true;
  return [
    path.join(HOME, 'Library', 'Preferences', '.wrangler', 'config', 'default.toml'),
    path.join(HOME, '.wrangler', 'config', 'default.toml'),
    path.join(HOME, '.config', '.wrangler', 'config', 'default.toml'),
  ].some((f) => fileHas(f, /oauth_token|api_token/));
}

function ghAuthed() {
  return !!which('gh') && sh('gh', ['auth', 'status'], { timeout: 12000 }).code === 0;
}

export function providerStatus(id) {
  const p = PROVIDERS[id];
  const installed = id === 'netlify' ? !!(which('netlify') || which('npx')) : !!which(p.cli);
  const loggedIn =
    id === 'netlify' ? netlifyAuth().loggedIn : id === 'vercel' ? vercelAuthed() : id === 'cloudflare' ? wranglerAuthed() : ghAuthed();
  return { ...p, installed, loggedIn };
}

export function hostingStatus() {
  return Object.keys(PROVIDERS).map(providerStatus);
}

/** Link state of a project with a provider. */
export function projectLink(project, id) {
  const d = detect(project.path);
  switch (id) {
    case 'netlify':
      return { linked: d.netlifyLinked, detail: d.siteId || null };
    case 'vercel': {
      const j = readJSON(path.join(project.path, '.vercel', 'project.json'), null);
      return { linked: !!j?.projectId, detail: j?.projectId || null };
    }
    case 'cloudflare':
      return { linked: !!project.cloudflare?.projectName, detail: project.cloudflare?.projectName || null };
    case 'ghpages':
      return { linked: !!d.git.remote && /github\.com/.test(d.git.remote), detail: d.git.githubUrl || null };
    default:
      return { linked: false };
  }
}

// ---------------------------------------------------------------- advisor

export function advise(project) {
  const d = detect(project.path);
  const current = project.hosting || 'netlify';
  const needsServer = d.ssr || d.hasFunctions;
  const list = Object.values(PROVIDERS).map((p) => {
    const st = providerStatus(p.id);
    const reasons = [];
    let compatible = true;
    if (needsServer && !p.ssr) {
      compatible = false;
      reasons.push(d.ssr ? t('hosting.reason.ssr', { framework: d.framework }) : t('hosting.reason.functions'));
    }
    if (p.id === 'ghpages' && !d.git.remote) reasons.push(t('hosting.reason.needsRepo'));
    if (p.id === 'ghpages' && ['astro', 'vite'].includes(d.framework))
      reasons.push(t('hosting.reason.basePath'));
    if (!p.commercialFree) reasons.push(p.note);
    let score = compatible ? 50 : 0;
    if (compatible && p.commercialFree) score += 20;
    if (compatible && st.loggedIn) score += 15;
    if (compatible && p.preview) score += 10;
    if (p.id === current) score += 5;
    return {
      id: p.id,
      name: p.name,
      compatible,
      current: p.id === current,
      installed: st.installed,
      loggedIn: st.loggedIn,
      linked: projectLink(project, p.id).linked,
      free: p.free,
      note: p.note,
      pricing: p.pricing,
      preview: p.preview,
      reasons,
      score,
    };
  });
  list.sort((a, b) => b.score - a.score);
  const best = list.find((x) => x.compatible);
  if (best) best.recommended = true;
  return { project: project.key, framework: d.framework, ssr: !!d.ssr, functions: !!d.hasFunctions, current, providers: list };
}

export function setHosting(project, provider) {
  if (!PROVIDERS[provider]) throw new EngineError(msg('hosting.unknown', { provider }), 'usage', 2);
  updateProject(project.key, { hosting: provider });
  addHistory({ project: project.key, projectName: project.name, kind: 'hosting', status: 'ok', message: t('hosting.history.set', { name: PROVIDERS[provider].name }) });
  return { hosting: provider };
}

// ---------------------------------------------------------------- deploy

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'site';

function finishDeploy(project, provider, { prod, url, duration, logFile }) {
  const record = { url, at: nowISO(), provider, sha: gitHead(project.path) };
  setState(project.key, prod ? { lastProd: record } : { lastDraft: record });
  if (prod) updateProject(project.key, { liveUrl: url });
  addHistory({ project: project.key, projectName: project.name, kind: prod ? 'production' : 'draft', status: 'ok', url, duration, log: logFile, message: PROVIDERS[provider].name });
  const cost = recordCost({ project: project.key, projectName: project.name, service: provider, op: prod ? 'production' : 'draft' });
  ev.step('deploy', { label: t(prod ? 'deploy.label.production' : 'deploy.label.draft'), category: 'Hosting', status: 'pass', summary: url, duration, log: logFile });
  ev.notify(prod ? t('deploy.notify.live', { project: project.name }) : t('hosting.notify.preview', { project: project.name }), `${PROVIDERS[provider].name}: ${url}`, url);
  return { prod, url, provider, duration, cost };
}

function failDeploy(project, provider, { prod, r, logFile, duration, reason }) {
  ev.step('deploy', { label: t(prod ? 'deploy.label.production' : 'deploy.label.draft'), category: 'Hosting', status: 'fail', summary: reason || t('deploy.failed'), details: r?.tail?.slice(-15) || [], log: logFile, duration });
  addHistory({ project: project.key, projectName: project.name, kind: prod ? 'production' : 'draft', status: 'fail', log: logFile, message: PROVIDERS[provider].name });
  throw new EngineError(msg('hosting.deployFailed', { provider: PROVIDERS[provider].name, reason: reason || t('hosting.deployFailedReason') }), 'deploy_failed');
}

async function vercelDeploy(project, { prod }) {
  const logFile = path.join(logDir(project.key), `vercel-${prod ? 'prod' : 'draft'}.log`);
  const args = ['deploy', '--yes'];
  if (prod) args.push('--prod');
  ev.step('deploy', { label: t(prod ? 'deploy.label.production' : 'deploy.label.draft'), category: 'Hosting', status: 'running', summary: 'Vercel build + upload' });
  const t0 = Date.now();
  const r = await runStream('vercel', args, { cwd: project.path, step: 'deploy', logFile, captureStdout: true, timeout: 20 * 60 * 1000 });
  const duration = (Date.now() - t0) / 1000;
  const url = (r.stdout.match(/https:\/\/[^\s]+\.vercel\.app/g) || []).pop();
  if (r.code !== 0 || !url) return failDeploy(project, 'vercel', { prod, r, logFile, duration });
  return finishDeploy(project, 'vercel', { prod, url, duration, logFile });
}

async function cloudflareDeploy(project, { prod }) {
  const d = detect(project.path);
  if (d.ssr || d.hasFunctions) throw new EngineError(msg('hosting.cloudflare.staticOnly'), 'unsupported');
  if (!d.publishReady) throw new EngineError(msg('hosting.noBuild', { dir: d.publishDir }), 'no_build');
  const logFile = path.join(logDir(project.key), `cloudflare-${prod ? 'prod' : 'draft'}.log`);
  let name = project.cloudflare?.projectName;
  ev.step('deploy', { label: t(prod ? 'deploy.label.production' : 'deploy.label.draft'), category: 'Hosting', status: 'running', summary: 'Cloudflare Pages upload' });
  if (!name) {
    name = slugify(project.name === 'ПОРТФОЛИО' ? 'portfolio' : project.name);
    const c = await runStream('wrangler', ['pages', 'project', 'create', name, '--production-branch=main'], { cwd: project.path, step: 'deploy', logFile, timeout: 120000 });
    if (c.code !== 0 && !c.tail.join('\n').match(/already exists/i)) return failDeploy(project, 'cloudflare', { prod, r: c, logFile, reason: t('hosting.cloudflare.createFailed') });
    updateProject(project.key, { cloudflare: { projectName: name } });
  }
  const t0 = Date.now();
  const r = await runStream(
    'wrangler',
    ['pages', 'deploy', stagePublicCopy(project.path, d.publishDir), `--project-name=${name}`, `--branch=${prod ? 'main' : 'preview'}`, '--commit-dirty=true'],
    { cwd: project.path, step: 'deploy', logFile, captureStdout: true, timeout: 20 * 60 * 1000 }
  );
  const duration = (Date.now() - t0) / 1000;
  const all = `${r.stdout}\n${r.tail.join('\n')}`;
  const url = (all.match(/https:\/\/[^\s]+\.pages\.dev/g) || []).pop();
  if (r.code !== 0 || !url) return failDeploy(project, 'cloudflare', { prod, r, logFile, duration });
  return finishDeploy(project, 'cloudflare', { prod, url: prod ? `https://${name}.pages.dev` : url, duration, logFile });
}

/**
 * What may be published from a project folder. A build folder (dist/, out/ …) is published as it is; when the
 * site lives in the project root, a copy without dotfiles, node_modules and tooling goes out instead —
 * otherwise `.env`, `.git` or keys next to index.html would end up on a public host.
 */
export function stagePublicCopy(projectDir, publishDir) {
  if (publishDir && publishDir !== '.' && publishDir !== './') return publishDir;
  const out = path.join(CACHE_DIR, 'publish', path.basename(projectDir).replace(/[^\w.-]/g, '_'));
  fs.rmSync(out, { recursive: true, force: true });
  const skip = new Set(['node_modules', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bid.config.json']);
  const copy = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if ((e.name.startsWith('.') && e.name !== '.well-known') || skip.has(e.name)) continue;
      const a = path.join(from, e.name);
      const b = path.join(to, e.name);
      if (e.isDirectory()) copy(a, b);
      else if (e.isFile()) fs.copyFileSync(a, b);
    }
  };
  copy(projectDir, out);
  return out;
}

async function ghPagesDeploy(project, { prod }) {
  if (!prod) throw new EngineError(msg('hosting.ghpages.noPreview'), 'unsupported');
  const d = detect(project.path);
  if (d.ssr || d.hasFunctions) throw new EngineError(msg('hosting.ghpages.staticOnly'), 'unsupported');
  if (!d.publishReady) throw new EngineError(msg('hosting.noBuild', { dir: d.publishDir }), 'no_build');
  const m = (d.git.githubUrl || '').match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) throw new EngineError(msg('hosting.ghpages.needsRepo'), 'no_remote');
  const [, owner, repo] = m;
  const logFile = path.join(logDir(project.key), 'ghpages.log');
  ev.step('deploy', { label: t('deploy.label.production'), category: 'Hosting', status: 'running', summary: `gh-pages ← ${d.publishDir}/` });
  const t0 = Date.now();
  // no -t (dotfiles); --nojekyll adds the marker on the gh-pages branch instead of in the user's folder
  const publish = stagePublicCopy(project.path, d.publishDir);
  const r = await runStream('npx', ['--yes', 'gh-pages', '-d', publish, '--nojekyll', '-m', `Before I Deploy — ${new Date().toISOString()}`], {
    cwd: project.path,
    step: 'deploy',
    logFile,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 10 * 60 * 1000,
  });
  const duration = (Date.now() - t0) / 1000;
  if (r.code !== 0) return failDeploy(project, 'ghpages', { prod, r, logFile, duration });
  sh('gh', ['api', '-X', 'POST', `repos/${owner}/${repo}/pages`, '-f', 'source[branch]=gh-pages', '-f', 'source[path]=/'], { timeout: 20000 });
  const url = project.domain ? `https://${project.domain}` : `https://${owner.toLowerCase()}.github.io/${repo}/`;
  return finishDeploy(project, 'ghpages', { prod, url, duration, logFile });
}

/** Deploys with the project's selected hosting provider. */
export async function deployProject(project, { prod = false, confirm = null } = {}) {
  const provider = (findProject(project.key) || project).hosting || 'netlify';
  if (provider === 'netlify') return netlifyDeploy(project, { prod, confirm });
  if (prod && confirm !== 'DEPLOY') throw new EngineError(msg('deploy.confirmRequired'), 'confirm_required', 2);
  deployGuard(project);
  const st = providerStatus(provider);
  if (!st.installed) throw new EngineError(msg('hosting.cliMissing', { name: st.name }), 'no_cli');
  if (!st.loggedIn) throw new EngineError(msg('hosting.notLoggedIn', { name: st.name }), 'not_logged_in', 5);
  const p = findProject(project.key) || project;
  if (provider === 'vercel') return vercelDeploy(p, { prod });
  if (provider === 'cloudflare') return cloudflareDeploy(p, { prod });
  if (provider === 'ghpages') return ghPagesDeploy(p, { prod });
  throw new EngineError(msg('hosting.unknown', { provider }), 'usage', 2);
}

export function hostingReady(project) {
  const provider = (findProject(project.key) || project).hosting || 'netlify';
  if (provider === 'netlify') return detect(project.path).netlifyLinked;
  const st = providerStatus(provider);
  return st.installed && st.loggedIn;
}

