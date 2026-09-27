// Hosting adapters — Netlify, Vercel, Cloudflare Pages, GitHub Pages behind one interface.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, EngineError, ev, sh, which, runStream, logDir, readJSON, exists, nowISO } from './util.mjs';
import { detect } from './detect.mjs';
import { getState, setState, updateProject, addHistory, findProject } from './store.mjs';
import { netlifyAuth, netlifyDeploy, deployGuard } from './netlify.mjs';
import { recordCost } from './costs.mjs';

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
    free: 'Безплатен план (кредитна система)',
    note: 'Production deploy харчи кредити — виж „Разходи“.',
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
    free: 'Hobby — безплатен, но само за лични/некомерсиални проекти',
    note: 'За сайтове на клиенти е нужен платен Pro план.',
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
    free: 'Безплатен план за статични сайтове',
    note: 'Отличен за статични сайтове с много трафик.',
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
    free: 'Безплатен за публични repo-та (частни изискват платен GitHub)',
    note: 'Без preview и без сървърни функции; не е за онлайн магазини.',
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
      reasons.push(d.ssr ? `${d.framework} със сървърно рендиране не върви тук` : 'Проектът има сървърни функции');
    }
    if (p.id === 'ghpages' && !d.git.remote) reasons.push('Нужно е GitHub repo');
    if (p.id === 'ghpages' && ['astro', 'vite'].includes(d.framework))
      reasons.push('Без собствен домейн сайтът е под /repo-име/ — трябва настройка на base');
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
  if (!PROVIDERS[provider]) throw new EngineError(`Непознат хостинг: ${provider}`, 'usage', 2);
  updateProject(project.key, { hosting: provider });
  addHistory({ project: project.key, projectName: project.name, kind: 'hosting', status: 'ok', message: `Хостинг → ${PROVIDERS[provider].name}` });
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
  const record = { url, at: nowISO(), provider };
  setState(project.key, prod ? { lastProd: record } : { lastDraft: record });
  if (prod) updateProject(project.key, { liveUrl: url });
  addHistory({ project: project.key, projectName: project.name, kind: prod ? 'production' : 'draft', status: 'ok', url, duration, log: logFile, message: PROVIDERS[provider].name });
  const cost = recordCost({ project: project.key, projectName: project.name, service: provider, op: prod ? 'production' : 'draft' });
  ev.step('deploy', { label: prod ? 'Production deploy' : 'Draft preview', category: 'Hosting', status: 'pass', summary: url, duration, log: logFile });
  ev.notify(prod ? `🚀 ${project.name} е LIVE` : `✅ ${project.name} — Preview`, `${PROVIDERS[provider].name}: ${url}`, url);
  return { prod, url, provider, duration, cost };
}

function failDeploy(project, provider, { prod, r, logFile, duration, msg }) {
  ev.step('deploy', { label: prod ? 'Production deploy' : 'Draft preview', category: 'Hosting', status: 'fail', summary: msg || 'Deploy се провали', details: r?.tail?.slice(-15) || [], log: logFile, duration });
  addHistory({ project: project.key, projectName: project.name, kind: prod ? 'production' : 'draft', status: 'fail', log: logFile, message: PROVIDERS[provider].name });
  throw new EngineError(`${PROVIDERS[provider].name}: ${msg || 'deploy се провали'}. Виж лога.`, 'deploy_failed');
}

async function vercelDeploy(project, { prod }) {
  const logFile = path.join(logDir(project.key), `vercel-${prod ? 'prod' : 'draft'}.log`);
  const args = ['deploy', '--yes'];
  if (prod) args.push('--prod');
  ev.step('deploy', { label: prod ? 'Production deploy' : 'Draft preview', category: 'Hosting', status: 'running', summary: 'Vercel build + upload' });
  const t0 = Date.now();
  const r = await runStream('vercel', args, { cwd: project.path, step: 'deploy', logFile, captureStdout: true, timeout: 20 * 60 * 1000 });
  const duration = (Date.now() - t0) / 1000;
  const url = (r.stdout.match(/https:\/\/[^\s]+\.vercel\.app/g) || []).pop();
  if (r.code !== 0 || !url) return failDeploy(project, 'vercel', { prod, r, logFile, duration });
  return finishDeploy(project, 'vercel', { prod, url, duration, logFile });
}

async function cloudflareDeploy(project, { prod }) {
  const d = detect(project.path);
  if (d.ssr || d.hasFunctions) throw new EngineError('Cloudflare Pages тук поддържа само статични сайтове.', 'unsupported');
  if (!d.publishReady) throw new EngineError(`Няма build в ${d.publishDir}/ — пусни проверката първо.`, 'no_build');
  const logFile = path.join(logDir(project.key), `cloudflare-${prod ? 'prod' : 'draft'}.log`);
  let name = project.cloudflare?.projectName;
  ev.step('deploy', { label: prod ? 'Production deploy' : 'Draft preview', category: 'Hosting', status: 'running', summary: 'Cloudflare Pages upload' });
  if (!name) {
    name = slugify(project.name === 'ПОРТФОЛИО' ? 'portfolio' : project.name);
    const c = await runStream('wrangler', ['pages', 'project', 'create', name, '--production-branch=main'], { cwd: project.path, step: 'deploy', logFile, timeout: 120000 });
    if (c.code !== 0 && !c.tail.join('\n').match(/already exists/i)) return failDeploy(project, 'cloudflare', { prod, r: c, logFile, msg: 'не успях да създам Pages проект' });
    updateProject(project.key, { cloudflare: { projectName: name } });
  }
  const t0 = Date.now();
  const r = await runStream(
    'wrangler',
    ['pages', 'deploy', d.publishDir, `--project-name=${name}`, `--branch=${prod ? 'main' : 'preview'}`, '--commit-dirty=true'],
    { cwd: project.path, step: 'deploy', logFile, captureStdout: true, timeout: 20 * 60 * 1000 }
  );
  const duration = (Date.now() - t0) / 1000;
  const all = `${r.stdout}\n${r.tail.join('\n')}`;
  const url = (all.match(/https:\/\/[^\s]+\.pages\.dev/g) || []).pop();
  if (r.code !== 0 || !url) return failDeploy(project, 'cloudflare', { prod, r, logFile, duration });
  return finishDeploy(project, 'cloudflare', { prod, url: prod ? `https://${name}.pages.dev` : url, duration, logFile });
}

async function ghPagesDeploy(project, { prod }) {
  if (!prod) throw new EngineError('GitHub Pages няма preview — направи Local Preview или избери друг хостинг за чернови.', 'unsupported');
  const d = detect(project.path);
  if (d.ssr || d.hasFunctions) throw new EngineError('GitHub Pages е само за статични сайтове.', 'unsupported');
  if (!d.publishReady) throw new EngineError(`Няма build в ${d.publishDir}/ — пусни проверката първо.`, 'no_build');
  const m = (d.git.githubUrl || '').match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) throw new EngineError('Нужно е GitHub repo (origin).', 'no_remote');
  const [, owner, repo] = m;
  const logFile = path.join(logDir(project.key), 'ghpages.log');
  ev.step('deploy', { label: 'Production deploy', category: 'Hosting', status: 'running', summary: `gh-pages ← ${d.publishDir}/` });
  if (!exists(path.join(project.path, d.publishDir, '.nojekyll'))) fs.writeFileSync(path.join(project.path, d.publishDir, '.nojekyll'), '');
  const t0 = Date.now();
  const r = await runStream('npx', ['--yes', 'gh-pages', '-d', d.publishDir, '-t', '-m', `Before I Deploy — ${new Date().toISOString()}`], {
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
  if (prod && confirm !== 'DEPLOY') throw new EngineError('Production deploy изисква --confirm DEPLOY', 'confirm_required', 2);
  deployGuard(project);
  const st = providerStatus(provider);
  if (!st.installed) throw new EngineError(`${st.name} CLI не е инсталиран — инсталирай го от „Настройка“.`, 'no_cli');
  if (!st.loggedIn) throw new EngineError(`Не си влязъл в ${st.name}.`, 'not_logged_in', 5);
  const p = findProject(project.key) || project;
  if (provider === 'vercel') return vercelDeploy(p, { prod });
  if (provider === 'cloudflare') return cloudflareDeploy(p, { prod });
  if (provider === 'ghpages') return ghPagesDeploy(p, { prod });
  throw new EngineError(`Непознат хостинг: ${provider}`, 'usage', 2);
}

export function hostingReady(project) {
  const provider = (findProject(project.key) || project).hosting || 'netlify';
  if (provider === 'netlify') return detect(project.path).netlifyLinked;
  const st = providerStatus(provider);
  return st.installed && st.loggedIn;
}

