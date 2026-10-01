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
                        .font(Typo.font(.display, weight: .bold)).foregroundColor(Theme.text)
                    Text(mode == 1 ? L("auth.signupSubtitle")
                         : mode == 2 ? L("auth.recoverSubtitle")
                         : L("auth.loginSubtitle"))
                        .font(Typo.font(.subhead)).foregroundColor(Theme.secondary)
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
                        .font(Typo.font(.body)).foregroundColor(Theme.blocked)
                        .fixedSize(horizontal: false, vertical: true)
                    if model.lastAuthCode == "email_not_confirmed" {
                        HStack(spacing: 10) {
                            Button { resend() } label: { Label(L("auth.resend"), systemImage: "envelope.arrow.triangle.branch") }
                                .bidButton(.secondary, compact: true)
                                .disabled(busy || email.isEmpty)
                            Text(L("auth.resendHint")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                if let info {
                    Label(info, systemImage: "checkmark.circle.fill")
                        .font(Typo.font(.body)).foregroundColor(Theme.ready)
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

                if mode != 2 && !providers.isEmpty {
                    HStack(spacing: 10) {
                        Rectangle().fill(Theme.hairline).frame(height: 1)
                        Text(L("auth.or")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                        Rectangle().fill(Theme.hairline).frame(height: 1)
                    }
                    if providers.contains("github") {
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
                    if providers.contains("apple") {
                        AppleSignInButton { model.oauth("apple") }
                    }
                }

                HStack {
                    if mode == 0 {
                        Button(L("auth.forgot")) { withAnimation { mode = 2; error = nil; info = nil } }
                            .buttonStyle(.plain).foregroundColor(Theme.accent).font(Typo.font(.body))
                    } else if mode == 2 {
                        Button(L("auth.backToLogin")) { withAnimation { mode = 0; error = nil; info = nil } }
                            .buttonStyle(.plain).foregroundColor(Theme.accent).font(Typo.font(.body))
                    }
                    Spacer()
                    Button(L("auth.continueOffline")) { model.continueOffline() }
                        .buttonStyle(.plain).foregroundColor(Theme.tertiary).font(Typo.font(.callout))
                }
                CloudCheckLine()
                Spacer()
                Text(L("auth.privacyNote"))
                    .font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
                LegalLinks()
            }
            .padding(48)
            .frame(width: 460)
            .frame(maxHeight: .infinity)
            .background(Theme.bg)
        }
        .onChange(of: mode) { _ in error = nil; info = nil }
    }

    /// Sign-in buttons the cloud project has enabled (engine reads Supabase's public auth settings).
    var providers: [String] {
        (model.account?.oauthProviders ?? ["github"]).filter { $0 == "github" || $0 == "apple" }
    }

    func resend() {
        busy = true
        Task {
            let r = await model.resendConfirmation(email: email.trimmingCharacters(in: .whitespaces))
            if r == nil { info = L("auth.resent"); error = nil } else { error = r }
            busy = false
        }
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
        HStack(spacing: Space.s) {
            Image(systemName: icon).foregroundColor(Theme.secondary).frame(width: 18).accessibilityHidden(true)
            BIDField(placeholder: placeholder, text: $text, kind: secure ? .secure : .text)
        }
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
            WelcomeSky()
            VStack(alignment: .leading, spacing: 28) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Color.white.opacity(0.18))
                        Image(systemName: "paperplane.fill").font(Typo.font(.title, weight: .bold)).foregroundColor(.white).rotationEffect(.degrees(-8))
                    }
                    .frame(width: 50, height: 50)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Before I Deploy").font(Typo.font(.title, weight: .bold)).foregroundColor(.white)
                        Text(L("welcome.tagline")).font(Typo.font(.body)).foregroundColor(.white.opacity(0.75))
                    }
                }
                Text(L("welcome.headline"))
                    .font(Typo.font(.display, weight: .heavy))
                    .foregroundColor(.white)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(features.indices, id: \.self) { i in
                        let f = features[i]
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: f.0).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(.white)
                                .frame(width: 32, height: 32)
                                .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Color.white.opacity(0.15)))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.1).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(.white)
                                Text(f.2).font(Typo.font(.body)).foregroundColor(.white.opacity(0.75))
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
                    Text(L("cloud.title")).font(Typo.font(.title, weight: .bold)).foregroundColor(Theme.text)
                    Text(L("cloud.subtitle"))
                        .font(Typo.font(.body)).foregroundColor(Theme.secondary)
                    VStack(alignment: .leading, spacing: 10) {
                        StepLine(n: 1, text: L("cloud.step1"))
                        StepLine(n: 2, text: L("cloud.step2"))
                        StepLine(n: 3, text: L("cloud.step3"))
                        StepLine(n: 4, text: L("cloud.step4"))
                    }
                    HStack {
                        Button { model.open("https://supabase.com/dashboard/new") } label: { Label(L("cloud.openSupabase"), systemImage: "safari") }
                            .bidButton(.secondary, compact: true)
                        Button { Task { if await model.copyCloudSchema() { model.flash(L("cloud.schemaCopied")) } } } label: { Label(L("cloud.copySchema"), systemImage: "doc.on.doc") }
                            .bidButton(.secondary, compact: true)
                    }
                    BIDTextField(placeholder: "https://xxxx.supabase.co", text: $url, mono: true)
                    BIDTextField(placeholder: L("cloud.anonKeyPlaceholder"), text: $key, mono: true)
                    if let error { Text(error).foregroundColor(Theme.blocked).font(Typo.font(.body)) }
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
                        .buttonStyle(.plain).foregroundColor(Theme.tertiary).font(Typo.font(.callout))
                }
                .padding(48)
            }
            .frame(width: 480)
            .background(Theme.bg)
        }
    }
}

/// "Trouble signing in?" — runs `bid cloud doctor` and shows the owner exactly what the cloud project lacks.
struct CloudCheckLine: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                Task { await model.checkCloud() }
            } label: {
                HStack(spacing: 6) {
                    if model.cloudChecking { Spinner(size: 11) } else { Image(systemName: "stethoscope") }
                    Text(L("auth.checkCloud"))
                }
            }
            .buttonStyle(.plain).foregroundColor(Theme.accent).font(Typo.font(.body))
            .disabled(model.cloudChecking)
            if let d = model.cloudDoctor {
                VStack(alignment: .leading, spacing: 5) {
                    line(d.reachable, d.reachable ? L("cloud.doctor.reachable", d.ref ?? d.url ?? "") : L("cloud.doctor.unreachable", d.error ?? ""))
                    if d.reachable {
                        line(d.schemaApplied == true, d.schemaApplied == true ? L("cloud.doctor.schemaOk") : L("cloud.doctor.schemaMissing", (d.tablesMissing ?? []).joined(separator: ", ")))
                        line((d.functionsMissing ?? []).isEmpty, (d.functionsMissing ?? []).isEmpty ? L("cloud.doctor.functionsOk") : L("cloud.doctor.functionsMissing", (d.functionsMissing ?? []).joined(separator: ", ")))
                        if let a = d.auth {
                            line(a.signupEnabled != false, a.signupEnabled != false ? L("cloud.doctor.signupOn") : L("cloud.doctor.signupOff"))
                            line(a.emailConfirmRequired != true, a.emailConfirmRequired != true ? L("cloud.doctor.confirmOff") : L("cloud.doctor.confirmOn"))
                        }
                        if d.schemaApplied != true || !(d.functionsMissing ?? []).isEmpty || d.auth?.emailConfirmRequired == true {
                            Text(L("cloud.doctor.ownerHint")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                            HStack(spacing: 8) {
                                if let u = d.dashboard?.project {
                                    Button { model.open(u) } label: { Label(L("cloud.doctor.openDashboard"), systemImage: "arrow.up.right") }
                                        .bidButton(.secondary, compact: true)
                                }
                                Button { model.screen = .setup; model.continueOffline(); Task { await model.loadSetup() } } label: { Label(L("cloud.doctor.openSetup"), systemImage: "wand.and.stars") }
                                    .bidButton(.ghost, compact: true)
                            }
                        }
                    }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).fill(Theme.panel))
                .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
                .entrance(0, offset: 8)
            }
        }
    }

    private func line(_ ok: Bool, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(Typo.font(.callout)).foregroundColor(ok ? Theme.ready : Theme.blocked)
            Text(text).font(Typo.font(.callout)).foregroundColor(Theme.text).fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Account badge (sidebar)

struct AccountBadge: View {
    @EnvironmentObject var model: AppModel
    @Local private var open = false
    @Local private var hover = false

    var body: some View {
        let a = model.account
        Button { open.toggle() } label: {
            HStack(spacing: 9) {
                ZStack {
                    Circle().fill(Theme.avatarGradient(for: a?.email ?? "?")).frame(width: 26, height: 26)
                    Text(String((a?.name ?? a?.email ?? "?").prefix(1)).uppercased())
                        .font(Typo.font(.callout, weight: .bold)).foregroundColor(.white)
                    // credits ring: what is left of this month's plan tokens
                    if let f = a?.credits?.fraction {
                    CreditRing(fraction: f, size: 32)
                    }
                }
                .frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: 1) {
                    Text(a?.loggedIn == true ? (a?.name ?? L("common.account")) : L("account.offline"))
                        .font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text).lineLimit(1)
                    Text(a?.loggedIn == true ? (a?.email ?? "") : L("account.signInToSync"))
                        .font(Typo.font(.caption)).foregroundColor(Theme.tertiary).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down").font(Typo.font(.micro, weight: .bold)).foregroundColor(Theme.tertiary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(hover ? Theme.elevated : Theme.panel))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(a?.credits.map { L("account.creditsHelp", Fmt.tokens($0.balance)) } ?? "")
        .popover(isPresented: $open, arrowEdge: .top) {
            AccountMenu(close: { open = false })
                .environmentObject(model)
        }
    }
}

/// The account badge's popover: who is signed in, plan and credits, and the account actions.
struct AccountMenu: View {
    @EnvironmentObject var model: AppModel
    let close: () -> Void

    var body: some View {
        let a = model.account
        VStack(alignment: .leading, spacing: 4) {
            if a?.loggedIn == true {
                Text(a?.email ?? "").font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                if let role = a?.role, let plan = a?.plan {
                    Text(L("account.rolePlan", role, plan, Fmt.tokens(a?.credits?.balance ?? 0)))
                        .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                }
                Divider().padding(.vertical, 4)
                item(L("account.open"), "person.crop.circle") { model.screen = .account }
                if a?.features?.billingPlans == true {
                    item(L("billing.menu"), "sparkles") { model.sheet = .plans }
                }
                item(L("account.syncProjects"), "arrow.triangle.2.circlepath") { model.syncNow() }
                Divider().padding(.vertical, 4)
                item(L("account.signOut"), "rectangle.portrait.and.arrow.right") { model.logout() }
            } else {
                Text(L("account.signInToSync")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                Divider().padding(.vertical, 4)
                item(L("account.signInOrUp"), "person.crop.circle.badge.plus") { model.offlineMode = false }
            }
        }
        .padding(12)
        .frame(width: 260, alignment: .leading)
    }

    private func item(_ title: String, _ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button { close(); action() } label: {
            Label(title, systemImage: symbol)
                .font(Typo.font(.body))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 5)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundColor(Theme.text)
    }
}

// MARK: - Hosting chooser

struct HostingChooserCard: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(title: L("hosting.whereTitle"), icon: "server.rack", trailing: model.advice.map { "\($0.framework ?? "") · \($0.ssr ? "SSR" : L("hosting.staticSite"))" })
            if let a = model.advice {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 10)], spacing: 10) {
                    ForEach(a.providers) { p in HostingOptionTile(option: p) }
                }
                Text(L("hosting.pricesNote"))
                    .font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            } else {
                HStack { Spinner(size: 13); Text(L("hosting.analyzing")).font(Typo.font(.callout)).foregroundColor(Theme.secondary) }
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
                Text(option.name).font(Typo.font(.subhead, weight: .bold)).foregroundColor(option.compatible ? Theme.text : Theme.tertiary)
                Spacer()
                if option.current {
                    Tag(text: L("hosting.selectedBadge"), tint: Theme.accent)
                } else if option.recommended == true {
                    Tag(text: L("hosting.recommendedBadge"), tint: Theme.ready)
                }
            }
            Text(option.free).font(Typo.font(.callout)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
            ForEach(option.reasons, id: \.self) { r in
                Label(r, systemImage: option.compatible ? "exclamationmark.triangle" : "xmark.circle")
                    .font(Typo.font(.caption)).foregroundColor(option.compatible ? Theme.warn : Theme.blocked)
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
        .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(option.current ? Theme.accentSoft : Theme.elevated))
        .overlay(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).strokeBorder(option.current ? Theme.accent.opacity(0.6) : Theme.hairline, lineWidth: 1))
        .opacity(option.compatible ? 1 : 0.6)
    }
}

struct Tag: View {
    let text: String
    let tint: Color
    var body: some View { Badge(text: text, size: .sm, tint: tint) }
}

struct StatusPill: View {
    let ok: Bool
    let text: String
    var body: some View { Badge(text: text, icon: ok ? "checkmark" : "xmark", tone: ok ? .success : .neutral, size: .sm) }
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
                        .font(Typo.font(.body)).foregroundColor(Theme.secondary)
                    Spacer()
                    Button(L("hosting.setUp")) { model.screen = .setup; Task { await model.loadSetup() } }
                        .bidButton(.primary, compact: true)
                }
            } else {
                HStack(alignment: .top, spacing: 24) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L("hosting.liveLabel")).font(Typo.font(.micro, weight: .bold)).tracking(1).foregroundColor(Theme.tertiary)
                        Text(live.map { Fmt.host($0) } ?? L("hosting.noProductionYet"))
                            .font(Typo.font(.subhead, weight: .semibold)).foregroundColor(live == nil ? Theme.tertiary : Theme.text)
                    }
                    DeployStat(title: L("hosting.lastProduction"), record: status.lastProd, fallback: nil)
                    DeployStat(title: L("hosting.lastPreview"), record: status.lastDraft, fallback: nil)
                    Spacer()
                }
                HStack(spacing: 8) {
                    if h?.preview == true {
                        Button { model.draftPreview() } label: { Label(L("hosting.previewButton"), systemImage: "eye") }
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
    /// Highlighted row: ↑/↓ move it, Return runs it (audit A14).
    @Local private var selection = 0
    @FocusState private var searchFocused: Bool
    @Local private var appeared = false

    var commands: [PaletteCommand] {
        var c: [PaletteCommand] = [
            PaletteCommand(title: L("nav.missionControl"), subtitle: L("common.allProjects"), icon: "square.grid.2x2.fill") { model.screen = .overview; Task { await model.loadOverview() } },
            PaletteCommand(title: L("common.domains"), subtitle: L("palette.domainsDetail"), icon: "network") { model.screen = .domains; Task { await model.loadSpaceship() } },
            PaletteCommand(title: L("common.costs"), subtitle: L("palette.costsDetail"), icon: "creditcard.fill") { model.screen = .costs; Task { await model.loadCosts() } },
            PaletteCommand(title: L("common.setup"), subtitle: L("palette.setupDetail"), icon: "wand.and.stars") { model.screen = .setup; Task { await model.loadSetup() } },
            PaletteCommand(title: L("ai.askAssistant"), subtitle: L("palette.assistantDetail"), icon: "sparkles") { model.openAssistant() },
        ]
        if model.account?.canUseOwnKey == true {
            c.append(PaletteCommand(title: L("ai.addKeyButton"), subtitle: L("palette.aiKeyDetail"), icon: "key.fill") { model.sheet = .aiKeys })
        }
        c += [
        ]
        if model.account?.isAdmin == true {
            c.append(PaletteCommand(title: L("admin.title"), subtitle: L("admin.subtitle"), icon: "person.2.badge.gearshape.fill") { model.screen = .admin })
        }
        c += [
            PaletteCommand(title: L("common.addProject"), subtitle: L("palette.pickFolder"), icon: "plus") { model.addProjectPanel() },
            PaletteCommand(title: L("newsite.button"), subtitle: L("newsite.subtitle"), icon: "sparkles.rectangle.stack") { model.sheet = .newSite },
        ]
        if let p = model.selected {
            c += [
                PaletteCommand(title: L("palette.checkProject", p.name), subtitle: L("palette.checkDetail"), icon: "arrow.triangle.2.circlepath") { model.runCheck() },
                PaletteCommand(title: "\(L("run.smartDeploy")) — \(p.name)", subtitle: L("palette.smartDetail"), icon: "bolt.fill") { model.smartDeploy() },
                PaletteCommand(title: "\(L("run.localPreview")) — \(p.name)", subtitle: L("palette.localDetail"), icon: "desktopcomputer") { model.localStart() },
                PaletteCommand(title: L("menu.commitPush"), subtitle: p.name, icon: "arrow.up.circle.fill") { model.sheet = .commit },
                PaletteCommand(title: "\(L("palette.production")) — \(p.name)", subtitle: L("palette.productionDetail"), icon: "paperplane.fill") { model.sheet = .release },
            ]
        }
        for p in model.projects {
            c.append(PaletteCommand(title: p.name, subtitle: L("palette.openProject"), icon: "folder.fill") { Task { await model.select(p.key) } })
        }
        return c
    }

    var visible: [PaletteCommand] { Array(filtered.prefix(12)) }

    private func move(_ delta: Int) {
        let n = visible.count
        guard n > 0 else { return }
        selection = (selection + delta + n) % n
    }

    var filtered: [PaletteCommand] {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return commands }
        return commands.filter { $0.title.lowercased().contains(q) || $0.subtitle.lowercased().contains(q) }
    }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.scrim.ignoresSafeArea().onTapGesture { model.showPalette = false }
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundColor(Theme.tertiary)
                    TextField(L("palette.placeholder"), text: $query)
                        .textFieldStyle(.plain)
                        .font(Typo.font(.headline))
                        .foregroundColor(Theme.text)
                        .focused($searchFocused)
                        .onSubmit { run(visible.indices.contains(selection) ? visible[selection] : nil) }
                        .onChange(of: query) { _ in selection = 0 }
                    Text("⎋").font(Typo.font(.caption, weight: .semibold)).foregroundColor(Theme.tertiary)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: Radius.xs).fill(Theme.elevated))
                }
                .padding(16)
                Rectangle().fill(Theme.hairline).frame(height: 1)
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(Array(visible.enumerated()), id: \.element.id) { index, cmd in
                            Button { run(cmd) } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: cmd.icon).foregroundColor(index == selection ? .white : Theme.accent).frame(width: 22)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(cmd.title).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(index == selection ? .white : Theme.text)
                                        Text(cmd.subtitle).font(Typo.font(.callout)).foregroundColor(index == selection ? .white.opacity(0.75) : Theme.tertiary)
                                    }
                                    Spacer()
                                    if index == selection { Image(systemName: "return").foregroundColor(.white.opacity(0.8)) }
                                }
                                .padding(.horizontal, 12).padding(.vertical, 9)
                                .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(index == selection ? Theme.accentFill : Color.clear))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .entrance(index, offset: 8)
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
            .background(RoundedRectangle(cornerRadius: Radius.l, style: .continuous).fill(Theme.panel))
            .overlay(RoundedRectangle(cornerRadius: Radius.l, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
            .glowBorder(Theme.accent, radius: 16, strength: 0.8)
            .elevation(.popover)
            .padding(.top, 110)
            .scaleEffect(appeared || Motion.reduced ? 1 : 0.94, anchor: .top)
            .opacity(appeared || Motion.reduced ? 1 : 0)
            .onAppear { withAnimation(.spring(response: 0.36, dampingFraction: 0.8)) { appeared = true } }
            // arrow keys move the highlight even while the search field has focus
            Group {
                Button("") { move(-1) }.keyboardShortcut(.upArrow, modifiers: [])
                Button("") { move(1) }.keyboardShortcut(.downArrow, modifiers: [])
            }
            .opacity(0)
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
        }
        .accessibilityAddTraits(.isModal)
        .onExitCommand { model.showPalette = false }
        .onAppear { DispatchQueue.main.async { searchFocused = true } }
    }

    func run(_ cmd: PaletteCommand?) {
        guard let cmd else { return }
        model.showPalette = false
        cmd.action()
    }
}
