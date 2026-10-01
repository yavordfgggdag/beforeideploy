import SwiftUI

/// First screen of a fresh install (V10 WP1): pick the app language. The texts follow the highlighted
/// language, so the choice is readable before it is confirmed.
struct WelcomeLanguageView: View {
    @EnvironmentObject var model: AppModel
    @Local private var selected = Localization.suggested

    private func text(_ key: String) -> String { Localization.string(key, in: selected) }

    var body: some View {
        ZStack {
            WelcomeSky()

            VStack(spacing: 24) {
                HStack(spacing: 12) {
                    AppGlyph(size: 50, style: .onBrand)

                    Text("Before I Deploy").font(Typo.font(.title, weight: .bold)).foregroundColor(.white)
                }


                VStack(spacing: 6) {
                    Text(text("language.title")).font(Typo.font(.display, weight: .heavy)).foregroundColor(.white)
                    Text(text("language.subtitle")).font(Typo.font(.body)).foregroundColor(.white.opacity(0.8))
                        .multilineTextAlignment(.center)
                }


                let codes = Localization.available
                let grid = LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 10)], spacing: 10) {
                    ForEach(codes, id: \.self) { code in
                        LanguageTile(code: code, selected: code == selected) { selected = code }
                    }
                }
                .padding(16)
                Group {
                    // a handful of languages fit as they are; a long list scrolls
                    if codes.count > 9 {
                        ScrollView { grid }.frame(maxHeight: 300)
                    } else {
                        grid
                    }
                }
                .background(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).fill(Theme.panel))
                .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(Theme.edgeHighlight, lineWidth: 1))
                .frame(width: codes.count > 2 ? 580 : 390)
                .glowBorder(Theme.accent, strength: 0.7)


                Button(text("language.continue")) { model.setLanguage(selected) }
                    .bidButton(.primary)
                    .keyboardShortcut(.defaultAction)

            }
            .padding(40)
        }
        .clipped()
    }
}

struct LanguageTile: View {
    let code: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(selected ? Theme.accent : Theme.tertiary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(Localization.nativeName(code)).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(Theme.text)
                    Text(code).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary)
                }
                Spacer(minLength: 0)
                if !Localization.isReviewed(code) { BetaBadge() }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous)
                .fill(selected ? Theme.accentSoft : Theme.elevated))
            .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous)
                .stroke(selected ? Theme.accent : Color.clear, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .lift(radius: Theme.smallRadius, amount: 1.03)
        .animation(Motion.spring, value: selected)
    }
}

/// Settings row: switches the app and engine language right away.
struct LanguageRow: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(L("settings.language")).font(Typo.font(.body, weight: .medium)).foregroundColor(Theme.text)
                Text(L("settings.languageHint")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
            }
            Spacer()
            Picker("", selection: Binding(get: { Localization.current }, set: { model.setLanguage($0) })) {
                ForEach(Localization.available, id: \.self) { code in
                    Text(Localization.isReviewed(code) ? Localization.nativeName(code) : L("language.betaName", Localization.nativeName(code))).tag(code)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .frame(width: 180)
        }
    }
}

/// "Beta" chip for languages whose texts were machine translated and not reviewed yet.
struct BetaBadge: View {
    var body: some View { Badge(text: L("language.beta"), tone: .warning, size: .sm).help(L("language.betaHelp")) }
}
