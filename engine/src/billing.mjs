// Plans, credits and the Paddle checkout (V10 WP4). Every call goes to the `billing` Edge Function with the
// user's session; the function holds the Paddle keys and the catalog. Nothing here touches card data —
// checkout and the customer portal are Paddle pages opened in the browser.
//
//   bid billing catalog                      plans (price, tokens), packs, trial offer
//   bid billing status                       plan, subscription, balances (plan / top-up), recent usage
//   bid billing checkout --plan high [--yearly] → { url } (hosted Paddle checkout)
//   bid billing checkout --pack pack-500k    → { url }
//   bid billing trial                        starts the one-time trial
//   bid billing portal                       → { url } (change card, cancel, invoices)
//   bid billing usage                        plan & usage, contract v3 (release, guards, carried, bonus, packs)
//   bid billing estimate --credits N [--usage-action ai.fix] → { readyAt, reason } (when N credits can start)
//   bid billing bonus                        claims the one-time starter bonus
import path from 'node:path';
import fs from 'node:fs';
import { offlineCatalog } from './plans-catalog.mjs';
import { billingDemo } from './billing-demo.mjs';
import { APP_DIR, readJSON, EngineError, fetchT, throwIfRateLimited } from './util.mjs';
import { cloudConfig, currentSession } from './account.mjs';
import { msg } from './i18n.mjs';

export const BILLING_ACTIONS = ['catalog', 'status', 'checkout', 'trial', 'portal', 'usage', 'sync', 'confirm-change', 'sites', 'site_activate', 'site_pause', 'estimate', 'meter', 'boost', 'nudge_ack', 'domain_request', 'audit_run', 'report_history', 'bonus'];
/** The usage contract this engine reads (v3 = credit model V3; a superset of v2). */
export const USAGE_VERSION = 3;

const CODE_KEYS = {
  not_available: 'billing.notAvailable',
  trial_used: 'billing.trialUsed',
  no_subscription: 'billing.noSubscription',
  billing_conflict: 'billing.conflict',
  billing_interval_change: 'billing.intervalChange',
  preview_expired: 'billing.previewExpired',
  not_configured: 'billing.notConfigured',
  provider_error: 'billing.providerError',
};

export async function billingCall(action, params = {}, { session, etag, receipt = false } = {}) {
  const c = cloudConfig();
  if (!c) throw new EngineError(msg('account.cloud.notConfigured'), 'not_configured', 7);
  const s = session ?? await currentSession();
  if (!s && action !== 'catalog') throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  let res;
  try {
    res = await fetchT(`${c.url}/functions/v1/billing`, {
      method: 'POST',
      headers: { apikey: c.anonKey, ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}), 'Content-Type': 'application/json', ...(etag ? { 'If-None-Match': etag } : {}) },
      body: JSON.stringify({ action, ...params }),
    });
  } catch (e) {
    throw new EngineError(msg('account.network', { error: e.message }), 'network');
  }
  if (res.status === 304 && etag) return { notModified: true, etag };
  const data = await res.json().catch(() => null);
  if (res.status === 404 && data?.code === 'NOT_FOUND') throw new EngineError(msg('cloud.functionMissing', { name: 'billing' }), 'cloud_function_missing');
  throwIfRateLimited(res, data);
  if (res.status === 401) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  if (!res.ok) {
    const meterKeys = { quota_exhausted: 'billing.creditLimit', window_5h: 'billing.windowLimit', window_week: 'billing.windowLimit', credits_release: 'billing.creditsWait', guard_24h: 'billing.creditsWait', guard_7d: 'billing.creditsWait', pack_rate: 'billing.creditsWait', bonus_used: 'billing.bonusUsed', site_paused: 'billing.sitePaused', site_limit: 'billing.siteLimit', boost_used: 'billing.boostUsed', boost_unavailable: 'billing.boostUnavailable', meter_unavailable: 'billing.meterUnavailable', domain_wait: 'billing.domainWait', domain_used: 'billing.domainUsed', domain_unavailable: 'billing.domainUnavailable', invalid_domain: 'billing.invalidDomain', hosting_not_ready: 'billing.hostingNotReady' };
    if (meterKeys[data?.code]) throw Object.assign(new EngineError(msg(meterKeys[data.code], { at: data.readyAt ? new Date(data.readyAt).toLocaleString() : '—' }), data.code), { resetsAt: data.resetsAt ?? data.readyAt, readyAt: data.readyAt });
    const key = CODE_KEYS[data?.code];
    if (key) throw new EngineError(msg(key), 'billing_failed');
    throw Object.assign(new EngineError(msg('billing.failed', { status: res.status, detail: data?.error || '' }), 'billing_failed'), { status: res.status });
  }
  return receipt ? { report: data, etag: res.headers.get('etag') } : data;
}

export async function billingCommand(sub, flags) {
  const action = sub || 'status';
  if (!BILLING_ACTIONS.includes(action)) throw new EngineError(msg('cli.unknownCommand', { command: `billing ${action}` }), 'usage', 2);
  const demo = process.env.BID_BILLING_DEMO === '1' || flags.demo;
  if (demo) {
    if (['catalog', 'usage', 'status'].includes(action)) return billingDemo(action);
    throw new EngineError(msg('billing.demoReadOnly'), 'demo_read_only', 2);
  }
  if (action === 'catalog') {
    try { return await billingCall('catalog'); }
    catch (error) {
      if (['not_configured','not_logged_in','cloud_function_missing','network'].includes(error.code)) return offlineCatalog(error.code);
      throw error;
    }
  }
  if (action === 'usage') {
    const session = await currentSession();
    if (!session) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
    const origin = cloudConfig()?.url;
    const cache = path.join(APP_DIR, 'usage-report.json');
    try {
      const saved = readJSON(cache, null);
      const own = saved?.userId === session.user?.id && saved?.cloudUrl === cloudConfig()?.url && saved?.report?.v === USAGE_VERSION ? saved : null;
      const reply = await billingCall('usage', { v: USAGE_VERSION }, { session, etag: own?.etag, receipt: true });
      const report = reply.notModified ? { ...own.report, stale: false, source: 'cloud', serverTime: new Date().toISOString() } : reply.report;
      // Logout/account switches during a slow request must not repopulate the old account's cache.
      if ((await currentSession())?.user?.id !== session.user?.id || cloudConfig()?.url !== origin) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
      fs.mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
      const temporary = `${cache}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ userId: session.user?.id, cloudUrl: cloudConfig()?.url, etag: reply.etag, report }), { mode: 0o600 });
      fs.renameSync(temporary, cache);
      return report;
    } catch (error) {
      if ((await currentSession())?.user?.id !== session.user?.id || cloudConfig()?.url !== origin) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
      const saved = readJSON(cache, null);
      if (error.code === 'network' && session.user?.id && saved?.userId === session.user.id && saved?.cloudUrl === cloudConfig()?.url) return { ...saved.report, stale: true, source: 'cache' };
      throw error;
    }
  }
  if (action === 'audit_run') {
    const { randomUUID } = await import('node:crypto');
    if (typeof flags.project !== 'string') throw new EngineError(msg('billing.checkoutArgs'), 'usage', 2);
    return billingCall(action, {projectKey:flags.project,operationId:typeof flags['operation-id'] === 'string' ? flags['operation-id'] : randomUUID()});
  }
  if (action === 'confirm-change') {
    if (typeof flags['preview-id'] !== 'string') throw new EngineError(msg('billing.checkoutArgs'), 'usage', 2);
    return billingCall(action, { previewId: flags['preview-id'] });
  }
  if (action === 'checkout') {
    const plan = flags.plan && flags.plan !== true ? String(flags.plan) : null;
    const pack = flags.pack && flags.pack !== true ? String(flags.pack) : null;
    if (!plan === !pack) throw new EngineError(msg('billing.checkoutArgs'), 'usage', 2);
    return billingCall('checkout', plan ? { plan, ...(flags.yearly ? { interval: 'year' } : {}) } : { pack });
  }
  const params = {};
  if (flags.credits != null) {
    const credits = Number(flags.credits);
    if (!Number.isSafeInteger(credits) || credits < 0) throw new EngineError(msg('billing.checkoutArgs'), 'usage', 2);
    params.credits = credits;
  }
  for (const [flag, field] of Object.entries({ project: 'projectKey', 'site-id': 'siteId', 'hosting-owner': 'hostingOwner', 'usage-action': 'usageAction', 'operation-id': 'operationId', kind: 'kind', 'period-ref': 'periodRef', threshold: 'threshold', domain: 'domain' })) {
    if (flags[flag] != null) {
      if (typeof flags[flag] !== 'string') throw new EngineError(msg('billing.checkoutArgs'), 'usage', 2);
      params[field] = flags[flag];
    }
  }
  return billingCall(action, params);
}
