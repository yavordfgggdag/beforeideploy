// Spaceship — domains, expiry, DNS and one-click “connect domain to Netlify”
import path from 'node:path';
import { EngineError, ev, nowISO, readJSON, writeJSON, APP_DIR, runStream, which, extractJSON, HOME } from './util.mjs';
import { getSecret, setSecret, deleteSecret } from './secrets.mjs';
import { detect } from './detect.mjs';
import { addHistory, updateProject } from './store.mjs';
import { t, msg } from './i18n.mjs';

const BASE = process.env.BID_SPACESHIP_BASE || 'https://spaceship.dev/api/v1';
const NETLIFY_LB_IP = '75.2.60.5';
const CACHE = () => path.join(APP_DIR, 'spaceship-cache.json');

export const API_MANAGER_URL = 'https://www.spaceship.com/application/api-manager/';

function creds() {
  const c = getSecret('spaceship');
  if (!c?.key || !c?.secret) throw new EngineError(msg('spaceship.notConnected'), 'not_connected', 6);
  return c;
}

async function api(method, p, body) {
  const c = creds();
  let res;
  try {
    res = await fetch(BASE + p, {
      method,
      headers: { 'X-API-Key': c.key, 'X-API-Secret': c.secret, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new EngineError(msg('spaceship.network', { error: e.message }), 'network');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (res.status === 401 || res.status === 403) throw new EngineError(msg('spaceship.unauthorized'), 'unauthorized');
  if (!res.ok) {
    const msg = data?.detail || data?.title || data?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new EngineError(`Spaceship: ${msg}`, 'spaceship_error');
  }
  return data;
}

export async function spaceshipConnect({ key, secret }) {
  key = key || process.env.BID_SPACESHIP_KEY;
  secret = secret || process.env.BID_SPACESHIP_SECRET;
  if (!key || !secret) throw new EngineError(msg('spaceship.missingKeys'), 'usage', 2);
  setSecret('spaceship', { key: key.trim(), secret: secret.trim(), savedAt: nowISO() });
  try {
    const d = await spaceshipDomains({ refresh: true });
    return { connected: true, domains: d.domains.length };
  } catch (e) {
    deleteSecret('spaceship');
    throw e;
  }
}

export function spaceshipDisconnect() {
  deleteSecret('spaceship');
  return { connected: false };
}

export function spaceshipConnected() {
  const c = getSecret('spaceship');
  return !!(c?.key && c?.secret);
}

export async function spaceshipDomains({ refresh = false } = {}) {
  if (!spaceshipConnected()) return { connected: false, domains: [], apiManager: API_MANAGER_URL };
  const cache = readJSON(CACHE(), null);
  if (!refresh && cache && Date.now() - Date.parse(cache.at) < 10 * 60 * 1000) return cache;
  const all = [];
  for (let skip = 0; skip < 1000; skip += 100) {
    const page = await api('GET', `/domains?take=100&skip=${skip}`);
    const items = page?.items || [];
    all.push(...items);
    if (items.length < 100) break;
  }
  const domains = all
    .map((d) => {
      const exp = d.expirationDate ? Date.parse(d.expirationDate) : null;
      return {
        name: d.name,
        unicodeName: d.unicodeName || d.name,
        expirationDate: d.expirationDate || null,
        daysLeft: exp ? Math.floor((exp - Date.now()) / 86400000) : null,
        autoRenew: !!d.autoRenew,
        status: d.lifecycleStatus || null,
        privacy: d.privacyProtection?.level || (d.privacyProtection ? 'on' : null),
        dashboard: `https://www.spaceship.com/application/domain-list-application/${encodeURIComponent(d.name)}/`,
      };
    })
    .sort((a, b) => (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999));
  const out = { connected: true, at: nowISO(), domains, apiManager: API_MANAGER_URL };
  writeJSON(CACHE(), out);
  return out;
}

export async function spaceshipDns(domain) {
  if (!domain || domain === true) throw new EngineError(msg('spaceship.missingDomain'), 'usage', 2);
  const r = await api('GET', `/dns/records/${encodeURIComponent(domain)}?take=500&skip=0`);
  const records = (r?.items || []).map((x) => ({
    type: x.type,
    name: x.name,
    ttl: x.ttl,
    value: x.address || x.cname || x.value || x.exchange || x.target || x.host || JSON.stringify(x),
    raw: x,
  }));
  return { domain, records };
}

function netlifyCli() {
  if (which('netlify')) return { cmd: 'netlify', pre: [] };
  if (which('npx')) return { cmd: 'npx', pre: ['--yes', 'netlify-cli'] };
  throw new EngineError(msg('spaceship.noNetlifyCli'), 'no_cli');
}

/** Plans (or applies with yes) the DNS + Netlify changes to serve `domain` from the project's Netlify site. */
export async function connectDomainToNetlify(project, { domain, yes = false }) {
  if (!domain || domain === true) throw new EngineError(msg('spaceship.missingDomain'), 'usage', 2);
  const d = detect(project.path);
  if (!d.netlifyLinked) throw new EngineError(msg('spaceship.notLinked'), 'not_linked', 4);
  const siteName = project.netlify?.siteName;
  const target = siteName ? `${siteName}.netlify.app` : null;
  if (!target) throw new EngineError(msg('spaceship.noSite'), 'no_site');

  const current = await spaceshipDns(domain);
  const wanted = [
    { type: 'A', name: '@', address: NETLIFY_LB_IP, ttl: 3600 },
    { type: 'CNAME', name: 'www', cname: target, ttl: 3600 },
  ];
  const conflicts = current.records.filter(
    (r) =>
      (r.name === '@' && ['A', 'AAAA', 'CNAME', 'ALIAS'].includes(r.type) && r.value !== NETLIFY_LB_IP) ||
      (r.name === 'www' && ['A', 'AAAA', 'CNAME'].includes(r.type) && r.value.replace(/\.$/, '') !== target)
  );
  const plan = {
    domain,
    site: target,
    add: wanted.map((w) => ({ type: w.type, name: w.name, value: w.address || w.cname })),
    replace: conflicts.map((c) => ({ type: c.type, name: c.name, value: c.value })),
    netlify: { custom_domain: domain, domain_aliases: [`www.${domain}`] },
    note: t('spaceship.plan.note'),
  };
  if (!yes) return { applied: false, plan };

  ev.step('dns', { label: t('spaceship.dns.label'), status: 'running', summary: `${domain} → ${target}` });
  if (conflicts.length) {
    const del = conflicts.map((c) => ({ ...c.raw }));
    await api('DELETE', `/dns/records/${encodeURIComponent(domain)}`, del);
  }
  await api('PUT', `/dns/records/${encodeURIComponent(domain)}`, { force: true, items: wanted });
  ev.step('dns', { label: t('spaceship.dns.label'), status: 'pass', summary: `A @ → ${NETLIFY_LB_IP} · CNAME www → ${target}` });

  ev.step('netlify-domain', { label: t('spaceship.netlifyDomain.label'), status: 'running' });
  const c = netlifyCli();
  const body = JSON.stringify({ site_id: d.siteId, body: { custom_domain: domain, domain_aliases: [`www.${domain}`] } });
  const r = await runStream(c.cmd, [...c.pre, 'api', 'updateSite', '--data', body], { cwd: HOME, quiet: true, captureStdout: true, timeout: 120000 });
  const site = extractJSON(r.stdout);
  if (r.code !== 0 || !site) {
    ev.step('netlify-domain', { label: t('spaceship.netlifyDomain.label'), status: 'fail', summary: t('spaceship.netlifyDomain.rejected'), details: r.tail.slice(-8) });
    throw new EngineError(msg('spaceship.netlifyRejected'), 'netlify_failed');
  }
  ev.step('netlify-domain', { label: t('spaceship.netlifyDomain.label'), status: 'pass', summary: `https://${domain}` });
  updateProject(project.key, { domain, netlify: { liveUrl: `https://${domain}` } });
  addHistory({ project: project.key, projectName: project.name, kind: 'domain', status: 'ok', url: `https://${domain}`, message: `${domain} → ${target}` });
  ev.notify(`🌐 ${domain}`, t('spaceship.notify.connected', { project: project.name }), `https://${domain}`);
  return { applied: true, plan };
}

export function domainAttention(domains) {
  const out = [];
  for (const d of domains || []) {
    if (d.daysLeft !== null && d.daysLeft < 30) {
      out.push({ key: `domain:${d.name}`, level: d.daysLeft < 7 ? 'fail' : 'warn', text: t(d.autoRenew ? 'spaceship.expiring.autoRenew' : 'spaceship.expiring.noAutoRenew', { name: d.name, days: d.daysLeft }) });
    } else if (!d.autoRenew && d.daysLeft !== null && d.daysLeft < 90) {
      out.push({ key: `domain:${d.name}`, level: 'info', text: t('spaceship.autoRenewOff', { name: d.name, days: d.daysLeft }) });
    }
  }
  return out;
}

