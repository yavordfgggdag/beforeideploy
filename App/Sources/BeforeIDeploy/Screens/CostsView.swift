import SwiftUI

// MARK: - Costs

struct CostsView: View {
    @EnvironmentObject var model: AppModel
    @Local private var minCredits = ""
    @Local private var allOperations = false

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
                    if let pricing = c.cloudPricing { CloudPriceCard(pricing: pricing) }
                    SectionLabel(text: L("costs.accounts"), icon: "person.2.fill")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 14)], spacing: 14) {
                        ForEach(Array(c.usage.providers.enumerated()), id: \.element.id) { i, p in
                            ProviderCard(provider: p).lift()
                        }
                    }

                    SectionLabel(text: L("costs.thisMonth", c.month), icon: "calendar")
                    if c.totals.isEmpty {
                        Text(L("costs.noPaidOps")).font(Typo.font(.body)).foregroundColor(Theme.tertiary)
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: Space.m)], spacing: Space.m) {
                            ForEach(c.totals, id: \.self) { t in
                                KPITile(value: Self.amount(t.amount), label: "\(t.service) · \(Self.unitName(t.unit))",
                                        icon: Self.icon(t.service), tint: t.unit == "credits" ? Theme.accent : Theme.text)
                            }
                        }
                    }

                    AdaptiveColumns(spacing: 14) {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionLabel(text: L("costs.byProject"), icon: "folder")
                            if c.byProject.isEmpty {
                                Text("—").foregroundColor(Theme.tertiary)
                            }
                            ForEach(c.byProject) { p in
                                HStack {
                                    Text(p.name).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                                    Spacer()
                                    Text(p.items.map { "\(Self.amount($0.amount)) \(Self.unitName($0.unit))" }.joined(separator: " · "))
                                        .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .card()

                        VStack(alignment: .leading, spacing: 10) {
                            SectionLabel(text: L("costs.budget"), icon: "shield.lefthalf.filled")
                            Text(L("costs.budgetHint"))
                                .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                            HStack {
                                BIDTextField(placeholder: "\(Int(c.budgets.netlifyMinCredits ?? 50))", text: $minCredits, mono: true)
                                    .frame(width: 110)
                                Text(L("common.creditsUnit")).foregroundColor(Theme.secondary).font(Typo.font(.callout))
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
                                Text(item.label).font(Typo.font(.body)).foregroundColor(Theme.text)
                                Spacer()
                                Text(item.unit == "free" ? L("common.free") : "~\(Self.amount(item.amount)) \(Self.unitName(item.unit))")
                                    .font(Typo.font(.body, weight: .semibold))
                                    .foregroundColor(item.unit == "free" || item.amount == 0 ? Theme.ready : Theme.text)
                            }
                        }
                    }
                    .card()

                    VStack(alignment: .leading, spacing: 4) {
                        SectionLabel(text: L("costs.allOperations"), icon: "list.bullet.rectangle")
                            .padding(.bottom, 6)
                        if c.ledger.isEmpty {
                            Text(L("costs.noEntries")).foregroundColor(Theme.tertiary).font(Typo.font(.callout))
                        }
                        let grouped = Dictionary(grouping: Array(c.ledger.prefix(allOperations ? c.ledger.count : 50))) { entry in
                            Calendar.current.startOfDay(for: Fmt.date(entry.ts) ?? .distantPast)
                        }
                        ForEach(grouped.keys.sorted(by: >), id: \.self) { day in
                            SectionLabel(text: day.formatted(date: .abbreviated, time: .omitted)).padding(.top, Space.m)
                            ForEach(grouped[day] ?? []) { e in
                            HStack(spacing: 12) {
                                Text(Fmt.time(e.ts)).font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.tertiary).frame(width: 82, alignment: .leading)
                                Image(systemName: Self.icon(e.service)).foregroundColor(Theme.secondary).frame(width: 16)
                                Text(Self.opName(e.op)).font(Typo.font(.body, weight: .medium)).foregroundColor(Theme.text)
                                Text(e.projectName ?? "").font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                                Spacer()
                                Text(e.unit == "free" || e.amount == 0 ? "0" : "\(e.estimated == true ? "~" : "")\(Self.amount(e.amount)) \(Self.unitName(e.unit))")
                                    .font(Typo.font(.body, weight: .semibold))
                                    .foregroundColor(e.amount > 0 && e.unit == "credits" ? Theme.accent : Theme.secondary)
                            }
                            .padding(.vertical, 5)
                            }
                        }
                    }
                    .card()
                    if !allOperations && c.ledger.count > 50 { Button(L("costs.more")) { allOperations = true }.bidButton(.secondary) }
                } else if let e = model.loadErrors["costs"] {
                    LoadFailedView(message: e) { await model.loadCosts() }
                } else {
                    HStack { Spinner(size: 16); Text(L("costs.loading")).foregroundColor(Theme.secondary) }
                        .frame(maxWidth: .infinity, minHeight: 200)
                }
            }
            .padding(.horizontal, Space.page)
            .padding(.top, Space.top)
            .padding(.bottom, Space.page)
            .frame(maxWidth: 1120)
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
        case "tokens": return L("assistant.textUnits")
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
        if op == "production" { return L("run.productionDeploy") }
        if op == "draft" { return L("run.draftPreview") }
        if op.hasPrefix("aifix:") { return L("costs.aiFix", K.provider(String(op.dropFirst(6)))) }
        return K.other(op)
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
                Text(title).font(Typo.font(.subhead, weight: .bold)).foregroundColor(Theme.text)
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
                            Text(a.name ?? a.slug ?? L("common.account")).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
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
                                .font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                        }
                        ForEach(quotas.prefix(6), id: \.self) { q in QuotaRow(quota: q) }
                    }
                }
            } else {
                Text(provider.note ?? provider.error ?? "—").font(Typo.font(.callout)).foregroundColor(Theme.secondary)
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
                Text(quota.label ?? quota.name.replacingOccurrences(of: "_", with: " ")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                Spacer()
                if let inc = quota.included, let used = quota.used {
                    Text(L("costs.remainingOf", CostsView.amount(max(0, inc - used)), CostsView.amount(inc)))
                        .font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                } else if let v = quota.value {
                    Text(CostsView.amount(v)).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                }
            }
            if let inc = quota.included, let used = quota.used, inc > 0 {
                Meter(value: used, total: inc, thresholds: true, label: quota.label ?? quota.name)
            }
        }
    }
}
