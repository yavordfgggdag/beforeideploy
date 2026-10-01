import SwiftUI

/// Built-in AI Fix panel (V10 WP3): streamed explanation on the left, proposed file changes with diffs on
/// the right, "Apply selected" at the bottom. Sits above the RunOverlay.
struct AIFixOverlay: View {
    @EnvironmentObject var model: AppModel
    let state: AIStore.FixState

    private var store: AIStore { model.aiStore }
    private var tint: Color { state.error != nil ? Theme.blocked : state.applied != nil ? Theme.ready : Theme.accent }

    var body: some View {
        ModalShell(size: .xl, height: 660, dismiss: { if !state.running && !state.applying { store.dismiss() } }) {
            VStack(spacing: 0) {
                header
                Rectangle().fill(Theme.hairline).frame(height: 1)
                HStack(spacing: 0) {
                    explanationPane.frame(minWidth: 280, idealWidth: 340, maxWidth: 360)
                    Rectangle().fill(Theme.hairline).frame(width: 1)
                    filesPane
                }
                Rectangle().fill(Theme.hairline).frame(height: 1)
                footer
            }
        }
        .onExitCommand { if !state.running && !state.applying { store.dismiss() } }
    }

    // MARK: header

    private var header: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(tint.opacity(0.14)).frame(width: 40, height: 40)
                if state.running { Spinner(size: 18) } else { Image(systemName: state.error != nil ? "xmark" : "sparkles").font(Typo.font(.headline, weight: .bold)).foregroundColor(tint) }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(state.mode == "explain" ? L("ai.explainTitle") : (state.deep ? L("ai.deepTitle") : L("ai.title")))
                    .font(Typo.font(.headline, weight: .bold)).foregroundColor(Theme.text)
                Text("\(state.projectName) · \(state.outcome?.stepLabel ?? state.step)")
                    .font(Typo.font(.callout)).foregroundColor(Theme.secondary).lineLimit(1)
            }
            Spacer()
            if let u = state.outcome?.usage {
                VStack(alignment: .trailing, spacing: 2) {
                    if let b = u.balance {
                        Label(L("ai.creditsLeft", Fmt.tokens(b)), systemImage: "bolt.fill").font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                        if let renews = model.account?.credits?.renewsAt {
                            Text(L("ai.renewsOn", BillingFormat.day(renews))).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                        }
                    } else {
                        Label(L("ai.tokensUsed", "0"), systemImage: "bolt").font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                    }
                    Text(L("ai.viaProvider", K.provider(state.outcome?.provider ?? "local"), u.model ?? state.outcome?.model ?? ""))
                        .font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary)
                }
            } else if state.running {
                Text(L("ai.thinking")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 16)
    }

    // MARK: explanation

    private var explanationText: String {
        if let e = state.outcome?.explanation, !e.isEmpty { return e }
        return state.text
    }

    private var explanationPane: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: L("ai.explanation"), icon: "text.alignleft")
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        if let err = state.error {
                            Text(err).font(Typo.font(.body)).foregroundColor(Theme.blocked).textSelection(.enabled)
                                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.blocked.opacity(0.1)))
                        }
                        if ["quota_exhausted", "ai_session_cap", "window_5h", "window_week", "ai_unavailable"].contains(state.errorCode ?? "") {
                            CreditQuotaActions(store: model.billingStore, code: state.errorCode ?? "quota_exhausted")
                        }
                        if explanationText.isEmpty && state.running {
                            HStack(spacing: 8) { Spinner(size: 12); Text(L("ai.thinking")).font(Typo.font(.callout)).foregroundColor(Theme.secondary) }
                        } else {
                            MarkdownText(explanationText)
                        }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .onChange(of: state.text.count) { _ in proxy.scrollTo("end", anchor: .bottom) }
            }
        }
        .padding(16)
        .background(Theme.bg.opacity(0.4))
    }

    // MARK: files

    private var filesPane: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionLabel(text: L("ai.changes"), icon: "doc.text.magnifyingglass")
                Spacer()
                if state.files.count > 1, state.applied == nil {
                    Button(L("ai.selectAll")) { store.selectAll(true) }.bidButton(.ghost, compact: true)
                    Button(L("ai.deselectAll")) { store.selectAll(false) }.bidButton(.ghost, compact: true)
                }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if state.mode == "explain" {
                        Text(L("ai.explainOnly")).font(Typo.font(.body)).foregroundColor(Theme.tertiary)
                    } else if state.files.isEmpty {
                        if !state.running { Text(state.error == nil ? L("ai.noChanges") : "").font(Typo.font(.body)).foregroundColor(Theme.tertiary) }
                    } else {
                        ForEach(state.files) { f in
                            AIPatchFileCard(file: f, selected: state.selected.contains(f.path), applied: state.applied, locked: state.applied != nil || state.applying) {
                                store.toggle(f.path)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
    }

    // MARK: footer

    private var footer: some View {
        HStack(spacing: 12) {
            if state.mode == "fix", state.applied == nil {
                Toggle(L("ai.commitAfter"), isOn: Binding(get: { store.commitAfterApply }, set: { store.commitAfterApply = $0 })).toggleStyle(.checkbox)
                Toggle(L("ai.recheckAfter"), isOn: Binding(get: { store.recheckAfterApply }, set: { store.recheckAfterApply = $0 })).toggleStyle(.checkbox)
            }
            if let a = state.applied {
                Label(L("ai.applied", count: a.applied.count), systemImage: "checkmark.circle.fill").font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.ready)
                if let c = a.committed { Text(L("git.record", c)).font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.tertiary) }
                if let rc = a.recheck {
                    Label(rc.verified ? L("ai.verified") : L("ai.unverified", rc.step ?? state.step), systemImage: rc.verified ? "checkmark.seal.fill" : "xmark.octagon.fill")
                        .font(Typo.font(.callout, weight: .semibold)).foregroundColor(rc.verified ? Theme.ready : Theme.blocked)
                }
                if a.undoFile != nil, !state.undone {
                    Button(L("ai.undo")) { store.undo() }.bidButton(.ghost, compact: true).disabled(state.applying)
                }
            }
            Spacer()
            if state.running {
                Button(L("overlay.cancel")) { store.cancel() }.bidButton(.danger)
            } else {
                Button(L("common.close")) { store.dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
                if state.mode == "fix", state.applied == nil, state.error == nil {
                    Button {
                        store.apply()
                    } label: {
                        if state.applying { HStack(spacing: 6) { Spinner(size: 12); Text(L("ai.applying")) } } else { Label(L("ai.applySelected", state.selected.count), systemImage: "checkmark.seal.fill") }
                    }
                    .bidButton(.primary)
                    .disabled(state.selected.isEmpty || state.applying)
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
    }
}

/// One proposed file change: checkbox, path, counts, reason when not applicable, and the unified diff.
struct AIPatchFileCard: View {
    let file: AIPatchFile
    let selected: Bool
    let applied: AIApplyResult?
    let locked: Bool
    let toggle: () -> Void
    @Local private var expanded = true

    static let reasonKeys: [String: String] = [
        "outside_project": "ai.reason.outside_project",
        "not_found": "ai.reason.not_found",
        "exists": "ai.reason.exists",
        "ambiguous": "ai.reason.ambiguous",
        "search_not_found": "ai.reason.search_not_found",
        "not_applicable": "ai.reason.not_applicable",
        "blocked": "ai.reason.blocked",
        "secret": "ai.reason.secret",
        "symlink": "ai.reason.symlink",
        "config_needs_approval": "ai.reason.config_needs_approval",
    ]

    private var status: (String, Color)? {
        guard let a = applied else { return nil }
        if a.applied.contains(file.path) { return (L("ai.fileApplied"), Theme.ready) }
        if let s = a.skipped.first(where: { $0.path == file.path }), s.reason != "not_selected" { return (L(Self.reasonKeys[s.reason] ?? "ai.reason.other"), Theme.warn) }
        return (L("ai.fileSkipped"), Theme.tertiary)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                if file.applicable, applied == nil {
                    Toggle("", isOn: Binding(get: { selected }, set: { _ in toggle() })).toggleStyle(.checkbox).labelsHidden().disabled(locked)
                } else {
                    Image(systemName: file.applicable ? "checkmark.circle" : "exclamationmark.triangle.fill")
                        .foregroundColor(file.applicable ? Theme.tertiary : Theme.warn).frame(width: 16)
                }
                Text(file.path).font(Typo.font(.body, weight: .semibold, design: .monospaced)).foregroundColor(Theme.text).lineLimit(1).truncationMode(.middle)
                Chip(text: file.action, tint: file.action == "delete" ? Theme.blocked : file.action == "create" ? Theme.ready : Theme.accent)
                if file.needsApproval == true {
                    Label(L("ai.configChip"), systemImage: "exclamationmark.shield.fill").font(Typo.font(.caption, weight: .semibold)).foregroundColor(Theme.warn)
                        .help(L("ai.configWarning"))
                }
                Text("+\(file.additions)").font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.ready)
                Text("−\(file.deletions)").font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.blocked)
                Spacer()
                if let s = status {
                    Text(s.0).font(Typo.font(.caption, weight: .semibold)).foregroundColor(s.1)
                } else if let e = file.error {
                    Text(L(Self.reasonKeys[e] ?? "ai.reason.other")).font(Typo.font(.caption)).foregroundColor(Theme.warn)
                }
                Button { expanded.toggle() } label: { Image(systemName: expanded ? "chevron.up" : "chevron.down") }.bidButton(.ghost, compact: true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            if expanded && !file.diff.isEmpty {
                Rectangle().fill(Theme.hairline).frame(height: 1)
                DiffText(diff: file.diff).padding(10)
            }
        }
        .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.bg))
        .overlay(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).strokeBorder(selected && file.applicable && applied == nil ? Theme.accent.opacity(0.6) : Theme.hairline, lineWidth: 1))
    }
}

/// Unified diff with the usual coloring (+ green, − red, @@ blue).
struct DiffText: View {
    let diff: String

    private var lines: [String] { diff.components(separatedBy: "\n") }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line.isEmpty ? " " : line)
                    .foregroundColor(color(line))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 6)
                    .background(background(line))
            }
        }
        .font(Typo.font(.callout, design: .monospaced))
        .textSelection(.enabled)
    }

    private func color(_ l: String) -> Color {
        if l.hasPrefix("+++") || l.hasPrefix("---") { return Theme.tertiary }
        if l.hasPrefix("+") { return Theme.ready }
        if l.hasPrefix("-") { return Theme.blocked }
        if l.hasPrefix("@@") { return Theme.accent }
        return Theme.text.opacity(0.85)
    }

    private func background(_ l: String) -> Color {
        if l.hasPrefix("+++") || l.hasPrefix("---") { return .clear }
        if l.hasPrefix("+") { return Theme.ready.opacity(0.10) }
        if l.hasPrefix("-") { return Theme.blocked.opacity(0.10) }
        return .clear
    }
}

/// Inline Markdown (bold, code, links) — enough for the model's explanation.
struct MarkdownText: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        if let attributed = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            Text(attributed).font(Typo.font(.body)).foregroundColor(Theme.text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        } else {
            Text(text).font(Typo.font(.body)).foregroundColor(Theme.text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
    }
}
