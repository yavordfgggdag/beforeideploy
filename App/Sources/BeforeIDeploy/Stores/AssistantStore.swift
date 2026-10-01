import AppKit
import Combine
import Foundation

@MainActor
final class AssistantStreamBuffer: ObservableObject {
    @Published private(set) var text = ""
    private var pending = ""
    private var flushTask: Task<Void, Never>?
    var onFlush: (() -> Void)?
    func append(_ delta: String) {
        pending += delta
        guard flushTask == nil else { return }
        flushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 50_000_000)
            guard !Task.isCancelled else { return }
            self?.flush()
        }
    }
    func flush() {
        flushTask?.cancel(); flushTask = nil
        guard !pending.isEmpty else { return }
        text += pending; pending = ""; onFlush?()
    }
    func reset() { flushTask?.cancel(); flushTask = nil; pending = ""; text = ""; onFlush?() }
}

/// Operations retain their own project session across navigation. Only the selected session redraws the chat.
@MainActor
final class AssistantStore: ObservableObject {
    struct Request: Codable, Hashable {
        var action: String
        var message: String
        var issue: String?
        var files: String?
        var provider: String?
        var model: String?
        var patchFile: String?
    }
    struct Turn: Identifiable {
        var id = UUID().uuidString
        let at: Date
        let role: String
        let action: String
        var text: String
        var result: AssistantResult?
        var error: String?
        var errorCode: String?
        var request: Request?
        var discarded = false
        var stream: AssistantStreamBuffer?
        var historyId: String?
    }
    struct Stage: Identifiable, Hashable {
        let id: String
        var label: String
        var status: String
        var summary: String?
        var details: [String]
    }
    final class Session: ObservableObject {
        let key: String
        @Published var turns: [Turn] = []
        @Published var stages: [Stage] = []
        @Published var context: [AssistantEvidence] = []
        @Published var estimateTokens: Int?
        @Published var budget: AssistantBudget?
        @Published var running = false
        @Published var applying = false
        @Published var cancelling = false
        @Published var selectedIssue: String?
        @Published var files = ""
        @Published var draft = ""
        @Published var provider = ""
        @Published var model = ""
        @Published var scrollTick = 0
        var handle: EngineHandle?
        var historyLoaded = false
        @Published var loadingHistory = false
        var historyLimit = 40
        var hasOlder = false
        var newConversation = false
        init(key: String) { self.key = key }
        var busy: Bool { running || applying }
    }
    @Published private(set) var session = Session(key: "")
    @Published var settings: AssistantSettings?
    var isSnapshotDemo = false
    let engine: EngineClient
    let projects: ProjectStore
    weak var feedback: Feedback?
    var onSpend: (() async -> Void)?
    private var sessions: [String: Session] = [:]
    private var sessionObservation: AnyCancellable?

    init(engine: EngineClient, projects: ProjectStore) { self.engine = engine; self.projects = projects }
    var turns: [Turn] { session.turns }
    var stages: [Stage] { session.stages }
    var context: [AssistantEvidence] { session.context }
    var budget: AssistantBudget? { session.budget }
    var estimateTokens: Int? { session.estimateTokens }
    var running: Bool { session.running }
    var applying: Bool { session.applying }
    var canRun: Bool { !isSnapshotDemo && !session.busy && !session.loadingHistory && projects.selected?.key == session.key }
    var projectKey: String? { session.key.isEmpty ? nil : session.key }
    var selectedIssue: String? { get { session.selectedIssue } set { session.selectedIssue = newValue } }
    var files: String { get { session.files } set { session.files = newValue } }
    var draft: String { get { session.draft } set { session.draft = newValue } }
    var provider: String { get { session.provider } set { session.provider = newValue; session.model = "" } }
    var model: String { get { session.model } set { session.model = newValue } }
    var scrollTick: Int { session.scrollTick }
    var canLoadOlder: Bool { session.historyLoaded && session.hasOlder && session.historyLimit < 200 }

    func activate(_ key: String) {
        guard session.key != key else { return }
        let next = sessions[key] ?? Session(key: key)
        sessions[key] = next; session = next
        sessionObservation = next.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }
    func load() async {
        guard !isSnapshotDemo else { return }
        guard let p = projects.selected else { return }
        activate(p.key)
        let s = session
        guard !s.loadingHistory else { return }
        s.loadingHistory = true
        defer { s.loadingHistory = false }
        if !s.historyLoaded && !s.newConversation {
            do {
                let h = try await engine.call(["ai", "history", "--project", s.key, "--limit", String(s.historyLimit)], as: AssistantHistory.self)
                if !s.newConversation {
                    let loaded = h.entries.filter { $0.conversation == h.conversation }.flatMap { e -> [Turn] in
                        let at = Fmt.date(e.at) ?? Date()
                        var values: [Turn] = []
                        if let m = e.message, !m.isEmpty { values.append(Turn(id: e.id + "-user", at: at, role: "user", action: e.action, text: m, request: e.request)) }
                        let result = e.result ?? AssistantResult(conversation: e.conversation ?? "", action: e.action, provider: e.provider ?? "", template: e.template, valid: e.valid ?? false, usage: e.usage, stopped: e.stopped, duration: e.duration, patchFile: e.patchFile)
                        values.append(Turn(id: e.id + "-assistant", at: at, role: "assistant", action: e.action, text: e.summary ?? "", result: result, error: e.error ?? (e.stopped == "cancelled" ? L("assistant.cancelled") : nil), errorCode: e.code ?? (e.stopped == "cancelled" ? "cancelled" : nil), request: e.request, discarded: result.discarded == true))
                        return values
                    }
                    let ids = Set(s.turns.map(\.id))
                    s.turns = loaded.filter { !ids.contains($0.id) } + s.turns
                    s.historyLoaded = true; s.hasOlder = h.hasMore ?? (h.entries.count >= s.historyLimit)
                }
            } catch { feedback?.show(error) }
        }
        if settings == nil { do { settings = try await engine.call(["ai", "settings"], as: AssistantSettings.self) } catch { feedback?.show(error) } }
    }
    func loadOlder() { session.historyLimit += 40; session.historyLoaded = false; Task { await load() } }

    func send(action: String, message: String? = nil, yes: Bool = false, patchFile: String? = nil) {
        guard let p = projects.selected else { return }
        activate(p.key)
        guard canRun, AIStore.hasConsent() else { return }
        let text = (message ?? draft).trimmingCharacters(in: .whitespacesAndNewlines)
        guard action != "ask" || !text.isEmpty else { return }
        if ["diagnose", "propose", "fix"].contains(action), selectedIssue == nil { feedback?.flash(L("assistant.pickIssue"), error: true); return }
        let request = Request(action: action, message: text, issue: selectedIssue, files: files, provider: provider, model: model, patchFile: patchFile)
        perform(request, yes: yes)
    }
    func retry(_ turn: Turn) {
        guard canRun, let request = turn.request, AIStore.hasConsent() else { return }
        perform(request, yes: false)
    }
    private func perform(_ request: Request, yes: Bool) {
        let s = session
        s.draft = ""
        var args = ["ai", "chat", "--project", s.key, "--action", request.action]
        if !request.message.isEmpty { args += ["--message", request.message] }
        if let issue = request.issue, !issue.isEmpty { args += ["--issue", issue] }
        if let files = request.files, !files.isEmpty { args += ["--files", files] }
        if let provider = request.provider, !provider.isEmpty { args += ["--provider", provider] }
        if let model = request.model, !model.isEmpty { args += ["--model", model] }
        if let patchFile = request.patchFile { args += ["--patch-file", patchFile] }
        if yes { args.append("--yes") }
        if s.newConversation { args.append("--new"); s.newConversation = false }
        s.turns.append(Turn(at: Date(), role: "user", action: request.action, text: request.message.isEmpty ? K.assistantAction(request.action) : request.message, request: request))
        let buffer = AssistantStreamBuffer()
        buffer.onFlush = { [weak s] in s?.scrollTick += 1 }
        var live = Turn(at: Date(), role: "assistant", action: request.action, text: "", request: request, stream: buffer)
        s.turns.append(live); s.stages = []; s.context = []; s.estimateTokens = nil
        s.running = true; s.cancelling = false; s.scrollTick += 1
        let handle = EngineHandle(); s.handle = handle
        Task {
            do {
                let outcome = try await engine.run(args, handle: handle, timeout: 900) { [weak self] event in
                    if let id = event.string("historyId") { live.historyId = id }
                    guard !s.cancelling else { return }
                    if event.type == "ai" {
                        if event.raw["reset"] as? Bool == true { buffer.reset() }
                        if event.string("field") == "answer", let delta = event.string("delta") { buffer.append(delta) }
                    } else { self?.event(event, session: s) }
                }
                buffer.flush()
                if outcome.ok {
                    live.result = try outcome.decode(AssistantResult.self)
                    live.text = live.result.flatMap(Self.headline) ?? buffer.text
                    s.budget = live.result?.budget
                } else { live.error = outcome.errorMessage ?? L("common.error"); live.errorCode = outcome.errorCode }
            } catch { live.error = error.localizedDescription; live.errorCode = (error as? EngineError)?.code }
            buffer.flush(); live.stream = nil
            if live.text.isEmpty { live.text = buffer.text }
            if s.cancelling { live.error = L("assistant.cancelled"); live.errorCode = "cancelled" }
            terminateStages(s, status: s.cancelling ? "skipped" : live.error == nil ? "pass" : "fail")
            replace(live, in: s); s.running = false; s.cancelling = false; s.handle = nil; s.scrollTick += 1
            if let window = NSApp.mainWindow, session === s {
                NSAccessibility.post(element: window, notification: .announcementRequested,
                    userInfo: [.announcement: live.error ?? String(live.text.prefix(180)), .priority: NSAccessibilityPriorityLevel.medium.rawValue])
            }
            await onSpend?()
        }
    }
    private func event(_ event: EngineEvent, session s: Session) {
        if event.type == "step", let id = event.string("id") {
            let stage = Stage(id: id.replacingOccurrences(of: "assistant-", with: ""), label: event.string("label") ?? id,
                status: event.string("status") ?? "running", summary: event.string("summary"), details: event.strings("details") ?? [])
            if let i = s.stages.firstIndex(where: { $0.id == stage.id }) { s.stages[i] = stage } else { s.stages.append(stage) }
        } else if event.type == "info", let context = event.raw["context"], let data = try? JSONSerialization.data(withJSONObject: context),
                  let parsed = try? JSONDecoder().decode(ContextInfo.self, from: data) {
            s.context = parsed.evidence; s.estimateTokens = parsed.estimateTokens
            s.budget = AssistantBudget(limit: parsed.budget.limit, used: parsed.budget.used, calls: nil)
        }
    }
    func cancel() {
        guard session.busy else { return }
        session.cancelling = true; session.handle?.cancel()
        terminateStages(session, status: "skipped")
    }
    func apply(_ result: AssistantResult, files: [String]? = nil, allowConfig: Bool = false) {
        guard canRun, let patch = result.patchFile else { return }
        let s = session
        s.applying = true; s.cancelling = false; s.stages = []
        let handle = EngineHandle(); s.handle = handle
        var args = ["ai", "apply", "--project", s.key, "--patch-file", patch, "--yes", "--recheck"]
        if let files { guard !files.isEmpty else { s.applying = false; return }; args += ["--files", files.joined(separator: ",")] }
        if allowConfig { args.append("--allow-config") }
        Task {
            defer { s.applying = false; s.cancelling = false; s.handle = nil; s.scrollTick += 1 }
            do {
                let outcome = try await engine.run(args, handle: handle, timeout: 1200) { [weak self] in self?.event($0, session: s) }
                let res = try outcome.decode(AIApplyResult.self)
                if let i = s.turns.lastIndex(where: { $0.result?.patchFile == patch }) {
                    s.turns[i].result?.applied = AssistantApplied(applied: res.applied, skipped: res.skipped, undoFile: res.undoFile)
                    s.turns[i].result?.recheck = res.recheck; s.turns[i].result?.verified = res.recheck?.verified; s.turns[i].result?.stopped = nil
                }
                terminateStages(s, status: "pass")
            } catch {
                terminateStages(s, status: s.cancelling ? "skipped" : "fail")
                feedback?.flash(s.cancelling ? L("assistant.cancelledApply") : error.localizedDescription, error: true)
                // Applying is synchronous in the engine; cancellation may interrupt only the subsequent check.
                // Reload its durable result so a landed change retains Undo after a cancelled verification.
                if let history = try? await engine.call(["ai", "history", "--project", s.key, "--limit", "200"], as: AssistantHistory.self),
                   let saved = history.entries.last(where: { $0.patchFile == patch })?.result,
                   let index = s.turns.lastIndex(where: { $0.result?.patchFile == patch }) { s.turns[index].result = saved }
            }
            if projects.selected?.key == s.key { await projects.refreshStatus(quiet: true); await projects.loadHistory() }
            await onSpend?()
        }
    }
    func canUndo(_ result: AssistantResult) -> Bool {
        guard let file = result.applied?.undoFile, result.undone != true else { return false }
        return turns.last(where: { $0.result?.applied?.undoFile != nil && $0.result?.undone != true })?.result?.applied?.undoFile == file
    }
    func undo(_ result: AssistantResult) {
        guard canRun, canUndo(result), let expected = result.applied?.undoFile else { return }
        let s = session; s.applying = true
        Task {
            defer { s.applying = false }
            do {
                let res = try await engine.call(["ai", "undo", "--project", s.key, "--yes", "--expected-undo-file", expected], as: AIUndoResult.self)
                if let i = s.turns.lastIndex(where: { $0.result?.applied?.undoFile == expected }) {
                    s.turns[i].result?.undone = res.skipped.isEmpty
                    s.turns[i].result?.verified = false
                    if res.skipped.isEmpty { s.turns[i].result?.applied = nil }
                }
                feedback?.flash(L("ai.undone", count: res.restored.count), error: res.restored.isEmpty)
                if projects.selected?.key == s.key { await projects.refreshStatus(quiet: true) }
            } catch { feedback?.show(error) }
        }
    }
    func discard(_ result: AssistantResult) {
        guard canRun, let patch = result.patchFile else { return }
        let s = session; s.applying = true
        Task {
            defer { s.applying = false }
            do {
                let response = try await engine.call(["ai", "discard", "--project", s.key, "--patch-file", patch], as: DiscardResult.self)
                guard response.discarded else { feedback?.flash(L("assistant.discardFailed"), error: true); return }
                if let i = s.turns.lastIndex(where: { $0.result?.patchFile == patch }) { s.turns[i].discarded = true; s.turns[i].result?.discarded = true }
            } catch { feedback?.show(error) }
        }
    }
    private struct DiscardResult: Decodable { var discarded: Bool }
    func newConversation() {
        guard canRun else { return }
        session.newConversation = true; session.historyLoaded = true; session.turns = []; session.stages = []; session.context = []; session.budget = nil
    }
    func reset() {
        guard canRun else { return }
        let s = session
        Task {
            do { let outcome = try await engine.run(["ai", "reset", "--project", s.key]); guard outcome.ok else { throw EngineError.failed(outcome.errorMessage ?? L("common.error"), outcome.errorCode) }; s.turns = []; s.stages = []; s.context = []; s.newConversation = true }
            catch { feedback?.show(error) }
        }
    }
    func save(_ settings: AssistantSettings) async -> Bool {
            do {
                let data = try JSONEncoder().encode(settings)
                self.settings = try await engine.call(["ai", "settings", "--json", String(decoding: data, as: UTF8.self)], as: AssistantSettings.self)
                return true
            } catch { feedback?.show(error); return false }
    }
    private func replace(_ turn: Turn, in s: Session) {
        if let i = s.turns.firstIndex(where: { $0.id == turn.id }) {
            var saved = turn
            if let id = turn.result?.historyId ?? turn.historyId {
                saved.id = id + "-assistant"
                if i > 0, s.turns[i - 1].role == "user" { s.turns[i - 1].id = id + "-user" }
            }
            s.turns[i] = saved
        }
    }
    private func terminateStages(_ s: Session, status: String) {
        for i in s.stages.indices where ["running", "pending", "waiting_user"].contains(s.stages[i].status) { s.stages[i].status = status }
    }
    static func headline(_ result: AssistantResult) -> String? {
        result.output?["answer"]?.string ?? result.output?["summary"]?.string ?? result.output?["observed_impact"]?.string
    }
    private struct ContextInfo: Decodable {
        struct Budget: Decodable { var limit: Int; var used: Int }
        var evidence: [AssistantEvidence]; var estimateTokens: Int; var budget: Budget
    }
}
