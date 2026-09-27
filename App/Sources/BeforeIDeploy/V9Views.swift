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
                    Text(mode == 1 ? "Създай акаунт" : mode == 2 ? "Нова парола" : "Добре дошъл отново")
                        .font(.system(size: 28, weight: .bold)).foregroundColor(Theme.text)
                    Text(mode == 1 ? "Един акаунт за всички твои сайтове, хостинги и домейни."
                         : mode == 2 ? "Ще ти изпратим линк за нова парола."
                         : "Влез, за да продължиш към проектите си.")
                        .font(.system(size: 13.5)).foregroundColor(Theme.secondary)
                }

                if mode != 2 {
                    SegmentedControl(options: [("Вход", 0), ("Регистрация", 1)], selection: $mode)
                }

                VStack(spacing: 10) {
                    if mode == 1 {
                        AuthField(icon: "person", placeholder: "Име", text: $name)
                    }
                    AuthField(icon: "envelope", placeholder: "Имейл", text: $email)
                    if mode != 2 {
                        AuthField(icon: "lock", placeholder: mode == 1 ? "Парола (поне 8 символа)" : "Парола", text: $password, secure: true)
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
                        Text(mode == 1 ? "Създай акаунт" : mode == 2 ? "Изпрати линк" : "Вход")
                        Spacer()
                    }
                }
                .bidButton(.primary)
                .keyboardShortcut(.defaultAction)
                .disabled(busy || email.isEmpty || (mode != 2 && password.isEmpty))

                if mode != 2 {
                    HStack(spacing: 10) {
                        Rectangle().fill(Theme.hairline).frame(height: 1)
                        Text("или").font(.system(size: 11.5)).foregroundColor(Theme.tertiary)
                        Rectangle().fill(Theme.hairline).frame(height: 1)
                    }
                    Button { model.oauth("github") } label: {
                        HStack {
                            Spacer()
                            Image(systemName: "chevron.left.forwardslash.chevron.right")
                            Text("Продължи с GitHub")
                            Spacer()
                        }
                    }
                    .bidButton(.secondary)
                }

                HStack {
                    if mode == 0 {
                        Button("Забравена парола?") { withAnimation { mode = 2; error = nil; info = nil } }
                            .buttonStyle(.plain).foregroundColor(Theme.accent).font(.system(size: 12.5))
                    } else if mode == 2 {
                        Button("← Назад към вход") { withAnimation { mode = 0; error = nil; info = nil } }
                            .buttonStyle(.plain).foregroundColor(Theme.accent).font(.system(size: 12.5))
                    }
                    Spacer()
                    Button("Продължи без акаунт") { model.continueOffline() }
                        .buttonStyle(.plain).foregroundColor(Theme.tertiary).font(.system(size: 12))
                }
                Spacer()
                Text("Ключовете за Netlify, GitHub, Vercel и т.н. остават само на твоя Mac (Keychain). В акаунта се пазят само имената и статусите на проектите.")
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
                    info = "Изпратихме ти имейл за потвърждение. Потвърди го и влез."
                    mode = 0
                    result = nil
                }
            case 2:
                result = await model.recover(email: e)
                if result == nil { info = "Провери пощата си за линк за нова парола." }
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
    let features: [(String, String, String)] = [
        ("checkmark.seal.fill", "Проверка преди всеки deploy", "Git, secrets, lint, типове и build — автоматично"),
        ("globe", "Хостинг по твой избор", "Netlify, Vercel, Cloudflare Pages, GitHub Pages — с цени"),
        ("network", "Домейни и DNS", "Свързване на домейн с хостинг с един бутон"),
        ("sparkles", "AI оправя грешките", "ChatGPT, Claude и Codex с готов prompt"),
        ("creditcard.fill", "Разходи под контрол", "Кредити, бюджети и цена преди всеки deploy"),
    ]

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
                        Text("Launchpad за уеб проекти").font(.system(size: 13)).foregroundColor(.white.opacity(0.75))
                    }
                }
                Text("От код до live сайт —\nбез нито една команда.")
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
                    Text("Свържи облака за акаунти").font(.system(size: 24, weight: .bold)).foregroundColor(Theme.text)
                    Text("Прави се само веднъж — от теб като собственик. Приятелите и клиентите ти после само се регистрират.")
                        .font(.system(size: 13)).foregroundColor(Theme.secondary)
                    VStack(alignment: .leading, spacing: 10) {
                        StepLine(n: 1, text: "Създай безплатен проект в Supabase.")
                        StepLine(n: 2, text: "SQL Editor → постави схемата (бутонът отдолу я копира) → Run.")
                        StepLine(n: 3, text: "Project Settings → API: копирай Project URL и anon public key и ги постави тук.")
                        StepLine(n: 4, text: "По желание: Authentication → Providers → GitHub, и добави beforeideploy://auth-callback в Redirect URLs.")
                    }
                    HStack {
                        Button { model.open("https://supabase.com/dashboard/new") } label: { Label("Отвори Supabase", systemImage: "safari") }
                            .bidButton(.secondary, compact: true)
                        Button { model.copyCloudSchema() } label: { Label("Копирай SQL схемата", systemImage: "doc.on.doc") }
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
                            Text("Свържи")
                            Spacer()
                        }
                    }
                        .bidButton(.primary)
                        .disabled(url.isEmpty || key.isEmpty || busy)
                    Button("Продължи без акаунт засега") { model.continueOffline() }
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
                Button("Синхронизирай проектите") { model.syncNow() }
                Divider()
                Button("Изход") { model.logout() }
            } else {
                Button("Влез / Регистрирай се") { model.offlineMode = false }
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
                    Text(a?.loggedIn == true ? (a?.name ?? "Акаунт") : "Офлайн режим")
                        .font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text).lineLimit(1)
                    Text(a?.loggedIn == true ? (a?.email ?? "") : "Влез, за да синхронизираш")
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
            PanelHeader(title: "Къде да се хоства?", icon: "server.rack", trailing: model.advice.map { "\($0.framework ?? "") · \($0.ssr ? "SSR" : "статичен")" })
            if let a = model.advice {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 10)], spacing: 10) {
                    ForEach(a.providers) { p in HostingOptionTile(option: p) }
                }
                Text("Цените и условията се променят — провери официалната страница с бутона „Цени“, преди да избереш платен план.")
                    .font(.system(size: 11)).foregroundColor(Theme.tertiary)
            } else {
                HStack { Spinner(size: 13); Text("Анализирам проекта…").font(.system(size: 12)).foregroundColor(Theme.secondary) }
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
                    Tag(text: "ИЗБРАН", tint: Theme.accent)
                } else if option.recommended == true {
                    Tag(text: "ПРЕПОРЪЧАН", tint: Theme.ready)
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
                StatusPill(ok: option.loggedIn, text: "вход")
                if option.preview { StatusPill(ok: true, text: "preview") }
                Spacer()
            }
            HStack {
                Button("Цени") { model.open(option.pricing) }.bidButton(.ghost, compact: true)
                Spacer()
                if !option.current {
                    Button("Избери") { model.setHosting(option.id) }
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
            PanelHeader(title: h?.name ?? "Хостинг", icon: "globe", status: h?.ready == true ? "pass" : nil,
                        trailing: h?.loggedIn == true ? "влязъл" : "не си влязъл")
            if h?.installed != true || h?.loggedIn != true {
                HStack {
                    Text(h?.installed != true ? "\(h?.name ?? "") CLI не е инсталиран." : "Влез в \(h?.name ?? "") — отваря се браузърът.")
                        .font(.system(size: 12.5)).foregroundColor(Theme.secondary)
                    Spacer()
                    Button("Настрой") { model.screen = .setup; Task { await model.loadSetup() } }
                        .bidButton(.primary, compact: true)
                }
            } else {
                HStack(alignment: .top, spacing: 24) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("LIVE").font(.system(size: 10, weight: .bold)).tracking(1).foregroundColor(Theme.tertiary)
                        Text(live.map { Fmt.host($0) } ?? "още няма production")
                            .font(.system(size: 15, weight: .semibold)).foregroundColor(live == nil ? Theme.tertiary : Theme.text)
                    }
                    DeployStat(title: "Последен production", record: status.lastProd, fallback: nil)
                    DeployStat(title: "Последен preview", record: status.lastDraft, fallback: nil)
                    Spacer()
                }
                HStack(spacing: 8) {
                    if h?.preview == true {
                        Button { model.draftPreview() } label: { Label("Preview", systemImage: "eye") }
                            .bidButton(.secondary, compact: true)
                    }
                    Spacer()
                    if let live {
                        Button { model.open(live) } label: { Label("Отвори сайта", systemImage: "safari") }
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
            PaletteCommand(title: "Mission Control", subtitle: "Всички проекти", icon: "square.grid.2x2.fill") { model.screen = .overview; Task { await model.loadOverview() } },
            PaletteCommand(title: "Домейни", subtitle: "Spaceship, DNS, изтичане", icon: "network") { model.screen = .domains; Task { await model.loadSpaceship() } },
            PaletteCommand(title: "Разходи & кредити", subtitle: "Колко струва всичко", icon: "creditcard.fill") { model.screen = .costs; Task { await model.loadCosts() } },
            PaletteCommand(title: "Настройка", subtitle: "Инструменти и акаунти", icon: "wand.and.stars") { model.screen = .setup; Task { await model.loadSetup() } },
            PaletteCommand(title: "Добави проект", subtitle: "Избери папка", icon: "plus") { model.addProjectPanel() },
        ]
        if let p = model.selected {
            c += [
                PaletteCommand(title: "Провери \(p.name)", subtitle: "Git, secrets, lint, build", icon: "arrow.triangle.2.circlepath") { model.runCheck() },
                PaletteCommand(title: "Smart Deploy \(p.name)", subtitle: "Проверка → preview", icon: "bolt.fill") { model.smartDeploy() },
                PaletteCommand(title: "Local Preview \(p.name)", subtitle: "Стартира локален сървър", icon: "desktopcomputer") { model.localStart() },
                PaletteCommand(title: "Commit & Push", subtitle: p.name, icon: "arrow.up.circle.fill") { model.sheet = .commit },
                PaletteCommand(title: "Production \(p.name)", subtitle: "С потвърждение DEPLOY", icon: "paperplane.fill") { model.sheet = .production },
            ]
        }
        for p in model.projects {
            c.append(PaletteCommand(title: p.name, subtitle: "Отвори проекта", icon: "folder.fill") { Task { await model.select(p.key) } })
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
                    TextField("Какво искаш да направиш?", text: $query)
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
                            Text("Нищо не намерих").foregroundColor(Theme.tertiary).padding(20)
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
