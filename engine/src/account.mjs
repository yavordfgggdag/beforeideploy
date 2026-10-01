// Account — Supabase Auth (email/password + GitHub), session in Keychain, project metadata sync.
// Service tokens (Netlify, Vercel, …) NEVER leave the Mac; only project metadata is synced.
import { testEndpoint, isProductionBundle } from './isolation.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_DIR, ENGINE_DIR, EngineError, readJSON, writeJSON, nowISO, ensureDir, fetchT, throwIfRateLimited } from './util.mjs';
import { getSecret, setSecret, deleteSecret } from './secrets.mjs';
import { listProjects } from './store.mjs';
import { msg, currentLang } from './i18n.mjs';
import { features, AI_KEY_PROVIDERS } from './features.mjs';

const SUPABASE_URL = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i;
const USER_CONFIG = () => path.join(APP_DIR, 'cloud.json');
const PROFILE_CACHE = () => path.join(APP_DIR, 'profile.json'); // last profile seen — used offline; no secrets
const BUNDLED_CONFIG = () => path.join(ENGINE_DIR, 'cloud.json');

export function cloudConfig() {
  const c = readJSON(USER_CONFIG(), null) || (process.env.BID_NO_BUNDLED_CLOUD ? null : readJSON(BUNDLED_CONFIG(), null));
  // an environment override must still be a Supabase project; anything else only in the test suite (WP01)
  const envUrl = process.env.BID_SUPABASE_URL;
  if (envUrl && process.env.BID_SUPABASE_ANON_KEY && (SUPABASE_URL.test(envUrl) || testEndpoint('BID_SUPABASE_URL'))) return { url: envUrl.replace(/\/$/, ''), anonKey: process.env.BID_SUPABASE_ANON_KEY };
  if (!c?.url || !c?.anonKey) return null;
  return { url: c.url.replace(/\/$/, ''), anonKey: c.anonKey };
}

export function setCloudConfig({ url, anonKey }) {
  if (!url || !anonKey || url === true || anonKey === true) throw new EngineError(msg('account.cloud.missingArgs'), 'usage', 2);
  // a local Supabase (127.0.0.1) is for development only — never accepted by the engine inside the app
  if (!SUPABASE_URL.test(url.trim()) && !(/^http:\/\/127\.0\.0\.1(:\d+)?\/?$/.test(url.trim()) && !isProductionBundle())) {
    throw new EngineError(msg('account.cloud.badUrl'), 'usage', 2);
  }
  writeJSON(USER_CONFIG(), { url: url.trim().replace(/\/$/, ''), anonKey: anonKey.trim(), savedAt: nowISO() });
  return { configured: true };
}

function cfg() {
  const c = cloudConfig();
  if (!c) throw new EngineError(msg('account.cloud.notConfigured'), 'not_configured', 7);
  return c;
}

async function auth(p, { method = 'POST', body, token } = {}) {
  const c = cfg();
  let res;
  try {
    res = await fetchT(`${c.url}/auth/v1${p}`, {
      method,
      // New Supabase keys (sb_publishable_…) are not JWTs — only send Authorization with a real user token
      headers: {
        apikey: c.anonKey,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : c.anonKey.startsWith('eyJ') ? { Authorization: `Bearer ${c.anonKey}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new EngineError(msg('account.network', { error: e.message }), 'network');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const raw = data?.error_description || data?.msg || data?.message || data?.error || `HTTP ${res.status}`;
    // an unconfirmed address gets its own code: the app offers to send the confirmation again
    if (/email not confirmed/i.test(String(raw))) throw Object.assign(new EngineError(translate(raw), 'email_not_confirmed'), { status: res.status });
    throw Object.assign(new EngineError(translate(raw), 'auth_error'), { status: res.status });
  }
  return data;
}

/** PostgREST call with the user's token; returns parsed JSON (null on 204). */
export async function rest(p, { method = 'GET', body, token, headers = {} } = {}) {
  const c = cfg();
  let res;
  try {
    res = await fetchT(`${c.url}/rest/v1${p}`, {
      method,
      headers: { apikey: c.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new EngineError(msg('account.network', { error: e.message }), 'network');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) throw Object.assign(new EngineError(msg('account.rest.http', { status: res.status, detail: data?.message || data?.hint || '' }), res.status === 401 ? 'not_logged_in' : 'rest_failed', res.status === 401 ? 5 : 1), { status: res.status });
  return data;
}

function translate(raw) {
  const m = String(raw);
  if (/invalid login credentials/i.test(m)) return msg('account.auth.invalidCredentials');
  if (/email not confirmed/i.test(m)) return msg('account.auth.emailNotConfirmed');
  if (/user already registered/i.test(m)) return msg('account.auth.alreadyRegistered');
  if (/password should be at least/i.test(m)) return msg('account.weakPassword');
  if (/rate limit/i.test(m)) return msg('account.auth.rateLimited');
  if (/unable to validate email/i.test(m)) return msg('account.auth.invalidEmail');
  return m;
}

function saveSession(s) {
  if (!s?.access_token) return null;
  const session = {
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    expiresAt: s.expires_at ? s.expires_at * 1000 : Date.now() + (s.expires_in || 3600) * 1000,
    user: s.user ? { id: s.user.id, email: s.user.email, name: s.user.user_metadata?.full_name || s.user.user_metadata?.name || null, avatar: s.user.user_metadata?.avatar_url || null, provider: s.user.app_metadata?.provider || 'email' } : null,
  };
  setSecret('session', session);
  return session;
}

// ---------------------------------------------------------------- profile (role, plan, credits)

const DEFAULT_PROFILE = { role: 'normal', plan: 'free', locale: null, aiDisabled: false, credits: { balance: 0 } };

function hasOwnAiKey() {
  return AI_KEY_PROVIDERS.some((p) => !!getSecret(`ai-${p}`)?.key);
}

/**
 * `{ balance, monthlyGrant, renewsAt, endsAt }` — the monthly grant comes from `settings.plans` (the same table
 * the ai-fix function bills against), the dates from the newest active subscription (RLS: own rows only).
 */
function creditsOf(plan, balance, settingsRows, subs) {
  const settings = Object.fromEntries((Array.isArray(settingsRows) ? settingsRows : []).map((r) => [r.key, r.value]));
  const active = (Array.isArray(subs) ? subs : []).find((s) => ['active', 'trial', 'past_due'].includes(s.status));
  return {
    balance: Math.max(0, Number(balance?.[0]?.balance ?? 0)),
    monthlyGrant: Number(active?.provider === "trial" ? settings["billing.catalog"]?.trial?.tokens ?? 50000 : settings.plans?.[plan]?.tokens ?? 0) || null,
    renewsAt: active && !active.cancel_at && active.provider !== 'trial' ? active.period_end || null : null,
    endsAt: active ? active.cancel_at || (active.provider === 'trial' ? active.period_end : null) || null : null,
  };
}

/** Reads profiles + credit_balance for the session's user; falls back to the cached copy when offline. */
async function loadProfile(session) {
  const id = session?.user?.id;
  if (!id) return null;
  const origin = cloudConfig()?.url;
  const saved = readJSON(PROFILE_CACHE(), null);
  const cached = saved?.cloudUrl === origin ? saved : null;
  const assertCurrent = () => { if (getSecret('session')?.user?.id !== id || cloudConfig()?.url !== origin) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5); };
  try {
    const { billingCall } = await import('./billing.mjs');
    const [rows, billing, settingsRows, subs] = await Promise.all([
      rest(`/profiles?select=role,plan,locale,ai_disabled,display_name&user_id=eq.${encodeURIComponent(id)}`, { token: session.accessToken }),
      billingCall('status', {}, { session }).catch(error => {
        if (['network','cloud_function_missing','not_configured','meter_unavailable'].includes(error.code)) return null;
        throw error;
      }),
      rest('/settings?select=key,value', { token: session.accessToken }).catch(() => []),
      rest(`/subscriptions?select=provider,status,period_end,cancel_at&user_id=eq.${encodeURIComponent(id)}&order=updated_at.desc&limit=5`, { token: session.accessToken }).catch(() => []),
    ]);
    assertCurrent();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return cached?.userId === id ? cached : { ...DEFAULT_PROFILE, userId: id, stale: true };
    const profile = {
      userId: id,
      cloudUrl: origin,
      role: row.role || 'normal',
      plan: billing?.plan ?? row.plan ?? 'free',
      locale: row.locale || null,
      aiDisabled: !!row.ai_disabled,
      displayName: row.display_name || null,
      credits: {
        ...creditsOf(billing?.plan ?? row.plan ?? 'free', [], settingsRows, subs),
        balance: billing ? Math.max(0,Number(billing.balance?.available ?? billing.balance?.total ?? 0)) : (cached?.userId === id ? cached.credits?.balance ?? 0 : 0),
        ...(billing?.entitlements ? {monthlyGrant:billing.entitlements.monthly} : {}),
        ...(billing?.subscription ? {renewsAt:billing.subscription.renewsAt,endsAt:billing.subscription.endsAt} : {}),
      },
      sitesActiveMax: billing?.entitlements?.siteLimit ?? null,
      stale: !billing,
      settings: Object.fromEntries((Array.isArray(settingsRows) ? settingsRows : []).map((r) => [r.key, r.value])),
      fetchedAt: nowISO(),
    };
    writeJSON(PROFILE_CACHE(), profile);
    return profile;
  } catch (e) {
    assertCurrent();
    if (e.code === 'network' && cached?.userId === id) return { ...cached, stale: true };
    if (e.code === 'network') return { ...DEFAULT_PROFILE, userId: id, stale: true };
    // 404 = the profiles table does not exist: schema.sql was never applied. Sign-in itself succeeded, so the
    // user gets the default (free, offline-like) profile and the app says what the owner still has to do.
    if (e.code === 'rest_failed' && e.status === 404) return { ...DEFAULT_PROFILE, userId: id, stale: true, schemaMissing: true };
    throw e;
  }
}

/** Privacy / Terms / Refund pages, support e-mail and help pages: the cloud settings (Admin panel) win,
 * `links` in the bundled cloud.json covers people who never sign in (audit B6/R6). Unset → null. */
export function publicLinks(settings = {}) {
  const bundled = readJSON(BUNDLED_CONFIG(), null)?.links || {};
  const pick = (k) => (typeof settings?.[k] === 'string' && settings[k].trim()) || (typeof bundled[k] === 'string' && bundled[k].trim()) || null;
  return { privacy: pick('legal.privacy'), terms: pick('legal.terms'), refund: pick('legal.refund'), support: pick('support.email'), help: pick('help.url') };
}

function withFeatures(user, profile) {
  const p = profile || DEFAULT_PROFILE;
  const hasOwnKey = hasOwnAiKey();
  return {
    ...user,
    role: p.role,
    plan: p.plan,
    locale: p.locale,
    aiDisabled: p.aiDisabled,
    credits: p.credits,
    settings: p.settings || {},
    helpUrl: typeof p.settings?.['help.url'] === 'string' ? p.settings['help.url'] : null,
    links: publicLinks(p.settings),
    profileStale: !!p.stale,
    schemaMissing: !!p.schemaMissing,
    hasOwnKey,
    features: features({ role: p.role, plan: p.plan, aiDisabled: p.aiDisabled, hasOwnKey, credits: p.credits, sitesActiveMax: p.sitesActiveMax }),
  };
}

/** What a Mac without a session can do: external AI buttons and an own key — never the metered cloud. */
function guestFeatures() {
  const hasOwnKey = hasOwnAiKey();
  return { hasOwnKey, features: features({ role: 'normal', plan: 'free', hasOwnKey }) };
}

async function publicUser(session) {
  if (!session?.user) return { configured: !!cloudConfig(), loggedIn: false, links: publicLinks(), ...guestFeatures() };
  return withFeatures({ configured: true, loggedIn: true, ...session.user }, await loadProfile(session));
}

export async function signup({ email, password, name }) {
  if (!email || !password || email === true || password === true) throw new EngineError(msg('account.missingCredentials'), 'usage', 2);
  if (String(password).length < 8) throw new EngineError(msg('account.weakPassword'), 'weak_password');
  const data = { locale: currentLang(), ...(name && name !== true ? { full_name: name } : {}) };
  const r = await auth('/signup', { body: { email, password, data } });
  if (r?.access_token) return { ...(await publicUser(saveSession(r))), confirmEmail: false };
  return { configured: true, loggedIn: false, confirmEmail: true, email };
}

export async function login({ email, password }) {
  if (!email || !password || email === true || password === true) throw new EngineError(msg('account.missingCredentials'), 'usage', 2);
  const r = await auth('/token?grant_type=password', { body: { email, password } });
  return publicUser(saveSession(r));
}

/** Sends the sign-up confirmation e-mail again (the first one is easy to lose: spam, or the built-in mailer). */
export async function resendConfirmation({ email }) {
  if (!email || email === true) throw new EngineError(msg('account.missingEmail'), 'usage', 2);
  await auth('/resend', { body: { type: 'signup', email } });
  return { sent: true, email };
}

export async function recover({ email }) {
  if (!email || email === true) throw new EngineError(msg('account.missingEmail'), 'usage', 2);
  await auth('/recover', { body: { email } });
  return { sent: true };
}

/** OAuth (GitHub/Apple): returns the URL to open; Supabase redirects back to beforeideploy://auth-callback#access_token=… */
export function oauthUrl({ provider = 'github' }) {
  const c = cfg();
  const redirect = 'beforeideploy://auth-callback';
  return { url: `${c.url}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(redirect)}`, redirect };
}

/** Called by the app with the tokens from the callback URL fragment. */
export async function completeOAuth({ access, refresh }) {
  if (!access || access === true) throw new EngineError(msg('account.missingAccessToken'), 'usage', 2);
  const user = await auth('/user', { method: 'GET', token: access });
  return publicUser(saveSession({ access_token: access, refresh_token: refresh, expires_in: 3600, user }));
}

export async function currentSession({ refresh = true } = {}) {
  const s = getSecret('session');
  if (!s?.accessToken) return null;
  if (refresh && s.expiresAt - Date.now() < 5 * 60 * 1000 && s.refreshToken) {
    try {
      const r = await auth('/token?grant_type=refresh_token', { body: { refresh_token: s.refreshToken } });
      if (getSecret('session')?.accessToken !== s.accessToken) return getSecret('session');
      return saveSession(r);
    } catch (e) {
      if (getSecret('session')?.accessToken !== s.accessToken) return getSecret('session');
      if (e.code === 'network') return s; // offline: keep the session, app still works locally
      // only a refused refresh token ends the session; an outage (5xx) or rate limit (429) must not log out (audit E13)
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) {
        deleteSecret('session');
        return null;
      }
      return s;
    }
  }
  return s;
}

const PROVIDERS_CACHE = () => path.join(APP_DIR, 'auth-providers.json'); // last answer of /auth/v1/settings — used offline
const OAUTH_PROVIDERS = ['github', 'apple', 'google'];

/**
 * OAuth providers enabled in the Supabase project (WP5). `GET /auth/v1/settings` is public and reports
 * `external: {github: true, apple: false, …}`, so the sign-in screen shows exactly the buttons that work;
 * the owner enables a provider in the Supabase dashboard and nothing in the app has to change.
 */
export async function authProviders() {
  const c = cloudConfig();
  if (!c) return [];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const res = await fetch(`${c.url}/auth/v1/settings`, { headers: { apikey: c.anonKey }, signal: ctl.signal });
    if (res.ok) {
      const j = await res.json();
      const providers = OAUTH_PROVIDERS.filter((p) => j?.external?.[p] === true);
      writeJSON(PROVIDERS_CACHE(), { providers, checkedAt: nowISO() });
      return providers;
    }
  } catch {
    // offline or blocked — fall back to the last answer
  } finally {
    clearTimeout(timer);
  }
  const cached = readJSON(PROVIDERS_CACHE(), null);
  return Array.isArray(cached?.providers) ? cached.providers : ['github'];
}

export async function accountStatus() {
  const configured = !!cloudConfig();
  if (!configured) return { configured: false, loggedIn: false, links: publicLinks(), ...guestFeatures() };
  const s = await currentSession();
  const user = await publicUser(s);
  if (!user.loggedIn) user.providers = await authProviders();
  return { configured: true, ...user };
}

/** Saves the app language to the cloud profile (the app calls this on every language change). */
export async function setLocale(locale) {
  if (!locale || locale === true) throw new EngineError(msg('account.missingLocale'), 'usage', 2);
  const s = await currentSession();
  if (!s) return { saved: false, reason: 'not_logged_in' };
  await rest(`/profiles?user_id=eq.${encodeURIComponent(s.user.id)}`, { method: 'PATCH', token: s.accessToken, body: { locale }, headers: { Prefer: 'return=minimal' } });
  const cached = readJSON(PROFILE_CACHE(), null);
  if (cached?.userId === s.user.id) writeJSON(PROFILE_CACHE(), { ...cached, locale });
  return { saved: true, locale };
}

// ---------------------------------------------------------------- GDPR: export & delete (WP5)

async function accountFunction(session, action) {
  const c = cfg();
  let res;
  try {
    res = await fetchT(`${c.url}/functions/v1/account`, {
      method: 'POST',
      headers: { apikey: c.anonKey, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  } catch (e) {
    throw new EngineError(msg('account.network', { error: e.message }), 'network');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 404 && data?.code === 'NOT_FOUND') throw new EngineError(msg('cloud.functionMissing', { name: 'account' }), 'cloud_function_missing');
  if (res.status === 401) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  throwIfRateLimited(res, data);
  if (data?.code === 'subscription_active') throw new EngineError(msg('account.delete.subscriptionActive'), 'subscription_active');
  if (!res.ok) throw new EngineError(msg('account.rest.http', { status: res.status, detail: data?.error || '' }), 'account_failed');
  return data;
}

/** Everything the cloud holds for this user → a JSON file in ~/Downloads. */
export async function exportAccount() {
  const s = await currentSession();
  if (!s) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  const data = await accountFunction(s, 'export');
  const dir = ensureDir(path.join(os.homedir(), 'Downloads'));
  const file = path.join(dir, `before-i-deploy-export-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify({ exportedAt: nowISO(), ...data }, null, 2));
  return { path: file, tables: Object.keys(data || {}) };
}

/** Deletes the cloud account (needs --confirm DELETE). Projects and settings on this Mac stay. */
export async function deleteAccount({ confirm }) {
  if (confirm !== 'DELETE') throw new EngineError(msg('account.delete.confirmRequired'), 'confirm_required', 2);
  const s = await currentSession();
  if (!s) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  const r = await accountFunction(s, 'delete');
  deleteSecret('session');
  try {
    fs.unlinkSync(PROFILE_CACHE());
  } catch {}
  try {
    fs.unlinkSync(path.join(APP_DIR, "usage-report.json"));
  } catch {}
  return { deleted: true, ...(r || {}), loggedIn: false };
}

export async function logout() {
  const s = getSecret('session');
  if (s?.accessToken && cloudConfig()) {
    try {
      await auth('/logout', { token: s.accessToken });
    } catch {}
  }
  deleteSecret('session');
  try {
    fs.unlinkSync(PROFILE_CACHE());
  } catch {}
  try {
    fs.unlinkSync(path.join(APP_DIR, "usage-report.json"));
  } catch {}
  return { configured: !!cloudConfig(), loggedIn: false };
}

// ---------------------------------------------------------------- sync (metadata only)

export async function syncProjects() {
  const s = await currentSession();
  if (!s) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  const me = await publicUser(s);
  if (!me.features['cloud.sync']) return { synced: 0, skipped: 'plan', plan: me.plan };
  const c = cfg();
  const rows = listProjects().map((p) => ({
    user_id: s.user?.id,
    key: p.key,
    name: p.name,
    framework: p.framework || null,
    hosting: p.hosting || 'netlify',
    live_url: p.liveUrl || p.netlify?.liveUrl || null,
    domain: p.domain || null,
    last_status: p.lastStatus || null,
    updated_at: nowISO(),
  }));
  if (!rows.length) return { synced: 0 };
  let res;
  try {
    res = await fetchT(`${c.url}/rest/v1/bid_projects?on_conflict=user_id,key`, {
      method: 'POST',
      headers: {
        apikey: c.anonKey,
        Authorization: `Bearer ${s.accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
  } catch (e) {
    throw new EngineError(msg('account.sync.network', { error: e.message }), 'network');
  }
  if (!res.ok) throw new EngineError(msg('account.sync.http', { status: res.status }), 'sync_failed');
  return { synced: rows.length, at: nowISO() };
}
