// Monitoring and incidents (V11). One `bid monitor once` pass checks every project with a live URL:
//   uptime  — HEAD/GET with a timeout and one bounded retry; a problem is confirmed only after two
//             consecutive failed passes (no alert on a single blip)
//   ssl     — certificate days left, once a day per host
//   domain  — expiry from the registrar (Spaceship) when connected, once a day
// Results: state/monitor.json (last sample per project + failure streaks); incidents.jsonl (opened /
// updated / resolved incidents, deduplicated per project + kind). Notifications only through the app's
// macOS notifications and only for the severities enabled in monitor settings.
//
// Where it runs: on this Mac — the app's timer while it is open, or the launchd agent that
// `bid monitor agent install` writes (with the user's consent). There is no server-side scheduler yet;
// `bid monitor status` says so plainly (`runsOn: "mac"`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { APP_DIR, ENGINE_DIR, EngineError, ev, ensureDir, nowISO, readJSON, writeJSON } from './util.mjs';
import { listProjects, getState } from './store.mjs';
import { spaceshipDomains } from './spaceship.mjs';
import { t, msg } from './i18n.mjs';
import { cloudStatusOrNull, validateWebhookUrl, postWebhook, webhookPayload } from './monitor-cloud.mjs';
import { pushoverStatus, sendPushover } from './pushover.mjs';

const STATE_FILE = () => path.join(APP_DIR, 'monitor.json');
const INCIDENTS_FILE = () => path.join(APP_DIR, 'incidents.jsonl');
const SETTINGS_FILE = () => path.join(APP_DIR, 'monitor-settings.json');
const AGENT_LABEL = 'bg.yavor.beforeideploy.monitor';
const AGENT_PLIST = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);

export const DEFAULT_SETTINGS = {
  intervalMin: 10,
  timeoutMs: 8000,
  confirmFailures: 2,
  notify: { down: true, ssl: true, domain: true, recovered: true },
  quietHours: null, // e.g. { from: 22, to: 7 }
  maintenance: [], // [{ from: ISO, to: ISO, project?: key }] — no notifications, samples marked, incidents not opened
  channels: { webhook: null }, // external channels set by the user: a webhook (https, public host); Pushover lives in the Keychain (pushover.mjs)
};

export function monitorSettings() {
  const saved = readJSON(SETTINGS_FILE(), {}) || {};
  return { ...DEFAULT_SETTINGS, ...saved, notify: { ...DEFAULT_SETTINGS.notify, ...(saved.notify || {}) }, channels: { ...DEFAULT_SETTINGS.channels, ...(saved.channels || {}) }, maintenance: Array.isArray(saved.maintenance) ? saved.maintenance : [] };
}

export async function setMonitorSettings(patch) {
  const next = { ...monitorSettings(), ...patch };
  if (patch.notify) next.notify = { ...monitorSettings().notify, ...patch.notify };
  if (patch.channels) {
    next.channels = { ...monitorSettings().channels, ...patch.channels };
    if (next.channels.webhook) next.channels.webhook = await validateWebhookUrl(next.channels.webhook);
  }
  if (patch.maintenance !== undefined) next.maintenance = normalizeMaintenance(patch.maintenance);
  if (!Number.isFinite(next.intervalMin) || next.intervalMin < 5 || next.intervalMin > 1440) throw new EngineError(msg('monitor.badInterval'), 'usage', 2);
  writeJSON(SETTINGS_FILE(), next);
  return next;
}

// ---------------------------------------------------------------- probes

function probe(url, timeoutMs, method = 'HEAD') {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return resolve({ ok: false, error: 'bad_url', ms: 0 });
    }
    if (!/^https?:$/.test(u.protocol)) return resolve({ ok: false, error: 'bad_scheme', ms: 0 });
    const lib = u.protocol === 'https:' ? https : http;
    const t0 = Date.now();
    const req = lib.request(u, { method, timeout: timeoutMs, headers: { 'user-agent': 'BeforeIDeploy-monitor/11' } }, (res) => {
      res.resume();
      // some hosts refuse HEAD — a GET decides before anything is reported
      if (method === 'HEAD' && [405, 501].includes(res.statusCode)) return probe(url, timeoutMs, 'GET').then(resolve);
      resolve({ ok: res.statusCode < 400, status: res.statusCode, ms: Date.now() - t0 });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout', ms: Date.now() - t0 });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.code || e.message, ms: Date.now() - t0 }));
    req.end();
  });
}

/** One probe, then one retry after a short pause when it failed — bounded, never a loop. */
async function probeWithRetry(url, timeoutMs) {
  const first = await probe(url, timeoutMs);
  if (first.ok) return { ...first, attempts: 1 };
  await new Promise((r) => setTimeout(r, 1500));
  const second = await probe(url, timeoutMs);
  return { ...second, attempts: 2, firstError: first.error || first.status };
}

function sslDays(host, timeoutMs) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: host, timeout: timeoutMs, rejectUnauthorized: false }, () => {
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

// ---------------------------------------------------------------- incidents

function readIncidents() {
  try {
    return fs
      .readFileSync(INCIDENTS_FILE(), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function writeIncidents(list) {
  ensureDir(APP_DIR);
  fs.writeFileSync(INCIDENTS_FILE(), list.slice(-2000).map((i) => JSON.stringify(i)).join('\n') + (list.length ? '\n' : ''));
}

/** Open incidents keyed by project + kind: the same problem is one incident until it recovers. */
function openIncident(list, key, kind) {
  return list.find((i) => i.project === key && i.kind === kind && i.status === 'open');
}

function normalizeMaintenance(list) {
  if (!Array.isArray(list)) throw new EngineError(msg('monitor.maintenance.invalid'), 'usage', 2);
  return list.map((w) => {
    const from = Date.parse(w?.from);
    const to = Date.parse(w?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 7 * 86400_000) throw new EngineError(msg('monitor.maintenance.invalid'), 'usage', 2);
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), project: w.project || null, note: w.note ? String(w.note).slice(0, 120) : null };
  });
}

/** Windows that cover `now` (expired ones are dropped on the next settings write). */
export function activeMaintenance(settings, key, now = new Date()) {
  const t0 = now.getTime();
  return (settings.maintenance || []).filter((w) => (!w.project || w.project === key) && Date.parse(w.from) <= t0 && t0 < Date.parse(w.to));
}

export async function maintenanceCommand(sub, flags) {
  const settings = monitorSettings();
  if (sub === 'add') {
    const w = { from: flags.from, to: flags.to, project: flags.project && flags.project !== true ? String(flags.project) : null, note: flags.note && flags.note !== true ? String(flags.note) : null };
    return (await setMonitorSettings({ maintenance: [...settings.maintenance, w] })).maintenance;
  }
  if (sub === 'clear') return (await setMonitorSettings({ maintenance: [] })).maintenance;
  return settings.maintenance;
}

/** External channels that are configured right now: { webhook: url|null, pushover: bool }. */
function activeChannels(settings) {
  return { webhook: settings.channels.webhook || null, pushover: pushoverStatus().connected };
}

/** Delivers one notification to every configured channel; one { channel, ok, status } per channel, never throws. */
async function deliver(settings, kind, event, extra) {
  const ch = activeChannels(settings);
  const out = [];
  if (ch.webhook) {
    const r = await postWebhook(ch.webhook, webhookPayload(kind, event, extra));
    out.push({ channel: 'webhook', ...r });
  }
  if (ch.pushover) {
    const payload = webhookPayload(kind, event, extra);
    const title = event?.projectName || event?.project ? `Before I Deploy · ${event.projectName || event.project}` : 'Before I Deploy';
    const r = await sendPushover({ title, message: payload.text, priority: kind === 'incident' ? 1 : 0, url: event?.url || null, urlTitle: event?.url ? t('monitor.pushover.openSite') : null });
    out.push({ channel: 'pushover', ...r });
  }
  return out;
}

/** Sends a test notification to every configured channel and reports what each receiver answered. */
export async function notifyTest() {
  const settings = monitorSettings();
  const ch = activeChannels(settings);
  if (!ch.webhook && !ch.pushover) throw new EngineError(msg('monitor.notify.none'), 'not_configured');
  const results = await deliver(settings, 'test', { project: null, projectName: null }, {});
  const webhook = results.find((r) => r.channel === 'webhook') || null;
  const pushover = results.find((r) => r.channel === 'pushover') || null;
  const first = webhook || pushover;
  return { ok: results.every((r) => r.ok), url: ch.webhook, status: first.status, error: first.error || null, channels: results, webhook, pushover };
}

function inQuietHours(settings, now = new Date()) {
  const q = settings.quietHours;
  if (!q || !Number.isFinite(q.from) || !Number.isFinite(q.to)) return false;
  const h = now.getHours();
  return q.from < q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
}

const SEVERITY = { down: 'critical', ssl: 'warning', domain: 'warning' };

// ---------------------------------------------------------------- one pass

/**
 * Runs one monitoring pass. Returns { at, checked, samples, events: [{ project, kind, type: new|ongoing|recovered }] }.
 * Never runs project checks or builds — only network probes.
 */
export async function monitorOnce({ project = null, now = new Date() } = {}) {
  const settings = monitorSettings();
  const state = readJSON(STATE_FILE(), { projects: {} }) || { projects: {} };
  state.projects = state.projects || {};
  const incidents = readIncidents();
  const events = [];
  const today = now.toISOString().slice(0, 10);
  const quiet = inQuietHours(settings, now);

  const projects = listProjects().filter((p) => !project || p.key === project);
  const samples = [];
  for (const p of projects) {
    const st = getState(p.key);
    const live = p.liveUrl || p.netlify?.liveUrl || st.lastProd?.url || null;
    const prev = state.projects[p.key] || { failures: 0 };
    const sample = { key: p.key, name: p.name, url: live, at: nowISO(), uptime: null, sslDays: prev.sslDays ?? null, sslCheckedAt: prev.sslCheckedAt || null };
    if (!live) {
      sample.uptime = { state: 'unsupported', reason: 'no_live_url' };
      state.projects[p.key] = { ...prev, ...sample, failures: 0 };
      samples.push(sample);
      continue;
    }
    const maintenance = activeMaintenance(settings, p.key, now);
    if (maintenance.length) {
      sample.uptime = { state: 'unchecked', reason: 'maintenance', until: maintenance[0].to };
      sample.maintenance = true;
      state.projects[p.key] = { ...prev, ...sample };
      samples.push(sample);
      continue;
    }
    const r = await probeWithRetry(live, settings.timeoutMs);
    sample.uptime = { ...r, state: r.ok ? 'healthy' : 'problem' };
    const failures = r.ok ? 0 : (prev.failures || 0) + 1;
    const confirmed = failures >= settings.confirmFailures;
    const open = openIncident(incidents, p.key, 'down');
    if (confirmed && !open) {
      incidents.push({ id: crypto.randomBytes(4).toString('hex'), project: p.key, projectName: p.name, kind: 'down', severity: SEVERITY.down, status: 'open', openedAt: nowISO(), lastSeenAt: nowISO(), count: 1, detail: r.error || `http ${r.status}`, url: live });
      events.push({ project: p.key, kind: 'down', type: 'new' });
      if (settings.notify.down && !quiet) ev.notify(`❌ ${p.name}`, t('monitor.notify.down', { reason: r.error || `HTTP ${r.status}` }), live);
    } else if (confirmed && open) {
      open.lastSeenAt = nowISO();
      open.count++;
      open.detail = r.error || `http ${r.status}`;
      events.push({ project: p.key, kind: 'down', type: 'ongoing' });
    } else if (r.ok && open) {
      open.status = 'resolved';
      open.resolvedAt = nowISO();
      events.push({ project: p.key, kind: 'down', type: 'recovered' });
      if (settings.notify.recovered && !quiet) ev.notify(`✅ ${p.name}`, t('monitor.notify.recovered'), live);
    }
    sample.failures = failures;
    sample.confirmed = confirmed;

    // SSL: once a day per host (a cert does not change by the minute)
    let host = null;
    try {
      host = new URL(live).protocol === 'https:' ? new URL(live).hostname : null;
    } catch {}
    if (host && prev.sslCheckedAt?.slice(0, 10) !== today) {
      sample.sslDays = await sslDays(host, settings.timeoutMs);
      sample.sslCheckedAt = nowISO();
      const sslOpen = openIncident(incidents, p.key, 'ssl');
      if (sample.sslDays !== null && sample.sslDays < 14) {
        if (!sslOpen) {
          incidents.push({ id: crypto.randomBytes(4).toString('hex'), project: p.key, projectName: p.name, kind: 'ssl', severity: sample.sslDays < 0 ? 'critical' : SEVERITY.ssl, status: 'open', openedAt: nowISO(), lastSeenAt: nowISO(), count: 1, detail: `${sample.sslDays}d`, url: live });
          events.push({ project: p.key, kind: 'ssl', type: 'new' });
          if (settings.notify.ssl && !quiet) ev.notify(`🔒 ${p.name}`, t(sample.sslDays < 0 ? 'monitor.notify.sslExpired' : 'monitor.notify.sslExpiring', { days: Math.abs(sample.sslDays) }), live);
        } else {
          sslOpen.lastSeenAt = nowISO();
          sslOpen.count++;
          sslOpen.detail = `${sample.sslDays}d`;
          events.push({ project: p.key, kind: 'ssl', type: 'ongoing' });
        }
      } else if (sslOpen && sample.sslDays !== null) {
        sslOpen.status = 'resolved';
        sslOpen.resolvedAt = nowISO();
        events.push({ project: p.key, kind: 'ssl', type: 'recovered' });
      }
    }
    state.projects[p.key] = { ...prev, ...sample };
    samples.push(sample);
  }

  // domains: once a day, only when a registrar is connected
  if (!project && state.domainsCheckedAt?.slice(0, 10) !== today) {
    try {
      const d = await spaceshipDomains();
      state.domainsCheckedAt = nowISO();
      state.domains = { connected: !!d.connected, count: d.domains?.length || 0 };
      for (const dom of d.domains || []) {
        const open = openIncident(incidents, `domain:${dom.name}`, 'domain');
        if (dom.daysLeft != null && dom.daysLeft < 30) {
          if (!open) {
            incidents.push({ id: crypto.randomBytes(4).toString('hex'), project: `domain:${dom.name}`, projectName: dom.name, kind: 'domain', severity: dom.daysLeft < 7 ? 'critical' : SEVERITY.domain, status: 'open', openedAt: nowISO(), lastSeenAt: nowISO(), count: 1, detail: `${dom.daysLeft}d`, url: null });
            events.push({ project: `domain:${dom.name}`, kind: 'domain', type: 'new' });
            if (settings.notify.domain && !quiet) ev.notify(`🌐 ${dom.name}`, t('monitor.notify.domain', { days: dom.daysLeft }), null);
          } else {
            open.lastSeenAt = nowISO();
            open.count++;
          }
        } else if (open) {
          open.status = 'resolved';
          open.resolvedAt = nowISO();
          events.push({ project: `domain:${dom.name}`, kind: 'domain', type: 'recovered' });
        }
      }
    } catch {
      state.domains = { connected: false, error: true };
    }
  }

  state.lastRunAt = nowISO();
  state.lastRunBy = process.env.BID_CLIENT === 'app' ? 'app' : process.env.BID_MONITOR_AGENT ? 'agent' : 'cli';
  writeJSON(STATE_FILE(), state);
  writeIncidents(incidents);
  // the one external channel: confirmed problems and recoveries, never "ongoing" repeats, never in quiet hours
  const delivered = [];
  const channels = activeChannels(settings);
  if ((channels.webhook || channels.pushover) && !quiet) {
    for (const e of events.filter((x) => x.type === 'new' || x.type === 'recovered')) {
      if (e.type === 'new' && settings.notify[e.kind] === false) continue;
      if (e.type === 'recovered' && settings.notify.recovered === false) continue;
      const inc = incidents.filter((i) => i.project === e.project && i.kind === e.kind).slice(-1)[0];
      const results = await deliver(settings, e.type === 'new' ? 'incident' : 'recovered', { project: e.project, projectName: inc?.projectName || null, kind: e.kind, detail: inc?.detail || null, url: inc?.url || null }, { project: inc?.projectName || e.project, kind: e.kind });
      for (const r of results) delivered.push({ ...e, ...r });
    }
  }
  return { at: state.lastRunAt, checked: samples.length, samples, events, quiet, delivered };
}

// ---------------------------------------------------------------- status / incidents

export function monitorStatus() {
  const settings = monitorSettings();
  const state = readJSON(STATE_FILE(), { projects: {} }) || { projects: {} };
  const incidents = readIncidents();
  const agent = agentStatus();
  return {
    runsOn: 'mac',
    serverSide: false,
    cloud: null,
    maintenance: settings.maintenance,
    channels: { webhook: settings.channels.webhook ? redactUrl(settings.channels.webhook) : null, pushover: pushoverStatus() },
    settings,
    agent,
    lastRunAt: state.lastRunAt || null,
    lastRunBy: state.lastRunBy || null,
    stale: !state.lastRunAt || Date.now() - Date.parse(state.lastRunAt) > settings.intervalMin * 60000 * 3,
    projects: state.projects || {},
    domains: state.domains || null,
    openIncidents: incidents.filter((i) => i.status === 'open').sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    recentIncidents: incidents.filter((i) => i.status !== 'open').slice(-20).reverse(),
  };
}

function redactUrl(u) {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host}${x.pathname.length > 1 ? '/…' : ''}`;
  } catch {
    return null;
  }
}

/**
 * Local status merged with the cloud's (V11 RC). `runsOn` says where checks really run: 'mac' (app timer /
 * launchd agent), 'cloud' (scheduler heartbeat present and targets registered), 'both', or 'mac' with
 * `cloud.unavailable` when the account is signed out or offline. Cloud incidents are merged and deduplicated
 * with the local ones by project + kind; the source of every incident is kept.
 */
export async function monitorStatusMerged({ cloud = true } = {}) {
  const local = monitorStatus();
  if (!cloud) return local;
  const c = await cloudStatusOrNull();
  if (!c || c.unavailable) return { ...local, cloud: c ? { unavailable: true, reason: c.reason } : null };
  const cloudActive = !!c.active;
  const keyOf = (i) => `${i.projectKey || i.project}:${i.kind}`;
  const seen = new Set(local.openIncidents.map(keyOf));
  const cloudOpen = (c.openIncidents || []).map((i) => ({ id: i.id, project: i.projectKey, projectName: findProjectName(i.projectKey), kind: i.kind, severity: i.severity, status: i.status, openedAt: i.openedAt, lastSeenAt: i.lastSeenAt, resolvedAt: i.resolvedAt, count: i.count, detail: i.detail, url: i.url, source: 'cloud' }));
  const merged = [...local.openIncidents.map((i) => ({ ...i, source: i.source || 'mac', alsoCloud: cloudOpen.some((x) => keyOf(x) === keyOf(i)) })), ...cloudOpen.filter((i) => !seen.has(keyOf(i)))];
  const targets = (c.targets || []).map((x) => ({ ...x, projectName: findProjectName(x.projectKey) }));
  return {
    ...local,
    runsOn: cloudActive ? (local.agent.installed || local.lastRunAt ? 'both' : 'cloud') : 'mac',
    serverSide: cloudActive,
    cloud: { active: cloudActive, scheduler: c.scheduler, targets, limits: c.limits, retentionDays: c.limits?.retentionDays ?? null, nextRunAt: targets.map((x) => x.nextRunAt).filter(Boolean).sort()[0] || null },
    openIncidents: merged.sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt))),
  };
}

function findProjectName(key) {
  return listProjects().find((p) => p.key === key)?.name || key;
}

export function listIncidents({ limit = 100, project = null } = {}) {
  return readIncidents()
    .filter((i) => !project || i.project === project)
    .slice(-limit)
    .reverse();
}

// ---------------------------------------------------------------- launchd agent (with consent)

export function agentStatus() {
  const plist = AGENT_PLIST();
  const installed = fs.existsSync(plist);
  return { installed, plist, label: AGENT_LABEL, note: t('monitor.agent.note') };
}

export function agentInstall({ yes = false } = {}) {
  if (!yes) throw new EngineError(msg('monitor.agent.confirm'), 'confirm_required', 2);
  if (process.platform !== 'darwin') throw new EngineError(msg('monitor.agent.macOnly'), 'unsupported');
  const settings = monitorSettings();
  const bid = path.join(ENGINE_DIR, 'bid');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>${bid}</string><string>monitor</string><string>once</string></array>
  <key>EnvironmentVariables</key><dict><key>BID_MONITOR_AGENT</key><string>1</string></dict>
  <key>StartInterval</key><integer>${settings.intervalMin * 60}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${path.join(APP_DIR, 'monitor-agent.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(APP_DIR, 'monitor-agent.log')}</string>
</dict></plist>
`;
  ensureDir(path.dirname(AGENT_PLIST()));
  fs.writeFileSync(AGENT_PLIST(), xml);
  return { ...agentStatus(), loaded: loadAgent(true) };
}

export function agentRemove() {
  const plist = AGENT_PLIST();
  if (fs.existsSync(plist)) {
    loadAgent(false);
    fs.unlinkSync(plist);
  }
  return agentStatus();
}

function loadAgent(load) {
  try {
    const r = spawnSync('launchctl', [load ? 'load' : 'unload', '-w', AGENT_PLIST()], { encoding: 'utf8', timeout: 15000 });
    return r.status === 0;
  } catch {
    return false;
  }
}
