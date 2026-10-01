import SwiftUI

struct KPITile: View {
    let value: String
    let label: String
    let icon: String
    var tint: Color = Theme.text

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: icon)
                    .font(Typo.font(.callout, weight: .semibold))
                    .foregroundColor(tint == Theme.text ? Theme.accent : tint)
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous)
                        .fill((tint == Theme.text ? Theme.accent : tint).opacity(0.14)))
                Spacer()
            }
            if let n = Int(value) {
                CountUp(target: n, format: { String($0) }, font: Typo.font(.display, weight: .bold, design: .rounded), color: tint)
            } else {
                Text(value).font(Typo.font(.display, weight: .bold, design: .rounded)).foregroundColor(tint).monospacedDigit()
            }
            Text(label).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 16)
        .lift(tint: tint == Theme.text ? Theme.accent : tint)
        .accessibilityElement(children: .combine)
    }
}
