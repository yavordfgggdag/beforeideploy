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
            WelcomeSky()

            VStack(spacing: 22) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Color.white.opacity(0.18))
                        Image(systemName: "paperplane.fill").font(Typo.font(.title, weight: .bold)).foregroundColor(.white).rotationEffect(.degrees(-8))
                    }
                    .frame(width: 50, height: 50)
                    .floating()
                    Text("Before I Deploy").font(Typo.font(.title, weight: .bold)).foregroundColor(.white)
                }
                .entrance(0)

                VStack(spacing: 18) {
                    Image(systemName: page.symbol)
                        .font(Typo.font(.display, weight: .semibold))
                        .foregroundColor(Theme.accent)
                        .frame(width: 84, height: 84)
                        .background(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous).fill(Theme.accentSoft))
                        .breath(Theme.accent)
                        .floating(amplitude: 3, period: 2.8)
                    VStack(spacing: 8) {
                        Text(L(page.titleKey))
                            .font(Typo.font(.title, weight: .heavy))
                            .foregroundColor(Theme.text)
                            .multilineTextAlignment(.center)
                        Text(L(page.textKey))
                            .font(Typo.font(.subhead))
                            .foregroundColor(Theme.secondary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(Array(page.bullets.enumerated()), id: \.element) { i, key in
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: "checkmark.circle.fill").foregroundColor(Theme.ready).font(Typo.font(.body))
                                Text(L(key)).font(Typo.font(.body)).foregroundColor(Theme.text)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .entrance(i + 3, offset: 10)
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .padding(32)
                .frame(width: 560)
                .background(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).fill(Theme.panel))
                .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
                .glowBorder(Theme.accent, strength: 0.7)
                .elevation(.popover)
                .id(page.id)
                .transition(.asymmetric(insertion: .opacity.combined(with: .move(edge: .trailing)).combined(with: .scale(scale: 0.96)),
                                        removal: .opacity.combined(with: .move(edge: .leading)).combined(with: .scale(scale: 0.96))))

                HStack(spacing: 8) {
                    ForEach(Onboarding.pages) { p in
                        Capsule()
                            .fill(p.id == page.id ? Color.white : Color.white.opacity(0.35))
                            .frame(width: p.id == page.id ? 22 : 7, height: 7)
                            .animation(Motion.spring, value: page.id)
                    }
                }
                .accessibilityLabel(L("tour.pageOf", page.id + 1, Onboarding.pages.count))

                HStack(spacing: 12) {
                    Button(L("tour.skip")) { finish() }
                        .buttonStyle(.plain)
                        .foregroundColor(.white.opacity(0.8))
                        .font(Typo.font(.body, weight: .medium))
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
                Image(systemName: "apple.logo").font(Typo.font(.subhead, weight: .semibold))
                Text(L("auth.apple")).font(Typo.font(.body, weight: .semibold))
                Spacer()
            }
            .foregroundColor(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).fill(hovering ? Theme.panel : .black))
            .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(L("auth.apple"))
    }
}

/// Shown on the empty main screen: the path from the first launch to a monitored site — account or local mode,
/// add a project, connect hosting, first check, AI suggestion, preview, monitoring (V11 RC) — plus a pointer to
/// Setup when required tools are missing.
struct FirstStepsCard: View {
    @EnvironmentObject var model: AppModel

    private var steps: [(String, String, String, String)] {
        [
            ("person.crop.circle", L("firstSteps.account"), L("firstSteps.accountHint"), ""),
            ("folder.badge.plus", L("firstSteps.add"), L("firstSteps.addHint"), "⌘O"),
            ("antenna.radiowaves.left.and.right", L("firstSteps.hosting"), L("firstSteps.hostingHint"), ""),
            ("checkmark.seal", L("firstSteps.check"), L("firstSteps.checkHint"), "⌘R"),
            ("sparkles", L("firstSteps.ai"), L("firstSteps.aiHint"), ""),
            ("paperplane", L("firstSteps.deploy"), L("firstSteps.deployHint"), "⌘D"),
            ("waveform.path.ecg", L("firstSteps.monitor"), L("firstSteps.monitorHint"), ""),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L("firstSteps.title"))
                .font(Typo.font(.caption, weight: .semibold))
                .foregroundColor(Theme.tertiary)
                .textCase(.uppercase)
                .kerning(0.6)
            ForEach(steps.indices, id: \.self) { i in
                let s = steps[i]
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        Circle().fill(Theme.elevated)
                        Text("\(i + 1)").font(Typo.font(.caption, weight: .bold)).foregroundColor(Theme.text)
                    }
                    .frame(width: 22, height: 22)
                    Image(systemName: s.0).font(Typo.font(.body, weight: .medium)).foregroundColor(Theme.accent).frame(width: 18)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.1).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                        Text(s.2).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    if !s.3.isEmpty {
                        Text(s.3).font(Typo.font(.caption, weight: .medium, design: .rounded)).foregroundColor(Theme.tertiary)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(RoundedRectangle(cornerRadius: Radius.xs, style: .continuous).fill(Theme.elevated))
                    }
                }
                .entrance(i, offset: 8)
            }
            if let setup = model.setup, !setup.ready {
                Rectangle().fill(Theme.hairline).frame(height: 1)
                HStack(spacing: 10) {
                    Image(systemName: "wrench.and.screwdriver").foregroundColor(Theme.warn)
                    Text(L("firstSteps.setupHint")).font(Typo.font(.body)).foregroundColor(Theme.secondary)
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
