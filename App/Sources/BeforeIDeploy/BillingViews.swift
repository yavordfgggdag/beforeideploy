import SwiftUI

/// "Plans & credits" (V10 WP4): balance, trial offer, the three plans, token packs and recent AI usage.
/// Payment and the customer portal are Paddle pages in the browser; the sheet waits for the webhook.
struct PlansSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss

    private var store: BillingStore { model.billingStore }

    var body: some View {
        SheetScaffold(icon: "sparkles", title: L("billing.title"), subtitle: subtitle, width: 880) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if store.waitingForPayment { WaitingBanner { store.stopWaiting() } }
                    if let s = store.status { BalanceCard(status: s) }
                    if let s = store.status, s.trialAvailable, let t = store.catalog?.trial {
                        TrialCard(trial: t, busy: store.busy == "trial") { store.startTrial() }
                    }
                    if let c = store.catalog {
                        SectionLabel(text: L("billing.plans"), icon: "square.stack.3d.up.fill")
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(c.plans) { p in
                                PlanCard(plan: p, currency: c.currency, current: store.status?.plan == p.id,
                                         busy: store.busy == p.id) { store.checkout(plan: p.id) }
                            }
                        }
                        if !c.packs.isEmpty {
                            SectionLabel(text: L("billing.packs"), icon: "plus.circle.fill")
                            HStack(spacing: 12) {
                                ForEach(c.packs) { p in
                                    PackCard(pack: p, currency: c.currency, busy: store.busy == p.id) { store.checkout(pack: p.id) }
                                }
                            }
                        }
                        Text(L("billing.legal"))
                            .font(.system(size: 11)).foregroundColor(Theme.tertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else if store.loading {
                        HStack { Spinner(size: 16); Text(L("billing.loading")).foregroundColor(Theme.secondary) }
                            .frame(maxWidth: .infinity, minHeight: 240)
                    }
                    if let usage = store.status?.usage, !usage.isEmpty {
                        UsageList(usage: Array(usage.prefix(6)))
                    }
                }
                .padding(.vertical, 2)
            }
            .frame(height: 560)
        } actions: {
            if store.status?.subscription?.manageable == true {
                Button { store.openPortal() } label: { Label(L("billing.manage"), systemImage: "creditcard") }
                    .bidButton(.secondary)
                    .disabled(store.busy == "portal")
            }
            Button { Task { await store.load() } } label: { Label(L("common.refresh"), systemImage: "arrow.clockwise") }
                .bidButton(.ghost)
            Button(L("common.close")) { dismiss() }
                .bidButton(.primary)
                .keyboardShortcut(.cancelAction)
        }
        .task { await store.load() }
    }

    private var subtitle: String {
        guard let s = store.status else { return L("billing.subtitle") }
        return L("billing.currentPlan", BillingFormat.planName(s.plan))
    }
}

enum BillingFormat {
    static func planName(_ id: String) -> String {
        id == "free" ? L("billing.free") : id.prefix(1).uppercased() + id.dropFirst()
    }

    static func money(_ amount: Double?, currency: String) -> String {
        guard let amount else { return "—" }
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.locale = Localization.locale
        return f.string(from: NSNumber(value: amount)) ?? "\(amount) \(currency)"
    }

    static func day(_ iso: String?) -> String {
        guard let d = Fmt.date(iso) else { return "—" }
        let f = DateFormatter()
        f.locale = Localization.locale
        f.dateStyle = .medium
        f.timeStyle = .none
        return f.string(from: d)
    }
}

private struct WaitingBanner: View {
    let stop: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Spinner(size: 14)
            VStack(alignment: .leading, spacing: 2) {
                Text(L("billing.waiting")).font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.text)
                Text(L("billing.waitingHint")).font(.system(size: 11.5)).foregroundColor(Theme.secondary)
            }
            Spacer()
            Button(L("common.cancel"), action: stop).bidButton(.ghost, compact: true)
        }
        .card(padding: 14, tint: Theme.accent)
    }
}

private struct BalanceCard: View {
    let status: BillingStatus

    var body: some View {
        let b = status.balance
        let total = max(b.total, 1)
        HStack(alignment: .center, spacing: 22) {
            VStack(alignment: .leading, spacing: 4) {
                Text(Fmt.tokens(b.total))
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundColor(Theme.text)
                    .monospacedDigit()
                Text(L("billing.tokensLeft")).font(.system(size: 12)).foregroundColor(Theme.secondary)
            }
            VStack(alignment: .leading, spacing: 8) {
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        Capsule().fill(Theme.accentGradient)
                            .frame(width: max(b.plan > 0 ? 6 : 0, geo.size.width * CGFloat(b.plan) / CGFloat(total)))
                        Capsule().fill(LinearGradient(colors: [Color(hex: 0xB57BFF), Color(hex: 0x7A3FD6)], startPoint: .leading, endPoint: .trailing))
                            .frame(width: max(b.topup > 0 ? 6 : 0, geo.size.width * CGFloat(b.topup) / CGFloat(total)))
                        if b.total == 0 { Capsule().fill(Theme.elevated) }
                    }
                }
                .frame(height: 8)
                HStack(spacing: 14) {
                    Legend(color: Theme.accent, text: L("billing.fromPlan", Fmt.tokens(b.plan)))
                    Legend(color: Color(hex: 0xB57BFF), text: L("billing.fromPacks", Fmt.tokens(b.topup)))
                }
                Text(subscriptionLine).font(.system(size: 12)).foregroundColor(Theme.secondary)
            }
        }
        .card(padding: 20, tint: status.plan == "free" ? nil : Theme.accent)
        .accessibilityElement(children: .combine)
    }

    private var subscriptionLine: String {
        guard let s = status.subscription else { return L("billing.noPlanLine") }
        let name = BillingFormat.planName(s.tier)
        if s.provider == "trial" { return L("billing.trialEnds", name, BillingFormat.day(s.endsAt)) }
        if let end = s.endsAt { return L("billing.endsOn", name, BillingFormat.day(end)) }
        if s.status == "past_due" { return L("billing.pastDue", name) }
        return L("billing.renewsOn", name, BillingFormat.day(s.renewsAt))
    }
}

private struct Legend: View {
    let color: Color
    let text: String
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(text).font(.system(size: 11.5)).foregroundColor(Theme.secondary)
        }
    }
}

private struct TrialCard: View {
    let trial: BillingCatalog.Trial
    let busy: Bool
    let start: () -> Void
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "gift.fill")
                .font(.system(size: 18, weight: .semibold)).foregroundColor(.white)
                .frame(width: 42, height: 42)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.accentGradient))
            VStack(alignment: .leading, spacing: 3) {
                Text(L("billing.trialTitle", BillingFormat.planName(trial.plan), trial.days))
                    .font(.system(size: 14, weight: .bold)).foregroundColor(Theme.text)
                Text(L("billing.trialDetail", Fmt.tokens(trial.tokens)))
                    .font(.system(size: 12)).foregroundColor(Theme.secondary)
            }
            Spacer()
            Button(busy ? L("billing.starting") : L("billing.startTrial"), action: start)
                .bidButton(.primary)
                .disabled(busy)
        }
        .card(padding: 16, tint: Color(hex: 0x7A3FD6))
    }
}

private struct PlanCard: View {
    let plan: BillingCatalog.Plan
    let currency: String
    let current: Bool
    let busy: Bool
    let choose: () -> Void
    @Local private var hover = false

    private var recommended: Bool { plan.id == "high" }
    private var bullets: [String] {
        switch plan.id {
        case "flash": return [L("billing.feature.builtin"), L("billing.feature.sync"), L("billing.feature.projects5")]
        case "knight": return [L("billing.feature.builtin"), L("billing.feature.deep"), L("billing.feature.unlimited")]
        default: return [L("billing.feature.builtin"), L("billing.feature.sync"), L("billing.feature.unlimited")]
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(BillingFormat.planName(plan.id)).font(.system(size: 16, weight: .bold)).foregroundColor(Theme.text)
                Spacer()
                if recommended {
                    Text(L("billing.recommended"))
                        .font(.system(size: 9.5, weight: .heavy)).tracking(0.6)
                        .foregroundColor(.white)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Capsule().fill(Theme.accentGradient))
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(BillingFormat.money(plan.price, currency: currency))
                    .font(.system(size: 26, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
                Text(L("billing.perMonth")).font(.system(size: 12)).foregroundColor(Theme.tertiary)
            }
            Text(L("billing.tokensPerMonth", Fmt.tokens(plan.tokens)))
                .font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.accent)
            VStack(alignment: .leading, spacing: 7) {
                ForEach(bullets, id: \.self) { b in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundColor(Theme.ready).padding(.top, 2)
                        Text(b).font(.system(size: 12)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            Spacer(minLength: 4)
            Button(action: choose) {
                HStack {
                    Spacer()
                    if busy { Spinner(size: 12, color: .white) }
                    Text(current ? L("billing.currentButton") : (plan.available ? L("billing.choose") : L("billing.soon")))
                    Spacer()
                }
            }
            .bidButton(recommended && !current ? .primary : .secondary)
            .disabled(current || !plan.available || busy)
        }
        .frame(maxWidth: .infinity, minHeight: 250, alignment: .topLeading)
        .card(padding: 18, fill: hover ? Theme.elevated : Theme.panel, tint: recommended ? Theme.accent : nil)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .strokeBorder(current ? Theme.ready.opacity(0.6) : (recommended ? Theme.accent.opacity(0.45) : .clear), lineWidth: 1.5)
        )
        .offset(y: hover && !Motion.reduced ? -2 : 0)
        .onHover { hover = $0 }
        .animation(Motion.quick, value: hover)
        .accessibilityElement(children: .combine)
    }
}

private struct PackCard: View {
    let pack: BillingCatalog.Pack
    let currency: String
    let busy: Bool
    let buy: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "bolt.fill").foregroundColor(Color(hex: 0xB57BFF))
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color(hex: 0xB57BFF).opacity(0.14)))
            VStack(alignment: .leading, spacing: 2) {
                Text(L("billing.packTokens", Fmt.tokens(pack.tokens))).font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.text)
                Text(L("billing.packHint")).font(.system(size: 11)).foregroundColor(Theme.tertiary)
            }
            Spacer()
            Button(pack.available ? BillingFormat.money(pack.price, currency: currency) : L("billing.soon"), action: buy)
                .bidButton(.secondary, compact: true)
                .disabled(!pack.available || busy)
        }
        .frame(maxWidth: .infinity)
        .card(padding: 14)
    }
}

private struct UsageList: View {
    let usage: [BillingStatus.Usage]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: L("billing.recentUsage"), icon: "clock")
            ForEach(usage) { u in
                HStack(spacing: 10) {
                    Text(Fmt.relative(u.at)).font(.system(size: 11.5)).foregroundColor(Theme.tertiary).frame(width: 110, alignment: .leading)
                    Text(u.step ?? "—").font(.system(size: 12, weight: .medium)).foregroundColor(Theme.text)
                    Text(u.model ?? "").font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.tertiary)
                    Spacer()
                    Text(L("ai.tokensCount", Fmt.tokens(u.tokens))).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.secondary).monospacedDigit()
                }
            }
        }
        .card(padding: 16)
    }
}
