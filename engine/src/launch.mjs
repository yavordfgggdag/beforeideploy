// Launch checklist (V11.1 "Launchpad"): where a site is on the way from a folder to a live, watched site.
// Derived from what the engine already knows — never a guess presented as a fact. The app shows it as the
// first card of a project until every required step is done.
import { t } from './i18n.mjs';
import { monitorSettings } from './monitor.mjs';

const ORDER = ['project', 'check', 'site', 'hosting', 'deploy', 'domain', 'monitor'];

/** Literal keys per step and state, so the catalog check can prove every text exists and is used. */
const TITLE = { project: 'launch.project.title', check: 'launch.check.title', site: 'launch.site.title', hosting: 'launch.hosting.title', deploy: 'launch.deploy.title', domain: 'launch.domain.title', monitor: 'launch.monitor.title' };
const HINT = {
  project: { done: 'launch.project.done' },
  check: { todo: 'launch.check.todo', attention: 'launch.check.attention', done: 'launch.check.done', waiting: 'launch.check.waiting' },
  site: { waiting: 'launch.site.waiting', attention: 'launch.site.attention', done: 'launch.site.done', todo: 'launch.site.todo' },
  hosting: { todo: 'launch.hosting.todo', done: 'launch.hosting.done', waiting: 'launch.hosting.waiting', attention: 'launch.hosting.attention' },
  deploy: { todo: 'launch.deploy.todo', waiting: 'launch.deploy.waiting', done: 'launch.deploy.done', attention: 'launch.deploy.attention' },
  domain: { todo: 'launch.domain.todo', waiting: 'launch.domain.waiting', done: 'launch.domain.done', attention: 'launch.domain.attention' },
  monitor: { todo: 'launch.monitor.todo', waiting: 'launch.monitor.waiting', done: 'launch.monitor.done', attention: 'launch.monitor.attention' },
};

/**
 * `{ steps: [{ id, status: done | attention | todo | waiting, optional, title, hint, action }], done, total, next, complete }`
 *   status   done = finished · attention = something to fix first · todo = the next thing to do · waiting = depends on an earlier step
 *   action   what the app should offer: check | fix | hosting | deploy | release | domain | monitor | null
 */
export function launchStatus({ project, detect: d, check, lastDraft, lastProd, hostingReady, liveUrl }) {
  const steps = [];
  const push = (id, status, over = {}) => steps.push({ id, status, optional: false, title: t(TITLE[id]), hint: HINT[id]?.[status] ? t(HINT[id][status]) : '', action: null, ...over });

  push('project', 'done', { hint: t('launch.project.done', { framework: d?.framework || '—' }) });

  const siteStep = check?.steps?.find((s) => s.id === 'site');
  if (!check) push('check', 'todo', { action: 'check' });
  else if (check.status === 'blocked') push('check', 'attention', { action: 'fix', hint: t('launch.check.attention', { count: check.counts?.fail || 1 }) });
  else push('check', 'done', { hint: t(check.status === 'warnings' ? 'launch.check.doneWarnings' : 'launch.check.done', { count: check.counts?.warn || 0 }) });

  if (!check) push('site', 'waiting');
  else if (!siteStep || siteStep.status === 'info') push('site', 'done', { hint: siteStep?.summary || t('launch.site.skipped') });
  else if (siteStep.status === 'fail') push('site', 'attention', { action: 'fix', hint: t('launch.site.attention', { count: (siteStep.findings || []).filter((f) => f.severity === 'fail').length }) });
  else if (siteStep.status === 'warn') push('site', 'done', { hint: t('launch.site.doneWarnings', { count: (siteStep.findings || []).filter((f) => f.severity === 'warn').length }) });
  else push('site', 'done', { hint: t('launch.site.done', { pages: siteStep.pages || 0 }) });

  push('hosting', hostingReady ? 'done' : 'todo', { action: hostingReady ? null : 'hosting', hint: hostingReady ? t('launch.hosting.done', { name: project.hosting || 'Netlify' }) : t('launch.hosting.todo') });

  if (lastProd) push('deploy', 'done', { hint: t('launch.deploy.done', { when: lastProd.at || '' }) });
  else if (!hostingReady) push('deploy', 'waiting');
  else if (check?.status === 'blocked') push('deploy', 'waiting', { hint: t('launch.deploy.blocked') });
  else if (lastDraft) push('deploy', 'todo', { action: 'release', hint: t('launch.deploy.previewed') });
  else push('deploy', 'todo', { action: 'deploy' });

  const host = liveUrl ? String(liveUrl).replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
  const customDomain = !!project.domain || (host && !/\.(netlify\.app|vercel\.app|pages\.dev|github\.io)$/i.test(host));
  if (customDomain) push('domain', 'done', { optional: true, hint: t('launch.domain.done', { domain: project.domain || host }) });
  else if (!lastProd) push('domain', 'waiting', { optional: true });
  else push('domain', 'todo', { optional: true, action: 'domain' });

  const monitoring = monitorSettings();
  if (!liveUrl && !lastProd) push('monitor', 'waiting', { optional: true });
  else if (monitoring.enabled === false) push('monitor', 'todo', { optional: true, action: 'monitor' });
  else push('monitor', 'done', { optional: true, hint: t('launch.monitor.done', { minutes: monitoring.intervalMin }) });

  const required = steps.filter((s) => !s.optional);
  const done = steps.filter((s) => s.status === 'done').length;
  const next = steps.find((s) => s.status === 'attention') || steps.find((s) => s.status === 'todo') || null;
  return { steps: ORDER.map((id) => steps.find((s) => s.id === id)).filter(Boolean), done, total: steps.length, requiredDone: required.filter((s) => s.status === 'done').length, requiredTotal: required.length, next: next?.id || null, complete: required.every((s) => s.status === 'done') };
}
