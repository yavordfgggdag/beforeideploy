# Приложение D — Дизайн, консистентност, достъпност, превод (UI-1 … UI-48)

Read-only audit of `App/Sources/BeforeIDeploy` (Theme.swift, Aurora.swift, every view), both `Localizable.strings` tables and `.github/workflows/screenshots.yml`. Assistant, plans/usage and setup are covered in depth in the other appendices; touched here only for consistency.
Severity: **Critical** hurts every user / blocks a class of users · **High** visible defect or large consistency debt · **Medium** noticeable UX problem · **Low** polish.

## Design system in numbers

| Metric | Count |
|---|---|
| `.font(.system(size:))` call sites | **610** in **33 distinct sizes** (8–44 pt); most common 11 (109), 12 (136), 11.5 (90), 12.5 (73); sizes 8/9/9.5/10 ≈ 40× |
| Semantic fonts (`.title`, `.body`, …) | **0** |
| `Color(hex:)` call sites | **30**, 20 distinct values; violet `0xB57BFF` / `0x7A3FD6` repeated **9×** outside any token |
| Raw `.white` / `.black` | ≈ **60** |
| Literal `.opacity(x)` | **109** |
| `.shadow(` | **27**, no elevation token |
| Literal paddings | **255**, 28 distinct values (1–110) |
| Literal `spacing:` | 19 distinct values |
| Corner radii | 12 distinct literals across ≈75 uses; `Theme.radius/smallRadius` used only 38× |
| Button variants | 62 `.primary`, 94 `.secondary`, 10 `.danger`, 43 `.ghost` + **39** hand-styled `.buttonStyle(.plain)` |
| Light mode | **none** (dark forced in 5 places) |
| `accessibilityLabel` | 17 uses; 19 icon-only buttons unlabeled |
| Always-running animations | 5 `TimelineView` loops (30–60 fps), 8 `repeatForever`, 39 `.entrance`, 10 `breath`, 10 `lift`, 8 `glowBorder` |

---

## A. Foundations

**UI-1 · Critical · No light mode; dark forced everywhere.**
Evidence: `BeforeIDeployApp.swift:7` `NSApp.appearance = NSAppearance(named: .darkAqua)`; `.preferredColorScheme(.dark)` at `BeforeIDeployApp.swift:45, 58`, `RootView.swift:137, 143`; `Theme.swift:18-25` static hex surfaces/text.
Impact: ignores system appearance; dark popover in a light menu bar; no option for low-vision/glare users; below HIG for a pro tool.
Fix: make every Theme colour dynamic (`NSColor(name:dynamicProvider:)` or Asset Catalog Any/Dark); remove `darkAqua` and the five `.preferredColorScheme(.dark)`; replace `Color.white.opacity(…)` sheens with `Theme.edgeHighlight` (light = black 6 %); Settings → Appearance (System/Light/Dark) setting `NSApp.appearance`.

**UI-2 · High · 610 hand-sized fonts in 33 sizes, no scale.**
Evidence: hero titles 26 bold (`V7Views.swift:21` PageHeader), 28 bold (`DashboardView.swift:192`), 22 (UsageViews), 24 heavy (`OnboardingViews.swift:60`); body uses 11/11.5/12/12.5/13/13.5 interchangeably.
Fix: `Typo` enum — display 28, title 22, headline 17, subhead 14 semibold, body 13, callout 12, caption 11, micro 10 (minimum). Ban `.system(size:)` outside Theme via lint. Map 11.5→callout, 12.5→body, 10.5→caption, 9/9.5→micro.

**UI-3 · High · Colours bypass tokens.**
Evidence: `0x7A3FD6` at `Theme.swift:151`, `Aurora.swift:37`, `BillingViews.swift:146, 205`; `0xB57BFF` at `Aurora.swift:309`, `BillingViews.swift:146,154,193,195`; GradientText `0xF5F5F7/0xBFD6FF` (`Aurora.swift:293`); WelcomeSky palette (`Aurora.swift:409-413`); `Color(white: 0.12)` (`OnboardingViews.swift:146`).
Fix: tokens `Theme.brandViolet`, `Theme.topup`, `Theme.heroGradient`, `Theme.onAccent`; move every `Color(hex:)` into Theme, dynamic.

**UI-4 · High · No radius/spacing/elevation scale.**
Evidence: cards 16, tiles 13 (`DashboardView.swift:172,576`), issue rows 12, nav rows 9/10/11, overlays 20 (`RunOverlay.swift:37`, `AIFixView.swift:28`), palette 16, tour icon 24; Card has two shadows (`Theme.swift:133-134`), RunOverlay three (`RunOverlay.swift:49-51`), Lift adds a fourth.
Fix: radii xs 6 / s 8 / m 12 / l 16 / xl 20; spacing 2/4/8/12/16/20/24/32/40; elevation e0–e3 tokens; inner radius = outer − padding.

**UI-5 · Medium · Dead/duplicate primitives.**
`AmbientBackground` (`Theme.swift:145-156`) unused; `StatusRing` (`Theme.swift:181`) ≈ `ProgressRing` (`Aurora.swift:455`); `Spinner` ≈ `Orbit`; `Shimmer` re-implemented in `SkeletonBlock` (`AutoCheck.swift:143-165`); misplaced doc comment above `floating()` (`Aurora.swift:491-495`); `AppGlyph` doc says amber arc, draws blue paperplane (`RootView.swift:424`).
Fix: delete AmbientBackground; StatusRing wraps ProgressRing; one Spinner (`ProgressView().controlSize(.small)`); SkeletonBlock uses `.shimmer()`; fix comments.

**UI-6 · Medium · Files named after versions (`V7Views.swift`, `V9Views.swift`).**
Fix: split into `DesignSystem/` (Tokens, Card, Badge, Meter, Buttons, Fields, EmptyState, Toast, PageHeader) and `Screens/`.

## B. Duplicate components

**UI-7 · High · ≈15 badge/pill/chip implementations.**
Named: `Chip` (`Theme.swift:220`), `Tag` (`V9Views.swift:523`), `StatusPill` (`V9Views.swift:533`), `CountPill` (`DashboardView.swift:471`), `BetaBadge` (`LanguageViews.swift:121`), `SignalPill` (`MonitoringViews.swift:211`), `UsagePill`. Inline: launch "optional" (`DashboardView.swift:450`), setup "optional" (`V7Views.swift:759-761`), "cached" (`RunOverlay.swift:311`), incident source (`MonitoringViews.swift:187`), severity (`IssuesView.swift:84-89`), overview status (`V7Views.swift:335-341`), nav badge (`SidebarView.swift:290-295`), tab badge (`DashboardView.swift:120-124`), "blocking" (`IssuesView.swift:17-20`), "recommended" (`BillingViews.swift:135-139`). Fonts 8–11.5, tracking 0–0.8, four fill styles.
Fix: one `Badge(text:, icon:, tone:, style: .soft/.solid/.outline, size: .sm/.md)`; wrappers or delete.

**UI-8 · High · Nine meter/progress implementations.**
`SweepBar` (`Aurora.swift:363`), QuotaRow bar (`V7Views.swift:648-654`), `UsageBar`, BalanceCard two-segment bar (`BillingViews.swift:142-151`), `HealthBar` (`DashboardView.swift:487`), `ProgressRing`, `StatusRing`, credit ring drawn twice (`V9Views.swift:378-384`, `AccountView.swift:87-93`). Different thresholds, heights (5/6/8), colours; only UsageBar has an a11y label.
Fix: `Meter(value:, total:, segments:, thresholds:, style: .bar/.ring, size:)` with `accessibilityValue`; thresholds token warn 80 % / danger 95 %; one `CreditRing`.

**UI-9 · High · Eight header/section-title variants.**
`PageHeader` (26 pt, breathing glow tile), project `HeaderView` (28 pt, `DashboardView.swift:184`), Usage header 22 pt padding 24, Assistant 15 pt GradientText bar; `SectionLabel`, `PanelHeader`, hand-rolled uppercase titles in MiniStat (`DashboardView.swift:164`), DeployStat (`Panels.swift:279`), live label (`Panels.swift:230`, `V9Views.swift:569`), FirstStepsCard (`OnboardingViews.swift:176-180`).
Fix: two levels only — `PageHeader(title, subtitle, icon?, actions)` for every top-level screen (incl. project and Usage), `SectionHeader(title, icon?, trailing)` inside cards; `.eyebrow` text style.

**UI-10 · Medium · Six text-field styles.**
`BIDTextField`, `AuthField` (`V9Views.swift:167-192`), SecureField copied 3× (`Sheets.swift:795-800`, `DomainViews.swift:189-194`, `AdminView.swift:314-318`), `.roundedBorder` fields (`MonitoringViews.swift:257, 141`, `ReleaseViews.swift:73, 229`), inline search (`V7Views.swift:252-257`).
Fix: `BIDField(placeholder, text, kind: .text/.secure/.search/.mono, size:, state:)` with focus ring.

**UI-11 · Medium · Six "selected" treatments.**
NavRow gradient pill (`SidebarView.swift:301-306`), ProjectRow fill + 3-pt bar (`SidebarView.swift:243-256`), DomainRow solid accent (`DomainViews.swift:155`), SiteRow radio (`Sheets.swift:217,226`), AdminUserRow accentSoft (`AdminView.swift:108`), palette solid accent (`V9Views.swift:696`), Language/Hosting tiles accentSoft + stroke.
Fix: `SelectableRow` with `selection.list` (accentSoft + 1 px stroke) and `selection.focus` (solid accent, palette keyboard focus only).

**UI-12 · Medium · Three segmented controls.**
`SegmentedControl` (`Sheets.swift:231`, no `.isSelected`), `TabStrip` (`DashboardView.swift:105`), template category chips.
Fix: `Segmented(options, selection, style: .tabs/.toggle/.chips)` with `.isSelected`.

**UI-13 · Medium · Three overlay shells + a non-scaffold sheet.**
RunOverlay 900×600 r20 three shadows (`RunOverlay.swift:17-51`), AIFixOverlay 1000×660 black 0.55 (`AIFixView.swift:14-29`), CommandPalette 620 r16 black 0.45 (`V9Views.swift:665-714`); `SpaceshipConnectSheet` wraps a `.card()` inside a sheet (`DomainViews.swift:228-247`).
Fix: `ModalShell(size:)` with one scrim token, radius xl, elevation e3; Spaceship sheet uses `SheetScaffold`.

**UI-14 · Low · Brand mark drawn four ways** (`RootView.swift:425`, `OnboardingViews.swift:40-45`, `LanguageViews.swift:238-243`, `V9Views.swift:210-214`). Fix: `AppGlyph(style: .filled/.onBrand)`.

## C. Navigation, layout, windowing

**UI-15 · High · Sidebar fixed 248 pt, not collapsible; project list squeezed.**
`RootView.swift:48-50` HStack, not `NavigationSplitView`; footer stacks Add project, New site, Search, update banner, AccountBadge, History/Settings (`SidebarView.swift:111-158`). At 700 pt height an admin with an update pending gets 0–40 pt of project list.
Fix: `NavigationSplitView` (`min 220, ideal 248, max 320`); New site/History/Search → toolbar or palette; footer → AccountBadge menu; projects ScrollView `minHeight 160`, `layoutPriority(1)`.

**UI-16 · Medium · ⌘1–8 order ≠ sidebar order** (`SidebarView.swift:38-73` vs `BeforeIDeployApp.swift:104-124`). Fix: Nth row = ⌘N; show hint on hover.

**UI-17 · Medium · Minimum window 1080×700 too large; fixed overlays** (`BeforeIDeployApp.swift:44`, `AIFixView.swift:27`). Fix: min 900×640 after UI-15; overlays sized to the window; adaptive grids instead of fixed KPI HStacks.

**UI-18 · Medium · Mission Control filter bar overflows at min width** (`V7Views.swift:249-274`, needs ≈815 pt of ≈767). Fix: `FlowLayout`/`ViewThatFits`, flexible search field 140–240.

**UI-19 · Medium · Per-screen content width/padding** (1100 / 1180 / 1000; PlanUsage `.padding(24)` no max). Fix: `Layout.contentMax = 1120`, `Layout.pagePadding (40/32/32/32)`, one `ScreenScaffold`.

**UI-20 · Medium · Admin wrapped in an extra ScrollView with nested ScrollView** (`RootView.swift:71-72`, `AdminView.swift:26-36`). Fix: ScreenScaffold; user list fixed height 420 or `List`.

**UI-21 · Low · Conflicting root `.animation` on the same value** (`RootView.swift:86` vs `:147`, plus `:35-37`, `:145-146`, ignoring `Motion.reduced`). Fix: one animation per value via `Motion`.

## D. Screens

**UI-22 · High · Hero card stacks five effects; confetti on every auto-check** (`DashboardView.swift:365-377`: card + 30 fps glowBorder + extra stroke + breath + Celebration on `check?.at` while ready). Fix: celebrate only on transition into ready; drop the extra stroke; glow only while blocked/running.

**UI-23 · High · Production button red on dashboard, blue elsewhere** (`DashboardView.swift:354-361` `.danger` vs `ReleaseViews.swift:272` `.primary`). Fix: `.secondary` + paperplane on dashboard; `.danger` only for delete/rollback/stop.

**UI-24 · Medium · Too many primary buttons per view** (sidebar New site, Launch next step, SetupBanner, Smart Deploy, AIFixBar, every IssueRow fix; 62 total). Fix: one primary per region; IssueRow fixes secondary except the first blocker.

**UI-25 · Medium · Issues list crowded and repetitive** (`IssuesView.swift:83-107`: severity pill 74 pt + title + kind + "Попитай AI" + fix + chevron; impact repeated `:95` and `:151`; magic `.padding(.leading, 84)` `:170`; medium = accent blue `:69`). Fix: Ask AI into details/… menu; drop duplicate; grid alignment; severity blocker=danger, high=warning, medium=info, low=neutral.

**UI-26 · Medium · Domains shows "Connect Spaceship" while loading or on failure** (`DomainViews.swift:26, 105-107`; `HostingStore.swift:47`; DNS failure → "no records"). Fix: `loadErrors["spaceship"]` + `LoadFailedView`; skeleton while loading; DNS error row.

**UI-27 · Medium · Seven loading/empty/error patterns, some with wrong keys** (`ReleaseViews.swift:21` uses `billing.loading`, `:253` uses `settings.checking`; HistorySheet no loading/error, `try?` at `Sheets.swift:424-441`; empty states `EmptyLine`, `"—"` `V7Views.swift:447`, plain text, `hand.point.left` `DomainViews.swift:89`). Fix: `LoadingState`, `EmptyState`, `ErrorState`; per-feature loading keys; idle/loading/loaded/failed everywhere.

**UI-28 · Medium · Settings is a non-scrolling sheet** (`Sheets.swift:446-535`, scaffold without ScrollView `:16-48`; ⌘, opens a sheet `BeforeIDeployApp.swift:131-134`). Fix: `Settings` scene with TabView (General, Notifications, Environment, Account, Support); meanwhile scroll + max height 520.

**UI-29 · Medium · Ten sheet widths (420…880) and fixed inner heights.** Fix: `SheetSize` s 440 / m 560 / l 720 / xl 880; scaffold scrolls with max height = window − 120.

**UI-30 · Medium · Onboarding over-animated, fixed layout** (`OnboardingViews.swift:35-89`: 30 fps sky + floating ×2 + breath + glow + stagger; card fixed 560; page dots not buttons; FirstStepsCard fixed 460). Fix: keep only the sky; `maxWidth 560`; dots as buttons with `.isSelected`; `SectionHeader`.

**UI-31 · Low · Costs KPIs/ledger don't scale** (`V7Views.swift:435-440, 506-518`). Fix: adaptive grid min 180; cap ledger 50 rows + "Show all", group by day.

**UI-32 · Low · Command palette missing destinations, silent cap 12** (`V9Views.swift:625-626` no-op `c += []`, `:649` prefix(12), `:676` "esc"). Fix: add Usage/Account/History/Settings; "+N more"; keycap `⎋`.

## E. Toasts

**UI-33 · High · Toasts vanish too fast; copy replaces the error** (`AppModel.swift:1046-1047` 2.6/4 s, engine errors 6 s `:1068`; `lineLimit(3)` `RootView.swift:161`; copy calls `flash(common.copied)` `:174`; single slot; no VoiceOver announcement). Breaks WCAG 2.2.1.
Fix: hover pauses; errors sticky (or ≥10 s); inline "Copied" checkmark; queue of 3; `AccessibilityNotification.Announcement`; no line limit for errors + "Details…".

## F. Animation and performance

**UI-34 · High · Continuous animation on every screen** — `AuroraBackground` 30 fps behind every screen (`Aurora.swift:19, 47-53`, `RootView.swift:52`); `GlowBorder` 30 fps on up to three project-screen surfaces; `Breath` on sidebar logo (`SidebarView.swift:23`), every PageHeader icon (`V7Views.swift:19`), launch step icons (`DashboardView.swift:440`), each overview card badge (`V7Views.swift:341`); `PulseDot` on blocked rows; 39 `.entrance` with up to 0.6 s stagger on every screen switch. Battery drain for a menu-bar resident app.
Fix: static Aurora (or animate 10 s after appear while key window); one GlowBorder; Breath only for "running"; entrance only on first appearance per session.

**UI-35 · Medium · Animations ignore Reduce Motion** (`Theme.swift:365-367` Spinner, `:294-296` button press, SegmentedControl/TemplateGallery `.easeOut(0.15)`, palette `.spring` `V9Views.swift:718`, tour 0.22, root 0.25 `RootView.swift:35-37`). Fix: everything through `Motion.*`; static spinner when reduced.

## G. Accessibility

**UI-36 · High · Primary buttons/solid badges fail WCAG AA.** White on `#3B9CFF` 2.84:1, on systemBlue 3.65:1 (`Theme.swift:39-42, 263`); white "blocking" on systemRed 3.41:1 (`IssuesView.swift:17-20`); nav badge 3.65:1 (`SidebarView.swift:292-295`); tertiary on elevated 4.27:1; idle on panel 3.09:1.
Fix: `accent.fill #0A66D6` (5.41), `danger.fill #D70015` (5.38), `success.fill #1E7F3C` (5.05), `warning.fill #B25000` (5.2); tertiary only on surface.0/1.

**UI-37 · High · Overlays not modal for VoiceOver/keyboard** (`RootView.swift:91-108`). Fix: `.accessibilityAddTraits(.isModal)`, `@AccessibilityFocusState` on title, background `.accessibilityHidden(true)`.

**UI-38 · High · 19 icon-only buttons unlabeled; switches unnamed** — `DashboardView.swift:728-733`, `Panels.swift:65-73, 161`, `MonitoringViews.swift:199-203`, `AutoCheck.swift:114`, `RootView.swift:170-186`, `AssistantView.swift:44-45`; `ToggleRow` `Toggle("", …).labelsHidden()` (`Sheets.swift:864-866`).
Fix: `IconButton` or `.accessibilityLabel(L(...))`; `Toggle(title, isOn:)` + `.labelsHidden()` + hint; lint check.

**UI-39 · Medium · Status by colour only** (ProjectRow dot `SidebarView.swift:235-263`, HealthBar `.help` only `DashboardView.swift:487-499`, CountPill numbers `:471-485`, OverviewCard uptime dot). Fix: `accessibilityValue(statusText)`, combined labels, `StatusDot(label:)`.

**UI-40 · Medium · Tiny text, no scaling, no focus ring** (≈40 sites at 8–10 pt; 0 `@ScaledMetric`; `.plain` buttons and `BIDButtonStyle` draw no focus). Fix: min 10 pt; type scale from `NSFont.preferredFont`; focus ring in BIDButtonStyle, IconButton, NavRow, SelectableRow.

## H. Localization (Bulgarian)

**UI-41 · High · Core action names in English** — 32 keys with bg == en: `run.smartDeploy` "Smart Deploy" (bg:988), `run.commitPush` (962), `run.localPreview` (972), `run.draftPreview` (968), `run.productionDeploy` (980), `hosting.productionButton` "Production" (590), `hosting.previewButton` (587), `nav.missionControl` (765), `signal.backup` (1039), `netlify.dashboard`, `local.devServer`, `run.push`, `palette.production`. Hero reads "Провери | Smart Deploy | Production".
Fix: «Умно публикуване», «Запиши и качи», «Локален преглед», «Чернова (преглед)», «Публикувай на живо…», «Контролен център», «Резервно копие»; i18n check fails on bg == en except a brand allow-list.

**UI-42 · High · Deploy/publish terminology inconsistent** — "deploy" 48×, "production" 36×, "preview" 40×, «публику-» 26×, "live" 10×; «DEPLOY-ЪТ Е БЛОКИРАН» (1061), «ГОТОВ ЗА DEPLOY» (1063), «готови за deploy» (842), «…блокира deploy-а» (284), «push-овете deploy-ват» (770), «Няма live сайт» (840) next to «НА ЖИВО» (585); «Пускане» = launch checklist (663) **and** release (939, 887).
Fix: glossary — deploy → публикувам/публикуване, production → на живо, preview → преглед, live site → сайт на живо, commit → запис (commit), push → качване, Launch checklist → «Път до публикуване», Release → «Публикуване на живо»; rewrite all.

**UI-43 · High · Hard-coded English in Swift** — `"Live · …"` (`DashboardView.swift:58`), `.help("⌘R — Git, secrets, lint, typecheck, build")` (`:332`), "Secrets/Lint/Typecheck/Build/Hosting" (`:508-511`), tab "GitHub" for any remote (`:10`, `Panels.swift:105`), "branch", "ahead / behind" (`Panels.swift:116,119`), "auto-renew" (`DomainViews.swift:143`), "Netlify: custom domain …" (`:321`), `opName` English (`V7Views.swift:563-568`), "CLI"/"preview" (`V9Views.swift:501-503`), "Engine" (`Sheets.swift:472`), default commit "Update — dd.MM.yyyy" (`Sheets.swift:337`), "esc" (`V9Views.swift:676`), "API Key/API Secret" (`DomainViews.swift:188-189`), "commit …" (`AIFixView.swift:148`).
Fix: move all into strings; `i18n-check` greps `Text("[A-Za-z]` and `label: "[a-z]` in views.

**UI-44 · Medium · Raw backend ids shown** — Admin pickers `["normal","vip","admin"]`, `["free","flash","high","knight"]` (`AdminView.swift:123-124,141,146,205`), `"\(user.role) · \(user.plan)"` (`:101`), audit `e.action` (`:67`), `Chip(text: role)` (`AccountView.swift:100-102`), `account.rolePlan` (`V9Views.swift:422`), raw step/model (`BillingViews.swift:318-319`), `K.*` raw fallback (`LocalizedKeys.swift:6-80`), locale code under native name (`LanguageViews.swift:299`).
Fix: `K.role`, `K.plan`, `K.auditAction`, `K.step`, `K.provider`; fallback «Друго (%@)» + log.

**UI-45 · Medium · "Credits" vs "tokens"** — `billing.subtitle` (bg:327), `billing.legal` «токени» (307), `assistant.budgetUsed` «токена» (177), `common.costs` «Разходи & кредити» (394) vs `usage.nav` (1127), comment `Theme.swift:423`.
Fix: user unit = «кредити» everywhere; `common.costs` → «Разходи»; "&" → «и».

**UI-46 · Low · Wording** — «Оправи с AI» (bg:98) vs «Поправи с AI» (608, 653); «Попитай AI» vs «AI асистент»; «без auto-renew» (506); «НА ЖИВО 🚀»; «anon public key» (347); «User Key». Fix: «Поправи с AI», «Попитай асистента», «без автоматично подновяване», no emoji, translate.

**UI-47 · Medium · Fixed sizes truncate Bulgarian** — overview badge `.fixedSize()` vs `lineLimit(1)` name (`V7Views.swift:337`); hero issue line `lineLimit(1)` (`DashboardView.swift:312-315`); SetupRow detail (`V7Views.swift:764-772`); MiniStat value; severity pill 74 pt (`IssuesView.swift:89`); toast 3 lines.
Fix: icon + short label («Готов», «Предупр.», «Блокиран») or second line; `.help(fullText)`; grid columns instead of fixed widths; two lines for setup detail.

## I. Screenshot CI

**UI-48 · Medium · Screenshot CI misses risky layouts** — only 1280×820 dark, one sheet, short names; 14 s wait while TimelineViews animate.
Fix: `-BIDWindowSize 1080x700` shots; long project name «много-дълго-име-на-онлайн-магазин-за-клиент»; release + history sheets; Reduce Motion pass; Light + Dark passes after UI-1.

---

## Design System v2 — proposal

### 1. Colour tokens (semantic, dynamic)

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg.window` | #F5F5F7 | #1C1C1E | window/page |
| `bg.sidebar` | NSVisualEffect `.sidebar` (fallback #ECECEE) | `.sidebar` (fallback #161618) | sidebar |
| `surface.1` | #FFFFFF | #232325 | cards |
| `surface.2` | #F2F2F4 | #2C2C2E | inset controls, chips, fields |
| `surface.hover` | #E8E8ED | #3A3A3C | hover |
| `surface.inset` | #EDEDF0 | #1C1C1E | logs, code |
| `border.hairline` | rgba(0,0,0,.10) | #38383A | dividers |
| `border.edge` | rgba(0,0,0,.06)→0 | rgba(255,255,255,.11)→.035 | top-lit edge |
| `text.primary` | #1D1D1F | #F5F5F7 | |
| `text.secondary` | #5E5E63 | #A1A1A6 | |
| `text.tertiary` | #6E6E73 | #9A9AA0 | captions only |
| `accent.fill` | #0A66D6 | #0A66D6 | primary buttons, solid badges (white 5.4:1) |
| `accent.text` | #0A66D6 | #409CFF | links, icons |
| `accent.soft` | accent 12 % | accent 16 % | selection, soft badges |
| `success.fill/.text` | #1E7F3C / #1E7F3C | #1E7F3C / #30D158 | |
| `warning.fill/.text` | #B25000 / #B25000 | #B25000 / #FF9F0A | |
| `danger.fill/.text` | #D70015 / #D70015 | #D70015 / #FF6961 | |
| `info.fill/.text` | #007A8A / #007A8A | #007A8A / #5AC8FA | |
| `neutral.text` | #6E6E73 | #8E8E93 | idle/unknown |
| `brand.violet` | #7A3FD6 | #B57BFF | packs, aurora |
| `scrim` | black 25 % | black 45 % | overlays |

Status mapping once, as `Tone` (`.success/.warning/.danger/.info/.neutral/.accent`); components pick `.fill/.text/.soft`.

### 2. Type scale (`Typo`)
display 28 bold · title 22 bold · headline 17 semibold · subhead 14 semibold · body 13 · callout 12 · caption 11 · micro 10 semibold (+0.6 tracking, minimum) · mono 12/11 · numeric = display/title + `.rounded` + `monospacedDigit`.

### 3. Spacing (`Space`)
xxs 2 · xs 4 · s 8 · m 12 · l 16 · xl 20 · xxl 24 · page 32 · top 40. Card padding l (hero xl).

### 4. Radii (`Radius`)
xs 6 (keycaps) · s 8 (rows, inner inputs) · m 12 (buttons, fields, tiles) · l 16 (cards) · xl 20 (sheets, overlays) · full.

### 5. Elevation
e0 flat · e1 card: surface.1 + border.edge, y1 r1.5 black 12 %/20 % · e2 popover/hover: y6 r14 14 %/28 % · e3 sheet/overlay: y16 r40 18 %/50 % + scrim. Glow only on the single attention surface.

### 6. Motion
instant (nil) · quick 0.16 · standard spring(0.35, 0.85) · gentle 0.6. Every animation via `Motion`; infinite loops only for running/live states.

### 7. Core components

| Component | API sketch | Replaces |
|---|---|---|
| Card | `Card(elevation:, padding:, tone:, attention:)` | `.card()`, MiniStat, HealthTile, HostingOptionTile, FirstStepsCard, IssueRow bg |
| ScreenScaffold / PageHeader | `ScreenScaffold(title:, subtitle:, icon:, actions:) { }` (ScrollView, contentMax 1120, page padding) | PageHeader, HeaderView, Usage header, Admin wrapper |
| SectionHeader | `SectionHeader(title, icon?, trailing?)` + `.eyebrow` | SectionLabel, PanelHeader, uppercase titles |
| Badge | `Badge(text, icon?, tone:, style:, size:)` | Chip, Tag, StatusPill, CountPill, BetaBadge, SignalPill core, 10 inline pills |
| Meter | `Meter(segments:, total:, style: .bar/.ring, size:, thresholds:)` + a11y value | SweepBar, QuotaRow bar, UsageBar, Balance bar, HealthBar, rings |
| Button | `BIDButtonStyle(kind: .primary/.secondary/.tertiary/.destructive, size:)` + focus ring; `IconButton(symbol, label, size)` mandatory for icon-only | 39 `.plain` buttons |
| Field | `BIDField(placeholder, text, kind:, state:)` | BIDTextField, AuthField, SecureField copies, roundedBorder |
| Segmented | `Segmented(options, selection, style: .tabs/.toggle/.chips)` | SegmentedControl, TabStrip, chips |
| SelectableRow | `.selectable(selected:, style: .list/.focus)` | NavRow, ProjectRow, DomainRow, SiteRow, AdminUserRow, palette row, tiles |
| Empty/Loading/ErrorState | `EmptyState(icon, title, message?, action?)`, `LoadingState(.inline/.block/.skeleton)`, `ErrorState(message, retry)` | EmptyLine, "—", LoadFailedView, Spinner+text, skeletons |
| Toast | `ToastCenter` (queue 3, sticky errors, hover pause, VoiceOver, inline Copied) | ToastView + `present()` |
| ModalShell / SheetScaffold | `ModalShell(size:, isModal)`; `SheetScaffold(size: .s/.m/.l/.xl)` with scroll + max height | three overlay shells; ten sheet widths |

### 8. Migration order
1. Tokens with no visual change (`Tone`, `Typo`, `Space`, `Radius`, `Elevation`, dynamic colours with dark values); delete AmbientBackground; lint rules (warning) forbidding `.system(size:`, `Color(hex:`, literal `cornerRadius:`, `.shadow(` outside `DesignSystem/`.
2. Contrast + accessibility hotfix (UI-33, 36–39).
3. Primitives (Button, Badge, Meter, Field, Segmented, SelectableRow, states, ToastCenter); swap call sites, shared files first.
4. Scaffolds (ScreenScaffold, PageHeader, SectionHeader, SheetScaffold sizes, ModalShell) — fixes UI-9/13/19/20/28/29.
5. Navigation/layout (NavigationSplitView, slim footer, ⌘N order, min size, adaptive grids) — UI-15–18, 31.
6. Motion diet — UI-22/34/35.
7. Localization pass — UI-41–47 (glossary, translations, `K.*`, credits only, bg==en and hard-coded-Latin checks).
8. Light mode (UI-1) + screenshot CI passes (UI-48); lint rules become errors.
