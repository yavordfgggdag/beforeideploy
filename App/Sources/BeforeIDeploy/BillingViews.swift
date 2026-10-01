import SwiftUI

struct PlansSheet: View {
    @EnvironmentObject var model: AppModel
    var body: some View { PlansContent(store: model.billingStore) }
}

private struct PlansContent: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: BillingStore
    @Local private var yearly = false
    private var intervalBlocked: Bool {
        guard let subscription = store.status?.subscription, subscription.provider == "paddle" else { return false }
        return (subscription.interval == "year") != yearly
    }

    var body: some View {
        SheetScaffold(icon: "sparkles", title: L("billing.title"), subtitle: L("billing.subtitle"), width: 880, scrollResetID: store.catalog?.currency) {
            VStack(alignment: .leading, spacing: 18) {
                if store.demo { Label(L("billing.demo"), systemImage: "eye").foregroundColor(Theme.secondary) }
                if store.waitingForPayment { WaitingBanner { store.stopWaiting() } }
                if store.catalog?.source == "offline" || store.billingUnavailable != nil {
                    Label(L("billing.offlineCatalog"), systemImage: "wifi.slash").font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                }
                if let c = store.catalog {
                    HStack {
                        Text(L("billing.plans")).font(Typo.font(.headline))
                        Spacer()
                        SegmentedControl(options: [(L("billing.monthly"), false), (L("billing.yearly"), true)], selection: $yearly).frame(width: 290)
                    }
                    if intervalBlocked { Text(L("billing.intervalNotice")).font(Typo.font(.callout)).foregroundColor(Theme.secondary) }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 12)], alignment: .leading, spacing: 12) {
                        freeCard(currency: c.currency)
                        ForEach(c.plans) { p in
                            PlanCard(plan: p, currency: c.currency, current: store.status?.plan == p.id && (store.status?.subscription?.interval == "year") == yearly,
                                     yearly: yearly, busy: store.busy != nil, unavailable: !store.canReadUsage || intervalBlocked) { store.checkout(plan: p.id, yearly: yearly) }
                        }
                    }
                    if !store.canReadUsage {
                        Button(L("usage.signIn")) { model.offlineMode = false; dismiss() }.bidButton(.primary)
                    }
                    if let s = store.status, s.trialAvailable, let t = c.trial {
                        TrialCard(trial: t, busy: store.busy != nil) { store.startTrial() }
                    }
                    comparison(c)
                    SectionLabel(text: L("billing.packs"), icon: "plus.circle.fill")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 12)], spacing: 12) {
                        ForEach(c.packs) { p in
                            PackCard(pack: p, currency: c.currency, busy: store.busy != nil, unavailable: !store.canReadUsage) { store.checkout(pack: p.id) }
                        }
                    }
                    Text(L("billing.packWindows")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                    Text(L("billing.legal")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                    LegalLinks()
                } else if store.loadingCatalog { LoadingState(message: L("billing.loading")) }
            }
        } actions: {
            if store.status?.subscription?.manageable == true {
                Button(L("billing.manage")) { store.openPortal() }.bidButton(.secondary).disabled(store.busy != nil)
            }
            Button(L("common.refresh")) { Task { await store.load() } }.bidButton(.ghost).disabled(store.loadingCatalog)
            Button(L("common.close")) { dismiss() }.bidButton(.primary).keyboardShortcut(.cancelAction)
        }
        .task { await store.load(); yearly = store.status?.subscription?.interval == "year" }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await store.load(); await store.loadUsage() }
        }
    }

    private func freeCard(currency: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L("billing.free")).font(Typo.font(.headline))
            Text(BillingFormat.money(0, currency: currency)).font(Typo.font(.title))
            Text(L("billing.freeDetail")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            Spacer()
            Button(L("billing.continueFree")) { dismiss() }.bidButton(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 300, maxHeight: 300, alignment: .topLeading).card(padding: 16)
    }

    private func comparison(_ c: BillingCatalog) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L("billing.compare")).font(Typo.font(.subhead))
            ForEach(c.plans) { p in
                HStack {
                    Text(BillingFormat.planName(p.id)).frame(width: 70, alignment: .leading)
                    Text(p.window5h.map { L("billing.fiveHour", Fmt.tokens($0)) } ?? "—").frame(maxWidth: .infinity, alignment: .leading)
                    Text(p.weekly.map { L("billing.weekly", Fmt.tokens($0)) } ?? "—").frame(maxWidth: .infinity, alignment: .leading)
                }.font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            }
            Text(L("billing.knightExtras")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
        }.card(padding: 16)
    }
}

enum BillingFormat {
    static func planName(_ id: String) -> String {
        id == "free" ? L("billing.free") : K.plan(id)
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
                Text(L("billing.waiting")).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                Text(L("billing.waitingHint")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            }
            Spacer()
            Button(L("common.cancel"), action: stop).bidButton(.ghost, compact: true)
        }
        .card(padding: 14, tint: Theme.accent)
    }
}

struct BalanceCard: View {
    let status: BillingStatus

    var body: some View {
        let b = status.balance
        let total = max(b.total, 1)
        HStack(alignment: .center, spacing: 22) {
            VStack(alignment: .leading, spacing: 4) {
                Text(Fmt.tokens(b.available ?? b.total))
                    .font(Typo.font(.display, weight: .bold, design: .rounded))
                    .foregroundColor(Theme.text)
                    .monospacedDigit()
                Text(L("billing.tokensLeft")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            }
            VStack(alignment: .leading, spacing: 8) {
                Meter(value: Double(b.total), total: Double(total), size: 8,
                      segments: [.init(value: Double(b.plan), color: Theme.accent), .init(value: Double(b.topup), color: Theme.brandViolet)])
                HStack(spacing: 14) {
                    Legend(color: Theme.accent, text: L("billing.fromPlan", Fmt.tokens(b.plan)))
                    Legend(color: Theme.brandViolet, text: L("billing.fromPacks", Fmt.tokens(b.topup)))
                }
                Text(subscriptionLine).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
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

struct Legend: View {
    let color: Color
    let text: String
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(text).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
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
                .font(Typo.font(.headline, weight: .semibold)).foregroundColor(.white)
                .frame(width: 42, height: 42)
                .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.accentGradient))
            VStack(alignment: .leading, spacing: 3) {
                Text(L("billing.trialTitle", BillingFormat.planName(trial.plan), trial.days))
                    .font(Typo.font(.subhead, weight: .bold)).foregroundColor(Theme.text)
                Text(L("billing.trialDetail", Fmt.tokens(trial.tokens)))
                    .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            }
            Spacer()
            Button(busy ? L("billing.starting") : L("billing.startTrial"), action: start)
                .bidButton(.primary)
                .disabled(busy)
        }
        .card(padding: 16, tint: Theme.brandViolet)
    }
}

private struct PlanCard: View {
    let plan: BillingCatalog.Plan
    let currency: String
    let current: Bool
    var yearly = false
    let busy: Bool
    var unavailable = false
    let choose: () -> Void
    @Local private var hover = false

    private var recommended: Bool { plan.id == "high" }
    private var price: Double? { yearly ? plan.yearlyPrice : plan.price }
    private var onSale: Bool { yearly ? plan.yearlyAvailable == true : plan.available }
    private var bullets: [String] {
        var result = [L("billing.feature.builtin")]
        if let sites = plan.activeSites { result.append(L("billing.activeSites", count: sites)) }
        if let months = plan.validityMonths { result.append(L("billing.validity", count: months)) }
        if plan.extras?["domain"] == true { result.append(L("billing.domainYear")) }
        return result
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(BillingFormat.planName(plan.id)).font(Typo.font(.headline, weight: .bold)).foregroundColor(Theme.text)
                Spacer()
                if recommended {
                    Text(L("billing.recommended"))
                        .font(Typo.font(.micro, weight: .heavy)).tracking(0.6)
                        .foregroundColor(.white)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Capsule().fill(Theme.accentGradient))
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(BillingFormat.money(price, currency: currency))
                    .font(Typo.font(.title, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
                Text(yearly ? L("billing.perYear") : L("billing.perMonth")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
            }
            if yearly, let y = plan.yearlyPrice, let m = plan.price, m > 0 {
                Text(L("billing.yearlySaving", BillingFormat.money(y / 12, currency: currency)))
                    .font(Typo.font(.caption, weight: .semibold)).foregroundColor(Theme.ready)
            }
            Text(L("billing.tokensPerMonth", Fmt.tokens(plan.tokens)))
                .font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.accent)
            VStack(alignment: .leading, spacing: 7) {
                ForEach(bullets, id: \.self) { b in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "checkmark").font(Typo.font(.micro, weight: .bold)).foregroundColor(Theme.ready).padding(.top, 2)
                        Text(b).font(Typo.font(.callout)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            Spacer(minLength: 4)
            Button(action: choose) {
                HStack {
                    Spacer()
                    if busy { Spinner(size: 12, color: .white) }
                    Text(current ? L("billing.currentButton") : (onSale ? L("billing.choose") : L("billing.soon")))
                    Spacer()
                }
            }
            .bidButton(recommended && !current ? .primary : .secondary)
            .disabled(current || !onSale || busy || unavailable)
        }
        .frame(maxWidth: .infinity, minHeight: 300, maxHeight: 300, alignment: .topLeading)
        .card(padding: 16, fill: hover ? Theme.elevated : Theme.panel, tint: recommended ? Theme.accent : nil)
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
    var unavailable = false
    let buy: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "bolt.fill").foregroundColor(Theme.brandViolet)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.brandViolet.opacity(0.14)))
            VStack(alignment: .leading, spacing: 2) {
                Text(L("billing.packTokens", Fmt.tokens(pack.tokens))).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                Text(BillingFormat.money(pack.price, currency: currency) + " · " + L("billing.packHint")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            }
            Spacer()
            Button(pack.available ? L("billing.choose") : L("billing.soon"), action: buy)
                .bidButton(.secondary, compact: true)
                .disabled(!pack.available || busy || unavailable)
        }
        .frame(maxWidth: .infinity)
        .card(padding: 14)
    }
}

struct UsageList: View {
    let usage: [BillingStatus.Usage]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: L("billing.recentUsage"), icon: "clock")
            ForEach(usage) { u in
                HStack(spacing: 10) {
                    Text(Fmt.relative(u.at)).font(Typo.font(.callout)).foregroundColor(Theme.tertiary).frame(width: 110, alignment: .leading)
                    Text(u.step.map(K.step) ?? "—").font(Typo.font(.callout, weight: .medium)).foregroundColor(Theme.text)
                    Text(u.model ?? "").font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary)
                    Spacer()
                    Text(L("ai.tokensCount", Fmt.tokens(u.tokens))).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.secondary).monospacedDigit()
                }
            }
        }
        .card(padding: 16)
    }
}
