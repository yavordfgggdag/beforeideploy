import AppKit
import SwiftUI

struct Badge: View {
    enum Style { case soft, solid, outline }
    enum Size { case sm, md }
    let text: String
    var icon: String? = nil
    var tone: Tone = .neutral
    var style: Style = .soft
    var size: Size = .md
    var tint: Color? = nil
    private var foreground: Color { style == .solid ? Theme.onAccent : tint ?? tone.text }
    var body: some View {
        HStack(spacing: Space.xs) {
            if let icon { Image(systemName: icon).accessibilityHidden(true) }
            Text(text).lineLimit(1)
        }
        .font(Typo.font(size == .sm ? .micro : .caption, weight: .semibold))
        .foregroundColor(foreground)
        .padding(.horizontal, Space.s).padding(.vertical, Space.xs)
        .background(Capsule().fill(style == .solid ? tone.fill : style == .soft ? (tint ?? tone.text).opacity(0.12) : .clear))
        .overlay(Capsule().strokeBorder(style == .outline ? Theme.hairline : .clear, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// Progress and usage share clamping, threshold colours and a spoken value.
struct Meter: View {
    enum Style { case bar, ring }
    struct Segment { let value: Double; let color: Color }
    let value: Double
    var total: Double = 1
    var style: Style = .bar
    var size: CGFloat = 6
    var tint: Color? = nil
    var thresholds = false
    var label = ""
    var segments: [Segment] = []
    var lineWidth: CGFloat = 4
    private var fraction: Double { total > 0 && value.isFinite && total.isFinite ? min(1, max(0, value / total)) : 0 }
    private var color: Color { tint ?? (thresholds ? (fraction >= 0.95 ? Theme.blocked : fraction >= 0.8 ? Theme.warn : Theme.accent) : Theme.accent) }
    var body: some View {
        Group {
            if style == .ring {
                ZStack {
                    Circle().stroke(Theme.elevated, lineWidth: lineWidth)
                    Circle().trim(from: 0, to: fraction)
                        .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)).rotationEffect(.degrees(-90))
                }.frame(width: size, height: size)
            } else {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.elevated)
                        if segments.isEmpty {
                            Capsule().fill(color).frame(width: geo.size.width * fraction)
                        } else {
                            HStack(spacing: 0) {
                                ForEach(segments.indices, id: \.self) { index in
                                    let before = segments.prefix(index).reduce(0) { $0 + max(0, $1.value) }
                                    let amount = max(0, min(max(0, segments[index].value), total - before))
                                    Rectangle().fill(segments[index].color)
                                        .frame(width: total > 0 ? geo.size.width * amount / total : 0)
                                }
                                Spacer(minLength: 0)
                            }.clipShape(Capsule())
                        }
                    }
                }.frame(height: size)
            }
        }
        .animation(Motion.quick, value: fraction)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue("\(Int((fraction * 100).rounded()))%")
    }
}

struct BIDField: View {
    enum Kind { case text, secure, search, mono }
    let placeholder: String
    @Binding var text: String
    var kind: Kind = .text
    var error: String? = nil
    @FocusState private var focused: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            HStack(spacing: Space.s) {
                if kind == .search { Image(systemName: "magnifyingglass").foregroundColor(Theme.secondary).accessibilityHidden(true) }
                Group {
                    if kind == .secure { SecureField(placeholder, text: $text) }
                    else { TextField(placeholder, text: $text) }
                }
                .textFieldStyle(.plain).focused($focused)
                .font(Typo.font(.body, design: kind == .mono ? .monospaced : .default))
                .accessibilityLabel(placeholder)
            }
            .foregroundColor(Theme.text).padding(Space.m)
            .background(RoundedRectangle(cornerRadius: Radius.m).fill(Theme.inset))
            .overlay(RoundedRectangle(cornerRadius: Radius.m).strokeBorder(error != nil ? Theme.blocked : focused ? Theme.accent : Theme.hairline, lineWidth: focused ? 2 : 1))
            if let error { Text(error).font(Typo.font(.caption)).foregroundColor(Theme.blocked) }
        }
    }
}

struct SelectableRow: ViewModifier {
    enum Style { case list, focus }
    let selected: Bool
    var style: Style = .list
    func body(content: Content) -> some View {
        content
            .background(RoundedRectangle(cornerRadius: Radius.s).fill(selected ? (style == .focus ? Theme.accentFill : Theme.accentSoft) : .clear))
            .overlay(RoundedRectangle(cornerRadius: Radius.s).strokeBorder(selected ? Theme.accent : .clear, lineWidth: 1))
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
extension View {
    func selectable(selected: Bool, style: SelectableRow.Style = .list) -> some View {
        modifier(SelectableRow(selected: selected, style: style))
    }
}

struct EmptyState: View {
    let icon: String
    let title: String
    var message: String? = nil
    var body: some View {
        VStack(spacing: Space.m) {
            Image(systemName: icon).font(Typo.font(.display)).foregroundColor(Theme.secondary).accessibilityHidden(true)
            Text(title).font(Typo.font(.headline)).foregroundColor(Theme.text)
            if let message { Text(message).font(Typo.font(.body)).foregroundColor(Theme.secondary).multilineTextAlignment(.center) }
        }.padding(Space.page).frame(maxWidth: .infinity)
    }
}
struct LoadingState: View {
    var message: String = L("common.loading")
    var body: some View {
        HStack(spacing: Space.s) { Spinner(size: 16); Text(message).font(Typo.font(.body)).foregroundColor(Theme.secondary) }
            .padding(Space.l).frame(maxWidth: .infinity)
    }
}
struct ErrorState: View {
    let message: String
    var retry: (() -> Void)? = nil
    var body: some View {
        VStack(spacing: Space.m) {
            Label(message, systemImage: "exclamationmark.circle").font(Typo.font(.body)).foregroundColor(Theme.blocked)
            if let retry { Button(L("common.retry"), action: retry).bidButton(.secondary) }
        }.padding(Space.l).frame(maxWidth: .infinity)
    }
}
struct SectionHeader: View {
    let title: String
    var icon: String? = nil
    var body: some View {
        HStack(spacing: Space.s) {
            if let icon { Image(systemName: icon).accessibilityHidden(true) }
            Text(title)
        }.font(Typo.font(.subhead)).foregroundColor(Theme.text)
    }
}

struct ScreenScaffold<Content: View, Actions: View>: View {
    let title: String
    let subtitle: String
    let icon: String
    @ViewBuilder var actions: Actions
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.xxl) {
                PageHeader(title: title, subtitle: subtitle, icon: icon) { actions }
                content
            }.frame(maxWidth: 1120).padding(.horizontal, Space.page).padding(.top, Space.top).padding(.bottom, Space.page)
                .frame(maxWidth: .infinity)
        }
    }
}

enum SheetSize: CGFloat { case s = 440, m = 560, l = 720, xl = 880 }
struct ModalShell<Content: View>: View {
    var size: SheetSize = .xl
    var height: CGFloat = 600
    var dismiss: (() -> Void)? = nil
    @ViewBuilder var content: Content
    @AccessibilityFocusState private var accessibilityFocus: Bool
    var body: some View {
        GeometryReader { geo in
            ZStack {
                Theme.scrim.ignoresSafeArea().onTapGesture { dismiss?() }.accessibilityHidden(true)
                content
                    .frame(width: max(0, min(size.rawValue, geo.size.width - Space.page)), height: max(0, min(height, geo.size.height - Space.page)))
                    .background(Theme.panel)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.xl))
                    .overlay(RoundedRectangle(cornerRadius: Radius.xl).strokeBorder(Theme.hairline, lineWidth: 1))
                    .elevation(.modal)
                    .accessibilityElement(children: .contain)
                    .accessibilityAddTraits(.isModal)
                    .accessibilityFocused($accessibilityFocus)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear { accessibilityFocus = true }
    }
}

struct CreditRing: View {
    let fraction: Double
    var size: CGFloat = 32
    var body: some View {
        Meter(value: fraction, style: .ring, size: size, tint: fraction < 0.1 ? Theme.warn : Theme.ready,
              lineWidth: size < 40 ? 2.5 : 4)
    }
}
