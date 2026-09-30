// Pushover notifications (V11.1): the second external channel next to the webhook. The user pastes their
// Pushover *user key* and an *application token* (created at pushover.net/apps/build); both are verified
// against Pushover's validate endpoint and stored only in the macOS Keychain (secrets.mjs) — never in a
// file, never in argv (the app passes them through the environment).
//
//   bid monitor pushover connect        env BID_PUSHOVER_USER + BID_PUSHOVER_TOKEN
//   bid monitor pushover disconnect
//   bid monitor pushover status
//
// Delivery: sendPushover() never throws for a channel problem — the monitor pass records { ok, status }.
import { EngineError, nowISO } from './util.mjs';
import { getSecret, setSecret, deleteSecret } from './secrets.mjs';
import { msg } from './i18n.mjs';
import { testEndpoint } from './isolation.mjs';

const ACCOUNT = 'pushover';
const API = 'https://api.pushover.net/1';

/** Pushover's real API, or the test receiver when the explicit test switch is on (never in production). */
function apiBase() {
  return testEndpoint('BID_TEST_PUSHOVER_URL') || API;
}

/** `uQiRzpo4…` → `uQiR…` — enough to recognise the key, never enough to use it. */
export function maskKey(key) {
  const s = String(key || '');
  return s.length > 6 ? `${s.slice(0, 4)}…` : '…';
}

async function post(pathname, form, { timeoutMs = 8000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase()}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'BeforeIDeploy-Monitor/1' },
      body: new URLSearchParams(form).toString(),
      signal: ctl.signal,
      redirect: 'manual',
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { ok: res.status >= 200 && res.status < 300 && data?.status === 1, status: res.status, data };
  } catch (e) {
    return { ok: false, status: null, error: e.name === 'AbortError' ? 'timeout' : e.message, data: null };
  } finally {
    clearTimeout(timer);
  }
}

const errorText = (r) => (Array.isArray(r.data?.errors) && r.data.errors.length ? r.data.errors.join('; ') : r.error || `HTTP ${r.status}`);

/** Verifies the pair with Pushover (users/validate) and stores it in the Keychain only when it is accepted. */
export async function pushoverConnect({ user, token } = {}) {
  user = String(user || process.env.BID_PUSHOVER_USER || '').trim();
  token = String(token || process.env.BID_PUSHOVER_TOKEN || '').trim();
  if (!user || !token) throw new EngineError(msg('monitor.pushover.missingKeys'), 'usage', 2);
  if (!/^[A-Za-z0-9]{30}$/.test(user) || !/^[A-Za-z0-9]{30}$/.test(token)) throw new EngineError(msg('monitor.pushover.rejected', { reason: 'format' }), 'pushover_rejected', 2);
  const r = await post('/users/validate.json', { token, user });
  if (!r.ok) throw new EngineError(msg('monitor.pushover.rejected', { reason: errorText(r) }), 'pushover_rejected', 2);
  setSecret(ACCOUNT, { user, token, savedAt: nowISO() });
  return pushoverStatus();
}

export function pushoverDisconnect() {
  deleteSecret(ACCOUNT);
  return pushoverStatus();
}

/** { connected, user (masked), savedAt } — safe to show and to log. */
export function pushoverStatus() {
  const c = getSecret(ACCOUNT);
  const connected = !!(c?.user && c?.token);
  return { connected, user: connected ? maskKey(c.user) : null, savedAt: connected ? c.savedAt || null : null };
}

/**
 * Sends one message; { ok, status, error? }. Priority: 0 normal (test, recovery), 1 high (a confirmed
 * incident — shown even in the device's quiet hours; ours are applied before this is called).
 */
export async function sendPushover({ title, message, priority = 0, url = null, urlTitle = null }) {
  const c = getSecret(ACCOUNT);
  if (!c?.user || !c?.token) return { ok: false, status: null, error: 'not_connected' };
  const form = { token: c.token, user: c.user, title: String(title || 'Before I Deploy').slice(0, 250), message: String(message || '').slice(0, 1024), priority: String(priority) };
  if (url) {
    form.url = String(url).slice(0, 512);
    if (urlTitle) form.url_title = String(urlTitle).slice(0, 100);
  }
  const r = await post('/messages.json', form);
  return r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, error: errorText(r) };
}
