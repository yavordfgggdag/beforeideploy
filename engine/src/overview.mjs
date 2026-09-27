// Mission Control — every project at a glance: status, live uptime, SSL, Git, what needs attention
import tls from 'node:tls';
import https from 'node:https';
import http from 'node:http';
import { listProjects, getState } from './store.mjs';
import { gitStatus } from './git.mjs';
import { localStatus } from './local.mjs';
import { isDir, nowISO } from './util.mjs';
import { spaceshipDomains, domainAttention } from './spaceship.mjs';
import { t } from './i18n.mjs';

function ping(url, timeout = 6000) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return resolve({ ok: false, error: 'bad url' });
    }
    const lib = u.protocol === 'https:' ? https : http;
    const t0 = Date.now();
    const req = lib.request(u, { method: 'HEAD', timeout }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode < 400, status: res.statusCode, ms: Date.now() - t0 });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout', ms: timeout });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
    req.end();
  });
}

function sslDays(host, timeout = 6000) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: host, timeout }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      if (!cert?.valid_to) return resolve(null);
      resolve(Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86400000));
    });
    sock.on('timeout', () => {
      sock.destroy();
      resolve(null);
    });
    sock.on('error', () => resolve(null));
  });
}

export async function overview({ network = true } = {}) {
  const projects = listProjects();
  const cards = await Promise.all(
    projects.map(async (p) => {
      const st = getState(p.key);
      const live = p.liveUrl || p.netlify?.liveUrl || st.lastProd?.url || null;
      const card = {
        key: p.key,
        name: p.name,
        path: p.path,
        exists: isDir(p.path),
        framework: p.framework,
        hosting: p.hosting || 'netlify',
        status: st.check?.status || null,
        checkedAt: st.check?.at || null,
        failing: (st.check?.steps || []).filter((s) => s.status === 'fail').map((s) => s.label || s.id),
        liveUrl: live,
        lastProd: st.lastProd?.at || p.netlify?.lastPublishedAt || null,
        lastDraft: st.lastDraft?.at || null,
        changed: 0,
        branch: null,
        ahead: null,
        behind: null,
        local: null,
        uptime: null,
        sslDays: null,
      };
      if (card.exists) {
        const g = gitStatus(p.path);
        card.changed = g.changedCount || 0;
        card.branch = g.branch || null;
        card.ahead = g.ahead ?? null;
        card.behind = g.behind ?? null;
        const l = localStatus(p);
        card.local = l.running ? l.url : null;
      }
      if (network && live) {
        const [up, days] = await Promise.all([ping(live), sslDays(new URL(live).hostname).catch(() => null)]);
        card.uptime = up;
        card.sslDays = days;
      }
      return card;
    })
  );

  const attention = [];
  for (const c of cards) {
    if (!c.exists) attention.push({ key: c.key, level: 'fail', text: t('overview.folderMissing', { name: c.name }) });
    if (c.status === 'blocked') attention.push({ key: c.key, level: 'fail', text: t('overview.blocked', { name: c.name, steps: c.failing.join(', ') || t('overview.errors') }) });
    if (c.uptime && !c.uptime.ok) {
      // a site that was never published to production 404s by design — that's info, not an outage
      if (!c.lastProd && c.uptime.status === 404) attention.push({ key: c.key, level: 'info', text: t('overview.noProduction', { name: c.name }) });
      else attention.push({ key: c.key, level: 'fail', text: t('overview.down', { name: c.name, reason: c.uptime.status || c.uptime.error }) });
    }
    if (c.sslDays !== null && c.sslDays < 14) attention.push({ key: c.key, level: 'warn', text: t('overview.sslExpiring', { name: c.name, days: c.sslDays }) });
    if (c.behind) attention.push({ key: c.key, level: 'warn', text: t('overview.behind', { name: c.name, count: c.behind }) });
    if (c.changed > 0 && c.checkedAt && Date.now() - Date.parse(c.checkedAt) > 3 * 86400000)
      attention.push({ key: c.key, level: 'warn', text: t('overview.staleChanges', { name: c.name, count: c.changed }) });
    if (!c.status && c.exists) attention.push({ key: c.key, level: 'info', text: t('overview.notChecked', { name: c.name }) });
  }

  let domains = { connected: false, domains: [] };
  if (network) {
    try {
      domains = await spaceshipDomains();
    } catch (e) {
      domains = { connected: true, domains: [], error: e.message };
    }
  }
  attention.push(...domainAttention(domains.domains));
  const order = { fail: 0, warn: 1, info: 2 };
  attention.sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3));

  return {
    at: nowISO(),
    cards,
    domains,
    attention,
    totals: {
      projects: cards.length,
      ready: cards.filter((c) => c.status === 'ready').length,
      warnings: cards.filter((c) => c.status === 'warnings').length,
      blocked: cards.filter((c) => c.status === 'blocked').length,
      online: cards.filter((c) => c.uptime?.ok).length,
      live: cards.filter((c) => c.liveUrl).length,
    },
  };
}
