# Edge Functions

| Function | Who calls it | Purpose |
|---|---|---|
| `admin` | `bid admin <action>` (Admin panel) | role-gated user/plan/credit management, written to `admin_audit` |
| `ai-fix` | `bid ai fix` for normal users on a plan | metered AI proxy: plan/credits/rate checks, streams the model, bills real tokens |
| `account` | `bid account export` / `bid account delete` | GDPR export of the caller's rows; account deletion (cancels the Paddle subscription first) |
| `billing` | `bid billing …` and Paddle webhooks | catalog, status, **usage** (server-authoritative Plan & usage), **sync** (recovery after a missed webhook), checkout, trial, customer portal; subscription / grant / refund webhooks |
| `monitor` | `bid monitor cloud …` and pg_cron (`run`) | server-side monitoring (V11 RC): register a tenant's own live host, status with scheduler heartbeat, incidents, test; the cron pass probes due targets through the pinned network guard (`_shared/netguard.ts`) |

Deploy from the repo root with the Supabase CLI (once per change):

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy admin ai-fix account
supabase functions deploy billing --no-verify-jwt    # Paddle webhooks carry no JWT; user actions are checked inside
supabase functions deploy monitor --no-verify-jwt    # the pg_cron call carries no JWT (x-monitor-secret); user actions are checked inside
supabase secrets set ANTHROPIC_API_KEY=sk-ant-…     # ai-fix
supabase secrets set PADDLE_API_KEY=… PADDLE_WEBHOOK_SECRET=… PADDLE_ENV=sandbox   # billing + account
supabase secrets set MONITOR_CRON_SECRET=<long random string>                     # monitor; then run supabase/monitor-cron.sql
```

The functions read `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase
injects automatically. Never put the service role key in the app or the engine.

## Layout and tests

Each function is `index.ts` (reads env, builds the real supabase-js clients, `Deno.serve`) plus
`handler.ts` (the logic, written against the small `DbClient` interface in `_shared/db.ts`). Tests in
`<function>/*_test.ts` run the handler against `_shared/fake_supabase.ts`, an in-memory database, and a
fake Anthropic stream — no network, no secrets:

```bash
deno test --allow-env --allow-net --allow-read supabase/functions   # 87 tests (2026-09-30); RLS + SQL functions: cd tests/rls && node rls.mjs (10)
for f in supabase/functions/*/index.ts; do deno check "$f"; done
```

CI (`.github/workflows/functions.yml`) runs both on every change under `supabase/functions/`. Without a
local Deno install: `npm install deno@2` in a scratch folder and use `node_modules/.bin/deno`.

Local run against the engine: `supabase functions serve` and `BID_SUPABASE_URL=http://127.0.0.1:54321`.

## Paddle (billing)

1. Paddle → Catalog: products for Flash / High / Knight (monthly prices) and the two token packs.
2. Put each price id into `settings.billing.catalog` (Admin panel → Global settings → `billing.catalog`):
   `plans.<tier>.paddlePriceId`, `packs[].paddlePriceId`. Items without an id show as "Soon" in the app.
3. Developer tools → Notifications → new destination `<SUPABASE_URL>/functions/v1/billing`, events
   `subscription.*`, `transaction.completed`, `adjustment.created`, `adjustment.updated`; copy its secret
   into `PADDLE_WEBHOOK_SECRET`.
4. Test in sandbox (`PADDLE_ENV=sandbox`), then switch to `live`.

### Upgrading an existing database (V10 audit)

Run `supabase/schema.sql` again in the SQL editor — every statement is idempotent. It adds `trial_claims`,
`billing_events.user_id/ref`, `subscriptions.event_at`, the `credit_bucket_balance` view and the unique index
`credit_ledger_once` (each grant / refund / expiry once per reference). If that index fails, the ledger already
has duplicates; the query in the comment above it lists them. Then redeploy all four functions.
