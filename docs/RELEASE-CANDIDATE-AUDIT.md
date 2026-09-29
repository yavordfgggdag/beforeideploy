# Release-candidate audit — Before I Deploy 11.0.0-rc.1

Branch `claude/nifty-edison-1195gi` · release commit: see the last line of this file · date 2026-09-29.
Every requirement of the completion brief, with its status, the evidence that proves it and the blocker
when there is one. Evidence classes are kept apart: **unit/mock**, **sandbox integration** (fake CLI / fake
cloud / local server), **real-provider integration**, **manual UX**. A row without evidence says
"unverified", never ✅.

Status vocabulary: ✅ done and proven · ⚠️ done, proof limited (says how) · ⏳ not done · ⛔ blocked (says on what).

## 0. Baseline (what was true before this work)

| Check | Result | Class |
|---|---|---|
| Branch / commit | `claude/nifty-edison-1195gi` at `d20ad05`, clean tree, no dirty changes lost | — |
| `node tests/run.mjs` | 85 passed (Linux; macOS runner green on `a44dc2f`) | unit/mock + sandbox |
| `deno test supabase/functions` | 68 passed | unit/mock |
| `swift build && swift test` | 44 tests, green in CI (macos-15) on `a44dc2f`; no Swift toolchain in this container | CI |
| `scripts/i18n-check.mjs`, `scripts/error-codes.mjs`, `schema.sql` in PGlite | ✅ | unit |
| Real providers reachable from this environment | Netlify ✗, Paddle ✗ (network policy), Anthropic API host reachable but no key here | — |
| Map of flows | AI: own key (Anthropic/OpenAI) or cloud `ai-fix` with plan gates and holds · auth: Supabase e-mail + OAuth providers · billing: Paddle hosted checkout/portal, webhooks with signature/dedupe/ordering, credit ledger with holds · usage: `billing status` (balances + 20 ops) · admin: settings table, roles, audit · monitoring: Mac-only (app timer / launchd) · hosting: Netlify (preview/publish/rollback), Vercel/Cloudflare/GH Pages (deploy only) | code reading |
| Existing but undocumented before | `credit_bucket_balance` view, yearly lazy grants, trial claims by e-mail hash, `deploy --recheck-if-stale` | — |

## 1. Completion tracker

### §2 Architecture and known risks

| Requirement | Status | Evidence | Class |
|---|---|---|---|
| App → engine → network; NDJSON; BG/EN; zero npm deps in the engine | ✅ | no new imports outside `node:*`; `scripts/i18n-check.mjs` ✅ (536 engine / 1015 app keys); CI `engine.yml` | unit |
| Real states unchecked / stale / unsupported / disconnected kept | ✅ | `overview.mjs` signals unchanged; monitor `unchecked: maintenance`; cloud `scheduler.state never/stale`; `BackupCard` disconnected | unit/mock |
| Re-check of fixes, typed confirmation for production, reconcile before retry | ✅ | tests `release: повторен promote…`, `…умрял процес…`, `ai: undo … --recheck` | sandbox |
| **SHA-256 streaming of all artifact files, no size+mtime, stable manifest** | ✅ | `checks.mjs artifactHash/fileSha256`; test `artifact: SHA-256 manifest…` (9 MB file, same size+mtime, one byte differs → different hash; rename → different hash; manifest sorted POSIX paths with size/sha256/type) | unit |
| Release bound to source snapshot + build configuration + artifact + provider deploy id; change between check and upload prevented; verified at publish | ✅ | `release.mjs snapshotMatches` (source → buildConfig → artifact), `assertArtifactUnchanged` before/after every upload, `op.identity`; tests `release: файл, променен по време на качването…` (fake CLI mutates a file mid-upload → `stale_release`, nothing published), build-config change → stale, `…публикува точно провереното preview` | sandbox |
| SSR: verifiable identity or explicit limit; `artifact: null` ≠ verified | ✅ | identity `deployId` on Netlify (publish by id), `none` elsewhere → `release_unsupported` (`release.identityUnsupported`); test `release: SSR проект…` | sandbox |
| Concurrency, stale locks, PID reuse, crash recovery | ✅ | lock `{pid, pidStart}` + `processHolds`; test `release: заключване…` (live holder refused; same pid + other start time → taken over, op `interrupted`; dead pid) | unit |
| Undo content isolated: permissions, retention, out of support export / telemetry / AI context | ✅ | `ai/index.mjs writeUndoRecord` (Application Support/undo, 0700/0600, keep 10, 30 d); tests: permissions, no copy in cache, report has no undo/patch files; AI context reads project files only | unit |

### §3 Embedded AI assistant

| Requirement | Status | Evidence | Class |
|---|---|---|---|
| Workspace tied to the site and issue; actions explain / propose / apply+verify / readiness / triage (+ review, ask) | ✅ (UI compiled only in CI) | `assistant.mjs` ACTIONS; `AssistantView.swift` | unit + CI build |
| Conversation history per project, clear active site | ✅ | `chats/<project>.jsonl` (0600), `ai history`, `ai reset`; test asserts file mode and entries; view header shows the site | unit |
| Streaming through compatible engine events | ✅ | `ai` delta events, `step assistant-*`, `info context` — same NDJSON as AI Fix | unit |
| Visible stages: analysis / proposal / apply / verify / done-failed-interrupted | ✅ | stage events with status pass/fail/skipped; interrupted stream → error result; app `stagesCard` | unit |
| Context: findings, selected files, build logs, diff, deployment status | ✅ | evidence kinds issue/log/file/git/diff/incident; readiness uses ops + capabilities | unit |
| List of what will be sent; size limits; secret removal | ✅ | `info.context.evidence[{id,kind,label,chars,redactions}]`, `maxFileChars/maxFiles/maxContextChars`, `redact()`; test `ask-secret` (request body carries `[API_KEY]`, never the key) | unit |
| Diff, risk, test plan, undo for every proposed change | ✅ | patch file with `planned[].diff`, `risk`, `verification_plan`, `rollback_notes`; apply through `ai apply` → undo record | unit |
| Stop/cancel, timeout, bounded iterations, budget per operation | ✅ | SIGINT → exit 130 + history `cancelled`; `callTimeoutMs` → `ai_timeout`; `maxIterations` (1–5); `maxTokensPerOperation`, `budget_exceeded` before any request | unit |
| Preserved user edits; re-plan on changed files | ✅ | base hashes checked against snapshot and disk → `stale_base_hash`; apply re-plans (`changedSince`) | unit |
| Proposal ≠ applied ≠ verified | ✅ | result fields `patchFile / applied / recheck.verified`; app shows three distinct lines | unit |
| Current provider used; no invented model ids / prices | ✅ | providers unchanged (`ai.models` settings); the engine never names a model itself for the cloud path | code |
| Managed keys server-side; none in the native bundle | ✅ | unchanged `ai-fix` function; `build.sh` copies no secret | code |
| Actions only via engine tools with validated arguments; no model text → shell | ✅ | the model never calls tools; the app runs `ai apply / check / undo` after validation; `changes[].path` validated against allowed paths; test `propose-outside` | unit |
| Untrusted content cannot change rules / permissions / recipients | ✅ (guardrail proof) | system prompt states it; validation rejects out-of-scope paths and unknown evidence; test `ask-injection` (README instruction → no deploy, no release op) — the model's judgement itself is not provable here | unit |
| No hidden chain-of-thought; short reasons, evidence, actions, results | ✅ | structured fields only; raw text shown only when rejected | unit |
| Automation policy: propose by default; opt-in auto-apply low-risk with limits; never deploy/restore/billing/delete/secrets | ✅ | `ai-settings.json autoApplyLowRisk=false`; `fix` needs `--yes` or low risk + setting; those operations are not assistant actions; test `fix цикъл` | unit |
| Bounded analyze → patch → verify; stop on no improvement / regression / budget | ✅ | tests: `no_progress` after 2 attempts, `regression` → undone, `budget` | unit |
| Prompt templates as versioned resources with id, version, schemas, localized titles | ✅ | `engine/prompts/*.v1.json`, `ai prompts`; `docs/AI-PROMPTS.md` | unit |
| Evaluations: injection, secret, nonexistent file, malformed output, stale base hash, interrupted stream, claimed test run, unauthorized deploy, no-progress loop, BG/EN | ✅ | `tests/ai-evals/*` + 6 assistant tests (20 scenarios) | unit/mock |
| Real model run | ⛔ | no API key / cloud in this environment | owner (acceptance test §4) |

### §5 Usage, credits, plans

| Requirement | Status | Evidence | Class |
|---|---|---|---|
| Server-authoritative Plan & usage: plan, billing status, included, used, reserved, remaining, purchased apart, renewal in user TZ, rate limits, history, buttons | ✅ (UI compiled only in CI) | `billing usage` (`usageOf`), Deno test `billing: usage is server-authoritative…`; `PlanUsageView.swift` formats with `TimeZone.current` | unit/mock |
| No mixing of tokens / credits / currency; no invented 5-hour/weekly limits | ✅ | `unit: "tokens"`; limits are the backend's own (`ai.rate`, `ai.dailyCapPercent`) | unit |
| Estimate before, real cost after; pending + reconciliation when the final usage is missing | ✅ | `info.context.estimateTokens`; usage after; `status pending → orphaned` via `reconcileHolds`; app shows "in flight / abandoned" | unit |
| Transactional ledger, integer units, operation id, pricing version, unique external ids | ✅ | schema: `ai_usage.operation_id` (unique per user), `pricing_version`; `credit_ledger.pricing_version`; `credit_ledger_once` | schema + RLS test |
| reserve → execute → settle/release; crash recovery; orphaned holds expire | ✅ | `ai-fix` hold flow (V10) + `reconcileHolds` (15 min); Deno tests `hold abandoned by a crashed request…` | unit/mock |
| Atomic reservation / no negative balance under concurrency | ✅ (existing) | Deno test `parallel requests see each other's reservations…` | unit/mock |
| Exactly one charge per logical operation; duplicate detection; bounded retry | ✅ | `409 duplicate_operation / operation_in_progress`; Deno test `same operation id never bills twice` | unit/mock |
| Idempotent grants (purchase, included, period renewal); refunds/chargebacks as separate rows; immutable ledger | ✅ (existing, documented) | `credit_ledger_once`, adjustment webhooks; `docs/BILLING-AND-USAGE.md §2` | unit/mock |
| Spend order / expiry / upgrade documented | ✅ | `docs/BILLING-AND-USAGE.md §2, §5` — pack 12-month expiry is policy without an enforcing job (owner decision) | — |
| Paddle: hosted checkout/portal; backend validates items; redirect ≠ payment; webhook cases; sync after missed webhook | ✅ | existing webhook tests + new `billing sync` test; `docs/BILLING-AND-USAGE.md §6` | unit/mock |
| Proration/tax from provider; plan-change effect shown | ⚠️ | portal handles it (Paddle UI); the app does not render a pre-change quote (Paddle exposes it in the portal) | — |
| Exhausted credits do not block project / history / backups / recovery | ✅ | only AI calls return `quota_exhausted`; nothing else checks credits | code |
| Payment test mode from checkout to the visible balance | ⛔ | Paddle unreachable from here; fake Paddle in Deno tests | owner (acceptance test §7) |

### §6 Server-side monitoring

| Requirement | Status | Evidence | Class |
|---|---|---|---|
| Runs when the app is closed and the Mac sleeps, on the existing cloud stack | ✅ built, ⛔ inactive until scheduled | `functions/monitor` + `monitor-cron.sql`; status reports `scheduler.state never` until the first heartbeat | unit/mock + owner |
| Site ownership / authorization, tenant-scoped config | ✅ | register requires the URL host = the tenant's own `bid_projects.live_url/domain`; Deno test (other tenant → 404/403); RLS test | unit/mock + RLS |
| Scheduler, bounded workers, timeouts, retries, dedupe, recovery | ✅ | batch 25 per run, 5 s timeout, confirm after 2, one open incident per (target, kind), recovery; heartbeat; Deno tests | unit/mock |
| Availability, SSL expiry, important pages, deployment verification, backup freshness, domain expiry | ⚠️ | cloud: down / ssl (when the runtime exposes the certificate) / page; Mac: down / ssl / domain (Spaceship); backup freshness: `unsupported` (no provider); deployment verification is the release flow's job | unit/mock |
| Shows where it runs, last/next run, frequency, plan, retention; scheduler heartbeat | ✅ | `monitorStatusMerged` → `runsOn mac/cloud/both`, `cloud.scheduler`, `nextRunAt`, `retentionDays`; app card | unit/mock |
| SSRF: exclude loopback/private/link-local/metadata (v4/v6), DNS + redirects, rebinding addressed at network level, no credentials to redirects | ✅ | `netguard.ts`: resolve → classify every address → `Deno.connect` to the validated IP → `startTls(hostname)`; redirects re-run the procedure; no auth headers; Deno tests (connected IP recorded, private/mapped/NAT64/metadata refused, off-site redirect refused, timeout bounded) | unit |
| Local-only mode separated; cannot widen the cloud worker | ✅ | `allowPrivate` only via deps in tests; `index.ts` never sets it; engine webhook test switch `BID_TEST_ALLOW_PRIVATE_WEBHOOK` (Mac side only) | unit |
| Local/cloud incidents merged without duplicates; maintenance windows; quiet hours; notifications only via configured channels; test recipient | ✅ | `monitorStatusMerged` dedupe by project+kind with `source`; `maintenance` windows; `channels.webhook` (https public only) + `notify test`; engine tests `monitor cloud…`, `monitor: прозорец за поддръжка…` | sandbox |
| Unified operations history with actor ids; no sensitive content | ⚠️ | engine history: kinds check / fix / ai-fix / ai-apply / ai-undo / assistant / release / rollback / draft / production; cloud actions carry `user_id` (ai_usage, incidents, billing events); one merged screen across Mac + cloud is not built — the pieces are on Dashboard (history), Plan & usage (cloud AI/billing) and Monitoring (incidents) | — |

### §7 Hosting, backups, boundaries

| Requirement | Status | Evidence | Class |
|---|---|---|---|
| Netlify as the proven release provider | ✅ sandbox / ⛔ real | fake `netlify` CLI + sandbox host: preview → promote → verify → rollback, interruption, mid-upload change (11 release tests) | sandbox + owner |
| Other providers not marked ready | ✅ | `CAPABILITIES` unchanged (no rollback/status/publishArtifact); SSR refused | unit |
| CodeGuard disconnected until API/agreement; not silently dropped | ✅ | `providers/backup/codeguard.mjs` unchanged; listed as ⛔ blocker below | — |
| Restore shows target/timestamp/scope/impact with separate confirmation; files rollback ≠ database | ✅ (rollback) / n/a (backup restore) | `ReleaseViews RollbackSheet` (typed ROLLBACK, note "files only") | unit + CI build |
| Smoke tests never submit real orders/payments | ✅ | `postdeploy.mjs` GET only; no form submission implemented (documented limit) | code |

### §8 Native UX and installability

| Requirement | Status | Evidence | Class |
|---|---|---|---|
| Onboarding: welcome → account/local → project → hosting → first scan → AI → preview → monitoring | ✅ (compiled only in CI) | `OnboardingViews.swift FirstStepsCard` (7 steps, BG/EN) | CI build |
| Main areas: sites, AI assistant, issues, deployments, monitoring, backups, activity, plan/usage | ✅ | sidebar: Mission Control, AI assistant, Plan & usage, …; Dashboard cards | CI build |
| Light/dark, window sizes, long BG text, keyboard, focus, VoiceOver, empty/loading/offline/error/expired states; status not by colour alone | ⚠️ | states coded (loading / empty / error / signed-out / unavailable); icons + text on every status; accessibility labels on new controls — **visual and VoiceOver checks need a Mac** | manual (owner) |
| Installable build for both architectures; runtime bundled; no developer Node assumed | ✅ script / ⛔ unexercised | `scripts/bundle-node.sh` (SHASUMS256 verified), `build.sh` copies `engine/prompts` + `engine/runtime`, launcher prefers the bundled runtime; universal binary via `release.sh` — needs a Mac to run | owner |
| Signing, notarization, Gatekeeper, upgrade/migration, uninstall | ⛔ signing / ✅ scripts | `release.sh` refuses to notarize without credentials and says so; update feed + sha256 (V10); `uninstall.sh --all` removes agent/keys | owner |

### §9 Evidence and tests (final numbers)

| Suite | Result | Class |
|---|---|---|
| `node tests/run.mjs` | 97 passed, 0 failed (Linux, Node 22; macOS runner in CI) | unit/mock + sandbox integration |
| `deno test supabase/functions` | 80 passed | unit/mock |
| `tests/rls/rls.mjs` (PGlite) | 8 passed — user A / user B / anonymous / service role on every table incl. the monitoring tables | real Postgres, in-process |
| `swift test` | 44 (CI) | CI |
| `i18n-check`, `error-codes`, `schema.sql` twice in PGlite | ✅ | unit |
| Real-provider integration (Netlify, Paddle sandbox, Anthropic) | ⛔ not run from this environment | owner |
| Manual UX on a real Mac | ⛔ not run | owner |

## 2. Blockers for "ready for public release" (owner)

1. **Signing and notarization** — Developer ID certificate + notary profile (`docs/release.md §1`). Until then
   every build is unsigned.
2. **Real walkthrough on a Mac** — `docs/OWNER-ACCEPTANCE-TEST-BG.md` (Netlify test site, Supabase project,
   Paddle sandbox, real model). Fixture decoding and CI builds do not replace it.
3. **Cloud scheduler activation** — run `supabase/monitor-cron.sql`; verify `monitor_heartbeat`.
4. **CodeGuard** — no API documentation, credentials or agreement: the backup area stays "not connected".
   If it is a first-release requirement it is a blocker; it was not removed from the criteria.

## 3. What is "ready for the owner's test"

The candidate can be built as a universal .app with a bundled runtime, installed without Node, and the main
flows — add site → check → issues → AI proposal → apply + verify → preview → DEPLOY → verify → rollback →
monitoring (Mac + cloud once scheduled) → plan & usage → checkout (sandbox) — are implemented end to end and
covered by the suites above. Status: **ready for the owner's test**, not ready for public release.

## 4. Honest limits carried into the test

- Cloud SSL expiry needs the Deno runtime to expose the peer certificate (`handshake().peerCertificate`);
  where it does not, the cloud reports no `ssl` kind and the Mac's check remains the source.
- Pack expiry after 12 months is policy, not an enforced job.
- No pre-change quote for plan changes inside the app (Paddle's portal shows it).
- No single merged "activity" screen across Mac and cloud.
- Smoke checks do not exercise forms.
- Light theme is still on the roadmap.

## 5. Release commit

Engine 97 / Deno 80 / RLS 8 / Swift 44 (CI) at the commit that carries this file (`git log -1 -- docs/RELEASE-CANDIDATE-AUDIT.md`); CI runs `engine.yml`, `engine-macos.yml`, `app.yml`, `functions.yml` on every push.
