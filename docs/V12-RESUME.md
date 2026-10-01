# V12 continuation checkpoint — 2026-10-01

The owner resumed on 2026-10-01: “вече сме в нас искам да продължим с плана”. Work is active.

## Latest progress (overrides the older checkpoint details below)

- Phase 3 `999d71f`, phase 4 `cd57e53`, and phase 5 atomic accounting `d3c12f2` are pushed with their applicable CI green. Phase 4 had app/screenshots too.
- Phase 5 follow-up is being committed: atomic trial/upgrade grants, monitor extras, paid annual periods and unattended scheduler accrual, verified V1 annual migration/refund linkage, site/domain/meter/Boost/nudge endpoints, active-site monitor filtering and account export. `supabase/credits-v12.sql` remains the source for generated schema; run `node scripts/credits-sync.mjs` after edits.
- Engine has account/cloud-scoped ETag handling, canonical available balance, credit-pack AI gates, site controls and `meter.mjs` durable publishing receipts. Provider CLIs are metered immediately before invocation; launch failures release, remote failures settle, recovery repeats only accounting. Signed-out/local and VIP/admin own-provider workflows are unmetered. Rollback remains free.
- Swift usage shows sites with reviewed activation cost/pause, debt/forecast, Boost, domain review requests and global credit nudges. New fields optional; builds locally. Admin financial settings validate rates/action flags; Netlify extras remain disabled. AI refuses unpriced selected models.
- Checks: full engine `../v12-phase5-engine2.log` 114 passed (account balance/financial-setting edits afterward need fresh CI); real SQL/RLS `../v12-phase5-rls17.log` 31 passed; Deno `../v12-phase5-deno14.log` 107 passed (catalog flag adjustment afterward needs latest run); Node billing client tests 5 passed; Swift build logs app1/app2 green, app3 latest. No cloud deploy, paid model, purchase or production publish.
- STILL OPEN phase 5: V1 usage still old rolling-session calculation/capped reads; unify with SQL receipt while preserving decoder contract and retain equivalent real-SQL regression coverage. Legacy annual records without a matching verified payment still use the JS fallback (not scheduler); require reconciliation rather than speculative grants. Review paid monthly/yearly conversions, future annual upgrade slices and refund linkage. Add cloud report/audit metering + receipt-required report/history/verification (backup/owner-hosting adapters currently unavailable, never imply active provisioning). Add usage --watch, cloud prices in Costs, admin sites/drift controls, richer quota/reset/Boost UX and pending-downgrade site choice notice. Review async account race and cache on failed request/logout. Demo sites fixture/screenshot review still needed.
- Phase 6: NavigationSplitView/Settings scene/min900x640/responsive glossary strict check still pending, then final CI, release-dryrun DMG and owner acceptance.
- Worktree: `/Users/y.yakowvw/Documents/Codex/2026-09-29/s/work/beforeideploy-v12`, branch `codex/v12-completion`; original checkout unchanged. Deno: `/Users/y.yakowvw/.npm/_npx/05b6ef7b13673c57/node_modules/deno/deno`.


## Checkout

- Branch: `codex/v12-completion`, pushed to origin.
- Latest pushed implementation before this checkpoint: `cd57e53`; inspect `git log` for the new atomic-accounting commit.
- Worktree: `/Users/y.yakowvw/Documents/Codex/2026-09-29/s/work/beforeideploy-v12`.
- Original checkout: `/Users/y.yakowvw/beforeideploy`. Preserve its existing modified `tests/last-run.txt` and untracked `tihagranica-store/`.
- Repository: https://github.com/yavordfgggdag/beforeideploy
- Version remains `11.1.0-rc.1`. V12 is NOT complete or released.

## Request and rules

Implement all six phases in `docs/CODEX-PROMPT-V12.md`, using `docs/AUDIT-V12-UI-BILLING-BG.md`, `docs/audit-v12/*.md`, and binding decisions in `docs/PLANS-AND-CREDITS-V2-BG.md` section 17.2. Finish the app for owner testing before launch. Work autonomously, communicate in Bulgarian, commit/push logical changes, no PR unless requested. No subagents were authorized. Zero engine npm dependencies; macOS 13; optional new Swift JSON fields; all strings BG/EN. Paddle sandbox only, no real payment or client production deploy. No sudo. Preserve path/script/secret safety.

## Completed checkpoints

1. Setup foundation: `a66d5f1`, `48b2369`. Managed tools, bundled npm/npx, honest setup failures, bounded logs, device login and Git identity, trust handling, engine process draining, macOS local preview relay.
2. Design foundation: `35ba1f1`, `9d1adc8`, `c51a8cd`. Shared semantic light/dark design system, appearance choice, typography/components/modal/field/meter migration, sticky-error toast queue, reduced decorative motion, screenshot coverage. App/engine/screenshots CI all passed on `c51a8cd`.
3. Assistant checkpoint: `999d71f`. Human text stream decoder; versioned system/ask/diagnosis prompts; bounded redacted per-project history and provider context; durable apply/undo/discard state; stale Undo protection; per-project Swift sessions, batched stream observation, retry scope, multiline composer, attachments, provider picker, Markdown/code/diff views, selection/config approval, inspector, cancellation, screenshot fixtures and Swift tests. This phase still needs final verification and repairs.

## Validation status (do not report everything green)

- Latest successful local Swift build: `../v12-assistant-build6.log` (282.97 seconds on the busy Mac). Subsequent small UI edits (legacy answer fallback and wrapped composer measurement) rely on the newly pushed CI for verification.
- Seven stream/history Node unit tests passed; later four history tests including persisted discard passed.
- Deno: 87/87 (`../v12-phase3-deno.log`). SQL/RLS: 10/10 (`../v12-phase3-rls.log`).
- i18n: engine 796 / app 1180 keys, green. Design lint, documented error codes, git diff whitespace checks green.
- Full local engine suite was STOPPED at the owner's pause. Log: `../v12-phase3-engine.log`. It had two failures in existing release/rollback scenarios: first `Cannot read properties of undefined (reading 'id')`, then cascading rollback `verify_failed` with mock HTTP 500. Inspect the first preview/promote result near `tests/run.mjs:1445` and reset mock state in a finally if needed. Do not assume a timing issue or weaken tests. The previous full run before the new UI/history refinements was 112 pass / 1 fail solely for undocumented `stale_undo`; that documentation is now fixed.
- Current local full suite began before the last cancellation-test edit; rerun or rely on fresh CI for the final revision. Added `tests/assistant-cancel.mjs` must run under the full suite's fake provider environment.
- Test temp data retained for diagnosis: `/var/folders/9b/b4lg79vn5jvf58vwh1v12xcm0000gn/T/bid-test-5mhWFf`. Processes are stopped; temp is not a production site.
- GitHub CI for `999d71f` was triggered; inspect app, engine, engine-macos, functions and screenshots. No approval of this phase yet.

## Screenshots

- Local isolated preview app and data: `../v12-assistant-preview/` (different bundle ID, BID_APP_DIR/BID_CACHE_DIR, no Keychain, no paid calls).
- `light-code.png` is an INVALID early capture of the loading overview. Do not use it as assistant evidence.
- `light-code-ready.png` was produced with the corrected readiness wait but has NOT yet been visually reviewed.
- Screenshot helper now waits for `isSnapshotDemo` before assistant capture; CI includes empty/code/proposal/quota, both appearances. This still needs checking.
- Earlier reviewed design shots: `../v12-design-shots/`.

## Next work

1. Read this checkpoint and current git/CI state. Fix Phase 3 test or screenshot problems; complete visual review. Important details to inspect: failed-operation history IDs on loading older messages, account/session failures, cancelled apply restores history and Undo, typed configuration consent, `review` action uses the original proposal scope. Complete acceptance without pretending live-model quality was tested.
2. Phase 4: public/offline price catalog and demo mode, one canonical V2 price source, Plans/Usage redesign, 10s/60s polling, one available balance, trial/year slices, subscription upgrade via PATCH, not another subscription.
3. Phase 5: database credit grants FIFO/expiry/cap, atomic charge/hold/settle/release with service_role-only security definer functions, windows/boost, server active-site limits, metering/nudges, usage v2. Prove the promised site-month durations in tests.
4. Phase 6: NavigationSplitView, 900x640, Settings scene, responsive screens and strict BG glossary/i18n.
5. Full CI + release-dryrun DMG, final owner walkthrough and honest remaining cloud/Paddle/Netlify/Apple configuration list. No real launch before owner testing.

## Binding economics

Flash EUR9.99 /100k /1 site /1-month grant; High EUR29.99 /300k /3 sites /3-month grant; Knight EUR99.99 /1M /10 sites (fair use25) /10-month grant, one domain/year. FIFO accumulation cap monthly credits times validity. Packs EUR4.99/19.99/39.99 for100k/500k/1M, 12 months. Five-hour20% and weekly40% (subscription-start anchored); packs do not bypass windows; Knight Boost +50% for24h once/week. Nudges75/90/100%, pause excess sites, never delete. Local checks0; cloud-report check50. Own hosting for Flash/High; owner hosting Knight only. Netlify3000 credits flag false pending written permission. VAT-inclusive, sandbox only. UI says credits, not tokens.

## Sources already consulted

OpenAI Docs skill was read and announced. `docs/AI-PROMPTS-V12.md` records official prompt-engineering and agent-safety references. No new model IDs were selected.

Official Paddle documentation was researched for Phase 4, but no billing implementation changed yet:
- https://developer.paddle.com/api-reference/subscriptions/update-subscription/
- https://developer.paddle.com/build/subscriptions/replace-products-prices-upgrade-downgrade/
- https://developer.paddle.com/concepts/subscriptions/proration/

PATCH must send the complete retained items list, proration mode, and payment-failure prevention. Preview before confirming a charge; preserve existing add-ons. Downgrade timing needs a deliberate server-side implementation (do not confuse deferred billing with deferred entitlement changes).
