# Промпт за Codex — V12: дизайн, AI асистент, настройка, планове и използване

> Копирай всичко под линията в Codex. Промптът е на английски, защото така агентът работи най-точно; текстовете в
> приложението остават на български и английски. Подробностите са в `docs/AUDIT-V12-UI-BILLING-BG.md` и `docs/audit-v12/*.md`.

---

You are a senior macOS (SwiftUI) + Node.js + Supabase engineer and product designer. You are working in the repository
**Before I Deploy** — a macOS app that takes a website folder to a live, monitored site. Your job is to implement the
V12 audit: make the app **beautiful, consistent and trustworthy**, make **automatic setup actually work**, rebuild the
**AI assistant** as a real chat, and finish **plans, credits and usage** so they look like Claude's usage page and work
end to end.

## 0. Read first (in this order)
1. `docs/AUDIT-V12-UI-BILLING-BG.md` — summary, binding decisions (§2), phases and acceptance criteria (§3).
2. `docs/audit-v12/setup.md` — SU-1…SU-37 + "Target setup flow" spec (§0–§9).
3. `docs/audit-v12/design.md` — UI-1…UI-48 + "Design System v2".
4. `docs/audit-v12/assistant.md` — AI-* findings + "Target design spec" (§5).
5. `docs/audit-v12/plans-usage.md` — PU-1…PU-48 (+ work order mapped to WP04.1–.9).
6. `docs/PLANS-AND-CREDITS-V2-BG.md` — the approved credits model; **§17.2 decisions are binding**.
Every finding has `file:line`, evidence and an exact fix. **Re-verify each finding against the current code before
changing it** (line numbers may have shifted); if a finding is wrong, skip it and note why in the phase commit message.

## 1. Architecture you must respect
- `App/Sources/BeforeIDeploy` — SwiftUI app (macOS 13+). Strings only via `L("key")` with `%@` placeholders; both
  `App/Resources/bg.lproj` and `en.lproj/Localizable.strings` must get every key. No Cyrillic literals in Swift.
- `engine/` — Node CLI `bid`, **zero npm dependencies**, prints NDJSON; last line `{"type":"result","ok":…}`.
  Errors: `throw new EngineError(msg('key'), 'code', exit)`; every code documented in `docs/errors.md`
  (`node scripts/error-codes.mjs`). Engine i18n keys must be literal (`node scripts/i18n-check.mjs`).
- `supabase/` — `schema.sql` (RLS on every table; SQL functions `security definer`, granted to `service_role` only)
  and Edge Functions in `supabase/functions/*` with shared code in `_shared/`.
- New templates for "New site" are generated from `scripts/templates/` (don't hand-edit `engine/templates/*`).

## 2. Hard rules (never break)
- **No secrets.** Never add real keys/tokens; never print or commit `.env`. Placeholders only.
- **Payments: Paddle sandbox only.** No live purchases, no live price IDs, no real charges.
- **Never deploy to a client's production site and never activate a paid service** from tests or scripts.
- **No sudo, ever** in setup. Tools go to `~/Library/Application Support/BeforeIDeploy/tools`.
- Don't weaken safety code from WP01 (path policy, script isolation/sandbox, staged artifacts, secrets out of argv).
- Keep backward compatibility: new JSON fields are **optional** in Swift; `billing usage` gets `v=2` while v1 keeps working.
- Don't skip, disable or loosen tests to get green. Fix the cause.
- Commit after each phase (or smaller logical step) with a clear message; update `CHANGELOG.md` (English + Bulgarian
  parts) for user-visible changes. Do not open a PR unless asked.

## 3. Binding product decisions (summary — full table in the audit §2 and V2 §17.2)
- Plans: **Flash 9.99 € / 100 000 credits / 1 active site**, **High 29.99 € / 300 000 / 3 sites**,
  **Knight 99.99 € / 1 000 000 / 10 sites (fair use 25) + 1 domain/year**; 3 000 Netlify credits behind
  `features.netlifyCredits=false` (UI shows "скоро"). Prices include VAT.
- **1 site-month = 100 000 credits.** Credits from one payment are valid **Flash 1 month, High 3 months, Knight 10
  months**, spent oldest-first (FIFO), accumulation capped at monthly credits × validity. With full, normal use the
  subscription must last exactly as promised: Flash = 1 site × 1 month; High = 3 sites × 1 month or 1 site × 3 months;
  Knight = 10 sites × 1 month or 1 site × 10 months. **Prove it in a test.**
- More than 3 active sites requires Knight. Over-limit sites are **paused, never deleted**.
- Packs: 4.99 / 19.99 / 39.99 € for 100k / 500k / 1M, valid 12 months; they **do not** bypass the windows.
- Windows like Claude: **5-hour** (20 % of monthly credits) and **weekly** (40 %), weekly anchored to subscription
  start; Knight "Boost" +50 % for 24 h once a week.
- Nudges: at **75 % used** (25 % left) → Flash/High "Надградете плана", Knight "Купете кредити"; 90 % banner; 100 %
  soft stop with reset time and both buttons.
- Unit is always **"кредити"** (never "токени"); Netlify's are "Netlify кредити".
- Bulgarian glossary: deploy → публикуване/публикувай, production → на живо, preview → преглед, Smart Deploy →
  Умно публикуване, Mission Control → Контролен център, Launch checklist → Път до публикуване, Release →
  Публикуване на живо, Backup → Резервно копие.
- Appearance: Light + Dark following the system, with Settings → Appearance (System/Light/Dark).

## 4. Phases (do them in order; each must end green)

### Phase 1 — Setup that works (SU-*)
Implement the "Target setup flow" spec in `docs/audit-v12/setup.md`:
PATH computed in `engine/bid` before the bundled exec (tools/bin → env.zsh → standard dirs → system → bundled runtime
bin last; `/bin/zsh -f`); npm + npx shipped in the bundled runtime (`scripts/bundle-node.sh`); installs with
`npm install --prefix tools/.staging-<id>` + atomic rename + `tools/bin` links, pinned majors, `--fetch-timeout`,
`--loglevel=http`; Node row OK with bundled runtime; git detection that never runs the `/usr/bin/git` shim without CLT;
cloud rows admin-only and never required; required set derived from hosting providers in use; honest results
(`ok:false`, `code:'setup_incomplete'|'offline'|'setup_busy'`), every started step ends pass/fail/skipped/blocked,
dependency blocking, error mapping (ENOENT/EACCES/ETIMEDOUT/ENOSPC/127) to one Bulgarian sentence + log link,
preflight (network ≤15 s, disk), heartbeat every 5 s, lock file, logs per step, "Опитай пак неуспешните", device-code
card for Netlify (URL) and GitHub (code), Xcode CLT step that waits (`waiting_user`) instead of claiming success,
app-side timeouts and stdout reader that closes 2 s after exit, overlay that never shows green/confetti on failure.
Auto-check: `scripts_untrusted` vs `scripts_changed`, visible paused state.
**Accept:** the 8-scenario matrix in setup.md §9; new `tests/run.mjs` cases run with `env -i PATH=/usr/bin:/bin`
proving `setup status` sees the bundled Node and `setup auto` returns `ok:false` with failed steps listed.

### Phase 2 — Design System v2 foundation (UI-1…UI-14, UI-33…UI-40)
Create `App/Sources/BeforeIDeploy/DesignSystem/` with tokens (`Tone`, `Typo`, `Space`, `Radius`, `Elevation`,
dynamic light/dark colours exactly as in design.md §1) and components: `Card`, `Badge`, `Meter`, `BIDButtonStyle`
(sizes + focus ring + Reduce Motion), `IconButton` (mandatory label), `BIDField`, `Segmented`, `SelectableRow`,
`EmptyState`/`LoadingState`/`ErrorState`, `ToastCenter` (queue, sticky errors, hover pause, VoiceOver announcement),
`ScreenScaffold`/`PageHeader`/`SectionHeader`, `SheetScaffold` sizes with scrolling, `ModalShell` (isModal, focus).
Remove forced dark mode; add Settings → Appearance. Contrast fixes (fill tokens ≥ 4.5:1). Motion diet (static or
bounded Aurora, one glow max, no decorative breath, entrance once per session, confetti only on transition to ready).
Migrate every screen and sheet; delete the duplicates listed in UI-7…UI-14.
**Accept:** CI check (grep or SwiftLint) — zero `Color(hex:`, `.system(size:`, literal `cornerRadius:` and `.shadow(`
outside `DesignSystem/`; screenshot CI extended with Light + Dark, 1080×700 and a long project name (UI-48).

### Phase 3 — The AI assistant, rebuilt (AI-*)
Implement `docs/audit-v12/assistant.md` §5 exactly: a real chat (user/assistant bubbles, rendered Markdown, code
blocks with copy, diff/patch proposal cards with Apply / Discard / Undo, streaming **plain text** — the engine must
stream only the human-readable answer, not raw JSON), a multi-line composer (auto-grow, ⌘↩ send, Esc stop, attach
context chips), empty state with suggestions, stop button, auto-scroll that respects the user scrolling up, conversation
history that reloads with content, inline API-key setup and model picker, credits/budget with `Meter`, and quota
errors (`quota_exhausted`, `ai_session_cap`, `window_week`) rendered as an action panel with "Купи кредити" /
"Смени плана" and the reset time. It must look as polished as Claude.ai, in both light and dark.
**Accept:** engine tests for the stream contract (text deltas + one final structured event), Swift decoding tests,
screenshots in CI: empty, conversation with code, proposal card, quota error.

### Phase 4 — Plans and usage, visible and correct (PU-1…PU-35, PU-45…PU-48)
Offline/public catalog (`engine/src/plans-catalog.mjs`; `catalog` works without login in the Edge Function); demo
mode `BID_BILLING_DEMO=1` (and a Snapshot argument) for review and screenshots; **one price source** (V2 values) for
`DEFAULT_CATALOG`, the schema seed (+ migration for existing DBs), `ai-fix` defaults and `site/index.html` (generated
from the same JSON), with a test that compares them. New **"План и използване"** screen modelled on Claude's usage page
(V2 §10.6): header "План · High · подновяване 31 окт." + "Смени плана", three meters (5 часа · Седмица · Период) with
"Нулира се в 14:30 (след 3 ч 10 мин)", packs row, breakdown by action/model, collapsible history, "Обновено преди 4 s",
polling 10 s on screen / 60 s for the pill, refresh after every spend/purchase, reset on logout. New **Plans** sheet:
4 columns (Free + 3), equal heights, price always visible, yearly "2 месеца безплатно", comparison table, current-plan
ribbon, honest bullets (active sites, validity). Data fixes: upgrade via `PATCH /subscriptions/{id}` (never a second
subscription), trial base, yearly plans by monthly slices, one balance (`available`) everywhere, calm "not open yet"
state instead of owner instructions, quota dead-ends removed.
**Accept:** Deno tests (public catalog, upgrade = PATCH, yearly slice, trial base), engine tests (offline catalog,
demo), Swift tests (optional v2 fields), screenshots of Plans + Usage in demo mode.

### Phase 5 — Credits V2 in the backend (PU-36…PU-44; V2 §9–§16, WP04.1–.9)
`credit_grants` with per-plan validity and FIFO + cap; `bid_charge`/`bid_hold`/`bid_settle`/`bid_release` SQL
functions (security definer, advisory lock, service_role only) and ai-fix moved onto them; `usage_windows` (5 h + week,
anchor, boost); `sites` + server-side active-site limits + pause on downgrade; action price list
(`settings.pricing.actions`), `usage_events`/`usage_daily` and metering of cloud checks/audits/deploys (local-only
check = 0); `usage_nudges` + nudge in `usage` + global banner; `usage` v2 contract; Knight extras behind flags;
realtime stage 1 (polling + ETag), stage 2 optional (Realtime channel).
**Accept:** PGlite tests (`tests/rls/rls.mjs`) for every new table/function and RLS; Deno tests for windows, FIFO
expiry, thresholds, idempotency; a test proving the standard profile "1 site × 30 days" ≤ 100 000 credits and that
High covers 1 site × 3 months and Knight 1 site × 10 months without extra purchases.

### Phase 6 — Navigation, screens and Bulgarian (UI-15…UI-32, UI-41…UI-48)
`NavigationSplitView` with collapsible sidebar, ⌘N = Nth sidebar row, min window 900×640, adaptive grids,
Settings as a `Settings` scene with tabs, glossary applied to every string, no English in the Bulgarian UI (except
brand names), `K.role/plan/step/provider/auditAction` instead of raw ids, "кредити" everywhere.
**Accept:** `scripts/i18n-check.mjs` extended to fail on bg == en (allow-list for brands) and on hard-coded Latin
`Text("…")`/`label: "…"` in views — and green.

## 5. How to verify (run after every phase)
```bash
node tests/run.mjs                      # engine suite (~5 min); clean /tmp/bid-test-* afterwards
(cd tests/rls && node rls.mjs)          # SQL + RLS on PGlite
deno test --allow-env --allow-net --allow-read supabase/functions
node scripts/i18n-check.mjs && node scripts/error-codes.mjs
```
Swift builds and UI screenshots run in GitHub Actions (`app.yml`, `screenshots.yml`); the DMG is built by
`release-dryrun.yml` (workflow_dispatch). If you cannot compile Swift locally, keep changes compiler-safe
(macOS 13 APIs only, no new packages) and rely on CI; fix every CI failure before moving on.

## 6. Definition of done
- All six phases merged on the working branch, CI green on the last commit (engine, engine-macos, app, functions,
  screenshots, release-dryrun).
- Fresh-Mac setup completes the required set without Terminal and without sudo, or fails honestly with a clear reason.
- The assistant, Plans and Usage screens look polished in Light and Dark at 1080×700 and at full screen.
- One price list everywhere; the subscription-duration promises are proven by tests.
- `CHANGELOG.md` updated (en + bg); `docs/AUDIT-V12-UI-BILLING-BG.md` gets a status table: finding → fixed / skipped (why).
- A short Bulgarian summary for the owner: what changed, screenshots, and what remains for the owner
  (cloud-deploy, Paddle sandbox IDs and keys, Netlify written confirmation, Apple Developer ID).
