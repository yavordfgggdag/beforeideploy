import SwiftUI

/// Admin panel state (V10 WP2). Every action goes through `bid admin <action>`, which the `admin`
/// Edge Function verifies against profiles.role = 'admin' and logs in admin_audit.
@MainActor
final class AdminStore: ObservableObject {
    @Published var users: [AdminUser] = []
    @Published var audit: [AdminAuditEntry] = []
    @Published var loading = false
    @Published var query = ""
    @Published var selectedId: String?
    @Published var usage: [AdminUsage] = []
    /// Global settings as pretty-printed JSON per key (the cloud `settings` table).
    @Published var settings: [String: String] = [:]

    /// Keys the panel offers even before they exist in the table.
    static let knownSettings = ["billing.catalog", "plans", "ai.models", "ai.creditEur", "ai.usdToEur", "ai.sessionHours", "ai.sessionCapPercent",
                                "ai.rate", "ai.promptMaxChars", "ai.prices", "release.url", "help.url",
                                "legal.privacy", "legal.terms", "legal.refund", "support.email"]

    let engine: EngineClient
    weak var feedback: Feedback?

    init(engine: EngineClient) {
        self.engine = engine
    }

    var selected: AdminUser? { users.first { $0.userId == selectedId } }

    func load() async {
        loading = true
        defer { loading = false }
        var args = ["admin", "list_users"]
        if !query.trimmingCharacters(in: .whitespaces).isEmpty { args += ["--query", query] }
        do {
            users = try await engine.call(args, as: AdminUsersResult.self).users
            if selectedId == nil { selectedId = users.first?.userId }
        } catch {
            feedback?.show(error)
        }
    }

    func loadAudit() async {
        audit = (try? await engine.call(["admin", "audit_log", "--limit", "100"], as: AdminAuditResult.self))?.entries ?? []
    }

    private func replace(_ user: AdminUser) {
        if let i = users.firstIndex(where: { $0.userId == user.userId }) { users[i] = user } else { users.append(user) }
    }

    func setRole(_ user: AdminUser, _ role: String) async {
        do {
            let r = try await engine.call(["admin", "set_role", "--user", user.userId, "--role", role], as: AdminUserResult.self)
            replace(r.user)
            feedback?.flash(L("admin.roleSet", user.email, role), error: false)
        } catch { feedback?.show(error) }
    }

    func setPlan(_ user: AdminUser, _ plan: String) async {
        do {
            let r = try await engine.call(["admin", "set_plan_manual", "--user", user.userId, "--plan", plan], as: AdminUserResult.self)
            replace(r.user)
            feedback?.flash(L("admin.planSet", user.email, plan), error: false)
        } catch { feedback?.show(error) }
    }

    func grant(_ user: AdminUser, delta: Int, reason: String) async {
        guard delta != 0 else { return }
        do {
            let r = try await engine.call(["admin", "grant_credits", "--user", user.userId, "--delta", String(delta), "--reason", reason.isEmpty ? "admin" : reason], as: AdminGrantResult.self)
            var u = user
            u.balance = r.balance
            replace(u)
            feedback?.flash(L("admin.granted", Fmt.tokens(delta), user.email), error: false)
        } catch { feedback?.show(error) }
    }

    func loadUsage(_ user: AdminUser) async {
        usage = (try? await engine.call(["admin", "get_usage", "--user", user.userId, "--limit", "50"], as: AdminUsageResult.self))?.usage ?? []
    }

    func invite(email: String, role: String) async -> Bool {
        do {
            let r = try await engine.call(["admin", "invite", "--email", email, "--role", role, "--locale", Localization.current], as: AdminUserResult.self)
            replace(r.user)
            selectedId = r.user.userId
            feedback?.flash(L("admin.invited", email), error: false)
            await loadAudit()
            return true
        } catch {
            feedback?.show(error)
            return false
        }
    }

    func loadSettings() async {
        guard let outcome = try? await engine.run(["admin", "get_settings"]), outcome.ok,
              let d = outcome.resultData,
              let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let data = obj["data"] as? [String: Any],
              let values = data["settings"] as? [String: Any] else { return }
        var out: [String: String] = [:]
        for (k, v) in values { out[k] = Self.pretty(v) }
        settings = out
    }

    /// Validates the JSON and saves one key; returns an error text for the editor, nil on success.
    func saveSetting(key: String, json: String) async -> String? {
        guard let value = try? JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed]) else {
            return L("admin.settingsInvalid")
        }
        guard let payload = try? JSONSerialization.data(withJSONObject: ["settings": [key: value]]),
              let text = String(data: payload, encoding: .utf8) else { return L("admin.settingsInvalid") }
        do {
            _ = try await engine.call(["admin", "set_settings", "--json", text], as: [String: Int].self)
            settings[key] = Self.pretty(value)
            feedback?.flash(L("admin.settingsSaved", key), error: false)
            await loadAudit()
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    static func pretty(_ value: Any) -> String {
        if JSONSerialization.isValidJSONObject(value),
           let d = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]),
           let s = String(data: d, encoding: .utf8) { return s }
        if let d = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .withoutEscapingSlashes]),
           let s = String(data: d, encoding: .utf8) { return s }
        return "\(value)"
    }

    func setAIDisabled(_ user: AdminUser, _ disabled: Bool) async {
        do {
            let r = try await engine.call(["admin", "disable_ai", "--user", user.userId, "--disabled", disabled ? "true" : "false"], as: AdminUserResult.self)
            replace(r.user)
        } catch { feedback?.show(error) }
    }
}
