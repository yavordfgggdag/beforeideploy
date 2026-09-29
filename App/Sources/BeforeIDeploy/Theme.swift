import AppKit
import SwiftUI

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

enum Theme {
    // macOS dark system palette
    static let bg = Color(hex: 0x1C1C1E)
    static let sidebar = Color(hex: 0x161618)
    static let panel = Color(hex: 0x232325)
    static let elevated = Color(hex: 0x2C2C2E)
    static let hover = Color(hex: 0x3A3A3C)
    static let hairline = Color(hex: 0x38383A)
    static let text = Color(hex: 0xF5F5F7)
    static let secondary = Color(hex: 0x98989D)
    /// ≥ 4.5:1 on the window and panel backgrounds (WCAG AA, audit A12); with Increase Contrast it
    /// becomes the secondary grey.
    static var tertiary: Color {
        NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast ? secondary : Color(hex: 0x8E8E93)
    }
    static let accent = Color(nsColor: .systemBlue)
    static let accentSoft = Color(nsColor: .systemBlue).opacity(0.16)
    static let ready = Color(nsColor: .systemGreen)
    static let warn = Color(nsColor: .systemOrange)
    static let blocked = Color(nsColor: .systemRed)
    static let idle = Color(hex: 0x6E6E73)
    static let info = Color(nsColor: .systemTeal)

    static let accentGradient = LinearGradient(
        colors: [Color(hex: 0x3B9CFF), Color(hex: 0x0A6EF0)],
        startPoint: .top, endPoint: .bottom
    )

    static let radius: CGFloat = 16
    static let smallRadius: CGFloat = 10

    /// Top-lit edge of every raised surface: light catches the upper border, the lower one fades out.
    static let edgeHighlight = LinearGradient(
        colors: [Color.white.opacity(0.11), Color.white.opacity(0.035)],
        startPoint: .top, endPoint: .bottom
    )

    /// A soft sheen over a surface's upper half — the "glass" in the V10 look.
    static let sheen = LinearGradient(
        colors: [Color.white.opacity(0.035), Color.white.opacity(0)],
        startPoint: .top, endPoint: .center
    )

    /// Stable, pleasant gradient per project name, so every project is recognizable at a glance.
    static func avatarGradient(for name: String) -> LinearGradient {
        let palette: [(UInt32, UInt32)] = [
            (0x5AA9FF, 0x2A6BF2), // blue
            (0x7C7BFF, 0x4B3FD6), // indigo
            (0xB57BFF, 0x7A3FD6), // violet
            (0xFF7EB6, 0xD63F83), // pink
            (0xFF9F5A, 0xE0602A), // orange
            (0xFFD35A, 0xD69A1F), // amber
            (0x5BE0A0, 0x1FA36A), // green
            (0x4FD8E0, 0x1C97B3), // teal
        ]
        let hash = name.unicodeScalars.reduce(UInt32(5381)) { ($0 &* 33) &+ $1.value }
        let pair = palette[Int(hash % UInt32(palette.count))]
        return LinearGradient(colors: [Color(hex: pair.0), Color(hex: pair.1)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    static func color(for status: String?) -> Color {
        switch status {
        case "pass", "ready", "ok", "running-ok": return ready
        case "warn", "warnings": return warn
        case "fail", "blocked": return blocked
        case "info": return info
        case "running": return accent
        default: return idle
        }
    }

    static func symbol(for status: String?) -> String {
        switch status {
        case "pass", "ready", "ok": return "checkmark.circle.fill"
        case "warn", "warnings": return "exclamationmark.triangle.fill"
        case "fail", "blocked": return "xmark.octagon.fill"
        case "info": return "info.circle.fill"
        case "skipped": return "minus.circle"
        case "pending": return "circle.dotted"
        default: return "circle"
        }
    }
}

// MARK: - Motion

/// Animations that respect System Settings → Accessibility → Reduce motion (nil = no animation).
enum Motion {
    static var reduced: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    static var spring: Animation? { reduced ? nil : .spring(response: 0.38, dampingFraction: 0.82) }
    static var quick: Animation? { reduced ? nil : .easeOut(duration: 0.16) }
    static var gentle: Animation? { reduced ? nil : .easeInOut(duration: 0.6) }
}

// MARK: - Surfaces

/// A raised surface: fill + sheen + top-lit edge + two-layer shadow (contact and ambient).
/// `tint` washes the surface with a status color from the top-left corner.
struct Card: ViewModifier {
    var padding: CGFloat = 18
    var fill: Color = Theme.panel
    var tint: Color? = nil
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
        return content
            .padding(padding)
            .background(
                ZStack {
                    shape.fill(fill)
                    if let tint {
                        shape.fill(LinearGradient(colors: [tint.opacity(0.16), tint.opacity(0.03), .clear],
                                                  startPoint: .topLeading, endPoint: .bottomTrailing))
                    }
                    shape.fill(Theme.sheen)
                }
            )
            .overlay(shape.strokeBorder(Theme.edgeHighlight, lineWidth: 1))
            .shadow(color: .black.opacity(0.20), radius: 1.5, x: 0, y: 1)
            .shadow(color: .black.opacity(0.24), radius: 18, x: 0, y: 8)
    }
}

extension View {
    func card(padding: CGFloat = 18, fill: Color = Theme.panel, tint: Color? = nil) -> some View {
        modifier(Card(padding: padding, fill: fill, tint: tint))
    }
}

/// The window backdrop: the base color with two slow, faint light pools (accent top-right, violet bottom-left).
struct AmbientBackground: View {
    var tint: Color = Theme.accent
    var body: some View {
        ZStack {
            Theme.bg
            RadialGradient(colors: [tint.opacity(0.10), .clear], center: .topTrailing, startRadius: 0, endRadius: 760)
            RadialGradient(colors: [Color(hex: 0x7A3FD6).opacity(0.06), .clear], center: .bottomLeading, startRadius: 0, endRadius: 640)
        }
        .allowsHitTesting(false)
        .animation(Motion.gentle, value: tint)
    }
}

/// Letter avatar in the project's own gradient.
struct ProjectAvatar: View {
    let name: String
    var size: CGFloat = 28
    var dimmed = false
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                .fill(Theme.avatarGradient(for: name))
            RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
            Text(String(name.prefix(1)).uppercased())
                .font(.system(size: size * 0.45, weight: .bold, design: .rounded))
                .foregroundColor(.white)
                .shadow(color: .black.opacity(0.25), radius: 1, y: 1)
        }
        .frame(width: size, height: size)
        .opacity(dimmed ? 0.45 : 1)
        .accessibilityHidden(true)
    }
}

/// Circular progress around a status symbol (the share of passed steps).
struct StatusRing: View {
    let fraction: Double
    let tint: Color
    let symbol: String
    var size: CGFloat = 54
    var body: some View {
        ZStack {
            Circle().fill(tint.opacity(0.12))
                .blur(radius: 10)
                .frame(width: size + 8, height: size + 8)
            Circle().stroke(Theme.elevated, lineWidth: 4)
            Circle()
                .trim(from: 0, to: max(0.001, min(1, fraction)))
                .stroke(tint, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: tint.opacity(0.5), radius: 4)
                .animation(Motion.gentle, value: fraction)
            Image(systemName: symbol)
                .font(.system(size: size * 0.36, weight: .bold))
                .foregroundColor(tint)
        }
        .frame(width: size, height: size)
    }
}

struct SectionLabel: View {
    let text: String
    var icon: String? = nil
    var body: some View {
        HStack(spacing: 6) {
            if let icon { Image(systemName: icon).font(.system(size: 10, weight: .semibold)) }
            Text(text.uppercased())
                .font(.system(size: 10.5, weight: .semibold))
                .tracking(0.9)
        }
        .foregroundColor(Theme.tertiary)
    }
}

struct Chip: View {
    let text: String
    var icon: String? = nil
    var tint: Color = Theme.secondary
    var body: some View {
        HStack(spacing: 5) {
            if let icon { Image(systemName: icon).font(.system(size: 10, weight: .semibold)) }
            Text(text).font(.system(size: 11.5, weight: .medium)).lineLimit(1)
        }
        .foregroundColor(tint)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Capsule().fill(Theme.elevated))
        .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
    }
}

struct StatusDot: View {
    let status: String?
    var size: CGFloat = 8
    var body: some View {
        Circle()
            .fill(Theme.color(for: status))
            .frame(width: size, height: size)
            .shadow(color: Theme.color(for: status).opacity(status == nil ? 0 : 0.55), radius: 4)
    }
}

// MARK: - Buttons

enum ButtonKind { case primary, secondary, danger, ghost }

struct BIDButtonStyle: ButtonStyle {
    var kind: ButtonKind = .secondary
    var compact = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let fg: Color
        let bg: Color
        let border: Color
        switch kind {
        case .primary:
            fg = .white; bg = Theme.accent; border = Color.white.opacity(0.12)
        case .secondary:
            fg = Theme.text; bg = Theme.elevated; border = Theme.hairline
        case .danger:
            fg = Theme.blocked; bg = Theme.blocked.opacity(0.10); border = Theme.blocked.opacity(0.45)
        case .ghost:
            fg = Theme.secondary; bg = .clear; border = .clear
        }
        return configuration.label
            .font(.system(size: compact ? 12 : 13, weight: .semibold))
            .foregroundColor(fg)
            .padding(.horizontal, compact ? 10 : 14)
            .padding(.vertical, compact ? 6 : 9)
            .background(
                ZStack {
                    if kind == .primary {
                        RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous)
                            .fill(Theme.accentGradient)
                            .opacity(configuration.isPressed ? 0.8 : 1)
                    } else {
                        RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous)
                            .fill(configuration.isPressed ? bg.opacity(0.75) : bg)
                    }
                }
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous)
                    .strokeBorder(border, lineWidth: 1)
            )
            .shadow(color: kind == .primary && isEnabled ? Theme.accent.opacity(0.35) : .clear, radius: 10, y: 3)
            .contentShape(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(isEnabled ? 1 : 0.4)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension View {
    func bidButton(_ kind: ButtonKind = .secondary, compact: Bool = false) -> some View {
        buttonStyle(BIDButtonStyle(kind: kind, compact: compact))
    }
}

struct IconButton: View {
    let symbol: String
    let help: String
    var action: () -> Void
    @Local private var hovering = false
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(hovering ? Theme.text : Theme.secondary)
                .frame(width: 30, height: 30)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(hovering ? Theme.hover : Theme.elevated)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .strokeBorder(Theme.hairline, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityLabel(help)
        .onHover { hovering = $0 }
    }
}

struct BIDTextField: View {
    let placeholder: String
    @Binding var text: String
    var mono = false
    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(mono ? .system(size: 13, design: .monospaced) : .system(size: 13))
            .foregroundColor(Theme.text)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous)
                    .fill(Theme.bg)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous)
                    .strokeBorder(Theme.hairline, lineWidth: 1)
            )
    }
}

struct Spinner: View {
    var size: CGFloat = 12
    var color: Color = Theme.accent
    @Local private var spin = false
    var body: some View {
        Circle()
            .trim(from: 0.12, to: 0.88)
            .stroke(color, style: StrokeStyle(lineWidth: size / 6, lineCap: .round))
            .frame(width: size, height: size)
            .rotationEffect(.degrees(spin ? 360 : 0))
            .onAppear {
                withAnimation(.linear(duration: 0.8).repeatForever(autoreverses: false)) { spin = true }
            }
    }
}

// MARK: - Formatting

enum Fmt {
    static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    static let isoPlain = ISO8601DateFormatter()

    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        return iso.date(from: s) ?? isoPlain.date(from: s)
    }

    static func relative(_ s: String?) -> String {
        guard let d = date(s) else { return "—" }
        let secs = Date().timeIntervalSince(d)
        if secs < 45 { return L("time.justNow") }
        if secs < 3600 { return L("time.minutesAgo", Int(secs / 60)) }
        if secs < 86400 { return L("time.hoursAgo", Int(secs / 3600)) }
        let f = DateFormatter()
        f.locale = Localization.locale
        f.dateFormat = "d MMM, HH:mm"
        return f.string(from: d)
    }

    /// Date and time in the user's locale and time zone (usage periods, renewals — V11 RC).
    static func dateTime(_ s: String?) -> String {
        guard let d = date(s) else { return "—" }
        let f = DateFormatter()
        f.locale = Localization.locale
        f.timeZone = TimeZone.current
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: d)
    }

    static func time(_ s: String?) -> String {
        guard let d = date(s) else { return "—" }
        let f = DateFormatter()
        f.dateFormat = Calendar.current.isDateInToday(d) ? "HH:mm" : "dd.MM HH:mm"
        return f.string(from: d)
    }

    static func duration(_ secs: Double?) -> String {
        guard let secs else { return "" }
        if secs < 1 { return "<1s" }
        if secs < 60 { return String(format: "%.0fs", secs) }
        return "\(Int(secs) / 60)m \(Int(secs) % 60)s"
    }

    /// AI credits are tokens: big numbers grouped by the app locale ("1 000 000" / "1,000,000").
    static func tokens(_ n: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Localization.locale
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }

    static func host(_ url: String?) -> String {
        guard let url, let u = URL(string: url), let h = u.host else { return url ?? "—" }
        if let p = u.port { return "\(h):\(p)" }
        return h
    }
}
