import SwiftUI

/// One readable usage row, shared by each time window and the credit period.
struct CreditsMeter: View {
    let title: String
    let used: Int
    var reserved: Int = 0
    let total: Int
    let detail: String
    private var share: Double { total > 0 ? min(1, max(0, Double(used + reserved) / Double(total))) : 0 }
    private var tint: Color { share >= 0.9 ? Theme.blocked : share >= 0.75 ? Theme.warn : Theme.accent }
    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(Typo.font(.subhead)).foregroundColor(Theme.text)
                Spacer()
                Text(L("usage.creditsOf", Fmt.tokens(used), Fmt.tokens(total))).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                Text(share.formatted(.percent.precision(.fractionLength(0)))).font(Typo.font(.callout, weight: .semibold)).foregroundColor(tint).frame(minWidth: 38, alignment: .trailing)
            }
            Meter(value: Double(used + reserved), total: Double(total), size: 8,
                  label: L("usage.barLabel", Fmt.tokens(used), Fmt.tokens(reserved), Fmt.tokens(total)),
                  segments: [.init(value: Double(used), color: tint), .init(value: Double(reserved), color: Theme.warn)])
            HStack {
                Text(detail)
                Spacer()
                if reserved > 0 { Text(L("usage.pillReserved", Fmt.tokens(reserved))) }
            }.font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
        }
    }
}
