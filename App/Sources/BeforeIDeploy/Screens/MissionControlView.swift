import SwiftUI

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
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: Space.m)], spacing: Space.m) {
                        KPITile(value: "\(o.totals.projects)", label: L("common.projectsCaption"), icon: "folder.fill")
                        KPITile(value: "\(o.totals.ready)", label: L("overview.readyToDeploy"), icon: "checkmark.seal.fill", tint: Theme.ready)
                        KPITile(value: "\(o.totals.blocked)", label: L("overview.blockedCaption"), icon: "xmark.octagon.fill", tint: o.totals.blocked > 0 ? Theme.blocked : Theme.text)
                        KPITile(value: "\(o.totals.online)/\(o.totals.live)", label: L("overview.sitesOnline"), icon: "dot.radiowaves.left.and.right",
                                tint: o.totals.online < o.totals.live ? Theme.warn : Theme.ready)
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
                                            Text(a.text).font(Typo.font(.body)).foregroundColor(Theme.text)
                                            Spacer()
                                        }
                                        .padding(.vertical, 5)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    Button { model.openAssistant(projectKey: a.key) } label: { Label(L("ai.askAssistant"), systemImage: "sparkles") }
                                        .bidButton(.ghost, compact: true)
                                        .help(L("ai.askAssistantHelp"))
                                    Image(systemName: "chevron.right").font(Typo.font(.micro, weight: .bold)).foregroundColor(Theme.tertiary)
                                }
                            }
                        }
                        .card()

                    }

                    MonitorCard()

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
            .padding(.horizontal, Space.page)
            .padding(.top, Space.top)
            .padding(.bottom, Space.page)
            .frame(maxWidth: 1120)
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
        return FlowLayout(spacing: Space.m) {
            SectionLabel(text: L("common.projects"), icon: "square.stack.fill")
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundColor(Theme.tertiary)
                TextField(L("portfolio.search"), text: $query).textFieldStyle(.plain).font(Typo.font(.body)).frame(width: 200)
            }
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.panel))
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
                    ForEach(providers, id: \.self) { Text(K.provider($0)).tag($0) }
                }
                .labelsHidden().frame(width: 130)
            }
            Toggle(L("portfolio.needsAction"), isOn: $onlyAction).toggleStyle(.checkbox).font(Typo.font(.callout))
            Toggle(L("portfolio.problems"), isOn: $onlyProblems).toggleStyle(.checkbox).font(Typo.font(.callout))
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
            Image(systemName: "wand.and.stars").font(Typo.font(.headline, weight: .bold)).foregroundColor(Theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(L("overview.missingSetup", count: missing)).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(Theme.text)
                Text(L("overview.missingSetupHint")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
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
                    Text(card.name).font(Typo.font(.subhead, weight: .bold)).foregroundColor(Theme.text).lineLimit(2).help(card.name)
                    Text([card.client ?? L("portfolio.noClient"), card.framework.map { $0 == "unknown" ? L("framework.unknown") : $0 }, card.branch].compactMap { $0 }.joined(separator: " · "))
                        .font(Typo.font(.caption)).foregroundColor(Theme.tertiary).lineLimit(1)
                }
                Spacer()
                Text(statusText)
                    .font(Typo.font(.micro, weight: .heavy)).tracking(0.8)
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
                        Text(Fmt.host(live)).font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.secondary).lineLimit(1)
                        Spacer()
                        if let ms = card.uptime?.ms, card.uptime?.ok == true {
                            Text("\(ms) ms").font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                        }
                        if let d = card.sslDays {
                            Label(L("overview.daysShort", d), systemImage: "lock.fill")
                                .font(Typo.font(.caption)).foregroundColor(d < 14 ? Theme.warn : Theme.tertiary)
                        }
                    }
                } else {
                    Text(L("overview.noLiveSite")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                }
                HStack(spacing: 14) {
                    Label("\(card.changed)", systemImage: "pencil.line").foregroundColor(card.changed > 0 ? Theme.warn : Theme.tertiary)
                    if let a = card.ahead, let b = card.behind { Text("↑\(a) ↓\(b)").foregroundColor(Theme.tertiary) }
                    if card.local != nil { Label(L("overview.localRunning"), systemImage: "desktopcomputer").foregroundColor(Theme.ready) }
                    Spacer()
                    Text(card.lastProd != nil ? L("overview.liveAgo", Fmt.relative(card.lastProd)) : L("overview.noProduction"))
                        .foregroundColor(Theme.tertiary)
                }
                .font(Typo.font(.callout))
                if !card.failing.isEmpty {
                    Text(L("overview.failing", card.failing.joined(separator: ", ")))
                        .font(Typo.font(.callout, weight: .medium)).foregroundColor(Theme.blocked)
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
                        Text(next.label).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
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
