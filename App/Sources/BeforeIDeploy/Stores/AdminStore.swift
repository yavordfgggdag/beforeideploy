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

    func setAIDisabled(_ user: AdminUser, _ disabled: Bool) async {
        do {
            let r = try await engine.call(["admin", "disable_ai", "--user", user.userId, "--disabled", disabled ? "true" : "false"], as: AdminUserResult.self)
            replace(r.user)
        } catch { feedback?.show(error) }
    }
}
