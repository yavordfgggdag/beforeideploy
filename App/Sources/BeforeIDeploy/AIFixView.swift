import SwiftUI

/// Built-in AI Fix panel (V10 WP3): streamed explanation on the left, proposed file changes with diffs on
/// the right, "Apply selected" at the bottom. Sits above the RunOverlay.
struct AIFixOverlay: View {
    @EnvironmentObject var model: AppModel
    let state: AIStore.FixState

    private var store: AIStore { model.aiStore }
    private var tint: Color { state.error != nil ? Theme.blocked : state.applied != nil ? Theme.ready : Theme.accent }

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
                .onTapGesture { if !state.running && !state.applying { store.dismiss() } }
            VStack(spacing: 0) {
                header
                Rectangle().fill(Theme.hairline).frame(height: 1)
                HStack(spacing: 0) {
                    explanationPane.frame(width: 400)
                    Rectangle().fill(Theme.hairline).frame(width: 1)
                    filesPane
                }
                Rectangle().fill(Theme.hairline).frame(height: 1)
                footer
            }
            .frame(width: 1000, height: 660)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Theme.panel))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .shadow(color: .black.opacity(0.5), radius: 40, y: 16)
        }
        .onExitCommand { if !state.running && !state.applying { store.dismiss() } }
    }

    // MARK: header

    private var header: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(tint.opacity(0.14)).frame(width: 40, height: 40)
                if state.running { Spinner(size: 18) } else { Image(systemName: state.error != nil ? "xmark" : "sparkles").font(.system(size: 16, weight: .bold)).foregroundColor(tint) }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(state.mode == "explain" ? L("ai.explainTitle") : (state.deep ? L("ai.deepTitle") : L("ai.title")))
                    .font(.system(size: 17, weight: .bold)).foregroundColor(Theme.text)
                Text("\(state.projectName) · \(state.outcome?.stepLabel ?? state.step)")
                    .font(.system(size: 12)).foregroundColor(Theme.secondary).lineLimit(1)
            }
            Spacer()
            if let u = state.outcome?.usage {
                VStack(alignment: .trailing, spacing: 2) {
                    if let b = u.balance {
                        Label(L("ai.creditsLeft", Fmt.tokens(b)), systemImage: "bolt.fill").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                    } else {
                        Label(L("ai.tokensUsed", Fmt.tokens((u.input ?? 0) + (u.output ?? 0))), systemImage: "bolt").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                    }
                    Text(L("ai.viaProvider", state.outcome?.provider ?? "", u.model ?? state.outcome?.model ?? ""))
                        .font(.system(size: 10.5, design: .monospaced)).foregroundColor(Theme.tertiary)
                }
            } else if state.running {
                Text(L("ai.thinking")).font(.system(size: 12)).foregroundColor(Theme.secondary)
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
                            Text(err).font(.system(size: 12.5)).foregroundColor(Theme.blocked).textSelection(.enabled)
                                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.blocked.opacity(0.1)))
                        }
                        if explanationText.isEmpty && state.running {
                            HStack(spacing: 8) { Spinner(size: 12); Text(L("ai.thinking")).font(.system(size: 12)).foregroundColor(Theme.secondary) }
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
                        Text(L("ai.explainOnly")).font(.system(size: 12.5)).foregroundColor(Theme.tertiary)
                    } else if state.files.isEmpty {
                        if !state.running { Text(state.error == nil ? L("ai.noChanges") : "").font(.system(size: 12.5)).foregroundColor(Theme.tertiary) }
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
                Label(L("ai.applied", a.applied.count), systemImage: "checkmark.circle.fill").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.ready)
                if let c = a.committed { Text("commit \(c)").font(.system(size: 11.5, design: .monospaced)).foregroundColor(Theme.tertiary) }
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
                Text(file.path).font(.system(size: 12.5, weight: .semibold, design: .monospaced)).foregroundColor(Theme.text).lineLimit(1).truncationMode(.middle)
                Chip(text: file.action, tint: file.action == "delete" ? Theme.blocked : file.action == "create" ? Theme.ready : Theme.accent)
                Text("+\(file.additions)").font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.ready)
                Text("−\(file.deletions)").font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.blocked)
                Spacer()
                if let s = status {
                    Text(s.0).font(.system(size: 11, weight: .semibold)).foregroundColor(s.1)
                } else if let e = file.error {
                    Text(L(Self.reasonKeys[e] ?? "ai.reason.other")).font(.system(size: 11)).foregroundColor(Theme.warn)
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
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bg))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected && file.applicable && applied == nil ? Theme.accent.opacity(0.6) : Theme.hairline, lineWidth: 1))
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
        .font(.system(size: 11.5, design: .monospaced))
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
            Text(attributed).font(.system(size: 13)).foregroundColor(Theme.text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        } else {
            Text(text).font(.system(size: 13)).foregroundColor(Theme.text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
    }
}
