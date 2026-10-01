# Codex V12 review: design system, app UI and navigation

Branch `origin/codex/v12-completion`, head `8d5fbec`, built on `origin/claude/nifty-edison-1195gi`. This was a read-only review: the tree was extracted with `git archive`, and the Swift code was not compiled here. Line numbers refer to the files at `8d5fbec`. `A/` stands for `App/Sources/BeforeIDeploy/`.

Commits reviewed:
- 35ba1f1: tokens, adaptive appearance, components
- 9d1adc8: meters, fields and selectors
- c51a8cd: empty states and the motion diet
- b6e739d: NavigationSplitView, the Screens/ split, the localization pass and a VERSION bump. This commit also touched `engine/i18n/bg.json` and `assistant.mjs`.
- 4c1c324: whitespace only
- 8d5fbec: snapshot of the Settings window, removed an a11y label, assistant copy

Size of the change: App diff vs base is 66 files, +6096/−3891. `DesignSystem/` is 1,444 lines.

## 1. CI evidence at 8d5fbec (GitHub Actions, yavordfgggdag/beforeideploy)

| Workflow | Trigger | Result | Run |
|---|---|---|---|
| engine | push | success | https://github.com/yavordfgggdag/beforeideploy/actions/runs/36864717635 |
| app (swift build, swift test, design-check, i18n-check) | push | success | https://github.com/yavordfgggdag/beforeideploy/actions/runs/36864717586 |
| screenshots | push | success (started 12:52, finished 13:05) | https://github.com/yavordfgggdag/beforeideploy/actions/runs/36864717624 |
| functions | workflow_dispatch | success | https://github.com/yavordfgggdag/beforeideploy/actions/runs/36864717407 |
| engine-macos | workflow_dispatch | success | https://github.com/yavordfgggdag/beforeideploy/actions/runs/36864721390 |
| release-dryrun | workflow_dispatch | success | https://github.com/yavordfgggdag/beforeideploy/actions/runs/36864725509 |

- **All 6 workflows are green on 8d5fbec.**
- **Screenshot artifacts exist:** one artifact named `screenshots`, id 11163946356, 10.4 MB, expires 2026-12-30. I did not download it. The workflow also publishes to a `screenshots` branch.
- **Earlier runs:** on b6e739d, 4 runs were cancelled because the next push superseded them. On 4c1c324, `screenshots` and `release-dryrun` were cancelled. The earlier design commits (35ba1f1, 9d1adc8, c51a8cd) have green engine and app runs.
- **What CI does not prove:** a green `app` run means Swift compiles, the 3 XCTest cases in `App/Tests/BeforeIDeployTests/DesignSystemTests.swift` pass, and the two lint scripts pass. It says nothing about how the layout looks. Only the screenshots, viewed by a person, can show that.

## 2. Remaining design debt (measured at 8d5fbec)

| Metric | Audit baseline (design.md) | Now: total / outside `DesignSystem/` | Notes |
|---|---|---|---|
| `.font(.system(size:` | 610 sites, 33 sizes | 5 / **0** | `Typo.font(role)` is used 599× outside the design system: callout 233, caption 144, body 107, subhead 39, micro 24, headline 19, title 17, display 15. Inside the design system there are still hard sizes: `Scaffolds.swift:14,45,52`, `Theme.swift:146,262`, `Motion.swift:103,123,235`. |
| `Color(hex:` | 30 | 12 / **0** | All are in the design system: Tone fills, avatar palette, confetti, WelcomeSky. |
| Literal `cornerRadius: <number>` | about 75 uses, 12 values | 8 / **0** | Outside the design system everything uses `Radius.*` or `Theme.radius/smallRadius`. The design system itself still has literals 13/11/9/8 (`Scaffolds.swift:13,43,44,112,119`, `Theme.swift:266,270`). |
| `.shadow(` | 27 | 3 / **0** | Shadows now come from `elevation()`. |
| Forced dark mode | 5 places plus `darkAqua` | **0** `preferredColorScheme`. `darkAqua` remains only in the `Appearance.apply()` user setting (`Tokens.swift:15`). | System/Light/Dark picker at `SettingsView.swift:80-82`. |
| `accessibilityLabel` | 17 | 28 (23 outside the design system), plus `IconButton` labels itself | About 20 icon-only buttons found; 3 still have no label (`AIFixView.swift:227`, `MonitoringViews.swift:202`, `HostingChooserView.swift:121`). |
| `accessibilityValue` / `@ScaledMetric` | not stated / 0 | 2 / 0 | `Meter` speaks a percentage, but `CreditRing` passes an empty label. |
| `.buttonStyle(.plain)` | 39 | 42 (40 outside) | Not reduced. |
| Literal `.padding(N)` / `.padding(.edge, N)` | 255 | 54 / 115 | No lint rule. `Space.*` is used 112×. |
| Literal `spacing: N` | 19 values | 431 | No lint rule. |
| Literal `.opacity(x)` | 109 | 61 | |
| `Color.white` / `.white` text | about 60 | 12 / 11 outside | Mostly on brand gradients. One contrast bug, see UI-36. |
| `TimelineView` loops | 5 at 30–60 fps | 5, but only 2 animate | Aurora is now static (`AuroraFrame(t: 0)`). UsageViews and RunOverlay tick at 1 s or 30 s. `Celebration` runs at 60 fps but only for a transient burst. `WelcomeSky` runs at 30 fps on onboarding, auth and language screens, gated by Reduce Motion. |
| `.entrance` / `.breath` | 39 / 10 | 0 / 0 | Removed. `glowBorder` is now a static stroke, used 8×. `.lift` remains 10×. |
| bg == en keys | 32 | **6**, all acceptable | `_meta.reviewed`, `ai.viaProvider` (`%@ · %@`), `monitor.notify.ssl`, `signal.ssl`, `usage.periodDates`, `k.role.vip`. `i18n-check.mjs` now fails the build on bg==en, with a brand allow-list. |
| bg strings containing non-brand English | about 100 or more | **about 76 strings** | "prompt" ×10 (including "Prompt-ът"), "AI Fix" ×5, "scheduler" ×5, "repo" ×3, "draft" ×3, "dev", "diff-а", "patch", "mailer", "dashboard", "Usage", "framework-ът", "package manager-ът", "workflow-ът" (`setup.subtitle`, bg:1011). Some quote external UI and are acceptable: "SQL Editor → Run", "API Manager", "New API key". |
| bg/en key parity | none | 1280 = 1280, 0 missing | |
| Hard-coded English in Swift | 15 or more | Brand names only | "Before I Deploy" ×6, plus "GitHub", "Spaceship", "Claude", "Codex", "Claude Code" labels. `"ROLLBACK"` placeholder at `ReleaseViews.swift:229`. |

**What the lint actually checks.** `scripts/design-check.mjs` bans only four patterns: `Color(hex:`, `.system(size:`, `cornerRadius:\s*\d` and `.shadow(`. It also skips the whole `DesignSystem/` folder. Spacing, padding, opacity, `.white` and `.plain` buttons are not checked at all, so the "all screens use tokens" message is only partly true.

## 3. UI-1 … UI-48 status

| ID | Status | Evidence (at 8d5fbec) |
|---|---|---|
| UI-1 Light mode / no forced dark | **Done** | `Tokens.swift:4-30`: `Appearance` enum and `Color.adaptive` built on `NSColor(name:dynamicProvider:)`. `Theme.swift:16-48`: every surface and text colour is adaptive. Applied at `BeforeIDeployApp.swift:7,50`. Picker at `SettingsView.swift:80-82`. Screenshots run in light and dark. |
| UI-2 Type scale | **Done (with caveat)** | `Tokens.swift:68-80` defines `Typo` with display 28 down to micro 10 and a 10 pt minimum, used 599×. The caveat: `NSFont.preferredFont(.body)` is always 13 on macOS, so the "scaling" does nothing. `Typo.icon(size:)` is still an escape hatch. |
| UI-3 Colours through tokens | **Done** | No `Color(hex:)` outside the design system. `Theme.brandViolet/topup/onAccent/scrim` added (`Theme.swift:37-42`). |
| UI-4 Radius / spacing / elevation scale | **Mostly done** | `Space`, `Radius` and `Elevation` exist (`Tokens.swift:82-104`). Radii are clean outside the design system. Spacing and padding still use about 600 literals, unlinted. |
| UI-5 Dead or duplicate primitives | **Mostly done** | AmbientBackground is gone. `StatusRing` and `ProgressRing` now wrap `Meter` (`Theme.swift:157`, `Motion.swift:385`). `ProgressRing` keeps a dead `shown` state and ignores its `tint`/`lineWidth` parameters. `Orbit`, `Shimmer` and `SkeletonBlock` remain. |
| UI-6 Version-named files | **Done** | `V7Views.swift` and `V9Views.swift` deleted (−747/−705 lines in b6e739d), replaced by `Screens/*.swift` (9 files) and `DesignSystem/` (11 files). |
| UI-7 One Badge | **Mostly done** | `Badge` lives at `Components.swift:4-26`. `Chip`, `Tag`, `StatusPill`, `CountPill` and `BetaBadge` are now thin wrappers. Still hand-rolled: the IssueRow severity pill (`IssuesView.swift:78-82`), the "blocking" pill (`IssuesView.swift:17-20`), the setup "optional" pill (`SetupView.swift:103-105`), the nav badge (`SidebarView.swift:254-259`), `UsagePill` and `SignalPill`. |
| UI-8 One Meter | **Done** | `Meter` (`Components.swift:29-77`) handles bar, ring, segments and thresholds, with an a11y value. `UsageBar`, `CreditRing`, `CreditsMeter`, `StatusRing` and `ProgressRing` all delegate to it. `SweepBar` remains (`Motion.swift:306`). `HealthBar` is separate but labelled. |
| UI-9 Two header levels | **Partial** | `PageHeader` and `SectionHeader` exist, but `SectionLabel` (Theme.swift) and `PanelHeader` (`Panels.swift:3`, 10 uses) are still used. The project `HeaderView` is separate. The `MiniStat` uppercase eyebrow remains (`DashboardView.swift:129`). `ScreenScaffold` is defined (`Components.swift:171`) but has **0 call sites**: every screen hand-copies the padding, `maxWidth 1120` and ScrollView (`SetupView.swift:64-68`, `DashboardView.swift:82-86`, …). |
| UI-10 One field | **Mostly done** | `BIDField` (`Components.swift:79-104`) has a focus ring. `AuthField` and `BIDTextField` wrap it. 5 fields still use `.roundedBorder` (`GitIdentitySheet.swift:14-15`, `ReleaseViews.swift:74,229`, `UsageViews.swift:194`). The Mission Control search is still hand-rolled (`MissionControlView.swift:116-121`). |
| UI-11 One selected treatment | **Not adopted** | The `.selectable()` modifier exists (`Components.swift:106-121`) but has **0 call sites**. |
| UI-12 One segmented control | **Done** | `Segmented` (`Scaffolds.swift:91-121`) sets `.isSelected`. `TabStrip` and `SegmentedControl` are aliases of it. |
| UI-13 ModalShell | **Mostly done** | RunOverlay and AIFixOverlay use `ModalShell` (`RunOverlay.swift:15`, `AIFixView.swift:13`), which has scrim, isModal, focus and window-relative sizing. CommandPalette has its own shell but uses the scrim token and isModal (`CommandPalette.swift:78,144`). |
| UI-14 AppGlyph | **Mostly done** | `DesignSystem/AppGlyph.swift` is used in the sidebar. Onboarding, Language and Auth headers still draw a brand title on a gradient. |
| UI-15 NavigationSplitView, slim footer | **Done** | `RootView.swift:48-50` uses min 220, ideal 248, max 320. Add, New site and Search moved to the toolbar (`RootView.swift:92-98`). The footer now holds only the update button and AccountBadge (`SidebarView.swift:113-122`). The project list has `minHeight 80` and `layoutPriority(1)`; the audit asked for 160. |
| UI-16 ⌘N = Nth row | **Done** | The sidebar (`SidebarView.swift:39-75`) matches the menu (`BeforeIDeployApp.swift:119-137`). Rows show shortcuts. When Usage or Account is hidden, the visual Nth row no longer equals ⌘N. |
| UI-17 Min window 900×640 | **Done** | `BeforeIDeployApp.swift:45`. `ModalShell` clamps to window size minus 32. |
| UI-18 Filter bar overflow | **Done (FlowLayout)** | `MissionControlView.swift:114`. The search field is still a fixed `width: 200` (`:118`). |
| UI-19 Shared content width | **Partial** | 1120 and `Space.page/top` are repeated by hand on each screen. `ScreenScaffold` is unused. |
| UI-20 Admin double ScrollView | **Not done** | `RootView.swift:72` still wraps `AdminView()` in a ScrollView, and `AdminView.swift:26` has a nested ScrollView with `height 420`. |
| UI-21 Conflicting root animations | **Mostly done** | `RootView.swift:88-89` goes through `Motion.spring`, which returns nil under Reduce Motion. |
| UI-22 Hero effects / confetti | **Done** | Celebration fires only on `onChange(check.status)` into ready, and not under Reduce Motion (`DashboardView.swift:336-341`). The glow is only on blocked (`:335`). |
| UI-23 Production button colour | **Done** | `.secondary` plus paperplane (`DashboardView.swift:321-327`). `.danger` is used 9×. |
| UI-24 One primary per region | **Not done** | 61 `.primary` vs 62 before. The SetupBanner and the setup header card each have a primary. Every required SetupRow is primary (`SetupView.swift:116`). |
| UI-25 Issues list crowding | **Partial** | "Ask AI" moved into details (`IssuesView.swift:142`). Medium severity is now info and the pill is `fixedSize`. Still present: the hand-made pill and the title·kind line. |
| UI-26 Domains loading/error | **Done** | `ErrorState` / `LoadingState` / DNS `ErrorState` (`DomainViews.swift:27-30, 72-76`). |
| UI-27 Loading/empty/error patterns and keys | **Partial** | `EmptyState`, `LoadingState` and `ErrorState` exist (`Components.swift:123-159`), with 1/7/6 uses. `EmptyLine` is still used 14× and `LoadFailedView` 6×. The `"—"` placeholder remains at `CostsView.swift:44`. **The wrong keys are still there:** `ReleaseViews.swift:21` uses `billing.loading` and `:253` uses `settings.checking`. |
| UI-28 Settings scene | **Done** | A `Settings {}` scene with a 5-tab `TabView` (`BeforeIDeployApp.swift:56-62`, `SettingsView.swift:41-46`) and `SettingsLink` ⌘, (`:81-84`). |
| UI-29 Sheet sizes / scrolling | **Done** | `SheetSize` s/m/l/xl. `SheetScaffold` snaps to the nearest size, scrolls, and sets max height from the screen (`Scaffolds.swift:58-86`). Caveat: it reads `NSApp.keyWindow?.screen` on every body evaluation. |
| UI-30 Onboarding motion / layout | **Mostly done** | `maxWidth 560`. Dots are buttons with `.isSelected` (`OnboardingViews.swift:78,94`). A static glowBorder remains. WelcomeSky runs at 30 fps unless Reduce Motion is on. |
| UI-31 Costs KPIs / ledger | **Done** | Adaptive grid (min 180), ledger capped at 50 with a "more" button, grouped (`CostsView.swift:34,105,126`). |
| UI-32 Palette destinations / cap | **Mostly done** | Settings, History, Usage, Account and Admin added. ⎋ keycap (`CommandPalette.swift:33-40,89`). I did not re-verify whether a "+N more" indicator exists. |
| UI-33 Toasts | **Done** | `ToastCenter` (`DesignSystem/ToastCenter.swift`) queues 3, keeps errors sticky, pauses on hover (`RootView.swift:218`) and announces through VoiceOver. Copy shows an inline ✓ (`RootView.swift:188-194`). The error toast has no line limit (`:175`). It has a unit test. |
| UI-34 Continuous animation | **Done** | Aurora is static, breath and entrance are gone, glow is static. |
| UI-35 Reduce Motion | **Done** | Every animation goes through `Motion.*` or checks `Motion.reduced`. The spinner shows a static hourglass under Reduce Motion (`Theme.swift:295`). |
| UI-36 Contrast of solid fills | **Mostly done; 1 regression** | `Tone.fill` uses AA colours and a unit test asserts ≥4.5:1 (`DesignSystemTests.swift:23-31`). Buttons use `accentFill`. **Bug:** the IssueRow blocker pill puts white text on `Theme.blocked`, which is the *text* tone: #FF6961 in dark mode, about 2.7:1 (`IssuesView.swift:76-82`). It should use `Tone.danger.fill`. |
| UI-37 Overlays modal for VoiceOver | **Done** | `ModalShell` has isModal and an `AccessibilityFocusState`. The root uses `.accessibilityHidden` while an overlay is open (`RootView.swift:101`). |
| UI-38 Icon-only labels / toggles | **Mostly done** | `IconButton` labels itself. `ToggleRow` uses `Toggle(title)` plus `.labelsHidden()` (`Sheets.swift:705-707`). 3 icon-only buttons are unlabeled (see section 2). 8d5fbec removed the Segmented label in Appearance, so the group now has no accessible name (`SettingsView.swift:81`). |
| UI-39 Status by colour only | **Mostly done** | `StatusDot` has a label (`Theme.swift:188`). `HealthBar` segments have label and value (`DashboardView.swift:452-454`). |
| UI-40 Tiny text / focus ring | **Partial** | 10 pt minimum is enforced. Focus rings exist in `BIDButtonStyle` (`Theme.swift:236`), `IconButton` and `BIDField`. There is no real text scaling (no `@ScaledMetric`; the macOS body size is fixed). The 40 `.plain` buttons have no focus ring. |
| UI-41 Core actions in English | **Done** | `run.smartDeploy` = «Умно публикуване», `hosting.productionButton` = «Публикувай на живо…», `nav.missionControl` = «Контролен център», `run.commitPush` = «Запиши и качи», `run.localPreview` = «Локален преглед», `signal.backup` = «Резервно копие» (bg:971, 574, 748, 945, 955, 1019). Enforced by `i18n-check`. |
| UI-42 Deploy terminology | **Mostly done** | No lowercase "deploy", "production" or "preview" remains in bg values. `DEPLOY` is the typed confirmation word (bg:529, 844, 879). |
| UI-43 Hard-coded English in Swift | **Done** | Steps go through `K.step` (`LocalizedKeys.swift:315-322`). `i18n-check.mjs` rejects `Text("Latin…")` and `label: "…"` unless the text is a brand. It does not catch interpolations or `.help("…")`. |
| UI-44 Raw backend IDs | **Done** | `K.role`, `K.plan` and `K.auditAction` (`AdminView.swift:67,101,141,146`; `AccountView.swift:96`). |
| UI-45 Credits vs tokens | **Done** | Only 1 «токени» left, and it correctly means secrets (bg:516). `common.costs` = «Разходи» (bg:378). |
| UI-46 Wording | **Partial** | «Оправи с AI» (3) and «Поправи с AI» (2) are both still used (bg:98, 120, 142…). «НА ЖИВО 🚀» remains (bg:953). «anon public key» remains (bg:353). |
| UI-47 Truncation in Bulgarian | **Partial / regressed** | See the "История на промените" finding in section 5. HealthTile and Segmented labels have no `lineLimit`. MiniStat values are `lineLimit(1)`. |
| UI-48 Screenshot CI | **Mostly done** | 900×640 and 1080×700 sizes, light and dark, the long Cyrillic project name, assistant states, billing demo (`screenshots.yml` lines 106-128). Missing: release and history sheets, and a Reduce Motion pass. |

**Score:** about 27 Done, 13 Mostly done, 6 Partial, 2 Not done (UI-11 not adopted, UI-20 and UI-24 not done). Counting the UI-36 regression and the UI-47 regression, two items got worse.

### Design System v2 (design.md section 8) vs delivered

| Step | Status |
|---|---|
| 1. Tokens and lint | **Done.** `Tone`, `Typo`, `Space`, `Radius` and `Elevation` exist; the lint is narrower than proposed and excludes `DesignSystem/` itself. |
| 2. Contrast and a11y hotfix | Done, apart from the IssueRow pill. |
| 3. Primitives | Badge, Meter, Field, Segmented, states and ToastCenter are done. `SelectableRow` exists but is unused, and `EmptyLine` is still used 14×. |
| 4. Scaffolds | `SheetScaffold`, `ModalShell` and `PageHeader` are done. `ScreenScaffold` is unused. |
| 5. Navigation and layout | Done. |
| 6. Motion diet | Done. |
| 7. Localization | About 85 % done: bg==en is fixed; about 76 strings still mix in English jargon. |
| 8. Light mode, screenshot CI, lint as errors | Done; the lint already runs as errors in `app.yml:41`. |

### Assistant overlap (assistant.md, UI parts only)
- The "debug console" look is gone. Answers are rendered as Markdown and code blocks (`AssistantComponents.swift:70-79`), and the composer is a multi-line `TextEditor` with a label (`AssistantView.swift:170-173`).
- The attachment and provider controls are labelled (`:184`, `:220`).
- It uses the same Typo and Tone tokens, so light mode works there too.
- The copy changed in 8d5fbec (`assistant.emptyBody`) is more honest: "Answers appear progressively… Publishing and purchases require separate actions."

## 4. Area table

| Area | What changed | Benefit | Problems / risks | Verdict |
|---|---|---|---|---|
| Tokens (`Tokens.swift`, `Theme.swift`) | Semantic adaptive colours, a `Tone` fill/text/soft trio, a type scale, space, radius, elevation | Light and dark from one source. Values are exactly the design.md v2 table. Contrast is unit-tested. | Values live only in Swift, with no JSON/CSS source of truth. The site's `site/style.css:3-7` uses different values (`--accent #0a6ef0`, `--ok #1f9d55`, `--bg #f7f6f3`). The Typo "scaling" does nothing. | **Keep.** Extract to `tokens.json` and generate Swift and CSS from it. |
| Components (`Components.swift`, `Scaffolds.swift`) | Badge, Meter, BIDField, Segmented, SelectableRow, Empty/Loading/ErrorState, ScreenScaffold, ModalShell, CreditRing, SheetScaffold | Collapses about 15 badge and 9 meter variants into one each. Meters are accessible. | `ScreenScaffold` and `.selectable` are unused. `EmptyLine`, `PanelHeader` and `SectionLabel` duplicates live on. `CreditRing` has no a11y label. The design system breaks its own rules (literal radii and sizes). | **Keep, then finish adoption.** |
| Appearance | System/Light/Dark setting; no forced dark | Fixes the Critical UI-1 item. | 8d5fbec dropped the picker's a11y label. The Segmented group is unnamed and the visible Text above it is not linked. | **Keep;** fix the label with `accessibilityElement(children:.contain)` plus a label. |
| Motion | Aurora static; breath and entrance removed; glow static; everything through `Motion` | Battery use and Reduce Motion fixed. | WelcomeSky still runs at 30 fps on auth and onboarding. `.lift` hover scale remains. | **Keep.** |
| Navigation | `NavigationSplitView`, toolbar actions, ⌘1–8 aligned, Settings scene with tabs, palette destinations | Native macOS behaviour; the sidebar collapses. | The Admin double scroll is still there. The sidebar width minimum of 220 plus the window minimum of 900 leaves about 600 pt of content: too narrow for the 5-tab project strip (section 5). | **Keep;** fix the project tabs. |
| Screens split (`Screens/`) | V7/V9 files broken into 9 screen files | Easier to maintain. | `DashboardView.swift`, `Sheets.swift` and `Panels.swift` are still grab-bags. | **Keep.** |
| Toasts | `ToastCenter` queue, sticky errors, VoiceOver, inline copy feedback | Meets WCAG 2.2.1; tested. | None significant. | **Keep.** |
| KPI tiles (`KPITile.swift`) | One tile: 28 pt display number, card padding 16, lift | Consistent. | **Too tall** (about 120 pt). Used as the first row on Mission Control, Domains, Account, Admin and Costs. Pushes actions and the project list down (section 5). `CountUp` animates on every appear. | **Fix:** add a compact inline-stat variant and use it by default. |
| Setup screen | Same engine-ordered list, now with tokens | None structurally. | Shows Node.js / npm / Git / git identity / Homebrew first (section 5). Primary button on every required row. | **Replace** with a task-first setup (see section 5). |
| Costs / usage / account | `CreditsMeter`, `CreditRing`, Costs ledger grouping | Meters are now consistent. | Money and limits are split across 5 surfaces (section 5). | **Replace** with one "Plan & usage" hub. |
| Localization | 32 bg==en fixed, glossary applied, `K.*` mappings, i18n-check rules | Core actions are in Bulgarian, and the CI guard prevents regressions. | About 76 bg strings still contain English jargon, which the lint does not detect. The new long labels («История на промените», «Проверка на типовете») broke compact layouts. | **Keep;** do a jargon pass plus short-label keys. |
| Screenshot CI | Small and compact sizes, light and dark, long names, assistant and billing demos | Real evidence for layout at minimum size. | Nobody gates on it. The narrow-tab wrapping is probably visible in `v12-*-project-small`, but CI passes regardless. | **Keep;** add the release/history sheets and a Reduce Motion pass; review the images. |
| Commit hygiene | b6e739d mixes navigation, l10n, an engine VERSION bump, `engine/i18n` and `assistant.mjs` | none | Hard to review or revert. | Note for the future. |

## 5. Owner complaints, checked against the code

1. **A narrow window breaks «История на промените» into short lines. Confirmed, introduced by b6e739d.**
   - b6e739d renamed the Git tab from "GitHub" to `K.step("git")`, which is «История на промените» (bg:1334).
   - The project `TabStrip` is a 5-option `Segmented` in which every option is `.frame(maxWidth: .infinity)` with an icon, `Text(opt.0)` with **no `lineLimit`**, and an optional badge (`Scaffolds.swift:98-113`, `DashboardView.swift:105-113`).
   - At the 900 pt minimum width with a 220–320 pt sidebar and 2×32 pt page padding, each tab gets about 100–125 pt. The text then wraps across 2–3 lines.
   - The same long labels appear in `HealthTile` (adaptive min 150, no lineLimit, `DashboardView.swift:477,516`), for example «Проверка на типовете», and in the `MiniStat` uppercase title (`:129`).
   - Fix:
     - Add short tab keys («Промени», «Хостинг», «История»).
     - Add `.lineLimit(1)` with `.minimumScaleFactor`, or use `ViewThatFits` to fall back to icon-only tabs with `.help`.
     - Or move the project tabs into the toolbar or a native `Picker(.segmented)`.
2. **Big metric cards push important actions down. Confirmed.**
   - `KPITile` uses a 28 pt display number, a 26 pt icon tile and 16 pt padding, about 120 pt tall (`KPITile.swift:151-180`).
   - Mission Control puts 4 of them first, in an adaptive grid with min 200 (`MissionControlView.swift:31-37`). At compact width that is 2×2, about 260 pt before "Needs attention", the monitor card and the project list.
   - Domains (`DomainViews.swift:33-38`), Account (`AccountView.swift:44-45`, plus a 76 pt ring) and Admin (`AdminView.swift:133-135`) do the same.
   - On the project screen, `LaunchCard` comes before `HeroCard`, which holds Check, Smart publish and Publish live (`DashboardView.swift:43-46`). An 8-tile `HealthGrid` comes before the `MiniStat` links.
   - Fix: a compact one-line stat strip; the hero and actions first; the KPIs collapsed into the header subtitle.
3. **Setup shows Node.js, npm, Git and Homebrew too early. Confirmed.**
   - The engine emits the "base" group first: Node.js, npm, Git, git identity, Homebrew (`engine/src/setup.mjs:66-89`).
   - `SetupView` renders the groups in engine order, ok or not, all expanded (`SetupView.swift:45-56`). It shows `a.display` command text in monospace (`:113`).
   - The `SetupBanner`, with primary "Auto setup", appears on Mission Control and on every project screen (`MissionControlView.swift:26-28`, `DashboardView.swift:36-38`). The sidebar shows a count badge (`SidebarView.swift:55-56`).
   - Node is bundled and always `ok: true`, yet it is still listed first.
   - Fix:
     - Hide OK and optional tool rows behind "Technical details".
     - Order by the user's goal: hosting account, GitHub, domain.
     - Ask for Homebrew or Git only in context, when an action needs them.
4. **Mixed Bulgarian and English text. Mostly fixed, residue remains.**
   - bg==en is down to 6 acceptable keys, and the core verbs are translated.
   - About 76 bg strings still embed English: «prompt» ×10, «AI Fix» ×5, «scheduler» ×5, «repo», «draft», «dev сървъра», «diff-а», «patch», «workflow-ът», «framework-ът, package manager-ът», «Usage в Netlify», «Supabase dashboard».
   - Two variants coexist, «Оправи с AI» and «Поправи с AI», and «НА ЖИВО 🚀» remains.
   - The lint cannot see mixed strings. Add a non-brand-Latin-word check with an allow-list.
5. **Costs and limits are spread over several screens. Confirmed.**

   | Place | What it shows | Evidence |
   |---|---|---|
   | Costs, ⌘4 | Provider costs and credits ledger | `CostsView.swift` |
   | Usage, ⌘6 | 5-hour, weekly and period credit meters | `UsageViews.swift:94-103` |
   | Account, ⌘7 | Balance KPI, monthly grant, 76 pt credit ring | `AccountView.swift:44-45, 88` |
   | Account menu | Credit ring | `AccountMenu.swift:20` |
   | Plans | Shown as a sheet | `BillingViews.swift` |
   | Usage pill and nudge | Pill plus `CreditNudgeBanner` at the top of every screen | `UsageViews.swift:275-300`, `RootView.swift:87` |
   | Assistant | Cost line per reply | — |

   Fix: one "Plan & usage" screen holding balance, limits, the ledger and provider costs. The other places should only link to it.

## 6. Portability to a future shared web or Tauri UI

**Tokens: highly portable.**
- Every value is a flat hex, number or role and maps directly to CSS custom properties:
  - `Theme.*` / `Tone.*` → `--bg-window`, `--surface-1`, `--text-primary`, `--accent-fill`, `--danger-text` …
  - Light and dark map to `prefers-color-scheme` plus a `[data-theme]` override that matches the System/Light/Dark setting.
  - `Typo` → `--font-display: 700 28px/1.2 system-ui` …
  - `Space` and `Radius` → `--space-*` and `--radius-*`.
  - `Elevation` → 3 `box-shadow` tokens.
  - `Motion` → durations plus `@media (prefers-reduced-motion)`.
- **Blocker:** the values exist only inside Swift, and the marketing site already diverges. Make `design/tokens.json` (Style Dictionary or a small node script) the source, and generate both `Tokens.swift` and `tokens.css` from it in CI. `design-check.mjs` can then assert there is no drift.
- **Non-portable parts:**
  - `NSFont.preferredFont` scaling; use rem on the web.
  - The NSVisualEffect sidebar.
  - SF Symbols names (about 150 used); map them to Lucide or Tabler, or ship an SVG subset.
  - `.continuous` corner smoothing.

**Components worth keeping as the spec.** Their APIs are already prop-shaped:

| Component | Props |
|---|---|
| `Badge` | text, icon, tone, style, size |
| `Meter` | value, total, style (bar/ring), segments, thresholds, label |
| `CreditsMeter` | title, used, reserved, total, detail |
| `BIDField` | kind, error, focus ring |
| `Segmented` | options, selection, icons, badges |
| `EmptyState` / `LoadingState` / `ErrorState` | — |
| `ToastCenter` | queue of 3, sticky errors, hover pause, aria-live |
| `ModalShell` | size, scrim, isModal, focus trap |
| `SheetScaffold` | sizes s/m/l/xl, scroll, footer actions |
| `PageHeader` / `SectionHeader` | — |
| `IconButton` | mandatory label |
| `BIDButtonStyle` | primary/secondary/ghost/danger, compact, focus ring |
| `StatusDot` | with label |
| `AdaptiveColumns` | breakpoint layout, equivalent to CSS grid/flex-wrap |
| `FlowLayout` | — |

**Screens worth keeping as the spec:**
- The **Assistant** chat: Markdown, code blocks, proposal card, composer.
- The project **Hero + Issues** flow: Check, Smart publish, Publish live, with the severity mapping.
- **Domains**, which already has proper loading, error and empty states.
- The **Costs ledger** (grouped, capped at 50).
- The **Command palette**.
- The **Settings** tabs.
- The **Toast** behaviour.

**Do not port as-is:**
- Mission Control's KPI-first layout and `KPITile`.
- The Setup list.
- The 5-surface cost and usage split.
- The 5-tab project `Segmented` strip at narrow widths.
- WelcomeSky and Celebration effects.
- `@Local` (a SwiftUI build workaround, `LocalState.swift`).

## 7. Recommended follow-ups (priority order)

1. Fix the project tab wrapping: short labels plus `lineLimit(1)` / `ViewThatFits`. Add the same treatment to the `HealthTile` titles.
2. Add a compact KPI strip. Reorder Mission Control (attention → projects → stats) and the project screen (hero and actions before LaunchCard and HealthGrid).
3. Rework Setup to be task-first: hide OK and optional base tools, and ask for Homebrew or Git only in context.
4. Merge everything about money into one "Plan & usage" hub.
5. Make IssueRow's blocker pill use `Badge(tone:.danger, style:.solid)`; this fixes the contrast bug. Restore an accessible name on the Appearance picker. Label the 3 icon-only buttons and give `CreditRing` a label.
6. Adopt `ScreenScaffold` and `.selectable`. Retire `EmptyLine`, `PanelHeader` and `SectionLabel`. Extend `design-check` to cover padding/spacing literals and `.plain` buttons, and stop exempting `DesignSystem/` for literals.
7. Do a Bulgarian jargon pass (about 76 strings) and add a lint for non-brand Latin words.
8. Make `tokens.json` the single source for Swift, the app web UI and `site/style.css`.
9. Have a person review the 8d5fbec screenshot artifact (id 11163946356), especially `v12-{light,dark}-project-small` and `overview-small`.
