import AppKit
import SwiftUI

enum Screen: Hashable { case overview, project, domains, costs, setup }

enum SheetKind: Identifiable {
    case production, netlifySetup, commit, history, settings, remote, spaceshipConnect, connectDomain
    var id: Int { hashValue }
}

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let text: String
    var isError = false
}

struct PendingFix: Identifiable {
    let fix: FixItem
    var id: String { fix.id }
}

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    @Published var projects: [Project] = []
    @Published var selectedKey: String?
    @Published var status: ProjectStatus?
    @Published var loadingStatus = false
    @Published var history: [HistoryEntry] = []
    @Published var run: RunSession?
    @Published var sheet: SheetKind?
    @Published var pendingFix: PendingFix?
    @Published var toast: Toast?
    @Published var busy: Set<String> = []
    @Published var engineMissing = false
    @Published var lastError: String?
    @Published var screen: Screen = .overview
    @Published var overview: Overview?
    @Published var loadingOverview = false
    @Published var costs: CostSummary?
    @Published var loadingCosts = false
    @Published var setup: SetupStatus?
    @Published var loadingSetup = false
    @Published var spaceship: SpaceshipStatus?
    @Published var loadingSpaceship = false
    @Published var domainForConnect: String?
    @Published var account: AccountState?
    @Published var accountChecked = false
    @Published var showPalette = false
    @Published var advice: HostingAdvice?
    @AppStorage("offlineMode") var offlineMode = false

    @AppStorage("autoOpenPreview") var autoOpenPreview = true
    @AppStorage("checkOnSelect") var checkOnSelect = false
    @AppStorage("lastSelectedKey") private var lastSelectedKey = ""

    let engine = EngineClient.shared
    private var pendingURL: URL?
    private var started = false

    var selected: Project? { projects.first { $0.key == selectedKey } }

    // MARK: - Lifecycle

    func start() async {
        engineMissing = !engine.isInstalled
        guard !engineMissing else { return }
        await loadAccount()
        await loadProjects()
        started = true
        Task { await loadSetup() }
        Task { await loadOverview() }
        Task { await loadCosts() }
        Task { await loadSpaceship() }
        if selectedKey == nil {
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

    func loadProjects() async {
        do {
            projects = try await engine.call(["project", "list"], as: [Project].self)
        } catch {
            show(error)
        }
    }

    func select(_ key: String) async {
        screen = .project
        if selectedKey != key { status = nil }
        selectedKey = key
        lastSelectedKey = key
        await refreshStatus()
        await loadHistory()
        _ = try? await engine.run(["project", "touch", "--project", key])
        backgroundSync(key)
        if checkOnSelect, run == nil { runCheck() }
    }

    /// Quiet background refresh of things that need the network (git fetch, Netlify site info).
    private func backgroundSync(_ key: String) {
        Task {
            if status?.git.remote != nil {
                _ = try? await engine.run(["git", "fetch", "--project", key])
            }
            if status?.detect.netlifyLinked == true, status?.netlifyAuth.loggedIn == true,
               status?.project.netlify?.liveUrl == nil {
                _ = try? await engine.run(["netlify", "info", "--project", key])
            }
            if selectedKey == key { await refreshStatus(quiet: true) }
        }
    }

    func refreshStatus(quiet: Bool = false) async {
        guard let key = selectedKey else { return }
        if !quiet { loadingStatus = true }
        defer { loadingStatus = false }
        do {
            let s = try await engine.call(["status", "--project", key], as: ProjectStatus.self)
            if selectedKey == key {
                status = s
                if let i = projects.firstIndex(where: { $0.key == key }) {
                    var p = s.project
                    p.lastStatus = s.check?.status
                    projects[i] = p
                }
            }
        } catch {
            if !quiet { show(error) }
        }
    }

    func loadHistory() async {
        guard let key = selectedKey else { return }
        history = (try? await engine.call(["history", "--project", key, "--limit", "30"], as: [HistoryEntry].self)) ?? []
    }

    // MARK: - Library

    func addProjectPanel() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true
        panel.prompt = "Добави"
        panel.message = "Избери папката на проекта"
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
        do {
            let p = try await engine.call(["project", "add", "--path", path], as: Project.self)
            await loadProjects()
            flash("Добавен: \(p.name)")
            return p
        } catch {
            show(error)
            return nil
        }
    }

    func removeProject(_ key: String) {
        Task {
            _ = try? await engine.run(["project", "remove", "--project", key])
            if selectedKey == key {
                selectedKey = nil
                status = nil
            }
            await loadProjects()
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

    private func startRun(_ session: RunSession, args: [String],
                          successTitle: String,
                          onSuccess: (@MainActor (EngineOutcome) -> Void)? = nil) {
        guard run == nil || run?.finished == true else {
            flash("Изчакай текущата операция да приключи", error: true)
            return
        }
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
                    session.finish(success: false, title: "Спряно", message: outcome.errorMessage)
                }
            } catch {
                session.finish(success: false, title: "Грешка", message: error.localizedDescription)
            }
            await refreshStatus(quiet: true)
            await loadHistory()
        }
    }

    func runCheck() {
        guard let p = selected else { return }
        let s = RunSession(title: "Проверка", subtitle: p.name, kind: .check)
        startRun(s, args: ["check", "--project", p.key], successTitle: "Проверката приключи") { outcome in
            if let check = try? outcome.decode(CheckState.self) {
                switch check.status {
                case "ready": s.outcomeTitle = "READY TO DEPLOY"
                case "warnings": s.outcomeTitle = "READY WITH WARNINGS"
                default:
                    s.outcomeTitle = "DEPLOY BLOCKED"
                    s.success = false
                }
                s.outcomeMessage = "\(check.counts?.pass ?? 0) успешни · \(check.counts?.warn ?? 0) предупреждения · \(check.counts?.fail ?? 0) грешки"
            }
        }
    }

    func smartDeploy() {
        guard let p = selected else { return }
        let s = RunSession(title: "Smart Deploy", subtitle: "\(p.name) · Git → Secrets → Build → Draft Preview", kind: .smart)
        startRun(s, args: ["smart", "--project", p.key], successTitle: "Draft Preview е готов") { [weak self] outcome in
            self?.afterDeploy(outcome, session: s, prod: false)
        }
    }

    /// Draft only — reuses a fresh passing check, otherwise runs the full Smart flow.
    func draftPreview() {
        guard let p = selected else { return }
        if let c = status?.check, c.status != "blocked", let d = Fmt.date(c.at), Date().timeIntervalSince(d) < 25 * 60 {
            let s = RunSession(title: "Draft Preview", subtitle: p.name, kind: .draft)
            startRun(s, args: ["deploy", "--project", p.key], successTitle: "Draft Preview е готов") { [weak self] outcome in
                self?.afterDeploy(outcome, session: s, prod: false)
            }
        } else {
            smartDeploy()
        }
    }

    func productionDeploy(confirm: String) {
        guard let p = selected, confirm == "DEPLOY" else { return }
        let s = RunSession(title: "Production Deploy", subtitle: "\(p.name) · пълна проверка → LIVE", kind: .production)
        startRun(s, args: ["smart", "--project", p.key, "--prod", "--confirm", "DEPLOY"], successTitle: "LIVE 🚀") { [weak self] outcome in
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
            let session = RunSession(title: "Local Preview", subtitle: p.name, kind: .local)
            let outcome = try? await engine.run(["local", "start", "--project", p.key, "--mode", mode]) { [weak session] ev in
                session?.handle(ev)
            }
            if let outcome, outcome.ok, let st = try? outcome.decode(LocalState.self) {
                if let u = st.url.flatMap(URL.init(string:)) { NSWorkspace.shared.open(u) }
                flash("Local: \(st.url ?? "")")
            } else {
                let msg = outcome?.errorMessage ?? "Local Preview не стартира"
                if run == nil || run?.finished == true {
                    session.finish(success: false, title: "Local Preview не стартира", message: msg)
                    run = session
                } else {
                    flash(msg, error: true)
                }
            }
            await refreshStatus(quiet: true)
        }
    }

    func localStop() {
        guard let p = selected else { return }
        busy.insert("local")
        Task {
            defer { busy.remove("local") }
            _ = try? await engine.run(["local", "stop", "--project", p.key])
            flash("Local Preview е спрян")
            await refreshStatus(quiet: true)
        }
    }

    func localRestart() {
        guard let p = selected else { return }
        busy.insert("local")
        Task {
            defer { busy.remove("local") }
            let outcome = try? await engine.run(["local", "restart", "--project", p.key])
            if outcome?.ok == true { flash("Рестартиран") } else { flash(outcome?.errorMessage ?? "Грешка", error: true) }
            await refreshStatus(quiet: true)
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
        let s = RunSession(title: push ? "Commit & Push" : "Commit", subtitle: p.name, kind: .git)
        startRun(s, args: args, successTitle: push ? "Качено в GitHub" : "Commit е направен")
    }

    func push() {
        guard let p = selected else { return }
        let s = RunSession(title: "Push", subtitle: p.name, kind: .git)
        startRun(s, args: ["git", "push", "--project", p.key], successTitle: "Качено в GitHub")
    }

    func fetch() {
        guard let p = selected else { return }
        busy.insert("fetch")
        Task {
            defer { busy.remove("fetch") }
            _ = try? await engine.run(["git", "fetch", "--project", p.key])
            await refreshStatus(quiet: true)
        }
    }

    func setRemote(_ url: String) {
        guard let p = selected else { return }
        Task {
            let outcome = try? await engine.run(["git", "remote", "--project", p.key, "--url", url])
            if outcome?.ok == true { flash("Remote е зададен") } else { flash(outcome?.errorMessage ?? "Грешка", error: true) }
            await refreshStatus(quiet: true)
        }
    }

    // MARK: - Netlify

    func netlifyLogin(then: (@MainActor () -> Void)? = nil) {
        let s = RunSession(title: "Вход в Netlify", subtitle: "Потвърди входа в браузъра", kind: .netlify)
        startRun(s, args: ["netlify", "login"], successTitle: "Влязъл си в Netlify") { _ in then?() }
    }

    func netlifyLink(siteId: String) {
        guard let p = selected else { return }
        let s = RunSession(title: "Свързване с Netlify", subtitle: p.name, kind: .netlify)
        startRun(s, args: ["netlify", "link", "--project", p.key, "--id", siteId], successTitle: "Netlify е свързан")
    }

    func netlifyCreate(name: String, team: String?) {
        guard let p = selected else { return }
        var args = ["netlify", "create", "--project", p.key, "--name", name]
        if let team, !team.isEmpty { args += ["--team", team] }
        let s = RunSession(title: "Нов Netlify сайт", subtitle: "\(name).netlify.app", kind: .netlify)
        startRun(s, args: args, successTitle: "Сайтът е създаден и свързан")
    }

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
        guard let p = selected else { return }
        pendingFix = nil
        let s = RunSession(title: fix.title, subtitle: p.name, kind: .fix)
        startRun(s, args: ["fix", "apply", fix.id, "--project", p.key, "--yes"], successTitle: "Готово")
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
        flash("Не намерих \(names.first ?? "приложението")", error: true)
    }

    func copy(_ text: String?) {
        guard let text else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        flash("Копирано")
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
            flash("Бюджетът е запазен")
            await loadCosts()
        }
    }

    func setupAction(_ item: SetupItem) {
        guard let a = item.action else { return }
        switch a.type {
        case "run":
            let s = RunSession(title: "Инсталирам \(item.title)", subtitle: a.display ?? "", kind: .fix)
            startRun(s, args: ["setup", "run", item.id, "--yes"], successTitle: "\(item.title) е готов") { [weak self] _ in
                Task { await self?.loadSetup() }
            }
        case "terminal":
            Task {
                do {
                    let r = try await engine.call(["setup", "terminal", item.id], as: CommandFileResult.self)
                    openCommand(r.commandFile)
                    flash("Довърши в Terminal, после натисни „Обнови“")
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
        let s = RunSession(title: "Автоматична настройка", subtitle: "Инсталира всичко липсващо, после отваря Terminal за входовете", kind: .fix)
        startRun(s, args: ["setup", "auto", "--yes"], successTitle: "Настройката приключи") { [weak self] outcome in
            guard let self else { return }
            if let r = try? outcome.decode(SetupAutoResult.self) {
                self.setup = r.status
                if let f = r.commandFile {
                    s.outcomeMessage = "Остава вход в някои акаунти — отворих Terminal."
                    self.openCommand(f)
                } else if r.status.ready {
                    s.outcomeMessage = "Всичко задължително е настроено ✓"
                }
            }
            if self.setup?.items.contains(where: { !$0.ok && $0.action?.appAction == "netlify-login" }) == true {
                s.outcomeMessage = (s.outcomeMessage ?? "") + " Влез и в Netlify от картата му."
            }
        }
    }

    func openCommand(_ path: String) {
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    // MARK: - Account

    var mustAuthenticate: Bool {
        guard accountChecked, let a = account else { return false }
        if a.loggedIn { return false }
        return !offlineMode
    }

    func loadAccount() async {
        account = try? await engine.call(["account", "status"], as: AccountState.self)
        accountChecked = true
    }

    /// Returns an error message, or nil on success.
    func signup(email: String, password: String, name: String) async -> String? {
        do {
            let r = try await engine.call(["account", "signup", "--email", email, "--name", name], as: AccountState.self,
                                          env: ["BID_PASSWORD": password])
            if r.confirmEmail == true { return "CONFIRM" }
            account = r
            await afterLogin()
            return nil
        } catch { return error.localizedDescription }
    }

    func login(email: String, password: String) async -> String? {
        do {
            account = try await engine.call(["account", "login", "--email", email], as: AccountState.self,
                                            env: ["BID_PASSWORD": password])
            await afterLogin()
            return nil
        } catch { return error.localizedDescription }
    }

    func recover(email: String) async -> String? {
        do {
            _ = try await engine.call(["account", "recover", "--email", email], as: [String: Bool].self)
            return nil
        } catch { return error.localizedDescription }
    }

    func oauth(_ provider: String) {
        Task {
            do {
                let r = try await engine.call(["account", "oauth", "--provider", provider], as: OAuthStart.self)
                open(r.url)
            } catch { show(error) }
        }
    }

    func completeOAuth(_ url: URL) async {
        let fragment = url.fragment ?? URLComponents(url: url, resolvingAgainstBaseURL: false)?.query ?? ""
        var params: [String: String] = [:]
        for pair in fragment.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 { params[kv[0]] = kv[1].removingPercentEncoding ?? kv[1] }
        }
        guard let access = params["access_token"] else {
            flash(params["error_description"]?.replacingOccurrences(of: "+", with: " ") ?? "Входът беше отказан", error: true)
            return
        }
        do {
            account = try await engine.call(["account", "session"], as: AccountState.self,
                                            env: ["BID_ACCESS": access, "BID_REFRESH": params["refresh_token"] ?? ""])
            NSApp.activate(ignoringOtherApps: true)
            await afterLogin()
        } catch { show(error) }
    }

    private func afterLogin() async {
        offlineMode = false
        flash("Здравей, \(account?.name ?? account?.email ?? "")!")
        if !started { await start() }
        Task { _ = try? await engine.run(["account", "sync"]) }
    }

    func logout() {
        Task {
            _ = try? await engine.run(["account", "logout"])
            offlineMode = false
            await loadAccount()
        }
    }

    func syncNow() {
        Task {
            let o = try? await engine.run(["account", "sync"])
            if o?.ok == true { flash("Синхронизирано") } else { flash(o?.errorMessage ?? "Синхронизацията не успя", error: true) }
        }
    }

    func configureCloud(url: String, key: String) async -> String? {
        do {
            _ = try await engine.call(["cloud", "config", "--url", url, "--anon-key", key], as: [String: Bool].self)
            await loadAccount()
            return nil
        } catch { return error.localizedDescription }
    }

    static let cloudSchema = #"""
-- Before I Deploy — Supabase schema (run once in Supabase → SQL Editor)
-- Only project METADATA is stored. Service tokens (Netlify, Vercel, GitHub…) never leave the user's Mac.

create table if not exists public.bid_projects (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  key         text        not null,
  name        text        not null,
  framework   text,
  hosting     text,
  live_url    text,
  domain      text,
  last_status text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.bid_projects enable row level security;

-- Every user sees and edits only their own rows.
drop policy if exists "own rows" on public.bid_projects;
create policy "own rows" on public.bid_projects
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
"""#

    func copyCloudSchema() {
        copy(Self.cloudSchema)
    }

    func continueOffline() {
        offlineMode = true
        Task { if !started { await start() } }
    }

    // MARK: - Hosting

    func loadAdvice() async {
        guard let p = selected else { return }
        advice = try? await engine.call(["hosting", "advise", "--project", p.key], as: HostingAdvice.self)
    }

    func setHosting(_ id: String) {
        guard let p = selected else { return }
        Task {
            let o = try? await engine.run(["hosting", "set", "--project", p.key, "--provider", id])
            if o?.ok == true { flash("Хостинг: \(advice?.providers.first { $0.id == id }?.name ?? id)") }
            await loadAdvice()
            await refreshStatus(quiet: true)
            await loadSetup()
        }
    }

    // MARK: - Spaceship

    func loadSpaceship(refresh: Bool = false) async {
        loadingSpaceship = true
        defer { loadingSpaceship = false }
        var args = ["spaceship", "status"]
        if refresh { args.append("--refresh") }
        do { spaceship = try await engine.call(args, as: SpaceshipStatus.self) } catch { show(error) }
    }

    func connectSpaceship(key: String, secret: String) async -> Bool {
        do {
            let outcome = try await engine.run(["spaceship", "connect"],
                                               env: ["BID_SPACESHIP_KEY": key, "BID_SPACESHIP_SECRET": secret])
            guard outcome.ok else {
                flash(outcome.errorMessage ?? "Spaceship отказа ключа", error: true)
                return false
            }
            flash("Spaceship е свързан")
            await loadSpaceship(refresh: true)
            await loadSetup()
            return true
        } catch {
            show(error)
            return false
        }
    }

    func disconnectSpaceship() {
        Task {
            _ = try? await engine.run(["spaceship", "disconnect"])
            spaceship = nil
            await loadSpaceship()
            await loadSetup()
        }
    }

    func dns(_ domain: String) async -> [DnsRecord] {
        (try? await engine.call(["spaceship", "dns", "--domain", domain], as: DnsResult.self))?.records ?? []
    }

    func planDomain(_ domain: String) async throws -> DomainPlan {
        guard let p = selected else { throw EngineError.failed("Избери проект", nil) }
        return try await engine.call(["spaceship", "connect-domain", "--project", p.key, "--domain", domain], as: ConnectDomainResult.self).plan
    }

    func applyDomain(_ domain: String) {
        guard let p = selected else { return }
        let s = RunSession(title: "Свързване на \(domain)", subtitle: "\(p.name) · Spaceship DNS → Netlify", kind: .netlify)
        startRun(s, args: ["spaceship", "connect-domain", "--project", p.key, "--domain", domain, "--yes"], successTitle: "Домейнът е свързан") { _ in
            s.resultURL = "https://\(domain)"
            s.outcomeMessage = "SSL сертификатът се активира автоматично (минути до няколко часа)."
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
                    openCommand(cmd)
                    flash("Отворих \(target == "codex" ? "Codex" : "Claude Code") в папката на проекта")
                } else if let url = r.url, let u = URL(string: url) {
                    NSWorkspace.shared.open(u)
                    flash(r.clipboard ? "Prompt-ът е копиран — постави го с ⌘V" : "Отворих нов чат с готов prompt")
                } else if r.clipboard {
                    flash("Prompt-ът е копиран (\(r.chars ?? r.prompt.count) символа)")
                }
            } catch {
                show(error)
            }
        }
    }

    // MARK: - Feedback

    func flash(_ text: String, error: Bool = false) {
        let t = Toast(text: text, isError: error)
        withAnimation(.spring(response: 0.35)) { toast = t }
        Task {
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            if toast == t { withAnimation(.easeOut(duration: 0.25)) { toast = nil } }
        }
    }

    func show(_ error: Error) {
        if case EngineError.missing = error { engineMissing = true }
        flash(error.localizedDescription, error: true)
    }
}
