import AppKit
import SwiftUI

/// Fenced blocks are parsed locally; remote images and embedded HTML are never loaded.
enum AssistantMarkdownParser {
    struct Block: Identifiable, Equatable {
        let id: Int
        let text: String
        let language: String?
    }
    static func parse(_ source: String) -> [Block] {
        var blocks: [Block] = [], lines: [String] = []
        var language: String?
        func flush() {
            if !lines.isEmpty { blocks.append(Block(id: blocks.count, text: lines.joined(separator: "\n"), language: language)); lines = [] }
        }
        for line in source.components(separatedBy: "\n") {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                flush()
                language = language == nil ? String(line.trimmingCharacters(in: .whitespaces).dropFirst(3)) : nil
            } else { lines.append(line) }
        }
        flush()
        return blocks
    }
}

struct AssistantMarkdown: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            ForEach(AssistantMarkdownParser.parse(text)) { block in
                if let language = block.language { AssistantCodeBlock(code: block.text, language: language) }
                else {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        ForEach(Array(block.text.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                            prose(line)
                        }
                    }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
    }
    @ViewBuilder private func prose(_ line: String) -> some View {
        let heading = line.hasPrefix("#") && line.contains(" ")
        let clean = heading ? String(line.drop(while: { $0 == "#" || $0 == " " })) : line
        let inline = (try? AttributedString(markdown: clean, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(clean)
        if let range = clean.range(of: #"^([-*+]|[0-9]+[.)])\s+"#, options: .regularExpression) {
            let marker = String(clean[range]).trimmingCharacters(in: .whitespaces)
            let body = String(clean[range.upperBound...])
            HStack(alignment: .firstTextBaseline, spacing: Space.s) {
                Text(["-", "*", "+"].contains(marker) ? "•" : marker).frame(minWidth: 12, alignment: .trailing).foregroundColor(Theme.tertiary)
                Text((try? AttributedString(markdown: body, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(body))
                    .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
            }.font(Typo.font(.body)).foregroundColor(Theme.text)
        } else {
            Text(inline).font(Typo.font(heading ? .headline : .body)).foregroundColor(Theme.text)
                .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct AssistantCodeBlock: View {
    let code: String
    let language: String
    @Local private var copied = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? L("assistant.code") : language).font(Typo.font(.caption, design: .monospaced))
                Spacer()
                Button {
                    NSPasteboard.general.clearContents(); NSPasteboard.general.setString(code, forType: .string); copied = true
                    Task { try? await Task.sleep(nanoseconds: 2_000_000_000); copied = false }
                } label: { Label(L(copied ? "common.copied" : "common.copy"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                    .buttonStyle(.plain).font(Typo.font(.caption))
            }.foregroundColor(Theme.secondary).padding(Space.s)
            Divider()
            ScrollView(.horizontal) { Text(code).font(Typo.font(.body, design: .monospaced)).textSelection(.enabled).padding(Space.m) }
        }.background(RoundedRectangle(cornerRadius: Radius.m).fill(Theme.panel))
            .overlay(RoundedRectangle(cornerRadius: Radius.m).strokeBorder(Theme.hairline))
    }
}

struct TurnView: View {
    @EnvironmentObject var model: AppModel
    let turn: AssistantStore.Turn
    @ObservedObject var store: AssistantStore
    @Local private var copied = false
    @Local private var details = false
    var body: some View {
        if turn.role == "user" {
            HStack {
                Spacer(minLength: Space.xxl)
                Text(turn.text).font(Typo.font(.body)).textSelection(.enabled).padding(Space.l)
                    .frame(maxWidth: 560, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: Radius.l).fill(Theme.elevated))
            }
        } else {
            HStack(alignment: .top, spacing: Space.m) {
                Image(systemName: "sparkles").foregroundColor(Theme.accent).frame(width: 24, height: 24).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Space.m) {
                    if let stream = turn.stream { AssistantLiveText(buffer: stream) }
                    else if let result = turn.result {
                        if result.output == nil && !turn.text.isEmpty { AssistantMarkdown(text: turn.text) }
                        ResultView(result: result, store: store, discarded: turn.discarded)
                    }
                    else if !turn.text.isEmpty { AssistantMarkdown(text: turn.text) }
                    if let error = turn.error {
                        VStack(alignment: .leading, spacing: Space.s) {
                            Label(error, systemImage: turn.errorCode == "cancelled" ? "stop.circle" : "exclamationmark.triangle")
                                .font(Typo.font(.body)).foregroundColor(turn.errorCode == "cancelled" ? Theme.secondary : Theme.blocked).textSelection(.enabled)
                            if ["quota_exhausted", "ai_session_cap", "window_week", "window_5h", "plan_required"].contains(turn.errorCode ?? "") {
                                CreditQuotaActions(store: model.billingStore, code: turn.errorCode ?? "quota_exhausted")
                            } else if !model.aiReady {
                                Button(L("assistant.connect")) { model.aiUnavailableAction() }.bidButton(.secondary, compact: true)
                            }
                        }
                    }
                    if turn.stream == nil {
                        HStack(spacing: Space.m) {
                            Button {
                                NSPasteboard.general.clearContents(); NSPasteboard.general.setString(turn.result?.output.map(Self.copyText) ?? turn.text, forType: .string); copied = true
                            } label: { Label(L(copied ? "common.copied" : "common.copy"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                            if turn.request != nil { Button { store.retry(turn) } label: { Label(L("assistant.retry"), systemImage: "arrow.clockwise") }.disabled(!store.canRun || !model.aiReady) }
                            Button { details.toggle() } label: { Label(L("assistant.details"), systemImage: "info.circle") }
                        }.buttonStyle(.plain).font(Typo.font(.caption)).foregroundColor(Theme.secondary)
                        if details {
                            VStack(alignment: .leading, spacing: Space.xs) {
                                Text(Fmt.time(ISO8601DateFormatter().string(from: turn.at)))
                                if let r = turn.result {
                                    Text([r.provider, r.model, r.template].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                    if let u = r.usage {
                                        Text(L("assistant.costLine", u.charged.map(Fmt.tokens) ?? "—", u.model ?? r.model ?? ""))
                                    }
                                }
                            }.font(Typo.font(.caption)).foregroundColor(Theme.tertiary).textSelection(.enabled)
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
    private static func copyText(_ value: JSONValue) -> String {
        if let fields = value.object {
            return fields.keys.sorted().filter { !["changes", "base_hashes"].contains($0) }.map { K.outputField($0) + "\n" + copyText(fields[$0]!) }.joined(separator: "\n\n")
        }
        if let items = value.array { return items.map(copyText).joined(separator: "\n") }
        return value.text
    }
}

private struct AssistantLiveText: View {
    @ObservedObject var buffer: AssistantStreamBuffer
    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            if !buffer.text.isEmpty { AssistantMarkdown(text: buffer.text) }
            HStack(spacing: Space.s) { Spinner(size: 12); Text(L("assistant.thinking")).font(Typo.font(.caption)).foregroundColor(Theme.secondary) }
        }
    }
}

struct ResultView: View {
    let result: AssistantResult
    @ObservedObject var store: AssistantStore
    var discarded = false
    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            if let output = result.output { OutputFields(output: output, evidence: result.evidence ?? []) }
            if let stopped = K.assistantStopped(result.stopped) {
                Label(stopped, systemImage: "info.circle").font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            }
            if !result.valid, let errors = result.errors, !errors.isEmpty {
                DisclosureGroup(L("assistant.invalidTitle")) {
                    ForEach(errors, id: \.self) { Text($0).font(Typo.font(.caption, design: .monospaced)).textSelection(.enabled) }
                }.font(Typo.font(.callout)).foregroundColor(Theme.blocked)
            }
            if let files = result.files, !files.isEmpty {
                AssistantProposal(result: result, files: files, store: store, discarded: discarded)
            }
            if let check = result.recheck {
                Label(check.verified ? L("assistant.verifiedLine", check.step ?? "") : L("assistant.unverifiedLine", check.step ?? "", check.stepStatus ?? "—"), systemImage: check.verified ? "checkmark.seal.fill" : "exclamationmark.triangle")
                    .font(Typo.font(.callout)).foregroundColor(check.verified ? Theme.ready : Theme.warn)
            }
            if result.undone == true { Label(L("assistant.undoneLine"), systemImage: "arrow.uturn.backward.circle").font(Typo.font(.callout)).foregroundColor(Theme.secondary) }
        }
    }
}

struct OutputFields: View {
    let output: JSONValue
    var evidence: [AssistantEvidence] = []
    private static let order = ["summary", "answer", "status", "engine_status", "engine_gate_status", "observed_impact", "timeline_summary", "impact", "observations", "hypotheses", "findings", "blockers", "warnings", "unresolved", "completed_checks", "required_checks", "recommended_checks", "recovery_options", "next_steps", "next_action", "proposed_next_action", "missing_context", "missing_evidence", "remaining_uncertainties", "uncertainties", "evidence_ids"]
    var body: some View {
        if let fields = output.object {
            VStack(alignment: .leading, spacing: Space.m) {
                ForEach(Self.order.filter { fields[$0] != nil }, id: \.self) { key in
                    if let value = fields[key] { field(key, value) }
                }
            }
        }
    }
    @ViewBuilder private func field(_ key: String, _ value: JSONValue) -> some View {
        if let text = value.string, !text.isEmpty {
            if ["answer", "summary", "observed_impact"].contains(key) { AssistantMarkdown(text: text) }
            else if key == "status" { Badge(text: K.assistantStatus(text), tone: text == "confirmed" ? .success : .neutral) }
            else { labeled(key) { AssistantMarkdown(text: text) } }
        } else if let items = value.array, !items.isEmpty {
            labeled(key) {
                if key == "evidence_ids" { sources(items.compactMap(\.string)) }
                else {
                    VStack(alignment: .leading, spacing: Space.s) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            if let object = item.object { objectRow(object) }
                            else { HStack(alignment: .top, spacing: Space.s) { Text("•").foregroundColor(Theme.tertiary); AssistantMarkdown(text: item.text) } }
                        }
                    }
                }
            }
        }
    }
    private func objectRow(_ object: [String: JSONValue]) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            if let confidence = object["confidence"]?.string { Badge(text: L("assistant.confidence", K.risk(confidence)), tone: .neutral) }
            if let severity = object["severity"]?.string { Badge(text: K.severity(severity), tone: severity == "blocker" ? .danger : .warning) }
            if let path = object["path"]?.string { Text(path).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.secondary) }
            ForEach(["finding", "claim", "explanation", "suggested_action", "option", "requires", "limits"].filter { object[$0] != nil }, id: \.self) { key in
                if let value = object[key] { AssistantMarkdown(text: value.text) }
            }
            sources((object["evidence_ids"]?.strings ?? []) + (object["evidence_id"]?.string.map { [$0] } ?? []))
        }.padding(.leading, Space.s)
    }
    private func sources(_ ids: [String]) -> some View {
        FlowLayout(spacing: Space.xs, lineSpacing: Space.xs) {
            ForEach(Array(Set(ids)).sorted(), id: \.self) { id in
                let source = evidence.first { $0.id == id }
                Badge(text: source.map { "\(id) · \($0.label)" } ?? id, icon: "doc.text", tone: .info, size: .sm)
                    .help(source.map { "\(K.evidenceKind($0.kind)) · \($0.label)" } ?? id)
            }
        }
    }
    private func labeled<Content: View>(_ key: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Text(K.outputField(key)).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.secondary)
            content()
        }
    }
}

private struct AssistantProposal: View {
    let result: AssistantResult
    let files: [AIPatchFile]
    @ObservedObject var store: AssistantStore
    let discarded: Bool
    @Local private var selected: Set<String> = []
    @Local private var expanded: Set<String> = []
    @Local private var allowConfig = false
    @Local private var confirmUndo = false
    private var editable: Bool { result.applied == nil && result.undone != true && !discarded }
    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            HStack {
                Text(L("assistant.proposalTitle")).font(Typo.font(.subhead))
                Spacer()
                if discarded { Badge(text: L("assistant.discarded")) }
                else if result.undone == true { Badge(text: L("assistant.undoneLine")) }
                else if result.applied != nil { Badge(text: L("assistant.applied"), tone: .info) }
                else if let risk = result.risk { Badge(text: K.risk(risk), tone: risk == "high" ? .warning : .neutral) }
            }
            ForEach(files) { file in
                VStack(alignment: .leading, spacing: Space.s) {
                    HStack(spacing: Space.s) {
                        if editable {
                            Toggle("", isOn: Binding(get: { selected.contains(file.path) }, set: { if $0 { selected.insert(file.path) } else { selected.remove(file.path) } }))
                                .labelsHidden().toggleStyle(.checkbox).disabled(!file.applicable || !store.canRun)
                                .accessibilityLabel(L("assistant.selectFile", file.path))
                        }
                        Button {
                            if expanded.contains(file.path) { expanded.remove(file.path) } else { expanded.insert(file.path) }
                        } label: {
                            HStack {
                                Image(systemName: expanded.contains(file.path) ? "chevron.down" : "chevron.right")
                                Text(file.path).font(Typo.font(.callout, design: .monospaced)).lineLimit(1).truncationMode(.middle)
                                Spacer(minLength: Space.s)
                                Text("+\(file.additions) −\(file.deletions)").font(Typo.font(.caption)).foregroundColor(Theme.secondary)
                            }
                        }.buttonStyle(.plain)
                    }
                    if let error = file.error { Text(error).font(Typo.font(.caption)).foregroundColor(Theme.blocked) }
                    if expanded.contains(file.path) { AssistantDiff(diff: file.diff) }
                }
            }
            if editable && files.contains(where: { $0.needsApproval == true && selected.contains($0.path) }) {
                Toggle(L("assistant.allowConfig"), isOn: $allowConfig).font(Typo.font(.callout)).toggleStyle(.checkbox)
            }
            if let plan = result.verificationPlan, !plan.isEmpty { Text(L("assistant.verificationPlan", plan.joined(separator: " · "))).font(Typo.font(.caption)).foregroundColor(Theme.secondary) }
            if let notes = result.rollbackNotes, !notes.isEmpty { Text(L("assistant.rollbackNotes", notes)).font(Typo.font(.caption)).foregroundColor(Theme.secondary) }
            if let applied = result.applied {
                Text(L("assistant.appliedFiles", applied.applied.joined(separator: ", "))).font(Typo.font(.callout))
                ForEach(Array((applied.skipped ?? []).filter { $0.reason != "not_selected" }.enumerated()), id: \.offset) { _, skip in
                    Text("\(skip.path) · \(K.aiSkipReason(skip.reason))").font(Typo.font(.caption)).foregroundColor(Theme.warn)
                }
            }
            if store.applying { LoadingState(message: L("assistant.applying")) }
            HStack(spacing: Space.s) {
                if editable && result.patchFile != nil {
                    Button(L("assistant.applyVerify")) { store.apply(result, files: selected.sorted(), allowConfig: allowConfig) }
                        .bidButton(.primary, compact: true).disabled(!store.canRun || selected.isEmpty || (!allowConfig && files.contains { selected.contains($0.path) && $0.needsApproval == true }))
                    Button(L("assistant.review")) { store.send(action: "review", patchFile: result.patchFile) }.bidButton(.secondary, compact: true).disabled(!store.canRun)
                    Button(L("assistant.discard")) { store.discard(result) }.bidButton(.ghost, compact: true).disabled(!store.canRun)
                } else if store.canUndo(result) {
                    Button(L("ai.undo")) { confirmUndo = true }.bidButton(.secondary, compact: true).disabled(!store.canRun)
                }
            }
        }
        .padding(Space.l).background(RoundedRectangle(cornerRadius: Radius.m).fill(Theme.panel))
        .overlay(RoundedRectangle(cornerRadius: Radius.m).strokeBorder(Theme.hairline))
        .onAppear { selected = Set(files.filter { $0.applicable && $0.needsApproval != true }.map(\.path)); expanded = Set(files.prefix(1).map(\.path)) }
        .confirmationDialog(L("assistant.undoConfirm"), isPresented: $confirmUndo) {
            Button(L("ai.undo"), role: .destructive) { store.undo(result) }
        }
    }
}

struct AssistantDiff: View {
    let diff: String
    struct Line: Identifiable {
        let id: Int; let text: String; let old: Int?; let new: Int?
        var tone: Color { text.hasPrefix("+") ? Theme.ready : text.hasPrefix("-") ? Theme.blocked : Theme.secondary }
    }
    static func lines(_ diff: String) -> [Line] {
        var old = 0, new = 0
        return diff.components(separatedBy: "\n").enumerated().map { index, text in
            if text.hasPrefix("@@") {
                let parts = text.split(separator: " ")
                if parts.count >= 3 { old = Int(parts[1].dropFirst().split(separator: ",").first ?? "0") ?? 0; new = Int(parts[2].dropFirst().split(separator: ",").first ?? "0") ?? 0 }
                return Line(id: index, text: text, old: nil, new: nil)
            }
            if text.hasPrefix("---") || text.hasPrefix("+++") || text.hasPrefix("\\") { return Line(id: index, text: text, old: nil, new: nil) }
            let left = text.hasPrefix("+") ? nil : old, right = text.hasPrefix("-") ? nil : new
            if left != nil { old += 1 }; if right != nil { new += 1 }
            return Line(id: index, text: text, old: left, new: right)
        }
    }
    var body: some View {
        let lines = Self.lines(diff)
        ScrollView([.horizontal, .vertical]) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(lines) { line in
                    HStack(spacing: Space.s) {
                        Text(line.old.map(String.init) ?? "").frame(width: 32, alignment: .trailing).foregroundColor(Theme.tertiary)
                        Text(line.new.map(String.init) ?? "").frame(width: 32, alignment: .trailing).foregroundColor(Theme.tertiary)
                        Text(line.text).foregroundColor(line.tone).frame(maxWidth: .infinity, alignment: .leading)
                    }.padding(.horizontal, Space.s).padding(.vertical, Space.xxs)
                        .background(line.text.hasPrefix("+") || line.text.hasPrefix("-") ? line.tone.opacity(0.08) : .clear)
                }
            }.fixedSize(horizontal: true, vertical: false).font(Typo.font(.caption, design: .monospaced)).textSelection(.enabled)
        }.frame(height: min(320, CGFloat(lines.count * 18 + 16)))
            .background(Theme.bg).clipShape(RoundedRectangle(cornerRadius: Radius.s))
    }
}
