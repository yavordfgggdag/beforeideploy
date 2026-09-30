# Before I Deploy V11 — handoff (architecture, commands, migrations, configuration)

Read after `docs/HANDOFF-V10.md` (which still describes every module that V11 did not change). This file covers
what V11 added or changed, how to run and verify it, and what the next developer must not break.

Branch `claude/nifty-edison-1195gi` · version `11.0.0-dev` · macOS 13+, Node 18+, zero npm dependencies.

## 0. Status at handoff (commit `a44dc2f`)

| Check | Result | Where |
|---|---|---|
| `node tests/run.mjs` (Linux + macOS runners) | ✅ 85 passed, 0 failed | CI `engine.yml`, `engine-macos.yml` |
| `cd App && swift build && swift test` (macos-15) | ✅ build ok, 44 tests, 0 failures | CI `app.yml` run 34 |
| Bundled engine inside the `.app` | ✅ `bid version` → `11.0.0-dev` | same job (audit B1 step) |
| `deno test supabase/functions` | ✅ 68 passed, 0 type errors | local + CI `functions.yml` (unchanged code) |
| `scripts/i18n-check.mjs` · `scripts/error-codes.mjs` | ✅ 499 engine keys, 825 app keys, 73 codes | CI |
| Real Netlify account, real Mac walkthrough | ⏳ not done from the cloud container | owner (see §8) |

Companion documents: `docs/AUDIT-V11.md` (baseline, gap analysis, evidence per requirement, acceptance criteria,
limitations), `CHANGELOG.md` 11.0.0, `ROADMAP.md` §2.

## 1. What V11 is

A control centre for the websites of maintenance clients. The primary flow, each step backed by a command:

| Step | Command | Where the truth lives |
|---|---|---|
| add a site | `bid project add --path P` · `bid project client --project K --name N` | `projects.json` (`client` field) |
| understand its state | `bid status --project P` · `bid overview` | `state/<key>.json`, `monitor.json`, registrar |
| prioritized issues | `bid issues --project P` (also in `status.issues`) | derived from `state.check` by `issues.mjs` |
| review proposed fixes | `bid fix list` · `bid ai fix` (unchanged) | fixes.mjs, ai/ |
| apply and verify | `bid fix apply ID --yes --recheck` · `bid ai apply … --recheck` · `bid ai undo --yes` | re-runs `runChecks`, undo record in the log dir |
| preview | `bid release preview --project P` | `ops/<id>.json` (state `awaiting_confirmation`) |
| publish | `bid release promote --project P --op ID --confirm DEPLOY` | Netlify `restoreSiteDeploy` of the preview deploy |
| watch | `bid monitor once` · `bid monitor status` · `bid monitor incidents` | `monitor.json`, `incidents.jsonl` |
| restore | `bid release rollback --project P --confirm ROLLBACK [--deploy ID]` | Netlify published deploy |

Architecture rules from V10 still hold: SwiftUI never talks to the network; every action is an engine command
emitting NDJSON; the engine has no npm dependencies; both languages in every catalog.

## 2. New engine modules

### 2.1 `engine/src/issues.mjs` — unified issues

`deriveIssues(check, ctx) → { issues[], counts, checkedAt, partial }`. Pure: reads a stored check result. Issue:

```
{ id, step, rule, severity: blocker|high|medium|low|info, kind: defect|recommendation|signal,
  confidence: confirmed|likely|heuristic, title, impact,
  evidence: { file?, line?, resource?, detail?, log? },
  fix: { type: safe|ai|ui|manual, id?, risk: low|medium|high } | null,
  verify: { steps: [checkStepIds] }, blocksRelease }
```

Rules are in `fromStep()`; texts are catalog keys `issue.<step>.<rule>.title|impact` (the literal list
`RULE_KEYS` keeps `scripts/i18n-check.mjs` and the engine catalog test honest). The secrets step now returns
structured `findings` (`tracked-env`, `unignored-env`, `secret` with file/line/kind/masked sample); the app never
parses detail text. `FIX_VERIFIES` maps each safe fix to the steps that prove it. Sorting: severity → confidence →
step order (build, secrets, deps, git, typecheck, lint, hosting).

To add a rule: add a branch in `fromStep`, two catalog keys (en + bg), a line in `RULE_KEYS`, a test.

### 2.2 Verified fixes (`fixes.mjs`, `ai/index.mjs`)

- `applyFix(project, id, { yes, recheck })` → `{ id, summary, recheck?: { status, at, steps, verified, resolved[], unresolved[] } }`.
  `verified` is true only when every issue that pointed at this fix is gone **and** the verifying steps are not
  `fail`. The full check runs (with the incremental cache) — a partial re-check would leave a misleading `state.check`.
- `aiApply(project, { patchFile, files, yes, commit, recheck })` → adds `undoFile` and `recheck: { status, step, stepStatus, verified, at }`.
  Before writing, the previous content of every file is saved to `<logDir>/ai-undo-<ts>.json` and
  `state.aiUndo = { file, at, step, applied }`.
- `aiUndo(project, { yes })` → `{ restored[], skipped[{ path, reason: changed_since|… }] }`. A file whose content is
  no longer exactly what the patch wrote is left alone (user edits are preserved).
- Path safety is unchanged (`patch.mjs safePath`: inside the project, case-insensitive blocklist, no symlinks).

### 2.3 `engine/src/checks.mjs` — artifact hash

`artifactHash(dir, publishDir) → { hash, dir, files, bytes } | null` (content sha1 of every file under the
publish dir; > 8 MB files by size+mtime; null for SSR). `runChecks` stores it as `check.artifact` next to
`check.fingerprint`. A release binds to both.

### 2.4 `engine/src/postdeploy.mjs` — smoke checks

`smokeTest(baseUrl, { paths, useSitemap, maxPages, timeoutMs, requireHttps }) → { ok, url, at, checks[{ url, ok, status, ms, reason }], pages }`.
GET with an 8 s timeout, at most 3 redirects and only within the same site (or its `www.` twin) — a redirect
elsewhere is `redirect_offsite`. Home page must be 200 with a `<title>`; https is required when the base is https;
`sitemap.xml` entries on the same site (max 10) and `bid.config.json → postdeploy.urls` are fetched too. One failed
page = failed verification. `writeSmokeLog` writes a readable log next to the deploy logs.

### 2.5 `engine/src/release.mjs` — operations

Op record `ops/<id>.json`:

```
{ id, kind: release|rollback, project, provider, actor: app|cli, createdAt, updatedAt,
  state: created → preview_running → awaiting_confirmation → promoting → verifying → succeeded
         | failed | verify_failed | cancelled | stale | interrupted,
  stages: [{ id: check|preview|smoke|promote|verify, status, summary, details?, log?, startedAt, finishedAt }],
  snapshot: { fingerprint, artifact, at }, check, preview: { url, deployId, at },
  smoke, production: { url, deployId, previousDeployId, at }, verify, confirmation: { typed, at, by },
  rollback: { available, deployId?, reason?, restores: 'files', note }, failure?, log[] }
```

- **Lock** `ops/<projectKey>.lock` `{ op, pid, at }`: a second release while the pid is alive →
  `release_in_progress`; a dead pid marks its op `interrupted` and the lock is taken over.
- **Promote** refuses unless `awaiting_confirmation`; re-verifies `snapshot` (`stale_release` with reason
  source / artifact); on Netlify publishes the preview deploy itself (`restoreSiteDeploy`) and reads the site back
  to confirm the published id; other providers re-deploy the unchanged artifact. Repeated promote on a finished op
  returns it; on `promoting|verifying` it calls `reconcile()` which asks Netlify which deploy is published.
- **Verify** = `smokeTest(productionUrl)`; failure → `verify_failed` with `rollback` filled — never `succeeded`.
- `releaseStatus` reconciles orphaned ops (lock holder gone), lists host deploys (`netlifyDeploys`), the
  published deploy (`netlifySiteState`) and the rollback target (latest ready production deploy that is not the
  published one).
- `CAPABILITIES` per provider is what the app shows; `publishArtifact` is Netlify-only today.
- History entries: `release` (ok/fail), `production` (publishedPreview), `rollback`; every op keeps `actor` and
  `confirmation` — who/what/result/confirmation for the audit trail.

Netlify adapter additions (`netlify.mjs`): `netlifyApi`, `netlifyDeploys`, `netlifySiteState`, `netlifyGetDeploy`,
`netlifyPublishDeploy`. All go through `netlify api <method> --data`.

### 2.6 `engine/src/monitor.mjs` — monitoring and incidents

- `monitorOnce({ project })`: HEAD (GET on 405/501) with `timeoutMs`, one retry after 1.5 s; failure streak per
  project; incident opened only when `failures >= confirmFailures` (2); one open incident per project + kind;
  `ongoing` increments `count`; a passing probe resolves it (`recovered`). SSL once a day per host (< 14 d or expired
  → incident). Domains once a day through Spaceship (< 30 d → incident keyed `domain:<name>`). Notifications via
  `ev.notify` only for enabled kinds and outside quiet hours.
- Files: `monitor.json` (samples, streaks, `lastRunAt`, `lastRunBy`), `incidents.jsonl`, `monitor-settings.json`
  (`intervalMin` 5–1440, `timeoutMs`, `confirmFailures`, `notify.{down,ssl,domain,recovered}`, `quietHours`).
- `monitorStatus()` → `{ runsOn: 'mac', serverSide: false, settings, agent, lastRunAt, stale, openIncidents, recentIncidents }`.
- `agentInstall({ yes })` writes `~/Library/LaunchAgents/bg.yavor.beforeideploy.monitor.plist`
  (`bid monitor once` every `intervalMin`, `BID_MONITOR_AGENT=1`) and loads it; `agentRemove()` unloads and deletes.
  macOS only, consent required. The app's own loop (`AppModel.startMonitorLoop`) runs while the app is open and
  steps aside when the agent is installed.
- **Not implemented (in V11):** a server-side scheduler. When the Mac sleeps, nothing is checked; the UI says so. *Superseded in 11.0.0-rc.1: the `monitor` Edge Function and `supabase/monitor-cron.sql` check sites from the cloud once the owner runs the cron script (docs/AUDIT-V11.1-BETA-BG.md).*

### 2.7 `engine/src/overview.mjs` — portfolio signals

Each card gains `client`, `hosting`, `issues` (counts), `openIncidents`, `signals` and `nextAction`:

```
signals.{check,deploy,uptime,ssl,domain,backup} = { state: healthy|problem|unchecked|stale|unsupported, value, at, source, detail }
nextAction = { id: check|fix|release|connect-hosting|investigate|none, label }
```

`healthy` older than 6 h becomes `stale`; a missing measurement is `unchecked`; a signal that cannot exist for this
site (no live URL, no domain, no backup provider) is `unsupported`. With `--no-network` the uptime/SSL signals come
from the last monitoring pass (`source: 'monitor'`).

### 2.8 `engine/src/providers/backup/codeguard.mjs`

`backupStatus(project)` returns `connected: false, state: 'unsupported', missing: [...]` with the exact
configuration that does not exist yet (settings key `backup.codeguard.apiBase`, Keychain account `codeguard`, and
the API documentation / partner agreement). The adapter contract for a real integration is in the file header.
No endpoint is invented; nothing is simulated.

### 2.9 CLI additions

```
bid issues --project P
bid release preview --project P [--force] | promote --op ID --confirm DEPLOY | status [--op ID] | rollback --confirm ROLLBACK [--deploy ID] | cancel --op ID
bid fix apply ID --project P --yes [--recheck]     bid ai apply … [--recheck]     bid ai undo --project P --yes
bid deploy --project P [--recheck-if-stale]        (draft: re-check instead of stale_check)
bid monitor once [--project P] | status | incidents [--limit N] | settings --json '{…}' | agent install --yes | agent remove
bid backup status --project P
bid project client --project K --name N
```

New error codes (all in `docs/errors.md`): `release_in_progress`, `release_not_ready`, `stale_release`, `smoke_failed`.

## 3. App changes (`App/Sources/BeforeIDeploy`)

| File | What |
|---|---|
| `IssuesView.swift` | `IssuesCard` + `IssueRow` (severity pill, kind, impact, evidence, fix button by type, details with confidence / risk / verify steps / log / file) |
| `ReleaseViews.swift` | `ReleaseSheet` (start → stages → preview link → smoke list → typed DEPLOY → publish; last result with rollback), `RollbackSheet` (typed ROLLBACK), `DeploymentsCard` (host deploys, published marker, capabilities, recent ops) |
| `MonitoringViews.swift` | `MonitorCard` (where it runs, last run, agent toggle with consent alert, notify toggles, open / recent incidents), `IncidentRow`, `SignalPill`, `ClientSheet`, `BackupCard` |
| `LocalizedKeys.swift` | `K.*` literal switches for enum-like values (severity, state, stage, capability, signal state, incident kind) |
| `Models.swift` | `Issue*`, `FixApplyResult`, `AIRecheck`, `AIUndoResult`, `Release*`, `HostDeploy`, `Signal`, `NextAction`, `Monitor*`, `Incident`, `BackupStatus`; `ProjectStatus.issues/release/backup`; `Project.client/hosting/liveUrl` |
| `Stores/RunController.swift` | `release`, `loadRelease`, `startRelease`, `promoteRelease`, `rollbackRelease`, `cancelRelease`; `startRun(onDone:)`; `applyFix` uses `--recheck` and shows verified / unverified; `draftPreview` uses `--recheck-if-stale` |
| `Stores/AIStore.swift` | `--recheck`, verified / unverified toast, `undo()` |
| `AppModel.swift` | sheets `.release .rollback .client`; monitor: `loadMonitor`, `runMonitorOnce`, `startMonitorLoop`, `setMonitorAgent`, `setMonitorNotify`; `setClient` |
| `V7Views.swift` | Mission Control: search + client / hosting pickers + "needs action" / "problems"; `MonitorCard`; cards show client, signal pills, next action |
| `DashboardView.swift` | `IssuesCard` above the health grid; `DeploymentsCard` + `BackupCard` in Hosting; production button opens the release sheet |
| `SidebarView.swift` | context menu "Set client…" |

States covered: loading (spinners in release / deployments / monitor), empty (no issues, no deploys, no incidents,
no filter match), error (toasts with engine codes), offline (`overview --no-network` first paint; signals `stale`),
expired auth (unchanged `mustAuthenticate` flow). Keyboard: sheets keep Return / Esc; typed confirmations gate the
destructive buttons.

## 4. Migrations

- **Engine state**: additive only. `state.check.artifact`, `state.release`, `state.aiUndo`, `projects[].client`,
  new files `ops/`, `monitor.json`, `incidents.jsonl`, `monitor-settings.json`. Old state files load unchanged.
- **Cloud**: no schema change in V11. (`backup.codeguard.apiBase` is a future settings key; add it to
  `SETTINGS_KEYS` in `supabase/functions/admin/handler.ts` when the integration exists.)
- **Uninstall**: `scripts/uninstall.sh` boots out and deletes the monitor agent plist
  (`~/Library/LaunchAgents/bg.yavor.beforeideploy.monitor.plist`) before removing the engine.

## 5. Configuration

| Where | Key | Meaning |
|---|---|---|
| `bid.config.json` (project) | `postdeploy.urls: ["/", "/contact"]` | pages verified after every deploy (max 20, must start with `/`) |
| `monitor-settings.json` | `intervalMin`, `timeoutMs`, `confirmFailures`, `notify.*`, `quietHours {from,to}` | set with `bid monitor settings --json` |
| env | `BID_MONITOR_AGENT=1` | set by the launchd agent so `lastRunBy` says `agent` |
| Keychain | account `codeguard` (future) | backup provider token — never in argv or files |

## 6. Tests

- `node tests/run.mjs` — 85 tests. New: issues model + verified safe fix, build issue evidence, AI undo + verified
  re-apply, release flow (preview → stale → promote → idempotent promote → rollback available → verify_failed →
  rollback → lock / interrupted / cancel → host failure), `deploy --recheck-if-stale`, smoke checks (sitemap, 404,
  off-site redirect, timeout), monitoring (confirm after 2, ongoing, recovery, settings, agent consent),
  portfolio (client, signals vocabulary, next action, backup boundary).
  The Netlify CLI is a fake on `PATH` (`TMP/bin/netlify`) and the sandbox HTTP server serves the "deployed" files;
  mock ports are unique per run (`4300/4800 + pid % 400`).
- Swift: `cd App && swift test` — 44 tests (CI `app.yml`; the cloud dev container has no Swift). V11 added 8
  fixture-decode tests in `ModelsTests.swift` (issues, release preview / promote / status, monitor status, backup
  status, overview signals, status snapshot). Fixtures are regenerated with `BID_WRITE_FIXTURES=1 node tests/run.mjs`
  and live in `App/Tests/BeforeIDeployTests/Fixtures/`; regenerate them whenever an engine result shape changes.
- Deno: unchanged (68).

## 7. Do not break

1. A release publishes only the deploy that was smoke-tested; never re-upload on promote for Netlify.
2. `promote` must stay idempotent and must reconcile with the host before doing anything on `promoting|verifying`.
3. `verified` is computed by the engine from a full re-check; the app never infers success from "applied".
4. Monitoring never runs project checks; it only probes URLs. A single failed probe is never an incident.
5. `unchecked` / `stale` / `unsupported` are real states; do not map them to green.
6. Backups stay "not connected" until a real API is wired through the adapter contract.
7. All new user-facing text through the catalogs (`L`, `t`, `msg`); `K.*` for enum values in Swift.

## 8. Open work, in priority order (for the next developer)

Each item names the seam to build on; none of them requires touching the rules in §7.

1. **Real-provider walkthrough on a Mac** (blocking for release). `git pull && zsh Rebuild.command`; on a test site
   with a real Netlify account: check → `Release…` → preview link opens → smoke list → type DEPLOY → verify → the
   Deployments card marks the new deploy as published → `Rollback…` → the previous deploy is published again.
   Then `bid monitor agent install --yes`, sleep/wake the Mac, confirm `monitor.json.lastRunBy === 'agent'`.
   Anything that differs from the fake CLI (`tests/run.mjs` → `TMP/bin/netlify`) is a bug to fix in `netlify.mjs`.
2. **Server-side monitoring** (the only way to cover a sleeping Mac). Supabase `pg_cron` → edge function
   `monitor` that probes each project's `liveUrl` (SSRF guard: public https hosts only, no redirects off-site,
   5 s timeout, ≤ 1 probe per site per 5 min) and writes to a new `incidents` table with RLS by `user_id`.
   The engine then merges cloud incidents into `monitorStatus()` and marks `runsOn: 'cloud'`; the app text in
   `MonitorCard` (`monitor.noServerSide`) goes away only when that exists.
3. **Rollback / published-deploy for Vercel and Cloudflare Pages.** Both have APIs (`vercel promote`,
   Cloudflare `deployments/<id>/rollback`); add them behind `CAPABILITIES` and `netlifyPublishDeploy`-style
   adapters, then flip `rollback`/`status`/`publishArtifact` per provider. Do not enable a capability without an
   integration test against a fake CLI like the Netlify one.
4. **CodeGuard.** Needs API docs, a token and a partner agreement. Implement `status/list/request/restore` in
   `providers/backup/codeguard.mjs` per its header, store the token in the Keychain account `codeguard`
   (`bid backup connect`), add `backup.codeguard.apiBase` to `SETTINGS_KEYS`, and only then let `BackupCard` show a
   date. Restore must require a typed `RESTORE` and show what it affects before doing anything.
5. **Smoke checks beyond status/title** — forms (POST to configured endpoints with a dry-run flag), broken internal
   links (bounded crawl), Lighthouse (WP11) as an optional stage. Keep each page fetch bounded and same-site.
6. **`release preview` reuse of a fresh check** — if `state.check` is < N minutes old and the fingerprint +
   artifact hash match, skip the check stage (today it always re-runs, cached incrementally).
7. **External notification channels** (email / Slack) for confirmed incidents — user-configured only, through the
   existing `ev.notify` → app path; no default channel.
8. Roadmap leftovers: light theme, WP15 DNS providers, WP16 SFTP, WP11 Lighthouse. (WP10 site quality and WP19 templates shipped in 11.1 — `engine/src/site.mjs`, `launch.mjs`, `newsite.mjs`.)

## 9. How to verify a change to V11 quickly

```
node tests/run.mjs > /tmp/eng.txt; tail -1 /tmp/eng.txt      # 85 passed — never pipe, ~4 min
node scripts/i18n-check.mjs && node scripts/error-codes.mjs
BID_WRITE_FIXTURES=1 node tests/run.mjs                        # when an engine result shape changed
cd App && swift test                                           # macOS only; CI does it on every push
deno test supabase/functions                                   # only if cloud code changed
```

A release-flow change is proven by the eight `release:` tests; a monitoring change by `monitor:`; an issues-model
change by the two `issues:` tests and the Swift `testIssues…` decode test.

