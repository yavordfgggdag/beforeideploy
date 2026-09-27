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
    static let tertiary = Color(hex: 0x6E6E73)
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

// MARK: - Surfaces

struct Card: ViewModifier {
    var padding: CGFloat = 18
    var fill: Color = Theme.panel
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .fill(fill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .strokeBorder(Theme.hairline, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.22), radius: 12, x: 0, y: 4)
    }
}

extension View {
    func card(padding: CGFloat = 18, fill: Color = Theme.panel) -> some View {
        modifier(Card(padding: padding, fill: fill))
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
        if secs < 45 { return "току-що" }
        if secs < 3600 { return "преди \(Int(secs / 60)) мин" }
        if secs < 86400 { return "преди \(Int(secs / 3600)) ч" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "bg_BG")
        f.dateFormat = "d MMM, HH:mm"
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

    static func host(_ url: String?) -> String {
        guard let url, let u = URL(string: url), let h = u.host else { return url ?? "—" }
        if let p = u.port { return "\(h):\(p)" }
        return h
    }
}
