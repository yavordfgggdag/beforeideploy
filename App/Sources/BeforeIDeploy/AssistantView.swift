import AppKit
import SwiftUI

struct AssistantView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        Group {
            if model.status == nil { EmptyLine(icon: "folder", text: L("assistant.noProject")) }
            else { AssistantWorkspace(store: model.assistantStore) }
        }
        .task(id: model.status?.project.key) { await model.assistantStore.load() }
    }
}

private struct ChatBottomKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct AssistantWorkspace: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var store: AssistantStore
    @Local private var showSettings = false
    @Local private var showInspector = false
    @Local private var confirmClear = false
    @Local private var pinned = true
    @Local private var composerWidth: CGFloat = 600
    @FocusState private var composerFocused: Bool
    private var busy: Bool { store.running || store.applying }
    private var editorHeight: CGFloat {
        let text = (store.draft.isEmpty ? " " : store.draft + " ") as NSString
        let bounds = text.boundingRect(with: NSSize(width: max(180, composerWidth - 16), height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: NSFont.preferredFont(forTextStyle: .body)])
        return min(132, max(34, ceil(bounds.height) + 14))
    }
    private var draftBinding: Binding<String> { Binding(get: { store.draft }, set: { store.draft = $0 }) }

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                header
                Divider()
                HStack(spacing: 0) {
                    conversation.frame(maxWidth: .infinity)
                    if showInspector && geometry.size.width >= 760 {
                        Divider()
                        sidePanel.frame(width: 300)
                    }
                }
            }
            .sheet(isPresented: Binding(get: { showInspector && geometry.size.width < 760 }, set: { if !$0 { showInspector = false } })) {
                SheetScaffold(icon: "sidebar.right", title: L("assistant.scope"), width: 460) { sidePanel } actions: {
                    Button(L("common.close")) { showInspector = false }.bidButton(.secondary)
                }
            }
        }
        .sheet(isPresented: $showSettings) { AssistantSettingsSheet() }
        .confirmationDialog(L("assistant.clearConfirm"), isPresented: $confirmClear) {
            Button(L("assistant.reset"), role: .destructive) { store.reset() }
        }
        .onChange(of: store.projectKey) { _ in pinned = true }
    }

    private var header: some View {
        HStack(spacing: Space.m) {
            Image(systemName: "sparkles").foregroundColor(Theme.accent).frame(width: 24)
            VStack(alignment: .leading, spacing: Space.xxs) {
                Text(L("assistant.title")).font(Typo.font(.subhead))
                Text(model.status?.project.name ?? "").font(Typo.font(.caption)).foregroundColor(Theme.secondary).lineLimit(1)
            }
            Spacer(minLength: Space.s)
            UsagePill()
            IconButton(symbol: "square.and.pencil", help: L("assistant.newConversation")) { store.newConversation(); composerFocused = true }.disabled(!store.canRun)
            IconButton(symbol: "sidebar.right", help: L("assistant.scope")) { showInspector.toggle() }
                .keyboardShortcut("i", modifiers: [.command, .option])
            Menu {
                Button(L("assistant.settings")) { showSettings = true }
                Button(L("assistant.reset"), role: .destructive) { confirmClear = true }.disabled(busy || store.turns.isEmpty)
            } label: { Image(systemName: "ellipsis.circle") }.menuStyle(.borderlessButton).fixedSize()
                .accessibilityLabel(L("assistant.settings"))
        }
        .buttonStyle(.plain).foregroundColor(Theme.text)
        .padding(.horizontal, Space.xl).frame(height: 56)
    }

    private var conversation: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: Space.xxl) {
                            if store.session.loadingHistory { LoadingState(message: L("assistant.loadingHistory")) }
                            if store.canLoadOlder && !store.turns.isEmpty {
                                Button(L("assistant.older")) { store.loadOlder() }.bidButton(.ghost, compact: true)
                            }
                            if store.turns.isEmpty && !store.session.loadingHistory { emptyState }
                            ForEach(store.turns) { turn in TurnView(turn: turn, store: store).id(turn.id) }
                            Color.clear.frame(height: 1).id("chat-bottom")
                                .background(GeometryReader { geo in Color.clear.preference(key: ChatBottomKey.self, value: geo.frame(in: .named("chat-scroll")).maxY) })
                        }
                        .frame(maxWidth: 760, alignment: .leading).padding(Space.xxl).frame(maxWidth: .infinity)
                    }
                    .coordinateSpace(name: "chat-scroll")
                    .onPreferenceChange(ChatBottomKey.self) { bottom in pinned = bottom <= geometry.size.height + 40 }
                    .onChange(of: store.scrollTick) { _ in if pinned { proxy.scrollTo("chat-bottom", anchor: .bottom) } }
                    .onChange(of: store.turns.count) { _ in if pinned { proxy.scrollTo("chat-bottom", anchor: .bottom) } }
                    .overlay(alignment: .bottom) {
                        if !pinned {
                            Button { pinned = true; proxy.scrollTo("chat-bottom", anchor: .bottom) } label: { Label(L("assistant.latest"), systemImage: "arrow.down") }
                                .bidButton(.secondary, compact: true).padding(Space.m)
                        }
                    }
                }
            }
            composer.frame(maxWidth: 800).frame(maxWidth: .infinity)
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: Space.l) {
            Image(systemName: "sparkles").font(Typo.font(.display)).foregroundColor(Theme.accent)
            Text(L("assistant.greeting", model.status?.project.name ?? "")).font(Typo.font(.title))
            Text(L("assistant.emptyBody")).font(Typo.font(.body)).foregroundColor(Theme.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: Space.s)], spacing: Space.s) {
                suggestion("assistant.suggest.explain", action: "ask", icon: "text.magnifyingglass")
                suggestion("assistant.suggest.readiness", action: "readiness", icon: "checkmark.seal")
                suggestion("assistant.suggest.triage", action: "triage", icon: "waveform.path.ecg")
                suggestion("assistant.suggest.issue", action: "scope", icon: "wrench.and.screwdriver")
            }
            Text(L("assistant.dataNote")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
        }.padding(.top, Space.xxl).fixedSize(horizontal: false, vertical: true)
    }
    private func suggestion(_ key: String, action: String, icon: String) -> some View {
        Button {
            if action == "scope" { showInspector = true }
            else if action == "ask" { store.draft = L(key); composerFocused = true }
            else { store.send(action: action) }
        } label: {
            HStack { Image(systemName: icon).foregroundColor(Theme.accent); Text(L(key)).multilineTextAlignment(.leading); Spacer(minLength: 0) }
                .font(Typo.font(.body)).padding(Space.m).frame(maxWidth: .infinity, minHeight: 64)
                .background(RoundedRectangle(cornerRadius: Radius.m).fill(Theme.panel))
                .overlay(RoundedRectangle(cornerRadius: Radius.m).strokeBorder(Theme.hairline))
        }.buttonStyle(.plain).disabled(busy || (!model.aiReady && action != "scope" && action != "ask"))
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            if !model.aiReady {
                HStack(spacing: Space.m) {
                    Text(L("assistant.connectHint")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                    Spacer(minLength: 0)
                    Button(L("assistant.connect")) { model.aiUnavailableAction() }.bidButton(.secondary, compact: true)
                }
            }
            if store.selectedIssue != nil || !store.files.isEmpty {
                FlowLayout(spacing: Space.s, lineSpacing: Space.s) {
                    if let issue = store.selectedIssue {
                        Button { store.selectedIssue = nil } label: { Label(model.status?.issues?.issues.first(where: { $0.id == issue })?.title ?? issue, systemImage: "xmark.circle") }
                            .bidButton(.ghost, compact: true).help(L("assistant.removeScope"))
                    }
                    ForEach(store.files.split(separator: ",").map(String.init), id: \.self) { file in
                        Button { store.files = store.files.split(separator: ",").map(String.init).filter { $0 != file }.joined(separator: ",") } label: { Label(file, systemImage: "xmark.circle") }
                            .bidButton(.ghost, compact: true).help(L("assistant.removeScope"))
                    }
                }
            }
            VStack(alignment: .leading, spacing: Space.s) {
                ZStack(alignment: .topLeading) {
                    if store.draft.isEmpty { Text(L("assistant.placeholder")).font(Typo.font(.body)).foregroundColor(Theme.tertiary).padding(.leading, 5).padding(.top, 6).allowsHitTesting(false) }
                    TextEditor(text: draftBinding).font(Typo.font(.body)).scrollContentBackground(.hidden).focused($composerFocused)
                        .frame(height: editorHeight)
                        .background(GeometryReader { geo in Color.clear.onAppear { composerWidth = geo.size.width }.onChange(of: geo.size.width) { composerWidth = $0 } })
                        .accessibilityLabel(L("assistant.placeholder"))
                }
                HStack(spacing: Space.m) {
                    Menu {
                        ForEach(["diagnose", "propose", "readiness", "triage", "explain"], id: \.self) { action in
                            Button(K.assistantAction(action)) { store.send(action: action) }
                                .disabled(!store.canRun || !model.aiReady || (["diagnose", "propose"].contains(action) && store.selectedIssue == nil))
                        }
                        Divider()
                        Button(L("assistant.scope")) { showInspector = true }
                    } label: { Label(L("assistant.actions"), systemImage: "plus.circle") }.menuStyle(.borderlessButton).fixedSize()
                    Button { chooseFiles() } label: { Image(systemName: "paperclip") }.buttonStyle(.plain).help(L("assistant.attachFiles")).accessibilityLabel(L("assistant.attachFiles"))
                    providerPicker
                    Spacer(minLength: 0)
                    if busy {
                        Button { store.cancel() } label: { Label(L(store.session.cancelling ? "assistant.stopping" : "assistant.stop"), systemImage: "stop.fill") }
                            .bidButton(.danger, compact: true).keyboardShortcut(.cancelAction).disabled(store.session.cancelling)
                    } else {
                        Button { pinned = true; store.send(action: "ask") } label: { Label(L("assistant.send"), systemImage: "arrow.up") }
                            .bidButton(.primary, compact: true).keyboardShortcut(.return, modifiers: .command)
                            .disabled(!store.canRun || !model.aiReady || store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }.font(Typo.font(.callout))
            }
            .padding(Space.m).background(RoundedRectangle(cornerRadius: Radius.l).fill(Theme.panel))
            .overlay(RoundedRectangle(cornerRadius: Radius.l).strokeBorder(composerFocused ? Theme.accent : Theme.hairline))
            Text(L("assistant.composerHint")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).frame(maxWidth: .infinity)
        }.padding(.horizontal, Space.xl).padding(.bottom, Space.m)
    }

    private var providerPicker: some View {
        Menu {
            Button(L("assistant.automatic")) { store.provider = "" }
            if model.account?.features?.aiCloud == true { Button(L("assistant.cloud")) { store.provider = "cloud" } }
            if model.account?.canUseOwnKey == true {
                ForEach(model.aiKeys.filter(\.connected), id: \.provider) { key in
                    Button(key.name) { store.provider = key.provider }
                }
            }
            if !store.provider.isEmpty && store.provider != "cloud", let models = model.account?.settings?["ai.models"]?.object {
                Divider()
                ForEach(models.keys.sorted().filter { store.provider == "openai" ? $0 == "openai" : $0 != "openai" }, id: \.self) { key in
                    if let value = models[key]?.string { Button(value) { store.model = value } }
                }
            }
        } label: {
            Text(store.model.isEmpty ? (store.provider.isEmpty ? L("assistant.automatic") : store.provider == "cloud" ? L("assistant.cloud") : store.provider.capitalized) : store.model).lineLimit(1)
        }.menuStyle(.borderlessButton).fixedSize().disabled(busy).accessibilityLabel(L("assistant.provider"))
    }

    private func chooseFiles() {
        guard let path = model.status?.project.path else { return }
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = true
        panel.directoryURL = URL(fileURLWithPath: path)
        guard panel.runModal() == .OK else { return }
        let root = URL(fileURLWithPath: path).standardizedFileURL.path + "/"
        let files = panel.urls.map(\.standardizedFileURL.path).filter { $0.hasPrefix(root) && !$0.contains(",") }.map { String($0.dropFirst(root.count)) }
        store.files = Array(Set(store.files.split(separator: ",").map(String.init) + files)).sorted().joined(separator: ",")
    }
    private var sidePanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                scopeCard
                if !store.context.isEmpty || store.running { contextCard }
                if !store.stages.isEmpty { stagesCard }
                if let b = store.budget { budgetCard(b) }
            }
            .padding(16)
        }
        .background(Theme.panel.opacity(0.4))
    }

    private var scopeCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: L("assistant.scope"), icon: "scope")
            let issues = model.status?.issues?.issues ?? []
            Picker(L("assistant.issue"), selection: Binding(get: { store.selectedIssue ?? "" }, set: { store.selectedIssue = $0.isEmpty ? nil : $0 })) {
                Text(L("assistant.noIssue")).tag("")
                ForEach(issues) { i in Text("\(K.severity(i.severity)) · \(i.title)").tag(i.id) }
            }
            .pickerStyle(.menu).font(Typo.font(.callout))
            .disabled(issues.isEmpty)
            if issues.isEmpty { Text(L("assistant.noIssues")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
            Button(L("assistant.attachFiles")) { chooseFiles() }.bidButton(.secondary, compact: true)
            Text(L("assistant.filesHint")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, Space.s)
    }

    private var contextCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(text: L("assistant.contextTitle"), icon: "doc.on.doc")
            if store.context.isEmpty {
                HStack(spacing: 8) { Spinner(size: 12); Text(L("assistant.preparing")).font(Typo.font(.callout)).foregroundColor(Theme.secondary) }
            }
            ForEach(store.context) { e in
                HStack(spacing: 6) {
                    Text(e.id).font(Typo.font(.micro, design: .monospaced)).foregroundColor(Theme.tertiary).frame(width: 26, alignment: .leading)
                    Text(K.evidenceKind(e.kind)).font(Typo.font(.caption)).foregroundColor(Theme.secondary)
                    Text(e.label).font(Typo.font(.caption)).foregroundColor(Theme.text).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Text(L("assistant.chars", e.chars)).font(Typo.font(.micro)).foregroundColor(Theme.tertiary)
                    if e.redactions > 0 { Label("\(e.redactions)", systemImage: "eye.slash").font(Typo.font(.micro)).foregroundColor(Theme.warn).help(L("assistant.redactedHelp")) }
                }
                .accessibilityElement(children: .combine)
            }
            if let est = store.estimateTokens {
                Text(L("assistant.estimate", Fmt.tokens(est))).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            }
        }
        .padding(.vertical, Space.s)
    }

    private var stagesCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(text: L("assistant.stages"), icon: "list.number")
            ForEach(store.stages) { s in
                HStack(alignment: .top, spacing: 8) {
                    Group {
                        if s.status == "running" { Spinner(size: 11) } else {
                            Image(systemName: s.status == "pass" ? "checkmark.circle.fill" : s.status == "fail" ? "xmark.circle.fill" : s.status == "skipped" ? "minus.circle" : "exclamationmark.triangle.fill")
                                .foregroundColor(Theme.color(for: s.status == "skipped" ? "info" : s.status))
                        }
                    }.frame(width: 14)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.label).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                        if let sum = s.summary { Text(sum).font(Typo.font(.caption)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true) }
                        ForEach(s.details.prefix(6), id: \.self) { d in Text(d).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary) }
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(s.label): \(s.status)")
            }
        }
        .padding(.vertical, Space.s)
    }

    private func budgetCard(_ b: AssistantBudget) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(text: L("assistant.budget"), icon: "gauge.with.dots.needle.33percent")
            UsageBar(used: b.used, reserved: 0, total: b.limit)
            Text(L("assistant.budgetUsed", Fmt.tokens(b.used), Fmt.tokens(b.limit))).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            if let last = store.turns.last?.result?.usage {
                Text(L("assistant.lastCost", Fmt.tokens((last.charged ?? ((last.input ?? 0) + (last.output ?? 0))))) + (last.balance.map { " · " + L("ai.creditsLeft", Fmt.tokens($0)) } ?? ""))
                    .font(Typo.font(.caption)).foregroundColor(Theme.secondary)
            }
        }
        .padding(.vertical, Space.s)
    }
}

/// Chat settings persist only after the engine validates the requested limits.
struct AssistantSettingsSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var budget = 60000
    @Local private var timeout = 120
    @Local private var saving = false

    var body: some View {
        SheetScaffold(icon: "slider.horizontal.3", title: L("assistant.settings"), width: 460) {
            VStack(alignment: .leading, spacing: Space.l) {
                Picker(L("assistant.operationBudget"), selection: $budget) {
                    ForEach(Array(Set([20000, 60000, 120000, 250000, budget])).sorted(), id: \.self) { value in Text(Fmt.tokens(value)).tag(value) }
                }
                Picker(L("assistant.idleTimeout"), selection: $timeout) {
                    ForEach(Array(Set([60, 120, 180, 300, timeout])).sorted(), id: \.self) { value in Text(L("assistant.seconds", value)).tag(value) }
                }
                Text(L("assistant.settingsHint")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                Text(L("assistant.neverList")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            }
            .onAppear {
                if let settings = model.assistantStore.settings { budget = settings.maxTokensPerOperation; timeout = (settings.callTimeoutMs ?? 120000) / 1000 }
            }
        } actions: {
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction).disabled(saving)
            Button(L("common.save")) {
                var settings = model.assistantStore.settings ?? AssistantSettings(autoApplyLowRisk: false, maxIterations: 3, maxTokensPerOperation: 60000, maxContextChars: nil, maxFileChars: nil, maxFiles: nil, callTimeoutMs: nil)
                settings.maxTokensPerOperation = budget; settings.callTimeoutMs = timeout * 1000
                saving = true
                Task { if await model.assistantStore.save(settings) { dismiss() }; saving = false }
            }.bidButton(.primary).keyboardShortcut(.defaultAction).disabled(saving)
        }
    }
}
