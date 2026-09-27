import SwiftUI

struct RootView: View {
    @EnvironmentObject var model: AppModel
    @AppStorage(Localization.storageKey) private var locale = ""

    var body: some View {
        Group {
            if locale.isEmpty {
                WelcomeLanguageView()
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
        .animation(.easeInOut(duration: 0.25), value: model.mustAuthenticate)
    }

    var mainView: some View {
        HStack(spacing: 0) {
            SidebarView()
                .frame(width: 248)
            Rectangle().fill(Theme.hairline).frame(width: 1)
            ZStack {
                Theme.bg
                RadialGradient(colors: [Theme.accent.opacity(0.06), .clear], center: .topTrailing, startRadius: 0, endRadius: 700)
                    .allowsHitTesting(false)
                if model.engineMissing {
                    EngineMissingView()
                } else if model.screen == .overview {
                    MissionControlView()
                } else if model.screen == .domains {
                    DomainsView()
                } else if model.screen == .costs {
                    CostsView()
                } else if model.screen == .setup {
                    SetupView()
                } else if model.screen == .admin, model.account?.isAdmin == true {
                    ScrollView { AdminView() }
                } else if let status = model.status {
                    DashboardView(status: status)
                        .id(status.project.key)
                        .transition(.opacity)
                } else if model.projects.isEmpty && model.selectedKey == nil {
                    WelcomeView()
                } else {
                    VStack(spacing: 12) {
                        Spinner(size: 22)
                        Text(L("root.loadingProject")).foregroundColor(Theme.secondary).font(.system(size: 13))
                    }
                }
            }
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
                case .production: ProductionSheet()
                case .netlifySetup: NetlifySetupSheet()
                case .commit: CommitSheet()
                case .history: HistorySheet()
                case .settings: SettingsSheet()
                case .remote: RemoteSheet()
                case .spaceshipConnect: SpaceshipConnectSheet()
                case .connectDomain: ConnectDomainSheet()
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
    let toast: Toast
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: toast.isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                .foregroundColor(toast.isError ? Theme.blocked : Theme.ready)
            Text(toast.text)
                .font(.system(size: 12.5, weight: .medium))
                .foregroundColor(Theme.text)
                .lineLimit(3)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background(Capsule().fill(Theme.elevated))
        .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
        .shadow(color: .black.opacity(0.35), radius: 16, y: 6)
        .frame(maxWidth: 560)
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
            Button {
                model.addProjectPanel()
            } label: {
                Label(L("common.addProject"), systemImage: "plus")
            }
            .bidButton(.primary)
            .padding(.top, 6)
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
