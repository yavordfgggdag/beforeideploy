import SwiftUI

// MARK: - Auth (sign up / log in)

struct AuthView: View {
    @EnvironmentObject var model: AppModel
    @Local private var mode = 0 // 0 login, 1 signup, 2 recover
    @Local private var email = ""
    @Local private var password = ""
    @Local private var name = ""
    @Local private var busy = false
    @Local private var error: String?
    @Local private var info: String?

    var body: some View {
        HStack(spacing: 0) {
            BrandPanel()
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 18) {
                Spacer()
                VStack(alignment: .leading, spacing: 6) {
                    Text(mode == 1 ? L("auth.createAccount") : mode == 2 ? L("auth.newPassword") : L("auth.welcomeBack"))
                        .font(.system(size: 28, weight: .bold)).foregroundColor(Theme.text)
                    Text(mode == 1 ? L("auth.signupSubtitle")
                         : mode == 2 ? L("auth.recoverSubtitle")
                         : L("auth.loginSubtitle"))
                        .font(.system(size: 13.5)).foregroundColor(Theme.secondary)
                }

                if mode != 2 {
                    SegmentedControl(options: [(L("auth.signIn"), 0), (L("auth.signUp"), 1)], selection: $mode)
                }

                VStack(spacing: 10) {
                    if mode == 1 {
                        AuthField(icon: "person", placeholder: L("auth.name"), text: $name)
                    }
                    AuthField(icon: "envelope", placeholder: L("auth.email"), text: $email)
                    if mode != 2 {
                        AuthField(icon: "lock", placeholder: mode == 1 ? L("auth.passwordMin") : L("auth.password"), text: $password, secure: true)
                    }
                }

                if let error {
                    Label(error, systemImage: "exclamationmark.circle.fill")
                        .font(.system(size: 12.5)).foregroundColor(Theme.blocked)
                }
                if let info {
                    Label(info, systemImage: "checkmark.circle.fill")
                        .font(.system(size: 12.5)).foregroundColor(Theme.ready)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button(action: submit) {
                    HStack {
                        Spacer()
                        if busy { Spinner(size: 13, color: .white) }
                        Text(mode == 1 ? L("auth.createAccount") : mode == 2 ? L("auth.sendLink") : L("auth.signIn"))
                        Spacer()
                    }
                }
                .bidButton(.primary)
                .keyboardShortcut(.defaultAction)
                .disabled(busy || email.isEmpty || (mode != 2 && password.isEmpty))

                if mode != 2 {
                    HStack(spacing: 10) {
                        Rectangle().fill(Theme.hairline).frame(height: 1)
                        Text(L("auth.or")).font(.system(size: 11.5)).foregroundColor(Theme.tertiary)
                        Rectangle().fill(Theme.hairline).frame(height: 1)
                    }
                    Button { model.oauth("github") } label: {
                        HStack {
                            Spacer()
                            Image(systemName: "chevron.left.forwardslash.chevron.right")
                            Text(L("auth.github"))
                            Spacer()
                        }
                    }
                    .bidButton(.secondary)
                }

                HStack {
                    if mode == 0 {
                        Button(L("auth.forgot")) { withAnimation { mode = 2; error = nil; info = nil } }
                            .buttonStyle(.plain).foregroundColor(Theme.accent).font(.system(size: 12.5))
                    } else if mode == 2 {
                        Button(L("auth.backToLogin")) { withAnimation { mode = 0; error = nil; info = nil } }
                            .buttonStyle(.plain).foregroundColor(Theme.accent).font(.system(size: 12.5))
                    }
                    Spacer()
                    Button(L("auth.continueOffline")) { model.continueOffline() }
                        .buttonStyle(.plain).foregroundColor(Theme.tertiary).font(.system(size: 12))
                }
                Spacer()
                Text(L("auth.privacyNote"))
                    .font(.system(size: 11)).foregroundColor(Theme.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(48)
            .frame(width: 460)
            .frame(maxHeight: .infinity)
            .background(Theme.bg)
        }
        .onChange(of: mode) { _ in error = nil; info = nil }
    }

    func submit() {
        busy = true
        error = nil
        info = nil
        Task {
            let e = email.trimmingCharacters(in: .whitespaces)
            var result: String?
            switch mode {
            case 1:
                result = await model.signup(email: e, password: password, name: name)
                if result == "CONFIRM" {
                    info = L("auth.confirmEmail")
                    mode = 0
                    result = nil
                }
            case 2:
                result = await model.recover(email: e)
                if result == nil { info = L("auth.checkInbox") }
            default:
                result = await model.login(email: e, password: password)
            }
            error = result
            busy = false
        }
    }
}

struct AuthField: View {
    let icon: String
    let placeholder: String
    @Binding var text: String
    var secure = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundColor(Theme.tertiary).frame(width: 18)
            Group {
                if secure {
                    SecureField(placeholder, text: $text)
                } else {
                    TextField(placeholder, text: $text)
                }
            }
            .textFieldStyle(.plain)
            .font(.system(size: 14))
            .foregroundColor(Theme.text)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.panel))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }
}

struct BrandPanel: View {
    var features: [(String, String, String)] {
        [
            ("checkmark.seal.fill", L("welcome.feature.check"), L("welcome.feature.checkDetail")),
            ("globe", L("welcome.feature.hosting"), L("welcome.feature.hostingDetail")),
            ("network", L("welcome.feature.domains"), L("welcome.feature.domainsDetail")),
            ("sparkles", L("welcome.feature.ai"), L("welcome.feature.aiDetail")),
            ("creditcard.fill", L("welcome.feature.costs"), L("welcome.feature.costsDetail")),
        ]
    }

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x0B3D91), Color(hex: 0x0A6EF0), Color(hex: 0x3B9CFF)],
                           startPoint: .bottomLeading, endPoint: .topTrailing)
            Circle().fill(Color.white.opacity(0.08)).frame(width: 520).offset(x: 220, y: -260).blur(radius: 2)
            Circle().fill(Color.white.opacity(0.06)).frame(width: 380).offset(x: -240, y: 300)
            VStack(alignment: .leading, spacing: 28) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.18))
                        Image(systemName: "paperplane.fill").font(.system(size: 22, weight: .bold)).foregroundColor(.white).rotationEffect(.degrees(-8))
                    }
                    .frame(width: 50, height: 50)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Before I Deploy").font(.system(size: 22, weight: .bold)).foregroundColor(.white)
                        Text(L("welcome.tagline")).font(.system(size: 13)).foregroundColor(.white.opacity(0.75))
                    }
                }
                Text(L("welcome.headline"))
                    .font(.system(size: 34, weight: .heavy))
                    .foregroundColor(.white)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(features.indices, id: \.self) { i in
                        let f = features[i]
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: f.0).font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                                .frame(width: 32, height: 32)
                                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color.white.opacity(0.15)))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.1).font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
                                Text(f.2).font(.system(size: 12.5)).foregroundColor(.white.opacity(0.75))
                            }
                        }
                    }
                }
            }
            .padding(56)
            .frame(maxWidth: 560, alignment: .leading)
        }
        .clipped()
    }
}

// MARK: - Cloud setup (owner, once)

struct CloudSetupView: View {
    @EnvironmentObject var model: AppModel
    @Local private var url = ""
    @Local private var key = ""
    @Local private var error: String?
    @Local private var busy = false

    var body: some View {
        HStack(spacing: 0) {
            BrandPanel().frame(maxWidth: .infinity, maxHeight: .infinity)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(L("cloud.title")).font(.system(size: 24, weight: .bold)).foregroundColor(Theme.text)
                    Text(L("cloud.subtitle"))
                        .font(.system(size: 13)).foregroundColor(Theme.secondary)
                    VStack(alignment: .leading, spacing: 10) {
                        StepLine(n: 1, text: L("cloud.step1"))
                        StepLine(n: 2, text: L("cloud.step2"))
                        StepLine(n: 3, text: L("cloud.step3"))
                        StepLine(n: 4, text: L("cloud.step4"))
                    }
                    HStack {
                        Button { model.open("https://supabase.com/dashboard/new") } label: { Label(L("cloud.openSupabase"), systemImage: "safari") }
                            .bidButton(.secondary, compact: true)
                        Button { model.copyCloudSchema() } label: { Label(L("cloud.copySchema"), systemImage: "doc.on.doc") }
                            .bidButton(.secondary, compact: true)
                    }
                    BIDTextField(placeholder: "https://xxxx.supabase.co", text: $url, mono: true)
                    BIDTextField(placeholder: "anon public key", text: $key, mono: true)
                    if let error { Text(error).foregroundColor(Theme.blocked).font(.system(size: 12.5)) }
                    Button {
                        busy = true
                        Task {
                            error = await model.configureCloud(url: url.trimmingCharacters(in: .whitespaces), key: key.trimmingCharacters(in: .whitespaces))
                            busy = false
                        }
                    } label: {
                        HStack {
                            Spacer()
                            if busy { Spinner(size: 12, color: .white) }
                            Text(L("common.connect"))
                            Spacer()
                        }
                    }
                        .bidButton(.primary)
                        .disabled(url.isEmpty || key.isEmpty || busy)
                    Button(L("cloud.continueOffline")) { model.continueOffline() }
                        .buttonStyle(.plain).foregroundColor(Theme.tertiary).font(.system(size: 12))
                }
                .padding(48)
            }
            .frame(width: 480)
            .background(Theme.bg)
        }
    }
}

// MARK: - Account badge (sidebar)

struct AccountBadge: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        let a = model.account
        Menu {
            if a?.loggedIn == true {
                Text(a?.email ?? "")
                Button(L("account.syncProjects")) { model.syncNow() }
                Divider()
                Button(L("account.signOut")) { model.logout() }
            } else {
                Button(L("account.signInOrUp")) { model.offlineMode = false }
            }
        } label: {
            HStack(spacing: 9) {
                ZStack {
                    Circle().fill(Theme.accentGradient)
                    Text(String((a?.name ?? a?.email ?? "?").prefix(1)).uppercased())
                        .font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                }
                .frame(width: 26, height: 26)
                VStack(alignment: .leading, spacing: 1) {
                    Text(a?.loggedIn == true ? (a?.name ?? L("common.account")) : L("account.offline"))
                        .font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text).lineLimit(1)
                    Text(a?.loggedIn == true ? (a?.email ?? "") : L("account.signInToSync"))
                        .font(.system(size: 10.5)).foregroundColor(Theme.tertiary).lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .bold)).foregroundColor(Theme.tertiary)
            }
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.panel))
    }
}

// MARK: - Hosting chooser

struct HostingChooserCard: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(title: L("hosting.whereTitle"), icon: "server.rack", trailing: model.advice.map { "\($0.framework ?? "") · \($0.ssr ? "SSR" : "статичен")" })
            if let a = model.advice {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 10)], spacing: 10) {
                    ForEach(a.providers) { p in HostingOptionTile(option: p) }
                }
                Text(L("hosting.pricesNote"))
                    .font(.system(size: 11)).foregroundColor(Theme.tertiary)
            } else {
                HStack { Spinner(size: 13); Text(L("hosting.analyzing")).font(.system(size: 12)).foregroundColor(Theme.secondary) }
            }
        }
        .card()
        .task { await model.loadAdvice() }
    }
}

struct HostingOptionTile: View {
    @EnvironmentObject var model: AppModel
    let option: HostingOption

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(option.name).font(.system(size: 14, weight: .bold)).foregroundColor(option.compatible ? Theme.text : Theme.tertiary)
                Spacer()
                if option.current {
                    Tag(text: L("hosting.selectedBadge"), tint: Theme.accent)
                } else if option.recommended == true {
                    Tag(text: L("hosting.recommendedBadge"), tint: Theme.ready)
                }
            }
            Text(option.free).font(.system(size: 11.5)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
            ForEach(option.reasons, id: \.self) { r in
                Label(r, systemImage: option.compatible ? "exclamationmark.triangle" : "xmark.circle")
                    .font(.system(size: 11)).foregroundColor(option.compatible ? Theme.warn : Theme.blocked)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 6) {
                StatusPill(ok: option.installed, text: "CLI")
                StatusPill(ok: option.loggedIn, text: L("hosting.signInLower"))
                if option.preview { StatusPill(ok: true, text: "preview") }
                Spacer()
            }
            HStack {
                Button(L("hosting.prices")) { model.open(option.pricing) }.bidButton(.ghost, compact: true)
                Spacer()
                if !option.current {
                    Button(L("hosting.choose")) { model.setHosting(option.id) }
                        .bidButton(option.recommended == true ? .primary : .secondary, compact: true)
                        .disabled(!option.compatible)
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(option.current ? Theme.accentSoft : Theme.elevated))
        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).strokeBorder(option.current ? Theme.accent.opacity(0.6) : Theme.hairline, lineWidth: 1))
        .opacity(option.compatible ? 1 : 0.6)
    }
}

struct Tag: View {
    let text: String
    let tint: Color
    var body: some View {
        Text(text).font(.system(size: 9.5, weight: .heavy)).tracking(0.7).foregroundColor(tint)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Capsule().fill(tint.opacity(0.15)))
    }
}

struct StatusPill: View {
    let ok: Bool
    let text: String
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: ok ? "checkmark" : "xmark").font(.system(size: 8, weight: .black))
            Text(text).font(.system(size: 10.5, weight: .semibold))
        }
        .foregroundColor(ok ? Theme.ready : Theme.tertiary)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(Capsule().fill(Theme.bg))
    }
}

/// Deploy card for non-Netlify providers.
struct GenericHostingCard: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus

    var body: some View {
        let h = status.hosting
        let live = h?.liveUrl ?? status.lastProd?.url
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(title: h?.name ?? L("common.hosting"), icon: "globe", status: h?.ready == true ? "pass" : nil,
                        trailing: h?.loggedIn == true ? L("common.signedInLower") : L("common.notSignedInLower"))
            if h?.installed != true || h?.loggedIn != true {
                HStack {
                    Text(h?.installed != true ? L("hosting.cliMissing", h?.name ?? "") : L("hosting.signInHint", h?.name ?? ""))
                        .font(.system(size: 12.5)).foregroundColor(Theme.secondary)
                    Spacer()
                    Button(L("hosting.setUp")) { model.screen = .setup; Task { await model.loadSetup() } }
                        .bidButton(.primary, compact: true)
                }
            } else {
                HStack(alignment: .top, spacing: 24) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("LIVE").font(.system(size: 10, weight: .bold)).tracking(1).foregroundColor(Theme.tertiary)
                        Text(live.map { Fmt.host($0) } ?? L("hosting.noProductionYet"))
                            .font(.system(size: 15, weight: .semibold)).foregroundColor(live == nil ? Theme.tertiary : Theme.text)
                    }
                    DeployStat(title: L("hosting.lastProduction"), record: status.lastProd, fallback: nil)
                    DeployStat(title: L("hosting.lastPreview"), record: status.lastDraft, fallback: nil)
                    Spacer()
                }
                HStack(spacing: 8) {
                    if h?.preview == true {
                        Button { model.draftPreview() } label: { Label("Preview", systemImage: "eye") }
                            .bidButton(.secondary, compact: true)
                    }
                    Spacer()
                    if let live {
                        Button { model.open(live) } label: { Label(L("common.openSite"), systemImage: "safari") }
                            .bidButton(.secondary, compact: true)
                        Button { model.copy(live) } label: { Image(systemName: "doc.on.doc") }
                            .bidButton(.secondary, compact: true)
                    }
                }
            }
        }
        .card()
    }
}

// MARK: - Command palette (⌘K)

struct PaletteCommand: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let icon: String
    let action: () -> Void
}

struct CommandPalette: View {
    @EnvironmentObject var model: AppModel
    @Local private var query = ""

    var commands: [PaletteCommand] {
        var c: [PaletteCommand] = [
            PaletteCommand(title: "Mission Control", subtitle: L("common.allProjects"), icon: "square.grid.2x2.fill") { model.screen = .overview; Task { await model.loadOverview() } },
            PaletteCommand(title: L("common.domains"), subtitle: L("palette.domainsDetail"), icon: "network") { model.screen = .domains; Task { await model.loadSpaceship() } },
            PaletteCommand(title: L("common.costs"), subtitle: L("palette.costsDetail"), icon: "creditcard.fill") { model.screen = .costs; Task { await model.loadCosts() } },
            PaletteCommand(title: L("common.setup"), subtitle: L("palette.setupDetail"), icon: "wand.and.stars") { model.screen = .setup; Task { await model.loadSetup() } },
            PaletteCommand(title: L("common.addProject"), subtitle: L("palette.pickFolder"), icon: "plus") { model.addProjectPanel() },
        ]
        if let p = model.selected {
            c += [
                PaletteCommand(title: L("palette.checkProject", p.name), subtitle: "Git, secrets, lint, build", icon: "arrow.triangle.2.circlepath") { model.runCheck() },
                PaletteCommand(title: "Smart Deploy \(p.name)", subtitle: L("palette.smartDetail"), icon: "bolt.fill") { model.smartDeploy() },
                PaletteCommand(title: "Local Preview \(p.name)", subtitle: L("palette.localDetail"), icon: "desktopcomputer") { model.localStart() },
                PaletteCommand(title: "Commit & Push", subtitle: p.name, icon: "arrow.up.circle.fill") { model.sheet = .commit },
                PaletteCommand(title: "Production \(p.name)", subtitle: L("palette.productionDetail"), icon: "paperplane.fill") { model.sheet = .production },
            ]
        }
        for p in model.projects {
            c.append(PaletteCommand(title: p.name, subtitle: L("palette.openProject"), icon: "folder.fill") { Task { await model.select(p.key) } })
        }
        return c
    }

    var filtered: [PaletteCommand] {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return commands }
        return commands.filter { $0.title.lowercased().contains(q) || $0.subtitle.lowercased().contains(q) }
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.opacity(0.45).ignoresSafeArea().onTapGesture { model.showPalette = false }
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundColor(Theme.tertiary)
                    TextField(L("palette.placeholder"), text: $query)
                        .textFieldStyle(.plain)
                        .font(.system(size: 16))
                        .foregroundColor(Theme.text)
                        .onSubmit { run(filtered.first) }
                    Text("esc").font(.system(size: 10.5, weight: .semibold)).foregroundColor(Theme.tertiary)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 5).fill(Theme.elevated))
                }
                .padding(16)
                Rectangle().fill(Theme.hairline).frame(height: 1)
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(Array(filtered.prefix(12).enumerated()), id: \.element.id) { i, cmd in
                            Button { run(cmd) } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: cmd.icon).foregroundColor(i == 0 ? .white : Theme.accent).frame(width: 22)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(cmd.title).font(.system(size: 13.5, weight: .semibold)).foregroundColor(i == 0 ? .white : Theme.text)
                                        Text(cmd.subtitle).font(.system(size: 11.5)).foregroundColor(i == 0 ? .white.opacity(0.75) : Theme.tertiary)
                                    }
                                    Spacer()
                                    if i == 0 { Image(systemName: "return").foregroundColor(.white.opacity(0.8)) }
                                }
                                .padding(.horizontal, 12).padding(.vertical, 9)
                                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(i == 0 ? Theme.accent : Color.clear))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                        if filtered.isEmpty {
                            Text(L("palette.nothingFound")).foregroundColor(Theme.tertiary).padding(20)
                        }
                    }
                    .padding(8)
                }
                .frame(maxHeight: 380)
            }
            .frame(width: 620)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.panel))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 30, y: 14)
            .padding(.top, 110)
        }
        .onExitCommand { model.showPalette = false }
    }

    func run(_ cmd: PaletteCommand?) {
        guard let cmd else { return }
        model.showPalette = false
        cmd.action()
    }
}
