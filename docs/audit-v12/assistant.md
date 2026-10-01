# Приложение B — AI асистент (AI-*)

# AI Assistant audit: "Before I Deploy" (read-only)

**Scope.** I read these files:
- `App/Sources/BeforeIDeploy/AssistantView.swift` (414 lines)
- `App/Sources/BeforeIDeploy/Stores/AssistantStore.swift` (214)
- `Theme.swift`, `Aurora.swift`, `LocalState.swift`
- Shared pieces: `IssuesView.swift` (EmptyLine), `AIFixView.swift` (DiffText, MarkdownText), `UsageViews.swift` (UsageBar, UsagePill), `Engine.swift`, `AppModel.swift`, `RootView.swift`, `LocalizedKeys.swift`
- `App/Resources/{bg,en}.lproj/Localizable.strings`
- Engine: `engine/src/ai/{assistant,providers,prompts,index}.mjs`, `engine/src/bid.mjs`, `engine/prompts/*.json`, `engine/i18n/bg.json`

Swift was not compiled. Every finding comes from reading the code.

**Context that explains the "ugly" impression.**
- The assistant has no chat UI of its own. It is a debug console: raw JSON streams in a monospaced font, answers are a key/value dump, and the composer is a one-line system text field with six buttons under it.
- Saved conversations reload as empty cards.
- Several things the request asks to review do not exist at all: markdown rendering, code blocks, a model picker, inline key setup, and light mode (the app is forced dark at `RootView.swift:137` and `BeforeIDeployApp.swift:45`, and `Theme` uses fixed dark hex colors).

Severity scale: **Critical** = broken or lying UX · **High** = clearly visible or wrong behavior · **Medium** = polish or consistency · **Low** = nit.

---

## 1. UI and visual findings

**AI-1 · Critical · The streamed answer is raw JSON in a monospaced font**
- Evidence: `AssistantView.swift:250` has `Text(turn.text).font(.system(size: 12.5, design: .monospaced))`. The text comes from `AssistantStore.swift:106` (`live.text += d`). The deltas come from `assistant.mjs:206` (`emit({ type: 'ai', delta: e.text })`). Every prompt tells the model to "Return JSON with exactly these fields…" (`engine/prompts/*.json`).
- Impact: while a reply is generating, the user watches `{"answer": "…", "evidence_ids": ["E1"…` scroll by in grey code font. This is the single ugliest moment in the feature, and the worst in Bulgarian, where escaped characters can show up.
- Fix:
  - Engine: add an incremental JSON string extractor in `callModel`. Track the first top-level string field (`answer`, `summary` or `observed_impact`, in that order of preference), and emit `{type:'ai', field:'answer', delta}` only for the decoded characters inside that string. Keep the raw text internal.
  - App: render that field with the normal answer typography (AI-6). Until the first field delta arrives, show the "thinking" row (AI-16).
  - Never show raw text except in the "rejected answer" disclosure.

**AI-2 · Critical · Answers reloaded from history render as empty cards**
- Evidence: `AssistantStore.swift:69` rebuilds each turn as `AssistantResult(… output: nil, valid: e.valid ?? false …)` and puts the summary in `text`. `TurnView` (`AssistantView.swift:236-242`) only shows `turn.text` when `r.output == nil && r.valid == false`, and then inside a disclosure titled "Raw answer (rejected by validation)".
- Impact: after an app restart or project switch, every valid past answer shows only its header row (sparkles, action, time). Invalid ones are mislabelled.
- Fix:
  - Engine (`assistant.mjs:280`): also save `output` (capped at about 16 KB), `files` (without diffs, or with diffs capped), `risk`, `usage`, `errors[0..5]` and `applied/recheck`.
  - Add matching fields to `AssistantHistoryEntry` (`Models.swift:1332`) and map them into `AssistantResult`.
  - In `TurnView`, when `result.output == nil` but `text` is set, render `text` as the answer body, never as the raw disclosure.

**AI-3 · High · Markdown is not rendered at all**
- Evidence: `OutputFields.field` (`AssistantView.swift:355-370`) uses plain `Text(s)`. `MarkdownText` exists at `AIFixView.swift` (after DiffText) but the assistant never uses it.
- Impact: `**bold**`, `` `code` ``, lists and fenced code from the model appear as literal asterisks and backticks. There are no code blocks with a monospaced background and no copy button.
- Fix: write `AssistantMarkdown` in a new `AssistantComponents.swift`:
  - Split the string on lines starting with three backticks.
  - Render prose paragraphs through `AttributedString(markdown:, options: .inlineOnlyPreservingWhitespace)`.
  - Turn `- ` and `1. ` lines into hanging-indent rows.
  - Render fenced blocks as a `CodeBlock` view (spec in §5).
  - Use it for `answer`/`summary` and for every string array item.

**AI-4 · High · The answer is a generic key/value dump with raw English keys and values**
- Evidence:
  - `AssistantView.swift:337-379` uses a generic `OutputFields`.
  - Object items use `JSONValue.text` (`Models.swift:1279`), which produces `"claim: … · confidence: high · evidence_ids: E1, E2"`.
  - `K.outputField` falls back to `v.replacingOccurrences(of: "_", with: " ")` (`LocalizedKeys.swift:242`), so `observed_impact` shows as "observed impact" in English.
- Impact: hypotheses, observations, findings and recovery options read like debug output. Bulgarian users see English keys and enum values ("high", "likely", "blocker").
- Fix: render each object type with its own small view:
  - `HypothesisRow`: claim text plus a confidence pill colored high = ready, medium = warn, low = idle, with a localized label.
  - `ObservationRow`: finding text with an evidence chip.
  - `FindingRow`: severity pill (blocker / major / minor / optional), monospaced path, explanation, suggested action.
  - `RecoveryOptionRow`: option, then "requires" and "limits" as secondary lines.
  - Add `K.outputField` cases for `observed_impact`, `summary`, `answer`, `completed_checks` vs `required_checks` vs `recommended_checks` (three distinct labels), plus `K.confidence` and `K.findingSeverity` helpers.

**AI-5 · High · Evidence ids are shown as bare "E1, E3"**
- Evidence: `evidence_ids` is in `OutputFields.order` (`AssistantView.swift:339`) and is rendered as bullets. The side-panel context list that maps ids to labels is cleared on every run (`AssistantStore.swift:95`).
- Impact: the ids mean nothing to the user and cannot be resolved for older turns.
- Fix: keep `evidence` per turn (the engine already returns `evidence` in the result for ask/diagnose at `assistant.mjs:330`; add it for the others). Render a "Sources" footer of chips, e.g. "📄 src/app.tsx" or "Log · build.log". Hovering a chip shows its size and redaction count. Remove `evidence_ids` from the field list.

**AI-6 · High · There are no chat bubbles: every assistant turn is a full-width bordered box**
- Evidence: `AssistantView.swift:254-257` uses `.padding(14)`, full width, `Theme.bg` fill and a hairline stroke. The user bubble (`:216-223`) is `Theme.accent.opacity(0.14)`, radius 12, with only `Spacer(minLength: 80)` limiting it.
- Impact: it looks like a log, with no reading column. At 1280 wide (side panel 340) lines run about 850 px, which is too long to read. User bubbles can be just as wide.
- Fix:
  - Center a reading column at `maxWidth: 760`.
  - Assistant messages get no box: a 24 pt avatar column followed by flowing content, as in Claude.ai.
  - User messages: trailing bubble, `maxWidth: 560`, fill `Theme.accent.opacity(0.18)`, continuous radius 18 with the bottom-trailing corner 6 (custom `UnevenRoundedRectangle` shape; it is macOS 14+, so on 13 use a hand-built path).
  - Exact numbers are in §5.

**AI-7 · Medium · Developer metadata in the turn header**
- Evidence: `AssistantView.swift:229-232` shows the action label at 10 pt, the template id `ask.v1` in monospace (`:230`), and the time. The user bubble also has an action caption (`:219`), e.g. "Попитай" over every typed question.
- Impact: clutter, and an internal identifier shown to users.
- Fix:
  - Remove the template id from the UI (move it to a hover popover under "Details").
  - Drop the caption for `ask`. Show it only for quick actions, as a chip inside the user bubble ("✦ Обясни проблема").
  - Show the time on hover only.

**AI-8 · High · The composer is a one-line system text field**
- Evidence: `AssistantView.swift:81-85` uses `TextField(...).textFieldStyle(.roundedBorder)` and `.disabled(store.running)`.
- Impact:
  - Long Bulgarian questions scroll sideways inside a 22 px field.
  - There is no multi-line input and no Shift-Return for a new line.
  - The field is disabled during a run, so the user cannot write the next question and loses focus.
  - The system rounded border clashes with `BIDTextField` (`Theme.swift:333`).
- Fix:
  - Replace it with `ComposerField`: a `TextEditor` (macOS 13) with a placeholder overlay, height growing from 1 to 6 lines (min 22, max 132 pt), `.scrollContentBackground(.hidden)`, inside a 16-radius `Theme.elevated` surface with a hairline border that turns `Theme.accent.opacity(0.6)` on focus.
  - Return sends, Shift-Return inserts a newline. Intercept via `NSTextView` key handling with a small `NSViewRepresentable`, or `.onKeyPress` on macOS 14 with a 13 fallback.
  - Keep the field editable while a run is going; only the send button changes.

**AI-9 · High · Six quick-action buttons sit permanently under the input**
- Evidence: `AssistantView.swift:92-99` puts six `.bidButton(.secondary, compact: true)` buttons in a `FlowLayout` with `fixedSize` labels.
- Impact: with the Bulgarian labels ("Готовност за пускане", "Разследвай инцидента", "Предложи поправка"…) at the 490 px minimum conversation width, they wrap to 2–3 rows. The composer becomes about 120 px of grey buttons, and half of them are disabled (40% opacity) until an issue is picked.
- Fix:
  - Move the actions into (a) suggestion cards in the empty state and (b) a single "✦ Actions" menu button inside the composer toolbar.
  - Show contextual chips above the composer only when they apply. For example, when an issue is selected: "Обясни проблема" and "Предложи поправка".
  - Hide unavailable actions instead of dimming them.

**AI-10 · Medium · The send button is a text button and Return is the only shortcut**
- Evidence: `AssistantView.swift:89` is `Button(L("assistant.send"))` with no `.keyboardShortcut`. Stop uses `.cancelAction` (`:87`), which is good.
- Impact: it does not look like a modern chat send button. Send is enabled with an empty draft and then shows an error toast (`AssistantStore.swift:82`).
- Fix:
  - Use a 30 pt circular button with `arrow.up` in `Theme.accentGradient`, disabled while the trimmed draft is empty.
  - While running, it becomes a 30 pt circle with `stop.fill` (`.danger` tint) and Esc as its shortcut.
  - Add `.keyboardShortcut(.return, modifiers: .command)` as an alternative.
  - Focus the composer on appear with `@FocusState`, and add a Cmd-L shortcut to focus it.

**AI-11 · High · Auto-scroll ignores streaming and result growth, and scrolls without animation**
- Evidence: `AssistantView.swift:60` uses `.onChange(of: store.turns.count)`.
- Impact: while text streams, and when the large result card replaces the text, the view does not follow. The user scrolls by hand. `scrollTo` into a `LazyVStack` with a not-yet-realized id can also land in the wrong place.
- Fix:
  - Put a 1 pt `Color.clear.id("bottom")` anchor after the stack.
  - Watch a `store.scrollTick` counter that the store increments on every delta and on completion. Scroll with `withAnimation(Motion.quick) { proxy.scrollTo("bottom", anchor: .bottom) }`, but only while the user is pinned to the bottom (track this with a `GeometryReader` preference on the anchor).
  - When the user is not pinned, show a floating "↓ Ново" capsule button (spec in §5).

**AI-12 · High · The diff preview clips vertically and cannot be scrolled**
- Evidence: `AssistantView.swift:307` is `ScrollView(.horizontal) { DiffText(diff: f.diff)… }.frame(maxHeight: 220)`. `DiffText` (`AIFixView.swift:246`) uses `.frame(maxWidth: .infinity)` per line.
- Impact: a horizontal-only scroll view inside a 220 pt frame cuts off every line after about the 15th, and those lines cannot be reached. Inside a horizontal scroll view, `maxWidth: .infinity` resolves to each line's own width, so the green and red line backgrounds are ragged. Diffs are also collapsed by default (`DisclosureGroup`).
- Fix:
  - Use `ScrollView([.horizontal, .vertical])` with `.frame(maxHeight: 320)`.
  - In `DiffText`, measure the widest line and give every line `.frame(minWidth: widest, alignment: .leading)`, or wrap the VStack in `.fixedSize(horizontal: true, vertical: false)` plus a background `GeometryReader`.
  - Add a gutter with old/new line numbers.
  - Expand the first file by default.

**AI-13 · Medium · The patch card lacks per-file control, a config approval step and a skipped-files list**
- Evidence:
  - `AssistantView.swift:298-333` shows all files.
  - `store.apply` (`AssistantStore.swift:153`) calls `ai apply --patch-file … --yes --recheck` with no `--files` and no `--allow-config`.
  - `res.skipped` is stored but never rendered (`:157`).
  - `aiApply` silently skips `needsApproval` files unless `allowConfig` is set (`engine/src/ai/index.mjs:126`).
  - The separate AI Fix flow (`AIStore.apply`) does all of this properly.
- Impact: a config-file change is proposed, "Apply" looks successful, and the file is quietly not written. The user cannot deselect a file.
- Fix: reuse the AI Fix file row (checkbox, "needs your approval" badge for `needsApproval`, a separate tick that adds `--allow-config`). Pass `--files`. After applying, render a "Skipped" list with reasons (`ai.skip.*` keys).

**AI-14 · Medium · There is no progress UI while "Apply & verify" runs (it can take minutes)**
- Evidence: `AssistantStore.swift:147-166` uses `engine.call(…, timeout: nil)` with no event callback. The only signal is the button at 40% opacity (`AssistantView.swift:324`).
- Impact: the re-check runs the full project check. For minutes nothing moves: no spinner, no stages, and no way to cancel.
- Fix:
  - Use `engine.run(args, handle:)` with an `onEvent` that feeds `step` events into `stages`.
  - In the patch card, show an inline status row: "Прилагам…" then "Проверявам стъпка X…", with the `Spinner` and a `SweepBar`.
  - Add a Stop button that uses the handle.

**AI-15 · Medium · Undo is not tied to the turn and its result is never shown**
- Evidence:
  - `AssistantView.swift:327-328` shows the Undo button for any turn with `applied != nil`.
  - `AssistantStore.undo()` (`:168-179`) calls `ai undo` (the last change globally) and never sets `result.undone` or clears the button.
- Impact: Undo on an older turn reverts the newest patch. After undo, the card still says "Applied" and still offers Undo.
- Fix:
  - Show Undo only on the newest turn whose patch is the last undo record (compare `applied.undoFile` with the newest).
  - After a successful undo, set `turns[i].result?.undone = true` and `applied = nil`, and show the existing `undoneLine`.
  - Ask for confirmation through `confirmationDialog`.

**AI-16 · Medium · The loading state is weak and mixes three animations**
- Evidence: `AssistantView.swift:244-248` combines `Orbit(size: 14)`, the text "Мисля…" and `TypingDots()`. The streaming state adds another `TypingDots` (`:251`). The header sparkles also `.breath` forever (`:37`).
- Impact: noisy and not informative. The real progress (stage labels such as "Чета доказателствата (claude-opus-5-5)…") lives in the side panel, far from the eye.
- Fix: show one "thinking" row in the assistant column: the avatar pulses (`PulseDot` style), then the current stage summary from `store.stages.last?.summary` with a `.shimmer()`, then elapsed seconds. Remove `TypingDots` and the permanent `breath`.

**AI-17 · Medium · The empty state is a flat text block in the top-left**
- Evidence: `AssistantView.swift:68-76` has three left-aligned paragraphs on a `Theme.bg` rectangle, radius 12.
- Impact: it does not invite the user to start. The Claude, ChatGPT and Raycast pattern is a centered greeting with suggestion cards.
- Fix: center it vertically with a 44 pt avatar orb (accent gradient circle with `sparkles`, `.floating()`), a 22 pt semibold title, a 13 pt secondary subtitle, and a 2×2 grid of suggestion cards (`.card(padding: 14)` + `.lift()`, 15 pt icon in a 28 pt tinted circle, 13 pt semibold title, 11.5 pt subtitle). Cards are context-aware: "Обясни проблема: <top issue>" when issues exist, "Готовност за пускане", "Попитай защо проверката падна", "Разследвай инцидента" only when incidents exist. Move the data-privacy note to one 11 pt line with a `lock.shield` icon under the grid.

**AI-18 · Medium · No message actions (copy, retry, regenerate)**
- Evidence: nothing like this exists in `TurnView`. `.textSelection` is applied per `Text`, so the user cannot select across fields.
- Impact: copying an answer means selecting field by field. After a timeout or invalid output there is no retry.
- Fix: a hover toolbar under each assistant turn with Copy (copies the answer plus fields as Markdown), Retry (re-sends the same action, message, issue and files, stored on the `Turn`) and a "Details" popover (model, tokens, duration, template, repairs). For errors, show the Retry button inline.

**AI-19 · Medium · Errors render as a small grey line with no next step**
- Evidence: `AssistantView.swift:235` is `EmptyLine(icon: "xmark.octagon.fill", text: e, tint: Theme.blocked)`, 12.5 pt in secondary color (`IssuesView.swift:45`). `outcome.errorCode` is never read (`AssistantStore.swift:129`).
- Impact: `ai_unavailable`, `quota_exhausted`, `not_logged_in`, `ai_session_cap`, `ai_timeout`, `ai_rate_limited`, `budget_exceeded`, `secret_file` and `bad_path` all look the same, with no button.
- Fix: store `errorCode` on the `Turn` and render an `ErrorCallout` (`.card(padding: 12, tint: Theme.blocked)`) with a code-specific action:
  - `ai_unavailable` → "Добави ключ" (`model.sheet = .aiKeys`) or "Планове".
  - `not_logged_in` → Sign in.
  - `quota_exhausted` → Usage.
  - `ai_timeout` / `network` / `ai_rate_limited` / `ai_failed` → Retry.
  - `budget_exceeded` → "Вдигни бюджета" (opens settings).
  - `secret_file` / `bad_path` → focus the files field.

**AI-20 · Medium · The side panel is fixed at 340 pt, always visible, and repeats information**
- Evidence:
  - `AssistantView.swift:24` sets `sidePanel.frame(width: 340)`.
  - The scope card repeats the site name (`:131`, already in the header at `:40`).
  - Cards use the heavy `.card` double shadow (radius 16, `Theme.swift:133-134`) in a narrow column.
- Impact: at the 1080 pt minimum window width (`BeforeIDeployApp.swift:44`) the conversation gets about 490 pt. The panel competes with the chat and mostly shows a "What will be sent" list that is empty between runs.
- Fix:
  - Make it a collapsible inspector, 300 pt wide, toggled from the header (`sidebar.right`, Cmd-Opt-I), collapsed automatically below 1180 pt of content width (`GeometryReader`).
  - Move the scope (issue and files) into the composer as chips (spec in §5).
  - Keep "What will be sent", "Stages" and "Budget" in the inspector as flat sections separated by hairlines, not shadowed cards.

**AI-21 · Medium · The files input is a comma-separated monospaced text field**
- Evidence: `AssistantView.swift:140-141` is a `TextField(L("assistant.files"))` with `.roundedBorder` at 11.5 pt monospace, plus a 10.5 pt hint paragraph.
- Impact: error-prone (typos give `bad_path`/`not_found` errors), and there is no autocomplete.
- Fix: add a "+ Файл" chip in the composer that opens an `NSOpenPanel` rooted at the project path (multi-select, rejecting anything outside it) or a searchable popover of project files. Selected files appear as removable chips (`Chip` with `xmark`).

**AI-22 · Low · The issue picker is a stock menu Picker with long concatenated titles**
- Evidence: `AssistantView.swift:133-138` builds labels as `"\(K.severity) · \(i.title)"`.
- Impact: a raw system popup inside a custom card, and long Bulgarian titles truncate badly.
- Fix: use a composer chip "⚑ <issue title>" with a severity-colored dot. It opens a popover list in the `IssueRow` style (severity pill + title, two lines) with a "Без проблем" row.

**AI-23 · Low · Typography has no scale: seven font sizes in one screen**
- Evidence: 10, 10.5, 11, 11.5, 12, 12.5 and 13 pt across `AssistantView.swift`. Answer text is 13 pt (`:356`), other fields 12 pt (`:358`), field labels 10.5 pt bold (`:376`, not uppercased), while `SectionLabel` uppercases with tracking (`Theme.swift:212`).
- Impact: the screen feels busy and inconsistent.
- Fix: four styles only, all `.system`:
  - Body 14 / line spacing 3 (`.lineSpacing(3)`).
  - Secondary 12.5.
  - Caption 11 (`SectionLabel`-style headers for field groups).
  - Mono 12.5.
  - Define them as `enum AssistantType { static let body = Font.system(size: 14) … }` in the new components file.

**AI-24 · Low · List bullets are glued into the string, so wrapped lines do not hang-indent**
- Evidence: `AssistantView.swift:364` uses `Text("• " + item.text)`, and the same pattern at `:276`.
- Impact: in long Bulgarian bullets the second line starts under the bullet.
- Fix: use `HStack(alignment: .firstTextBaseline, spacing: 8) { Circle().fill(Theme.tertiary).frame(width: 4, height: 4).offset(y: -3); Text(...) }`, or a numbered `Text("\(n).").monospacedDigit().frame(width: 18, alignment: .trailing)` for `next_steps`.

**AI-25 · Low · Header icon buttons do not use the design system**
- Evidence: `AssistantView.swift:44-45` uses plain `Button { Image(...) }.buttonStyle(.plain)` instead of `IconButton` (`Theme.swift:306`). Trash clears the conversation with no confirmation (`AssistantStore.swift:181-189`, which also clears the UI even when the engine call fails, via `try?`).
- Fix:
  - Use `IconButton(symbol:help:)` for settings, the new "New conversation" (`square.and.pencil`) and the inspector toggle.
  - Put "Изчисти разговора" in a `…` menu behind a `confirmationDialog`.
  - Only clear `turns` when the engine returns `cleared: true`.

**AI-26 · Low · The cost and budget display is confusing**
- Evidence:
  - The budget card shows the per-operation token budget (`AssistantView.swift:194-205`).
  - `UsagePill` in the header shows account credits (`UsageViews.swift:266`).
  - `lastCost` reads `store.turns.last?.result?.usage`, which is nil after a reload.
  - The cost line shows the raw model id (`:290`, "1 234 токена · claude-opus-5-5").
- Impact: two different "token" numbers side by side.
- Fix:
  - Per message: a hover-only caption "1 234 кредита · 8 s".
  - Inspector: "Тази операция: used / limit" with a `SweepBar`.
  - Header: keep `UsagePill`.
  - Map the model id to a display name ("Claude Opus 5.5"), and show "Before I Deploy AI" for cloud.

**AI-27 · Low · There is no model or provider indication and no inline key setup**
- Evidence: the provider and model are chosen silently by the engine (`assistant.mjs:259-260`). The app has no picker. The sidebar NavRow opens the assistant without the `aiReady` gate (`SidebarView.swift:~49`), unlike `openAssistant` (`AppModel.swift:516`).
- Impact: users without a key or plan reach a working-looking screen and only get an error after sending.
- Fix:
  - When `!model.aiReady`, replace the composer with a setup card: "Свържи AI" with "Добави API ключ" (`.aiKeys`) and "Планове" (`.plans`) buttons.
  - Add a small provider chip in the composer toolbar ("✦ Claude Opus 5.5 · собствен ключ" / "Before I Deploy AI"). It is a menu when more than one provider is available; the engine already accepts `--provider` and `--model` (`bid.mjs:332`).

**AI-28 · Low · `Spinner` ignores Reduce Motion, and the turn timestamp is reformatted on every render**
- Evidence: `Theme.swift:365-367` has no `Motion.reduced` guard. `AssistantView.swift:232` builds a new `ISO8601DateFormatter()` per render and round-trips the date through a string.
- Fix: guard with `Motion.reduced`, and add `Fmt.time(_ date: Date)` that takes a `Date`.

---

## 2. Behavior findings (engine and store)

**AI-29 · Critical · The "fix" action is labelled "apply and verify" but never applies**
- Evidence:
  - `actionButton("fix", …)` sends `store.send(action: action, yes: false)` (`AssistantView.swift:95,106`).
  - The engine applies only when `opts.yes || (autoApplyLowRisk && risk==='low')` (`assistant.mjs:410`) and otherwise stops with `needs_confirmation`.
  - In bg.strings, `assistant.action.fix` = "Приложи и провери" (the same text as `assistant.applyVerify`).
  - The follow-up "Apply" button uses `ai apply` (one pass), so the iterative fix loop (`maxIterations`, regression undo) is never reachable from the UI unless auto-apply is on.
- Impact: the button text promises something it does not do. "Propose" and "fix" behave identically.
- Fix:
  - Rename the action to "Поправи (до N опита)".
  - Clicking it opens a `confirmationDialog` ("AI ще прилага и проверява до N пъти; промяна, която влоши проверката, се връща") and then sends `yes: true`.
  - Or remove "fix" from the quick actions and keep propose → review → apply.

**AI-30 · High · No conversation memory: every message is answered alone**
- Evidence: `assistantChat` creates or reuses a `conversation` id (`assistant.mjs:262-263`), but no template has a history input (`engine/prompts/ask.v1.json` takes question, evidence, project_metadata, check_results). `callModel` sends `messages: [{ role: 'user', content: prompt }]` (`:199`).
- Impact: follow-ups like "and how do I fix that?" fail. The interface looks like a chat, so users expect memory.
- Fix:
  - Add an optional `conversation` input to `ask.v2` and `diagnose_issue.v2`.
  - Fill it with the last 6 turns from `chats/<key>.jsonl` (message + summary, redacted and capped at about 4,000 characters) in the engine.
  - For own-key providers, pass them as prior `messages` with alternating roles.
  - Wire up `--new` (`bid.mjs:332`) to a "New conversation" button.

**AI-31 · High · The repair round reuses the same stream and uses the wrong stage id**
- Evidence:
  - `structured()` calls `callModel` a second time (`assistant.mjs:243`); its deltas are appended to the same `live.text` (`AssistantStore.swift:106`), so the bubble shows two concatenated JSON documents.
  - The repair step is emitted as `ev.step(`assistant-${ctx.action}`, { label: t('assistant.stage.analyze') … })` (`assistant.mjs:241`), which gives `assistant-ask`, `assistant-propose`, `assistant-triage` and so on. For ask, diagnose, explain, readiness and triage this creates a stray extra stage. For propose and fix it overwrites the "Предложение" stage label with "Анализ".
- Fix:
  - Emit `{type:'ai', reset:true}` before the repair call and clear `live.text` in the store when it arrives.
  - Emit the repair step under the stage that is actually running: pass `stageId` in `ctx` (`'analyze'` or `'propose'`) and use `assistant-${ctx.stageId}` with that stage's label.

**AI-32 · High · Stages stay "running" forever after cancel, timeout or error**
- Evidence:
  - `cancel()` (`AssistantStore.swift:139-144`) does not touch `stages`.
  - On engine exceptions (`ai_timeout`, `network`, `budget_exceeded` in ask) no final `stage(..., {status:'fail'})` is emitted. Only the propose path handles `budget_exceeded` (`assistant.mjs:370`).
- Impact: the side panel spinner keeps spinning next to an error.
- Fix:
  - App: on cancel or error, map every `running` stage to `fail` (cancel → `skipped`).
  - Engine: wrap each action body in `try/catch` that emits `stage(currentStage, {status:'fail', summary: e.message})` before rethrowing.

**AI-33 · High · The timeout does not stop the request, and spent tokens go unrecorded**
- Evidence:
  - `callModel` races `run` against a `setTimeout` (`assistant.mjs:216-224`) but never aborts the stream; `res.abortController` is only used by the idle timer (`providers.mjs:26`).
  - `callTimeoutMs` is 120 s of wall-clock time for the whole generation (`assistant.mjs:54`), while propose asks for full file contents with `maxTokens: 6000`.
  - On throw, `finish()` never runs, so there is no `recordCost` and no history entry (`:277-285`). Only a cancel (exit 130) is saved (`:270-272`).
- Impact:
  - Long but healthy answers time out, especially full-file rewrites in Bulgarian.
  - Credits are spent but invisible in Costs.
  - The user's question disappears from history after reload (failed turns are not saved at all).
- Fix:
  - Pass an `AbortController` into `stream()` and abort it on timeout.
  - Turn the timeout into an idle-based limit (no delta for N seconds) plus a generous hard cap (5 min).
  - In a `catch` around the action, call `appendHistory(project.key, {...entry, error: e.message, code: e.code, usage})` and `recordCost` when any usage was received.
  - Expose `callTimeoutMs` in the settings sheet.

**AI-34 · High · An issue chosen elsewhere is wiped when the assistant opens**
- Evidence: `openAssistant(issue:)` sets `assistantStore.selectedIssue = issue` and then `screen = .assistant` (`AppModel.swift:516-525`). `AssistantView.task` then runs `store.load()`, which resets `selectedIssue = nil` whenever `projectKey != p.key` (`AssistantStore.swift:57-63`). That is always the case on first open (`projectKey` starts nil) and after a project switch.
- Impact: "Ask the assistant" on an issue row (`IssuesView.swift:117`) opens the assistant with no issue selected, so the issue buttons stay disabled.
- Fix: in `load()`, keep a pending issue: `let keep = pendingIssue; …; selectedIssue = keep`. Or have `openAssistant` set `store.projectKey = p.key` before assigning the issue, so the reset branch does not fire.

**AI-35 · Medium · Free-form questions ignore the selected issue**
- Evidence: `AssistantStore.swift:87` passes `--issue` only for `diagnose`, `propose` and `fix`. The engine supports issue evidence for ask (`assistant.mjs:313`).
- Impact: the scope card says what "the next request is about", but a typed question about that issue goes out without its log.
- Fix: also pass `--issue` for `ask` when one is selected, and show it as a chip in the composer.

**AI-36 · Medium · Running work leaks across project switches**
- Evidence: `running`, `stages`, `context` and `handle` are store-global. `load()` clears turns but not `running` or `handle` (`AssistantStore.swift:57-63`). The finishing task calls `replaceLast` by id (a no-op in the new project) and then sets `running = false`.
- Impact: project B shows project A's stage spinner and a Stop button, and project A's answer never appears until its history reloads (summary only, see AI-2).
- Fix: keep `[projectKey: Session]` (turns, stages, context, handle, running) in the store and show the session for the selected key. Mark the sidebar project with a `PulseDot` while it has a run going.

**AI-37 · Medium · Streaming re-renders the whole app on every token**
- Evidence: each delta calls `replaceLast` and mutates `@Published turns` (`AssistantStore.swift:106`). `AppModel` forwards `assistantStore.objectWillChange` to the root (`AppModel.swift:151`), so the sidebar, the `AuroraBackground` TimelineView host and every screen re-evaluate per token.
- Impact: jank during streaming, especially with the 30 fps aurora behind it.
- Fix:
  - Collect deltas and publish at most every 50 ms (`Task.sleep` coalescing).
  - Keep the streaming text in a separate `@Published var streamingText` on a small `StreamBuffer: ObservableObject` that only `TurnView` observes.
  - Stop forwarding `assistantStore` to `AppModel`; `AssistantView` should use `@ObservedObject var store`.

**AI-38 · Medium · Cancel says "nothing was changed" even mid-apply**
- Evidence: `cancel()` always writes `L("assistant.cancelled")` = "Спряно от теб. Нищо не е променено." (`AssistantStore.swift:143`; bg.strings:178). For `fix --yes`, cancelling during the `apply` or `verify` stage (`assistant.mjs:415-420`) can leave files written.
- Fix: if any stage `apply` has status `pass` or `running` at cancel time, show "Спряно. Промяната може да е записана — провери или върни." with an Undo button.

**AI-39 · Medium · Actions are offered that will certainly fail**
- Evidence:
  - `triage` throws `nothing` when there are no incidents (`assistant.mjs:495`).
  - `explain` throws when no check has run (`:464`).
  - `propose` throws `noFiles` when the issue has no file (`:337`).
  - The buttons are always enabled (`AssistantView.swift:96-98`).
  - `review` is implemented in the engine (`:442-458`) but has no UI.
- Fix:
  - Gate triage on the monitoring incident count, explain on `model.status?.check != nil`, and propose on "issue has an evidence file or files are selected".
  - Add a "Прегледай промяната" button on each proposal card, sending `action: "review"` with `--patch-file`.

**AI-40 · Low · The history load races with sending and is called twice**
- Evidence: `load()` is called from the sidebar (`SidebarView.swift:49`) and from `.task(id:)` (`AssistantView.swift:28`). History is applied only `if … turns.isEmpty` after the await (`AssistantStore.swift:64`), so sending before it returns drops the history for good. The limit is 40 entries with no "load earlier".
- Fix: remove the sidebar call. Load history into a `historyLoaded` flag and merge it (prepend) instead of the `isEmpty` check. Add "Покажи по-стари" at the top with `--limit` paging.

**AI-41 · Low · Settings save fails silently, and the budget stepper grid is odd**
- Evidence: `save()` sets `settings = try? …` (`AssistantStore.swift:194`), so a failure sets `settings` to nil without a message. The stepper runs `4000...400000, step: 10000` (`AssistantView.swift:396`), so starting from the minimum the values are 4 000, 14 000, 24 000….
- Fix: surface errors with `feedback?.show(error)` and keep the previous settings. Use a `Picker` with presets (20k / 60k / 120k / 250k). Add the timeout setting.

**AI-42 · Low · `prompts` is fetched but never used**
- Evidence: `AssistantStore.swift:36,74`. There are no other references.
- Fix: delete it, or use the localized prompt titles (`PromptInfo.title`) for the Details popover.

---

## 3. Accessibility

**AI-43 · High · Messages have no roles and new answers are not announced**
- Evidence: `TurnView` (`AssistantView.swift:214-259`) has no `accessibilityElement`, no label such as "Ти:" or "Асистент:", and no announcement when a result arrives. Stage rows read raw status codes (`:188`: `"\(s.label): \(s.status)"` gives "Анализ: running").
- Fix:
  - On the user bubble: `.accessibilityElement(children: .combine)` plus `.accessibilityLabel(L("assistant.ax.you") + ": " + text)`.
  - On the assistant turn: `.accessibilityElement(children: .contain)` plus `.accessibilityLabel(L("assistant.ax.assistant"))`.
  - On completion: `NSAccessibility.post(element: NSApp.mainWindow as Any, notification: .announcementRequested, userInfo: [.announcement: headline, .priority: NSAccessibilityPriorityLevel.high.rawValue])`.
  - Localize stage status with `K.stageStatus`.

**AI-44 · Medium · Icon buttons lack labels, and disabled reasons are tooltip-only**
- Evidence:
  - The settings and trash buttons (`AssistantView.swift:44-45`) have only `.help`.
  - The "pick an issue" reason exists only as `.help` (`:110`).
  - `Spinner` is not `accessibilityHidden` (`Theme.swift:355`).
  - Diff colors carry meaning, mitigated only by the +/− prefix.
- Fix:
  - Add `.accessibilityLabel` to every icon button.
  - Show the reason for a disabled action as visible text (or as an `.accessibilityHint`).
  - Hide decorative spinners and orbits.
  - Add `.accessibilityLabel(L("assistant.ax.diffLine", kind, text))` to diff rows, or one summary label per file ("+12 −3 реда").

**AI-45 · Low · Small text in low-contrast colors**
- Evidence: 10 pt and 10.5 pt captions in `Theme.tertiary` (#8E8E93) on `Theme.bg`, and on `Theme.accent.opacity(0.14)` in the user bubble (`AssistantView.swift:219,229-232,290-293,312`).
- Fix: minimum 11 pt for any visible text, `Theme.secondary` for anything the user must read, and `Theme.tertiary` only for timestamps at 11 pt or larger.

---

## 4. Localization

**AI-46 · Medium · Untranslated and mixed-language content**
- Engine errors include CLI flags:
  - `assistant.issueRequired` = "Първо избери проблем (--issue ID)."
  - `assistant.noFiles` "…(--files)."
  - Both in `engine/i18n/bg.json:528,530`.
- English shown to Bulgarian users:
  - Validation errors are English (`prompts.mjs:103-143`, e.g. "$.answer: expected string", "unknown evidence id E9") and appear in the invalid-output list (`AssistantView.swift:276`) and stage details.
  - `summarize()` produces "N findings" (`assistant.mjs:517`).
  - `assistant.proposed` interpolates the raw risk value ("риск low", `bg.json:534`).
  - `ai.streamIdle` uses Latin "s" (`bg.json:735`).
- Jargon in strings: "engine-а", "patch", "diff" (bg.strings:175, 183, 238, 248).
- Fix:
  - Strip the CLI hints from user-facing messages (put them only in `--help`).
  - Map validation errors to one localized line ("Отговорът не отговаря на очаквания формат (N проблема)") and keep the details in a disclosure.
  - Localize risk in the engine with `t('risk.'+risk)`.
  - Replace "engine-а" with "приложението", "patch" with "промяна", "diff" with "разлики".

**AI-47 · Medium · Counts are not pluralized or grouped**
- Evidence: `L("assistant.chars", e.chars)` (`AssistantView.swift:158`), `repairsLine`, `iterationsLine` (`:292-293`) and "%@ знака / %@ опита / %@ кръг поправка" (bg.strings:179, 212, 227). `L(_:_:)` stringifies an `Int` without grouping (`Localization.swift:126`), which gives "1 знака" and "24000 знака".
- Fix: use `L(key, count:)` (the plural-aware overload at `Localization.swift:132`) with `.one`/`.other` variants, and format sizes with `Fmt.tokens` or `ByteCountFormatter`.

**AI-48 · Low · The model gets a bare language code**
- Evidence: the system prompt says "Answer in {{locale}}" with `currentLang()` → "bg" (`assistant.mjs:264`, `prompts/system.v1.json`).
- Fix: pass "Bulgarian (bg)" from a name map. Also tell the model to keep code identifiers and paths unchanged, and to use Markdown for code inside string fields, which ties in with AI-3.

---

## 5. Target design spec (SwiftUI, macOS 13+, existing Theme)

**General.** Dark only, matching the app. Use `Theme` colors, `Theme.radius` (16) and `Theme.smallRadius` (10), `.card`, `.lift`, `.entrance`, `Motion.*`, `Spinner`, `SweepBar`, `Chip` and `IconButton`. Put new views in `AssistantComponents.swift`.

### 5.1 Layout
```
┌ Header 52pt ─────────────────────────────────────────────────────────────┐
│ [avatar 28] AI асистент · <site>            [UsagePill] [✎][⚙][▤]       │
├──────────────────────────────────────────────────────┬───────────────────┤
│  Conversation (ScrollView)                           │ Inspector 300pt   │
│    reading column maxWidth 760, centered,            │ (collapsible)     │
│    h-padding 24, top 24, bottom 140 (under composer) │                   │
│                                                      │                   │
│  ┌ Composer (floating, overlay bottom) ───────────┐  │                   │
│  │ maxWidth 760, 16pt from bottom                 │  │                   │
│  └────────────────────────────────────────────────┘  │                   │
└──────────────────────────────────────────────────────┴───────────────────┘
```
- **Header:** height 52, horizontal padding 20. Bottom border is a 1 pt `Theme.hairline` that appears only when the content is scrolled (opacity driven by a scroll offset preference).
  - Title: 15 pt semibold `Theme.text`. Plain `Text`, not `GradientText`.
  - Site name: 12 pt `Theme.secondary`, with `ProjectAvatar(size: 18)` before it.
  - Right side: `UsagePill`, then `IconButton`s (30×30) for New conversation (`square.and.pencil`), Settings (`slider.horizontal.3`) and Inspector (`sidebar.right`). Clear conversation goes in a `…` `Menu`.
- **Inspector:**
  - Width 300 and background `Theme.sidebar.opacity(0.6)`, with a 1 pt leading hairline.
  - Auto-hidden when the available width is under 1180 pt. Toggling it animates the width with `Motion.spring`.
  - Sections: "Какво ще бъде изпратено", "Етапи", "Бюджет" and "Детайли" (model, provider, duration). Each section header is a `SectionLabel` with a 12 pt gap; sections are separated by 1 pt hairlines with 16 pt padding. No shadows.
- **Background:** keep `AuroraBackground` from RootView. The conversation itself has no fill.

### 5.2 Messages
- **Vertical rhythm:** 20 pt between turns and 8 pt between a user message and the reply. Build it with `LazyVStack(alignment: .leading, spacing: 20)`.
- **User message:**
  - Trailing `HStack { Spacer(minLength: 120); bubble }`.
  - Bubble padding: 14 horizontal, 10 vertical. Width up to 560.
  - Fill: `Theme.accent.opacity(0.18)` plus a 1 pt `Theme.accent.opacity(0.25)` stroke. Radius 18 (continuous), with the tail corner at 6 via a custom `Shape`.
  - Text: 14 pt `Theme.text`, `.lineSpacing(3)`, `.textSelection(.enabled)`, `.fixedSize(horizontal: false, vertical: true)`.
  - For a quick action, an 11 pt semibold `Chip`-style capsule at the top of the bubble ("✦ Обясни проблема"). For an issue-scoped message, a second chip with a severity dot and the issue title (`lineLimit(1)`).
- **Assistant message:**
  - `HStack(alignment: .top, spacing: 12)`. On the left, a 24 pt circle filled with `Theme.accentGradient` and an 11 pt bold white `sparkles` icon, plus a 1 pt `Color.white.opacity(0.18)` stroke.
  - On the right, a content `VStack(alignment: .leading, spacing: 12)` with no box. Order:
    1. Status banner, only when `stopped` or verified. It is a `.card(padding: 12, tint: color)` row with a 15 pt icon and 13 pt text. Colors: `needs_confirmation` → accent, regression/budget/no_progress → warn, invalid → blocked, verified → ready (plus a one-shot `Celebration` overlay in a 160 pt frame, Reduce-Motion aware).
    2. Answer body: `AssistantMarkdown`, 14 pt, line spacing 3, paragraph spacing 10.
    3. Structured sections, each with a `SectionLabel` header (10.5 pt uppercase, 0.9 tracking) and 6 pt between rows. "Следващи стъпки" is a numbered list (18 pt right-aligned numbers in `Theme.secondary`, 13.5 pt text). Hypotheses use the `HypothesisRow` confidence pill (Chip-style, 10.5 pt bold, tint at 0.14 fill). "Липсващ контекст" is a `.card(padding: 12, tint: Theme.warn)` with `questionmark.bubble`.
    4. Proposal card (5.4).
    5. Sources: a `FlowLayout(spacing: 6)` of `Chip(text: label, icon: kindIcon)`. Kind icons: file `doc.text`, log `text.alignleft`, issue `exclamationmark.triangle`, git `arrow.triangle.branch`, incident `waveform.path.ecg`, diff `plusminus`.
    6. Hover toolbar, shown on the turn's `.onHover`, fading in over 0.12 s. A `HStack(spacing: 2)` of 24×24 ghost icon buttons (copy `doc.on.doc`, retry `arrow.clockwise`, details `info.circle`), then an 11 pt tertiary caption "1 234 кредита · 8 s · 14:02".
- **Streaming:** the answer text (from field deltas, AI-1) renders in the body style with a 2×14 pt accent caret `Rectangle` blinking at 0.5 s and `.opacity` animated (static when Reduce Motion is on).
- **Thinking (before the first delta):** avatar with a `PulseDot`-like ring (`Theme.accent`), then a 13 pt `Theme.secondary` stage summary with `.shimmer()`, then an elapsed-time caption "12 s" at 11 pt tertiary, `monospacedDigit`.
- **Error:** a `.card(padding: 12, tint: Theme.blocked)` containing a 15 pt `exclamationmark.octagon.fill`, a 13 pt `Theme.text` message, and a trailing `.bidButton(.secondary, compact: true)` CTA chosen by error code (AI-19).
- **Entrance:** new turns use `.entrance(0, offset: 8)` (no index stagger for new messages). History load staggers the first 6.

### 5.3 Code and Markdown
- `CodeBlock`: background `Theme.sidebar` (#161618), radius 10, 1 pt hairline.
  - 28 pt header bar: language label (11 pt mono tertiary) on the left; a Copy ghost button on the right that shows `checkmark` for 1.2 s after copying.
  - Body: `ScrollView(.horizontal)` with 12.5 pt monospaced `Theme.text.opacity(0.92)` text, 12 pt padding, `textSelection`.
- Inline code: `AttributedString` runs with `.font(.system(size: 13, design: .monospaced))` and a `Theme.elevated` background color.

### 5.4 Proposal (patch) card
- `.card(padding: 0)` with these rows:
  - **Header** (padding 14): `wand.and.stars` in an accent 24 pt circle; "Предложена промяна" at 13.5 pt semibold; a risk pill (low = ready, medium = warn, high = blocked); trailing "+12 −3" in 11 pt mono.
  - **File rows**, each 36 pt high: checkbox (`Toggle` `.checkbox`), file icon, path in 12 pt mono (`truncationMode(.middle)`), "+a −d" counts (green and red), and a "Нужно одобрение" warn pill for `needsApproval`. Click to expand.
  - **Expanded diff:** `ScrollView([.horizontal, .vertical])` with max height 320, line-number gutters (2 × 32 pt, 11 pt tertiary mono), full-width line backgrounds (`ready`/`blocked` at 0.12), 12 pt mono. The first file is open by default.
  - **Footer** (padding 14, top hairline): "Проверка: …" plan as 12 pt secondary bullets. Buttons: `Приложи и провери` (`.bidButton(.primary)`), `Прегледай` (`.secondary`, runs the review action), `Отхвърли` (`.ghost`).
  - **While applying:** the footer becomes `Spinner(14)`, the stage text and a `SweepBar(fraction:)` driven by stage count, plus a Stop button.
  - **Applied:** a ready-tinted row ("Приложено: 2 файла · Проверено ✓"), `Върни` (secondary, with a confirm dialog) and a list of skipped files with reasons.

### 5.5 Composer
- Floating overlay at the bottom of the conversation: `maxWidth 760`, horizontal padding 24, bottom 16. A gradient fade (`LinearGradient` from clear to `Theme.bg.opacity(0.9)`, 40 pt) sits behind it so messages scroll under cleanly.
- **Surface:** `Theme.elevated` fill, radius 16, 1 pt `Theme.hairline` stroke that becomes `Theme.accent.opacity(0.55)` with a 0 pt / 8 pt accent glow at 0.25 when focused. Shadow `.black.opacity(0.35)`, radius 20, y 8.
- **Layout:** `VStack(spacing: 8)`, padding 12.
  - **Scope chips row**, shown only when non-empty, in a `FlowLayout`: issue chip, file chips (removable), "+ Файл".
  - **Text editor:** `TextEditor`, 14 pt, min 22 / max 132 pt height (grows with content), placeholder "Попитай за този сайт…" in tertiary at 14 pt. Return sends, Shift-Return makes a newline, Cmd-Return also sends.
  - **Toolbar row** (`HStack`, 28 pt):
    - "✦ Действия" menu (ghost, 12 pt), listing the quick actions with icons and one-line descriptions. Unavailable ones are disabled with the reason as subtitle text.
    - Provider/model chip (11.5 pt).
    - `Spacer`.
    - "~1 200 токена" estimate (11 pt tertiary) when context is known.
    - Send button: 30 pt circle, `Theme.accentGradient`, `arrow.up` at 13 pt bold white, 0.35 accent shadow. Disabled when the trimmed draft is empty, at 0.35 opacity. While running it becomes a `Theme.blocked.opacity(0.15)` circle with a `stop.fill` 11 pt `Theme.blocked` icon (Esc). The swap animates with `.transition(.scale.combined(with: .opacity))` using `Motion.quick`.
- **Contextual suggestion chips** above the composer (8 pt gap): at most three, e.g. "Обясни проблема", "Предложи поправка", "Готовност за пускане", using `Chip` with `.lift(radius: 999)` and a 12 pt label.
- **No AI access** (`!model.aiReady`): the composer is replaced by a `.card(tint: Theme.accent)` with "Свържи AI, за да говориш с асистента" and two buttons, `Добави API ключ` (primary) and `Планове` (secondary).

### 5.6 Empty state
- Centered `VStack(spacing: 14)`, `maxWidth 560`, sitting at about 40% of the height.
  - 44 pt orb (`Theme.accentGradient` circle, `sparkles` at 20 pt white, `.floating(amplitude: 3)`, soft `.breath(Theme.accent)`).
  - Title "С какво да помогна за <site>?" at 22 pt semibold `Theme.text`.
  - Subtitle at 13 pt `Theme.secondary`, centered, two lines maximum.
  - Then a `LazyVGrid(columns: [.flexible(), .flexible()], spacing: 10)` of four suggestion cards. Each card: `.card(padding: 14)`, `.lift()`, `.entrance(i)`, icon in a 28 pt `tint.opacity(0.16)` circle, 13 pt semibold title, 11.5 pt secondary subtitle (`lineLimit(2)`).
  - Then a privacy line: `lock.shield` plus 11 pt tertiary text, "Преди всяка заявка виждаш точно какво се изпраща."

### 5.7 Scroll behavior
- Bottom anchor id `"bottom"`. A `StickToBottom` preference tracks whether the anchor's `maxY` is within 40 pt of the viewport.
- When pinned, scroll on every throttled delta (50 ms), with no animation during streaming and `Motion.quick` on completion.
- When not pinned and new content arrives, show a "↓ Нов отговор" capsule centered 12 pt above the composer (`Theme.elevated`, hairline, 12 pt semibold, `.transition(.move(edge: .bottom).combined(with: .opacity))`). Clicking it scrolls with `Motion.spring`.

### 5.8 Motion summary
| Moment | Animation |
|---|---|
| New message appears | `entrance` with 8 pt offset |
| Send/stop swap | `Motion.quick` |
| Inspector toggle | `Motion.spring` |
| Stage row status change | crossfade, 0.2 s |
| Verified fix | one-shot `Celebration` (160 pt) plus a ready-tinted banner |
| Thinking | avatar pulse plus a shimmer on the stage text |

Every animation must be gated by `Motion.reduced` (including `Spinner`, see AI-28).

### 5.9 States checklist (each needs a design)
1. No project
2. No AI access
3. Empty conversation
4. History loading (skeleton: 3 shimmering rounded rectangles of 60%, 80% and 40% width, 12 pt high)
5. Preparing context
6. Thinking
7. Streaming
8. Structured result
9. Needs confirmation
10. Applying (with Stop)
11. Applied and verified
12. Applied but not verified
13. Undone
14. Regression auto-undone
15. Invalid output (with raw disclosure)
16. Each error code with its CTA
17. Cancelled (with "may have written" variant)
18. Budget exhausted
19. Project switched while another project's run continues (sidebar pulse)

### 5.10 Engine changes the design depends on
- AI-1: emit field deltas plus a `reset` event.
- AI-2: persist full output, files, usage, errors and evidence in `chats/*.jsonl`.
- AI-30: send conversation history to the model.
- AI-31: repair round on the correct stage, with a reset event.
- AI-32 and AI-33: final fail stages, abortable timeout, errors persisted and costs recorded.
- AI-46: localized, flag-free messages.
