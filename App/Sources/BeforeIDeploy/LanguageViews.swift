import SwiftUI

/// First screen of a fresh install (V10 WP1): pick the app language. The texts follow the highlighted
/// language, so the choice is readable before it is confirmed.
struct WelcomeLanguageView: View {
    @EnvironmentObject var model: AppModel
    @Local private var selected = Localization.suggested

    private func text(_ key: String) -> String { Localization.string(key, in: selected) }

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x0B3D91), Color(hex: 0x0A6EF0), Color(hex: 0x3B9CFF)],
                           startPoint: .bottomLeading, endPoint: .topTrailing)
            Circle().fill(Color.white.opacity(0.08)).frame(width: 620).offset(x: 360, y: -300).blur(radius: 2)
            Circle().fill(Color.white.opacity(0.06)).frame(width: 420).offset(x: -380, y: 320)

            VStack(spacing: 24) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.18))
                        Image(systemName: "paperplane.fill").font(.system(size: 22, weight: .bold)).foregroundColor(.white).rotationEffect(.degrees(-8))
                    }
                    .frame(width: 50, height: 50)
                    Text("Before I Deploy").font(.system(size: 24, weight: .bold)).foregroundColor(.white)
                }

                VStack(spacing: 6) {
                    Text(text("language.title")).font(.system(size: 26, weight: .heavy)).foregroundColor(.white)
                    Text(text("language.subtitle")).font(.system(size: 13)).foregroundColor(.white.opacity(0.8))
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
                    Text(Localization.nativeName(code)).font(.system(size: 13.5, weight: .semibold)).foregroundColor(Theme.text)
                    Text(code).font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.tertiary)
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
    }
}

/// Settings row: switches the app and engine language right away.
struct LanguageRow: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(L("settings.language")).font(.system(size: 13, weight: .medium)).foregroundColor(Theme.text)
                Text(L("settings.languageHint")).font(.system(size: 11.5)).foregroundColor(Theme.tertiary)
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
    var body: some View {
        Text(L("language.beta"))
            .font(.system(size: 9.5, weight: .heavy))
            .tracking(0.6)
            .foregroundColor(Theme.warn)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(Theme.warn.opacity(0.14)))
            .help(L("language.betaHelp"))
    }
}
