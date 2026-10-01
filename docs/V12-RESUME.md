# V12 continuation checkpoint — 2026-10-01

The owner resumed work: “вече сме в нас искам да продължим с плана”. All six implementation phases are now present in the working branch. This is a test candidate, not a public release.

## Checkout and constraints

- Branch: `codex/v12-completion`; repository https://github.com/yavordfgggdag/beforeideploy.
- Worktree: `/Users/y.yakowvw/Documents/Codex/2026-09-29/s/work/beforeideploy-v12`.
- Original checkout `/Users/y.yakowvw/beforeideploy` is preserved, including modified `tests/last-run.txt` and untracked `tihagranica-store/`.
- Candidate version: `12.0.0-rc.1`. No release tag, PR, cloud deployment, paid model request, purchase or client publishing has been performed.
- Follow `CODEX-PROMPT-V12.md`, the phase audits and binding economics in `PLANS-AND-CREDITS-V2-BG.md` §17.2. Communicate in Bulgarian. No subagents authorized. Paddle sandbox only; no sudo or paid services. Keep zero engine npm dependencies, macOS 13 support, optional new Swift fields and BG/EN strings.

## Implemented

1. Setup: managed tool installation and bundled npm/npx; honest failures, bounded logs, device login, Git identity and script trust; engine process draining and local preview relay.
2. Design: shared semantic light/dark system, typography/components/modal/field/meter migration, sticky error queue, reduced motion and screenshots.
3. Assistant: versioned prompts, decoded human text streaming, bounded redacted per-project conversation history, Markdown/code/diff, context and provider selection, durable apply/discard/undo, retry scope and cancellation. Failed/cancelled turns retain their durable identity when loading more history. Patch review uses the saved patch even after the selected issue changes. Real-model quality acceptance remains pending.
4. Plans/usage: one canonical public/offline catalog, demo mode, plan comparison, account-scoped polling/cache, balance/windows/expiry, same-interval Paddle subscription changes with price preview. Existing monthly/yearly conversion remains explicitly unavailable.
5. Backend: atomic SQL holds/settlement/FIFO/expiry/caps, monthly annual-plan accrual, durable partial/out-of-order refunds, usage windows/Boost, site limits/pause/day metering, debt grace and repayment, cloud audit/private reports, provider receipts and recovery, admin reconciliation. Owner hosting/Netlify allowance/CodeGuard remain gated; included domain uses manual review.
6. Navigation: native collapsible sidebar, toolbar, matching shortcuts, separate tabbed Settings, adaptive screens at 900×640, error/retry states, palette scrolling, Bulgarian glossary and strict localization lint. Legacy version-named view files split into named screens. Text-processing units and charged credits are distinct; period usage uses the included plan grant.

## Validation evidence and next step

- Phase 5 source `ca8e896`: engine, engine-macos, app, functions and screenshots CI all passed.
- Local phase 6: 114 engine tests, 35 SQL/RLS tests and 112 Deno tests passed before the final glossary/history refinements. Latest Swift build (`../v12-phase6-app12.log`) passed; final engine rerun (`../v12-phase6-engine3.log`) passed all 114 tests. Localization (814 engine / 1280 app keys), design and documented-error checks passed.
- CI against the candidate commit supersedes intermediate local results. Run all six workflows on the same source: engine, engine-macos, app, functions, screenshots and release-dryrun. Functions and release-dryrun require manual dispatch. Record actual source SHA/run URLs alongside the downloaded package; do not infer success from dispatch.
- Isolated preview: `../v12-billing-preview/BeforeIDeployBillingPreview.app`, different bundle ID and private data/cache; no Keychain/cloud config. Generated demo site `../v12-billing-preview/sites/v12-owner-demo` passes its local check. Reviewed true-project and corrected Usage captures at 900×640. Final CI screenshots cover light/dark, long names, assistant states, plans and usage.
- Native interaction check: collapsing the sidebar, Command-3 and Command-comma passed. VoiceOver exposes separate System/Light/Dark options; Settings capture targets its actual native window.
- Owner walkthrough: `V12-OWNER-TEST-BG.md`. After successful final CI, download the universal unsigned DMG from release-dryrun, verify contents/version/architectures and provide the package with the guide. Do not replace the installed app automatically.
- Remaining external acceptance: clean Mac, chosen real AI model, deployed test Supabase and Paddle sandbox scenarios, test hosting, then Apple Developer ID signing/notarization before public distribution. No production launch before owner testing.

## Useful paths

- Scratch logs/artifacts are beside this worktree (`../v12-*`), not release source.
- Deno: `/Users/y.yakowvw/.npm/_npx/05b6ef7b13673c57/node_modules/deno/deno`.
- Canonical catalog: `supabase/functions/_shared/plans-catalog.json`; canonical credits SQL: `supabase/credits-v12.sql`; use their sync scripts for generated copies.
- AI prompting sources: `AI-PROMPTS-V12.md` (OpenAI Docs skill previously read).
