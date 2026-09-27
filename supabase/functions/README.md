# Edge Functions

| Function | Who calls it | Purpose |
|---|---|---|
| `admin` | `bid admin <action>` (Admin panel) | role-gated user/plan/credit management, written to `admin_audit` |

Deploy from the repo root with the Supabase CLI (once per change):

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy admin
```

The functions read `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase
injects automatically. Nothing else is needed for `admin`. Never put the service role key in the app or
the engine.

Local run: `supabase functions serve admin` and point the engine at it with `BID_SUPABASE_URL=http://127.0.0.1:54321`.
