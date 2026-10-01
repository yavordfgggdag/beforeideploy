import SwiftUI

/// The app mark: a paperplane on a blue rounded tile.
struct AppGlyph: View {
    enum Style { case filled, onBrand }
    var size: CGFloat = 28
    var style: Style = .filled
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(style == .onBrand ? Color.white.opacity(0.18) : Theme.accentFill)
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            Image(systemName: "paperplane.fill")
                .font(Typo.icon(size: size * 0.44, weight: .semibold))
                .foregroundColor(.white)
                .rotationEffect(.degrees(-8))
                .offset(x: -size * 0.02, y: size * 0.02)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
