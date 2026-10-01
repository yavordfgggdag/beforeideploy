import SwiftUI

enum ProjectTab: String, CaseIterable, Hashable {
    case overview, local, git, hosting, history

    var title: String {
        switch self {
        case .overview: return L("dashboard.tab.overview")
        case .local: return L("dashboard.tab.local")
        case .git: return "GitHub"
        case .hosting: return L("dashboard.tab.hosting")
        case .history: return L("common.history")
        }
    }

    var icon: String {
        switch self {
        case .overview: return "gauge.medium"
        case .local: return "desktopcomputer"
        case .git: return "arrow.triangle.branch"
        case .hosting: return "globe"
        case .history: return "clock.arrow.circlepath"
        }
    }
}

struct DashboardView: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus
    @Local private var tab: ProjectTab = .overview

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HeaderView(status: status)
                if let setup = model.setup, setup.missingRequired > 0 {
                    SetupBanner(missing: setup.missingRequired)
                }
                TabStrip(selection: $tab, badges: badges)

                switch tab {
                case .overview:
                    if let launch = status.launch, !launch.complete {
                        LaunchCard(launch: launch, tab: $tab).entrance(0, offset: 10)
                    }
                    HeroCard(status: status)
                    IssuesCard(status: status)
                    HealthGrid(status: status)
                    // safe fixes no issue points at (e.g. "create a GitHub repository") keep their own card
                    if !extraFixes.isEmpty {
                        FixesCard(fixes: extraFixes)
                    }
                    HStack(alignment: .top, spacing: 14) {
                        MiniStat(title: L("dashboard.localTitle"), value: status.local.running ? Fmt.host(status.local.url) : L("dashboard.stopped"),
                                 tint: status.local.running ? Theme.ready : Theme.tertiary, icon: "desktopcomputer") { tab = .local }
                        MiniStat(title: "GitHub", value: status.git.isRepo ? L("dashboard.changes", count: status.git.changedCount ?? 0) : L("dashboard.noRepo"),
                                 tint: (status.git.changedCount ?? 0) > 0 ? Theme.warn : Theme.text, icon: "arrow.triangle.branch") { tab = .git }
                        MiniStat(title: "Live · \(status.hosting?.name ?? "Netlify")",
                                 value: (status.hosting?.liveUrl ?? status.project.netlify?.liveUrl).map { Fmt.host($0) } ?? (status.hosting?.ready == true ? L("common.connectedLower") : L("common.notConnectedLower")),
                                 tint: status.hosting?.ready == true ? Theme.text : Theme.tertiary, icon: "globe") { tab = .hosting }
                    }
                case .local:
                    LocalCard(status: status)
                case .git:
                    GitCard(status: status)
                case .hosting:
                    HostingChooserCard()
                    if (status.hosting?.provider ?? "netlify") == "netlify" {
                        NetlifyCard(status: status)
                    } else {
                        GenericHostingCard(status: status)
                    }
                    if status.hosting?.ready == true {
                        DeploymentsCard(status: status)
                    }
                    DomainProjectCard(status: status)
                    BackupCard(backup: status.backup)
                case .history:
                    HistoryStrip()
                }
            }
            .padding(.horizontal, Space.page)
            .padding(.top, Space.top)
            .padding(.bottom, Space.page)
            .frame(maxWidth: 1120)
            .frame(maxWidth: .infinity)
        }
    }

    var extraFixes: [FixItem] {
        let referenced = Set((status.issues?.issues ?? []).compactMap { $0.fix?.type == "safe" ? $0.fix?.id : nil })
        return status.fixes.filter { $0.id != "netlify.link" && !referenced.contains($0.id) }
    }

    var badges: [ProjectTab: String] {
        var b: [ProjectTab: String] = [:]
        let issues = status.issues?.counts.total ?? ((status.check?.counts?.fail ?? 0) + (status.check?.counts?.warn ?? 0))
        if issues > 0 { b[.overview] = "\(issues)" }
        if status.local.running { b[.local] = "●" }
        if let c = status.git.changedCount, c > 0 { b[.git] = "\(c)" }
        return b
    }
}

struct TabStrip: View {
    @Binding var selection: ProjectTab
    var badges: [ProjectTab: String] = [:]
    @Namespace private var pill

    var body: some View {
        Segmented(options: ProjectTab.allCases.map { ($0.title, $0) }, selection: $selection,
                  icons: Dictionary(uniqueKeysWithValues: ProjectTab.allCases.map { ($0, $0.icon) }), badges: badges)
    }
}

struct MiniStat: View {
    let title: String
    let value: String
    var tint: Color = Theme.text
    let icon: String
    var action: () -> Void
    @Local private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(Theme.accent).frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title.uppercased()).font(Typo.font(.micro, weight: .bold)).tracking(0.8).foregroundColor(Theme.tertiary)
                    Text(value).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(tint).lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right").font(Typo.font(.micro, weight: .bold)).foregroundColor(Theme.tertiary)
            }
            .padding(14)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(hover ? Theme.elevated : Theme.panel))
            .overlay(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .lift(radius: 13, amount: 1.02)
        .onHover { hover = $0 }
    }
}

// MARK: - Header

struct HeaderView: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text(status.project.name)
                    .font(Typo.font(.display, weight: .bold))
                    .foregroundColor(Theme.text)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if status.git.isRepo, let b = status.git.branch {
                        Chip(text: b, icon: "arrow.triangle.branch")
                    }
                    if let pm = status.detect.packageManager { Chip(text: pm, icon: "shippingbox") }
                    if let fw = status.detect.framework, fw != "unknown" { Chip(text: fw, icon: "square.stack.3d.up") }
                    if let dir = status.detect.publishDir, status.detect.ssr != true {
                        Chip(text: dir + "/", icon: "folder", tint: status.detect.publishReady == true ? Theme.secondary : Theme.tertiary)
                    }
                    if status.detect.netlifyLinked == true {
                        Chip(text: status.project.netlify?.siteName ?? "Netlify", icon: "globe", tint: Theme.ready)
                    }
                }
                Text(status.project.path)
                    .font(Typo.font(.caption, design: .monospaced))
                    .foregroundColor(Theme.tertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
            Spacer()
            HStack(spacing: 8) {
                IconButton(symbol: "folder", help: L("common.showInFinder")) { model.revealInFinder(status.project.path) }
                IconButton(symbol: "chevron.left.forwardslash.chevron.right", help: L("dashboard.openInEditor")) {
                    model.openIn(app: ["Cursor", "Visual Studio Code"], path: status.project.path)
                }
                IconButton(symbol: "terminal", help: L("common.openInTerminal")) { model.openIn(app: ["Terminal"], path: status.project.path) }
                if model.loadingStatus {
                    Spinner(size: 14).frame(width: 30, height: 30)
                } else {
                    IconButton(symbol: "arrow.clockwise", help: L("dashboard.refreshShortcut")) { Task { await model.refreshStatus() } }
                }
            }
        }
    }
}

// MARK: - Hero

struct HeroCard: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus
    @Local private var celebrate = false

    var state: String { status.check?.status ?? "unknown" }

    var title: String {
        switch state {
        case "ready": return L("status.readyToDeploy")
        case "warnings": return L("status.readyWithWarnings")
        case "blocked": return L("status.deployBlocked")
        default: return L("dashboard.notChecked")
        }
    }

    /// Share of steps that passed (skipped steps do not count), drawn as the ring around the status symbol.
    var passFraction: Double {
        guard let steps = status.check?.steps else { return 0 }
        let counted = steps.filter { $0.status != "skipped" }
        guard !counted.isEmpty else { return 0 }
        return Double(counted.filter { $0.status == "pass" || $0.status == "info" }.count) / Double(counted.count)
    }

    var stale: Bool {
        guard let d = Fmt.date(status.check?.at) else { return true }
        return Date().timeIntervalSince(d) > 30 * 60
    }

    var body: some View {
        let tint = state == "unknown" ? Theme.idle : Theme.color(for: state)
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center, spacing: 16) {
                StatusRing(fraction: passFraction, tint: tint,
                           symbol: state == "unknown" ? "questionmark" : Theme.symbol(for: state))
                    .breath(tint, strong: state == "blocked")
                    .accessibilityLabel(title)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(Typo.font(.title, weight: .heavy))
                        .tracking(0.6)
                        .foregroundColor(Theme.text)
                    HStack(spacing: 6) {
                        if let c = status.check {
                            Text(L("dashboard.checkedAgo", Fmt.relative(c.at)))
                            if stale { Text(L("dashboard.stale")).foregroundColor(Theme.warn) }
                            if let d = c.duration { Text("· \(Fmt.duration(d))") }
                        } else {
                            Text(L("dashboard.runCheckHint"))
                        }
                        if let reason = model.autoCheckPaused[status.project.key] {
                            Label(reason, systemImage: "pause.circle").foregroundColor(Theme.warn)
                            Button(L("common.check")) { model.runCheck() }.buttonStyle(.link)
                        }
                        if model.autoChecking {
                            Spinner(size: 10)
                            Text(L("autocheck.running")).foregroundColor(Theme.accent)
                        }
                    }
                    .font(Typo.font(.callout))
                    .foregroundColor(Theme.secondary)
                }
                Spacer()
                if let c = status.check?.counts {
                    HStack(spacing: 6) {
                        CountPill(value: c.pass, symbol: "checkmark", tint: Theme.ready)
                        CountPill(value: c.info, symbol: "info", tint: Theme.info)
                        CountPill(value: c.warn, symbol: "exclamationmark", tint: Theme.warn)
                        CountPill(value: c.fail, symbol: "xmark", tint: Theme.blocked)
                    }
                }
            }

            if let steps = status.check?.steps {
                HealthBar(steps: steps)
                let issues = steps.filter { $0.status == "fail" || $0.status == "warn" }
                if !issues.isEmpty {
                    let hasFail = issues.contains { $0.status == "fail" }
                    HStack(alignment: .center, spacing: 12) {
                        Image(systemName: hasFail ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                            .font(Typo.font(.headline)).foregroundColor(hasFail ? Theme.blocked : Theme.warn)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(issues.map { $0.label ?? $0.id }.joined(separator: " · "))
                                .font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text).lineLimit(1)
                            Text(issues.count == 1 ? (issues[0].summary ?? "") : L("dashboard.issuesOnePrompt", issues.count))
                                .font(Typo.font(.callout)).foregroundColor(Theme.secondary).lineLimit(1)
                        }
                        Spacer()
                        AIFixBar(step: issues.count == 1 ? issues[0].id : "all", compact: true)
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill((hasFail ? Theme.blocked : Theme.warn).opacity(0.08)))
                }
            }

            HStack(spacing: 10) {
                Button {
                    model.runCheck()
                } label: {
                    Label(L("common.check"), systemImage: "arrow.triangle.2.circlepath")
                }
                .bidButton(.secondary)
                .help("⌘R — Git, secrets, lint, typecheck, build")

                Button {
                    model.smartDeploy()
                } label: {
                    Label(L("run.smartDeploy"), systemImage: "bolt.fill")
                }
                .bidButton(.primary)
                .help(L("dashboard.smartHelp"))
                .disabled(status.hosting.map { !$0.ready } ?? (status.detect.netlifyLinked != true))

                Spacer()

                if !(status.hosting?.ready ?? (status.detect.netlifyLinked == true)) {
                    Text(L("dashboard.connectHostingHelp"))
                        .font(Typo.font(.callout))
                        .foregroundColor(Theme.tertiary)
                    Button(L("dashboard.setUpHosting")) {
                        if (status.hosting?.provider ?? "netlify") == "netlify" { model.sheet = .netlifySetup } else { model.screen = .setup }
                    }
                        .bidButton(.secondary)
                } else {
                    Button {
                        model.sheet = .release
                    } label: {
                        Label(L("hosting.productionButton"), systemImage: "paperplane.fill")
                    }
                    .bidButton(.secondary)
                    .disabled(state == "blocked")
                    .help(state == "blocked" ? L("dashboard.fixErrorsFirst") : L("dashboard.productionHelp"))
                }
            }
        }
        .card(padding: 22, tint: state == "unknown" ? nil : tint)
        .glowBorder(tint, strength: state == "blocked" ? 0.7 : 0)
        .overlay { if celebrate { Celebration().frame(maxWidth: .infinity, maxHeight: .infinity) } }
        .onChange(of: status.check?.status) { _ in
            guard state == "ready", !Motion.reduced else { return }
            celebrate = true
            Task { try? await Task.sleep(nanoseconds: 2_000_000_000); celebrate = false }
        }

        .animation(Motion.gentle, value: state)
    }
}

// MARK: - Launch checklist (V11.1)

/// Folder → check → ready for visitors → hosting → live → domain → watching. Shown until the required steps
/// are done; every row offers the same action the rest of the app would.
struct LaunchCard: View {
    @EnvironmentObject var model: AppModel
    let launch: LaunchStatus
    @Binding var tab: ProjectTab
    @Local private var collapsed = false

    private func symbol(_ s: LaunchStatus.Step) -> (String, Color) {
        switch s.status {
        case "done": return ("checkmark.circle.fill", Theme.ready)
        case "attention": return ("exclamationmark.circle.fill", Theme.blocked)
        case "todo": return ("arrow.right.circle.fill", Theme.accent)
        default: return ("circle.dashed", Theme.tertiary)
        }
    }

    private func buttonTitle(_ s: LaunchStatus.Step) -> String? {
        switch s.action {
        case "check": return L("launch.action.check")
        case "fix": return s.id == "site" ? L("launch.action.fixSite") : L("launch.action.fix")
        case "hosting": return L("launch.action.hosting")
        case "deploy": return L("launch.action.deploy")
        case "release": return L("launch.action.release")
        case "domain": return L("launch.action.domain")
        case "monitor": return L("launch.action.monitor")
        default: return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                ZStack {
                    ProgressRing(fraction: Double(launch.requiredDone) / Double(max(1, launch.requiredTotal)), lineWidth: 5)
                    Text("\(launch.requiredDone)/\(launch.requiredTotal)").font(Typo.font(.caption, weight: .bold)).foregroundColor(Theme.text)
                }
                .frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 2) {
                    GradientText(text: L("launch.title"), font: Typo.font(.headline, weight: .bold))
                    Text(launch.next.flatMap { id in launch.steps.first { $0.id == id } }.map { L("launch.nextLine", $0.title) } ?? L("launch.allDone"))
                        .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                }
                Spacer()
                Button { withAnimation(Motion.spring) { collapsed.toggle() } } label: {
                    Image(systemName: collapsed ? "chevron.down" : "chevron.up")
                }
                .bidButton(.ghost, compact: true)
                .help(collapsed ? L("launch.expand") : L("launch.collapse"))
            }
            if !collapsed {
                VStack(spacing: 0) {
                    ForEach(Array(launch.steps.enumerated()), id: \.element.id) { i, s in
                        let (icon, tint) = symbol(s)
                        HStack(alignment: .top, spacing: 12) {
                            VStack(spacing: 0) {
                                Image(systemName: icon).font(Typo.font(.subhead)).foregroundColor(tint)
                                    .breath(tint, strong: s.status == "attention")
                                if i < launch.steps.count - 1 {
                                    Rectangle().fill(s.status == "done" ? Theme.ready.opacity(0.5) : Theme.hairline).frame(width: 2).frame(maxHeight: .infinity)
                                }
                            }
                            .frame(width: 18)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(s.title).font(Typo.font(.body, weight: s.status == "todo" || s.status == "attention" ? .bold : .semibold))
                                        .foregroundColor(s.status == "waiting" ? Theme.tertiary : Theme.text)
                                    if s.optional { Text(L("launch.optional")).font(Typo.font(.micro, weight: .semibold)).foregroundColor(Theme.tertiary).padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(Theme.elevated)) }
                                }
                                Text(s.hint).font(Typo.font(.callout)).foregroundColor(s.status == "waiting" ? Theme.tertiary : Theme.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer()
                            if let title = buttonTitle(s), s.status != "done" && s.status != "waiting" {
                                Button(title) { model.launchAction(s, tab: $tab) }
                                    .bidButton(s.id == launch.next ? .primary : .secondary, compact: true)
                            }
                        }
                        .padding(.vertical, 6)
                        .entrance(i + 1, offset: 8)
                    }
                }
            }
        }
        .card(padding: 18)
        .glowBorder(launch.steps.contains { $0.status == "attention" } ? Theme.blocked : Theme.accent, strength: 0.8)
    }
}

struct CountPill: View {
    let value: Int
    let symbol: String
    let tint: Color
    var body: some View { Badge(text: String(value), icon: symbol, tint: value == 0 ? Theme.secondary : tint) }
}

struct HealthBar: View {
    let steps: [StepResult]
    var body: some View {
        HStack(spacing: 4) {
            ForEach(steps) { s in
                Capsule(style: .continuous)
                    .fill(s.status == "skipped" ? Theme.elevated : Theme.color(for: s.status).opacity(s.status == "info" ? 0.45 : 0.9))
                    .frame(height: 6)
                    .elevation(.popover)
                    .help("\(s.label ?? s.id): \(s.summary ?? s.status)")
                    .accessibilityLabel(s.label ?? s.id)
                    .accessibilityValue(s.summary ?? s.status)
            }
        }
    }
}

// MARK: - Health grid

struct HealthGrid: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus

    static let placeholders: [(String, String)] = [
        ("git", "Git"), ("secrets", "Secrets"), ("deps", L("common.dependencies")), ("lint", "Lint"),
        ("typecheck", "Typecheck"), ("build", "Build"), ("site", L("launch.site.title")), ("hosting", "Hosting"),
    ]

    var body: some View {
        let steps: [StepResult] = status.check?.steps ?? Self.placeholders.map {
            StepResult(id: $0.0, label: $0.1, category: nil, status: "pending", summary: "—")
        }
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: L("dashboard.projectHealth"), icon: "waveform.path.ecg")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 400), spacing: 10)], spacing: 10) {
                ForEach(Array(steps.enumerated()), id: \.element.id) { i, s in
                    HealthTile(step: s).entrance(i, offset: 10)
                }
            }
        }
    }
}

struct HealthTile: View {
    @EnvironmentObject var model: AppModel
    let step: StepResult
    @Local private var showDetails = false
    @Local private var hover = false

    static func icon(_ id: String) -> String {
        switch id {
        case "git": return "arrow.triangle.branch"
        case "secrets": return "lock.shield"
        case "deps": return "shippingbox"
        case "lint": return "text.magnifyingglass"
        case "typecheck": return "curlybraces"
        case "build": return "hammer"
        case "site": return "checkmark.seal"
        case "hosting": return "globe"
        default: return "circle"
        }
    }

    var body: some View {
        let tint = Theme.color(for: step.status)
        Button {
            showDetails.toggle()
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: Self.icon(step.id))
                        .font(Typo.font(.callout, weight: .semibold))
                        .foregroundColor(Theme.secondary)
                    Text(step.label ?? step.id)
                        .font(Typo.font(.body, weight: .semibold))
                        .foregroundColor(Theme.text)
                    Spacer()
                    Image(systemName: Theme.symbol(for: step.status))
                        .font(Typo.font(.callout))
                        .foregroundColor(tint)
                }
                Text(step.summary ?? "—")
                    .font(Typo.font(.callout))
                    .foregroundColor(Theme.secondary)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 74, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: Radius.m, style: .continuous)
                    .fill(hover ? Theme.elevated : Theme.panel)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Radius.m, style: .continuous)
                    .strokeBorder(step.status == "fail" ? Theme.blocked.opacity(0.45) : Theme.hairline, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .lift(radius: 13, tint: Theme.color(for: step.status), amount: 1.02)
        .onHover { hover = $0 }
        .popover(isPresented: $showDetails, arrowEdge: .bottom) {
            StepDetailPopover(step: step)
                .environmentObject(model)
        }
    }
}

struct StepDetailPopover: View {
    @EnvironmentObject var model: AppModel
    let step: StepResult

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: Theme.symbol(for: step.status)).foregroundColor(Theme.color(for: step.status))
                Text(step.label ?? step.id).font(Typo.font(.subhead, weight: .bold))
                Spacer()
                if let d = step.duration, d > 0 { Text(Fmt.duration(d)).foregroundColor(Theme.tertiary).font(Typo.font(.caption)) }
            }
            Text(step.summary ?? "").foregroundColor(Theme.secondary).font(Typo.font(.body))
            if let details = step.details, !details.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(Array(details.enumerated()), id: \.offset) { _, l in
                            Text(l).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.text)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(10)
                }
                .frame(maxHeight: 220)
                .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.bg))
            }
            if step.status == "fail" || step.status == "warn" {
                AIFixBar(step: step.id, compact: true)
            }
            HStack {
                ForEach(step.fixes ?? [], id: \.self) { f in
                    Button(L("common.fix")) { model.requestFix(f) }.bidButton(.primary, compact: true)
                }
                Spacer()
                if let log = step.log {
                    Button(L("common.openLog")) { model.openFile(log) }.bidButton(.secondary, compact: true)
                }
            }
        }
        .padding(16)
        .frame(width: 440)
        .background(Theme.panel)
    }
}

// MARK: - Fixes

struct FixesCard: View {
    @EnvironmentObject var model: AppModel
    let fixes: [FixItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: L("dashboard.safeFixes"), icon: "wand.and.stars")
            ForEach(fixes) { f in
                HStack(spacing: 12) {
                    Image(systemName: f.risk == "caution" ? "exclamationmark.triangle.fill" : "wand.and.stars")
                        .foregroundColor(f.risk == "caution" ? Theme.warn : Theme.accent)
                        .frame(width: 20)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(f.title).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                        Text(f.description).font(Typo.font(.callout)).foregroundColor(Theme.secondary).lineLimit(2)
                    }
                    Spacer()
                    Button(L("dashboard.review")) { model.requestFix(f.id) }
                        .bidButton(.secondary, compact: true)
                }
            }
        }
        .card()
    }
}

// MARK: - History strip

struct HistoryStrip: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionLabel(text: L("common.history"), icon: "clock")
                Spacer()
                Button(L("dashboard.all")) { model.sheet = .history }.bidButton(.ghost, compact: true)
            }
            if model.history.isEmpty {
                Text(L("dashboard.noEvents"))
                    .font(Typo.font(.callout))
                    .foregroundColor(Theme.tertiary)
                    .padding(.vertical, 6)
            } else {
                VStack(spacing: 0) {
                    ForEach(model.history.prefix(8)) { e in
                        HistoryRow(entry: e, showProject: false)
                        if e.id != model.history.prefix(8).last?.id {
                            Rectangle().fill(Theme.hairline).frame(height: 1)
                        }
                    }
                }
            }
        }
        .card()
    }
}

struct HistoryRow: View {
    @EnvironmentObject var model: AppModel
    let entry: HistoryEntry
    var showProject = true
    @Local private var hover = false

    var body: some View {
        HStack(spacing: 12) {
            Text(Fmt.time(entry.ts))
                .font(Typo.font(.callout, design: .monospaced))
                .foregroundColor(Theme.tertiary)
                .frame(width: 78, alignment: .leading)
            Image(systemName: entry.symbol)
                .font(Typo.font(.caption))
                .foregroundColor(entry.status == "ok" ? Theme.ready : Theme.blocked)
                .frame(width: 16)
            Text(entry.title)
                .font(Typo.font(.body, weight: .medium))
                .foregroundColor(Theme.text)
            if showProject, let n = entry.projectName {
                Text(n).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            }
            if let m = entry.message {
                Text(m).font(Typo.font(.callout)).foregroundColor(Theme.tertiary).lineLimit(1)
            }
            Spacer()
            if let d = entry.duration { Text(Fmt.duration(d)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
            if let url = entry.url {
                Button { model.open(url) } label: { Image(systemName: "arrow.up.right.square") }
                    .buttonStyle(.plain).foregroundColor(Theme.secondary).help(url)
            }
            if let log = entry.log {
                Button { model.openFile(log) } label: { Image(systemName: "doc.text") }
                    .buttonStyle(.plain).foregroundColor(Theme.secondary).help(L("common.openLog"))
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 6)
        .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(hover ? Theme.elevated : .clear))
        .onHover { hover = $0 }
    }
}
