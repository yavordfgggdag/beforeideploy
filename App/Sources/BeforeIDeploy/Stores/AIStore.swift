import AppKit
import SwiftUI

/// Built-in AI Fix (V10 WP3): streams `bid ai fix|explain`, holds the proposed patch and applies the
/// selected files with `bid ai apply --yes`. The engine decides own-key vs cloud from the feature gates.
@MainActor
final class AIStore: ObservableObject {
    struct FixState {
        let projectKey: String
        let projectName: String
        let step: String
        let mode: String // fix | explain
        let deep: Bool
        let handle = EngineHandle()
        var text = "" // streamed answer
        var outcome: AIFixOutcome?
        var error: String?
        var running = true
        var applying = false
        var applied: AIApplyResult?
        var selected: Set<String> = []

        var files: [AIPatchFile] { outcome?.files ?? [] }
    }

    @Published var current: FixState?
    @Published var commitAfterApply: Bool { didSet { UserDefaults.standard.set(commitAfterApply, forKey: "aiCommitAfterApply") } }
    @Published var recheckAfterApply: Bool { didSet { UserDefaults.standard.set(recheckAfterApply, forKey: "aiRecheckAfterApply") } }

    let engine: EngineClient
    let projects: ProjectStore
    weak var feedback: Feedback?
    /// Called after a successful apply when the user wants a new check (the facade closes overlays and runs it).
    var onApplied: (@MainActor () -> Void)?

    init(engine: EngineClient, projects: ProjectStore) {
        self.engine = engine
        self.projects = projects
        let d = UserDefaults.standard
        commitAfterApply = d.object(forKey: "aiCommitAfterApply") as? Bool ?? true
        recheckAfterApply = d.object(forKey: "aiRecheckAfterApply") as? Bool ?? true
    }

    static let consentKey = "ai.consentGiven"

    /// Once, before the first AI request: what leaves the Mac and where it goes (audit R5).
    static func hasConsent() -> Bool {
        if UserDefaults.standard.bool(forKey: consentKey) { return true }
        let alert = NSAlert()
        alert.messageText = L("ai.consent.title")
        alert.informativeText = L("ai.consent.body")
        alert.addButton(withTitle: L("ai.consent.accept"))
        alert.addButton(withTitle: L("common.cancel"))
        guard alert.runModal() == .alertFirstButtonReturn else { return false }
        UserDefaults.standard.set(true, forKey: consentKey)
        return true
    }

    func start(step: String, mode: String = "fix", deep: Bool = false) {
        guard let p = projects.selected else { return }
        guard Self.hasConsent() else { return }
        current?.handle.cancel()
        let state = FixState(projectKey: p.key, projectName: p.name, step: step, mode: mode, deep: deep)
        current = state
        var args = ["ai", mode, "--project", p.key, "--step", step]
        if deep { args.append("--deep") }
        let handle = state.handle
        Task {
            do {
                let outcome = try await engine.run(args, handle: handle) { [weak self] ev in
                    guard ev.type == "ai", let d = ev.string("delta"), self?.current?.handle === handle else { return }
                    self?.current?.text += d
                }
                guard current?.handle === handle else { return } // a newer request replaced this one
                if outcome.ok {
                    let r = try outcome.decode(AIFixOutcome.self)
                    current?.outcome = r
                    current?.selected = Set((r.files ?? []).filter { $0.applicable }.map(\.path))
                } else {
                    current?.error = outcome.errorMessage ?? L("common.error")
                }
            } catch {
                if current?.handle === handle { current?.error = error.localizedDescription }
            }
            if current?.handle === handle { current?.running = false }
        }
    }

    func toggle(_ path: String) {
        guard var st = current else { return }
        if st.selected.contains(path) { st.selected.remove(path) } else { st.selected.insert(path) }
        current = st
    }

    func selectAll(_ on: Bool) {
        guard var st = current else { return }
        st.selected = on ? Set(st.files.filter { $0.applicable }.map(\.path)) : []
        current = st
    }

    func apply() {
        guard var st = current, let patch = st.outcome?.patchFile, !st.selected.isEmpty, !st.applying else { return }
        st.applying = true
        current = st
        var args = ["ai", "apply", "--project", st.projectKey, "--patch-file", patch, "--files", st.selected.sorted().joined(separator: ","), "--yes"]
        if commitAfterApply { args.append("--commit") }
        Task {
            do {
                let res = try await engine.call(args, as: AIApplyResult.self)
                current?.applied = res
                feedback?.flash(L("ai.applied", count: res.applied.count), error: res.applied.isEmpty)
                await projects.refreshStatus(quiet: true)
                await projects.loadHistory()
                current?.applying = false
                // re-check only the project that was changed — the user may have switched projects meanwhile (audit A15)
                if recheckAfterApply, !res.applied.isEmpty, projects.selected?.key == st.projectKey { onApplied?() }
            } catch {
                feedback?.show(error)
                current?.error = error.localizedDescription
                current?.applying = false
            }
        }
    }

    func cancel() { current?.handle.cancel() }

    func dismiss() {
        current?.handle.cancel()
        current = nil
    }
}
