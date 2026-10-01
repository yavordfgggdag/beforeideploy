import SwiftUI
import Charts

struct PlanUsageView: View {
    @EnvironmentObject var model: AppModel
    var body: some View { PlanUsageContent(store: model.billingStore) }
}

private struct PlanUsageContent: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var store: BillingStore
    @Local private var historyExpanded = false
    @Local private var domain = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                if store.demo { Label(L("billing.demo"), systemImage: "eye").font(Typo.font(.callout)).foregroundColor(Theme.secondary) }
                if let u = store.usage {
                    if u.stale == true { Label(L("usage.cached"), systemImage: "wifi.slash").font(Typo.font(.callout)).foregroundColor(Theme.warn) }
                    windows(u)
                    balances(u)
                    if let sites = u.sites { siteManagement(sites) }
                    if u.plan == "knight", store.catalog?.plans.first(where: { $0.id == "knight" })?.extras?["domain"] == true { domainRequest }
                    if let actions = u.byAction, !actions.isEmpty { actionBreakdown(actions) }
                    if let days = u.daily, !days.isEmpty { dailyChart(days) }
                    if let models = u.byModel, !models.isEmpty {
                        DisclosureGroup(L("usage.byModelTitle")) {
                            ForEach(models) { m in
                                InfoRow(label: m.model, value: L("usage.creditsCount", Fmt.tokens(m.tokens)))
                            }
                        }.font(Typo.font(.callout)).card()
                    }
                    DisclosureGroup(L("usage.historyTitle"), isExpanded: $historyExpanded) { historyCard(u) }
                        .font(Typo.font(.subhead)).card()
                } else if !store.canReadUsage {
                    EmptyLine(icon: "person.crop.circle", text: L("usage.signIn")).card()
                    Button(L("billing.plans")) { model.sheet = .plans }.bidButton(.primary)
                } else if store.billingUnavailable != nil {
                    VStack(alignment: .leading, spacing: 12) {
                        EmptyLine(icon: "sparkles", text: L("billing.notReady"))
                        Button(L("billing.plans")) { model.sheet = .plans }.bidButton(.secondary)
                        if model.account?.isAdmin == true { DisclosureGroup(L("common.details")) { Text(store.billingUnavailable ?? "").textSelection(.enabled) } }
                    }.card()
                } else if store.loadingUsage { LoadingState(message: L("usage.loading")) }
                else if store.usageError != nil {
                    VStack(alignment: .leading, spacing: 10) {
                        EmptyLine(icon: "wifi.exclamationmark", text: L("usage.error"))
                        Button(L("common.retry")) { Task { await store.loadUsage() } }.bidButton(.secondary)
                        if model.account?.isAdmin == true { Text(store.usageError ?? "").font(Typo.font(.caption)).textSelection(.enabled) }
                    }.card()
                }
            }.frame(maxWidth: 1120, alignment: .leading).padding(.horizontal, Space.page).padding(.top, Space.top).padding(.bottom, Space.page).frame(maxWidth: .infinity)
        }
        .task(id: model.account?.id) { await store.load(); await store.observeUsage(every: 10) }
        .sheet(item: $store.auditReport) { CloudAuditSheet(receipt: $0) }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await store.loadUsage() } }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(L("usage.title")).font(Typo.font(.title)).foregroundColor(Theme.text)
                if let u = store.usage {
                    Text(L("billing.currentPlan", BillingFormat.planName(u.plan)) + (u.subscription?.renewsAt.map { " · " + L("usage.renewalDate", BillingFormat.day($0)) } ?? ""))
                        .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        Text(L("usage.updated", Fmt.relative(u.serverTime))).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                    }
                }
            }
            Spacer()
            Button(L("usage.changePlan")) { model.sheet = .plans }.bidButton(.secondary)
            IconButton(symbol: "arrow.clockwise", help: L("common.refresh")) { Task { await store.loadUsage() } }.disabled(store.loadingUsage)
        }
    }

    private func resetDetail(_ value: String?, rolling: Bool = false) -> String {
        guard let date = Fmt.date(value) else { return L("usage.sessionFresh") }
        let seconds = max(0, Int(date.timeIntervalSinceNow))
        let duration = DateComponentsFormatter()
        var calendar = Calendar(identifier: .gregorian); calendar.locale = Localization.locale; duration.calendar = calendar
        duration.allowedUnits = [.day, .hour, .minute]; duration.unitsStyle = .abbreviated; duration.maximumUnitCount = 2
        let wait = duration.string(from: TimeInterval(seconds)) ?? "—"
        return rolling ? L("usage.rollingReset", Fmt.time(value ?? ""), wait) : L("usage.resetCountdown", Fmt.time(value ?? ""), wait)
    }

    private func windows(_ u: UsageReport) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            TimelineView(.periodic(from: .now, by: 30)) { _ in
                VStack(alignment: .leading, spacing: 22) {
                    if let s = u.session {
                        // usage v3: the two meters are the 24 h / 7-day guards on settled included spend
                        CreditsMeter(title: L(s.windowHours >= 24 ? "usage.last24h" : "usage.fiveHours"), used: s.used, reserved: s.reserved ?? 0, total: s.cap, detail: resetDetail(s.resetsAt, rolling: u.v != 2))
                    } else { EmptyLine(icon: "timer", text: L("usage.sessionFree")) }
                    Divider()
                    if let w = u.weekly {
                        CreditsMeter(title: L(u.v == 3 ? "usage.last7d" : "usage.week"), used: w.used, reserved: w.reserved ?? 0, total: w.cap, detail: resetDetail(w.resetsAt))
                    } else {
                        HStack { Text(L("usage.week")); Spacer(); Text(L("usage.windowUnavailable")).foregroundColor(Theme.tertiary) }.font(Typo.font(.callout))
                    }
                    Divider()
                    CreditsMeter(title: L("usage.period"), used: u.used.tokens, reserved: u.reserved.tokens,
                                 total: u.included.tokens,
                                 detail: L("usage.periodDates", BillingFormat.day(u.period.start), BillingFormat.day(u.period.end)))
                    if let released = u.included.released, let budget = u.included.budget, released < budget {
                        Text(L("usage.releasedNow", released, budget)).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                    }
                }
            }
            if u.weekly?.boostAvailable == true {
                HStack {
                    Text(L("usage.boostDetail")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                    Spacer()
                    Button(L("usage.boost")) { store.creditAction("boost") }.bidButton(.secondary).disabled(store.busy != nil || store.demo)
                }
            } else if let until = u.weekly?.boostUntil {
                Label(L("usage.boostUntil", Fmt.dateTime(until)), systemImage: "bolt.fill").font(Typo.font(.callout)).foregroundColor(Theme.accent)
            }
            if u.session?.remaining == 0 || u.weekly?.remaining == 0 {
                Text(L("billing.packWindows")).font(Typo.font(.callout)).foregroundColor(Theme.warn)
                Button(L("usage.changePlan")) { model.sheet = .plans }.bidButton(.secondary)
            }
        }.card(padding: 22)
    }

    private func balances(_ u: UsageReport) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("usage.available")).font(Typo.font(.caption)).foregroundColor(Theme.secondary)
                    Text(L("usage.creditsCount", Fmt.tokens(u.remaining.available))).font(Typo.font(.headline)).foregroundColor(Theme.text)
                }
                Spacer()
                Button(L("usage.buyCredits")) { model.sheet = .plans }.bidButton(.primary)
            }
            if let debt = u.period.debt, debt > 0 {
                Text(L("usage.debt", Fmt.tokens(debt))).font(Typo.font(.callout)).foregroundColor(Theme.warn)
            }
            if let days = u.period.forecastDaysLeft {
                Text(L("usage.forecast", Int(days))).font(Typo.font(.caption)).foregroundColor(Theme.secondary)
            }
            InfoRow(label: L("usage.purchased"), value: L("usage.creditsCount", Fmt.tokens(u.purchased.tokens)))
            if let lots = u.packs {
                ForEach(lots) { lot in
                    InfoRow(label: L("usage.creditsCount", Fmt.tokens(lot.remaining)), value: L("usage.expiresOn", BillingFormat.day(lot.expiresAt)))
                }
            }
            if let sites = u.sites { InfoRow(label: L("usage.activeSites"), value: L("usage.siteCount", sites.active, sites.limit)) }
            HStack {
                if u.subscription?.manageable == true {
                    Button(L("billing.manage")) { store.openPortal() }.bidButton(.ghost, compact: true).disabled(store.busy != nil)
                    Button(L("usage.sync")) { store.sync() }.bidButton(.ghost, compact: true).disabled(store.busy != nil)
                }
            }
        }.card()
    }

    private func siteManagement(_ sites: UsageReport.Sites) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L("usage.activeSites")).font(Typo.font(.subhead))
            if let change = store.usage?.scheduledChange {
                Text(L("usage.scheduledSites", BillingFormat.planName(change.plan), BillingFormat.day(change.effectiveAt), change.siteLimit)).font(Typo.font(.callout)).foregroundColor(Theme.warn)
            }
            Text(L("usage.pauseExplanation")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            ForEach(sites.items ?? []) { site in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(site.name).font(Typo.font(.body, weight: .semibold)).lineLimit(2)
                        Text(site.state == "active" ? L("usage.siteActive") : L("usage.sitePaused")).font(Typo.font(.caption)).foregroundColor(site.state == "active" ? Theme.ready : Theme.secondary)
                        if let grace = site.graceUntil, let date = Fmt.date(grace), date > Date() {
                            Text(L("usage.siteGrace", BillingFormat.day(grace))).font(Typo.font(.caption)).foregroundColor(Theme.secondary)
                        }
                    }
                    Spacer()
                    Button(L("usage.cloudAudit")) { store.audit(projectKey: site.projectKey) }.bidButton(.ghost, compact: true).disabled(store.busy != nil || store.demo)
                    Button(site.state == "active" ? L("usage.pauseSite") : L("usage.activateSite")) { store.changeSite(projectKey: site.projectKey, active: site.state != "active") }
                        .bidButton(.secondary, compact: true).disabled(store.busy != nil || store.demo)
                }
            }
            ForEach(model.projects.filter { project in !(sites.items ?? []).contains { $0.projectKey == project.key } }) { project in
                HStack {
                    Text(project.name).font(Typo.font(.body)).lineLimit(2)
                    Spacer()
                    Button(L("usage.cloudAudit")) { store.audit(projectKey: project.key) }.bidButton(.ghost, compact: true).disabled(store.busy != nil || store.demo)
                    Button(L("usage.activateSite")) { store.changeSite(projectKey: project.key, active: true) }.bidButton(.secondary, compact: true).disabled(store.busy != nil || store.demo)
                }
            }
        }.card()
    }

    private var domainRequest: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L("usage.domainTitle")).font(Typo.font(.subhead))
            Text(L("usage.domainDetail")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            HStack {
                TextField(L("usage.domainPlaceholder"), text: $domain).textFieldStyle(.roundedBorder)
                Button(L("usage.domainRequest")) { store.creditAction("domain_request", arguments: ["--domain", domain]) }.bidButton(.secondary).disabled(domain.trimmingCharacters(in: .whitespaces).isEmpty || store.busy != nil || store.demo)
            }
        }.card()
    }

    private func actionBreakdown(_ actions: [UsageReport.ActionUsage]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L("usage.byAction")).font(Typo.font(.subhead))
            ForEach(actions) { item in InfoRow(label: actionName(item.action), value: L("usage.creditsCount", Fmt.tokens(item.credits))) }
        }.card()
    }
    private func actionName(_ value: String) -> String { CreditActionName.label(value) }
    private func dailyChart(_ days: [UsageReport.DailyUsage]) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L("usage.daily")).font(Typo.font(.subhead))
            Chart(days) { day in
                BarMark(x: .value(L("usage.chartDay"), day.date), y: .value(L("usage.chartCredits"), day.credits)).foregroundStyle(Theme.accent)
            }.chartXAxis(.hidden).frame(height: 110)
            Text(L("usage.periodDates", days.first?.date ?? "", days.last?.date ?? "")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
        }.card()
    }

    // MARK: history

    private func historyCard(_ u: UsageReport) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: L("usage.historyTitle"), icon: "list.bullet.rectangle")
            if u.history.operations.isEmpty && u.history.ledger.isEmpty {
                EmptyLine(icon: "tray", text: L("usage.noHistory"))
            }
            if !u.history.operations.isEmpty {
                Text(L("usage.operations")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.secondary)
                ForEach(u.history.operations.prefix(25)) { op in
                    HStack(spacing: 10) {
                        Image(systemName: op.status == "ok" ? "checkmark.circle" : (op.status == "pending" ? "clock" : "exclamationmark.circle"))
                            .foregroundColor(op.status == "ok" ? Theme.ready : (op.status == "pending" ? Theme.warn : Theme.blocked)).frame(width: 14)
                        Text(Fmt.dateTime(op.at)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).frame(width: 130, alignment: .leading)
                        Text([op.project, op.step].compactMap { $0 }.joined(separator: " · ")).font(Typo.font(.callout)).foregroundColor(Theme.text).lineLimit(1)
                        Spacer()
                        Text(op.model ?? "").font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary)
                        Text(K.usageStatus(op.status ?? "")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).frame(width: 70, alignment: .trailing)
                        Text(op.status == "pending" ? L("usage.pendingTokens") : Fmt.tokens(op.tokens)).font(Typo.font(.callout, weight: .medium)).foregroundColor(Theme.text).frame(width: 80, alignment: .trailing)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            if !u.history.ledger.isEmpty {
                Text(L("usage.ledger")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.secondary).padding(.top, 6)
                ForEach(u.history.ledger.prefix(25)) { row in
                    HStack(spacing: 10) {
                        Image(systemName: row.delta >= 0 ? "plus.circle" : "minus.circle").foregroundColor(row.delta >= 0 ? Theme.ready : Theme.secondary).frame(width: 14)
                        Text(Fmt.dateTime(row.at)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).frame(width: 130, alignment: .leading)
                        Text(K.ledgerReason(row.reason)).font(Typo.font(.callout)).foregroundColor(Theme.text)
                        Text(K.bucket(row.bucket)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                        Spacer()
                        Text((row.delta >= 0 ? "+" : "") + Fmt.tokens(row.delta)).font(Typo.font(.callout, weight: .medium)).foregroundColor(row.delta >= 0 ? Theme.ready : Theme.text).frame(width: 90, alignment: .trailing)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .card()
    }

}

/// used | reserved | remaining, proportional; never "full" when the total is unknown.
struct UsageBar: View {
    let used: Int
    let reserved: Int
    let total: Int

    var body: some View {
        Meter(value: Double(used + reserved), total: Double(total), size: 8,
              label: L("usage.barLabel", Fmt.tokens(used), Fmt.tokens(reserved), Fmt.tokens(total)),
              segments: [.init(value: Double(used), color: Theme.accent), .init(value: Double(reserved), color: Theme.warn)])
    }
}

/// Compact account-scoped balance. SwiftUI cancels its minute timer when it disappears.
struct UsagePill: View {
    @EnvironmentObject var model: AppModel
    var body: some View { UsagePillContent(store: model.billingStore) }
}
private struct UsagePillContent: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var store: BillingStore
    var body: some View {
        Button { model.screen = .usage } label: {
            HStack(spacing: 6) {
                Image(systemName: "bolt.fill")
                if let u = store.usage {
                    Text(L("usage.pill", Fmt.tokens(u.remaining.available)))
                    if u.reserved.tokens > 0 { Text(L("usage.pillReserved", Fmt.tokens(u.reserved.tokens))).foregroundColor(Theme.tertiary) }
                } else { Text(store.canReadUsage ? L("usage.pillUnknown") : L("usage.pillSignedOut")) }
            }.font(Typo.font(.caption, weight: .semibold)).foregroundColor(Theme.secondary)
                .padding(.horizontal, 10).padding(.vertical, 5).background(Capsule().fill(Theme.panel))
                .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
        }.buttonStyle(.plain).help(L("usage.pillHelp")).accessibilityLabel(L("usage.title"))
            .task(id: model.account?.id) { await store.observeUsage(every: 60) }
    }
}

struct CreditNudgeBanner: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var store: BillingStore
    var body: some View {
        if let nudge = store.usage?.nudge {
            HStack(spacing: 12) {
                Image(systemName: "info.circle").foregroundColor(Theme.warn)
                Text(L("usage.nudge", nudge.threshold)).font(Typo.font(.callout)).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Button(nudge.kind == "buy" ? L("usage.buyCredits") : L("usage.changePlan")) { model.sheet = .plans }.bidButton(.secondary, compact: true)
                Button(L("usage.details")) { model.screen = .usage }.bidButton(.ghost, compact: true)
                IconButton(symbol: "xmark", help: L("common.close")) { store.creditAction("nudge_ack", arguments: ["--period-ref", nudge.periodRef, "--threshold", String(nudge.threshold)]) }.disabled(store.busy != nil || store.demo)
            }.padding(12).background(Theme.panel)
        } else if let change = store.usage?.scheduledChange, let date = Fmt.date(change.effectiveAt), date.timeIntervalSinceNow > 0, date.timeIntervalSinceNow <= 7 * 86400 {
            HStack {
                Text(L("usage.scheduledSites", BillingFormat.planName(change.plan), BillingFormat.day(change.effectiveAt), change.siteLimit)).font(Typo.font(.callout))
                Spacer()
                Button(L("usage.details")) { model.screen = .usage }.bidButton(.secondary, compact: true)
            }.padding(12).background(Theme.panel)
        }
    }
}
