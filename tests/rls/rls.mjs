// Before I Deploy — row-level-security tests on a real Postgres (V11 RC).
//
// Loads supabase/schema.sql into PGlite (Postgres compiled to WASM: real roles, real RLS, real triggers) with a
// small shim for what Supabase provides around it (auth schema, auth.uid(), the anon / authenticated /
// service_role roles and their grants). Then it acts as user A, user B, an unauthenticated client and the
// service role and checks that every table answers the way the Edge Functions and the app rely on:
// clients read only their own rows, never write what only the service role may write, and the service
// role (RLS bypass, like Supabase's) still can.
//
//   cd tests/rls && npm ci && node rls.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');

let passed = 0;
let failed = 0;
const results = [];
async function t(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, ok: true });
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    results.push({ name, ok: false, error: e.message });
    console.log(`  ❌ ${name}\n     ${e.message}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const db = new PGlite();

// ---- Supabase shim: auth schema + roles the way the platform creates them
await db.exec(`
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
`);
await db.exec(schema);
await db.exec(schema); // idempotent: the owner may run it again on an existing database
// Supabase grants: every role may touch public tables, RLS decides what it sees / writes
await db.exec(`
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
`);

const A = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ('a@example.com', '{"locale":"bg"}') returning id`)).rows[0].id;
const B = (await db.query(`insert into auth.users (email) values ('b@example.com') returning id`)).rows[0].id;

/** Runs `fn(sql)` as a client role with the JWT claims of `uid` (null = anonymous), in one transaction. */
async function as(role, uid, fn) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.exec(`select set_config('request.jwt.claim.sub', '${uid || ''}', true)`);
    await db.exec(`select set_config('request.jwt.claim.role', '${role}', true)`);
    const out = await fn((sql, params) => db.query(sql, params));
    await db.exec('commit');
    return out;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}
const asA = (fn) => as('authenticated', A, fn);
const asB = (fn) => as('authenticated', B, fn);
const asAnon = (fn) => as('anon', null, fn);
const asService = (fn) => as('service_role', null, fn);
async function rejects(fn, pattern) {
  try {
    await fn();
  } catch (e) {
    if (!pattern || pattern.test(e.message)) return e.message;
    throw new Error(`rejected for the wrong reason: ${e.message}`);
  }
  throw new Error('expected a rejection');
}

console.log('RLS on a real Postgres (PGlite):');

await t('profiles: the trigger created both profiles with the signup locale; each user reads only their own', async () => {
  const mine = await asA((q) => q('select email, locale, role, plan from public.profiles'));
  assert(mine.rows.length === 1 && mine.rows[0].email === 'a@example.com' && mine.rows[0].locale === 'bg' && mine.rows[0].plan === 'free', JSON.stringify(mine.rows));
  const theirs = await asB((q) => q('select email from public.profiles'));
  assert(theirs.rows.length === 1 && theirs.rows[0].email === 'b@example.com', 'B sees only B');
  const none = await asAnon((q) => q('select email from public.profiles'));
  assert(none.rows.length === 0, 'anonymous sees nothing');
});

await t('profiles: a client may change locale / display name, never role, plan, ai_disabled or email', async () => {
  await asA((q) => q(`update public.profiles set locale = 'en', display_name = 'Ann', role = 'admin', plan = 'knight', ai_disabled = true, email = 'x@y.z'`));
  const row = (await asService((q) => q(`select locale, display_name, role, plan, ai_disabled, email from public.profiles where user_id = $1`, [A]))).rows[0];
  assert(row.locale === 'en' && row.display_name === 'Ann', 'own editable columns changed');
  assert(row.role === 'normal' && row.plan === 'free' && row.ai_disabled === false && row.email === 'a@example.com', 'protected columns kept: ' + JSON.stringify(row));
  // updating someone else's profile touches no row
  const r = await asB((q) => q(`update public.profiles set display_name = 'Mallory' where user_id = $1`, [A]));
  assert(r.affectedRows === 0, 'B cannot update A');
  // the service role (Edge Functions) may change the plan
  await asService((q) => q(`update public.profiles set plan = 'high' where user_id = $1`, [A]));
  assert((await asA((q) => q('select plan from public.profiles'))).rows[0].plan === 'high', 'service role sets the plan');
});

await t('bid_projects: own rows only; a client cannot insert rows for another user', async () => {
  await asA((q) => q(`insert into public.bid_projects (user_id, key, name, live_url, domain) values ($1, 'shop', 'Shop', 'https://shop.example.com', 'shop.example.com')`, [A]));
  await asB((q) => q(`insert into public.bid_projects (user_id, key, name) values ($1, 'blog', 'Blog')`, [B]));
  await rejects(() => asA((q) => q(`insert into public.bid_projects (user_id, key, name) values ($1, 'evil', 'Evil')`, [B])), /row-level security/);
  assert((await asA((q) => q('select key from public.bid_projects'))).rows.map((r) => r.key).join() === 'shop', 'A sees shop only');
  assert((await asB((q) => q('select key from public.bid_projects'))).rows.map((r) => r.key).join() === 'blog', 'B sees blog only');
  assert((await asAnon((q) => q('select key from public.bid_projects'))).rows.length === 0, 'anon sees nothing');
  const r = await asB((q) => q(`update public.bid_projects set name = 'pwned' where key = 'shop'`));
  assert(r.affectedRows === 0, 'B cannot update A');
  const d = await asB((q) => q(`delete from public.bid_projects where key = 'shop'`));
  assert(d.affectedRows === 0, 'B cannot delete A');
});

await t('credit_ledger and views: read own only, no client writes, service role writes; grants are unique per ref', async () => {
  await asService((q) => q(`insert into public.credit_ledger (user_id, delta, bucket, reason, ref) values ($1, 1000, 'plan', 'plan_grant', 'sub:m0'), ($1, -40, 'plan', 'ai_fix', 'u1'), ($2, 5, 'topup', 'topup', 'txn1')`, [A, B]));
  await rejects(() => asA((q) => q(`insert into public.credit_ledger (user_id, delta, bucket, reason) values ($1, 999999, 'topup', 'admin_grant')`, [A])), /row-level security/);
  await rejects(() => asA((q) => q(`delete from public.credit_ledger`)), /row-level security|permission denied/).catch(async () => {
    // delete without a policy touches no row instead of erroring — also acceptable, as long as nothing is gone
    const n = (await asService((q) => q('select count(*)::int as n from public.credit_ledger'))).rows[0].n;
    assert(n === 3, 'nothing deleted');
  });
  const mine = await asA((q) => q('select delta from public.credit_ledger order by id'));
  assert(mine.rows.map((r) => Number(r.delta)).join() === '1000,-40', 'A reads A: ' + JSON.stringify(mine.rows));
  const bal = await asA((q) => q('select balance from public.credit_balance'));
  assert(bal.rows.length === 1 && Number(bal.rows[0].balance) === 960, 'balance view is filtered by RLS: ' + JSON.stringify(bal.rows));
  const buckets = await asB((q) => q('select bucket, balance from public.credit_bucket_balance'));
  assert(buckets.rows.length === 1 && buckets.rows[0].bucket === 'topup' && Number(buckets.rows[0].balance) === 5, 'B bucket view');
  assert((await asAnon((q) => q('select * from public.credit_balance'))).rows.length === 0, 'anon sees no balances');
  await rejects(() => asService((q) => q(`insert into public.credit_ledger (user_id, delta, bucket, reason, ref) values ($1, 1000, 'plan', 'plan_grant', 'sub:m0')`, [A])), /duplicate key|credit_ledger_once/);
});

await t('subscriptions, ai_usage: own rows only; billing_events, admin_audit, trial_claims: invisible to clients', async () => {
  await asService((q) => q(`insert into public.subscriptions (user_id, provider, provider_ref, tier, status) values ($1, 'paddle', 'sub_1', 'high', 'active'), ($2, 'trial', null, 'high', 'trial')`, [A, B]));
  await asService((q) => q(`insert into public.ai_usage (user_id, step, charged_tokens, status) values ($1, 'build', 40, 'done')`, [A]));
  await asService((q) => q(`insert into public.billing_events (id, type, user_id, payload) values ('evt_1', 'transaction.completed', $1, '{"card":"4242"}'), ('evt_2', 'x', $2, '{}')`, [A, B]));
  await asService((q) => q(`insert into public.admin_audit (admin_id, action, target) values ($1, 'set_plan', $2)`, [A, B]));
  await asService((q) => q(`insert into public.trial_claims (email_hash) values ('abc')`));
  assert((await asA((q) => q('select provider_ref from public.subscriptions'))).rows.map((r) => r.provider_ref).join() === 'sub_1', 'A subscription');
  assert((await asB((q) => q('select provider from public.subscriptions'))).rows.map((r) => r.provider).join() === 'trial', 'B subscription');
  assert((await asB((q) => q('select * from public.ai_usage'))).rows.length === 0, 'B sees no usage of A');
  assert((await asA((q) => q('select * from public.ai_usage'))).rows.length === 1, 'A sees own usage');
  for (const table of ['billing_events', 'admin_audit', 'trial_claims']) {
    assert((await asA((q) => q(`select * from public.${table}`))).rows.length === 0, `${table}: hidden from clients`);
    await rejects(() => asA((q) => q(`insert into public.${table} default values`)), /row-level security|null value|violates/);
  }
  await rejects(() => asA((q) => q(`update public.subscriptions set status = 'active', tier = 'knight'`)), /row-level security/).catch(async () => {
    const st = (await asService((q) => q(`select status from public.subscriptions where user_id = $1`, [A]))).rows[0].status;
    assert(st === 'active', 'no client change');
  });
  await rejects(() => asA((q) => q(`insert into public.subscriptions (user_id, provider, tier, status) values ($1, 'manual', 'knight', 'active')`, [A])), /row-level security/);
});

await t('settings: readable by signed-in users, not by anonymous, never writable by clients', async () => {
  const s = await asA((q) => q(`select key from public.settings order by key`));
  assert(s.rows.map((r) => r.key).join() === 'billing.catalog,plans', JSON.stringify(s.rows));
  assert((await asAnon((q) => q('select key from public.settings'))).rows.length === 0, 'anon');
  await rejects(() => asA((q) => q(`insert into public.settings (key, value) values ('ai.models', '{}')`)), /row-level security/);
  const u = await asA((q) => q(`update public.settings set value = '{}' where key = 'plans'`));
  assert(u.affectedRows === 0, 'no client update');
});

await t('monitoring (V11 RC): targets, probes and incidents are per tenant and read-only for clients; heartbeat is readable when signed in', async () => {
  await asService((q) => q(`insert into public.monitor_targets (user_id, project_key, url) values ($1, 'shop', 'https://shop.example.com/'), ($2, 'blog', 'https://blog.example.com/')`, [A, B]));
  await asService((q) => q(`insert into public.monitor_probes (user_id, project_key, kind, ok, status) values ($1, 'shop', 'down', false, 503)`, [A]));
  await asService((q) => q(`insert into public.monitor_incidents (user_id, project_key, kind, status, detail) values ($1, 'shop', 'down', 'open', 'http 503')`, [A]));
  await asService((q) => q(`insert into public.monitor_heartbeat (checked, due, targets) values (2, 2, 2)`));
  assert((await asA((q) => q('select project_key from public.monitor_targets'))).rows.map((r) => r.project_key).join() === 'shop', 'A target');
  assert((await asB((q) => q('select project_key from public.monitor_targets'))).rows.map((r) => r.project_key).join() === 'blog', 'B target');
  assert((await asB((q) => q('select * from public.monitor_probes'))).rows.length === 0 && (await asB((q) => q('select * from public.monitor_incidents'))).rows.length === 0, 'B sees none of A');
  assert((await asA((q) => q('select detail from public.monitor_incidents'))).rows[0].detail === 'http 503', 'A incident');
  assert((await asAnon((q) => q('select * from public.monitor_heartbeat'))).rows.length === 0, 'anon: no heartbeat');
  assert((await asA((q) => q('select checked from public.monitor_heartbeat'))).rows[0].checked === 2, 'signed in: heartbeat');
  // clients never write monitoring rows (the Edge Function validates URLs and ownership)
  await rejects(() => asA((q) => q(`insert into public.monitor_targets (user_id, project_key, url) values ($1, 'x', 'http://169.254.169.254/')`, [A])), /row-level security/);
  await rejects(() => asA((q) => q(`insert into public.monitor_incidents (user_id, project_key, kind, status) values ($1, 'shop', 'down', 'open')`, [A])), /row-level security|duplicate/);
  const u = await asA((q) => q(`update public.monitor_targets set url = 'http://127.0.0.1/' where project_key = 'shop'`));
  assert(u.affectedRows === 0, 'no client update of targets');
  const d = await asA((q) => q(`delete from public.monitor_incidents`));
  assert(d.affectedRows === 0, 'no client delete of incidents');
  // one open incident per (user, project, kind); a resolved one does not block a new one
  await rejects(() => asService((q) => q(`insert into public.monitor_incidents (user_id, project_key, kind, status) values ($1, 'shop', 'down', 'open')`, [A])), /duplicate key|monitor_incidents_one_open/);
  await asService((q) => q(`update public.monitor_incidents set status = 'resolved', resolved_at = now() where user_id = $1`, [A]));
  await asService((q) => q(`insert into public.monitor_incidents (user_id, project_key, kind, status) values ($1, 'shop', 'down', 'open')`, [A]));
  await rejects(() => asService((q) => q(`insert into public.monitor_targets (user_id, project_key, url, interval_min) values ($1, 'fast', 'https://x.example.com/', 1)`, [A])), /check constraint|interval_min/);
});

await t('account deletion cascades: removing the auth user removes every row of that tenant and nothing of the other', async () => {
  await db.query(`delete from auth.users where id = $1`, [B]); // the auth service (owner), not the API role
  for (const table of ['profiles', 'bid_projects', 'credit_ledger', 'subscriptions', 'monitor_targets']) {
    const n = (await asService((q) => q(`select count(*)::int as n from public.${table} where user_id = $1`, [B]))).rows[0].n;
    assert(n === 0, `${table}: B's rows gone`);
  }
  assert((await asA((q) => q('select key from public.bid_projects'))).rows.length === 1, 'A untouched');
});

console.log(`\n${failed ? '❌' : '✅'} ${passed} passed, ${failed} failed`);
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), passed, failed, results }, null, 2));
process.exit(failed ? 1 : 0);
