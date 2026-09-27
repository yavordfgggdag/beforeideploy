import SwiftUI

// MARK: - Page header

struct PageHeader<Trailing: View>: View {
    let title: String
    let subtitle: String
    let icon: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Theme.accentGradient)
                Image(systemName: icon).font(.system(size: 18, weight: .bold)).foregroundColor(.white)
            }
            .frame(width: 44, height: 44)
            .shadow(color: Theme.accent.opacity(0.35), radius: 12, y: 4)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 26, weight: .bold)).foregroundColor(Theme.text)
                Text(subtitle).font(.system(size: 12.5)).foregroundColor(Theme.secondary)
            }
            Spacer()
            trailing
        }
    }
}

struct KPITile: View {
    let value: String
    let label: String
    let icon: String
    var tint: Color = Theme.text

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundColor(tint.opacity(0.9))
                Spacer()
            }
            Text(value).font(.system(size: 28, weight: .bold)).foregroundColor(tint).monospacedDigit()
            Text(label).font(.system(size: 11.5)).foregroundColor(Theme.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 16)
    }
}

// MARK: - AI Fix bar

struct AIFixBar: View {
    @EnvironmentObject var model: AppModel
    let step: String
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !compact {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles").foregroundColor(Theme.accent)
                    Text("Оправи с AI — нов чат със специален prompt: лог, файлове, версии (ключовете се скриват)")
                        .font(.system(size: 11.5)).foregroundColor(Theme.secondary)
                }
            }
            HStack(spacing: 6) {
                Button { model.aiFix(step: step, target: "chatgpt") } label: { Label("Оправи в ChatGPT", systemImage: "bubble.left.and.bubble.right.fill") }
                    .bidButton(.primary, compact: true)
                    .help("Нов чат в ChatGPT с готов prompt")
                Button { model.aiFix(step: step, target: "claude") } label: { Label("Claude", systemImage: "sparkle") }
                    .bidButton(.secondary, compact: true)
                    .help("Нов чат в Claude с готов prompt")
                Button { model.aiFix(step: step, target: "codex") } label: { Label("Codex", systemImage: "terminal") }
                    .bidButton(.secondary, compact: true)
                    .help("Codex в папката на проекта — може да поправи кода сам")
                Button { model.aiFix(step: step, target: "claude-code") } label: { Label("Claude Code", systemImage: "chevron.left.forwardslash.chevron.right") }
                    .bidButton(.secondary, compact: true)
                    .help("Claude Code в папката на проекта")
                Button { model.aiFix(step: step, target: "copy") } label: { Image(systemName: "doc.on.doc") }
                    .bidButton(.ghost, compact: true)
                    .help("Само копирай prompt-а")
            }
        }
    }
}

// MARK: - Mission Control

struct MissionControlView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader(title: "Mission Control", subtitle: subtitle, icon: "square.grid.2x2.fill") {
                    HStack(spacing: 8) {
                        if model.loadingOverview { Spinner(size: 14) }
                        Button { Task { await model.loadOverview() } } label: { Label("Обнови", systemImage: "arrow.clockwise") }
                            .bidButton(.secondary, compact: true)
                        Button { model.addProjectPanel() } label: { Label("Проект", systemImage: "plus") }
                            .bidButton(.primary, compact: true)
                    }
                }

                if let setup = model.setup, setup.missingRequired > 0 {
                    SetupBanner(missing: setup.missingRequired)
                }

                if let o = model.overview {
                    HStack(spacing: 12) {
                        KPITile(value: "\(o.totals.projects)", label: "проекта", icon: "folder.fill")
                        KPITile(value: "\(o.totals.ready)", label: "ready to deploy", icon: "checkmark.seal.fill", tint: Theme.ready)
                        KPITile(value: "\(o.totals.blocked)", label: "blocked", icon: "xmark.octagon.fill", tint: o.totals.blocked > 0 ? Theme.blocked : Theme.text)
                        KPITile(value: "\(o.totals.online)/\(o.totals.live)", label: "сайта онлайн", icon: "dot.radiowaves.left.and.right",
                                tint: o.totals.online < o.totals.live ? Theme.warn : Theme.ready)
                    }

                    if !o.attention.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionLabel(text: "Изисква внимание", icon: "bell.badge.fill")
                            ForEach(o.attention) { a in
                                Button {
                                    Task { await model.select(a.key) }
                                } label: {
                                    HStack(spacing: 10) {
                                        Image(systemName: Theme.symbol(for: a.level)).foregroundColor(Theme.color(for: a.level))
                                        Text(a.text).font(.system(size: 12.5)).foregroundColor(Theme.text)
                                        Spacer()
                                        Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundColor(Theme.tertiary)
                                    }
                                    .padding(.vertical, 5)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .card()
                    }

                    if o.cards.isEmpty {
                        WelcomeView().frame(maxWidth: .infinity)
                    } else {
                        SectionLabel(text: "Проекти", icon: "square.stack.fill")
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14)], spacing: 14) {
                            ForEach(o.cards) { c in
                                ProjectOverviewCard(card: c)
                                    .onTapGesture { Task { await model.select(c.key) } }
                            }
                        }
                    }
                } else {
                    HStack { Spinner(size: 16); Text("Събирам статуса на всички проекти…").foregroundColor(Theme.secondary) }
                        .frame(maxWidth: .infinity, minHeight: 200)
                }
            }
            .padding(.horizontal, 32)
            .padding(.top, 40)
            .padding(.bottom, 32)
            .frame(maxWidth: 1180)
            .frame(maxWidth: .infinity)
        }
    }

    var subtitle: String {
        guard let o = model.overview else { return "Всички проекти на едно място" }
        return "Обновено \(Fmt.relative(o.at)) · live проверка на сайтовете и SSL"
    }
}

struct SetupBanner: View {
    @EnvironmentObject var model: AppModel
    let missing: Int
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "wand.and.stars").font(.system(size: 16, weight: .bold)).foregroundColor(Theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(missing) неща не са настроени").font(.system(size: 13.5, weight: .semibold)).foregroundColor(Theme.text)
                Text("Мога да ги инсталирам и свържа автоматично.").font(.system(size: 12)).foregroundColor(Theme.secondary)
            }
            Spacer()
            Button("Виж") { model.screen = .setup }.bidButton(.secondary, compact: true)
            Button { model.setupAuto() } label: { Label("Настрой автоматично", systemImage: "bolt.fill") }
                .bidButton(.primary, compact: true)
        }
        .card(padding: 14, fill: Theme.accentSoft)
    }
}

struct ProjectOverviewCard: View {
    let card: OverviewCard
    @Local private var hover = false

    var statusText: String {
        switch card.status {
        case "ready": return "READY"
        case "warnings": return "WARNINGS"
        case "blocked": return "BLOCKED"
        default: return "НЕПРОВЕРЕН"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Theme.accentSoft)
                    Text(String(card.name.prefix(1)).uppercased()).font(.system(size: 14, weight: .bold)).foregroundColor(Theme.accent)
                }
                .frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: 1) {
                    Text(card.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(Theme.text).lineLimit(1)
                    Text([card.framework, card.branch].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 11)).foregroundColor(Theme.tertiary)
                }
                Spacer()
                Text(statusText)
                    .font(.system(size: 10, weight: .heavy)).tracking(0.8)
                    .foregroundColor(Theme.color(for: card.status ?? "idle"))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Capsule().fill(Theme.color(for: card.status ?? "idle").opacity(0.14)))
            }

            VStack(alignment: .leading, spacing: 7) {
                if let live = card.liveUrl {
                    HStack(spacing: 7) {
                        StatusDot(status: card.uptime == nil ? nil : (card.uptime?.ok == true ? "pass" : "fail"), size: 7)
                        Text(Fmt.host(live)).font(.system(size: 12, design: .monospaced)).foregroundColor(Theme.secondary).lineLimit(1)
                        Spacer()
                        if let ms = card.uptime?.ms, card.uptime?.ok == true {
                            Text("\(ms) ms").font(.system(size: 11)).foregroundColor(Theme.tertiary)
                        }
                        if let d = card.sslDays {
                            Label("\(d)д", systemImage: "lock.fill")
                                .font(.system(size: 11)).foregroundColor(d < 14 ? Theme.warn : Theme.tertiary)
                        }
                    }
                } else {
                    Text("Няма live сайт").font(.system(size: 12)).foregroundColor(Theme.tertiary)
                }
                HStack(spacing: 14) {
                    Label("\(card.changed)", systemImage: "pencil.line").foregroundColor(card.changed > 0 ? Theme.warn : Theme.tertiary)
                    if let a = card.ahead, let b = card.behind { Text("↑\(a) ↓\(b)").foregroundColor(Theme.tertiary) }
                    if card.local != nil { Label("local", systemImage: "desktopcomputer").foregroundColor(Theme.ready) }
                    Spacer()
                    Text(card.lastProd != nil ? "LIVE \(Fmt.relative(card.lastProd))" : "без production")
                        .foregroundColor(Theme.tertiary)
                }
                .font(.system(size: 11.5))
                if !card.failing.isEmpty {
                    Text("Грешки: \(card.failing.joined(separator: ", "))")
                        .font(.system(size: 11.5, weight: .medium)).foregroundColor(Theme.blocked)
                }
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).fill(hover ? Theme.elevated : Theme.panel))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .strokeBorder(card.status == "blocked" ? Theme.blocked.opacity(0.4) : (hover ? Theme.accent.opacity(0.35) : Theme.hairline), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.25), radius: 12, y: 4)
        .contentShape(Rectangle())
        .onHover { hover = $0 }
        .animation(.easeOut(duration: 0.15), value: hover)
    }
}

// MARK: - Costs

struct CostsView: View {
    @EnvironmentObject var model: AppModel
    @Local private var minCredits = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader(title: "Разходи & кредити", subtitle: "Колко струва всяка операция и колко остава по акаунтите", icon: "creditcard.fill") {
                    HStack(spacing: 8) {
                        if model.loadingCosts { Spinner(size: 14) }
                        Button { Task { await model.loadCosts(refresh: true) } } label: { Label("Обнови от доставчиците", systemImage: "arrow.clockwise") }
                            .bidButton(.secondary, compact: true)
                    }
                }

                if let c = model.costs {
                    SectionLabel(text: "Акаунти", icon: "person.2.fill")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 14)], spacing: 14) {
                        ForEach(c.usage.providers) { p in ProviderCard(provider: p) }
                    }

                    SectionLabel(text: "Този месец (\(c.month))", icon: "calendar")
                    if c.totals.isEmpty {
                        Text("Още няма платени операции този месец.").font(.system(size: 12.5)).foregroundColor(Theme.tertiary)
                    } else {
                        HStack(spacing: 12) {
                            ForEach(c.totals, id: \.self) { t in
                                KPITile(value: Self.amount(t.amount), label: "\(t.service) · \(Self.unitName(t.unit))",
                                        icon: Self.icon(t.service), tint: t.unit == "credits" ? Theme.accent : Theme.text)
                            }
                        }
                    }

                    HStack(alignment: .top, spacing: 14) {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionLabel(text: "По проект", icon: "folder")
                            if c.byProject.isEmpty {
                                Text("—").foregroundColor(Theme.tertiary)
                            }
                            ForEach(c.byProject) { p in
                                HStack {
                                    Text(p.name).font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.text)
                                    Spacer()
                                    Text(p.items.map { "\(Self.amount($0.amount)) \(Self.unitName($0.unit))" }.joined(separator: " · "))
                                        .font(.system(size: 12)).foregroundColor(Theme.secondary)
                                }
                            }
                        }
                        .card()
                        .frame(maxWidth: .infinity)

                        VStack(alignment: .leading, spacing: 10) {
                            SectionLabel(text: "Бюджет", icon: "shield.lefthalf.filled")
                            Text("Предупреди ме, когато Netlify кредитите паднат под:")
                                .font(.system(size: 12)).foregroundColor(Theme.secondary)
                            HStack {
                                BIDTextField(placeholder: "\(Int(c.budgets.netlifyMinCredits ?? 50))", text: $minCredits, mono: true)
                                    .frame(width: 110)
                                Text("кредита").foregroundColor(Theme.secondary).font(.system(size: 12))
                                Spacer()
                                Button("Запази") {
                                    if let v = Double(minCredits) { model.setBudget(netlifyMin: v) }
                                }
                                .bidButton(.secondary, compact: true)
                                .disabled(Double(minCredits) == nil)
                            }
                        }
                        .card()
                        .frame(maxWidth: .infinity)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            SectionLabel(text: "Ценоразпис (оценки)", icon: "tag.fill")
                            Spacer()
                            Button("Редактирай") { model.openFile(c.pricesFile) }.bidButton(.ghost, compact: true)
                        }
                        ForEach(c.prices.items.keys.sorted(), id: \.self) { key in
                            let item = c.prices.items[key] ?? PriceItem(unit: "free", amount: 0, label: key)
                            HStack {
                                Text(item.label).font(.system(size: 12.5)).foregroundColor(Theme.text)
                                Spacer()
                                Text(item.unit == "free" ? "безплатно" : "~\(Self.amount(item.amount)) \(Self.unitName(item.unit))")
                                    .font(.system(size: 12.5, weight: .semibold))
                                    .foregroundColor(item.unit == "free" || item.amount == 0 ? Theme.ready : Theme.text)
                            }
                        }
                    }
                    .card()

                    VStack(alignment: .leading, spacing: 4) {
                        SectionLabel(text: "Всички операции", icon: "list.bullet.rectangle")
                            .padding(.bottom, 6)
                        if c.ledger.isEmpty {
                            Text("Още няма записи.").foregroundColor(Theme.tertiary).font(.system(size: 12))
                        }
                        ForEach(c.ledger) { e in
                            HStack(spacing: 12) {
                                Text(Fmt.time(e.ts)).font(.system(size: 11.5, design: .monospaced)).foregroundColor(Theme.tertiary).frame(width: 82, alignment: .leading)
                                Image(systemName: Self.icon(e.service)).foregroundColor(Theme.secondary).frame(width: 16)
                                Text(Self.opName(e.op)).font(.system(size: 12.5, weight: .medium)).foregroundColor(Theme.text)
                                Text(e.projectName ?? "").font(.system(size: 12)).foregroundColor(Theme.tertiary)
                                Spacer()
                                Text(e.unit == "free" || e.amount == 0 ? "0" : "\(e.estimated == true ? "~" : "")\(Self.amount(e.amount)) \(Self.unitName(e.unit))")
                                    .font(.system(size: 12.5, weight: .semibold))
                                    .foregroundColor(e.amount > 0 && e.unit == "credits" ? Theme.accent : Theme.secondary)
                            }
                            .padding(.vertical, 5)
                        }
                    }
                    .card()
                } else {
                    HStack { Spinner(size: 16); Text("Зареждам разходите…").foregroundColor(Theme.secondary) }
                        .frame(maxWidth: .infinity, minHeight: 200)
                }
            }
            .padding(.horizontal, 32)
            .padding(.top, 40)
            .padding(.bottom, 32)
            .frame(maxWidth: 1180)
            .frame(maxWidth: .infinity)
        }
        .task { if model.costs == nil { await model.loadCosts() } }
    }

    static func amount(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%.2f", v)
    }

    static func unitName(_ u: String) -> String {
        switch u {
        case "credits": return "кредита"
        case "messages": return "съобщ."
        case "tasks": return "задачи"
        case "usd": return "$"
        case "free": return ""
        default: return u
        }
    }

    static func icon(_ service: String) -> String {
        switch service {
        case "netlify": return "globe"
        case "chatgpt", "codex": return "bubble.left.and.bubble.right.fill"
        case "claude": return "sparkle"
        case "github": return "arrow.triangle.branch"
        case "spaceship": return "network"
        default: return "circle"
        }
    }

    static func opName(_ op: String) -> String {
        if op == "production" { return "Production deploy" }
        if op == "draft" { return "Draft preview" }
        if op.hasPrefix("aifix:") { return "AI Fix · \(op.dropFirst(6))" }
        return op
    }
}

struct ProviderCard: View {
    @EnvironmentObject var model: AppModel
    let provider: ProviderUsage

    var title: String {
        switch provider.service {
        case "netlify": return "Netlify"
        case "chatgpt": return "ChatGPT"
        case "claude": return "Claude"
        case "spaceship": return "Spaceship"
        default: return provider.service
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: CostsView.icon(provider.service)).foregroundColor(Theme.accent)
                Text(title).font(.system(size: 14, weight: .bold)).foregroundColor(Theme.text)
                Spacer()
                if provider.connected == true {
                    Chip(text: "свързан", tint: Theme.ready)
                } else if provider.connected == false {
                    Chip(text: "не е свързан", tint: Theme.blocked)
                } else {
                    Chip(text: "без API", tint: Theme.tertiary)
                }
            }
            if let accounts = provider.accounts, !accounts.isEmpty {
                ForEach(accounts, id: \.self) { a in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(a.name ?? a.slug ?? "Акаунт").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.text)
                            if let plan = a.plan { Chip(text: plan) }
                            Spacer()
                            if let d = a.dashboard {
                                Button { model.open(d) } label: { Image(systemName: "arrow.up.right.square") }
                                    .buttonStyle(.plain).foregroundColor(Theme.secondary).help("Usage в Netlify")
                            }
                        }
                        let quotas = (a.credits ?? []) + (a.quotas ?? [])
                        if quotas.isEmpty {
                            Text("Netlify не върна лимити за този план — виж Usage страницата.")
                                .font(.system(size: 11.5)).foregroundColor(Theme.tertiary)
                        }
                        ForEach(quotas.prefix(6), id: \.self) { q in QuotaRow(quota: q) }
                    }
                }
            } else {
                Text(provider.note ?? provider.error ?? "—").font(.system(size: 12)).foregroundColor(Theme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let d = provider.dashboard, provider.accounts == nil {
                Button { model.open(d) } label: { Label("Отвори лимитите", systemImage: "arrow.up.right") }
                    .bidButton(.ghost, compact: true)
            }
        }
        .card()
    }
}

struct QuotaRow: View {
    let quota: Quota
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(quota.name.replacingOccurrences(of: "_", with: " ")).font(.system(size: 11.5)).foregroundColor(Theme.secondary)
                Spacer()
                if let inc = quota.included, let used = quota.used {
                    Text("\(CostsView.amount(max(0, inc - used))) остават от \(CostsView.amount(inc))")
                        .font(.system(size: 11.5, weight: .semibold)).foregroundColor(Theme.text)
                } else if let v = quota.value {
                    Text(CostsView.amount(v)).font(.system(size: 11.5, weight: .semibold)).foregroundColor(Theme.text)
                }
            }
            if let inc = quota.included, let used = quota.used, inc > 0 {
                let frac = min(1, used / inc)
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.elevated)
                        Capsule().fill(frac > 0.8 ? Theme.blocked : Theme.accent).frame(width: g.size.width * frac)
                    }
                }
                .frame(height: 5)
            }
        }
    }
}

// MARK: - Setup

struct SetupView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader(title: "Настройка", subtitle: "Всичко, от което зависи workflow-ът — с бутон за автоматична настройка", icon: "wand.and.stars") {
                    HStack(spacing: 8) {
                        if model.loadingSetup { Spinner(size: 14) }
                        Button { Task { await model.loadSetup() } } label: { Label("Обнови", systemImage: "arrow.clockwise") }
                            .bidButton(.secondary, compact: true)
                    }
                }

                if let s = model.setup {
                    let done = s.items.filter(\.ok).count
                    HStack(spacing: 18) {
                        ZStack {
                            Circle().stroke(Theme.elevated, lineWidth: 7)
                            Circle()
                                .trim(from: 0, to: s.items.isEmpty ? 0 : CGFloat(done) / CGFloat(s.items.count))
                                .stroke(Theme.accentGradient, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                            Text("\(done)/\(s.items.count)").font(.system(size: 14, weight: .bold)).foregroundColor(Theme.text)
                        }
                        .frame(width: 64, height: 64)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(s.ready ? "Всичко задължително е настроено" : "\(s.missingRequired) задължителни неща липсват")
                                .font(.system(size: 17, weight: .bold)).foregroundColor(Theme.text)
                            Text("\(s.missingOptional) допълнителни неща (AI помощници, Spaceship) можеш да добавиш по желание.")
                                .font(.system(size: 12.5)).foregroundColor(Theme.secondary)
                        }
                        Spacer()
                        Button { model.setupAuto() } label: { Label("Настрой всичко автоматично", systemImage: "bolt.fill") }
                            .bidButton(.primary)
                            .disabled(s.ready)
                    }
                    .card(padding: 20)

                    ForEach(groups(s.items)) { group in
                        VStack(alignment: .leading, spacing: 4) {
                            SectionLabel(text: group.name).padding(.bottom, 6)
                            ForEach(group.items) { item in
                                SetupRow(item: item)
                                if item.id != group.items.last?.id { Rectangle().fill(Theme.hairline).frame(height: 1) }
                            }
                        }
                        .card()
                    }
                } else {
                    HStack { Spinner(size: 16); Text("Проверявам средата…").foregroundColor(Theme.secondary) }
                        .frame(maxWidth: .infinity, minHeight: 200)
                }
            }
            .padding(.horizontal, 32)
            .padding(.top, 40)
            .padding(.bottom, 32)
            .frame(maxWidth: 1000)
            .frame(maxWidth: .infinity)
        }
    }

    struct SetupGroup: Identifiable {
        let name: String
        let items: [SetupItem]
        var id: String { name }
    }

    func groups(_ items: [SetupItem]) -> [SetupGroup] {
        var order: [String] = []
        var map: [String: [SetupItem]] = [:]
        for i in items {
            if map[i.group] == nil { order.append(i.group) }
            map[i.group, default: []].append(i)
        }
        return order.map { SetupGroup(name: $0, items: map[$0] ?? []) }
    }
}

struct SetupRow: View {
    @EnvironmentObject var model: AppModel
    let item: SetupItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.ok ? "checkmark.circle.fill" : (item.optional ? "circle.dashed" : "exclamationmark.circle.fill"))
                .font(.system(size: 15))
                .foregroundColor(item.ok ? Theme.ready : (item.optional ? Theme.tertiary : Theme.accent))
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(item.title).font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.text)
                    if item.optional && !item.ok {
                        Text("по желание").font(.system(size: 10, weight: .semibold)).foregroundColor(Theme.tertiary)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Capsule().fill(Theme.elevated))
                    }
                }
                Text(item.detail ?? "").font(.system(size: 11.5)).foregroundColor(Theme.tertiary).lineLimit(1)
            }
            Spacer()
            if let a = item.action {
                if let d = a.display {
                    Text(d).font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.tertiary).lineLimit(1)
                }
                Button(a.label) { model.setupAction(item) }
                    .bidButton(item.optional ? .secondary : .primary, compact: true)
            }
        }
        .padding(.vertical, 8)
    }
}
