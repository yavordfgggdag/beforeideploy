// Mission Control — every project at a glance: status, live uptime, SSL, Git, what needs attention
import fs from 'node:fs';
import tls from 'node:tls';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { listProjects, getState } from './store.mjs';
import { deriveIssues } from './issues.mjs';
import { readJSON, APP_DIR } from './util.mjs';
import { gitStatus } from './git.mjs';
import { localStatus } from './local.mjs';
import { isDir, nowISO } from './util.mjs';
import { spaceshipDomains, domainAttention } from './spaceship.mjs';
import { t } from './i18n.mjs';

// Step names in the language of this run: a stored check keeps the labels of the language it ran in.
const stepName = (s) => ({
  git: t('check.step.git'), secrets: t('check.step.secrets'), deps: t('check.step.deps'), lint: t('check.step.lint'),
  typecheck: t('check.step.typecheck'), build: t('check.step.build'), site: t('check.step.site'), hosting: t('check.step.hosting'),
})[s.id] || s.label || s.id;

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
    // rejectUnauthorized: false only to READ an expired certificate (nothing is sent) — otherwise the
    // handshake fails and an expired site looks like "no data" (audit E18)
    const sock = tls.connect({ host, port: 443, servername: host, timeout, rejectUnauthorized: false }, () => {
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

const STALE_MS = 6 * 3600 * 1000;

/** A value with provenance (V11): never "healthy" without data; old data is "stale", not "healthy". */
function signal(state, value, at, source, detail) {
  if (state === 'healthy' && at && Date.now() - Date.parse(at) > STALE_MS) state = 'stale';
  return { state, value: value == null ? null : String(value), at: at || null, source: source || null, detail: detail || null };
}

function daysText(d) {
  return d < 0 ? t('overview.signal.expired') : t('overview.signal.days', { days: d });
}

export async function overview({ network = true } = {}) {
  const projects = listProjects();
  // the last monitoring pass (this Mac) stands in for a live probe when the overview runs offline
  const monitor = readJSON(path.join(APP_DIR, 'monitor.json'), null) || { projects: {} };
  let incidents = [];
  try {
    incidents = fs.readFileSync(path.join(APP_DIR, 'incidents.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((i) => i.status === 'open');
  } catch {}
  const cards = await Promise.all(
    projects.map(async (p) => {
      const st = getState(p.key);
      const live = p.liveUrl || p.netlify?.liveUrl || st.lastProd?.url || null;
      const card = {
        key: p.key,
        name: p.name,
        client: p.client || null,
        path: p.path,
        exists: isDir(p.path),
        framework: p.framework,
        hosting: p.hosting || 'netlify',
        status: st.check?.status || null,
        checkedAt: st.check?.at || null,
        failing: (st.check?.steps || []).filter((s) => s.status === 'fail').map((s) => stepName(s)),
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
      // signals with provenance (V11): what, from where, when, in which state
      const mon = monitor.projects?.[p.key] || null;
      const openFor = incidents.filter((i) => i.project === p.key);
      const issues = st.check ? deriveIssues(st.check).counts : null;
      card.issues = issues;
      const sig = {};
      sig.check = st.check
        ? signal(st.check.status === 'blocked' ? 'problem' : 'healthy', st.check.status, st.check.at, 'check', st.check.status === 'blocked' ? card.failing.join(', ') : null)
        : signal('unchecked', null, null, 'check');
      const prodAt = st.lastProd?.at || p.netlify?.lastPublishedAt || null;
      sig.deploy = prodAt ? { state: 'healthy', value: st.lastProd?.deployId || null, at: prodAt, source: st.lastProd ? 'engine' : 'netlify', detail: null } : signal('unchecked', null, null, null);
      if (!live) sig.uptime = signal('unsupported', null, null, null, 'no_live_url');
      else if (network && card.uptime) sig.uptime = signal(card.uptime.ok ? 'healthy' : 'problem', card.uptime.ok ? `${card.uptime.ms} ms` : card.uptime.error || t('overview.signal.http', { status: card.uptime.status }), nowISO(), 'overview', card.uptime.error || null);
      else if (mon?.uptime?.state) sig.uptime = signal(mon.uptime.state === 'healthy' ? 'healthy' : mon.uptime.state === 'problem' ? 'problem' : 'unsupported', mon.uptime.ok ? `${mon.uptime.ms} ms` : mon.uptime.error || null, mon.at, 'monitor');
      else sig.uptime = signal('unchecked', null, null, null);
      const ssl = card.sslDays ?? mon?.sslDays ?? null;
      const sslAt = card.sslDays != null ? nowISO() : mon?.sslCheckedAt || null;
      sig.ssl = !live || !/^https:/.test(live) ? signal('unsupported', null, null, null) : ssl == null ? signal('unchecked', null, null, null) : signal(ssl < 14 ? 'problem' : 'healthy', daysText(ssl), sslAt, card.sslDays != null ? 'overview' : 'monitor');
      sig.backup = signal('unsupported', null, null, null, 'not_connected');
      card.signals = sig;
      card.openIncidents = openFor.length;
      card.nextAction = nextAction(card, st, issues, openFor);
      return card;
    })
  );

  // domain signal: from the registrar, once the domains are known (below)
  const attention = [];
  for (const c of cards) {
    if (!c.exists) attention.push({ key: c.key, level: 'fail', text: t('overview.folderMissing', { name: c.name }) });
    if (c.status === 'blocked') attention.push({ key: c.key, level: 'fail', text: t('overview.blocked', { name: c.name, steps: c.failing.join(', ') || t('overview.errors') }) });
    if (c.uptime && !c.uptime.ok) {
      // a site that was never published to production 404s by design — that's info, not an outage
      if (!c.lastProd && c.uptime.status === 404) attention.push({ key: c.key, level: 'info', text: t('overview.noProduction', { name: c.name }) });
      else attention.push({ key: c.key, level: 'fail', text: t('overview.down', { name: c.name, reason: c.uptime.status || c.uptime.error }) });
    }
    if (c.sslDays !== null && c.sslDays < 0) attention.push({ key: c.key, level: 'fail', text: t('overview.sslExpired', { name: c.name, days: -c.sslDays }) });
    else if (c.sslDays !== null && c.sslDays < 14) attention.push({ key: c.key, level: 'warn', text: t('overview.sslExpiring', { name: c.name, days: c.sslDays }) });
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
  for (const c of cards) {
    const p = projects.find((x) => x.key === c.key);
    const dom = p?.domain ? (domains.domains || []).find((d) => d.name === p.domain) : null;
    if (!p?.domain) c.signals.domain = signal('unsupported', null, null, null, 'no_domain');
    else if (!domains.connected) c.signals.domain = signal('unchecked', p.domain, null, null, 'registrar_not_connected');
    else if (!dom) c.signals.domain = signal('unchecked', p.domain, domains.at || nowISO(), 'spaceship', 'not_in_registrar');
    else c.signals.domain = signal(dom.daysLeft != null && dom.daysLeft < 30 ? 'problem' : 'healthy', dom.daysLeft != null ? daysText(dom.daysLeft) : p.domain, domains.at || nowISO(), 'spaceship');
  }
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


/** The one thing to do next for a site — derived from what is known, never a guess presented as a fact. */
function nextAction(card, st, issues, openIncidents) {
  if (openIncidents.length) return { id: 'investigate', label: t('overview.next.investigate', { what: openIncidents.map((i) => i.kind).join(', ') }) };
  if (!card.exists) return { id: 'none', label: t('overview.next.none') };
  if (!st.check) return { id: 'check', label: t('overview.next.check') };
  if (card.status === 'blocked' || (issues && issues.blocker > 0)) return { id: 'fix', label: t('overview.next.fix', { count: issues?.blocker || card.failing.length || 1 }) };
  if (card.checkedAt && Date.now() - Date.parse(card.checkedAt) > 30 * 60000 && card.changed > 0) return { id: 'check', label: t('overview.next.check') };
  if (!card.liveUrl && !st.lastProd) return { id: 'connect-hosting', label: t('overview.next.connectHosting') };
  if (card.status === 'ready' && st.check && (!st.lastProd || Date.parse(st.check.at) > Date.parse(st.lastProd.at || 0)) && card.changed === 0 && !st.lastProd) return { id: 'release', label: t('overview.next.release') };
  return { id: 'none', label: t('overview.next.none') };
}