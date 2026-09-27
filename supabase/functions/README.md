# Edge Functions

| Function | Who calls it | Purpose |
|---|---|---|
| `admin` | `bid admin <action>` (Admin panel) | role-gated user/plan/credit management, written to `admin_audit` |
| `ai-fix` | `bid ai fix` for normal users on a plan | metered AI proxy: plan/credits/rate checks, streams the model, bills real tokens |
| `account` | `bid account export` / `bid account delete` | GDPR export of the caller's rows; account deletion |

Deploy from the repo root with the Supabase CLI (once per change):

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy admin ai-fix account
supabase secrets set ANTHROPIC_API_KEY=sk-ant-…     # ai-fix only
```

The functions read `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase
injects automatically. Never put the service role key in the app or the engine.

## Layout and tests

Each function is `index.ts` (reads env, builds the real supabase-js clients, `Deno.serve`) plus
`handler.ts` (the logic, written against the small `DbClient` interface in `_shared/db.ts`). Tests in
`<function>/*_test.ts` run the handler against `_shared/fake_supabase.ts`, an in-memory database, and a
fake Anthropic stream — no network, no secrets:

```bash
deno test supabase/functions                     # 32 tests
for f in supabase/functions/*/index.ts; do deno check "$f"; done
```

CI (`.github/workflows/functions.yml`) runs both on every change under `supabase/functions/`. Without a
local Deno install: `npm install deno@2` in a scratch folder and use `node_modules/.bin/deno`.

Local run against the engine: `supabase functions serve` and `BID_SUPABASE_URL=http://127.0.0.1:54321`.
