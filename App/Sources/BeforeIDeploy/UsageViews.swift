import SwiftUI

/// Plan & usage (V11 RC). Every number comes from the cloud's `billing usage` (tokens, the product's credit
/// unit); money appears only where the catalog prices are shown. Tokens, product credits and currency are
/// never mixed on one line, and nothing here is invented client-side: no data → "not loaded", not zero.
struct PlanUsageView: View {
    @EnvironmentObject var model: AppModel
    private var store: BillingStore { model.billingStore }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                if let u = store.usage {
                    HStack(alignment: .top, spacing: 16) {
                        planCard(u).frame(maxWidth: .infinity).entrance(0)
                        limitsCard(u).frame(width: 300).entrance(1)
                    }
                    historyCard(u).entrance(2)
                } else if store.loading {
                    HStack(spacing: 10) { Spinner(size: 16); Text(L("usage.loading")).foregroundColor(Theme.secondary) }.card()
                } else if let e = store.usageError {
                    VStack(alignment: .leading, spacing: 8) {
                        EmptyLine(icon: "exclamationmark.triangle.fill", text: L("usage.error"), tint: Theme.warn)
                        Text(e).font(.system(size: 11.5)).foregroundColor(Theme.tertiary).textSelection(.enabled)
                        Button(L("common.retry")) { Task { await store.loadUsage() } }.bidButton(.secondary, compact: true)
                    }.card()
                } else {
                    EmptyLine(icon: "person.crop.circle.badge.questionmark", text: L("usage.signIn")).card()
                }
            }
            .padding(24)
        }
        .task { if store.usage == nil { await store.loadUsage() } }
    }

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(L("usage.title")).font(.system(size: 22, weight: .bold)).foregroundColor(Theme.text)
                if let u = store.usage {
                    Text(L("usage.asOf", Fmt.relative(u.serverTime), TimeZone.current.identifier)).font(.system(size: 12)).foregroundColor(Theme.tertiary)
                }
            }
            Spacer()
            Button { Task { await store.loadUsage() } } label: { Label(L("common.refresh"), systemImage: "arrow.clockwise") }
                .bidButton(.secondary, compact: true).disabled(store.loading)
            Button { store.sync() } label: { Label(L("usage.sync"), systemImage: "arrow.triangle.2.circlepath") }
                .bidButton(.secondary, compact: true).disabled(store.busy != nil).help(L("usage.syncHelp"))
        }
    }

    // MARK: plan + balances

    private func planCard(_ u: UsageReport) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(title: L("usage.planTitle"), icon: "creditcard.fill", trailing: BillingFormat.planName(u.plan))
            if let s = u.subscription {
                InfoRow(label: L("usage.billingStatus"), value: K.subscriptionStatus(s.status), tint: s.status == "past_due" ? Theme.warn : Theme.text)
                if let r = s.renewsAt { InfoRow(label: L("usage.renews"), value: Fmt.dateTime(r)) }
                if let e = s.endsAt { InfoRow(label: L("usage.ends"), value: Fmt.dateTime(e), tint: Theme.warn) }
            } else {
                InfoRow(label: L("usage.billingStatus"), value: u.plan == "free" ? L("billing.free") : L("usage.noSubscription"))
            }
            InfoRow(label: L("usage.period"), value: "\(Fmt.dateTime(u.period.start)) – \(Fmt.dateTime(u.period.end))")
            if u.period.source == "calendar" && u.plan != "free" {
                Text(L("usage.calendarPeriod")).font(.system(size: 11)).foregroundColor(Theme.tertiary)
            }

            // included → used → reserved → remaining, one unit
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(L("usage.planTokens")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.secondary)
                    Spacer()
                    Text(L("usage.tokensOf", Fmt.tokens(u.remaining.plan), Fmt.tokens(u.included.tokens))).font(.system(size: 12)).foregroundColor(Theme.text)
                }
                UsageBar(used: u.used.tokens, reserved: u.reserved.tokens, total: max(u.included.tokens, u.used.tokens + u.reserved.tokens + u.remaining.plan))
                HStack(spacing: 14) {
                    legend(Theme.accent, L("usage.used", Fmt.tokens(u.used.tokens), u.used.operations ?? 0))
                    legend(Theme.warn, L("usage.reserved", Fmt.tokens(u.reserved.tokens), u.reserved.operations ?? 0))
                    legend(Theme.hairline, L("usage.remainingPlan", Fmt.tokens(u.remaining.plan)))
                }
                .font(.system(size: 11)).foregroundColor(Theme.tertiary)
            }
            Divider().background(Theme.hairline)
            HStack(spacing: 22) {
                stat(L("usage.purchased"), u.purchased.tokens, sub: L("usage.purchasedHint"))
                stat(L("usage.available"), u.remaining.available, sub: L("usage.availableHint"))
                Spacer()
            }
            if let r = u.reconciled, r.releasedHolds > 0 {
                Text(L("usage.released", r.releasedHolds)).font(.system(size: 11)).foregroundColor(Theme.tertiary)
            }
            HStack(spacing: 8) {
                Button(L("usage.buyCredits")) { model.sheet = .plans }.bidButton(.primary, compact: true)
                if u.plan == "free" || u.plan == "flash" { Button(L("usage.upgrade")) { model.sheet = .plans }.bidButton(.secondary, compact: true) }
                if u.subscription?.manageable == true {
                    Button(L("billing.manage")) { store.openPortal() }.bidButton(.secondary, compact: true).disabled(store.busy == "portal")
                }
                Spacer()
                Text(L("usage.pricingVersion", u.pricing.version)).font(.system(size: 10.5, design: .monospaced)).foregroundColor(Theme.tertiary)
            }
        }
        .card()
    }

    private func limitsCard(_ u: UsageReport) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: L("usage.limitsTitle"), icon: "speedometer")
            InfoRow(label: L("usage.perMinute"), value: "\(u.limits.perMinute)")
            InfoRow(label: L("usage.perHour"), value: "\(u.limits.perHour)")
            if let cap = u.limits.dailyCapTokens {
                InfoRow(label: L("usage.dailyCap", u.limits.dailyCapPercent), value: L("usage.tokensOf", Fmt.tokens(u.limits.spentToday), Fmt.tokens(cap)), tint: u.limits.spentToday >= cap ? Theme.warn : Theme.text)
            } else {
                InfoRow(label: L("usage.dailyCap", u.limits.dailyCapPercent), value: L("usage.notApplicable"))
            }
            Text(L("usage.spendOrder")).font(.system(size: 11)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
        }
        .card()
    }

    // MARK: history

    private func historyCard(_ u: UsageReport) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: L("usage.historyTitle"), icon: "list.bullet.rectangle")
            if u.history.operations.isEmpty && u.history.ledger.isEmpty {
                EmptyLine(icon: "tray", text: L("usage.noHistory"))
            }
            if !u.history.operations.isEmpty {
                Text(L("usage.operations")).font(.system(size: 11.5, weight: .semibold)).foregroundColor(Theme.secondary)
                ForEach(u.history.operations.prefix(25)) { op in
                    HStack(spacing: 10) {
                        Image(systemName: op.status == "ok" ? "checkmark.circle" : (op.status == "pending" ? "clock" : "exclamationmark.circle"))
                            .foregroundColor(op.status == "ok" ? Theme.ready : (op.status == "pending" ? Theme.warn : Theme.blocked)).frame(width: 14)
                        Text(Fmt.dateTime(op.at)).font(.system(size: 11)).foregroundColor(Theme.tertiary).frame(width: 130, alignment: .leading)
                        Text([op.project, op.step].compactMap { $0 }.joined(separator: " · ")).font(.system(size: 11.5)).foregroundColor(Theme.text).lineLimit(1)
                        Spacer()
                        Text(op.model ?? "").font(.system(size: 10.5, design: .monospaced)).foregroundColor(Theme.tertiary)
                        Text(K.usageStatus(op.status ?? "")).font(.system(size: 10.5)).foregroundColor(Theme.tertiary).frame(width: 70, alignment: .trailing)
                        Text(op.status == "pending" ? L("usage.pendingTokens") : Fmt.tokens(op.tokens)).font(.system(size: 11.5, weight: .medium)).foregroundColor(Theme.text).frame(width: 80, alignment: .trailing)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            if !u.history.ledger.isEmpty {
                Text(L("usage.ledger")).font(.system(size: 11.5, weight: .semibold)).foregroundColor(Theme.secondary).padding(.top, 6)
                ForEach(u.history.ledger.prefix(25)) { row in
                    HStack(spacing: 10) {
                        Image(systemName: row.delta >= 0 ? "plus.circle" : "minus.circle").foregroundColor(row.delta >= 0 ? Theme.ready : Theme.secondary).frame(width: 14)
                        Text(Fmt.dateTime(row.at)).font(.system(size: 11)).foregroundColor(Theme.tertiary).frame(width: 130, alignment: .leading)
                        Text(K.ledgerReason(row.reason)).font(.system(size: 11.5)).foregroundColor(Theme.text)
                        Text(K.bucket(row.bucket)).font(.system(size: 10.5)).foregroundColor(Theme.tertiary)
                        Spacer()
                        Text((row.delta >= 0 ? "+" : "") + Fmt.tokens(row.delta)).font(.system(size: 11.5, weight: .medium)).foregroundColor(row.delta >= 0 ? Theme.ready : Theme.text).frame(width: 90, alignment: .trailing)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .card()
    }

    private func legend(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 5) { Circle().fill(color).frame(width: 7, height: 7); Text(text) }
    }

    private func stat(_ label: String, _ value: Int, sub: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11)).foregroundColor(Theme.tertiary)
            CountUp(target: value, font: .system(size: 16, weight: .bold, design: .rounded), color: Theme.text)
            Text(sub).font(.system(size: 10.5)).foregroundColor(Theme.tertiary)
        }
    }
}

/// used | reserved | remaining, proportional; never "full" when the total is unknown.
struct UsageBar: View {
    let used: Int
    let reserved: Int
    let total: Int

    var body: some View {
        GeometryReader { geo in
            let t = max(1, Double(total))
            let w = geo.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.hairline)
                HStack(spacing: 0) {
                    Rectangle().fill(Theme.accent).frame(width: w * min(1, Double(used) / t))
                    Rectangle().fill(Theme.warn).frame(width: w * min(1, Double(reserved) / t))
                    Spacer(minLength: 0)
                }
                .clipShape(Capsule())
            }
        }
        .frame(height: 8)
        .accessibilityLabel(L("usage.barLabel", Fmt.tokens(used), Fmt.tokens(reserved), Fmt.tokens(total)))
    }
}

/// Compact indicator next to the assistant: available tokens and the renewal, straight from the usage report.
struct UsagePill: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        let u = model.billingStore.usage
        Button { model.screen = .usage; Task { await model.billingStore.loadUsage() } } label: {
            HStack(spacing: 6) {
                Image(systemName: "bolt.fill").font(.system(size: 10, weight: .bold))
                if let u {
                    Text(L("usage.pill", Fmt.tokens(u.remaining.available))).font(.system(size: 11, weight: .semibold))
                    if u.reserved.tokens > 0 { Text(L("usage.pillReserved", Fmt.tokens(u.reserved.tokens))).font(.system(size: 10)).foregroundColor(Theme.tertiary) }
                } else if model.account?.loggedIn == true {
                    Text(L("usage.pillUnknown")).font(.system(size: 11))
                } else {
                    Text(L("usage.pillSignedOut")).font(.system(size: 11))
                }
            }
            .foregroundColor(u.map { $0.remaining.available > 0 ? Theme.text : Theme.warn } ?? Theme.secondary)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(Capsule().fill(Theme.panel))
            .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .help(L("usage.pillHelp"))
        .accessibilityLabel(L("usage.title"))
    }
}
