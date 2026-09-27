import SwiftUI

/// First-launch flow (V10 WP5): Language (LanguageViews) → this tour → sign in → first project.
enum Onboarding {
    /// Set once the tour was seen or skipped; a V9 upgrade sets it too (Localization.migrateFromV9).
    static let tourSeenKey = "onboarding.tourSeen"

    struct Page: Identifiable {
        let id: Int
        let symbol: String
        let titleKey: String
        let textKey: String
        let bullets: [String]
    }

    static let pages: [Page] = [
        Page(id: 0, symbol: "checkmark.seal.fill", titleKey: "tour.1.title", textKey: "tour.1.text",
             bullets: ["tour.1.b1", "tour.1.b2", "tour.1.b3"]),
        Page(id: 1, symbol: "paperplane.fill", titleKey: "tour.2.title", textKey: "tour.2.text",
             bullets: ["tour.2.b1", "tour.2.b2", "tour.2.b3"]),
        Page(id: 2, symbol: "sparkles", titleKey: "tour.3.title", textKey: "tour.3.text",
             bullets: ["tour.3.b1", "tour.3.b2", "tour.3.b3"]),
    ]
}

/// Three screens of value before the sign-in screen. Return = next, Esc = skip.
struct WelcomeTourView: View {
    @AppStorage(Onboarding.tourSeenKey) private var tourSeen = false
    @Local private var index = 0

    private var page: Onboarding.Page { Onboarding.pages[min(index, Onboarding.pages.count - 1)] }
    private var isLast: Bool { index >= Onboarding.pages.count - 1 }

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x0B3D91), Color(hex: 0x0A6EF0), Color(hex: 0x3B9CFF)],
                           startPoint: .bottomLeading, endPoint: .topTrailing)
            Circle().fill(Color.white.opacity(0.08)).frame(width: 620).offset(x: 360, y: -300).blur(radius: 2)
            Circle().fill(Color.white.opacity(0.06)).frame(width: 420).offset(x: -380, y: 320)

            VStack(spacing: 22) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.18))
                        Image(systemName: "paperplane.fill").font(.system(size: 22, weight: .bold)).foregroundColor(.white).rotationEffect(.degrees(-8))
                    }
                    .frame(width: 50, height: 50)
                    Text("Before I Deploy").font(.system(size: 24, weight: .bold)).foregroundColor(.white)
                }

                VStack(spacing: 18) {
                    Image(systemName: page.symbol)
                        .font(.system(size: 40, weight: .semibold))
                        .foregroundColor(Theme.accent)
                        .frame(width: 84, height: 84)
                        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Theme.accentSoft))
                    VStack(spacing: 8) {
                        Text(L(page.titleKey))
                            .font(.system(size: 24, weight: .heavy))
                            .foregroundColor(Theme.text)
                            .multilineTextAlignment(.center)
                        Text(L(page.textKey))
                            .font(.system(size: 13.5))
                            .foregroundColor(Theme.secondary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(page.bullets, id: \.self) { key in
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: "checkmark.circle.fill").foregroundColor(Theme.ready).font(.system(size: 13))
                                Text(L(key)).font(.system(size: 13)).foregroundColor(Theme.text)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .padding(32)
                .frame(width: 560)
                .background(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).fill(Theme.panel))
                .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
                .id(page.id)
                .transition(.opacity.combined(with: .move(edge: .trailing)))

                HStack(spacing: 8) {
                    ForEach(Onboarding.pages) { p in
                        Circle()
                            .fill(p.id == page.id ? Color.white : Color.white.opacity(0.35))
                            .frame(width: 7, height: 7)
                    }
                }
                .accessibilityLabel(L("tour.pageOf", page.id + 1, Onboarding.pages.count))

                HStack(spacing: 12) {
                    Button(L("tour.skip")) { finish() }
                        .buttonStyle(.plain)
                        .foregroundColor(.white.opacity(0.8))
                        .font(.system(size: 13, weight: .medium))
                        .keyboardShortcut(.cancelAction)
                    Spacer()
                    if index > 0 {
                        Button(L("tour.back")) { withAnimation(.easeInOut(duration: 0.22)) { index -= 1 } }
                            .bidButton(.secondary)
                    }
                    Button(isLast ? L("tour.start") : L("tour.next")) {
                        if isLast { finish() } else { withAnimation(.easeInOut(duration: 0.22)) { index += 1 } }
                    }
                    .bidButton(.primary)
                    .keyboardShortcut(.defaultAction)
                }
                .frame(width: 560)
            }
            .padding(40)
        }
        .clipped()
    }

    private func finish() {
        withAnimation(.easeInOut(duration: 0.25)) { tourSeen = true }
    }
}

/// "Sign in with Apple" per Apple's guidelines: black button, white logo and text, same height as bidButton.
struct AppleSignInButton: View {
    let action: () -> Void
    @Local private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Spacer()
                Image(systemName: "apple.logo").font(.system(size: 14, weight: .semibold))
                Text(L("auth.apple")).font(.system(size: 13, weight: .semibold))
                Spacer()
            }
            .foregroundColor(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).fill(hovering ? Color(white: 0.12) : .black))
            .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(L("auth.apple"))
    }
}

/// Shown on the empty main screen: the three steps to a first deploy, with their shortcuts, plus a
/// pointer to Setup when required tools are missing.
struct FirstStepsCard: View {
    @EnvironmentObject var model: AppModel

    private var steps: [(String, String, String, String)] {
        [
            ("folder.badge.plus", L("firstSteps.add"), L("firstSteps.addHint"), "⌘O"),
            ("checkmark.seal", L("firstSteps.check"), L("firstSteps.checkHint"), "⌘R"),
            ("paperplane", L("firstSteps.deploy"), L("firstSteps.deployHint"), "⌘D"),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L("firstSteps.title"))
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(Theme.tertiary)
                .textCase(.uppercase)
                .kerning(0.6)
            ForEach(steps.indices, id: \.self) { i in
                let s = steps[i]
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        Circle().fill(Theme.elevated)
                        Text("\(i + 1)").font(.system(size: 11, weight: .bold)).foregroundColor(Theme.text)
                    }
                    .frame(width: 22, height: 22)
                    Image(systemName: s.0).font(.system(size: 13, weight: .medium)).foregroundColor(Theme.accent).frame(width: 18)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.1).font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.text)
                        Text(s.2).font(.system(size: 12)).foregroundColor(Theme.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    Text(s.3).font(.system(size: 11, weight: .medium, design: .rounded)).foregroundColor(Theme.tertiary)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(Theme.elevated))
                }
            }
            if let setup = model.setup, !setup.ready {
                Rectangle().fill(Theme.hairline).frame(height: 1)
                HStack(spacing: 10) {
                    Image(systemName: "wrench.and.screwdriver").foregroundColor(Theme.warn)
                    Text(L("firstSteps.setupHint")).font(.system(size: 12.5)).foregroundColor(Theme.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button(L("common.setup")) { model.screen = .setup }
                        .bidButton(.secondary, compact: true)
                }
            }
        }
        .padding(18)
        .frame(width: 460)
        .background(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).fill(Theme.panel))
        .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }
}
