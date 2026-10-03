import AppKit
import SwiftUI

// Builder phase 2: the conversation about a site, left of the preview. Three modes on one kept conversation:
// Discuss answers and never changes the site; Plan writes steps the owner can edit; Build changes the real
// files (one Git commit, with Undo). Stop cancels a running turn. Each answer shows what it cost.

struct SiteTalkPane: View {
    @EnvironmentObject var model: AppModel
    let project: Project
    let canUndo: Bool
    let onUndo: () -> Void
    let onChanged: () -> Void

    @State private var mode = "chat"
    @State private var entries: [SiteTalkEntry] = []
    @State private var steps: [String] = []
    @State private var instructions = ""
    @State private var instructionsDraft = ""
    @State private var showInstructions = false
    @State private var loading = true
    @State private var say = ""
    @State private var busy = false
    @State private var stopped = false
    @State private var handle: EngineHandle?
    @State private var error: String?
    @State private var errorCode: String?
    @State private var modelChoice = "auto"

    private var placeholder: String {
        switch mode {
        case "plan": return L("siteedit.placeholder.plan")
        case "build": return L("siteedit.placeholder.build")
        default: return L("siteedit.placeholder.chat")
        }
    }
    private var sendTitle: String {
        switch mode {
        case "plan": return L("siteedit.send.plan")
        case "build": return L("siteedit.send.build")
        default: return L("siteedit.send.chat")
        }
    }
    private var hint: String {
        switch mode {
        case "plan": return L("siteedit.hint.plan")
        case "build": return L("siteedit.hint.build")
        default: return L("siteedit.hint.chat")
        }
    }
    private var modes: [(String, String)] { [(L("siteedit.mode.chat"), "chat"), (L("siteedit.mode.plan"), "plan"), (L("siteedit.mode.build"), "build")] }

    var body: some View {
        VStack(spacing: 0) {
            controls
            Rectangle().fill(Theme.hairline).frame(height: 1)
            transcript
            if !steps.isEmpty { planEditor }
            Rectangle().fill(Theme.hairline).frame(height: 1)
            composer
        }
        .task(id: project.key) { await reload(resetPlan: true) }
    }

    // MARK: - parts

    private var controls: some View {
        VStack(alignment: .leading, spacing: 8) {
            Segmented(options: modes, selection: $mode).disabled(busy)
            HStack(spacing: 10) {
                Menu {
                    ForEach(SiteChatSheet.models, id: \.id) { m in
                        Button(m.id == "auto" ? L("newsite.chat.auto") : m.title) { modelChoice = m.id }
                    }
                } label: {
                    Text("\(L("newsite.chat.model")): \(SiteChatSheet.models.first(where: { $0.id == modelChoice })?.title ?? "Auto")")
                }
                .menuStyle(.borderlessButton).fixedSize().disabled(busy)
                Button(L("siteedit.instructions")) { instructionsDraft = instructions; showInstructions = true }
                    .buttonStyle(.plain).font(Typo.font(.callout)).foregroundColor(instructions.isEmpty ? Theme.secondary : Theme.accent)
                    .popover(isPresented: $showInstructions) { instructionsEditor }
                Spacer()
                if canUndo { Button(L("siteedit.undo")) { onUndo() }.bidButton(.secondary, compact: true).disabled(busy) }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
    }

    private var instructionsEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L("siteedit.instructions")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
            Text(L("siteedit.instructions.hint")).font(Typo.font(.caption)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
            TextEditor(text: $instructionsDraft)
                .font(Typo.font(.body)).scrollContentBackground(.hidden)
                .padding(Space.s).frame(width: 320, height: 120)
                .background(RoundedRectangle(cornerRadius: Radius.m).fill(Theme.inset))
            HStack {
                Spacer()
                Button(L("common.cancel")) { showInstructions = false }.bidButton(.secondary, compact: true)
                Button(L("common.save")) {
                    showInstructions = false
                    Task { instructions = await model.siteInstructions(project, text: instructionsDraft) ?? instructions }
                }.bidButton(.primary, compact: true)
            }
        }
        .padding(16)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if loading {
                        HStack(spacing: 8) { Spinner(size: 12, color: Theme.accent); Text(L("siteedit.loading")).font(Typo.font(.callout)).foregroundColor(Theme.secondary) }
                    } else if entries.isEmpty {
                        Text(L("siteedit.empty")).font(Typo.font(.callout)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(entries) { e in entryView(e, isLast: e.id == entries.last?.id).id(e.id) }
                    if busy {
                        HStack(spacing: 8) { Spinner(size: 12, color: Theme.accent); Text(L("siteedit.working")).font(Typo.font(.callout)).foregroundColor(Theme.secondary) }.id("busy")
                    }
                    if let error {
                        VStack(alignment: .leading, spacing: 8) {
                            Label(error, systemImage: "exclamationmark.circle.fill").font(Typo.font(.callout)).foregroundColor(Theme.blocked).fixedSize(horizontal: false, vertical: true)
                            if errorCode == "site_modified" { Button(L("siteedit.replaceAnyway")) { run(mode: "build", words: "", plan: steps.isEmpty ? nil : steps, force: true) }.bidButton(.danger, compact: true) }
                            if let code = errorCode, ["quota_exhausted", "credits_release", "guard_24h", "guard_7d", "pack_rate", "ai_session_cap", "ai_unavailable"].contains(code) {
                                CreditQuotaActions(store: model.billingStore, code: code)
                            }
                        }
                    }
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: entries.count) { _ in
                if let last = entries.last { withAnimation(Motion.quick) { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
        }
        .frame(maxHeight: .infinity)
    }

    @ViewBuilder private func entryView(_ e: SiteTalkEntry, isLast: Bool) -> some View {
        if e.role == "user" {
            HStack {
                Spacer(minLength: 40)
                Text(e.text).font(Typo.font(.body)).foregroundColor(Theme.text).textSelection(.enabled)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.accent.opacity(0.16)))
            }
        } else if e.kind == "error" {
            Label(e.text, systemImage: "exclamationmark.circle.fill").font(Typo.font(.callout)).foregroundColor(Theme.blocked).fixedSize(horizontal: false, vertical: true)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if e.kind == "plan", let plan = e.plan {
                    Text(plan.summary).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                    ForEach(Array(plan.steps.enumerated()), id: \.offset) { i, step in
                        Text("\(i + 1). \(step)").font(Typo.font(.callout)).foregroundColor(Theme.text).fixedSize(horizontal: false, vertical: true)
                    }
                } else if e.kind == "build" {
                    Label(e.text, systemImage: "checkmark.circle.fill").font(Typo.font(.body)).foregroundColor(Theme.ready).fixedSize(horizontal: false, vertical: true)
                    if let b = e.build {
                        if let refused = b.refused, !refused.isEmpty { Text(L("siteedit.refused", refused.joined(separator: " · "))).font(Typo.font(.caption)).foregroundColor(Theme.warn).fixedSize(horizontal: false, vertical: true) }
                        let files = (b.changed ?? []).joined(separator: ", ")
                        if !files.isEmpty { Text(L("siteedit.changedFiles", files)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true) }
                    }
                } else {
                    Text(e.text).font(Typo.font(.body)).foregroundColor(Theme.text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
                if let c = e.usage?.charged ?? e.build?.usage?.charged { Text(L("siteedit.cost", String(c))).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
                if isLast, let next = e.next, !next.isEmpty {
                    FlowLayout(spacing: 6, lineSpacing: 6) {
                        ForEach(next, id: \.self) { n in
                            Text(n).font(Typo.font(.caption)).foregroundColor(Theme.secondary)
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Capsule().fill(Theme.elevated)).fixedSize().contentShape(Capsule())
                                .tapAction { say = n }
                        }
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.elevated))
        }
    }

    /// The plan the owner can edit before anything is changed.
    private var planEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L("siteedit.plan.title")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
            ForEach(steps.indices, id: \.self) { i in
                HStack(spacing: 6) {
                    Text("\(i + 1).").font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                    TextField("", text: $steps[i]).textFieldStyle(.roundedBorder).font(Typo.font(.callout))
                    Button { steps.remove(at: i) } label: { Image(systemName: "xmark.circle") }.buttonStyle(.plain).foregroundColor(Theme.tertiary).help(L("siteedit.plan.drop")).accessibilityLabel(L("siteedit.plan.drop"))
                }
            }
            HStack {
                Button { run(mode: "build", words: "", plan: steps.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) } label: {
                    HStack { Image(systemName: "hammer"); Text(L("siteedit.plan.build")) }
                }
                .bidButton(.primary, compact: true).disabled(busy || steps.allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty })
                Button(L("siteedit.plan.discard")) { steps = [] }.bidButton(.secondary, compact: true).disabled(busy)
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .background(Theme.accent.opacity(0.06))
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            SayField(text: $say, placeholder: placeholder, onSubmit: send)
            HStack(spacing: 10) {
                if busy {
                    Button { stopped = true; handle?.cancel() } label: { HStack { Image(systemName: "stop.fill"); Text(L("siteedit.stop")) } }.bidButton(.danger)
                } else {
                    Button(action: send) { Text(sendTitle) }
                        .bidButton(.primary).keyboardShortcut(.defaultAction).disabled(say.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                Text(hint).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
    }

    // MARK: - actions

    private func send() {
        let words = say.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, !words.isEmpty else { return }
        if mode != "build", !model.aiReady { model.aiUnavailableAction(); return }
        run(mode: mode, words: words, plan: nil)
    }

    private func run(mode: String, words: String, plan: [String]?, force: Bool = false) {
        guard !busy else { return }
        busy = true
        stopped = false
        error = nil
        errorCode = nil
        let h = EngineHandle()
        handle = h
        Task {
            do {
                let r = try await model.siteTalk(project, mode: mode, say: words, plan: plan, modelChoice: modelChoice, force: force, handle: h)
                say = ""
                if mode == "plan", let p = r.plan { steps = p.steps }
                if mode == "build" {
                    steps = []
                    onChanged()
                    model.flash((r.summary ?? "").isEmpty ? L("siteedit.applied", count: r.applied?.count ?? 0) : (r.summary ?? ""))
                }
            } catch {
                if stopped { self.error = L("siteedit.stopped") } else {
                    self.error = error.localizedDescription
                    errorCode = (error as? EngineError)?.code
                }
            }
            busy = false
            handle = nil
            await reload(resetPlan: false)
        }
    }

    private func reload(resetPlan: Bool) async {
        if let h = await model.siteTalkHistory(project) {
            entries = h.entries
            instructions = h.instructions
            // a plan that was written and not built yet comes back editable after a restart
            if resetPlan, let i = h.entries.lastIndex(where: { $0.kind == "plan" && $0.role == "assistant" }), !h.entries[(i + 1)...].contains(where: { $0.kind == "build" && $0.role == "assistant" }), let p = h.entries[i].plan { steps = p.steps }
        }
        loading = false
    }
}
