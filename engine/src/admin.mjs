// Admin operations (V10 WP2): thin client for the `admin` Edge Function. The engine never holds the
// service role — every action is verified server-side against profiles.role = 'admin' and logged in
// admin_audit. `bid admin <action> [--json '{…}'] [--user <uuid>]`.
import { EngineError, fetchT, throwIfRateLimited } from './util.mjs';
import { cloudConfig, currentSession } from './account.mjs';
import { msg } from './i18n.mjs';

export const ADMIN_ACTIONS = ['list_users', 'get_user', 'set_role', 'set_plan_manual', 'grant_credits', 'disable_ai', 'get_usage', 'get_settings', 'set_settings', 'audit_log', 'invite', 'diagnostics'];

export async function adminCall(action, params = {}) {
  if (!ADMIN_ACTIONS.includes(action)) throw new EngineError(msg('admin.unknownAction', { action }), 'usage', 2);
  const c = cloudConfig();
  if (!c) throw new EngineError(msg('account.cloud.notConfigured'), 'not_configured', 7);
  const s = await currentSession();
  if (!s) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  let res;
  try {
    res = await fetchT(`${c.url}/functions/v1/admin`, {
      method: 'POST',
      headers: { apikey: c.anonKey, Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
    });
  } catch (e) {
    throw new EngineError(msg('account.network', { error: e.message }), 'network');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (res.status === 404 && data?.code === 'NOT_FOUND') throw new EngineError(msg('cloud.functionMissing', { name: 'admin' }), 'cloud_function_missing');
  throwIfRateLimited(res, data);
  if (res.status === 403) throw new EngineError(msg('admin.forbidden'), 'forbidden', 3);
  if (!res.ok) throw new EngineError(msg('admin.failed', { status: res.status, detail: data?.error || '' }), 'admin_failed');
  return data;
}

/** CLI entry: parses --json / --user / --value flags into the function's params. */
export async function adminCommand(action, flags) {
  let params = {};
  if (flags.json && flags.json !== true) {
    try {
      params = JSON.parse(flags.json);
    } catch {
      throw new EngineError(msg('admin.badJson'), 'usage', 2);
    }
  }
  if (flags.user && flags.user !== true) params.user_id = flags.user;
  if (flags.query && flags.query !== true) params.query = flags.query;
  if (flags.role && flags.role !== true) params.role = flags.role;
  if (flags.plan && flags.plan !== true) params.plan = flags.plan;
  if (flags.delta !== undefined && flags.delta !== true) params.delta = Number(flags.delta);
  if (flags.reason && flags.reason !== true) params.reason = flags.reason;
  if (flags.disabled !== undefined) params.disabled = flags.disabled === true || flags.disabled === 'true';
  if (flags.email && flags.email !== true) params.email = String(flags.email);
  if (flags.locale && flags.locale !== true) params.locale = String(flags.locale);
  return adminCall(action, params);
}
