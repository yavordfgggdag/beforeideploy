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
import { EngineError } from './util.mjs';
import { cloudConfig, currentSession } from './account.mjs';
import { msg } from './i18n.mjs';

export const BILLING_ACTIONS = ['catalog', 'status', 'checkout', 'trial', 'portal', 'usage', 'sync'];

const CODE_KEYS = {
  not_available: 'billing.notAvailable',
  trial_used: 'billing.trialUsed',
  no_subscription: 'billing.noSubscription',
  not_configured: 'billing.notConfigured',
  provider_error: 'billing.providerError',
};

async function billingCall(action, params = {}) {
  const c = cloudConfig();
  if (!c) throw new EngineError(msg('account.cloud.notConfigured'), 'not_configured', 7);
  const s = await currentSession();
  if (!s) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  let res;
  try {
    res = await fetch(`${c.url}/functions/v1/billing`, {
      method: 'POST',
      headers: { apikey: c.anonKey, Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
    });
  } catch (e) {
    throw new EngineError(msg('account.network', { error: e.message }), 'network');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 404 && data?.code === 'NOT_FOUND') throw new EngineError(msg('cloud.functionMissing', { name: 'billing' }), 'cloud_function_missing');
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
  if (action === 'checkout') {
    const plan = flags.plan && flags.plan !== true ? String(flags.plan) : null;
    const pack = flags.pack && flags.pack !== true ? String(flags.pack) : null;
    if (!plan === !pack) throw new EngineError(msg('billing.checkoutArgs'), 'usage', 2);
    return billingCall('checkout', plan ? { plan, ...(flags.yearly ? { interval: 'year' } : {}) } : { pack });
  }
  return billingCall(action);
}
