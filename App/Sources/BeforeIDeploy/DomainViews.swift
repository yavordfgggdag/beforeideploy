import SwiftUI

// MARK: - Domains screen (Spaceship)

struct DomainsView: View {
    @EnvironmentObject var model: AppModel
    @Local private var selectedDomain: String?
    @Local private var records: [DnsRecord] = []
    @Local private var loadingDNS = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader(title: "Домейни", subtitle: "Spaceship — домейни, изтичане, DNS и свързване с Netlify", icon: "network") {
                    HStack(spacing: 8) {
                        if model.loadingSpaceship { Spinner(size: 14) }
                        if model.spaceship?.connected == true {
                            Button { Task { await model.loadSpaceship(refresh: true) } } label: { Label("Обнови", systemImage: "arrow.clockwise") }
                                .bidButton(.secondary, compact: true)
                            Button { model.open("https://www.spaceship.com/domains/") } label: { Label("Купи домейн", systemImage: "cart") }
                                .bidButton(.secondary, compact: true)
                        }
                    }
                }

                if let s = model.spaceship, s.connected {
                    let expiring = s.domains.filter { ($0.daysLeft ?? 999) < 30 }.count
                    HStack(spacing: 12) {
                        KPITile(value: "\(s.domains.count)", label: "домейна", icon: "network")
                        KPITile(value: "\(expiring)", label: "изтичат до 30 дни", icon: "calendar.badge.exclamationmark",
                                tint: expiring > 0 ? Theme.warn : Theme.text)
                        KPITile(value: "\(s.domains.filter { !$0.autoRenew }.count)", label: "без auto-renew", icon: "arrow.triangle.2.circlepath",
                                tint: s.domains.contains { !$0.autoRenew } ? Theme.warn : Theme.text)
                    }

                    HStack(alignment: .top, spacing: 14) {
                        VStack(alignment: .leading, spacing: 2) {
                            SectionLabel(text: "Твоите домейни", icon: "list.bullet").padding(.bottom, 8)
                            if s.domains.isEmpty {
                                Text("Нямаш домейни в Spaceship.").foregroundColor(Theme.tertiary).font(.system(size: 12.5))
                            }
                            ForEach(s.domains) { d in
                                DomainRow(domain: d, selected: selectedDomain == d.name)
                                    .onTapGesture { select(d.name) }
                            }
                        }
                        .card()
                        .frame(width: 380)

                        VStack(alignment: .leading, spacing: 12) {
                            if let dom = selectedDomain {
                                HStack {
                                    Text(dom).font(.system(size: 17, weight: .bold)).foregroundColor(Theme.text)
                                    Spacer()
                                    Button { model.open(s.domains.first { $0.name == dom }?.dashboard) } label: { Label("Spaceship", systemImage: "arrow.up.right") }
                                        .bidButton(.ghost, compact: true)
                                    Button {
                                        model.domainForConnect = dom
                                        model.sheet = .connectDomain
                                    } label: { Label("Свържи с проект", systemImage: "link") }
                                        .bidButton(.primary, compact: true)
                                        .disabled(model.selected == nil)
                                        .help(model.selected == nil ? "Избери проект от страничната лента" : "Свързва с \(model.selected?.name ?? "")")
                                }
                                SectionLabel(text: "DNS записи", icon: "list.dash")
                                if loadingDNS {
                                    HStack { Spinner(size: 13); Text("Зареждам DNS…").foregroundColor(Theme.secondary).font(.system(size: 12)) }
                                } else if records.isEmpty {
                                    Text("Няма записи.").foregroundColor(Theme.tertiary).font(.system(size: 12))
                                } else {
                                    VStack(spacing: 0) {
                                        ForEach(records) { r in
                                            HStack(spacing: 12) {
                                                Text(r.type).font(.system(size: 11, weight: .bold, design: .monospaced))
                                                    .foregroundColor(Theme.accent).frame(width: 52, alignment: .leading)
                                                Text(r.name).font(.system(size: 12, design: .monospaced)).foregroundColor(Theme.text).frame(width: 90, alignment: .leading)
                                                Text(r.value).font(.system(size: 12, design: .monospaced)).foregroundColor(Theme.secondary)
                                                    .lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                                                Spacer()
                                                if let t = r.ttl { Text("\(t)s").font(.system(size: 11)).foregroundColor(Theme.tertiary) }
                                            }
                                            .padding(.vertical, 7)
                                            Rectangle().fill(Theme.hairline).frame(height: 1)
                                        }
                                    }
                                }
                            } else {
                                VStack(spacing: 10) {
                                    Image(systemName: "hand.point.left").font(.system(size: 26)).foregroundColor(Theme.tertiary)
                                    Text("Избери домейн, за да видиш DNS записите и да го свържеш с проект.")
                                        .font(.system(size: 12.5)).foregroundColor(Theme.secondary).multilineTextAlignment(.center)
                                }
                                .frame(maxWidth: .infinity, minHeight: 200)
                            }
                        }
                        .card()
                        .frame(maxWidth: .infinity)
                    }

                    HStack {
                        Text("Ключът се пази в macOS Keychain.").font(.system(size: 11.5)).foregroundColor(Theme.tertiary)
                        Spacer()
                        Button("Прекъсни връзката") { model.disconnectSpaceship() }.bidButton(.ghost, compact: true)
                    }
                } else {
                    SpaceshipConnectCard()
                }
            }
            .padding(.horizontal, 32)
            .padding(.top, 40)
            .padding(.bottom, 32)
            .frame(maxWidth: 1180)
            .frame(maxWidth: .infinity)
        }
        .task { if model.spaceship == nil { await model.loadSpaceship() } }
    }

    func select(_ name: String) {
        selectedDomain = name
        loadingDNS = true
        Task {
            records = await model.dns(name)
            loadingDNS = false
        }
    }
}

struct DomainRow: View {
    let domain: SpaceshipDomain
    let selected: Bool
    @Local private var hover = false

    var body: some View {
        let days = domain.daysLeft ?? 9999
        HStack(spacing: 10) {
            Image(systemName: "globe").foregroundColor(selected ? .white : Theme.accent).frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(domain.unicodeName ?? domain.name).font(.system(size: 13, weight: .semibold))
                    .foregroundColor(selected ? .white : Theme.text).lineLimit(1)
                HStack(spacing: 6) {
                    Text(domain.daysLeft.map { "изтича след \($0) дни" } ?? "—")
                    Text("·")
                    Text(domain.autoRenew ? "auto-renew" : "без auto-renew")
                }
                .font(.system(size: 11))
                .foregroundColor(selected ? Color.white.opacity(0.8) : (days < 30 ? Theme.warn : Theme.tertiary))
            }
            Spacer()
            if days < 30 {
                Image(systemName: "exclamationmark.triangle.fill").foregroundColor(selected ? .white : Theme.warn)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(selected ? Theme.accent : (hover ? Theme.elevated : .clear)))
        .contentShape(Rectangle())
        .onHover { hover = $0 }
    }
}

// MARK: - Connect Spaceship

struct SpaceshipConnectCard: View {
    @EnvironmentObject var model: AppModel
    @Local private var key = ""
    @Local private var secret = ""
    @Local private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: "network").font(.system(size: 22, weight: .semibold)).foregroundColor(Theme.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Свържи Spaceship").font(.system(size: 17, weight: .bold)).foregroundColor(Theme.text)
                    Text("Виждаш всички домейни, кога изтичат, DNS записите и свързваш домейн с Netlify с един бутон.")
                        .font(.system(size: 12.5)).foregroundColor(Theme.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                StepLine(n: 1, text: "Отвори API Manager в Spaceship (бутонът отдолу отваря браузъра).")
                StepLine(n: 2, text: "Натисни „New API key“, дай име „Before I Deploy“ и права за Domains и DNS records (четене + писане).")
                StepLine(n: 3, text: "Копирай API Key и API Secret и ги постави тук.")
            }
            Button { model.open("https://www.spaceship.com/application/api-manager/") } label: { Label("Отвори API Manager", systemImage: "safari") }
                .bidButton(.secondary)
            HStack(spacing: 10) {
                BIDTextField(placeholder: "API Key", text: $key, mono: true)
                SecureField("API Secret", text: $secret)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, design: .monospaced))
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).fill(Theme.bg))
                    .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
                Button {
                    busy = true
                    Task {
                        _ = await model.connectSpaceship(key: key, secret: secret)
                        busy = false
                    }
                } label: {
                    if busy { Spinner(size: 12, color: .white) } else { Text("Свържи") }
                }
                .bidButton(.primary)
                .disabled(key.isEmpty || secret.isEmpty || busy)
            }
            Text("Ключът се проверява веднага и се пази в macOS Keychain — не се записва във файлове.")
                .font(.system(size: 11.5)).foregroundColor(Theme.tertiary)
        }
        .card(padding: 22)
    }
}

struct StepLine: View {
    let n: Int
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)").font(.system(size: 11, weight: .bold)).foregroundColor(.white)
                .frame(width: 20, height: 20).background(Circle().fill(Theme.accent))
            Text(text).font(.system(size: 12.5)).foregroundColor(Theme.text).fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct SpaceshipConnectSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 0) {
            SpaceshipConnectCard()
                .padding(18)
            HStack {
                Spacer()
                Button("Затвори") { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 22).padding(.bottom, 16)
        }
        .frame(width: 640)
        .background(Theme.panel)
        .onChange(of: model.spaceship?.connected == true) { connected in
            if connected { dismiss() }
        }
    }
}

// MARK: - Project hosting tab: domain card

struct DomainProjectCard: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(title: "Домейн (Spaceship)", icon: "network",
                        status: model.spaceship?.connected == true ? "pass" : nil,
                        trailing: model.spaceship?.connected == true ? "\(model.spaceship?.domains.count ?? 0) домейна" : "не е свързан")
            if model.spaceship?.connected != true {
                HStack {
                    Text("Свържи Spaceship, за да сложиш собствен домейн на този сайт с един бутон.")
                        .font(.system(size: 12.5)).foregroundColor(Theme.secondary)
                    Spacer()
                    Button("Свържи Spaceship") { model.sheet = .spaceshipConnect }.bidButton(.primary, compact: true)
                }
            } else if status.detect.netlifyLinked != true {
                Text("Първо свържи проекта с Netlify (картата отгоре).").font(.system(size: 12.5)).foregroundColor(Theme.secondary)
            } else {
                Text("Избери домейн — ще настроя DNS в Spaceship (A @ и CNAME www) и ще го добавя в Netlify. SSL се издава автоматично.")
                    .font(.system(size: 12.5)).foregroundColor(Theme.secondary)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8)], spacing: 8) {
                    ForEach(model.spaceship?.domains ?? []) { d in
                        Button {
                            model.domainForConnect = d.name
                            model.sheet = .connectDomain
                        } label: {
                            HStack {
                                Image(systemName: "globe")
                                Text(d.name).lineLimit(1)
                                Spacer()
                                Image(systemName: "link")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .bidButton(.secondary, compact: true)
                    }
                }
            }
        }
        .card()
    }
}

// MARK: - Connect domain → Netlify (preview then apply)

struct ConnectDomainSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var plan: DomainPlan?
    @Local private var error: String?

    var domain: String { model.domainForConnect ?? "" }

    var body: some View {
        SheetScaffold(icon: "link", title: "Свържи \(domain)", subtitle: "с \(model.selected?.name ?? "проекта") в Netlify", width: 600) {
            VStack(alignment: .leading, spacing: 12) {
                if let error {
                    Text(error).foregroundColor(Theme.blocked).font(.system(size: 12.5))
                } else if let plan {
                    Text("Какво ще направя:").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.text)
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(plan.add, id: \.self) { r in
                            planRow(symbol: "plus.circle.fill", tint: Theme.ready, r: r)
                        }
                        ForEach(plan.replace, id: \.self) { r in
                            planRow(symbol: "minus.circle.fill", tint: Theme.blocked, r: r)
                        }
                        HStack(spacing: 8) {
                            Image(systemName: "globe").foregroundColor(Theme.accent)
                            Text("Netlify: custom domain \(plan.domain) + www.\(plan.domain)")
                                .font(.system(size: 12, design: .monospaced)).foregroundColor(Theme.text)
                        }
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.bg))
                    if !plan.replace.isEmpty {
                        Label("Записите в червено ще бъдат премахнати — сегашният сайт на този домейн спира да отговаря.", systemImage: "exclamationmark.triangle.fill")
                            .font(.system(size: 12)).foregroundColor(Theme.warn)
                    }
                    if let n = plan.note { Text(n).font(.system(size: 11.5)).foregroundColor(Theme.tertiary) }
                } else {
                    HStack { Spinner(size: 13); Text("Проверявам DNS…").foregroundColor(Theme.secondary).font(.system(size: 12.5)) }
                }
            }
        } actions: {
            Button("Отказ") { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button("Свържи домейна") {
                dismiss()
                model.applyDomain(domain)
            }
            .bidButton(.primary)
            .disabled(plan == nil)
        }
        .task {
            do { plan = try await model.planDomain(domain) } catch { self.error = error.localizedDescription }
        }
    }

    func planRow(symbol: String, tint: Color, r: PlanRecord) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).foregroundColor(tint)
            Text("\(r.type)  \(r.name)  →  \(r.value)").font(.system(size: 12, design: .monospaced)).foregroundColor(Theme.text)
        }
    }
}

// MARK: - Device code card (GitHub browser login)

struct DeviceCodeCard: View {
    @ObservedObject var session: RunSession
    var body: some View {
        if let code = session.deviceCode, !session.finished {
            VStack(spacing: 10) {
                Text("Потвърди в браузъра (\(session.deviceService ?? "GitHub"))").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.secondary)
                Text(code)
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                    .tracking(4)
                    .foregroundColor(Theme.text)
                    .textSelection(.enabled)
                Text("Кодът е копиран — постави го с ⌘V на отворената страница и натисни „Authorize“.")
                    .font(.system(size: 12)).foregroundColor(Theme.tertiary)
                if let u = session.deviceURL, let url = URL(string: u) {
                    Button { NSWorkspace.shared.open(url) } label: { Label("Отвори страницата отново", systemImage: "safari") }
                        .bidButton(.secondary, compact: true)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(18)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.accentSoft))
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
    }
}
