# Release handoff — architecture, setup, migrations, recovery, operations (11.0.0-rc.1)

Read after `docs/HANDOFF-V10.md` (every module V11 did not touch) and `docs/V11-HANDOFF.md` (the V11 control
centre). This page covers what the release candidate added, how to set it up, how to migrate an existing
installation, and what to do when something goes wrong in operation. The audit with evidence per requirement is
`docs/RELEASE-CANDIDATE-AUDIT.md`; the owner's walkthrough is `docs/OWNER-ACCEPTANCE-TEST-BG.md`.

## 1. Architecture (unchanged rules, new pieces)

```
SwiftUI app ──(NDJSON over stdout)──▶ engine `bid` (Node, zero deps, bundled runtime) ──▶ network
   AssistantView / AssistantStore      ai/assistant.mjs + ai/prompts.mjs (engine/prompts/*.json)
   PlanUsageView / BillingStore        billing.mjs  ──▶ Edge Function `billing` (usage, sync, …)
   MonitorCard                         monitor.mjs + monitor-cloud.mjs ──▶ Edge Function `monitor`
                                                                          ◀── pg_cron every 5 min (`run`)
```

- The app never talks to the network; every action is an engine command (`docs/V11-HANDOFF.md §1`).
- The engine has no npm dependencies. The only new dev dependency lives in `tests/rls` (PGlite) and is never
  shipped.
- Managed AI keys stay in the `ai-fix` function. The native bundle carries no provider secret.
- Cloud: Supabase Postgres + RLS, five Edge Functions (`admin`, `ai-fix`, `account`, `billing`, `monitor`).

### New engine modules

| Module | Purpose |
|---|---|
| `ai/prompts.mjs`, `engine/prompts/*.v1.json` | versioned prompt resources, rendering, JSON extraction, schema + ref validation |
| `ai/assistant.mjs` | actions ask / diagnose / propose / fix / review / explain / readiness / triage; evidence + redaction; budgets; the bounded fix loop; per-project history (`Application Support/chats/*.jsonl`, 0600); settings (`ai-settings.json`) |
| `monitor-cloud.mjs` | `monitor` function client; webhook channel (public https only); Mac-side address guard |
| `checks.mjs` (`artifactHash`, `buildConfigHash`) | SHA-256 manifest of every publish file; build-config binding |
| `release.mjs` | identity per provider, re-hash around uploads, pid+start-time lock |
| `util.mjs` (`publishIncludes`, `pidStartTime`, `processHolds`) | shared publish filter; lock liveness |

### New cloud pieces

| Piece | Purpose |
|---|---|
| `_shared/netguard.ts` | public-address classification (v4/v6, mapped, NAT64), URL policy, HTTP/1.1 client pinned to the validated address (TLS by SNI), same-site redirects re-validated |
| `_shared/credits.ts` (`reconcileHolds`, `pricingVersion`) | abandoned holds released after 15 min; price-table version |
| `functions/monitor` | register (ownership = tenant's own live host), status (scheduler never / running / stale), incidents, test, cron `run` |
| `functions/billing` (`usage`, `sync`) | server-authoritative usage report; subscription recovery from Paddle |
| `functions/ai-fix` (`operationId`) | idempotent operations, pricing version on usage and charges |
| `schema.sql` | `monitor_targets`, `monitor_probes`, `monitor_incidents`, `monitor_heartbeat`; `ai_usage.operation_id / pricing_version`; `credit_ledger.pricing_version` |
| `monitor-cron.sql` | pg_cron + pg_net + Vault schedule for the scheduler |

## 2. Setup (owner, once)

1. **Database**: run `supabase/schema.sql` in the SQL editor (idempotent; adds the monitoring tables and the
   usage columns to an existing V10/V11 database).
2. **Functions**: `supabase functions deploy admin ai-fix account`, `supabase functions deploy billing
   --no-verify-jwt`, `supabase functions deploy monitor --no-verify-jwt`.
3. **Secrets**: `supabase secrets set ANTHROPIC_API_KEY=… PADDLE_API_KEY=… PADDLE_WEBHOOK_SECRET=…
   PADDLE_ENV=sandbox MONITOR_CRON_SECRET=<long random string>`.
4. **Scheduler**: edit the two placeholders in `supabase/monitor-cron.sql` and run it. Verify with
   `select * from monitor_heartbeat order by at desc limit 3` after 5–10 minutes. Until a heartbeat exists the
   app says the cloud scheduler has never run — it does not pretend.
5. **Paddle** (sandbox first): products/prices, price ids into `settings.billing.catalog`, webhook destination
   `<SUPABASE_URL>/functions/v1/billing` with the events listed in `supabase/functions/README.md`.
6. **Build**: `zsh scripts/bundle-node.sh` (downloads and verifies Node for arm64 + x86_64 into
   `engine/runtime`, ~110 MB each, git-ignored), then `zsh Rebuild.command` or `zsh scripts/release.sh`.
   `release.sh` bundles the runtime itself unless `BID_SKIP_NODE_BUNDLE=1`.
7. **Signing / notarization**: `BID_SIGN_IDENTITY` + `BID_NOTARY_PROFILE` (docs/release.md). Without them the
   DMG is ad-hoc signed: fine for the owner's test, not for the public.

## 3. Migrations

| Area | Change | Backwards compatibility |
|---|---|---|
| Engine state | new files `chats/`, `undo/`, `ai-settings.json`; `monitor-settings.json` gains `maintenance`, `channels`; `state.check.buildConfig`, `state.lastRecheck`, `ops/*.json` gain `identity` | additive; old files load unchanged; `state.aiUndo.file` may still point at the old cache location (read-only) |
| Undo records | moved from the cache/log folder to `Application Support/undo/<project>/` (0700/0600) | old records in the cache are ignored |
| Cloud schema | 4 monitoring tables; 2 columns on `ai_usage`, 1 on `credit_ledger`; unique partial indexes | `schema.sql` is idempotent; no data rewrite; existing rows get NULL pricing_version |
| Prompts | `engine/prompts` is now part of the engine bundle (build.sh copies it; the app installs the whole engine folder) | an engine without `prompts/` answers `prompt_not_found` for assistant actions |
| Launcher | `engine/bid` prefers `engine/runtime/<arch>/bin/node`; falls back to PATH / nvm / volta as before | a build without the runtime behaves exactly like V11 |

## 4. Recovery and operations

| Situation | What happens | What to do |
|---|---|---|
| Engine dies mid-release | the lock holder (pid + start time) is gone → the op is marked `interrupted`; `release status` asks Netlify what is published | run `release status`; start a new preview |
| Files change during upload | the artifact is re-hashed before and after the upload → `stale_release` (`release.changedDuringUpload`), nothing published | re-run the preview |
| AI request crashes server-side | the hold is released by `reconcileHolds` on the next request or usage read (≤ 15 min), usage row `orphaned` | nothing; "Plan & usage" shows the released reservation |
| Client retries an AI call | same `operationId` → `409 duplicate_operation` with the recorded outcome, no second charge | the engine treats it as the answer |
| Missed Paddle webhook | plan/period stale | Plan & usage → "Sync with provider" (`billing sync`) |
| Cloud scheduler stops | `monitor_heartbeat` stops advancing → status `stale`, app says only the Mac checks | check `cron.job_run_details`; re-run `monitor-cron.sql`; check the function logs |
| Webhook channel down | delivery result recorded in the pass result (`delivered[].ok=false`), never blocks monitoring | "Send test" from the card |
| Model provider outage | `ai_timeout` / upstream 502, nothing changed, nothing billed (cloud releases the hold) | retry later |
| Bad AI answer | validation rejects it, one repair round, then `invalid_output` — nothing applied | ask again with more files/context |
| Regression after an AI fix | the engine undoes the change (`stopped: regression`) | nothing; the file is back |

Logs: engine `~/Library/Logs/BeforeIDeploy/engine.log` (argv redacted), per-project logs in
`~/Library/Caches/BeforeIDeploy/<project>/`, assistant conversations in `Application Support/chats/`
(never in the support report), cloud function logs in the Supabase dashboard.

## 5. Tests and how to run them

```
node tests/run.mjs > /tmp/eng.txt; tail -1 /tmp/eng.txt      # engine (fake Netlify, fake model, fake cloud)
deno test --allow-env --allow-net supabase/functions           # Edge Functions incl. netguard
cd tests/rls && npm install && node rls.mjs                    # RLS on PGlite (real Postgres)
cd App && swift test                                           # macOS only; CI app.yml
node scripts/i18n-check.mjs && node scripts/error-codes.mjs
```

CI: `engine.yml` (Linux), `engine-macos.yml`, `app.yml` (build + tests + bundled engine check), `functions.yml`
(deno check + test + the RLS job).

## 6. Known limits at handoff

See `docs/RELEASE-CANDIDATE-AUDIT.md §4` — the honest list, with the owner decisions each one needs.
