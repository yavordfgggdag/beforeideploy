import AppKit
import SwiftUI

/// Supabase account session, offline mode and cloud configuration.
@MainActor
final class AccountStore: ObservableObject {
    @Published var account: AccountState?
    @Published var accountChecked = false
    @Published var aiKeys: [AIKeyStatus] = []
    /// Engine code of the last failed sign-in / sign-up (`email_not_confirmed` unlocks "send it again").
    @Published var lastAuthCode: String?
    /// Last `bid cloud doctor` answer, shown on the sign-in screen on request.
    @Published var cloudDoctor: CloudDoctorResult?
    @Published var cloudChecking = false
    /// @Published, not @AppStorage: @AppStorage inside an ObservableObject does not refresh views (audit A4).
    @Published var offlineMode = UserDefaults.standard.bool(forKey: "offlineMode") {
        didSet { UserDefaults.standard.set(offlineMode, forKey: "offlineMode") }
    }
    /// When this app last opened a sign-in page: a callback without one is not ours (audit A2).
    private var oauthStartedAt: Date?

    let engine: EngineClient
    weak var feedback: Feedback?
    /// Called after a successful login, before the background sync (the facade starts the app here).
    var onLogin: (@MainActor () async -> Void)?

    init(engine: EngineClient) {
        self.engine = engine
    }

    var mustAuthenticate: Bool {
        guard accountChecked, let a = account else { return false }
        if a.loggedIn { return false }
        return !offlineMode
    }

    func loadAccount() async {
        account = try? await engine.call(["account", "status"], as: AccountState.self)
        accountChecked = true
    }

    /// Returns an error message, or nil on success.
    func signup(email: String, password: String, name: String) async -> String? {
        do {
            let r = try await engine.call(["account", "signup", "--email", email, "--name", name], as: AccountState.self,
                                          env: ["BID_PASSWORD": password])
            lastAuthCode = nil
            if r.confirmEmail == true { return "CONFIRM" }
            account = r
            await afterLogin()
            return nil
        } catch {
            lastAuthCode = (error as? EngineError)?.code
            return error.localizedDescription
        }
    }

    func login(email: String, password: String) async -> String? {
        do {
            account = try await engine.call(["account", "login", "--email", email], as: AccountState.self,
                                            env: ["BID_PASSWORD": password])
            lastAuthCode = nil
            await afterLogin()
            return nil
        } catch {
            lastAuthCode = (error as? EngineError)?.code
            return error.localizedDescription
        }
    }

    /// Sends the sign-up confirmation e-mail again. Returns an error message, or nil on success.
    func resendConfirmation(email: String) async -> String? {
        do {
            _ = try await engine.call(["account", "resend", "--email", email], as: [String: JSONValue].self)
            return nil
        } catch { return error.localizedDescription }
    }

    /// Asks the engine what the cloud project can do (schema, functions, sign-up, e-mail confirmation).
    func checkCloud() async {
        cloudChecking = true
        defer { cloudChecking = false }
        do { cloudDoctor = try await engine.call(["cloud", "doctor"], as: CloudDoctorResult.self) } catch { feedback?.show(error) }
    }

    /// The bundled supabase/schema.sql (engine `cloud schema`), nil when the engine has none.
    func cloudSchema() async -> String? {
        (try? await engine.call(["cloud", "schema"], as: CloudSchema.self))?.sql
    }

    func recover(email: String) async -> String? {
        do {
            _ = try await engine.call(["account", "recover", "--email", email], as: [String: Bool].self)
            return nil
        } catch { return error.localizedDescription }
    }

    func oauth(_ provider: String) {
        Task {
            do {
                let r = try await engine.call(["account", "oauth", "--provider", provider], as: OAuthStart.self)
                oauthStartedAt = Date()
                if let u = URL(string: r.url) { NSWorkspace.shared.open(u) }
            } catch { feedback?.show(error) }
        }
    }

    func completeOAuth(_ url: URL) async {
        // Login CSRF: a web page could open beforeideploy://auth-callback with its own tokens and sync this
        // Mac's projects into a stranger's account. Only a sign-in started here in the last 10 minutes counts.
        guard let started = oauthStartedAt, Date().timeIntervalSince(started) < 600 else {
            AppLog.ui.notice("ignored an auth callback without a sign-in in progress")
            return
        }
        oauthStartedAt = nil
        let fragment = url.fragment ?? URLComponents(url: url, resolvingAgainstBaseURL: false)?.query ?? ""
        var params: [String: String] = [:]
        for pair in fragment.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 { params[kv[0]] = kv[1].removingPercentEncoding ?? kv[1] }
        }
        guard let access = params["access_token"] else {
            feedback?.flash(params["error_description"]?.replacingOccurrences(of: "+", with: " ") ?? L("auth.denied"), error: true)
            return
        }
        do {
            account = try await engine.call(["account", "session"], as: AccountState.self,
                                            env: ["BID_ACCESS": access, "BID_REFRESH": params["refresh_token"] ?? ""])
            NSApp.activate(ignoringOtherApps: true)
            await afterLogin()
        } catch { feedback?.show(error) }
    }

    private func afterLogin() async {
        offlineMode = false
        if account?.schemaMissing == true {
            feedback?.flash(L("auth.schemaMissing"), error: true)
        } else {
            feedback?.flash(L("auth.hello", account?.name ?? account?.email ?? ""), error: false)
        }
        await onLogin?()
        Task { _ = try? await engine.run(["account", "sync"]) }
    }

    func logout() {
        Task {
            _ = try? await engine.run(["account", "logout"])
            offlineMode = false
            await loadAccount()
        }
    }

    func syncNow() {
        Task {
            let o = try? await engine.run(["account", "sync"])
            if o?.ok == true {
                feedback?.flash(L("account.synced"), error: false)
            } else {
                feedback?.flash(o?.errorMessage ?? L("account.syncFailed"), error: true)
            }
        }
    }

    /// Saves the app language to profiles.locale (quietly — nothing to show when offline or logged out).
    func saveLocale(_ code: String) {
        guard account?.loggedIn == true else { return }
        Task { _ = try? await engine.run(["account", "locale", "--set", code]) }
    }

    // MARK: - Own AI keys (vip/admin)

    func loadAIKeys() async {
        aiKeys = (try? await engine.call(["account", "keys", "status"], as: [AIKeyStatus].self)) ?? []
    }

    /// Verifies and stores the key (engine → Keychain). The key travels through the environment, never argv.
    func setAIKey(provider: String, key: String) async -> Bool {
        do {
            let outcome = try await engine.run(["account", "keys", "set", "--provider", provider], env: ["BID_AI_KEY": key])
            guard outcome.ok else {
                feedback?.flash(outcome.errorMessage ?? L("aikeys.rejected"), error: true)
                return false
            }
            feedback?.flash(L("aikeys.saved"), error: false)
            await loadAIKeys()
            await loadAccount()
            return true
        } catch {
            feedback?.show(error)
            return false
        }
    }

    func deleteAIKey(provider: String) async {
        _ = try? await engine.run(["account", "keys", "delete", "--provider", provider])
        await loadAIKeys()
        await loadAccount()
    }

    func configureCloud(url: String, key: String) async -> String? {
        do {
            _ = try await engine.call(["cloud", "config", "--url", url, "--anon-key", key], as: [String: Bool].self)
            await loadAccount()
            return nil
        } catch { return error.localizedDescription }
    }
}
