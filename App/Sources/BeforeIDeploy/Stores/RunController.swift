import AppKit
import SwiftUI

/// Engine operations shown in the RunOverlay (check, deploy, git, Netlify, fixes, domains),
/// Local Preview and AI Fix for the selected project.
@MainActor
final class RunController: ObservableObject {
    @Published var run: RunSession?
    /// Called before a run starts (the facade stops a quiet auto-check here).
    var beforeRun: (@MainActor () -> Void)?
    @Published var busy: Set<String> = []
    @AppStorage("autoOpenPreview") var autoOpenPreview = true

    let engine: EngineClient
    let projects: ProjectStore
    weak var feedback: Feedback?

    init(engine: EngineClient, projects: ProjectStore) {
        self.engine = engine
        self.projects = projects
    }

    private var selected: Project? { projects.selected }

    private func flash(_ text: String, error: Bool = false) {
        feedback?.flash(text, error: error)
    }

    // MARK: - Runs

    /// Release state (V11): the engine's operation records for the selected project.
    @Published var release: ReleaseStatus?
    @Published var loadingRelease = false

    func startRun(_ session: RunSession, args: [String],
                  successTitle: String,
                  onSuccess: (@MainActor (EngineOutcome) -> Void)? = nil,
                  onDone: (@MainActor () async -> Void)? = nil) {
        guard run == nil || run?.finished == true else {
            flash(L("run.busy"), error: true)
            return
        }
        beforeRun?()
        run = session
        Task {
            do {
                let outcome = try await engine.run(args, handle: session.handle) { [weak session] ev in
                    session?.handle(ev)
                }
                if outcome.ok {
                    session.finish(success: true, title: successTitle, message: nil)
                    onSuccess?(outcome)
                } else {
                    session.finish(success: false, title: L("run.stopped"), message: outcome.errorMessage)
                }
            } catch {
                session.finish(success: false, title: L("common.error"), message: error.localizedDescription)
            }
            await projects.refreshStatus(quiet: true)
            await projects.loadHistory()
            await onDone?()
        }
    }

    // MARK: - Releases (V11)

    func loadRelease() async {
        guard let p = selected else {
            release = nil
            return
        }
        loadingRelease = true
        defer { loadingRelease = false }
        do {
            let r = try await engine.call(["release", "status", "--project", p.key], as: ReleaseStatus.self)
            if selected?.key == p.key { release = r }
        } catch {
            if release?.provider == nil { flash(error.localizedDescription, error: true) }
        }
    }

    /// Check → preview deploy → smoke checks. Ends awaiting confirmation; nothing reaches production.
    func startRelease() {
        guard let p = selected else { return }
        let s = RunSession(title: L("release.title"), subtitle: p.name, kind: .smart)
        startRun(s, args: ["release", "preview", "--project", p.key], successTitle: L("release.state.awaiting_confirmation"), onSuccess: { [weak self] outcome in
            if let op = try? outcome.decode(ReleaseOp.self), let url = op.preview?.url {
                s.resultURL = url
                s.outcomeMessage = url
                if self?.autoOpenPreview == true, let u = URL(string: url) { NSWorkspace.shared.open(u) }
            }
        }, onDone: { [weak self] in
            await self?.loadRelease()
        })
    }

    /// Publishes the smoke-tested preview (typed DEPLOY was entered in the sheet) and verifies production.
    func promoteRelease(_ op: ReleaseOp) {
        guard let p = selected else { return }
        let s = RunSession(title: L("release.stage.promote"), subtitle: p.name, kind: .production)
        startRun(s, args: ["release", "promote", "--project", p.key, "--op", op.id, "--confirm", "DEPLOY"], successTitle: L("release.state.succeeded"), onSuccess: { [weak self] outcome in
            guard let r = try? outcome.decode(ReleaseOp.self) else { return }
            s.resultURL = r.production?.url
            s.outcomeMessage = r.production?.url
            if r.state == "verify_failed" {
                s.success = false
                s.outcomeTitle = L("release.state.verify_failed")
                self?.flash(L("release.verifyFailedToast"), error: true)
            } else {
                self?.flash(L("release.succeededToast"))
            }
        }, onDone: { [weak self] in
            await self?.loadRelease()
        })
    }

    func rollbackRelease(deployId: String?) {
        guard let p = selected else { return }
        var args = ["release", "rollback", "--project", p.key, "--confirm", "ROLLBACK"]
        if let deployId { args += ["--deploy", deployId] }
        let s = RunSession(title: L("release.rollbackTitle"), subtitle: p.name, kind: .production)
        startRun(s, args: args, successTitle: L("release.rolledBack"), onSuccess: { outcome in
            if let r = try? outcome.decode(ReleaseOp.self) {
                s.resultURL = r.production?.url
                s.outcomeMessage = r.production?.url
                if r.state == "verify_failed" {
                    s.success = false
                    s.outcomeTitle = L("release.state.verify_failed")
                }
            }
        }, onDone: { [weak self] in
            await self?.loadRelease()
        })
    }

    func cancelRelease(_ op: ReleaseOp) async {
        guard let p = selected else { return }
        let o = try? await engine.run(["release", "cancel", "--project", p.key, "--op", op.id])
        if o?.ok != true { flash(o?.errorMessage ?? L("common.error"), error: true) }
        await loadRelease()
    }

    /// `force` ignores the incremental cache (lint/typecheck/build reused while nothing changed).
    func runCheck(force: Bool = false) {
        guard let p = selected else { return }
        let s = RunSession(title: L("common.checkNoun"), subtitle: p.name, kind: .check)
        startRun(s, args: ["check", "--project", p.key] + (force ? ["--force"] : []), successTitle: L("run.checkDone")) { outcome in
            if let check = try? outcome.decode(CheckState.self) {
                switch check.status {
                case "ready": s.outcomeTitle = L("run.readyToDeploy")
                case "warnings": s.outcomeTitle = L("run.readyWithWarnings")
                default:
                    s.outcomeTitle = L("run.deployBlocked")
                    s.success = false
                }
                s.outcomeMessage = L("run.checkCounts", check.counts?.pass ?? 0, check.counts?.warn ?? 0, check.counts?.fail ?? 0)
            }
        }
    }

    func smartDeploy() {
        guard let p = selected else { return }
        let s = RunSession(title: L("run.smartDeploy"), subtitle: L("run.smartSubtitle", p.name), kind: .smart)
        startRun(s, args: ["smart", "--project", p.key], successTitle: L("run.draftReady")) { [weak self] outcome in
            self?.afterDeploy(outcome, session: s, prod: false)
        }
    }

    /// Draft only — the engine reuses a fresh passing check (same fingerprint, < 30 min) or runs a new one.
    func draftPreview() {
        guard let p = selected else { return }
        let s = RunSession(title: L("run.draftPreview"), subtitle: p.name, kind: .draft)
        startRun(s, args: ["deploy", "--project", p.key, "--recheck-if-stale"], successTitle: L("run.draftReady")) { [weak self] outcome in
            self?.afterDeploy(outcome, session: s, prod: false)
        }
    }

    func productionDeploy(confirm: String) {
        guard let p = selected, confirm == "DEPLOY" else { return }
        let s = RunSession(title: L("run.productionDeploy"), subtitle: L("run.productionSubtitle", p.name), kind: .production)
        startRun(s, args: ["smart", "--project", p.key, "--prod", "--confirm", "DEPLOY"], successTitle: L("run.live")) { [weak self] outcome in
            self?.afterDeploy(outcome, session: s, prod: true)
        }
    }

    private func afterDeploy(_ outcome: EngineOutcome, session: RunSession, prod: Bool) {
        struct DeployOut: Decodable { let url: String? }
        struct SmartOut: Decodable { let deploy: DeployOut? }
        let url = (try? outcome.decode(SmartOut.self))?.deploy?.url ?? (try? outcome.decode(DeployOut.self))?.url
        if let url {
            session.resultURL = url
            session.outcomeMessage = url
            if autoOpenPreview, let u = URL(string: url) { NSWorkspace.shared.open(u) }
        }
    }

    // MARK: - Local preview

    func localStart(mode: String = "auto") {
        guard let p = selected else { return }
        busy.insert("local")
        Task {
            defer { busy.remove("local") }
            // collect steps silently; the overlay (with log tail + AI Fix) is shown only on failure
            let session = RunSession(title: L("run.localPreview"), subtitle: p.name, kind: .local)
            let outcome = try? await engine.run(["local", "start", "--project", p.key, "--mode", mode]) { [weak session] ev in
                session?.handle(ev)
            }
            if let outcome, outcome.ok, let st = try? outcome.decode(LocalState.self) {
                if let u = st.url.flatMap(URL.init(string:)) { NSWorkspace.shared.open(u) }
                flash("Local: \(st.url ?? "")")
            } else {
                let msg = outcome?.errorMessage ?? L("run.localFailed")
                if run == nil || run?.finished == true {
                    session.finish(success: false, title: L("run.localFailed"), message: msg)
                    run = session
                } else {
                    flash(msg, error: true)
                }
            }
            await projects.refreshStatus(quiet: true)
        }
    }

    func localStop() {
        guard let p = selected else { return }
        busy.insert("local")
        Task {
            defer { busy.remove("local") }
            _ = try? await engine.run(["local", "stop", "--project", p.key])
            flash(L("run.localStopped"))
            await projects.refreshStatus(quiet: true)
        }
    }

    func localRestart() {
        guard let p = selected else { return }
        busy.insert("local")
        Task {
            defer { busy.remove("local") }
            let outcome = try? await engine.run(["local", "restart", "--project", p.key])
            if outcome?.ok == true { flash(L("run.restarted")) } else { flash(outcome?.errorMessage ?? L("common.error"), error: true) }
            await projects.refreshStatus(quiet: true)
        }
    }

    // MARK: - Git

    func commit(message: String, files: [String]?, push: Bool) {
        guard let p = selected else { return }
        var args = ["git", "commit", "--project", p.key, "--message", message]
        if let files, let data = try? JSONEncoder().encode(files), let json = String(data: data, encoding: .utf8) {
            args += ["--files-json", json]
        }
        if push { args.append("--push") }
        let s = RunSession(title: push ? L("run.commitPush") : L("run.commit"), subtitle: p.name, kind: .git)
        startRun(s, args: args, successTitle: push ? L("run.pushed") : L("run.committed"))
    }

    func push() {
        guard let p = selected else { return }
        let s = RunSession(title: L("run.push"), subtitle: p.name, kind: .git)
        startRun(s, args: ["git", "push", "--project", p.key], successTitle: L("run.pushed"))
    }

    func fetch() {
        guard let p = selected else { return }
        busy.insert("fetch")
        Task {
            defer { busy.remove("fetch") }
            _ = try? await engine.run(["git", "fetch", "--project", p.key])
            await projects.refreshStatus(quiet: true)
        }
    }

    func setRemote(_ url: String) {
        guard let p = selected else { return }
        Task {
            let outcome = try? await engine.run(["git", "remote", "--project", p.key, "--url", url])
            if outcome?.ok == true { flash(L("run.remoteSet")) } else { flash(outcome?.errorMessage ?? L("common.error"), error: true) }
            await projects.refreshStatus(quiet: true)
        }
    }

    // MARK: - Netlify

    func netlifyLogin(then: (@MainActor () -> Void)? = nil) {
        let s = RunSession(title: L("netlify.signIn"), subtitle: L("run.netlifyLoginSubtitle"), kind: .netlify)
        startRun(s, args: ["netlify", "login"], successTitle: L("run.netlifyLoggedIn")) { _ in then?() }
    }

    func netlifyLink(siteId: String) {
        guard let p = selected else { return }
        let s = RunSession(title: L("run.netlifyLinking"), subtitle: p.name, kind: .netlify)
        startRun(s, args: ["netlify", "link", "--project", p.key, "--id", siteId], successTitle: L("run.netlifyLinked"))
    }

    func netlifyCreate(name: String, team: String?) {
        guard let p = selected else { return }
        var args = ["netlify", "create", "--project", p.key, "--name", name]
        if let team, !team.isEmpty { args += ["--team", team] }
        let s = RunSession(title: L("run.netlifyNewSite"), subtitle: "\(name).netlify.app", kind: .netlify)
        startRun(s, args: args, successTitle: L("run.netlifyCreated"))
    }

    // MARK: - Fixes

    func applyFix(_ fix: FixItem) {
        guard let p = selected else { return }
        let s = RunSession(title: fix.title, subtitle: p.name, kind: .fix)
        // --recheck: the engine re-runs the checks and says whether the issues this fix targeted are gone
        startRun(s, args: ["fix", "apply", fix.id, "--project", p.key, "--yes", "--recheck"], successTitle: L("common.done")) { outcome in
            guard let r = try? outcome.decode(FixApplyResult.self), let rc = r.recheck else { return }
            let steps = (rc.steps ?? []).joined(separator: ", ")
            if rc.verified {
                s.outcomeMessage = L("fix.verified", steps)
            } else {
                s.success = false
                s.outcomeTitle = L("fix.unverified", steps)
                let open = rc.unresolved ?? []
                s.outcomeMessage = open.isEmpty ? nil : L("fix.unresolved", open.joined(separator: ", "))
            }
        }
    }

    // MARK: - Domains

    func applyDomain(_ domain: String) {
        guard let p = selected else { return }
        let s = RunSession(title: L("run.domainConnecting", domain), subtitle: "\(p.name) · Spaceship DNS → Netlify", kind: .netlify)
        startRun(s, args: ["spaceship", "connect-domain", "--project", p.key, "--domain", domain, "--yes"], successTitle: L("run.domainConnected")) { _ in
            s.resultURL = "https://\(domain)"
            s.outcomeMessage = L("run.domainSsl")
        }
    }

    // MARK: - AI Fix

    func aiFix(step: String, target: String) {
        guard let p = selected else { return }
        Task {
            do {
                let r = try await engine.call(["aifix", "--project", p.key, "--step", step, "--target", target], as: AIFixResult.self)
                if r.clipboard {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(r.prompt, forType: .string)
                }
                if let cmd = r.commandFile {
                    NSWorkspace.shared.open(URL(fileURLWithPath: cmd))
                    flash(L("aifix.openedCli", target == "codex" ? "Codex" : "Claude Code"))
                } else if let url = r.url, let u = URL(string: url) {
                    NSWorkspace.shared.open(u)
                    flash(r.clipboard ? L("aifix.copiedPaste") : L("aifix.openedChat"))
                } else if r.clipboard {
                    flash(L("aifix.copiedChars", r.chars ?? r.prompt.count))
                }
            } catch {
                feedback?.show(error)
            }
        }
    }
}
