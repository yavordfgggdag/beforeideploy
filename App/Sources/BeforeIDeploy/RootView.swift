import AppKit
import SwiftUI

struct RootView: View {
    @EnvironmentObject var model: AppModel
    @AppStorage(Localization.storageKey) private var locale = ""
    @AppStorage(Onboarding.tourSeenKey) private var tourSeen = false

    var body: some View {
        Group {
            if locale.isEmpty {
                WelcomeLanguageView()
            } else if !tourSeen {
                WelcomeTourView()
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
        .background(Theme.bg)
        .ignoresSafeArea()
        .overlay {
            // below minVersion the app must not be used until it is updated (audit R4)
            if let u = model.update, u.mandatory == true, u.available {
                MandatoryUpdateView(info: u)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: model.mustAuthenticate)
        .animation(.easeInOut(duration: 0.25), value: tourSeen)
    }

    /// The backdrop's light follows the selected project's state: green when ready, red when blocked.
    var backdropTint: Color {
        guard model.screen == .project, let state = model.status?.check?.status else { return Theme.accent }
        return Theme.color(for: state)
    }

    var mainView: some View {
        HStack(spacing: 0) {
            SidebarView()
                .frame(width: 248)
            Rectangle().fill(Theme.hairline).frame(width: 1)
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
                        Text(L("root.loadingProject")).foregroundColor(Theme.secondary).font(.system(size: 13))
                    }
                }
            }
            .animation(Motion.spring, value: model.screen)
            .animation(Motion.spring, value: model.selectedKey)
        }
        .background(Theme.bg)
        .ignoresSafeArea()
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
                case .settings: SettingsSheet()
                case .remote: RemoteSheet()
                case .spaceshipConnect: SpaceshipConnectSheet()
                case .connectDomain: ConnectDomainSheet()
                case .deleteAccount: DeleteAccountSheet()
                case .plans: PlansSheet()
                case .aiKeys: AIKeysSheet()
                case .newSite: NewSiteSheet()
                case .pushover: PushoverSheet()
                }
            }
            .environmentObject(model)
            .preferredColorScheme(.dark)
            .tint(Theme.accent)
        }
        .sheet(item: $model.pendingFix) { pending in
            FixConfirmSheet(fix: pending.fix)
                .environmentObject(model)
                .preferredColorScheme(.dark)
        }
        .animation(.spring(response: 0.35), value: model.run?.id)
        .animation(.easeInOut(duration: 0.2), value: model.status?.project.key)
        .animation(.easeInOut(duration: 0.18), value: model.screen)
    }
}

struct ToastView: View {
    @EnvironmentObject var model: AppModel
    let toast: Toast
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: toast.isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                .foregroundColor(toast.isError ? Theme.blocked : Theme.ready)
            Text(toast.text)
                .font(.system(size: 12.5, weight: .medium))
                .foregroundColor(Theme.text)
                .lineLimit(3)
                .textSelection(.enabled)
            if let code = toast.code {
                Text(code)
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundColor(Theme.secondary)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(Theme.panel))
                    .help(L("toast.codeHelp"))
                Button {
                    let pb = NSPasteboard.general
                    pb.clearContents()
                    pb.setString("\(toast.text) [\(code)]", forType: .string)
                    model.flash(L("common.copied"))
                } label: {
                    Image(systemName: "doc.on.doc").font(.system(size: 11.5, weight: .medium)).foregroundColor(Theme.secondary)
                }
                .buttonStyle(.plain)
                .help(L("toast.copy"))
                if let url = toast.helpURL {
                    Button { NSWorkspace.shared.open(url) } label: {
                        Image(systemName: "questionmark.circle").font(.system(size: 12, weight: .medium)).foregroundColor(Theme.accent)
                    }
                    .buttonStyle(.plain)
                    .help(L("toast.help"))
                }
            }
            Button { model.dismissToast() } label: {
                Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundColor(Theme.tertiary)
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
        .shadow(color: .black.opacity(0.35), radius: 16, y: 6)
        .frame(maxWidth: 640)
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
                .font(.system(size: 30, weight: .bold))
                .foregroundColor(Theme.text)
            Text(L("root.emptyHint"))
                .multilineTextAlignment(.center)
                .font(.system(size: 14))
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
                .font(.system(size: 40))
                .foregroundColor(Theme.accent)
            Text(L("root.engineMissing"))
                .font(.system(size: 22, weight: .bold))
                .foregroundColor(Theme.text)
            Text(L("root.engineMissingHint"))
                .multilineTextAlignment(.center)
                .foregroundColor(Theme.secondary)
            Text(model.engine.enginePath)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(Theme.tertiary)
                .textSelection(.enabled)
            Button(L("common.retry")) { Task { await model.start() } }
                .bidButton(.secondary)
        }
        .padding(40)
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
                    .font(.system(size: 44))
                    .foregroundColor(Theme.accent)
                Text(L("update.required.title"))
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(Theme.text)
                Text(L("update.required.body", info.latest ?? ""))
                    .multilineTextAlignment(.center)
                    .foregroundColor(Theme.secondary)
                    .frame(maxWidth: 440)
                if let n = info.notes?[Localization.current] ?? info.notes?["en"] {
                    Text(n).font(.system(size: 12)).foregroundColor(Theme.tertiary).frame(maxWidth: 440)
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
                .font(.system(size: 40))
                .foregroundColor(Theme.accent)
            Text(L("node.missing.title"))
                .font(.system(size: 22, weight: .bold))
                .foregroundColor(Theme.text)
            Text(L("node.missing.body"))
                .multilineTextAlignment(.center)
                .foregroundColor(Theme.secondary)
                .frame(maxWidth: 460)
            HStack(spacing: 8) {
                Text(brewCommand)
                    .font(.system(size: 12.5, design: .monospaced))
                    .foregroundColor(Theme.text)
                    .textSelection(.enabled)
                Button { model.copy(brewCommand) } label: { Image(systemName: "doc.on.doc") }
                    .buttonStyle(.plain)
                    .foregroundColor(Theme.secondary)
                    .help(L("common.copy"))
                    .accessibilityLabel(L("common.copy"))
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.panel))
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

/// The app mark: graphite squircle with an amber launch arc.
struct AppGlyph: View {
    var size: CGFloat = 28
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(Theme.accentGradient)
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            Image(systemName: "paperplane.fill")
                .font(.system(size: size * 0.44, weight: .semibold))
                .foregroundColor(.white)
                .rotationEffect(.degrees(-8))
                .offset(x: -size * 0.02, y: size * 0.02)
        }
        .frame(width: size, height: size)
        .shadow(color: Theme.accent.opacity(0.3), radius: size * 0.2)
    }
}
