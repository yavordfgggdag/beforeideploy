import SwiftUI

/// AI assistant workspace (V11 RC): the conversation for the selected site on the left; on the right the
/// active site, the issue and files the next request is about, what will be sent (listed by the engine before
/// the request), the stages, the budget and the real cost afterwards. Proposal, applied change and verified
/// fix are three different things and look different.
struct AssistantView: View {
    @EnvironmentObject var model: AppModel
    private var store: AssistantStore { model.assistantStore }
    @Local private var showSettings = false

    var body: some View {
        Group {
            if model.status == nil {
                VStack(spacing: 12) {
                    Image(systemName: "sparkles").font(Typo.font(.display)).foregroundColor(Theme.tertiary)
                    Text(L("assistant.noProject")).font(Typo.font(.body)).foregroundColor(Theme.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack(spacing: 0) {
                    conversation.frame(maxWidth: .infinity)
                    Rectangle().fill(Theme.hairline).frame(width: 1)
                    sidePanel.frame(width: 340)
                }
            }
        }
        .task(id: model.status?.project.key) { await store.load() }
        .sheet(isPresented: $showSettings) { AssistantSettingsSheet() }
    }

    // MARK: conversation

    private var conversation: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles").foregroundColor(Theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    GradientText(text: L("assistant.title"), font: Typo.font(.subhead, weight: .bold))
                    Text(model.status?.project.name ?? "").font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                }
                Spacer()
                UsagePill()
                Button { showSettings = true } label: { Image(systemName: "slider.horizontal.3") }.buttonStyle(.plain).foregroundColor(Theme.secondary).help(L("assistant.settings"))
                Button { store.reset() } label: { Image(systemName: "trash") }.buttonStyle(.plain).foregroundColor(Theme.secondary).help(L("assistant.reset")).disabled(store.turns.isEmpty || store.running)
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            Rectangle().fill(Theme.hairline).frame(height: 1)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if store.turns.isEmpty { emptyState }
                        ForEach(Array(store.turns.enumerated()), id: \.element.id) { i, turn in
                            TurnView(turn: turn).id(turn.id).entrance(min(i, 6), offset: 10)
                        }
                    }
                    .padding(20)
                }
                .onChange(of: store.turns.count) { _ in if let last = store.turns.last { proxy.scrollTo(last.id, anchor: .bottom) } }
            }

            Rectangle().fill(Theme.hairline).frame(height: 1)
            composer
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L("assistant.emptyTitle")).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(Theme.text)
            Text(L("assistant.emptyBody")).font(Typo.font(.body)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
            Text(L("assistant.dataNote")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.bg))
    }

    private var composer: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                TextField(L("assistant.placeholder"), text: Binding(get: { store.draft }, set: { store.draft = $0 }))
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { store.send(action: "ask") }
                    .disabled(store.running)
                    .accessibilityLabel(L("assistant.placeholder"))
                if store.running {
                    Button(L("assistant.stop")) { store.cancel() }.bidButton(.danger, compact: true).keyboardShortcut(.cancelAction)
                } else {
                    Button(L("assistant.send")) { store.send(action: "ask") }.bidButton(.primary, compact: true).disabled(!store.canRun)
                }
            }
            FlowLayout(spacing: 6, lineSpacing: 6) {
                actionButton("diagnose", "questionmark.circle", needsIssue: true)
                actionButton("propose", "wand.and.stars", needsIssue: true)
                actionButton("fix", "checkmark.seal", needsIssue: true)
                actionButton("readiness", "paperplane", needsIssue: false)
                actionButton("triage", "waveform.path.ecg", needsIssue: false)
                actionButton("explain", "text.magnifyingglass", needsIssue: false)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
    }

    private func actionButton(_ action: String, _ icon: String, needsIssue: Bool) -> some View {
        Button {
            store.send(action: action, yes: false)
        } label: { Label(K.assistantAction(action), systemImage: icon).lineLimit(1).fixedSize() }
            .bidButton(.secondary, compact: true)
            .disabled(!store.canRun || (needsIssue && store.selectedIssue == nil))
            .help(needsIssue && store.selectedIssue == nil ? L("assistant.pickIssue") : K.assistantAction(action))
    }

    // MARK: side panel

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
            Text(L("assistant.activeSite", model.status?.project.name ?? "")).font(Typo.font(.callout)).foregroundColor(Theme.text)
            let issues = model.status?.issues?.issues ?? []
            Picker(L("assistant.issue"), selection: Binding(get: { store.selectedIssue ?? "" }, set: { store.selectedIssue = $0.isEmpty ? nil : $0 })) {
                Text(L("assistant.noIssue")).tag("")
                ForEach(issues) { i in Text("\(K.severity(i.severity)) · \(i.title)").tag(i.id) }
            }
            .pickerStyle(.menu).font(Typo.font(.callout))
            .disabled(issues.isEmpty)
            if issues.isEmpty { Text(L("assistant.noIssues")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
            TextField(L("assistant.files"), text: Binding(get: { store.files }, set: { store.files = $0 })).textFieldStyle(.roundedBorder).font(Typo.font(.callout, design: .monospaced))
            Text(L("assistant.filesHint")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
        }
        .card(padding: 14)
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
        .card(padding: 14)
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
        .card(padding: 14)
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
        .card(padding: 14)
    }
}

/// One turn: the user's message, or the assistant's streamed text + validated result.
struct TurnView: View {
    @EnvironmentObject var model: AppModel
    let turn: AssistantStore.Turn
    @Local private var showRaw = false

    var body: some View {
        if turn.role == "user" {
            HStack {
                Spacer(minLength: 80)
                VStack(alignment: .trailing, spacing: 3) {
                    Text(K.assistantAction(turn.action)).font(Typo.font(.micro, weight: .semibold)).foregroundColor(Theme.tertiary)
                    Text(turn.text).font(Typo.font(.body)).foregroundColor(Theme.text).textSelection(.enabled)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.accent.opacity(0.14)))
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles").font(Typo.font(.caption)).foregroundColor(Theme.accent)
                    Text(K.assistantAction(turn.action)).font(Typo.font(.micro, weight: .semibold)).foregroundColor(Theme.tertiary)
                    if let t = turn.result?.template { Text(t).font(Typo.font(.micro, design: .monospaced)).foregroundColor(Theme.tertiary) }
                    Spacer()
                    Text(Fmt.time(ISO8601DateFormatter().string(from: turn.at))).font(Typo.font(.micro)).foregroundColor(Theme.tertiary)
                }
                if let e = turn.error {
                    EmptyLine(icon: "xmark.octagon.fill", text: e, tint: Theme.blocked)
                } else if let r = turn.result {
                    ResultView(result: r)
                    if !turn.text.isEmpty && r.output == nil && r.valid == false {
                        DisclosureGroup(L("assistant.rawAnswer"), isExpanded: $showRaw) {
                            Text(turn.text).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary).textSelection(.enabled)
                        }.font(Typo.font(.caption)).foregroundColor(Theme.secondary)
                    }
                } else if turn.text.isEmpty {
                    HStack(spacing: 8) {
                        Orbit(size: 14)
                        Text(L("assistant.thinking")).font(Typo.font(.body)).foregroundColor(Theme.secondary)
                        TypingDots()
                    }
                } else {
                    Text(turn.text).font(Typo.font(.body, design: .monospaced)).foregroundColor(Theme.secondary).textSelection(.enabled)
                    TypingDots().padding(.top, 2)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.bg))
            .overlay(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        }
    }
}

/// The validated output, rendered by field. Proposal (patch file) ≠ applied ≠ verified.
struct ResultView: View {
    @EnvironmentObject var model: AppModel
    let result: AssistantResult
    private var store: AssistantStore { model.assistantStore }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let stopped = K.assistantStopped(result.stopped) {
                EmptyLine(icon: result.stopped == "needs_confirmation" ? "hand.raised.fill" : "exclamationmark.triangle.fill", text: stopped, tint: result.stopped == "needs_confirmation" ? Theme.accent : Theme.warn)
            }
            if !result.valid, let errs = result.errors, !errs.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("assistant.invalidTitle")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.blocked)
                    ForEach(errs.prefix(6), id: \.self) { e in Text("• \(e)").font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary) }
                }
            }
            if let o = result.output { OutputFields(output: o) }
            if let files = result.files, !files.isEmpty { patchSection(files) }
            if let a = result.applied {
                EmptyLine(icon: "doc.badge.gearshape", text: L("assistant.appliedFiles", a.applied.joined(separator: ", ")), tint: Theme.accent)
            }
            if let rc = result.recheck {
                EmptyLine(icon: rc.verified ? "checkmark.seal.fill" : "xmark.seal.fill", text: rc.verified ? L("assistant.verifiedLine", rc.step ?? "") : L("assistant.unverifiedLine", rc.step ?? "", rc.stepStatus ?? "—"), tint: rc.verified ? Theme.ready : Theme.blocked)
            }
            if result.undone == true { EmptyLine(icon: "arrow.uturn.backward.circle.fill", text: L("assistant.undoneLine"), tint: Theme.warn) }
            HStack(spacing: 10) {
                if let u = result.usage {
                    Text(L("assistant.costLine", Fmt.tokens(u.charged ?? ((u.input ?? 0) + (u.output ?? 0))), u.model ?? result.model ?? "")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                }
                if let r = result.repairs, r > 0 { Text(L("assistant.repairsLine", r)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
                if let i = result.iterations, i > 1 { Text(L("assistant.iterationsLine", i)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
            }
        }
    }

    private func patchSection(_ files: [AIPatchFile]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(L("assistant.proposalTitle")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                if let risk = result.risk { Text(L("issue.fixRisk", K.risk(risk))).font(Typo.font(.caption)).foregroundColor(risk == "high" ? Theme.blocked : Theme.secondary) }
                Spacer()
            }
            ForEach(files) { f in
                DisclosureGroup {
                    ScrollView(.horizontal) { DiffText(diff: f.diff).font(Typo.font(.caption, design: .monospaced)) }.frame(maxHeight: 220)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: f.applicable ? "doc.text" : "doc.text.fill").foregroundColor(f.applicable ? Theme.accent : Theme.blocked)
                        Text(f.path).font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.text)
                        Text("+\(f.additions) −\(f.deletions)").font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                        if let e = f.error { Text(e).font(Typo.font(.caption)).foregroundColor(Theme.blocked) }
                    }
                }
                .font(Typo.font(.caption))
            }
            if let plan = result.verificationPlan, !plan.isEmpty {
                Text(L("assistant.verificationPlan", plan.joined(separator: " · "))).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            }
            if let notes = result.rollbackNotes, !notes.isEmpty { Text(L("assistant.rollbackNotes", notes)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
            if result.applied == nil, result.patchFile != nil {
                HStack(spacing: 8) {
                    Button(L("assistant.applyVerify")) { store.apply(result) }.bidButton(.primary, compact: true).disabled(store.applying || store.running)
                    Text(L("assistant.applyHint")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                }
            } else if result.applied != nil {
                Button(L("ai.undo")) { store.undo() }.bidButton(.secondary, compact: true).disabled(store.applying)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.panel))
    }
}

/// Generic rendering of the validated JSON: strings as paragraphs, arrays as bullet lists, objects as key: value.
struct OutputFields: View {
    let output: JSONValue
    private static let order = ["summary", "answer", "status", "engine_status", "engine_gate_status", "observed_impact", "timeline_summary", "impact", "observations", "hypotheses", "findings", "blockers", "warnings", "unresolved", "completed_checks", "required_checks", "recommended_checks", "recovery_options", "next_steps", "next_action", "proposed_next_action", "missing_context", "missing_evidence", "remaining_uncertainties", "uncertainties", "evidence_ids"]
    private static let hidden: Set<String> = ["changes", "base_hashes", "rationale_evidence_ids", "verification_plan", "rollback_notes", "risk"]

    var body: some View {
        if let o = output.object {
            let keys = Self.order.filter { o[$0] != nil } + o.keys.filter { !Self.order.contains($0) && !Self.hidden.contains($0) }.sorted()
            VStack(alignment: .leading, spacing: 6) {
                ForEach(keys, id: \.self) { k in
                    if let v = o[k], !Self.hidden.contains(k) { field(k, v) }
                }
            }
        }
    }

    @ViewBuilder private func field(_ key: String, _ v: JSONValue) -> some View {
        switch v {
        case .string(let s) where key == "summary" || key == "answer":
            Text(s).font(Typo.font(.body)).foregroundColor(Theme.text).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        case .string(let s):
            if !s.isEmpty { labeled(key) { Text(s).font(Typo.font(.callout)).foregroundColor(Theme.text).fixedSize(horizontal: false, vertical: true).textSelection(.enabled) } }
        case .array(let a):
            if !a.isEmpty {
                labeled(key) {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(a.enumerated()), id: \.offset) { _, item in
                            Text("• " + item.text).font(Typo.font(.callout)).foregroundColor(Theme.text).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                        }
                    }
                }
            }
        default:
            labeled(key) { Text(v.text).font(Typo.font(.callout)).foregroundColor(Theme.text) }
        }
    }

    private func labeled<C: View>(_ key: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(K.outputField(key)).font(Typo.font(.caption, weight: .bold)).tracking(0.4).foregroundColor(Theme.tertiary)
            content()
        }
    }
}

/// Automation policy (V11 RC): AI proposes by default; auto-apply is opt-in, low-risk only, bounded.
struct AssistantSettingsSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var auto = false
    @Local private var iterations = 3
    @Local private var budget = 60000

    var body: some View {
        SheetScaffold(icon: "slider.horizontal.3", title: L("assistant.settings"), width: 460) {
            VStack(alignment: .leading, spacing: 12) {
                Toggle(L("assistant.autoApply"), isOn: $auto).toggleStyle(.switch)
                Text(L("assistant.autoApplyHint")).font(Typo.font(.callout)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                Stepper(L("assistant.maxIterations", iterations), value: $iterations, in: 1...5)
                Stepper(L("assistant.maxBudget", Fmt.tokens(budget)), value: $budget, in: 4000...400000, step: 10000)
                Text(L("assistant.neverList")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
            }
            .onAppear {
                if let s = model.assistantStore.settings { auto = s.autoApplyLowRisk; iterations = s.maxIterations; budget = s.maxTokensPerOperation }
            }
        } actions: {
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button(L("common.save")) {
                var s = model.assistantStore.settings ?? AssistantSettings(autoApplyLowRisk: false, maxIterations: 3, maxTokensPerOperation: 60000, maxContextChars: nil, maxFileChars: nil, maxFiles: nil, callTimeoutMs: nil)
                s.autoApplyLowRisk = auto
                s.maxIterations = iterations
                s.maxTokensPerOperation = budget
                model.assistantStore.save(s)
                dismiss()
            }.bidButton(.primary).keyboardShortcut(.defaultAction)
        }
    }
}
