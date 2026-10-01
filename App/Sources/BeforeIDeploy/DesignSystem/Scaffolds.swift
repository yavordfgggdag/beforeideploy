import AppKit
import SwiftUI

struct PageHeader<Trailing: View>: View {
    let title: String
    let subtitle: String
    let icon: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Theme.accentGradient)
                Image(systemName: icon).font(.system(size: 18, weight: .bold)).foregroundColor(.white)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Typo.font(.title)).foregroundColor(Theme.text)
                Text(subtitle).font(Typo.font(.body)).foregroundColor(Theme.secondary)
            }
            Spacer()
            trailing
        }
    }
}

struct SheetScaffold<Content: View, Actions: View>: View {
    let icon: String
    var iconTint: Color = Theme.accent
    let title: String
    var subtitle: String? = nil
    var width: CGFloat = SheetSize.m.rawValue
    var size: SheetSize? = nil
    @ViewBuilder var content: Content
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 11, style: .continuous).fill(iconTint.opacity(0.14))
                    RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(iconTint.opacity(0.22), lineWidth: 1)
                    Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundColor(iconTint)
                }
                .frame(width: 38, height: 38)

                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Typo.font(.headline)).foregroundColor(Theme.text)
                    if let subtitle { Text(subtitle).font(.system(size: 12)).foregroundColor(Theme.secondary) }
                }
                Spacer()
            }
            .padding(22)

            ScrollView {
                content.frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Space.xxl).padding(.bottom, Space.xl)
            }
            .frame(maxHeight: max(240, min(520, (NSApp.keyWindow?.screen?.visibleFrame.height ?? 820) - 240)))

            Rectangle().fill(Theme.hairline).frame(height: 1)
            HStack(spacing: 10) {
                Spacer()
                actions
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 14)
        }
        .frame(width: min(size?.rawValue ?? [SheetSize.s, .m, .l, .xl].min(by: { abs($0.rawValue - width) < abs($1.rawValue - width) })!.rawValue, (NSApp.keyWindow?.screen?.visibleFrame.width ?? 1280) - 80))
        .background(ZStack { Theme.panel; Theme.sheen })
    }
}

struct Segmented<T: Hashable>: View {
    let options: [(String, T)]
    @Binding var selection: T
    var body: some View {
        HStack(spacing: 4) {
            ForEach(options.indices, id: \.self) { i in
                let opt = options[i]
                Button {
                    withAnimation(Motion.quick) { selection = opt.1 }
                } label: {
                    Text(opt.0)
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundColor(selection == opt.1 ? Theme.text : Theme.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(selection == opt.1 ? Theme.hover : .clear))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == opt.1 ? .isSelected : [])
            }
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Theme.bg))
    }
}


typealias SegmentedControl<T: Hashable> = Segmented<T>
