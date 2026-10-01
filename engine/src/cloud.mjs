// Cloud doctor — what the bundled Supabase project can and cannot do right now. The owner sets the project up
// once (schema, Edge Functions, auth options); until then sign-in works only partly, and this module says
// exactly which part is missing instead of letting a 404 surface as "cannot sign in".
import path from 'node:path';
import { APP_DIR, readJSON, writeJSON, nowISO } from './util.mjs';
import { cloudConfig } from './account.mjs';
import { t } from './i18n.mjs';

/** Edge Functions the engine calls (supabase/functions/*). */
export const CLOUD_FUNCTIONS = ['account', 'ai-fix', 'billing', 'monitor', 'admin'];
/** Tables the client reads directly; missing ones mean supabase/schema.sql was never applied (or only partly). */
export const CLOUD_TABLES = ['profiles', 'settings', 'subscriptions', 'credit_ledger', 'ai_usage', 'monitor_targets'];

const CACHE = () => path.join(APP_DIR, 'cloud-doctor.json');

/** `abcdefghijklmnop` from `https://abcdefghijklmnop.supabase.co`, null for a local / custom URL. */
export function projectRef(url) {
  const m = /^https:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(String(url || ''));
  return m ? m[1] : null;
}

/** Dashboard pages the owner needs; null when the project is not a hosted Supabase project. */
export function dashboardUrls(ref) {
  if (!ref) return { project: null, sql: null, functions: null, auth: null, api: null };
  const base = `https://supabase.com/dashboard/project/${ref}`;
  return { project: base, sql: `${base}/sql/new`, functions: `${base}/functions`, auth: `${base}/auth/providers`, api: `${base}/settings/api` };
}

async function probe(url, { method = 'GET', headers = {}, body, timeoutMs = 5000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctl.signal });
    const text = await res.text().catch(() => '');
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/** True when an Edge Function answered "Requested function was not found" (the function is not deployed). */
export function functionMissing(status, data) {
  return status === 404 && data?.code === 'NOT_FOUND' && /function/i.test(String(data?.message || ''));
}

/**
 * Probes the configured project in parallel (≤ `timeoutMs` in total when it is unreachable):
 * `{ configured, url, ref, reachable, auth: { signupEnabled, emailConfirmRequired, providers }, tables,
 *    schemaApplied, functions, functionsMissing, dashboard, checkedAt }`.
 * Offline → the last answer with `reachable: false`, so the Setup screen still shows what was known.
 */
export async function cloudDoctor({ timeoutMs = 5000 } = {}) {
  const c = cloudConfig();
  if (!c) return { configured: false, url: null, ref: null, reachable: false, schemaApplied: null, functionsMissing: [], checkedAt: nowISO() };
  const ref = projectRef(c.url);
  const dashboard = dashboardUrls(ref);
  const H = { apikey: c.anonKey };
  const health = await probe(`${c.url}/auth/v1/health`, { headers: H, timeoutMs });
  if (health.status === 0) {
    const cached = readJSON(CACHE(), null);
    const base = cached && cached.url === c.url ? cached : { configured: true, url: c.url, ref, dashboard, auth: null, tables: {}, schemaApplied: null, functions: {}, functionsMissing: [] };
    return { ...base, reachable: false, error: health.error, checkedAt: nowISO() };
  }
  const [settings, tableRows, fnRows] = await Promise.all([
    probe(`${c.url}/auth/v1/settings`, { headers: H, timeoutMs }),
    Promise.all(CLOUD_TABLES.map((name) => probe(`${c.url}/rest/v1/${name}?select=*&limit=0`, { headers: H, timeoutMs }).then((r) => [name, r]))),
    Promise.all(
      CLOUD_FUNCTIONS.map((name) =>
        probe(`${c.url}/functions/v1/${name}`, {
          method: 'POST',
          headers: { ...H, Authorization: `Bearer ${c.anonKey}`, 'Content-Type': 'application/json' },
          body: '{}',
          timeoutMs,
        }).then((r) => [name, r])
      )
    ),
  ]);
  const ext = settings.json?.external || {};
  const auth = settings.json
    ? {
        signupEnabled: settings.json.disable_signup !== true,
        emailConfirmRequired: settings.json.mailer_autoconfirm !== true,
        providers: Object.keys(ext).filter((k) => ext[k] === true),
      }
    : null;
  // PostgREST: 200 (RLS lets anon see nothing) or 401/403 = the relation exists; 404 = it does not
  const tables = Object.fromEntries(tableRows.map(([name, r]) => [name, r.status === 404 ? false : r.status === 0 ? null : true]));
  const functions = Object.fromEntries(fnRows.map(([name, r]) => [name, r.status === 0 ? null : !functionMissing(r.status, r.json)]));
  const result = {
    configured: true,
    url: c.url,
    ref,
    reachable: true,
    auth,
    tables,
    schemaApplied: Object.values(tables).every((v) => v === true),
    tablesMissing: CLOUD_TABLES.filter((n) => tables[n] === false),
    functions,
    functionsMissing: CLOUD_FUNCTIONS.filter((n) => functions[n] === false),
    dashboard,
    checkedAt: nowISO(),
  };
  writeJSON(CACHE(), result);
  return result;
}

/** Setup-screen rows for the cloud, first group on the page: what the owner still has to do in Supabase. */
export function cloudSetupItems(d) {
  const group = t('setup.group.cloud');
  const items = [];
  const add = (id, title, ok, detail, action = null, optional = false) => items.push({ group, id, title, ok, detail, action: ok ? null : action, optional });
  if (!d.configured) {
    add('cloud-config', t('setup.cloud.project'), false, t('setup.cloud.notConfigured'), { type: 'open', label: t('setup.action.open'), url: 'https://supabase.com/dashboard' });
    return items;
  }
  if (!d.reachable) {
    add('cloud-config', t('setup.cloud.project'), false, t('setup.cloud.unreachable', { url: d.url, error: d.error || '' }), null);
    return items;
  }
  add('cloud-config', t('setup.cloud.project'), true, d.url);
  add(
    'cloud-schema',
    t('setup.cloud.schema'),
    d.schemaApplied === true,
    d.schemaApplied ? t('setup.cloud.schemaOk') : t('setup.cloud.schemaMissing', { tables: (d.tablesMissing || []).join(', ') }),
    { type: 'app', label: t('setup.cloud.applySchema'), appAction: 'cloud-schema', url: d.dashboard?.sql || null, display: t('setup.display.sqlEditor') }
  );
  const missing = d.functionsMissing || [];
  add(
    'cloud-functions',
    t('setup.cloud.functions'),
    missing.length === 0,
    missing.length ? t('setup.cloud.functionsMissing', { names: missing.join(', ') }) : t('setup.cloud.functionsOk'),
    { type: 'open', label: t('setup.action.open'), url: d.dashboard?.functions || 'https://supabase.com/dashboard', display: t('setup.display.deployWorkflow') }
  );
  if (d.auth) {
    if (!d.auth.signupEnabled) {
      add('cloud-signup', t('setup.cloud.signup'), false, t('setup.cloud.signupDisabled'), { type: 'open', label: t('setup.action.open'), url: d.dashboard?.auth || 'https://supabase.com/dashboard' });
    }
    add(
      'cloud-email',
      t('setup.cloud.email'),
      !d.auth.emailConfirmRequired,
      d.auth.emailConfirmRequired ? t('setup.cloud.emailConfirmOn') : t('setup.cloud.emailConfirmOff'),
      { type: 'open', label: t('setup.action.open'), url: d.dashboard?.auth || 'https://supabase.com/dashboard', display: t('setup.display.authProviders') },
      true
    );
  }
  return items;
}
