import AppKit
import SwiftUI

struct RootView: View {
    @EnvironmentObject var model: AppModel
    @Local private var columns: NavigationSplitViewVisibility = .all
    @AppStorage(Localization.storageKey) private var locale = ""
    @AppStorage(Onboarding.tourSeenKey) private var tourSeen = false

    var body: some View {
        Group {
            if locale.isEmpty {
                WelcomeLanguageView()
            } else if !tourSeen {
                WelcomeTourView()
            } else if model.accountLoadFailed {
                AccountLoadFailedView()
            } else if model.mustAuthenticate {
                if model.account?.configured == true {
                    AuthView()
                } else {
                    CloudSetupView()
                }
            } else {
                mainView
            }
        }
        .settingsNavigation()
        .background(Theme.bg)
        .overlay {
            // below minVersion the app must not be used until it is updated (audit R4)
            if let u = model.update, u.mandatory == true, u.available {
                MandatoryUpdateView(info: u)
            }
        }
        .animation(Motion.quick, value: model.mustAuthenticate)
        .animation(Motion.quick, value: model.accountLoadFailed)
        .animation(Motion.quick, value: tourSeen)
    }

    /// The backdrop's light follows the selected project's state: green when ready, red when blocked.
    var backdropTint: Color {
        guard model.screen == .project, let state = model.status?.check?.status else { return Theme.accent }
        return Theme.color(for: state)
    }

    var mainView: some View {
        NavigationSplitView(columnVisibility: $columns) {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 220, ideal: 248, max: 320)
        } detail: {
            ZStack {
                AuroraBackground(tint: backdropTint)
                if model.engineMissing {
                    EngineMissingView()
                } else if model.nodeMissing {
                    NodeMissingView()
                } else if model.screen == .overview {
                    MissionControlView().screenTransition()
                } else if model.screen == .domains {
                    DomainsView().screenTransition()
                } else if model.screen == .costs {
                    CostsView().screenTransition()
                } else if model.screen == .setup {
                    SetupView().screenTransition()
                } else if model.screen == .assistant {
                    AssistantView().screenTransition()
                } else if model.screen == .usage {
                    PlanUsageView().screenTransition()
                } else if model.screen == .account, model.account?.loggedIn == true {
                    AccountView().screenTransition()
                } else if model.screen == .admin, model.account?.isAdmin == true {
                    ScrollView { AdminView() }
                } else if let status = model.status {
                    DashboardView(status: status)
                        .id(status.project.key)
                        .screenTransition()
                } else if model.projects.isEmpty && model.selectedKey == nil {
                    WelcomeView()
                } else {
                    VStack(spacing: 12) {
                        Spinner(size: 22)
                        Text(L("root.loadingProject")).foregroundColor(Theme.secondary).font(Typo.font(.body))
                    }
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) { CreditNudgeBanner(store: model.billingStore) }
            .animation(Motion.spring, value: model.screen)
            .animation(Motion.spring, value: model.selectedKey)
        }
        .navigationSplitViewStyle(.balanced)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Group {
                IconButton(symbol: "plus", help: L("common.addProject")) { model.addProjectPanel() }
                IconButton(symbol: "sparkles.rectangle.stack", help: L("newsite.button")) { model.sheet = .newSite }.help(L("newsite.buttonHelp"))
                IconButton(symbol: "magnifyingglass", help: L("sidebar.search")) { model.showPalette = true }
                }.disabled(model.run != nil || model.aiStore.current != nil || model.showPalette)
            }
        }
        .background(Theme.bg)
        .accessibilityHidden(model.run != nil || model.aiStore.current != nil || model.showPalette)
        .overlay {
            if let run = model.run {
                RunOverlay(session: run)
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .overlay {
            if let ai = model.aiStore.current {
                AIFixOverlay(state: ai)
                    .transition(.opacity)
            }
        }
        .overlay {
            if model.showPalette {
                CommandPalette()
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                ToastView(toast: toast)
                    .padding(.bottom, 22)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .sheet(item: $model.sheet) { kind in
            Group {
                switch kind {
                case .production, .release: ReleaseSheet()
                case .rollback: RollbackSheet()
                case .client: ClientSheet()
                case .netlifySetup: NetlifySetupSheet()
                case .commit: CommitSheet()
                case .history: HistorySheet()
                case .settings: SettingsView()
                case .remote: RemoteSheet()
                case .spaceshipConnect: SpaceshipConnectSheet()
                case .connectDomain: ConnectDomainSheet()
                case .deleteAccount: DeleteAccountSheet()
                case .plans: PlansSheet()
                case .aiKeys: AIKeysSheet()
                case .newSite: SiteChatSheet()
                case .siteEdit: SiteEditSheet()
                case .pushover: PushoverSheet()
                case .gitIdentity: GitIdentitySheet()
                }
            }
            .environmentObject(model)

            .tint(Theme.accent)
        }
        .sheet(item: $model.pendingFix) { pending in
            FixConfirmSheet(fix: pending.fix)
                .environmentObject(model)

        }
        .animation(Motion.spring, value: model.run?.id)
        .animation(Motion.quick, value: model.status?.project.key)

    }
}

struct ToastView: View {
    @EnvironmentObject var model: AppModel
    let toast: Toast
    @Local private var copied = false
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: toast.isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                .foregroundColor(toast.isError ? Theme.blocked : Theme.ready)
            Text(toast.text)
                .font(Typo.font(.body, weight: .medium))
                .foregroundColor(Theme.text)
                .lineLimit(toast.isError ? nil : 3)
                .textSelection(.enabled)
            if let code = toast.code {
                Text(code)
                    .font(Typo.font(.caption, design: .monospaced))
                    .foregroundColor(Theme.secondary)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(RoundedRectangle(cornerRadius: Radius.xs, style: .continuous).fill(Theme.panel))
                    .help(L("toast.codeHelp"))
                Button {
                    let pb = NSPasteboard.general
                    pb.clearContents()
                    pb.setString("\(toast.text) [\(code)]", forType: .string)
                    copied = true
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc").font(Typo.font(.callout, weight: .medium)).foregroundColor(Theme.secondary)
                }
                .buttonStyle(.plain)
                .help(L("toast.copy"))
                .accessibilityLabel(copied ? L("common.copied") : L("toast.copy"))
                if let url = toast.helpURL {
                    Button { NSWorkspace.shared.open(url) } label: {
                        Image(systemName: "questionmark.circle").font(Typo.font(.callout, weight: .medium)).foregroundColor(Theme.accent)
                    }
                    .buttonStyle(.plain)
                    .help(L("toast.help"))
                    .accessibilityLabel(L("toast.help"))
                }
            }
            Button { model.dismissToast() } label: {
                Image(systemName: "xmark").font(Typo.font(.micro, weight: .bold)).foregroundColor(Theme.tertiary)
            }
            .buttonStyle(.plain)
            .help(L("common.close"))
            .accessibilityLabel(L("common.close"))
            // no Esc here: Esc belongs to the sheet or run window on top, the toast fades by itself (audit A13)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background(Capsule().fill(Theme.elevated))
        .overlay(Capsule().strokeBorder(toast.isError ? Theme.blocked.opacity(0.35) : Theme.hairline, lineWidth: 1))
        .elevation(.popover)
        .frame(maxWidth: 640)
        .onHover { model.toastCenter.hover($0) }
        .onChange(of: toast.id) { _ in copied = false }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(toast.code.map { "\(toast.text) (\($0))" } ?? toast.text)
    }
}

struct WelcomeView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        VStack(spacing: 18) {
            AppGlyph(size: 84)
            Text("Before I Deploy")
                .font(Typo.font(.display, weight: .bold))
                .foregroundColor(Theme.text)
            Text(L("root.emptyHint"))
                .multilineTextAlignment(.center)
                .font(Typo.font(.subhead))
                .foregroundColor(Theme.secondary)
            HStack(spacing: 10) {
                Button {
                    model.addProjectPanel()
                } label: {
                    Label(L("common.addProject"), systemImage: "plus")
                }
                .bidButton(.primary)
                Button {
                    model.createDemoProject()
                } label: {
                    Label(L("demo.try"), systemImage: "wand.and.stars")
                }
                .bidButton(.secondary)
                .disabled(model.busy.contains("demo"))
                .help(L("demo.tryHelp"))
            }
            .padding(.top, 6)
            FirstStepsCard()
                .padding(.top, 18)
        }
        .padding(40)
    }
}

struct EngineMissingView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "shippingbox")
                .font(Typo.font(.display))
                .foregroundColor(Theme.accent)
            Text(L("root.engineMissing"))
                .font(Typo.font(.title, weight: .bold))
                .foregroundColor(Theme.text)
            Text(L("root.engineMissingHint"))
                .multilineTextAlignment(.center)
                .foregroundColor(Theme.secondary)
            Text(model.engine.enginePath)
                .font(Typo.font(.callout, design: .monospaced))
                .foregroundColor(Theme.tertiary)
                .textSelection(.enabled)
            if let why = model.lastError, !why.isEmpty {
                Text(why)
                    .font(Typo.font(.callout, design: .monospaced))
                    .foregroundColor(Theme.warn)
                    .textSelection(.enabled)
                    .frame(maxWidth: 560)
            }
            Button(L("common.retry")) { Task { await model.start() } }
                .bidButton(.secondary)
        }
        .padding(40)
    }
}

/// The first `account status` failed (engine not answering, broken install): said plainly, with Retry and
/// offline mode — never a silent anonymous session (WP02, audit A2).
struct AccountLoadFailedView: View {
    @EnvironmentObject var model: AppModel
    @Local private var retrying = false
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "person.crop.circle.badge.exclamationmark")
                .font(Typo.font(.display))
                .foregroundColor(Theme.warn)
            Text(L("account.loadFailed.title"))
                .font(Typo.font(.title, weight: .bold))
                .foregroundColor(Theme.text)
            Text(L("account.loadFailed.body"))
                .multilineTextAlignment(.center)
                .foregroundColor(Theme.secondary)
                .frame(maxWidth: 460)
            if let e = model.accountError {
                Text(e)
                    .font(Typo.font(.callout, design: .monospaced))
                    .foregroundColor(Theme.tertiary)
                    .textSelection(.enabled)
                    .frame(maxWidth: 520)
            }
            HStack(spacing: 10) {
                Button {
                    retrying = true
                    Task {
                        await model.loadAccount()
                        retrying = false
                    }
                } label: {
                    if retrying { Spinner(size: 12, color: .white) } else { Text(L("common.retry")) }
                }
                .bidButton(.primary)
                .disabled(retrying)
                Button(L("auth.continueOffline")) { model.offlineMode = true }
                    .bidButton(.secondary)
            }
        }
        .padding(40)
    }
}

/// A screen whose first load failed: the reason and Retry instead of an endless placeholder (WP02, audit A1).
struct LoadFailedView: View {
    let message: String
    let retry: () async -> Void
    @Local private var retrying = false
    var body: some View {
        Group {
            if retrying { LoadingState() }
            else { ErrorState(message: message, retry: {
                retrying = true
                Task { await retry(); retrying = false }
            }) }
        }.frame(maxWidth: .infinity, minHeight: 200)
    }
}

/// Full-window notice when this version is below the feed's minVersion: only Download is offered.
struct MandatoryUpdateView: View {
    @EnvironmentObject var model: AppModel
    let info: UpdateInfo
    var body: some View {
        ZStack {
            Theme.bg.opacity(0.94).ignoresSafeArea()
            VStack(spacing: 14) {
                Image(systemName: "arrow.down.circle.fill")
                    .font(Typo.font(.display))
                    .foregroundColor(Theme.accent)
                Text(L("update.required.title"))
                    .font(Typo.font(.title, weight: .bold))
                    .foregroundColor(Theme.text)
                Text(L("update.required.body", info.latest ?? ""))
                    .multilineTextAlignment(.center)
                    .foregroundColor(Theme.secondary)
                    .frame(maxWidth: 440)
                if let n = info.notes?[Localization.current] ?? info.notes?["en"] {
                    Text(n).font(Typo.font(.callout)).foregroundColor(Theme.tertiary).frame(maxWidth: 440)
                }
                Button(L("update.download")) { model.downloadUpdate() }
                    .bidButton(.primary)
                    .disabled(model.busy.contains("update"))
            }
            .padding(40)
        }
    }
}

/// Node.js is missing or too old: where to get it, the Homebrew command, and a re-check (audit B4).
struct NodeMissingView: View {
    @EnvironmentObject var model: AppModel
    /// A shell command, the same in every language.
    private let brewCommand = "brew install node"
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "cube.transparent")
                .font(Typo.font(.display))
                .foregroundColor(Theme.accent)
            Text(L("node.missing.title"))
                .font(Typo.font(.title, weight: .bold))
                .foregroundColor(Theme.text)
            Text(L("node.missing.body"))
                .multilineTextAlignment(.center)
                .foregroundColor(Theme.secondary)
                .frame(maxWidth: 460)
            HStack(spacing: 8) {
                Text(brewCommand)
                    .font(Typo.font(.body, design: .monospaced))
                    .foregroundColor(Theme.text)
                    .textSelection(.enabled)
                Button { model.copy(brewCommand) } label: { Image(systemName: "doc.on.doc") }
                    .buttonStyle(.plain)
                    .foregroundColor(Theme.secondary)
                    .help(L("common.copy"))
                    .accessibilityLabel(L("common.copy"))
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.panel))
            HStack(spacing: 10) {
                Button(L("node.missing.download")) {
                    if let u = URL(string: "https://nodejs.org/en/download") { NSWorkspace.shared.open(u) }
                }
                .bidButton(.primary)
                Button(L("node.missing.recheck")) { Task { await model.start() } }
                    .bidButton(.secondary)
            }
            .padding(.top, 4)
        }
        .padding(40)
    }
}
