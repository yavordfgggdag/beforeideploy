import SwiftUI

struct KPITile: View {
    let value: String
    let label: String
    let icon: String
    var tint: Color = Theme.text
    /// Single-row stat strip (≤56 pt) so a screen's primary actions stay above the fold.
    var compact: Bool = false

    var body: some View {
        if compact { compactBody } else { fullBody }
    }

    private var iconTint: Color { tint == Theme.text ? Theme.accent : tint }

    private var compactBody: some View {
        HStack(spacing: Space.s) {
            Image(systemName: icon)
                .font(Typo.font(.caption, weight: .semibold))
                .foregroundColor(iconTint)
                .frame(width: 22, height: 22)
                .background(RoundedRectangle(cornerRadius: Radius.xs, style: .continuous).fill(iconTint.opacity(0.14)))
            Text(value)
                .font(Typo.font(.headline, weight: .bold, design: .rounded))
                .foregroundColor(tint)
                .monospacedDigit()
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
            Text(label)
                .font(Typo.font(.callout))
                .foregroundColor(Theme.tertiary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Space.m)
        .padding(.vertical, Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.panel))
        .overlay(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .help(label)
        .accessibilityElement(children: .combine)
    }

    private var fullBody: some View {
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
