import SwiftUI

/// Admin panel (V10 WP2) — visible only when `features.admin.panel` is true.
struct AdminView: View {
    @EnvironmentObject var model: AppModel

    private var store: AdminStore { model.adminStore }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            PageHeader(title: L("admin.title"), subtitle: L("admin.subtitle"), icon: "person.2.badge.gearshape.fill") {
                HStack(spacing: 8) {
                    if store.loading { Spinner(size: 14) }
                    Button { Task { await store.load(); await store.loadAudit() } } label: { Label(L("common.refresh"), systemImage: "arrow.clockwise") }
                        .bidButton(.secondary, compact: true)
                }
            }

            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        BIDTextField(placeholder: L("admin.search"), text: Binding(get: { store.query }, set: { store.query = $0 }))
                            .onSubmit { Task { await store.load() } }
                        Button(L("admin.find")) { Task { await store.load() } }.bidButton(.secondary, compact: true)
                    }
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(store.users) { u in
                                AdminUserRow(user: u, selected: u.userId == store.selectedId) { store.selectedId = u.userId }
                                Rectangle().fill(Theme.hairline).frame(height: 1)
                            }
                            if store.users.isEmpty && !store.loading {
                                Text(L("admin.noUsers")).font(.system(size: 12.5)).foregroundColor(Theme.tertiary).padding(20)
                            }
                        }
                    }
                }
                .frame(minWidth: 320, maxWidth: 420)
                .card(padding: 14)

                if let u = store.selected {
                    AdminUserDetail(user: u)
                        .frame(maxWidth: .infinity)
                        .id(u.userId)
                } else {
                    Text(L("admin.pickUser")).foregroundColor(Theme.tertiary).frame(maxWidth: .infinity, minHeight: 200).card()
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: L("admin.audit"), icon: "list.bullet.rectangle").padding(.bottom, 4)
                if store.audit.isEmpty {
                    Text(L("admin.auditEmpty")).font(.system(size: 12)).foregroundColor(Theme.tertiary)
                } else {
                    ForEach(store.audit.prefix(30)) { e in
                        HStack(spacing: 10) {
                            Text(Fmt.time(e.createdAt)).font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.tertiary).frame(width: 90, alignment: .leading)
                            Text(e.action).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                            Text(store.users.first { $0.userId == e.target }?.email ?? e.target ?? "").font(.system(size: 12)).foregroundColor(Theme.secondary).lineLimit(1)
                            Spacer()
                        }
                        .padding(.vertical, 3)
                    }
                }
            }
            .card()
        }
        .padding(.horizontal, 32)
        .padding(.top, 40)
        .padding(.bottom, 32)
        .frame(maxWidth: 1100)
        .frame(maxWidth: .infinity)
        .task { await store.load(); await store.loadAudit() }
    }
}

struct AdminUserRow: View {
    let user: AdminUser
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(user.role == "admin" ? Theme.accentGradient : LinearGradient(colors: [Theme.elevated, Theme.elevated], startPoint: .top, endPoint: .bottom))
                    Text(String((user.displayName ?? user.email).prefix(1)).uppercased()).font(.system(size: 11, weight: .bold)).foregroundColor(.white)
                }
                .frame(width: 24, height: 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(user.email).font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.text).lineLimit(1)
                    Text("\(user.role) · \(user.plan) · \(Fmt.tokens(user.balance ?? 0))").font(.system(size: 10.5)).foregroundColor(Theme.tertiary)
                }
                Spacer()
                if user.aiDisabled == true { Image(systemName: "sparkles.slash").font(.system(size: 11)).foregroundColor(Theme.warn) }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(selected ? Theme.accentSoft : Color.clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct AdminUserDetail: View {
    @EnvironmentObject var model: AppModel
    let user: AdminUser
    @Local private var grantAmount = "250000"
    @Local private var grantReason = ""
    @Local private var busy = false

    private var store: AdminStore { model.adminStore }
    private let roles = ["normal", "vip", "admin"]
    private let plans = ["free", "flash", "high", "knight"]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(user.displayName ?? user.email).font(.system(size: 17, weight: .bold)).foregroundColor(Theme.text)
                Text(user.email).font(.system(size: 12)).foregroundColor(Theme.secondary)
            }
            HStack(spacing: 10) {
                KPITile(value: Fmt.tokens(user.balance ?? 0), label: L("admin.creditsBalance"), icon: "bolt.fill", tint: Theme.accent)
                KPITile(value: user.locale ?? "—", label: L("admin.locale"), icon: "globe")
                KPITile(value: user.lastAiAt.map { Fmt.relative($0) } ?? "—", label: L("admin.lastAi"), icon: "sparkles")
            }

            SectionLabel(text: L("admin.roleAndPlan"))
            HStack(spacing: 14) {
                Picker(L("admin.role"), selection: Binding(get: { user.role }, set: { r in Task { await store.setRole(user, r) } })) {
                    ForEach(roles, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.menu).frame(width: 190)
                .disabled(user.userId == model.account?.id)
                Picker(L("admin.plan"), selection: Binding(get: { user.plan }, set: { p in Task { await store.setPlan(user, p) } })) {
                    ForEach(plans, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.menu).frame(width: 190)
                Spacer()
            }
            Toggle(L("admin.aiDisabled"), isOn: Binding(get: { user.aiDisabled == true }, set: { v in Task { await store.setAIDisabled(user, v) } }))
                .toggleStyle(.switch).tint(Theme.warn)

            SectionLabel(text: L("admin.credits"))
            HStack(spacing: 8) {
                BIDTextField(placeholder: L("admin.tokens"), text: $grantAmount, mono: true).frame(width: 140)
                BIDTextField(placeholder: L("admin.reason"), text: $grantReason)
                Button(L("admin.grant")) {
                    guard let n = Int(grantAmount.replacingOccurrences(of: " ", with: "")) else { return }
                    busy = true
                    Task { await store.grant(user, delta: n, reason: grantReason); busy = false }
                }
                .bidButton(.primary, compact: true).disabled(busy || Int(grantAmount.replacingOccurrences(of: " ", with: "")) == nil)
            }
            Text(L("admin.grantHint")).font(.system(size: 11)).foregroundColor(Theme.tertiary)
        }
        .card(padding: 20)
    }
}

// MARK: - VIP / admin: own AI keys (shown on the Setup screen)

struct AIKeysCard: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: L("aikeys.group"), icon: "key.fill").padding(.bottom, 6)
            Text(L("aikeys.intro")).font(.system(size: 12)).foregroundColor(Theme.secondary).padding(.bottom, 6)
            ForEach(model.aiKeys) { k in
                AIKeyRow(status: k)
                if k.id != model.aiKeys.last?.id { Rectangle().fill(Theme.hairline).frame(height: 1) }
            }
        }
        .card()
        .task { await model.loadAIKeys() }
    }
}

struct AIKeyRow: View {
    @EnvironmentObject var model: AppModel
    let status: AIKeyStatus
    @Local private var key = ""
    @Local private var busy = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: status.connected ? "checkmark.circle.fill" : "circle.dashed")
                .font(.system(size: 15)).foregroundColor(status.connected ? Theme.ready : Theme.tertiary).frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(status.name).font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.text)
                Text(status.connected ? L("aikeys.connectedHint", status.hint ?? "") : L("aikeys.notConnected"))
                    .font(.system(size: 11.5)).foregroundColor(Theme.tertiary)
            }
            Spacer()
            if status.connected {
                Button(L("aikeys.remove")) { Task { await model.deleteAIKey(provider: status.provider) } }.bidButton(.ghost, compact: true)
            } else {
                SecureField(L("aikeys.placeholder"), text: $key)
                    .textFieldStyle(.plain).font(.system(size: 12, design: .monospaced)).foregroundColor(Theme.text)
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).fill(Theme.bg))
                    .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
                    .frame(width: 260)
                if let c = status.console { Button(L("aikeys.getKey")) { model.open(c) }.bidButton(.ghost, compact: true) }
                Button(busy ? L("aikeys.checking") : L("common.connect")) {
                    busy = true
                    Task {
                        if await model.setAIKey(provider: status.provider, key: key) { key = "" }
                        busy = false
                    }
                }
                .bidButton(.primary, compact: true).disabled(busy || key.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(.vertical, 8)
    }
}
