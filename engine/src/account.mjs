// Account — Supabase Auth (email/password + GitHub), session in Keychain, project metadata sync.
// Service tokens (Netlify, Vercel, …) NEVER leave the Mac; only project metadata is synced.
import path from 'node:path';
import { APP_DIR, ENGINE_DIR, EngineError, readJSON, writeJSON, nowISO } from './util.mjs';
import { getSecret, setSecret, deleteSecret } from './secrets.mjs';
import { listProjects } from './store.mjs';

const USER_CONFIG = () => path.join(APP_DIR, 'cloud.json');
const BUNDLED_CONFIG = () => path.join(ENGINE_DIR, 'cloud.json');

export function cloudConfig() {
  const c = readJSON(USER_CONFIG(), null) || (process.env.BID_NO_BUNDLED_CLOUD ? null : readJSON(BUNDLED_CONFIG(), null));
  if (process.env.BID_SUPABASE_URL) return { url: process.env.BID_SUPABASE_URL, anonKey: process.env.BID_SUPABASE_ANON_KEY };
  if (!c?.url || !c?.anonKey) return null;
  return { url: c.url.replace(/\/$/, ''), anonKey: c.anonKey };
}

export function setCloudConfig({ url, anonKey }) {
  if (!url || !anonKey || url === true || anonKey === true) throw new EngineError('Липсват URL и anon key', 'usage', 2);
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url.trim()) && !/^http:\/\/127\.0\.0\.1/.test(url)) {
    throw new EngineError('URL-ът трябва да е във формат https://xxxx.supabase.co', 'usage', 2);
  }
  writeJSON(USER_CONFIG(), { url: url.trim().replace(/\/$/, ''), anonKey: anonKey.trim(), savedAt: nowISO() });
  return { configured: true };
}

function cfg() {
  const c = cloudConfig();
  if (!c) throw new EngineError('Облакът не е настроен.', 'not_configured', 7);
  return c;
}

async function auth(p, { method = 'POST', body, token } = {}) {
  const c = cfg();
  let res;
  try {
    res = await fetch(`${c.url}/auth/v1${p}`, {
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
    throw new EngineError(`Няма връзка със сървъра за акаунти: ${e.message}`, 'network');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const raw = data?.error_description || data?.msg || data?.message || data?.error || `HTTP ${res.status}`;
    throw new EngineError(translate(raw), 'auth_error');
  }
  return data;
}

function translate(msg) {
  const m = String(msg);
  if (/invalid login credentials/i.test(m)) return 'Грешен имейл или парола.';
  if (/email not confirmed/i.test(m)) return 'Имейлът още не е потвърден — провери пощата си.';
  if (/user already registered/i.test(m)) return 'Вече има акаунт с този имейл — влез.';
  if (/password should be at least/i.test(m)) return 'Паролата трябва да е поне 8 символа.';
  if (/rate limit/i.test(m)) return 'Твърде много опити — изчакай малко.';
  if (/unable to validate email/i.test(m)) return 'Невалиден имейл.';
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

function publicUser(session) {
  return session?.user ? { configured: true, loggedIn: true, ...session.user } : { configured: !!cloudConfig(), loggedIn: false };
}

export async function signup({ email, password, name }) {
  if (!email || !password || email === true || password === true) throw new EngineError('Липсват имейл и парола', 'usage', 2);
  if (String(password).length < 8) throw new EngineError('Паролата трябва да е поне 8 символа.', 'weak_password');
  const r = await auth('/signup', { body: { email, password, data: name && name !== true ? { full_name: name } : {} } });
  if (r?.access_token) return { ...publicUser(saveSession(r)), confirmEmail: false };
  return { configured: true, loggedIn: false, confirmEmail: true, email };
}

export async function login({ email, password }) {
  if (!email || !password || email === true || password === true) throw new EngineError('Липсват имейл и парола', 'usage', 2);
  const r = await auth('/token?grant_type=password', { body: { email, password } });
  return publicUser(saveSession(r));
}

export async function recover({ email }) {
  if (!email || email === true) throw new EngineError('Липсва имейл', 'usage', 2);
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
  if (!access || access === true) throw new EngineError('Липсва access token', 'usage', 2);
  const user = await auth('/user', { method: 'GET', token: access });
  return publicUser(saveSession({ access_token: access, refresh_token: refresh, expires_in: 3600, user }));
}

export async function currentSession({ refresh = true } = {}) {
  const s = getSecret('session');
  if (!s?.accessToken) return null;
  if (refresh && s.expiresAt - Date.now() < 5 * 60 * 1000 && s.refreshToken) {
    try {
      const r = await auth('/token?grant_type=refresh_token', { body: { refresh_token: s.refreshToken } });
      return saveSession(r);
    } catch (e) {
      if (e.code === 'network') return s; // offline: keep the session, app still works locally
      deleteSecret('session');
      return null;
    }
  }
  return s;
}

export async function accountStatus() {
  const configured = !!cloudConfig();
  if (!configured) return { configured: false, loggedIn: false };
  const s = await currentSession();
  return { configured: true, ...publicUser(s) };
}

export async function logout() {
  const s = getSecret('session');
  if (s?.accessToken && cloudConfig()) {
    try {
      await auth('/logout', { token: s.accessToken });
    } catch {}
  }
  deleteSecret('session');
  return { configured: !!cloudConfig(), loggedIn: false };
}

// ---------------------------------------------------------------- sync (metadata only)

export async function syncProjects() {
  const s = await currentSession();
  if (!s) throw new EngineError('Не си влязъл в акаунта.', 'not_logged_in', 5);
  const c = cfg();
  const rows = listProjects().map((p) => ({
    user_id: s.user?.id,
    key: p.key,
    name: p.name,
    framework: p.framework || null,
    hosting: p.hosting || 'netlify',
    live_url: p.netlify?.liveUrl || null,
    domain: p.domain || null,
    last_status: p.lastStatus || null,
    updated_at: nowISO(),
  }));
  if (!rows.length) return { synced: 0 };
  let res;
  try {
    res = await fetch(`${c.url}/rest/v1/bid_projects?on_conflict=user_id,key`, {
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
    throw new EngineError(`Синхронизацията не успя: ${e.message}`, 'network');
  }
  if (!res.ok) throw new EngineError(`Синхронизацията не успя (HTTP ${res.status}). Пусна ли SQL схемата?`, 'sync_failed');
  return { synced: rows.length, at: nowISO() };
}
