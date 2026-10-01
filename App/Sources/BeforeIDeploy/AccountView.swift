import SwiftUI

/// Account page (V10 WP7): profile, plan and credits, AI use, language, own AI keys, data and sign-out —
/// everything about "me" in one place instead of a popover.
struct AccountView: View {
    @EnvironmentObject var model: AppModel

    private var a: AccountState? { model.account }
    private var billing: BillingStore { model.billingStore }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader(title: L("common.account"), subtitle: a?.email ?? "", icon: "person.crop.circle.fill") {
                    Button { model.syncNow() } label: { Label(L("account.syncProjects"), systemImage: "arrow.triangle.2.circlepath") }
                        .bidButton(.secondary, compact: true)
                }

                profileCard

                if a?.features?.billingPlans == true || a?.credits != nil {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            SectionLabel(text: L("billing.title"), icon: "bolt.fill")
                            Spacer()
                            if a?.features?.billingPlans == true {
                                Button(L("billing.menu")) { model.sheet = .plans }.bidButton(.primary, compact: true)
                            }
                            if billing.status?.subscription?.manageable == true {
                                Button(L("billing.manage")) { billing.openPortal() }.bidButton(.secondary, compact: true)
                            }
                        }
                        if let why = billing.billingUnavailable {
                            // the cloud side of plans is not deployed yet: say it calmly, where the plans would be
                            Label(L("billing.notReady"), systemImage: "info.circle")
                                .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                                .help(why)
                        }
                        if let s = billing.status {
                            BalanceCard(status: s)
                            if !s.usage.isEmpty { UsageList(usage: Array(s.usage.prefix(8))) }
                        } else if let c = a?.credits {
                            HStack(spacing: 12) {
                                KPITile(value: Fmt.tokens(c.balance), label: L("billing.tokensLeft"), icon: "bolt.fill", tint: Theme.accent)
                                if let g = c.monthlyGrant { KPITile(value: Fmt.tokens(g), label: L("account.monthlyGrant"), icon: "calendar") }
                            }
                        }
                    }
                }

                if a?.canUseOwnKey == true { AIKeysCard() }

                VStack(alignment: .leading, spacing: 12) {
                    SectionLabel(text: L("settings.language"), icon: "globe")
                    LanguageRow()
                }
                .card()

                VStack(alignment: .leading, spacing: 10) {
                    SectionLabel(text: L("account.yourData"), icon: "externaldrive.fill")
                    Text(L("account.yourDataHint")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        Button(L("account.export")) { model.exportAccountData() }.bidButton(.secondary, compact: true)
                        Button(L("account.signOut")) { model.logout() }.bidButton(.secondary, compact: true)
                        Spacer()
                        Button(L("account.deleteButton")) { model.sheet = .deleteAccount }.bidButton(.danger, compact: true)
                    }
                }
                .card()
            }
            .padding(.horizontal, 32)
            .padding(.top, 40)
            .padding(.bottom, 32)
            .frame(maxWidth: 1000)
            .frame(maxWidth: .infinity)
        }
        .task { if a?.features?.billingPlans == true || a?.credits?.monthlyGrant != nil { await billing.load() } }
    }

    private var profileCard: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().fill(Theme.avatarGradient(for: a?.email ?? "?")).frame(width: 64, height: 64)
                Text(String((a?.name ?? a?.email ?? "?").prefix(1)).uppercased())
                    .font(Typo.font(.display, weight: .bold, design: .rounded)).foregroundColor(.white)
                if let f = a?.credits?.fraction {
                    Circle().stroke(Theme.elevated, lineWidth: 4).frame(width: 76, height: 76)
                    Circle().trim(from: 0, to: max(0.02, f))
                        .stroke(f < 0.1 ? Theme.warn : Theme.ready, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .rotationEffect(.degrees(-90)).frame(width: 76, height: 76)
                        .animation(Motion.gentle, value: f)
                }
            }
            .frame(width: 80, height: 80)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(a?.name ?? a?.email ?? "").font(Typo.font(.title, weight: .bold)).foregroundColor(Theme.text)
                HStack(spacing: 6) {
                    if let role = a?.role { Chip(text: role, icon: role == "admin" ? "crown.fill" : role == "vip" ? "star.fill" : "person.fill", tint: role == "normal" ? Theme.secondary : Theme.accent) }
                    if let plan = a?.plan { Chip(text: BillingFormat.planName(plan), icon: "sparkles", tint: plan == "free" ? Theme.secondary : Theme.ready) }
                    if let p = a?.provider { Chip(text: p, icon: p == "apple" ? "apple.logo" : p == "github" ? "chevron.left.forwardslash.chevron.right" : "envelope") }
                    if a?.profileStale == true { Chip(text: L("account.offlineCopy"), icon: "wifi.slash", tint: Theme.warn) }
                }
                if let c = a?.credits {
                    Text(creditsLine(c)).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                }
            }
            Spacer()
        }
        .card(padding: 20, tint: a?.plan == "free" ? nil : Theme.accent)
    }

    private func creditsLine(_ c: AccountState.Credits) -> String {
        var s = L("account.creditsHelp", Fmt.tokens(c.balance))
        if let r = c.renewsAt { s += " · " + L("ai.renewsOn", BillingFormat.day(r)) }
        else if let e = c.endsAt { s += " · " + L("account.endsOn", BillingFormat.day(e)) }
        return s
    }
}
