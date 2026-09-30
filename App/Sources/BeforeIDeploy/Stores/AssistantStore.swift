import AppKit
import Foundation

/// Embedded assistant (V11 RC): one conversation per project, a fixed set of actions, structured answers.
/// The engine decides what is sent (listed in `context` before the request), validates what comes back and
/// runs the apply → verify steps; this store only drives `bid ai chat` and shows its stages honestly.
@MainActor
final class AssistantStore: ObservableObject {
    struct Turn: Identifiable, Hashable {
        let id = UUID()
        let at: Date
        let role: String            // user | assistant
        let action: String
        var text: String            // the user's message, or the streamed answer
        var result: AssistantResult?
        var error: String?
        var stopped: String? { result?.stopped }
    }

    struct Stage: Identifiable, Hashable {
        let id: String              // analyze | propose | apply | verify
        var label: String
        var status: String          // running | pass | fail | warn | skipped
        var summary: String?
        var details: [String]
    }

    @Published var turns: [Turn] = []
    @Published var stages: [Stage] = []
    @Published var context: [AssistantEvidence] = []
    @Published var estimateTokens: Int?
    @Published var budget: AssistantBudget?
    @Published var running = false
    @Published var applying = false
    @Published var settings: AssistantSettings?
    @Published var prompts: [PromptInfo] = []
    @Published var projectKey: String?
    @Published var selectedIssue: String?
    @Published var files: String = ""
    @Published var draft: String = ""

    let engine: EngineClient
    let projects: ProjectStore
    weak var feedback: Feedback?
    private var handle: EngineHandle?

    init(engine: EngineClient, projects: ProjectStore) {
        self.engine = engine
        self.projects = projects
    }

    var canRun: Bool { !running && !applying && projects.selected != nil }

    /// Loads the conversation of the selected project (owner-only file on the Mac), the settings and the prompt list.
    func load() async {
        guard let p = projects.selected else { return }
        if projectKey != p.key {
            projectKey = p.key
            turns = []
            stages = []
            context = []
            selectedIssue = nil
        }
        if let h = try? await engine.call(["ai", "history", "--project", p.key, "--limit", "40"], as: AssistantHistory.self), turns.isEmpty {
            turns = h.entries.flatMap { e -> [Turn] in
                let at = Fmt.date(e.at) ?? Date()
                var out: [Turn] = []
                if let m = e.message, !m.isEmpty { out.append(Turn(at: at, role: "user", action: e.action, text: m)) }
                out.append(Turn(at: at, role: "assistant", action: e.action, text: e.summary ?? "", result: AssistantResult(conversation: e.conversation ?? "", action: e.action, provider: "", model: nil, template: e.template, output: nil, valid: e.valid ?? false, errors: nil, repairs: nil, usage: nil, stopped: e.stopped, budget: nil, duration: e.duration, patchFile: e.patchFile, files: nil, risk: nil, verificationPlan: nil, rollbackNotes: nil, iterations: nil, applied: nil, recheck: nil, verified: nil, undone: nil, evidence: nil, engineStatus: nil)))
                return out
            }
        }
        settings = try? await engine.call(["ai", "settings"], as: AssistantSettings.self)
        if prompts.isEmpty { prompts = (try? await engine.call(["ai", "prompts"], as: [PromptInfo].self)) ?? [] }
    }

    /// Runs one action. `yes` lets `fix` apply the patch (the button says so); nothing else executes.
    func send(action: String, message: String? = nil, yes: Bool = false) {
        guard let p = projects.selected, canRun else { return }
        guard AIStore.hasConsent() else { return }
        let text = (message ?? draft).trimmingCharacters(in: .whitespacesAndNewlines)
        if action == "ask", text.isEmpty { feedback?.flash(L("assistant.typeFirst"), error: true); return }
        if ["diagnose", "propose", "fix"].contains(action), selectedIssue == nil { feedback?.flash(L("assistant.pickIssue"), error: true); return }
        draft = ""
        var args = ["ai", "chat", "--project", p.key, "--action", action]
        if !text.isEmpty { args += ["--message", text] }
        if let issue = selectedIssue, ["diagnose", "propose", "fix"].contains(action) { args += ["--issue", issue] }
        let fileList = files.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if !fileList.isEmpty { args += ["--files", fileList.joined(separator: ",")] }
        if yes { args.append("--yes") }
        if !text.isEmpty { turns.append(Turn(at: Date(), role: "user", action: action, text: text)) }
        var live = Turn(at: Date(), role: "assistant", action: action, text: "")
        turns.append(live)
        stages = []
        context = []
        estimateTokens = nil
        running = true
        let h = EngineHandle()
        handle = h
        Task {
            do {
                let outcome = try await engine.run(args, handle: h) { [weak self] ev in
                    guard let self, self.handle === h else { return }
                    switch ev.type {
                    case "ai":
                        if let d = ev.string("delta") { live.text += d; self.replaceLast(live) }
                    case "step":
                        guard let id = ev.string("id"), id.hasPrefix("assistant-") else { return }
                        let stage = Stage(id: String(id.dropFirst("assistant-".count)), label: ev.string("label") ?? id, status: ev.string("status") ?? "running", summary: ev.string("summary"), details: ev.strings("details") ?? [])
                        if let i = self.stages.firstIndex(where: { $0.id == stage.id }) { self.stages[i] = stage } else { self.stages.append(stage) }
                    case "info":
                        if let ctx = ev.raw["context"] as? [String: Any], let d = try? JSONSerialization.data(withJSONObject: ctx),
                           let parsed = try? JSONDecoder().decode(ContextInfo.self, from: d) {
                            self.context = parsed.evidence
                            self.estimateTokens = parsed.estimateTokens
                            self.budget = AssistantBudget(limit: parsed.budget.limit, used: parsed.budget.used, calls: nil)
                        }
                    default: break
                    }
                }
                guard handle === h else { return }
                if outcome.ok {
                    let r = try outcome.decode(AssistantResult.self)
                    live.result = r
                    live.text = Self.headline(r) ?? live.text
                    budget = r.budget
                    if r.applied != nil { await projects.refreshStatus(quiet: true); await projects.loadHistory() }
                } else {
                    live.error = outcome.errorMessage ?? L("common.error")
                    if outcome.exitCode == 130 { live.error = L("assistant.cancelled") }
                }
            } catch {
                if handle === h { live.error = error.localizedDescription }
            }
            if handle === h { replaceLast(live); running = false }
        }
    }

    func cancel() {
        handle?.cancel()
        handle = nil
        running = false
        if var last = turns.last, last.role == "assistant", last.result == nil { last.error = L("assistant.cancelled"); replaceLast(last) }
    }

    /// Applies a proposed patch through the same engine path as AI Fix (undo record, re-check, `verified`).
    func apply(_ result: AssistantResult) {
        guard let p = projects.selected, let patch = result.patchFile, !applying else { return }
        applying = true
        Task {
            defer { applying = false }
            do {
                let res = try await engine.call(["ai", "apply", "--project", p.key, "--patch-file", patch, "--yes", "--recheck"], as: AIApplyResult.self, timeout: nil)
                if let rc = res.recheck { feedback?.flash(rc.verified ? L("ai.verified") : L("ai.unverified", rc.step ?? ""), error: !rc.verified) }
                else { feedback?.flash(L("ai.applied", count: res.applied.count), error: res.applied.isEmpty) }
                if let i = turns.lastIndex(where: { $0.result?.patchFile == patch }) {
                    turns[i].result?.applied = AssistantApplied(applied: res.applied, skipped: res.skipped, undoFile: res.undoFile)
                    turns[i].result?.recheck = res.recheck
                    turns[i].result?.verified = res.recheck?.verified
                    turns[i].result?.stopped = nil
                }
                await projects.refreshStatus(quiet: true)
                await projects.loadHistory()
            } catch { feedback?.show(error) }
        }
    }

    func undo() {
        guard let p = projects.selected, !applying else { return }
        applying = true
        Task {
            defer { applying = false }
            do {
                let r = try await engine.call(["ai", "undo", "--project", p.key, "--yes"], as: AIUndoResult.self)
                feedback?.flash(L("ai.undone", count: r.restored.count), error: r.restored.isEmpty)
                await projects.refreshStatus(quiet: true)
            } catch { feedback?.show(error) }
        }
    }

    func reset() {
        guard let p = projects.selected else { return }
        Task {
            _ = try? await engine.run(["ai", "reset", "--project", p.key])
            turns = []
            stages = []
            context = []
        }
    }

    func save(_ s: AssistantSettings) {
        Task {
            if let d = try? JSONEncoder().encode(s), let json = String(data: d, encoding: .utf8) {
                settings = try? await engine.call(["ai", "settings", "--json", json], as: AssistantSettings.self)
            }
        }
    }

    private func replaceLast(_ t: Turn) {
        if let i = turns.lastIndex(where: { $0.id == t.id }) { turns[i] = t }
    }

    static func headline(_ r: AssistantResult) -> String? {
        guard let o = r.output else { return nil }
        return o["summary"]?.string ?? o["answer"]?.string ?? o["observed_impact"]?.string
    }

    private struct ContextInfo: Decodable {
        struct B: Decodable { var limit: Int; var used: Int }
        var evidence: [AssistantEvidence]
        var estimateTokens: Int
        var budget: B
    }
}
