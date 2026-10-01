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
                        sessionCard(u).frame(maxWidth: .infinity)
                        limitsCard(u).frame(width: 300)
                    }
                    planCard(u)
                    if let models = u.byModel, !models.isEmpty { modelsCard(u, models) }
                    historyCard(u)
                } else if store.loading {
                    HStack(spacing: 10) { Spinner(size: 16); Text(L("usage.loading")).foregroundColor(Theme.secondary) }.card()
                } else if let e = store.usageError {
                    VStack(alignment: .leading, spacing: 8) {
                        EmptyLine(icon: "exclamationmark.triangle.fill", text: L("usage.error"), tint: Theme.warn)
                        Text(e).font(Typo.font(.callout)).foregroundColor(Theme.tertiary).textSelection(.enabled)
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
                Text(L("usage.title")).font(Typo.font(.title, weight: .bold)).foregroundColor(Theme.text)
                if let u = store.usage {
                    Text(L("usage.asOf", Fmt.relative(u.serverTime), TimeZone.current.identifier)).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                }
            }
            Spacer()
            Button { Task { await store.loadUsage() } } label: { Label(L("common.refresh"), systemImage: "arrow.clockwise") }
                .bidButton(.secondary, compact: true).disabled(store.loading)
            Button { store.sync() } label: { Label(L("usage.sync"), systemImage: "arrow.triangle.2.circlepath") }
                .bidButton(.secondary, compact: true).disabled(store.busy != nil).help(L("usage.syncHelp"))
        }
    }

    // MARK: current session (Claude-style: a share of the month per 5 hours, with the reset time)

    private func sessionCard(_ u: UsageReport) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: L("usage.sessionTitle"), icon: "timer", trailing: u.session.map { L("usage.sessionWindow", $0.windowHours) } ?? "")
            if let s = u.session {
                let pct = s.cap > 0 ? Int((Double(s.used) / Double(s.cap) * 100).rounded()) : 0
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    CountUp(target: pct, font: Typo.font(.display, weight: .bold, design: .rounded), color: pct >= 100 ? Theme.blocked : (pct >= 80 ? Theme.warn : Theme.text))
                    Text("%").font(Typo.font(.headline, weight: .semibold)).foregroundColor(Theme.secondary)
                    Text(L("usage.sessionUsedLine")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                    Spacer()
                    Text(L("usage.creditsOf", Fmt.tokens(s.used), Fmt.tokens(s.cap))).font(Typo.font(.callout)).foregroundColor(Theme.text)
                }
                UsageBar(used: s.used, reserved: 0, total: s.cap)
                HStack(spacing: 6) {
                    Image(systemName: "arrow.clockwise").font(Typo.font(.micro, weight: .bold)).foregroundColor(Theme.tertiary)
                    Text(s.resetsAt.map { L("usage.sessionResets", Fmt.time($0)) } ?? L("usage.sessionFresh"))
                        .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                    Spacer()
                    Text(L("usage.sessionShare", s.capPercent)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                }
                if s.remaining == 0 {
                    HStack(spacing: 8) {
                        Image(systemName: "hourglass").foregroundColor(Theme.warn)
                        Text(L("usage.sessionExhausted")).font(Typo.font(.callout)).foregroundColor(Theme.text).fixedSize(horizontal: false, vertical: true)
                        Spacer()
                        Button(L("usage.buyCredits")) { model.sheet = .plans }.bidButton(.primary, compact: true)
                        Button(L("usage.upgrade")) { model.sheet = .plans }.bidButton(.secondary, compact: true)
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.warn.opacity(0.10)))
                }
            } else {
                EmptyLine(icon: "timer", text: u.plan == "free" ? L("usage.sessionFree") : L("usage.notApplicable"))
            }
        }
        .card()
    }

    // MARK: per model (what Claude shows as "all models" vs "Opus")

    private func modelsCard(_ u: UsageReport, _ models: [UsageReport.ModelUsage]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: L("usage.byModelTitle"), icon: "cpu")
            let total = max(1, models.reduce(0) { $0 + $1.tokens })
            ForEach(models) { m in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(m.model).font(Typo.font(.callout, weight: .semibold, design: .monospaced)).foregroundColor(Theme.text)
                        Text(L("usage.modelOps", m.operations)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                        Spacer()
                        Text(L("usage.creditsCount", Fmt.tokens(m.tokens))).font(Typo.font(.callout)).foregroundColor(Theme.text)
                    }
                    UsageBar(used: m.tokens, reserved: 0, total: total)
                }
            }
        }
        .card()
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
                Text(L("usage.calendarPeriod")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            }

            // included → used → reserved → remaining, one unit
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(L("usage.planTokens")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.secondary)
                    Spacer()
                    Text(L("usage.creditsOf", Fmt.tokens(u.remaining.plan), Fmt.tokens(u.included.tokens))).font(Typo.font(.callout)).foregroundColor(Theme.text)
                }
                UsageBar(used: u.used.tokens, reserved: u.reserved.tokens, total: max(u.included.tokens, u.used.tokens + u.reserved.tokens + u.remaining.plan))
                HStack(spacing: 14) {
                    legend(Theme.accent, L("usage.used", Fmt.tokens(u.used.tokens), u.used.operations ?? 0))
                    legend(Theme.warn, L("usage.reserved", Fmt.tokens(u.reserved.tokens), u.reserved.operations ?? 0))
                    legend(Theme.hairline, L("usage.remainingPlan", Fmt.tokens(u.remaining.plan)))
                }
                .font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            }
            Divider().background(Theme.hairline)
            HStack(spacing: 22) {
                stat(L("usage.purchased"), u.purchased.tokens, sub: L("usage.purchasedHint"))
                stat(L("usage.available"), u.remaining.available, sub: L("usage.availableHint"))
                Spacer()
            }
            if let r = u.reconciled, r.releasedHolds > 0 {
                Text(L("usage.released", r.releasedHolds)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            }
            HStack(spacing: 8) {
                Button(L("usage.buyCredits")) { model.sheet = .plans }.bidButton(.primary, compact: true)
                if u.plan == "free" || u.plan == "flash" { Button(L("usage.upgrade")) { model.sheet = .plans }.bidButton(.secondary, compact: true) }
                if u.subscription?.manageable == true {
                    Button(L("billing.manage")) { store.openPortal() }.bidButton(.secondary, compact: true).disabled(store.busy == "portal")
                }
                Spacer()
                Text(L("usage.pricingVersion", u.pricing.version)).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary)
            }
        }
        .card()
    }

    private func limitsCard(_ u: UsageReport) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: L("usage.limitsTitle"), icon: "speedometer")
            InfoRow(label: L("usage.perMinute"), value: "\(u.limits.perMinute)")
            InfoRow(label: L("usage.perHour"), value: "\(u.limits.perHour)")
            if let cap = u.limits.sessionCap {
                InfoRow(label: L("usage.sessionCap", u.limits.sessionCapPercent ?? 20, u.limits.sessionHours ?? 5), value: L("usage.creditsCount", Fmt.tokens(cap)))
            } else {
                InfoRow(label: L("usage.sessionCap", u.limits.sessionCapPercent ?? 20, u.limits.sessionHours ?? 5), value: L("usage.notApplicable"))
            }
            Text(L("usage.spendOrder")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
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

    private func legend(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 5) { Circle().fill(color).frame(width: 7, height: 7); Text(text) }
    }

    private func stat(_ label: String, _ value: Int, sub: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            CountUp(target: value, font: Typo.font(.headline, weight: .bold, design: .rounded), color: Theme.text)
            Text(sub).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
        }
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

/// Compact indicator next to the assistant: available tokens and the renewal, straight from the usage report.
struct UsagePill: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        let u = model.billingStore.usage
        Button { model.screen = .usage; Task { await model.billingStore.loadUsage() } } label: {
            HStack(spacing: 6) {
                Image(systemName: "bolt.fill").font(Typo.font(.micro, weight: .bold))
                if let u {
                    Text(L("usage.pill", Fmt.tokens(u.remaining.available))).font(Typo.font(.caption, weight: .semibold))
                    if u.reserved.tokens > 0 { Text(L("usage.pillReserved", Fmt.tokens(u.reserved.tokens))).font(Typo.font(.micro)).foregroundColor(Theme.tertiary) }
                } else if model.account?.loggedIn == true {
                    Text(L("usage.pillUnknown")).font(Typo.font(.caption))
                } else {
                    Text(L("usage.pillSignedOut")).font(Typo.font(.caption))
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
