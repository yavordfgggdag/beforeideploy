import AppKit
import Combine
import SwiftUI

enum Screen: Hashable { case overview, project, domains, costs, setup, admin }

enum SheetKind: Identifiable {
    case production, netlifySetup, commit, history, settings, remote, spaceshipConnect, connectDomain, deleteAccount
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

    @Published var sheet: SheetKind?
    @Published var pendingFix: PendingFix?
    @Published var toast: Toast?
    @Published var engineMissing = false
    @Published var lastError: String?
    @Published var screen: Screen = .overview
    @Published var overview: Overview?
    @Published var loadingOverview = false
    @Published var costs: CostSummary?
    @Published var loadingCosts = false
    @Published var setup: SetupStatus?
    @Published var loadingSetup = false
    @Published var showPalette = false
    @Published var update: UpdateInfo?

    @AppStorage("checkOnSelect") var checkOnSelect = false

    let engine = EngineClient.shared
    private var pendingURL: URL?
    private var started = false
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

        projectStore.feedback = self
        accountStore.feedback = self
        hostingStore.feedback = self
        runController.feedback = self
        adminStore.feedback = self
        aiStore.feedback = self
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
        guard !started else { return }
        engineMissing = !engine.isInstalled
        guard !engineMissing else { return }
        await loadAccount()
        await loadProjects()
        started = true
        Task { await loadSetup() }
        Task { await loadOverview() }
        Task { await loadCosts() }
        Task { await loadSpaceship() }
        Task { await checkForUpdates() }
        if selectedKey == nil {
            let lastSelectedKey = projectStore.lastSelectedKey
            if !lastSelectedKey.isEmpty, projects.contains(where: { $0.key == lastSelectedKey }) {
                await select(lastSelectedKey)
            } else if let first = projects.first {
                await select(first.key)
            }
        }
        screen = .overview
        if let url = pendingURL {
            pendingURL = nil
            await handleURL(url)
        }
    }

    func loadProjects() async { await projectStore.loadProjects() }

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

    func select(_ key: String) async {
        screen = .project
        projectStore.setSelected(key)
        await refreshStatus()
        await loadHistory()
        await projectStore.touch(key)
        projectStore.backgroundSync(key)
        if checkOnSelect, run == nil { runCheck() }
    }

    func refreshStatus(quiet: Bool = false) async { await projectStore.refreshStatus(quiet: quiet) }

    func loadHistory() async { await projectStore.loadHistory() }

    /// A profile made on another Mac carries the language the user picked there — follow it once at login.
    private func adoptProfileLanguage() {
        guard let locale = account?.locale, !locale.isEmpty, locale != Localization.current,
              Localization.available.contains(locale) else { return }
        setLanguage(locale, syncToCloud: false)
    }

    // MARK: - Library

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
            key = await addProject(path: path)?.key
        }
        guard let key else { return }
        await select(key)
        switch url.host {
        case "check": runCheck()
        case "smart": smartDeploy()
        default: break
        }
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
        for name in names {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            p.arguments = ["-a", name, path]
            p.standardError = FileHandle.nullDevice
            do {
                try p.run()
                p.waitUntilExit()
                if p.terminationStatus == 0 { return }
            } catch {}
        }
        flash(L("open.appNotFound", names.first ?? L("open.theApp")), error: true)
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

    /// Reads the release feed (dormant until settings.release.url is set); `announce` shows the outcome as a toast.
    func checkForUpdates(force: Bool = false, announce: Bool = false) async {
        var args = ["update", "check"]
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
                let r = try await engine.call(["update", "download"], as: UpdateDownload.self)
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

    func copyCloudSchema() {
        copy(AccountStore.cloudSchema)
    }

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
