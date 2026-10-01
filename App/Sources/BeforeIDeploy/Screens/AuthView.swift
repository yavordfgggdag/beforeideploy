import SwiftUI

// MARK: - Auth (sign up / log in)

struct AuthView: View {
    @EnvironmentObject var model: AppModel
    @Local private var mode = 0 // 0 login, 1 signup, 2 recover
    @Local private var email = ""
    @Local private var password = ""
    @Local private var name = ""
    @Local private var busy = false
    @Local private var error: String?
    @Local private var info: String?

    var body: some View {
        HStack(spacing: 0) {
            BrandPanel()
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 18) {
                Spacer()
                VStack(alignment: .leading, spacing: 6) {
                    Text(mode == 1 ? L("auth.createAccount") : mode == 2 ? L("auth.newPassword") : L("auth.welcomeBack"))
                        .font(Typo.font(.display, weight: .bold)).foregroundColor(Theme.text)
                    Text(mode == 1 ? L("auth.signupSubtitle")
                         : mode == 2 ? L("auth.recoverSubtitle")
                         : L("auth.loginSubtitle"))
                        .font(Typo.font(.subhead)).foregroundColor(Theme.secondary)
                }

                if mode != 2 {
                    SegmentedControl(options: [(L("auth.signIn"), 0), (L("auth.signUp"), 1)], selection: $mode)
                }

                VStack(spacing: 10) {
                    if mode == 1 {
                        AuthField(icon: "person", placeholder: L("auth.name"), text: $name)
                    }
                    AuthField(icon: "envelope", placeholder: L("auth.email"), text: $email)
                    if mode != 2 {
                        AuthField(icon: "lock", placeholder: mode == 1 ? L("auth.passwordMin") : L("auth.password"), text: $password, secure: true)
                    }
                }

                if let error {
                    Label(error, systemImage: "exclamationmark.circle.fill")
                        .font(Typo.font(.body)).foregroundColor(Theme.blocked)
                        .fixedSize(horizontal: false, vertical: true)
                    if model.lastAuthCode == "email_not_confirmed" {
                        HStack(spacing: 10) {
                            Button { resend() } label: { Label(L("auth.resend"), systemImage: "envelope.arrow.triangle.branch") }
                                .bidButton(.secondary, compact: true)
                                .disabled(busy || email.isEmpty)
                            Text(L("auth.resendHint")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                if let info {
                    Label(info, systemImage: "checkmark.circle.fill")
                        .font(Typo.font(.body)).foregroundColor(Theme.ready)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button(action: submit) {
                    HStack {
                        Spacer()
                        if busy { Spinner(size: 13, color: .white) }
                        Text(mode == 1 ? L("auth.createAccount") : mode == 2 ? L("auth.sendLink") : L("auth.signIn"))
                        Spacer()
                    }
                }
                .bidButton(.primary)
                .keyboardShortcut(.defaultAction)
                .disabled(busy || email.isEmpty || (mode != 2 && password.isEmpty))

                if mode != 2 && !providers.isEmpty {
                    HStack(spacing: 10) {
                        Rectangle().fill(Theme.hairline).frame(height: 1)
                        Text(L("auth.or")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                        Rectangle().fill(Theme.hairline).frame(height: 1)
                    }
                    if providers.contains("github") {
                        Button { model.oauth("github") } label: {
                            HStack {
                                Spacer()
                                Image(systemName: "chevron.left.forwardslash.chevron.right")
                                Text(L("auth.github"))
                                Spacer()
                            }
                        }
                        .bidButton(.secondary)
                    }
                    if providers.contains("apple") {
                        AppleSignInButton { model.oauth("apple") }
                    }
                }

                HStack {
                    if mode == 0 {
                        Button(L("auth.forgot")) { withAnimation { mode = 2; error = nil; info = nil } }
                            .buttonStyle(.plain).foregroundColor(Theme.accent).font(Typo.font(.body))
                    } else if mode == 2 {
                        Button(L("auth.backToLogin")) { withAnimation { mode = 0; error = nil; info = nil } }
                            .buttonStyle(.plain).foregroundColor(Theme.accent).font(Typo.font(.body))
                    }
                    Spacer()
                    Button(L("auth.continueOffline")) { model.continueOffline() }
                        .buttonStyle(.plain).foregroundColor(Theme.tertiary).font(Typo.font(.callout))
                }
                CloudCheckLine()
                Spacer()
                Text(L("auth.privacyNote"))
                    .font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
                LegalLinks()
            }
            .padding(48)
            .frame(width: 460)
            .frame(maxHeight: .infinity)
            .background(Theme.bg)
        }
        .onChange(of: mode) { _ in error = nil; info = nil }
    }

    /// Sign-in buttons the cloud project has enabled (engine reads Supabase's public auth settings).
    var providers: [String] {
        (model.account?.oauthProviders ?? ["github"]).filter { $0 == "github" || $0 == "apple" }
    }

    func resend() {
        busy = true
        Task {
            let r = await model.resendConfirmation(email: email.trimmingCharacters(in: .whitespaces))
            if r == nil { info = L("auth.resent"); error = nil } else { error = r }
            busy = false
        }
    }

    func submit() {
        busy = true
        error = nil
        info = nil
        Task {
            let e = email.trimmingCharacters(in: .whitespaces)
            var result: String?
            switch mode {
            case 1:
                result = await model.signup(email: e, password: password, name: name)
                if result == "CONFIRM" {
                    info = L("auth.confirmEmail")
                    mode = 0
                    result = nil
                }
            case 2:
                result = await model.recover(email: e)
                if result == nil { info = L("auth.checkInbox") }
            default:
                result = await model.login(email: e, password: password)
            }
            error = result
            busy = false
        }
    }
}

struct AuthField: View {
    let icon: String
    let placeholder: String
    @Binding var text: String
    var secure = false

    var body: some View {
        HStack(spacing: Space.s) {
            Image(systemName: icon).foregroundColor(Theme.secondary).frame(width: 18).accessibilityHidden(true)
            BIDField(placeholder: placeholder, text: $text, kind: secure ? .secure : .text)
        }
    }
}

struct BrandPanel: View {
    var features: [(String, String, String)] {
        [
            ("checkmark.seal.fill", L("welcome.feature.check"), L("welcome.feature.checkDetail")),
            ("globe", L("welcome.feature.hosting"), L("welcome.feature.hostingDetail")),
            ("network", L("welcome.feature.domains"), L("welcome.feature.domainsDetail")),
            ("sparkles", L("welcome.feature.ai"), L("welcome.feature.aiDetail")),
            ("creditcard.fill", L("welcome.feature.costs"), L("welcome.feature.costsDetail")),
        ]
    }

    var body: some View {
        ZStack {
            WelcomeSky()
            VStack(alignment: .leading, spacing: 28) {
                HStack(spacing: 12) {
                    AppGlyph(size: 50, style: .onBrand)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Before I Deploy").font(Typo.font(.title, weight: .bold)).foregroundColor(.white)
                        Text(L("welcome.tagline")).font(Typo.font(.body)).foregroundColor(.white.opacity(0.75))
                    }
                }
                Text(L("welcome.headline"))
                    .font(Typo.font(.display, weight: .heavy))
                    .foregroundColor(.white)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(features.indices, id: \.self) { i in
                        let f = features[i]
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: f.0).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(.white)
                                .frame(width: 32, height: 32)
                                .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Color.white.opacity(0.15)))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.1).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(.white)
                                Text(f.2).font(Typo.font(.body)).foregroundColor(.white.opacity(0.75))
                            }
                        }
                    }
                }
            }
            .padding(56)
            .frame(maxWidth: 560, alignment: .leading)
        }
        .clipped()
    }
}
