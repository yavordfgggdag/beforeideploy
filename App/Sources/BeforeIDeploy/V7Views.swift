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
            .breath(Theme.accent)
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
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(tint == Theme.text ? Theme.accent : tint)
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill((tint == Theme.text ? Theme.accent : tint).opacity(0.14)))
                Spacer()
            }
            if let n = Int(value) {
                CountUp(target: n, format: { String($0) }, font: .system(size: 28, weight: .bold, design: .rounded), color: tint)
            } else {
                Text(value).font(.system(size: 28, weight: .bold, design: .rounded)).foregroundColor(tint).monospacedDigit()
            }
            Text(label).font(.system(size: 11.5)).foregroundColor(Theme.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 16)
        .lift(tint: tint == Theme.text ? Theme.accent : tint)
        .accessibilityElement(children: .combine)
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
                    Text(L("aifix.help"))
                        .font(.system(size: 11.5)).foregroundColor(Theme.secondary)
                }
            }
            let builtin = model.account?.features?.aiBuiltin == true
            HStack(spacing: 6) {
                if builtin {
                    Button { model.aiStore.start(step: step) } label: { Label(L("ai.fixButton"), systemImage: "sparkles") }
                        .bidButton(.primary, compact: true)
                        .help(L("ai.fixHelp"))
                    if model.account?.features?.aiDeep == true {
                        Button { model.aiStore.start(step: step, deep: true) } label: { Label(L("ai.deepButton"), systemImage: "brain") }
                            .bidButton(.secondary, compact: true)
                            .help(L("ai.deepHelp"))
                    }
                } else if model.account?.canUseOwnKey == true {
                    Button { model.sheet = .aiKeys } label: { Label(L("ai.addKeyButton"), systemImage: "key.fill") }
                        .bidButton(.primary, compact: true)
                        .help(L("ai.addKeyHelp"))
                } else {
                    Button { model.aiUnavailableAction() } label: { Label(L("ai.fixButton"), systemImage: "sparkles") }
                        .bidButton(.primary, compact: true)
                        .help(L("ai.planHelp"))
                }
                Button { model.openAssistant() } label: { Label(L("ai.askAssistant"), systemImage: "bubble.left.and.text.bubble") }
                    .bidButton(.secondary, compact: true)
                    .help(L("ai.askAssistantHelp"))
                if compact {
                    // the hero card has no room for five external buttons: one menu, same actions
                    Menu {
                        Button { model.aiFix(step: step, target: "chatgpt") } label: { Label(L("aifix.chatgpt"), systemImage: "bubble.left.and.bubble.right.fill") }
                        Button { model.aiFix(step: step, target: "claude") } label: { Label("Claude", systemImage: "sparkle") }
                        Button { model.aiFix(step: step, target: "codex") } label: { Label("Codex", systemImage: "terminal") }
                        Button { model.aiFix(step: step, target: "claude-code") } label: { Label("Claude Code", systemImage: "chevron.left.forwardslash.chevron.right") }
                        Divider()
                        Button { model.aiFix(step: step, target: "copy") } label: { Label(L("aifix.copyOnly"), systemImage: "doc.on.doc") }
                    } label: {
                        Label(L("aifix.external"), systemImage: "arrow.up.right.square")
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .help(L("aifix.externalHelp"))
                } else {
                    Button { model.aiFix(step: step, target: "chatgpt") } label: { Label(L("aifix.chatgpt"), systemImage: "bubble.left.and.bubble.right.fill") }
                        .bidButton(builtin ? .secondary : .primary, compact: true)
                        .help(L("aifix.chatgptHelp"))
                    Button { model.aiFix(step: step, target: "claude") } label: { Label("Claude", systemImage: "sparkle") }
                        .bidButton(.secondary, compact: true)
                        .help(L("aifix.claudeHelp"))
                    Button { model.aiFix(step: step, target: "codex") } label: { Label("Codex", systemImage: "terminal") }
                        .bidButton(.secondary, compact: true)
                        .help(L("aifix.codexHelp"))
                    Button { model.aiFix(step: step, target: "claude-code") } label: { Label("Claude Code", systemImage: "chevron.left.forwardslash.chevron.right") }
                        .bidButton(.secondary, compact: true)
                        .help(L("aifix.claudeCodeHelp"))
                    Button { model.aiFix(step: step, target: "copy") } label: { Image(systemName: "doc.on.doc") }
                        .bidButton(.ghost, compact: true)
                        .help(L("aifix.copyOnly"))
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Mission Control

struct MissionControlView: View {
    @EnvironmentObject var model: AppModel
    @Local private var query = ""
    @Local private var client = ""
    @Local private var provider = ""
    @Local private var onlyAction = false
    @Local private var onlyProblems = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader(title: L("nav.missionControl"), subtitle: subtitle, icon: "square.grid.2x2.fill") {
                    HStack(spacing: 8) {
                        if model.loadingOverview { Spinner(size: 14) }
                        Button { Task { await model.loadOverview() } } label: { Label(L("common.refresh"), systemImage: "arrow.clockwise") }
                            .bidButton(.secondary, compact: true)
                        Button { model.addProjectPanel() } label: { Label(L("common.project"), systemImage: "plus") }
                            .bidButton(.primary, compact: true)
                    }
                }

                if let setup = model.setup, setup.missingRequired > 0 {
                    SetupBanner(missing: setup.missingRequired)
                }

                if let o = model.overview {
                    HStack(spacing: 12) {
                        KPITile(value: "\(o.totals.projects)", label: L("common.projectsCaption"), icon: "folder.fill").entrance(0)
                        KPITile(value: "\(o.totals.ready)", label: L("overview.readyToDeploy"), icon: "checkmark.seal.fill", tint: Theme.ready).entrance(1)
                        KPITile(value: "\(o.totals.blocked)", label: L("overview.blockedCaption"), icon: "xmark.octagon.fill", tint: o.totals.blocked > 0 ? Theme.blocked : Theme.text).entrance(2)
                        KPITile(value: "\(o.totals.online)/\(o.totals.live)", label: L("overview.sitesOnline"), icon: "dot.radiowaves.left.and.right",
                                tint: o.totals.online < o.totals.live ? Theme.warn : Theme.ready).entrance(3)
                    }

                    if !o.attention.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionLabel(text: L("overview.attention"), icon: "bell.badge.fill")
                            ForEach(o.attention) { a in
                                HStack(spacing: 10) {
                                    Button {
                                        Task { await model.select(a.key) }
                                    } label: {
                                        HStack(spacing: 10) {
                                            Image(systemName: Theme.symbol(for: a.level)).foregroundColor(Theme.color(for: a.level))
                                            Text(a.text).font(.system(size: 12.5)).foregroundColor(Theme.text)
                                            Spacer()
                                        }
                                        .padding(.vertical, 5)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    Button { model.openAssistant(projectKey: a.key) } label: { Label(L("ai.askAssistant"), systemImage: "sparkles") }
                                        .bidButton(.ghost, compact: true)
                                        .help(L("ai.askAssistantHelp"))
                                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundColor(Theme.tertiary)
                                }
                            }
                        }
                        .card()
                        .entrance(4)
                    }

                    MonitorCard().entrance(5)

                    if o.cards.isEmpty {
                        WelcomeView().frame(maxWidth: .infinity)
                    } else {
                        filterBar(o)
                        let shown = filtered(o.cards)
                        if shown.isEmpty {
                            VStack(spacing: 8) {
                                EmptyLine(icon: "line.3.horizontal.decrease.circle", text: L("portfolio.noMatch"))
                                Button(L("portfolio.clear")) { query = ""; client = ""; provider = ""; onlyAction = false; onlyProblems = false }.bidButton(.secondary, compact: true)
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 20)
                        } else {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 14, alignment: .top)], spacing: 14) {
                                ForEach(Array(shown.enumerated()), id: \.element.id) { i, c in
                                    ProjectOverviewCard(card: c)
                                        .tapAction { Task { await model.select(c.key) } }
                                        .entrance(4 + i)
                                }
                            }
                        }
                    }
                } else if let e = model.loadErrors["overview"] {
                    LoadFailedView(message: e) { await model.loadOverview() }
                } else {
                    MissionControlSkeleton()
                        .accessibilityLabel(L("overview.loading"))
                }
            }
            .padding(.horizontal, 32)
            .padding(.top, 40)
            .padding(.bottom, 32)
            .frame(maxWidth: 1180)
            .frame(maxWidth: .infinity)
        }
        .task { await model.loadMonitor() }
    }

    var subtitle: String {
        guard let o = model.overview else { return L("overview.title") }
        return L("overview.updated", Fmt.relative(o.at))
    }

    private func filterBar(_ o: Overview) -> some View {
        let clients = Array(Set(o.cards.compactMap { $0.client }.filter { !$0.isEmpty })).sorted()
        let providers = Array(Set(o.cards.compactMap { $0.hosting })).sorted()
        return HStack(spacing: 10) {
            SectionLabel(text: L("common.projects"), icon: "square.stack.fill")
            Spacer()
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundColor(Theme.tertiary)
                TextField(L("portfolio.search"), text: $query).textFieldStyle(.plain).font(.system(size: 12.5)).frame(width: 200)
            }
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.panel))
            if !clients.isEmpty {
                Picker("", selection: $client) {
                    Text(L("portfolio.allClients")).tag("")
                    ForEach(clients, id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden().frame(width: 150)
            }
            if providers.count > 1 {
                Picker("", selection: $provider) {
                    Text(L("portfolio.allProviders")).tag("")
                    ForEach(providers, id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden().frame(width: 130)
            }
            Toggle(L("portfolio.needsAction"), isOn: $onlyAction).toggleStyle(.checkbox).font(.system(size: 12))
            Toggle(L("portfolio.problems"), isOn: $onlyProblems).toggleStyle(.checkbox).font(.system(size: 12))
        }
    }

    private func filtered(_ cards: [OverviewCard]) -> [OverviewCard] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return cards.filter { c in
            if !client.isEmpty, c.client != client { return false }
            if !provider.isEmpty, c.hosting != provider { return false }
            if onlyAction, (c.nextAction?.id ?? "none") == "none" { return false }
            if onlyProblems, !(c.status == "blocked" || (c.signals?.values.contains { $0.state == "problem" } ?? false)) { return false }
            if !q.isEmpty {
                let hay = [c.name, c.client ?? "", c.liveUrl.map(Fmt.host) ?? "", c.framework ?? ""].joined(separator: " ").lowercased()
                if !hay.contains(q) { return false }
            }
            return true
        }
    }
}

struct SetupBanner: View {
    @EnvironmentObject var model: AppModel
    let missing: Int
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "wand.and.stars").font(.system(size: 16, weight: .bold)).foregroundColor(Theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(L("overview.missingSetup", count: missing)).font(.system(size: 13.5, weight: .semibold)).foregroundColor(Theme.text)
                Text(L("overview.missingSetupHint")).font(.system(size: 12)).foregroundColor(Theme.secondary)
            }
            Spacer()
            Button(L("overview.view")) { model.screen = .setup }.bidButton(.secondary, compact: true)
            Button { model.setupAuto() } label: { Label(L("overview.autoSetup"), systemImage: "bolt.fill") }
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
        case "ready": return L("status.ready")
        case "warnings": return L("status.warnings")
        case "blocked": return L("status.blocked")
        default: return L("overview.unchecked")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                ProjectAvatar(name: card.name, size: 32)
                VStack(alignment: .leading, spacing: 1) {
                    Text(card.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(Theme.text).lineLimit(1)
                    Text([card.client ?? L("portfolio.noClient"), card.framework.map { $0 == "unknown" ? L("framework.unknown") : $0 }, card.branch].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 11)).foregroundColor(Theme.tertiary).lineLimit(1)
                }
                Spacer()
                Text(statusText)
                    .font(.system(size: 10, weight: .heavy)).tracking(0.8)
                    .lineLimit(1).fixedSize() // "ПРЕДУПРЕЖДЕНИЯ" must never break onto two lines
                    .foregroundColor(Theme.color(for: card.status ?? "idle"))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Capsule().fill(Theme.color(for: card.status ?? "idle").opacity(0.14)))
                    .modifier(Breath(color: Theme.color(for: card.status ?? "idle"), strong: card.status == "blocked"))
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
                            Label(L("overview.daysShort", d), systemImage: "lock.fill")
                                .font(.system(size: 11)).foregroundColor(d < 14 ? Theme.warn : Theme.tertiary)
                        }
                    }
                } else {
                    Text(L("overview.noLiveSite")).font(.system(size: 12)).foregroundColor(Theme.tertiary)
                }
                HStack(spacing: 14) {
                    Label("\(card.changed)", systemImage: "pencil.line").foregroundColor(card.changed > 0 ? Theme.warn : Theme.tertiary)
                    if let a = card.ahead, let b = card.behind { Text("↑\(a) ↓\(b)").foregroundColor(Theme.tertiary) }
                    if card.local != nil { Label(L("overview.localRunning"), systemImage: "desktopcomputer").foregroundColor(Theme.ready) }
                    Spacer()
                    Text(card.lastProd != nil ? L("overview.liveAgo", Fmt.relative(card.lastProd)) : L("overview.noProduction"))
                        .foregroundColor(Theme.tertiary)
                }
                .font(.system(size: 11.5))
                if !card.failing.isEmpty {
                    Text(L("overview.failing", card.failing.joined(separator: ", ")))
                        .font(.system(size: 11.5, weight: .medium)).foregroundColor(Theme.blocked)
                }
                if let sig = card.signals {
                    // wraps onto a second row instead of squeezing five pills into one (text broke letter by letter)
                    FlowLayout(spacing: 6, lineSpacing: 6) {
                        SignalPill(name: L("signal.deploy"), signal: sig["deploy"], icon: "paperplane")
                        SignalPill(name: L("signal.uptime"), signal: sig["uptime"], icon: "dot.radiowaves.left.and.right")
                        SignalPill(name: L("signal.ssl"), signal: sig["ssl"], icon: "lock.fill")
                        SignalPill(name: L("signal.domain"), signal: sig["domain"], icon: "globe")
                        SignalPill(name: L("signal.backup"), signal: sig["backup"], icon: "externaldrive")
                    }
                }
                if let next = card.nextAction, next.id != "none" {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.right.circle.fill").foregroundColor(Theme.accent)
                        Text(next.label).font(.system(size: 11.5, weight: .semibold)).foregroundColor(Theme.text)
                    }
                }
            }
        }
        .card(padding: 16, fill: hover ? Theme.elevated : Theme.panel,
              tint: card.status == "blocked" ? Theme.blocked : (card.status == "ready" ? Theme.ready : nil))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .strokeBorder(card.status == "blocked" ? Theme.blocked.opacity(0.4) : (hover ? Theme.accent.opacity(0.35) : .clear), lineWidth: 1)
        )
        .offset(y: hover && !Motion.reduced ? -2 : 0)
        .contentShape(Rectangle())
        .onHover { hover = $0 }
        .lift(tint: Theme.color(for: card.status ?? "idle"), amount: 1.015)
        .animation(Motion.quick, value: hover)
    }
}

// MARK: - Costs

struct CostsView: View {
    @EnvironmentObject var model: AppModel
    @Local private var minCredits = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader(title: L("common.costs"), subtitle: L("costs.subtitle"), icon: "creditcard.fill") {
                    HStack(spacing: 8) {
                        if model.loadingCosts { Spinner(size: 14) }
                        Button { Task { await model.loadCosts(refresh: true) } } label: { Label(L("costs.refreshProviders"), systemImage: "arrow.clockwise") }
                            .bidButton(.secondary, compact: true)
                    }
                }

                if let c = model.costs {
                    SectionLabel(text: L("costs.accounts"), icon: "person.2.fill")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 14)], spacing: 14) {
                        ForEach(Array(c.usage.providers.enumerated()), id: \.element.id) { i, p in
                            ProviderCard(provider: p).lift().entrance(i + 1)
                        }
                    }

                    SectionLabel(text: L("costs.thisMonth", c.month), icon: "calendar")
                    if c.totals.isEmpty {
                        Text(L("costs.noPaidOps")).font(.system(size: 12.5)).foregroundColor(Theme.tertiary)
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
                            SectionLabel(text: L("costs.byProject"), icon: "folder")
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
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .card()

                        VStack(alignment: .leading, spacing: 10) {
                            SectionLabel(text: L("costs.budget"), icon: "shield.lefthalf.filled")
                            Text(L("costs.budgetHint"))
                                .font(.system(size: 12)).foregroundColor(Theme.secondary)
                            HStack {
                                BIDTextField(placeholder: "\(Int(c.budgets.netlifyMinCredits ?? 50))", text: $minCredits, mono: true)
                                    .frame(width: 110)
                                Text(L("common.creditsUnit")).foregroundColor(Theme.secondary).font(.system(size: 12))
                                Spacer()
                                Button(L("common.save")) {
                                    if let v = Double(minCredits) { model.setBudget(netlifyMin: v) }
                                }
                                .bidButton(.secondary, compact: true)
                                .disabled(Double(minCredits) == nil)
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .card()
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            SectionLabel(text: L("costs.priceTable"), icon: "tag.fill")
                            Spacer()
                            Button(L("costs.edit")) { model.openFile(c.pricesFile) }.bidButton(.ghost, compact: true)
                        }
                        ForEach(c.prices.items.keys.sorted(), id: \.self) { key in
                            let item = c.prices.items[key] ?? PriceItem(unit: "free", amount: 0, label: key)
                            HStack {
                                Text(item.label).font(.system(size: 12.5)).foregroundColor(Theme.text)
                                Spacer()
                                Text(item.unit == "free" ? L("common.free") : "~\(Self.amount(item.amount)) \(Self.unitName(item.unit))")
                                    .font(.system(size: 12.5, weight: .semibold))
                                    .foregroundColor(item.unit == "free" || item.amount == 0 ? Theme.ready : Theme.text)
                            }
                        }
                    }
                    .card()

                    VStack(alignment: .leading, spacing: 4) {
                        SectionLabel(text: L("costs.allOperations"), icon: "list.bullet.rectangle")
                            .padding(.bottom, 6)
                        if c.ledger.isEmpty {
                            Text(L("costs.noEntries")).foregroundColor(Theme.tertiary).font(.system(size: 12))
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
                } else if let e = model.loadErrors["costs"] {
                    LoadFailedView(message: e) { await model.loadCosts() }
                } else {
                    HStack { Spinner(size: 16); Text(L("costs.loading")).foregroundColor(Theme.secondary) }
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
        case "credits": return L("common.creditsUnit")
        case "messages": return L("costs.unitMessages")
        case "tasks": return L("costs.unitTasks")
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
                    Chip(text: L("common.connectedLower"), tint: Theme.ready)
                } else if provider.connected == false {
                    Chip(text: L("common.notConnectedLower"), tint: Theme.blocked)
                } else {
                    Chip(text: L("costs.noApi"), tint: Theme.tertiary)
                }
            }
            if let accounts = provider.accounts, !accounts.isEmpty {
                ForEach(accounts, id: \.self) { a in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(a.name ?? a.slug ?? L("common.account")).font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.text)
                            if let plan = a.plan { Chip(text: plan) }
                            Spacer()
                            if let d = a.dashboard {
                                Button { model.open(d) } label: { Image(systemName: "arrow.up.right.square") }
                                    .buttonStyle(.plain).foregroundColor(Theme.secondary).help(L("costs.netlifyUsage"))
                            }
                        }
                        let quotas = (a.credits ?? []) + (a.quotas ?? [])
                        if quotas.isEmpty {
                            Text(L("costs.noLimits"))
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
                Button { model.open(d) } label: { Label(L("costs.openLimits"), systemImage: "arrow.up.right") }
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
                Text(quota.label ?? quota.name.replacingOccurrences(of: "_", with: " ")).font(.system(size: 11.5)).foregroundColor(Theme.secondary)
                Spacer()
                if let inc = quota.included, let used = quota.used {
                    Text(L("costs.remainingOf", CostsView.amount(max(0, inc - used)), CostsView.amount(inc)))
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
                PageHeader(title: L("common.setup"), subtitle: L("setup.subtitle"), icon: "wand.and.stars") {
                    HStack(spacing: 8) {
                        if model.loadingSetup { Spinner(size: 14) }
                        Button { Task { await model.loadSetup() } } label: { Label(L("common.refresh"), systemImage: "arrow.clockwise") }
                            .bidButton(.secondary, compact: true)
                    }
                }

                if let s = model.setup {
                    let required = s.items.filter { !$0.optional }
                    let done = required.filter(\.ok).count
                    HStack(spacing: 18) {
                        ZStack {
                            ProgressRing(fraction: required.isEmpty ? 1 : Double(done) / Double(required.count))
                            Text("\(done)/\(required.count)").font(.system(size: 14, weight: .bold)).foregroundColor(Theme.text)
                        }
                        .frame(width: 64, height: 64)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(s.ready ? L("setup.allRequiredSet") : L("setup.missingRequired", count: s.missingRequired))
                                .font(.system(size: 17, weight: .bold)).foregroundColor(Theme.text)
                            Text(L("setup.missingOptional", count: s.missingOptional))
                                .font(.system(size: 12.5)).foregroundColor(Theme.secondary)
                        }
                        Spacer()
                        Button { model.setupAuto() } label: { Label(L("setup.autoAll"), systemImage: "bolt.fill") }
                            .bidButton(.primary)
                            .disabled(s.ready || model.loadingSetup || model.run?.finished == false)
                    }
                    .card(padding: 20)
                    .glowBorder(s.ready ? Theme.ready : Theme.accent, strength: 0.8)
                    .entrance(0)

                    if model.account?.canUseOwnKey == true { AIKeysCard().lift().entrance(1) }

                    ForEach(Array(groups(s.items).enumerated()), id: \.element.id) { gi, group in
                        VStack(alignment: .leading, spacing: 4) {
                            SectionLabel(text: group.name).padding(.bottom, 6)
                            ForEach(Array(group.items.enumerated()), id: \.element.id) { ii, item in
                                SetupRow(item: item).entrance(gi * 3 + ii + 2, offset: 8)
                                if item.id != group.items.last?.id { Rectangle().fill(Theme.hairline).frame(height: 1) }
                            }
                        }
                        .card()
                        .lift()
                        .entrance(gi + 1)
                    }
                } else if let e = model.loadErrors["setup"] {
                    LoadFailedView(message: e) { await model.loadSetup() }
                } else {
                    HStack { Spinner(size: 16); Text(L("setup.checking")).foregroundColor(Theme.secondary) }
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
                        Text(L("setup.optional")).font(.system(size: 10, weight: .semibold)).foregroundColor(Theme.tertiary)
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
