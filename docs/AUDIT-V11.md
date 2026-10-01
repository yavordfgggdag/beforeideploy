# Before I Deploy V11 — audit: evidence and remaining limitations

Date 2026-09-29 · branch `claude/nifty-edison-1195gi` · baseline commit `f5814b8` (V10 handoff) · version `11.0.0-dev`.
Everything below was verified in this branch; "evidence" names the test or command that proves it.

## 1. Baseline (before V11 work)

| Check | Result | Note |
|---|---|---|
| Branch / tree | `claude/nifty-edison-1195gi` at `f5814b8`, clean, `origin/main` is an ancestor | the older `claude/nifty-euler-nw9yw2` branch (V9 + a skill file) was left untouched |
| `AGENTS.md` / `CLAUDE.md` | none in the repository | rules come from `AUDIT.md` §4, `ROADMAP.md` §10, `docs/HANDOFF-V10.md` §12 |
| `node tests/run.mjs` | ✅ 70 passed | Linux, Node 22 |
| `deno test supabase/functions` + `deno check` | ✅ 68 passed, 0 type errors | Deno 2.9 from the local tool cache |
| `cd App && swift test` | ⚠️ cannot run here — no Swift toolchain in the cloud container | run by CI `app.yml` on macos-15; last green run on `ac212df` |
| `scripts/i18n-check.mjs`, `scripts/error-codes.mjs` | ✅ | |

### Gap analysis at baseline

| Area | Working | Partial | Missing | Blocked |
|---|---|---|---|---|
| Portfolio | Mission Control cards, attention list | no client, no provenance per value, green when unchecked | search/filters, signal states, next action | — |
| Issues | 7 check steps with details and safe fixes | text-only details, no severity/confidence/verification | unified issue model | — |
| Fixes | safe fixes, AI patches, path safety, re-plan on changed files | no verification of the result, no undo | verified fixes, undo | — |
| Deploy | draft / production with typed DEPLOY + fresh check + fingerprint | no smoke checks, no verification after, no op record, double-click could double-deploy | preview→confirm→publish→verify flow, rollback, idempotency | — |
| Monitoring | uptime / SSL / domains in the overview when the screen refreshes | no confirmation, no incidents, no history, runs only on refresh | monitor pass, incidents, agent | server-side scheduler (needs cloud cron) |
| Backups / CodeGuard | — | — | — | no API, SDK, credentials or agreement exist |

## 2. What V11 delivers, with evidence

| Requirement | Implementation | Evidence |
|---|---|---|
| Unified issues (what / evidence / impact / severity / confidence / fix / risk / verification) | `engine/src/issues.mjs`, structured secrets findings in `checks.mjs`, `bid issues`, `status.issues`; app `IssuesCard` | tests "issues: единен модел…", "issues: неуспешен build…"; fixture `issues.json` |
| Blockers first; defects vs recommendations vs heuristics | `sortIssues`, `kind`, `confidence` | same tests (`issues[0].severity === 'blocker'`) |
| Fix verification, never "success" after a failed re-check | `applyFix --recheck` → `verified`/`unresolved`; `aiApply --recheck` → `recheck.verified`; app shows verified / unverified and marks the run failed | tests "issues: … --recheck доказва поправката", "ai: undo … --recheck" |
| Files changed after analysis | `aiApply` re-plans (`changedSince`), `aiUndo` skips `changed_since` | "ai: undo …" (user edit preserved) |
| Undo own changes | `ai undo --yes`, undo record per apply | same test |
| Path traversal / symlinks | unchanged `safePath` | V10 test "сигурност: AI промени не могат да пипнат…" |
| Release flow 1–8 (check → build → preview → smoke → confirm → publish same artifact → verify → result + rollback) | `engine/src/release.mjs`, `postdeploy.mjs`, Netlify `restoreSiteDeploy`; app `ReleaseSheet` | tests "release: preview → smoke…", "release: без DEPLOY…", fixtures `release-preview.json`, `release-promote.json` |
| Change after check invalidates readiness | `snapshot` (fingerprint + artifact hash) checked at promote → `stale_release`; `deployGuard` fingerprint (V10) | "release: промяна след preview…"; V10 "deploy: код, променен след проверката…" |
| No double publish on repeat / reconnect | lock per project, promote returns finished ops, `reconcile()` reads the host on `promoting|verifying` | "release: повторен promote…", "release: заключване…" |
| Interrupt / restart leaves no misleading status | `releaseStatus` marks orphaned ops `interrupted` after asking Netlify | "release: заключване — … умрял процес" |
| Rollback shown honestly (files only, availability, target) | `CAPABILITIES`, `rollback.restores: 'files'`, note text, `verify_failed` → rollback offered | "release: втори release прави rollback наличен…", "release: rollback иска ROLLBACK…" |
| Failed deploy / verification is not success | `verify_failed`, `failed` states; history `fail` rows | "release: грешка от хостинга…", "…провалена проверка на production не е успех" |
| Monitoring: timeouts, bounded retries, confirmation, dedupe, history, new/ongoing/recovered, severity & notify settings | `engine/src/monitor.mjs`, `monitor.json`, `incidents.jsonl`, `monitor-settings.json` | "monitor: потвърждава проблем след 2 неуспеха…"; fixture `monitor-status.json` |
| No full scans on the monitoring cycle | monitor only probes URLs | code: `monitorOnce` never imports `checks.mjs` |
| Where monitoring runs is explicit | `runsOn: 'mac'`, `serverSide: false`, app `MonitorCard` text, agent only with consent | test asserts `runsOn`/`serverSide`; agent needs `--yes` |
| Portfolio: client, search, filters, per-value source + time + state, no green without data, next action | `overview.mjs` signals / `nextAction`, `project client`; app filters, `SignalPill` | "portfolio: клиент, сигнали…"; fixture `overview.json` |
| Backups honest | `providers/backup/codeguard.mjs` → `connected: false`, `missing[]`; app `BackupCard` | same test; fixture `backup-status.json` |
| Secrets not in logs / AI payloads | unchanged V10 redaction + `engine.log` argv masking; new modules log no secrets (ops logs hold URLs and ids only) | V10 tests "logs & report…", "сигурност: redaction…" |
| Command injection | all new host calls go through `spawn` argument arrays (`netlify api … --data <json>`), never a shell string | code review of `netlify.mjs`, `monitor.mjs` |
| URL / redirect safety, SSRF | `postdeploy.fetchPage`: http(s) only, ≤ 3 redirects, same site only; monitor probes the project's own live URL only | "postdeploy: … redirect извън сайта се отказва, timeout" |
| Webhooks, AI usage on retries | unchanged from V10 (claimed events, holds released on failure) | Deno tests (68) |
| Audit trail | ops keep `actor` + `confirmation`; history rows `release` / `rollback` / `ai-undo` / `fix` | fixtures |
| BG/EN | 480 engine keys, 831 app keys, `i18n-check` ✅ | CI `engine.yml`, `app.yml` |

Test totals after V11: engine **85** (`node tests/run.mjs`), Deno 68, Swift 44 (CI: 36 + 8 new fixture-decode tests for issues, release, monitor, backup, overview signals). Mock ports are unique per
run, so an interrupted run can no longer poison the next one (found while working: a stale mock server made
`signup` and the smoke checks fail).

## 3. Acceptance criteria (§7 of the task)

| Criterion | Status |
|---|---|
| existing checks pass or limits explained | ✅ engine, Deno; Swift only in CI (no toolchain here) |
| main flow on a test project and a supported provider | ✅ Netlify, end to end against a fake CLI + sandbox host (`tests/run.mjs`) — **not** against a real Netlify account from this environment |
| change after scan blocks deploy until a new check | ✅ |
| failed fix / deployment never reported as success | ✅ |
| repeated request does not repeat the operation | ✅ (promote idempotent; lock) |
| interruption / restart leaves no misleading status | ✅ (`interrupted`, reconcile) |
| cloud access between clients verified | ✅ unchanged RLS + 68 Deno tests; V11 adds no cloud tables |
| secrets not in logs / AI payloads | ✅ (V10 mechanisms, no new sinks) |
| BG/EN and main UI states | ✅ catalogs; states in code (loading / empty / error / stale / unsupported); visual check on a Mac still pending |
| migrations on a representative database | ✅ no cloud migration in V11; engine state is additive (old `state/*.json` load unchanged — test suite starts from V10-shaped state) |
| integration tests use a test environment | ✅ fake CLI + sandbox; no real site touched |

## 4. Remaining limitations (honest list)

1. *(Superseded in 11.0.0-rc.1 — built, active after `monitor-cron.sql`.)* **No server-side monitoring.** Checks run only on the Mac (app timer or launchd agent). Needs a cloud scheduler
   (Supabase cron + an edge function with SSRF guards) — not built.
2. **Rollback / publish-artifact only for Netlify.** Vercel, Cloudflare Pages and GitHub Pages: preview/production
   through their CLIs, no rollback, no status API, promote re-deploys the (hash-verified) artifact.
3. **Not exercised against real providers from this environment** (no network to Netlify, no Mac). The fake CLI
   mirrors the real `netlify api` responses used (`getSite`, `listSiteDeploys`, `getDeploy`, `restoreSiteDeploy`).
4. **Swift compiled only in CI.** `swift build` / `swift test` must be green on `app.yml` before merging;
   screenshots workflow shows the new screens.
5. **CodeGuard**: no API access; boundary only.
6. **Smoke checks** verify status, title, https and configured pages — not visual correctness or forms.
7. `release preview` always runs a full (incrementally cached) check; a very large project pays the build time
   twice when the user checked seconds before.
8. Light theme, WP10 (SEO/accessibility rules — *done in 11.1.0-rc.1*), WP11 (Lighthouse), WP15 (DNS providers), WP16 (SFTP) remain on the
   roadmap.

## 5. Owner actions

- Merge after CI is green; on the Mac: `git pull && zsh Rebuild.command`, then walk the flow on a test site with a
  real Netlify account (preview → DEPLOY → verify → rollback).
- Decide on server-side monitoring (Supabase cron) — the only way to cover a sleeping Mac.
- Provide CodeGuard API docs / credentials to replace the backup boundary.
