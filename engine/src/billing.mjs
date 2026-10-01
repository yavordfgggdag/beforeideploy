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
import path from 'node:path';
import fs from 'node:fs';
import { offlineCatalog } from './plans-catalog.mjs';
import { billingDemo } from './billing-demo.mjs';
import { APP_DIR, readJSON, EngineError, fetchT, throwIfRateLimited } from './util.mjs';
import { cloudConfig, currentSession } from './account.mjs';
import { msg } from './i18n.mjs';

export const BILLING_ACTIONS = ['catalog', 'status', 'checkout', 'trial', 'portal', 'usage', 'sync', 'confirm-change'];

const CODE_KEYS = {
  not_available: 'billing.notAvailable',
  trial_used: 'billing.trialUsed',
  no_subscription: 'billing.noSubscription',
  billing_conflict: 'billing.conflict',
  preview_expired: 'billing.previewExpired',
  not_configured: 'billing.notConfigured',
  provider_error: 'billing.providerError',
};

async function billingCall(action, params = {}) {
  const c = cloudConfig();
  if (!c) throw new EngineError(msg('account.cloud.notConfigured'), 'not_configured', 7);
  const s = await currentSession();
  if (!s && action !== 'catalog') throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  let res;
  try {
    res = await fetchT(`${c.url}/functions/v1/billing`, {
      method: 'POST',
      headers: { apikey: c.anonKey, ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
    });
  } catch (e) {
    throw new EngineError(msg('account.network', { error: e.message }), 'network');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 404 && data?.code === 'NOT_FOUND') throw new EngineError(msg('cloud.functionMissing', { name: 'billing' }), 'cloud_function_missing');
  throwIfRateLimited(res, data);
  if (res.status === 401) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  if (!res.ok) {
    const key = CODE_KEYS[data?.code];
    if (key) throw new EngineError(msg(key), 'billing_failed');
    throw new EngineError(msg('billing.failed', { status: res.status, detail: data?.error || '' }), 'billing_failed');
  }
  return data;
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
    const cache = path.join(APP_DIR, 'usage-report.json');
    try {
      const report = await billingCall('usage', { v: 2 });
      fs.mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
      const temporary = `${cache}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ userId: session.user?.id, report }), { mode: 0o600 });
      fs.renameSync(temporary, cache);
      return report;
    } catch (error) {
      const saved = readJSON(cache, null);
      if (error.code === 'network' && session.user?.id && saved?.userId === session.user.id) return { ...saved.report, stale: true, source: 'cache' };
      throw error;
    }
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
  return billingCall(action);
}
