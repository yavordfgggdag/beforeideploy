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
    static let bg = Color.adaptive(0xF5F5F7, 0x1C1C1E)
    static let sidebar = Color.adaptive(0xECECEE, 0x161618)
    static let panel = Color.adaptive(0xFFFFFF, 0x232325)
    static let elevated = Color.adaptive(0xF2F2F4, 0x2C2C2E)
    static let hover = Color.adaptive(0xE8E8ED, 0x3A3A3C)
    static let inset = Color.adaptive(0xEDEDF0, 0x1C1C1E)
    static let hairline = Color.adaptive(0x000000, 0x38383A, lightAlpha: 0.10)
    static let text = Color.adaptive(0x1D1D1F, 0xF5F5F7)
    static let secondary = Color.adaptive(0x5E5E63, 0xA1A1A6)
    static var tertiary: Color {
        NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast ? secondary : .adaptive(0x6E6E73, 0x9A9AA0)
    }
    static let accent = Tone.accent.text
    static let accentFill = Tone.accent.fill
    static let accentSoft = Tone.accent.soft
    static let ready = Tone.success.text
    static let warn = Tone.warning.text
    static let blocked = Tone.danger.text
    static let idle = secondary
    static let info = Tone.info.text
    static let brandViolet = Color.adaptive(0x7A3FD6, 0xB57BFF)
    static let topup = brandViolet
    static let onAccent = Color.white
    static let scrim = Color.adaptive(0, 0, lightAlpha: 0.25, darkAlpha: 0.45)
    static let accentGradient = LinearGradient(colors: [accentFill, accentFill], startPoint: .top, endPoint: .bottom)
    static let radius = Radius.l
    static let smallRadius = Radius.m
    static let edgeHighlight = LinearGradient(
        colors: [.adaptive(0, 0xFFFFFF, lightAlpha: 0.06, darkAlpha: 0.11),
                 .adaptive(0, 0xFFFFFF, lightAlpha: 0, darkAlpha: 0.035)], startPoint: .top, endPoint: .bottom)
    static let sheen = LinearGradient(colors: [.clear, .clear], startPoint: .top, endPoint: .bottom)

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
    var padding: CGFloat = Space.l
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
            .elevation(.card)
    }
}

extension View {
    func card(padding: CGFloat = Space.l, fill: Color = Theme.panel, tint: Color? = nil) -> some View {
        modifier(Card(padding: padding, fill: fill, tint: tint))
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
        Meter(value: fraction, style: .ring, size: size, tint: tint)
            .overlay(Image(systemName: symbol).font(Typo.icon(size: size * 0.36, weight: .bold)).foregroundColor(tint))
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
    var body: some View { Badge(text: text, icon: icon, tint: tint) }
}

struct StatusDot: View {
    let status: String?
    var size: CGFloat = 8
    var body: some View {
        Circle()
            .fill(Theme.color(for: status))
            .frame(width: size, height: size)
            .accessibilityLabel(status == "pass" || status == "ready" ? L("common.ready") : status == "fail" || status == "blocked" ? L("common.blocked") : L("signal.unchecked"))
    }
}

// MARK: - Buttons

enum ButtonKind { case primary, secondary, danger, ghost }

struct BIDButtonStyle: ButtonStyle {
    var kind: ButtonKind = .secondary
    var compact = false
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.isFocused) private var isFocused

    func makeBody(configuration: Configuration) -> some View {
        let fg: Color
        let bg: Color
        let border: Color
        switch kind {
        case .primary:
            fg = Theme.onAccent; bg = Theme.accentFill; border = Color.white.opacity(0.12)
        case .secondary:
            fg = Theme.text; bg = Theme.elevated; border = Theme.hairline
        case .danger:
            fg = Theme.blocked; bg = Theme.blocked.opacity(0.10); border = Theme.blocked.opacity(0.45)
        case .ghost:
            fg = Theme.secondary; bg = .clear; border = .clear
        }
        return configuration.label
            .font(Typo.font(compact ? .callout : .body, weight: .semibold))
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
                    .strokeBorder(isFocused ? Theme.accent : border, lineWidth: isFocused ? 2 : 1)
            )

            .contentShape(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
            .scaleEffect(configuration.isPressed && !Motion.reduced ? 0.98 : 1)
            .opacity(isEnabled ? 1 : 0.4)
            .animation(Motion.quick, value: configuration.isPressed)
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
    @FocusState private var focused: Bool
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
                        .strokeBorder(focused ? Theme.accent : Theme.hairline, lineWidth: focused ? 2 : 1)
                )
        }
        .buttonStyle(.plain)
        .focused($focused)
        .help(help)
        .accessibilityLabel(help)
        .onHover { hovering = $0 }
    }
}

struct BIDTextField: View {
    let placeholder: String
    @Binding var text: String
    var mono = false
    var body: some View { BIDField(placeholder: placeholder, text: $text, kind: mono ? .mono : .text) }
}

struct Spinner: View {
    var size: CGFloat = 12
    var color: Color = Theme.accent
    @Local private var spin = false
    var body: some View {
        Group {
            if Motion.reduced {
                Image(systemName: "hourglass").font(Typo.icon(size: size)).foregroundColor(color)
            } else {
                ProgressView().controlSize(.small).scaleEffect(max(0.7, size / 16))
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(L("common.loading"))
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

extension View {
    /// A row or card that acts on click: also a button for VoiceOver and Full Keyboard Access (Space / VO-Space
    /// run the same action), so no action is reachable by mouse only (WP08, audit A9).
    func tapAction(_ action: @escaping () -> Void) -> some View {
        self
            .contentShape(Rectangle())
            .onTapGesture(perform: action)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(.default, action)
    }
}

/// Lays items out left to right at their natural width and wraps onto the next line when the row is full —
/// buttons and pills never get squeezed until their text breaks letter by letter.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let size = v.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                y += lineHeight + lineSpacing
                x = 0
                lineHeight = 0
            }
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, lineHeight: CGFloat = 0
        for v in subviews {
            let size = v.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += lineHeight + lineSpacing
                x = bounds.minX
                lineHeight = 0
            }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
