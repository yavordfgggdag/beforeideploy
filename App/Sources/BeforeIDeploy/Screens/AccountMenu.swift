import SwiftUI

// MARK: - Account badge (sidebar)

struct AccountBadge: View {
    @EnvironmentObject var model: AppModel
    @Local private var open = false
    @Local private var hover = false

    var body: some View {
        let a = model.account
        Button { open.toggle() } label: {
            HStack(spacing: 9) {
                ZStack {
                    Circle().fill(Theme.avatarGradient(for: a?.email ?? "?")).frame(width: 26, height: 26)
                    Text(String((a?.name ?? a?.email ?? "?").prefix(1)).uppercased())
                        .font(Typo.font(.callout, weight: .bold)).foregroundColor(.white)
                    // credits ring: what is left of this month's plan tokens
                    if let f = a?.credits?.fraction {
                    CreditRing(fraction: f, size: 32)
                    }
                }
                .frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: 1) {
                    Text(a?.loggedIn == true ? (a?.name ?? L("common.account")) : L("account.offline"))
                        .font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text).lineLimit(1)
                    Text(a?.loggedIn == true ? (a?.email ?? "") : L("account.signInToSync"))
                        .font(Typo.font(.caption)).foregroundColor(Theme.tertiary).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down").font(Typo.font(.micro, weight: .bold)).foregroundColor(Theme.tertiary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(hover ? Theme.elevated : Theme.panel))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(a?.credits.map { L("account.creditsHelp", Fmt.tokens($0.balance)) } ?? "")
        .popover(isPresented: $open, arrowEdge: .top) {
            AccountMenu(close: { open = false })
                .environmentObject(model)
        }
    }
}

/// The account badge's popover: who is signed in, plan and credits, and the account actions.
struct AccountMenu: View {
    @EnvironmentObject var model: AppModel
    let close: () -> Void

    var body: some View {
        let a = model.account
        VStack(alignment: .leading, spacing: 4) {
            if a?.loggedIn == true {
                Text(a?.email ?? "").font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                if let role = a?.role, let plan = a?.plan {
                    Text(L("account.rolePlan", K.role(role), K.plan(plan), Fmt.tokens(a?.credits?.balance ?? 0)))
                        .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                }
                Divider().padding(.vertical, 4)
                item(L("account.open"), "person.crop.circle") { model.screen = .account }
                if a?.features?.billingPlans == true {
                    item(L("billing.menu"), "sparkles") { model.sheet = .plans }
                }
                item(L("account.syncProjects"), "arrow.triangle.2.circlepath") { model.syncNow() }
                Divider().padding(.vertical, 4)
                item(L("account.signOut"), "rectangle.portrait.and.arrow.right") { model.logout() }
            } else {
                Text(L("account.signInToSync")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                Divider().padding(.vertical, 4)
                item(L("account.signInOrUp"), "person.crop.circle.badge.plus") { model.offlineMode = false }
            }
            Divider().padding(.vertical, 4)
            item(L("common.history"), "clock.arrow.circlepath") { model.sheet = .history }
            item(L("common.settings"), "gearshape") { SettingsWindow.open() }
        }
        .padding(12)
        .frame(width: 260, alignment: .leading)
    }

    private func item(_ title: String, _ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button { close(); action() } label: {
            Label(title, systemImage: symbol)
                .font(Typo.font(.body))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 5)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundColor(Theme.text)
    }
}
