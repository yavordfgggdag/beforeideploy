import AppKit
import Combine
import SwiftUI

enum Screen: Hashable { case overview, project, domains, costs, setup, admin, account, assistant, usage }

enum SheetKind: Identifiable {
    case production, netlifySetup, commit, history, settings, remote, spaceshipConnect, connectDomain, deleteAccount, plans, release, rollback, client, aiKeys, newSite, pushover
    var id: Int { hashValue }
}

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let text: String
    var isError = false
    /// `EngineError.code` — shown as a chip, copied with the text, links to the help page when the cloud has `help.url`.
    var code: String?
    var helpURL: URL?
}

struct PendingFix: Identifiable {
    let fix: FixItem
    var id: String { fix.id }
}

/// Facade the views observe. State and actions live in the stores
/// (`ProjectStore`, `AccountStore`, `HostingStore`, `RunController`); AppModel keeps
/// navigation / UI state, Mission Control, Costs and Setup, and coordinates between stores.
/// Every store's `objectWillChange` is forwarded, so views that observe AppModel update as before.
@MainActor
final class AppModel: ObservableObject, Feedback {
    static let shared = AppModel()

    let projectStore: ProjectStore
    let accountStore: AccountStore
    let hostingStore: HostingStore
    let runController: RunController
    let adminStore: AdminStore
    let aiStore: AIStore
    let assistantStore: AssistantStore
    let billingStore: BillingStore

    @Published var sheet: SheetKind?
    @Published var pendingFix: PendingFix?
    @Published var toast: Toast?
    @Published var engineMissing = false
    @Published var nodeMissing = false
    @Published var lastError: String?
    @Published var screen: Screen = .overview
    @Published var overview: Overview?
    /// Monitoring state (V11): last pass, open incidents, where it runs.
    @Published var monitor: MonitorStatus?
    @Published var loadingOverview = false
    @Published var costs: CostSummary?
    @Published var loadingCosts = false
    @Published var setup: SetupStatus?
    @Published var loadingSetup = false
    @Published var showPalette = false
    @Published var update: UpdateInfo?

    @AppStorage("checkOnSelect") var checkOnSelect = false
    /// Re-check the selected project quietly when its files change (incremental, so usually seconds).
    @Published var autoCheck: Bool = UserDefaults.standard.object(forKey: "autoCheck") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(autoCheck, forKey: "autoCheck")
            watchSelectedProject()
        }
    }
    /// A quiet automatic check is running (hero and menu bar show a small spinner).
    @Published var autoChecking = false
    private var watcher: ProjectWatcher?
    private var autoCheckTask: Task<Void, Never>?
    private var quietCheck: EngineHandle?
    private var lastAutoCheck = Date.distantPast

    /// Menu bar icon: the worst state among all projects.
    var menuBarSymbol: String {
        let states = projects.compactMap(\.lastStatus)
        if states.contains("blocked") { return "xmark.octagon.fill" }
        if states.contains("warnings") { return "exclamationmark.triangle.fill" }
        return "paperplane.fill"
    }
    /// "stable" or "beta" (WP6.3) — beta testers get pre-releases from the same feed.
    @Published var updateChannel: String = UserDefaults.standard.string(forKey: "updateChannel") ?? "stable" {
        didSet {
            UserDefaults.standard.set(updateChannel, forKey: "updateChannel")
            Task { await checkForUpdates(force: true) }
        }
    }

    let engine = EngineClient.shared
    private var pendingURL: URL?
    private var started = false
    private var starting = false
    private var storeObservers: [AnyCancellable] = []

    init() {
        Localization.migrateFromV9()
        let engine = EngineClient.shared
        let projects = ProjectStore(engine: engine)
        projectStore = projects
        accountStore = AccountStore(engine: engine)
        hostingStore = HostingStore(engine: engine, projects: projects)
        runController = RunController(engine: engine, projects: projects)
        adminStore = AdminStore(engine: engine)
        aiStore = AIStore(engine: engine, projects: projects)
        assistantStore = AssistantStore(engine: engine, projects: projects)
        billingStore = BillingStore(engine: engine)

        projectStore.feedback = self
        accountStore.feedback = self
        hostingStore.feedback = self
        runController.feedback = self
        runController.beforeRun = { [weak self] in self?.stopQuietCheck() }
        adminStore.feedback = self
        aiStore.feedback = self
        assistantStore.feedback = self
        billingStore.feedback = self
        billingStore.onChanged = { [weak self] in await self?.accountStore.loadAccount() }
        aiStore.onApplied = { [weak self] in
            guard let self else { return }
            self.aiStore.dismiss()
            self.run = nil
            self.runCheck()
        }

        accountStore.onLogin = { [weak self] in
            guard let self else { return }
            if !self.started { await self.start() }
            self.adoptProfileLanguage()
            self.offerPlansOnce()
        }
        hostingStore.onSetupChanged = { [weak self] in
            await self?.loadSetup()
        }

        let forward: (ObservableObjectPublisher) -> AnyCancellable = { publisher in
            publisher.sink { [weak self] _ in self?.objectWillChange.send() }
        }
        storeObservers = [
            forward(projectStore.objectWillChange),
            forward(accountStore.objectWillChange),
            forward(hostingStore.objectWillChange),
            forward(runController.objectWillChange),
            forward(adminStore.objectWillChange),
            forward(aiStore.objectWillChange),
            forward(billingStore.objectWillChange),
        ]
    }

    // MARK: - Forwarded store state

    var projects: [Project] {
        get { projectStore.projects }
        set { projectStore.projects = newValue }
    }
    var selectedKey: String? {
        get { projectStore.selectedKey }
        set { projectStore.selectedKey = newValue }
    }
    var status: ProjectStatus? {
        get { projectStore.status }
        set { projectStore.status = newValue }
    }
    var loadingStatus: Bool {
        get { projectStore.loadingStatus }
        set { projectStore.loadingStatus = newValue }
    }
    var history: [HistoryEntry] {
        get { projectStore.history }
        set { projectStore.history = newValue }
    }
    var selected: Project? { projectStore.selected }

    var run: RunSession? {
        get { runController.run }
        set { runController.run = newValue }
    }
    var busy: Set<String> {
        get { runController.busy }
        set { runController.busy = newValue }
    }
    var autoOpenPreview: Bool {
        get { runController.autoOpenPreview }
        set { runController.autoOpenPreview = newValue }
    }

    var account: AccountState? {
        get { accountStore.account }
        set { accountStore.account = newValue }
    }
    var accountChecked: Bool {
        get { accountStore.accountChecked }
        set { accountStore.accountChecked = newValue }
    }
    var offlineMode: Bool {
        get { accountStore.offlineMode }
        set { accountStore.offlineMode = newValue }
    }
    var mustAuthenticate: Bool { accountStore.mustAuthenticate }

    var advice: HostingAdvice? {
        get { hostingStore.advice }
        set { hostingStore.advice = newValue }
    }
    var spaceship: SpaceshipStatus? {
        get { hostingStore.spaceship }
        set { hostingStore.spaceship = newValue }
    }
    var loadingSpaceship: Bool {
        get { hostingStore.loadingSpaceship }
        set { hostingStore.loadingSpaceship = newValue }
    }
    var domainForConnect: String? {
        get { hostingStore.domainForConnect }
        set { hostingStore.domainForConnect = newValue }
    }

    // MARK: - Lifecycle

    func start() async {
        // RootView is rebuilt on a language change and its .task calls start() again
        // a second call while the first is still starting (language change, Retry) must not run it twice (audit A15)
        guard !started, !starting else { return }
        starting = true
        defer { starting = false }
        // the engine inside the app is installed / updated first (audit B1/B2)
        let target = URL(fileURLWithPath: engine.enginePath).deletingLastPathComponent()
        if case .failed(let why) = await EngineInstaller.installIfNeeded(into: target) {
            flash(L("engine.installFailed", why), error: true)
        }
        engineMissing = !engine.isInstalled
        guard !engineMissing else { return }
        // Node.js is the one thing the app cannot bring along: say so with a way out (audit B4)
        let probe = try? await engine.run(["version"])
        nodeMissing = probe?.errorCode == "no_node"
        guard !nodeMissing else { return }
        await loadAccount()
        await loadProjects()
        started = true
        Task { await loadSetup() }
        Task { await loadOverview() }
        Task { await loadCosts() }
        Task { await loadSpaceship() }
        Task { await checkForUpdates() }
        Task { await loadMonitor() }
        startMonitorLoop()
        // role, plan and credits can change on the server (purchase, admin) — refresh every 15 minutes
        Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15 * 60 * 1_000_000_000)
                await self?.loadAccount()
            }
        }
        if selectedKey == nil {
            let lastSelectedKey = projectStore.lastSelectedKey
            // remember the last project, but open on Mission Control (no "loading project…" at launch)
            let key = (!lastSelectedKey.isEmpty && projects.contains(where: { $0.key == lastSelectedKey })) ? lastSelectedKey : projects.first?.key
            screen = .overview
            if let key { Task { await select(key, show: false) } }
        }
        screen = .overview
        await openRequestedScreen()
        if !CrashReporter.newCrashesSinceLastLaunch().isEmpty {
            AppLog.ui.notice("previous session crashed")
            flash(L("diagnostics.crashedLastTime"), error: true)
        }
        if let url = pendingURL {
            pendingURL = nil
            await handleURL(url)
        }
    }

    func loadProjects() async { await projectStore.loadProjects() }

    // MARK: - Monitoring (V11)

    func loadMonitor() async {
        monitor = try? await engine.call(["monitor", "status"], as: MonitorStatus.self)
    }

    /// One monitoring pass now (network probes only, never a project check).
    func runMonitorOnce(quiet: Bool = false) {
        guard !busy.contains("monitor") else { return }
        busy.insert("monitor")
        Task {
            defer { busy.remove("monitor") }
            let o = try? await engine.run(["monitor", "once"])
            if !quiet {
                if let r = try? o?.decode(MonitorRun.self) { flash(L("monitor.ran", r.checked)) } else { flash(o?.errorMessage ?? L("common.error"), error: true) }
            }
            await loadMonitor()
            if screen == .overview { await loadOverview(network: false) }
        }
    }

    /// The app's own timer: while the app is open, a pass every `intervalMin` minutes.
    private func startMonitorLoop() {
        Task { [weak self] in
            while !Task.isCancelled {
                let minutes = max(5, self?.monitor?.settings.intervalMin ?? 10)
                try? await Task.sleep(nanoseconds: UInt64(minutes) * 60 * 1_000_000_000)
                guard let self else { return }
                // the launchd agent already covers this Mac; do not double the probes
                if self.monitor?.agent.installed != true { self.runMonitorOnce(quiet: true) }
            }
        }
    }

    func setMonitorAgent(on: Bool) {
        busy.insert("monitor-agent")
        Task {
            defer { busy.remove("monitor-agent") }
            let o = try? await engine.run(on ? ["monitor", "agent", "install", "--yes"] : ["monitor", "agent", "remove"])
            if o?.ok == true { flash(L(on ? "monitor.agentOn" : "monitor.agentOff")) } else { flash(o?.errorMessage ?? L("common.error"), error: true) }
            await loadMonitor()
        }
    }

    /// Cloud monitoring for the selected project (registers its live host with the cloud, or removes it).
    func setCloudMonitoring(on: Bool) {
        guard let key = selectedKey else { return }
        busy.insert("monitor-cloud")
        Task {
            defer { busy.remove("monitor-cloud") }
            let o = try? await engine.run(on ? ["monitor", "cloud", "enable", "--project", key] : ["monitor", "cloud", "disable", "--project", key])
            if o?.ok == true {
                if on, let d = o?.resultData, let s = String(data: d, encoding: .utf8), s.contains("\"registered\":false") {
                    flash(L("monitor.cloudNeedsLiveUrl"), error: true)
                } else {
                    flash(L(on ? "monitor.cloudOn" : "monitor.cloudOff"))
                }
            } else {
                flash(o?.errorMessage ?? L("common.error"), error: true)
            }
            await loadMonitor()
        }
    }

    /// The one external channel: a webhook the user pastes (validated by the engine: https, public host).
    func setMonitorWebhook(_ url: String?) {
        busy.insert("monitor-webhook")
        Task {
            defer { busy.remove("monitor-webhook") }
            let value = (url?.isEmpty ?? true) ? "null" : "\"\(url!.replacingOccurrences(of: "\"", with: "\\\""))\""
            let o = try? await engine.run(["monitor", "settings", "--json", "{\"channels\":{\"webhook\":\(value)}}"])
            if o?.ok == true { flash(L("monitor.webhookSaved")) } else { flash(o?.errorMessage ?? L("common.error"), error: true) }
            await loadMonitor()
        }
    }

    /// Sends a test notification to every configured channel (webhook and/or Pushover).
    func testMonitorWebhook() {
        busy.insert("monitor-webhook")
        Task {
            defer { busy.remove("monitor-webhook") }
            let o = try? await engine.run(["monitor", "notify", "test"])
            if o?.ok == true { flash(L("monitor.webhookTested")) } else { flash(o?.errorMessage ?? L("common.error"), error: true) }
        }
    }

    /// Pushover: the keys go to the engine through the environment (never argv), are verified with Pushover
    /// and stored in the Keychain. Returns true when connected.
    func connectPushover(user: String, token: String) async -> Bool {
        busy.insert("monitor-pushover")
        defer { busy.remove("monitor-pushover") }
        let env = ["BID_PUSHOVER_USER": user.trimmingCharacters(in: .whitespacesAndNewlines), "BID_PUSHOVER_TOKEN": token.trimmingCharacters(in: .whitespacesAndNewlines)]
        let o = try? await engine.run(["monitor", "pushover", "connect"], env: env)
        if o?.ok == true { flash(L("monitor.pushoverConnected")) } else { flash(o?.errorMessage ?? L("common.error"), error: true) }
        await loadMonitor()
        return o?.ok == true
    }

    func disconnectPushover() {
        busy.insert("monitor-pushover")
        Task {
            defer { busy.remove("monitor-pushover") }
            let o = try? await engine.run(["monitor", "pushover", "disconnect"])
            if o?.ok == true { flash(L("monitor.pushoverRemoved")) } else { flash(o?.errorMessage ?? L("common.error"), error: true) }
            await loadMonitor()
        }
    }

    func setMonitorNotify(down: Bool? = nil, ssl: Bool? = nil, domain: Bool? = nil, recovered: Bool? = nil) {
        guard var n = monitor?.settings.notify else { return }
        if let down { n.down = down }
        if let ssl { n.ssl = ssl }
        if let domain { n.domain = domain }
        if let recovered { n.recovered = recovered }
        let json = "{\"notify\":{\"down\":\(n.down),\"ssl\":\(n.ssl),\"domain\":\(n.domain),\"recovered\":\(n.recovered)}}"
        Task {
            _ = try? await engine.run(["monitor", "settings", "--json", json])
            await loadMonitor()
        }
    }

    // MARK: - Clients (V11 portfolio)

    func setClient(_ name: String) {
        guard let key = selectedKey else { return }
        Task {
            let o = try? await engine.run(["project", "client", "--project", key, "--name", name])
            if o?.ok == true { flash(L("client.saved")) } else { flash(o?.errorMessage ?? L("common.error"), error: true) }
            await loadProjects()
            await refreshStatus(quiet: true)
            await loadOverview(network: false)
        }
    }

    /// Switches the app and engine language without a restart and reloads what the engine had already
    /// sent in the old language (statuses, Setup, Mission Control, Costs, Domains, history).
    func setLanguage(_ code: String, syncToCloud: Bool = true) {
        guard code != Localization.stored else { return }
        Localization.set(code)
        objectWillChange.send()
        if syncToCloud { accountStore.saveLocale(code) }
        guard started else { return }
        advice = nil
        Task {
            await refreshStatus(quiet: true)
            await loadHistory()
            await loadSetup()
            await loadOverview()
            await loadCosts()
            await loadSpaceship()
        }
    }

    func select(_ key: String, show: Bool = true) async {
        if show { screen = .project }
        projectStore.setSelected(key)
        watchSelectedProject()
        await refreshStatus()
        await loadHistory()
        await projectStore.touch(key)
        projectStore.backgroundSync(key)
        if show, checkOnSelect, run == nil { runCheck() }
    }

    func refreshStatus(quiet: Bool = false) async { await projectStore.refreshStatus(quiet: quiet) }

    /// Whether the embedded AI can run right now: an own key on this Mac, or a paid plan for the cloud model.
    var aiReady: Bool { account?.features?.aiBuiltin == true }

    // MARK: - Launchpad (V11.1)

    @Published var templates: [SiteTemplate] = []

    func loadTemplates() async {
        templates = (try? await engine.call(["new", "list"], as: [SiteTemplate].self)) ?? []
    }

    /// Creates a site from a template, adds it to the library and opens it. Returns an error message, or nil.
    func createSite(name: String, template: String, dir: String, lang: String) async -> String? {
        do {
            let r = try await engine.call(["new", "create", "--template", template, "--name", name, "--dir", dir, "--lang", lang], as: NewSiteResult.self)
            await projectStore.loadProjects()
            flash(L("newsite.created", r.project.name))
            await select(r.project.key)
            return nil
        } catch { return error.localizedDescription }
    }

    /// The one thing the launch checklist asks for on a step: the same actions the rest of the app uses.
    func launchAction(_ step: LaunchStatus.Step, tab: Binding<ProjectTab>) {
        switch step.action {
        case "check": runCheck()
        case "fix":
            if step.id == "site" { if aiReady { aiStore.start(step: "site") } else { aiUnavailableAction() } } else { tab.wrappedValue = .overview }
        case "hosting": tab.wrappedValue = .hosting
        case "deploy": smartDeploy()
        case "release": sheet = .release
        case "domain": screen = .domains; Task { await loadSpaceship() }
        case "monitor": screen = .overview
        default: break
        }
    }

    /// The right door when the AI cannot run yet: VIP/admin add a key, members pick a plan, guests sign in.
    func aiUnavailableAction() {
        if account?.canUseOwnKey == true {
            flash(L("ai.keyNeeded"), error: false)
            sheet = .aiKeys
        } else if account?.loggedIn == true {
            flash(L("ai.planNeeded"), error: false)
            sheet = .plans
        } else {
            flash(L("ai.signInNeeded"), error: true)
            offlineMode = false
        }
    }

    /// Opens the AI assistant for the selected project, with an issue preselected when given. Without a
    /// key or plan it opens the key sheet instead, so the first click never ends in a dead button.
    func openAssistant(issue: String? = nil, projectKey: String? = nil) {
        Task {
            if let k = projectKey, projectStore.selected?.key != k { await select(k, show: false) }
            guard aiReady else {
                aiUnavailableAction()
                return
            }
            if let issue { assistantStore.selectedIssue = issue }
            screen = .assistant
        }
    }

    func loadHistory() async { await projectStore.loadHistory() }

    /// A profile made on another Mac carries the language the user picked there — follow it once at login.
    private func adoptProfileLanguage() {
        guard let locale = account?.locale, !locale.isEmpty, locale != Localization.current,
              Localization.available.contains(locale) else { return }
        setLanguage(locale, syncToCloud: false)
    }

    // MARK: - Library

    /// Onboarding: a small real website to try everything on (engine `bid demo create`), then a check.
    func createDemoProject() {
        busy.insert("demo")
        Task {
            defer { busy.remove("demo") }
            do {
                let p = try await engine.call(["demo", "create"], as: Project.self)
                await loadProjects()
                await select(p.key)
                runCheck()
                Task { await loadOverview() }
            } catch { show(error) }
        }
    }

    func addProjectPanel() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true
        panel.prompt = L("library.addButton")
        panel.message = L("library.pickFolder")
        guard panel.runModal() == .OK else { return }
        let urls = panel.urls
        Task {
            var lastKey: String?
            for url in urls {
                if let p = await addProject(path: url.path) { lastKey = p.key }
            }
            if let lastKey { await select(lastKey) }
        }
    }

    @discardableResult
    func addProject(path: String) async -> Project? {
        await projectStore.addProject(path: path)
    }

    func removeProject(_ key: String) {
        Task {
            await projectStore.remove(key)
            if selectedKey == nil, let first = projects.first { await select(first.key) }
        }
    }

    // MARK: - URL scheme (beforeideploy://open?path=… | check | smart)

    func handleURL(_ url: URL) async {
        guard url.scheme == "beforeideploy" else { return }
        if url.host == "auth-callback" {
            await completeOAuth(url)
            return
        }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let path = items.first { $0.name == "path" }?.value
        var key: String? = selectedKey
        if let path, !path.isEmpty {
            let wanted = (path as NSString).standardizingPath
            if let known = projects.first(where: { ($0.path as NSString).standardizingPath == wanted }) {
                key = known.key
            } else {
                // any web page can open a beforeideploy:// link: a new folder is added only after the user agrees (audit A1)
                guard confirmLinkedFolder(wanted) else { return }
                key = await addProject(path: wanted)?.key
            }
        }
        guard let key else { return }
        await select(key)
        switch url.host {
        // a check only reads and builds a project that is already on the list
        case "check": runCheck()
        // a link never deploys: it opens the project and the user presses Smart Deploy
        case "smart": break
        default: break
        }
    }

    private func confirmLinkedFolder(_ path: String) -> Bool {
        let alert = NSAlert()
        alert.messageText = L("link.addFolder.title")
        alert.informativeText = L("link.addFolder.body", path)
        alert.alertStyle = .warning
        alert.addButton(withTitle: L("link.addFolder.add"))
        alert.addButton(withTitle: L("common.cancel"))
        NSApp.activate(ignoringOtherApps: true)
        return alert.runModal() == .alertFirstButtonReturn
    }

    func enqueueURL(_ url: URL) {
        if url.host == "auth-callback" {
            Task { await handleURL(url) }
            return
        }
        if started {
            Task { await handleURL(url) }
        } else {
            pendingURL = url
        }
    }

    // MARK: - Runs

    /// Release state (V11) lives in RunController; the views read it through the facade.
    var release: ReleaseStatus? { runController.release }
    var loadingRelease: Bool { runController.loadingRelease }
    func loadRelease() async { await runController.loadRelease() }
    func startRelease() { runController.startRelease() }
    func promoteRelease(_ op: ReleaseOp) { runController.promoteRelease(op) }
    func rollbackRelease(deployId: String?) { runController.rollbackRelease(deployId: deployId) }
    func cancelRelease(_ op: ReleaseOp) async { await runController.cancelRelease(op) }

    func runCheck(force: Bool = false) { runController.runCheck(force: force) }
    func smartDeploy() { runController.smartDeploy() }
    func draftPreview() { runController.draftPreview() }
    func productionDeploy(confirm: String) { runController.productionDeploy(confirm: confirm) }

    // MARK: - Local preview

    func localStart(mode: String = "auto") { runController.localStart(mode: mode) }
    func localStop() { runController.localStop() }
    func localRestart() { runController.localRestart() }

    // MARK: - Git

    func commit(message: String, files: [String]?, push: Bool) {
        runController.commit(message: message, files: files, push: push)
    }
    func push() { runController.push() }
    func fetch() { runController.fetch() }
    func setRemote(_ url: String) { runController.setRemote(url) }

    // MARK: - Netlify

    func netlifyLogin(then: (@MainActor () -> Void)? = nil) { runController.netlifyLogin(then: then) }
    func netlifyLink(siteId: String) { runController.netlifyLink(siteId: siteId) }
    func netlifyCreate(name: String, team: String?) { runController.netlifyCreate(name: name, team: team) }

    // MARK: - Fixes

    func requestFix(_ id: String) {
        if id == "netlify.link" {
            sheet = .netlifySetup
            return
        }
        if let f = status?.fixes.first(where: { $0.id == id }) {
            pendingFix = PendingFix(fix: f)
        }
    }

    func applyFix(_ fix: FixItem) {
        guard selected != nil else { return }
        pendingFix = nil
        runController.applyFix(fix)
    }

    // MARK: - Open helpers

    func open(_ string: String?) {
        guard let string, let u = URL(string: string) else { return }
        NSWorkspace.shared.open(u)
    }

    func openFile(_ path: String?) {
        guard let path else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    func revealInFinder(_ path: String) {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }

    func openIn(app names: [String], path: String) {
        Task {
            for name in names {
                if await Self.open(app: name, path: path) { return }
            }
            flash(L("open.appNotFound", names.first ?? L("open.theApp")), error: true)
        }
    }

    /// `open -a <app> <path>` without blocking the main thread while Launch Services looks for the app.
    nonisolated private static func open(app name: String, path: String) async -> Bool {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        p.arguments = ["-a", name, path]
        p.standardError = FileHandle.nullDevice
        let exit = ExitSignal()
        p.terminationHandler = { exit.fire($0.terminationStatus) }
        do { try p.run() } catch { return false }
        return await exit.wait() == 0
    }

    func copy(_ text: String?) {
        guard let text else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        flash(L("common.copied"))
    }

    // MARK: - Mission Control / Costs / Setup

    func loadOverview(network: Bool = true) async {
        loadingOverview = true
        defer { loadingOverview = false }
        // first paint from local state right away; the live check of sites and SSL follows
        if network, overview == nil, let fast = try? await engine.call(["overview", "--no-network"], as: Overview.self) {
            overview = fast
        }
        var args = ["overview"]
        if !network { args.append("--no-network") }
        if let o = try? await engine.call(args, as: Overview.self) { overview = o }
    }

    func loadCosts(refresh: Bool = false) async {
        loadingCosts = true
        defer { loadingCosts = false }
        var args = ["costs"]
        if refresh { args.append("--refresh") }
        do { costs = try await engine.call(args, as: CostSummary.self) } catch { show(error) }
    }

    func loadSetup() async {
        loadingSetup = true
        defer { loadingSetup = false }
        if let s = try? await engine.call(["setup", "status"], as: SetupStatus.self) { setup = s }
    }

    func setBudget(netlifyMin: Double) {
        Task {
            _ = try? await engine.run(["budget", "--netlify-min", String(Int(netlifyMin))])
            flash(L("costs.budgetSaved"))
            await loadCosts()
        }
    }

    func setupAction(_ item: SetupItem) {
        guard let a = item.action else { return }
        switch a.type {
        case "run":
            let s = RunSession(title: L("setup.installing", item.title), subtitle: a.display ?? "", kind: .fix)
            runController.startRun(s, args: ["setup", "run", item.id, "--yes"], successTitle: L("setup.itemReady", item.title)) { [weak self] _ in
                Task { await self?.loadSetup() }
            }
        case "terminal":
            Task {
                do {
                    let r = try await engine.call(["setup", "terminal", item.id], as: CommandFileResult.self)
                    openCommand(r.commandFile)
                    flash(L("setup.finishInTerminal"))
                } catch { show(error) }
            }
        case "open":
            open(a.url)
        case "app":
            if a.appAction == "ai-key" { sheet = .aiKeys }
            if a.appAction == "cloud-schema" {
                Task {
                    if await copyCloudSchema() {
                        flash(L("cloud.schemaCopiedOpen"))
                        if let u = a.url { open(u) }
                    }
                }
            }
            if a.appAction == "spaceship-connect" { sheet = .spaceshipConnect }
            if a.appAction == "netlify-login" { netlifyLogin { [weak self] in Task { await self?.loadSetup() } } }
        default:
            break
        }
    }

    func setupAuto() {
        let s = RunSession(title: L("setup.autoTitle"), subtitle: L("setup.autoSubtitle"), kind: .fix)
        runController.startRun(s, args: ["setup", "auto", "--yes"], successTitle: L("setup.autoDone")) { [weak self] outcome in
            guard let self else { return }
            if let r = try? outcome.decode(SetupAutoResult.self) {
                self.setup = r.status
                if let f = r.commandFile {
                    s.outcomeMessage = L("setup.autoSignInsLeft")
                    self.openCommand(f)
                } else if r.status.ready {
                    s.outcomeMessage = L("setup.autoAllSet")
                }
            }
            if self.setup?.items.contains(where: { !$0.ok && $0.action?.appAction == "netlify-login" }) == true {
                s.outcomeMessage = (s.outcomeMessage ?? "") + L("setup.autoNetlifyToo")
            }
        }
    }

    func openCommand(_ path: String) {
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    // MARK: - GDPR: export & delete (WP5)

    func exportAccountData() {
        Task {
            do {
                let r = try await engine.call(["account", "export"], as: ExportResult.self)
                revealInFinder(r.path)
                flash(L("account.exported"))
            } catch { show(error) }
        }
    }

    /// Deletes the cloud account once the user typed DELETE; projects on this Mac stay. True on success.
    func deleteAccount(confirm: String) async -> Bool {
        guard confirm == "DELETE" else { return false }
        do {
            _ = try await engine.call(["account", "delete", "--confirm", "DELETE"], as: DeleteAccountResult.self)
            offlineMode = false
            await loadAccount()
            flash(L("deleteAccount.done"))
            return true
        } catch {
            show(error)
            return false
        }
    }

    // MARK: - Updates & support (WP6.3, WP6.6)

    /// The app's own version decides whether an update is new (audit B5); a development build from
    /// `swift run` has no Info.plist and falls back to the engine's version.
    static var currentVersionArgs: [String] {
        guard let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String, !v.isEmpty else { return [] }
        return ["--current", v]
    }

    /// Reads the release feed (dormant until settings.release.url is set); `announce` shows the outcome as a toast.
    func checkForUpdates(force: Bool = false, announce: Bool = false) async {
        var args = ["update", "check", "--channel", updateChannel] + Self.currentVersionArgs
        if force { args.append("--force") }
        do {
            let u = try await engine.call(args, as: UpdateInfo.self)
            update = u
            if announce {
                flash(u.available ? L("update.available", u.latest ?? "") : (u.configured ? L("update.upToDate") : L("update.notConfigured")))
            }
        } catch {
            if announce { show(error) }
        }
    }

    func downloadUpdate() {
        busy.insert("update")
        Task {
            defer { busy.remove("update") }
            do {
                let r = try await engine.call(["update", "download", "--channel", updateChannel] + Self.currentVersionArgs, as: UpdateDownload.self)
                flash(L("update.downloaded", r.version))
                openFile(r.path)
            } catch { show(error) }
        }
    }

    /// Bundles redacted logs + doctor into a zip and shows it in Finder (nothing is sent anywhere).
    func saveReport() {
        busy.insert("report")
        Task {
            defer { busy.remove("report") }
            do {
                let r = try await engine.call(["report"], as: ReportResult.self)
                revealInFinder(r.path)
                flash(L("report.saved"))
            } catch { show(error) }
        }
    }

    // MARK: - Account

    func loadAccount() async {
        await accountStore.loadAccount()
        if screen == .admin, account?.isAdmin != true { screen = .overview }
    }

    // MARK: - VIP AI keys

    var aiKeys: [AIKeyStatus] { accountStore.aiKeys }
    func loadAIKeys() async { await accountStore.loadAIKeys() }
    func setAIKey(provider: String, key: String) async -> Bool { await accountStore.setAIKey(provider: provider, key: key) }
    func deleteAIKey(provider: String) async { await accountStore.deleteAIKey(provider: provider) }

    /// Returns an error message, or nil on success.
    func signup(email: String, password: String, name: String) async -> String? {
        await accountStore.signup(email: email, password: password, name: name)
    }

    func login(email: String, password: String) async -> String? {
        await accountStore.login(email: email, password: password)
    }

    func recover(email: String) async -> String? {
        await accountStore.recover(email: email)
    }

    func oauth(_ provider: String) { accountStore.oauth(provider) }

    func completeOAuth(_ url: URL) async { await accountStore.completeOAuth(url) }

    func logout() { accountStore.logout() }

    func syncNow() { accountStore.syncNow() }

    func configureCloud(url: String, key: String) async -> String? {
        await accountStore.configureCloud(url: url, key: key)
    }

    /// Copies supabase/schema.sql for the SQL Editor; returns false when the engine has no schema file.
    @discardableResult
    func copyCloudSchema() async -> Bool {
        guard let sql = await accountStore.cloudSchema() else {
            flash(L("cloud.schemaUnavailable"), error: true)
            return false
        }
        copy(sql)
        return true
    }

    var lastAuthCode: String? { accountStore.lastAuthCode }
    var cloudDoctor: CloudDoctorResult? { accountStore.cloudDoctor }
    var cloudChecking: Bool { accountStore.cloudChecking }
    func checkCloud() async { await accountStore.checkCloud() }
    func resendConfirmation(email: String) async -> String? { await accountStore.resendConfirmation(email: email) }

    func continueOffline() {
        offlineMode = true
        Task { if !started { await start() } }
    }

    // MARK: - Hosting

    func loadAdvice() async { await hostingStore.loadAdvice() }

    func setHosting(_ id: String) { hostingStore.setHosting(id) }

    // MARK: - Spaceship

    func loadSpaceship(refresh: Bool = false) async { await hostingStore.loadSpaceship(refresh: refresh) }

    func connectSpaceship(key: String, secret: String) async -> Bool {
        await hostingStore.connectSpaceship(key: key, secret: secret)
    }

    func disconnectSpaceship() { hostingStore.disconnectSpaceship() }

    func dns(_ domain: String) async -> [DnsRecord] { await hostingStore.dns(domain) }

    func planDomain(_ domain: String) async throws -> DomainPlan { try await hostingStore.planDomain(domain) }

    func applyDomain(_ domain: String) { runController.applyDomain(domain) }

    // MARK: - AI Fix

    func aiFix(step: String, target: String) { runController.aiFix(step: step, target: target) }

    // MARK: - Feedback

    func flash(_ text: String, error: Bool = false) {
        present(Toast(text: text, isError: error), seconds: error ? 4 : 2.6)
    }

    /// Every failure goes through here (WP7): the message, the engine's error code and, when the cloud
    /// settings carry `help.url`, a link to the page for that code (`<help.url>/<code>`).
    func show(_ error: Error) {
        if case EngineError.missing = error { engineMissing = true }
        var t = Toast(text: error.localizedDescription, isError: true)
        if case EngineError.failed(_, let code) = error, let code, !code.isEmpty, code != "error" {
            t.code = code
            if let base = account?.helpUrl, !base.isEmpty {
                t.helpURL = URL(string: base.hasSuffix("/") ? base + code : base + "/" + code)
            }
        }
        present(t, seconds: 6)
    }

    func dismissToast() {
        withAnimation(.easeOut(duration: 0.2)) { toast = nil }
    }

    private func present(_ t: Toast, seconds: Double) {
        withAnimation(.spring(response: 0.35)) { toast = t }
        Task {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            if toast == t { withAnimation(.easeOut(duration: 0.25)) { toast = nil } }
        }
    }

    // MARK: - Automatic check (V10)

    /// Watches the selected project's folder while auto-check is on.
    func watchSelectedProject() {
        watcher?.stop()
        watcher = nil
        guard autoCheck, let key = selectedKey, let p = projects.first(where: { $0.key == key }), p.exists != false else { return }
        let w = ProjectWatcher(path: p.path) { [weak self] in
            Task { @MainActor in self?.scheduleAutoCheck(for: key) }
        }
        w.start()
        watcher = w
    }

    /// A run the user starts wins: the quiet check on the same project stops, so two engine
    /// processes never build the same folder at once (audit A5).
    func stopQuietCheck() {
        autoCheckTask?.cancel()
        quietCheck?.cancel()
        quietCheck = nil
    }

    /// Debounced: 4 s after the last change, at most every 20 s, never while another run is on screen.
    private func scheduleAutoCheck(for key: String) {
        autoCheckTask?.cancel()
        autoCheckTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard let self, !Task.isCancelled else { return }
            let wait = 20 - Date().timeIntervalSince(self.lastAutoCheck)
            if wait > 0 { try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }
            guard !Task.isCancelled, self.run == nil, !self.autoChecking, self.selectedKey == key else { return }
            await self.runQuietCheck(key)
        }
    }

    private func runQuietCheck(_ key: String) async {
        autoChecking = true
        lastAutoCheck = Date()
        let handle = EngineHandle()
        quietCheck = handle
        defer {
            autoChecking = false
            if quietCheck === handle { quietCheck = nil }
        }
        let before = projects.first { $0.key == key }?.lastStatus
        AppLog.ui.debug("auto-check")
        _ = try? await engine.run(["check", "--project", key], handle: handle)
        // a run the user started stopped this one: its verdict is not worth a notification
        guard quietCheck === handle else { return }
        await loadProjects()
        await refreshStatus(quiet: true)
        let after = status?.check?.status
        // tell the user only when the verdict changes (ready ↔ blocked), not on every save
        if let after, let before, after != before, after == "blocked" || before == "blocked" {
            let name = projects.first { $0.key == key }?.name ?? key
            Notifier.shared.post(title: name, body: after == "blocked" ? L("autocheck.nowBlocked") : L("autocheck.nowReady"), url: nil)
            flash(after == "blocked" ? L("autocheck.nowBlockedToast", name) : L("autocheck.nowReadyToast", name), error: after == "blocked")
        }
    }

    // MARK: - Start screen (screenshots, deep links)

    /// `open "Before I Deploy.app" --args -BIDScreen costs` opens a given screen at launch (the value lands in
    /// UserDefaults' argument domain). Used by the screenshot workflow; harmless for everyone else.
    private func openRequestedScreen() async {
        guard Snapshot.argument("BIDScreen"), let name = UserDefaults.standard.string(forKey: "BIDScreen") else { return }
        switch name {
        case "project": if let first = projects.first { await select(first.key) }
        case "domains": screen = .domains
        case "costs": screen = .costs
        case "setup": screen = .setup
        case "account": screen = .account
        case "plans": sheet = .plans
        case "settings": sheet = .settings
        case "palette": showPalette = true
        default: screen = .overview
        }
        if Snapshot.argument("BIDRunCheck"), UserDefaults.standard.bool(forKey: "BIDRunCheck") { runCheck() }
    }

    // MARK: - Onboarding: plan step (WP5)

    /// First sign-in of a normal user on Free: show "Plan & credits" once (trial offer, "continue with Free"
    /// is simply closing the sheet). Never again after that, never for vip/admin.
    private func offerPlansOnce() {
        let key = "onboarding.plansShown"
        guard account?.features?.billingPlans == true, account?.plan == "free",
              !UserDefaults.standard.bool(forKey: key), sheet == nil else { return }
        UserDefaults.standard.set(true, forKey: key)
        sheet = .plans
    }

    // MARK: - Keyboard navigation

    /// ⌘] / ⌘[ — next or previous project in the sidebar order, wrapping around.
    func selectAdjacent(_ delta: Int) {
        let keys = projects.map(\.key)
        guard !keys.isEmpty else { return }
        let current = selectedKey.flatMap { keys.firstIndex(of: $0) } ?? (delta > 0 ? -1 : 0)
        let next = keys[((current + delta) % keys.count + keys.count) % keys.count]
        Task { await select(next) }
    }
}
