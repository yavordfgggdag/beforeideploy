// Server-side monitoring, engine side (V11 RC): talks to the `monitor` Edge Function with the user's session,
// merges cloud incidents with the local ones, and posts confirmed incidents to the ONE external channel the
// user configured (a webhook URL) — never to a default destination.
//
//   bid monitor cloud status | enable [--project P] [--interval N] [--paths /a,/b] | disable [--project P] | test [--project P]
//   bid monitor notify test                    → a test payload to the configured webhook
//   bid monitor maintenance add --from ISO --to ISO [--project P] | list | clear
import dns from 'node:dns/promises';
import net from 'node:net';
import { EngineError } from './util.mjs';
import { msg, t } from './i18n.mjs';
import { cloudConfig, currentSession } from './account.mjs';
import { listProjects, findProject, getState } from './store.mjs';

const CODE_KEYS = {
  bad_secret: 'monitor.cloud.badSecret',
  url_rejected: 'monitor.cloud.urlRejected',
  project_not_synced: 'monitor.cloud.notSynced',
  not_owner: 'monitor.cloud.notOwner',
  not_registered: 'monitor.cloud.notRegistered',
};

async function monitorCall(action, params = {}, { timeoutMs = 8000 } = {}) {
  const c = cloudConfig();
  if (!c) throw new EngineError(msg('account.cloud.notConfigured'), 'not_configured', 7);
  const s = await currentSession();
  if (!s) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${c.url}/functions/v1/monitor`, {
      method: 'POST',
      headers: { apikey: c.anonKey, Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new EngineError(msg('account.network', { error: e.name === 'AbortError' ? 'timeout' : e.message }), 'network');
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  if (!res.ok) {
    const key = CODE_KEYS[data?.code];
    if (key) throw new EngineError(msg(key, { reason: data?.reason || '', known: (data?.known || []).join(', ') }), 'monitor_cloud_failed');
    throw new EngineError(msg('monitor.cloud.failed', { status: res.status, detail: data?.error || '' }), 'monitor_cloud_failed');
  }
  return data;
}

/** Cloud status, or null when the account is signed out / offline (the caller says so instead of guessing). */
export async function cloudStatusOrNull() {
  try {
    return await monitorCall('status', {}, { timeoutMs: 6000 });
  } catch (e) {
    return { unavailable: true, reason: e.code || 'error', error: e.message };
  }
}

export async function monitorCloudStatus() {
  return monitorCall('status');
}

function liveUrlOf(p) {
  const st = getState(p.key);
  return p.liveUrl || p.netlify?.liveUrl || st.lastProd?.url || null;
}

/** Registers the project's live URL for cloud probing (the cloud verifies it is this tenant's live host). */
export async function monitorCloudEnable({ project = null, intervalMin = null, paths = null } = {}) {
  const targets = project ? [findProject(project) || { key: project }] : listProjects();
  const out = [];
  for (const p of targets) {
    const url = liveUrlOf(p);
    if (!url) {
      out.push({ project: p.key, registered: false, reason: 'no_live_url' });
      continue;
    }
    const params = { projectKey: p.key, url, checks: ['down', 'ssl', ...(paths?.length ? ['page'] : [])] };
    if (intervalMin) params.intervalMin = intervalMin;
    if (paths?.length) params.paths = paths;
    try {
      const r = await monitorCall('register', params);
      out.push({ project: p.key, registered: true, target: r.target });
    } catch (e) {
      if (project) throw e;
      out.push({ project: p.key, registered: false, reason: e.code || 'error', error: e.message });
    }
  }
  return { results: out };
}

export async function monitorCloudDisable({ project = null } = {}) {
  const targets = project ? [findProject(project) || { key: project }] : listProjects();
  for (const p of targets) await monitorCall('unregister', { projectKey: p.key });
  return { unregistered: targets.map((p) => p.key) };
}

export async function monitorCloudTest({ project }) {
  if (!project) throw new EngineError(msg('monitor.cloud.projectRequired'), 'usage', 2);
  return monitorCall('test', { projectKey: project });
}

// ---------------------------------------------------------------- external channel (user-configured webhook)

const V4_PRIVATE = [
  [0x00000000, 0xff000000], [0x0a000000, 0xff000000], [0x64400000, 0xffc00000], [0x7f000000, 0xff000000], [0xa9fe0000, 0xffff0000],
  [0xac100000, 0xfff00000], [0xc0000000, 0xffffff00], [0xc0000200, 0xffffff00], [0xc0a80000, 0xffff0000], [0xc6120000, 0xfffe0000],
  [0xc6336400, 0xffffff00], [0xcb007100, 0xffffff00], [0xe0000000, 0xf0000000], [0xf0000000, 0xf0000000],
];
function v4Int(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
/** Public unicast only — the same rules as the cloud worker's guard (netguard.ts), for the Mac side. */
export function isPublicAddress(ip) {
  if (net.isIPv4(ip)) {
    const n = v4Int(ip);
    return !V4_PRIVATE.some(([base, mask]) => ((n & mask) >>> 0) === base);
  }
  if (!net.isIPv6(ip)) return false;
  const low = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(low);
  if (mapped) return isPublicAddress(mapped[1]);
  if (low === '::' || low === '::1' || low.startsWith('fe8') || low.startsWith('fe9') || low.startsWith('fea') || low.startsWith('feb') || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('ff') || low.startsWith('2001:db8') || low.startsWith('64:ff9b:')) return false;
  return /^[23][0-9a-f]{3}:/.test(low);
}

/** A webhook URL the engine may post to: https, hostname (no IP literal), every resolved address public. */
export async function validateWebhookUrl(text) {
  let url;
  try {
    url = new URL(String(text || ''));
  } catch {
    throw new EngineError(msg('monitor.webhook.invalid', { reason: 'invalid_url' }), 'webhook_rejected', 2);
  }
  if (url.protocol !== 'https:') throw new EngineError(msg('monitor.webhook.invalid', { reason: 'https_only' }), 'webhook_rejected', 2);
  if (url.username || url.password) throw new EngineError(msg('monitor.webhook.invalid', { reason: 'credentials_in_url' }), 'webhook_rejected', 2);
  const host = url.hostname.toLowerCase();
  if (net.isIP(host) || host === 'localhost' || host.endsWith('.local') || !host.includes('.')) throw new EngineError(msg('monitor.webhook.invalid', { reason: 'host' }), 'webhook_rejected', 2);
  if (process.env.BID_TEST_ALLOW_PRIVATE_WEBHOOK === '1') return url.toString(); // test receivers on 127.0.0.1 only
  let addrs = [];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new EngineError(msg('monitor.webhook.invalid', { reason: 'dns' }), 'webhook_rejected', 2);
  }
  if (!addrs.length || addrs.some((a) => !isPublicAddress(a.address))) throw new EngineError(msg('monitor.webhook.invalid', { reason: 'private_address' }), 'webhook_rejected', 2);
  return url.toString();
}

/** Posts one JSON payload to the configured webhook; bounded, never throws for a channel problem. */
export async function postWebhook(url, payload, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const target = process.env.BID_TEST_WEBHOOK_TARGET && process.env.BID_TEST_ALLOW_PRIVATE_WEBHOOK === '1' ? process.env.BID_TEST_WEBHOOK_TARGET : url;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(target, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'BeforeIDeploy-Monitor/1' }, body: JSON.stringify(payload), signal: ctl.signal, redirect: 'manual' });
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (e) {
    return { ok: false, status: null, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

const WEBHOOK_TEXT = { test: (x) => t('monitor.webhook.text.test', x), incident: (x) => t('monitor.webhook.text.incident', x), recovered: (x) => t('monitor.webhook.text.recovered', x) };
export function webhookPayload(kind, event, extra = {}) {
  const { kind: incidentKind, ...rest } = event || {};
  return { source: 'beforeideploy', version: 1, kind, incidentKind: incidentKind || null, at: new Date().toISOString(), text: (WEBHOOK_TEXT[kind] || WEBHOOK_TEXT.test)(extra), ...rest };
}
