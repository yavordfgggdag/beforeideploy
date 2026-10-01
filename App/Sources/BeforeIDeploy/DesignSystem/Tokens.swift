import AppKit
import SwiftUI

enum Appearance: String, CaseIterable {
    case system, light, dark
    static let storageKey = "appearance"
    var label: String {
        switch self {
        case .system: return L("appearance.system")
        case .light: return L("appearance.light")
        case .dark: return L("appearance.dark")
        }
    }
    func apply() {
        NSApp.appearance = self == .system ? nil : NSAppearance(named: self == .dark ? .darkAqua : .aqua)
    }
}

extension Color {
    static func adaptive(_ light: UInt32, _ dark: UInt32, lightAlpha: Double = 1, darkAlpha: Double = 1) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            let hex = isDark ? dark : light
            return NSColor(srgbRed: Double((hex >> 16) & 255) / 255,
                           green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255,
                           alpha: isDark ? darkAlpha : lightAlpha)
        })
    }
}

enum Tone {
    case success, warning, danger, info, neutral, accent
    var fill: Color {
        switch self {
        case .success: return Color(hex: 0x1E7F3C)
        case .warning: return Color(hex: 0xB25000)
        case .danger: return Color(hex: 0xD70015)
        case .info: return Color(hex: 0x007A8A)
        case .neutral: return Color(hex: 0x5E5E63)
        case .accent: return Color(hex: 0x0A66D6)
        }
    }
    var text: Color {
        switch self {
        case .success: return .adaptive(0x1E7F3C, 0x30D158)
        case .warning: return .adaptive(0xB25000, 0xFF9F0A)
        case .danger: return .adaptive(0xD70015, 0xFF6961)
        case .info: return .adaptive(0x007A8A, 0x5AC8FA)
        case .neutral: return Theme.secondary
        case .accent: return .adaptive(0x0A66D6, 0x409CFF)
        }
    }
    var soft: Color { text.opacity(0.12) }
    static func status(_ value: String?) -> Tone {
        switch value {
        case "pass", "ready", "ok", "running-ok": return .success
        case "warn", "warnings": return .warning
        case "fail", "blocked": return .danger
        case "info": return .info
        case "running", "waiting_user": return .accent
        default: return .neutral
        }
    }
}

enum Typo {
    enum Role: CGFloat {
        case display = 28, title = 22, headline = 17, subhead = 14, body = 13, callout = 12, caption = 11, micro = 10
    }
    static func font(_ role: Role, weight: Font.Weight? = nil, design: Font.Design = .default) -> Font {
        let defaultWeight: Font.Weight = role == .display || role == .title ? .bold :
            ([.headline, .subhead, .micro].contains(role) ? .semibold : .regular)
        // Scale with the system's preferred reading size, with a 10 pt minimum.
        let scale = NSFont.preferredFont(forTextStyle: .body).pointSize / 13
        return .system(size: max(10, role.rawValue * scale), weight: weight ?? defaultWeight, design: design)
    }
    static func icon(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Font {
        .system(size: max(10, size), weight: weight, design: design)
    }
}

enum Space {
    static let xxs: CGFloat = 2, xs: CGFloat = 4, s: CGFloat = 8, m: CGFloat = 12, l: CGFloat = 16
    static let xl: CGFloat = 20, xxl: CGFloat = 24, page: CGFloat = 32, top: CGFloat = 40
}
enum Radius {
    static let xs: CGFloat = 6, s: CGFloat = 8, m: CGFloat = 12, l: CGFloat = 16, xl: CGFloat = 20
    static let full: CGFloat = 999
}
enum Elevation { case flat, card, popover, modal }
private struct ElevationModifier: ViewModifier {
    let level: Elevation
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        let dark = scheme == .dark
        let opacity: Double = level == .flat ? 0 : level == .card ? (dark ? 0.20 : 0.12) : level == .popover ? (dark ? 0.28 : 0.14) : (dark ? 0.50 : 0.18)
        let radius: CGFloat = level == .card ? 1.5 : level == .popover ? 14 : 40
        let y: CGFloat = level == .card ? 1 : level == .popover ? 6 : 16
        return content.shadow(color: .black.opacity(opacity), radius: radius, y: y)
    }
}
extension View {
    func elevation(_ level: Elevation) -> some View { modifier(ElevationModifier(level: level)) }
}
