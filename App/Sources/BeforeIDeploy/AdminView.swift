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

            AdaptiveColumns(spacing: 16) {
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
                                Text(L("admin.noUsers")).font(Typo.font(.body)).foregroundColor(Theme.tertiary).padding(20)
                            }
                        }
                    }.frame(height: 420)
                }
                .frame(maxWidth: .infinity)
                .card(padding: 14)

                if let u = store.selected {
                    AdminUserDetail(user: u)
                        .frame(maxWidth: .infinity)
                        .id(u.userId)
                } else {
                    Text(L("admin.pickUser")).foregroundColor(Theme.tertiary).frame(maxWidth: .infinity, minHeight: 200).card()
                }
            }

            AdminDiagnosticsCard()

            AdaptiveColumns(spacing: 16) {
                AdminInviteCard()
                    .frame(maxWidth: 420)
                AdminSettingsCard()
                    .frame(maxWidth: .infinity)
            }

            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: L("admin.audit"), icon: "list.bullet.rectangle").padding(.bottom, 4)
                if store.audit.isEmpty {
                    Text(L("admin.auditEmpty")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                } else {
                    ForEach(store.audit.prefix(30)) { e in
                        HStack(spacing: 10) {
                            Text(Fmt.time(e.createdAt)).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary).frame(width: 90, alignment: .leading)
                            Text(K.auditAction(e.action)).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                            Text(store.users.first { $0.userId == e.target }?.email ?? e.target ?? "").font(Typo.font(.callout)).foregroundColor(Theme.secondary).lineLimit(1)
                            Spacer()
                        }
                        .padding(.vertical, 3)
                    }
                }
            }
            .card()
        }
        .padding(.horizontal, Space.page)
        .padding(.top, Space.top)
        .padding(.bottom, Space.page)
        .frame(maxWidth: 1120)
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
                    Text(String((user.displayName ?? user.email).prefix(1)).uppercased()).font(Typo.font(.caption, weight: .bold)).foregroundColor(.white)
                }
                .frame(width: 24, height: 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(user.email).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text).lineLimit(1)
                    Text("\(K.role(user.role)) · \(K.plan(user.plan)) · \(Fmt.tokens(user.balance ?? 0))").font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                }
                Spacer()
                if user.aiDisabled == true { Image(systemName: "sparkles.slash").font(Typo.font(.caption)).foregroundColor(Theme.warn) }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(selected ? Theme.accentSoft : Color.clear))
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
                Text(user.displayName ?? user.email).font(Typo.font(.headline, weight: .bold)).foregroundColor(Theme.text)
                Text(user.email).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            }
            HStack(spacing: 10) {
                KPITile(value: Fmt.tokens(user.balance ?? 0), label: L("admin.creditsBalance"), icon: "bolt.fill", tint: Theme.accent, compact: true)
                KPITile(value: user.locale ?? "—", label: L("admin.locale"), icon: "globe", compact: true)
                KPITile(value: user.lastAiAt.map { Fmt.relative($0) } ?? "—", label: L("admin.lastAi"), icon: "sparkles", compact: true)
            }

            SectionLabel(text: L("admin.roleAndPlan"))
            HStack(spacing: 14) {
                Picker(L("admin.role"), selection: Binding(get: { user.role }, set: { r in Task { await store.setRole(user, r) } })) {
                    ForEach(roles, id: \.self) { Text(K.role($0)).tag($0) }
                }
                .pickerStyle(.menu).frame(width: 190)
                .disabled(user.userId == model.account?.id)
                Picker(L("admin.plan"), selection: Binding(get: { user.plan }, set: { p in Task { await store.setPlan(user, p) } })) {
                    ForEach(plans, id: \.self) { Text(K.plan($0)).tag($0) }
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
            Text(L("admin.grantHint")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)

            if let state = store.creditState {
                InfoRow(label: L("usage.available"), value: L("usage.creditsCount", Fmt.tokens(state.usage.remaining.available)))
                Text(state.drift.isEmpty ? L("admin.creditsMatch") : L("admin.creditsDrift", state.drift.count)).font(Typo.font(.callout)).foregroundColor(state.drift.isEmpty ? Theme.ready : Theme.warn)
                ForEach(state.usage.sites?.items ?? []) { site in
                    HStack {
                        Text(site.name).font(Typo.font(.body)).lineLimit(2)
                        Spacer()
                        if site.state == "active" {
                            Button(L("usage.pauseSite")) { Task { await store.pauseSite(user, projectKey: site.projectKey, reason: grantReason) } }.bidButton(.secondary, compact: true).disabled(grantReason.trimmingCharacters(in: .whitespaces).count < 3)
                        } else { Text(L("usage.sitePaused")).font(Typo.font(.caption)).foregroundColor(Theme.secondary) }
                    }
                }
                Text(L("admin.pauseReason")).font(Typo.font(.caption)).foregroundColor(Theme.secondary)
            } else if let error = store.creditError {
                Text(error).font(Typo.font(.caption)).foregroundColor(Theme.warn).textSelection(.enabled)
            }

            SectionLabel(text: L("admin.usage"), icon: "sparkles")
            if store.usage.isEmpty {
                Text(L("admin.usageEmpty")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
            } else {
                VStack(spacing: 4) {
                    ForEach(store.usage.prefix(12)) { u in
                        HStack(spacing: 10) {
                            Text(Fmt.relative(u.createdAt)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).frame(width: 110, alignment: .leading)
                            Text(u.step.map(K.step) ?? "—").font(Typo.font(.callout, weight: .medium)).foregroundColor(Theme.text)
                            Text(u.model ?? "").font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary)
                            if let st = u.status, st != "ok" { Chip(text: st, tint: Theme.warn) }
                            Spacer()
                            Text(L("ai.tokensCount", Fmt.tokens(u.chargedTokens ?? 0)))
                                .font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.secondary).monospacedDigit()
                        }
                    }
                }
            }
        }
        .card(padding: 20)
        .task(id: user.userId) { await store.loadUsage(user) }
    }
}

/// Invite a friend or client by email with a role (VIP by default) — Supabase sends the invitation.
struct AdminInviteCard: View {
    @EnvironmentObject var model: AppModel
    @Local private var email = ""
    @Local private var role = "vip"
    @Local private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: L("admin.invite"), icon: "envelope.badge.fill")
            Text(L("admin.inviteHint")).font(Typo.font(.callout)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
            BIDTextField(placeholder: L("auth.email"), text: $email)
            HStack {
                Picker(L("admin.role"), selection: $role) {
                    ForEach(["vip", "normal", "admin"], id: \.self) { Text(K.role($0)).tag($0) }
                }
                .pickerStyle(.menu).frame(width: 180)
                Spacer()
                Button(busy ? L("admin.inviting") : L("admin.sendInvite")) {
                    busy = true
                    Task {
                        if await model.adminStore.invite(email: email.trimmingCharacters(in: .whitespaces), role: role) { email = "" }
                        busy = false
                    }
                }
                .bidButton(.primary, compact: true)
                .disabled(busy || !email.contains("@"))
            }
        }
        .card(padding: 18)
    }
}

/// Global settings (prices, catalog, models, limits, release feed, help pages) as JSON per key.
struct AdminSettingsCard: View {
    @EnvironmentObject var model: AppModel
    @Local private var key = "billing.catalog"
    @Local private var text = ""
    @Local private var error: String?
    @Local private var busy = false

    private var store: AdminStore { model.adminStore }
    private var keys: [String] { Array(Set(AdminStore.knownSettings).union(store.settings.keys)).sorted() }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionLabel(text: L("admin.settings"), icon: "slider.horizontal.3")
                Spacer()
                Picker("", selection: $key) {
                    ForEach(keys, id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden().pickerStyle(.menu).frame(width: 200)
            }
            TextEditor(text: $text)
                .font(Typo.font(.callout, design: .monospaced))
                .scrollContentBackground(.hidden)
                .padding(8)
                .frame(minHeight: 150, maxHeight: 220)
                .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.bg))
                .overlay(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).strokeBorder(error == nil ? Theme.hairline : Theme.blocked.opacity(0.6), lineWidth: 1))
            HStack {
                if let error {
                    Label(error, systemImage: "exclamationmark.circle.fill").font(Typo.font(.callout)).foregroundColor(Theme.blocked).lineLimit(2)
                } else {
                    Text(L("admin.settingsHint")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                }
                Spacer()
                Button(L("common.save")) {
                    busy = true
                    Task {
                        error = await store.saveSetting(key: key, json: text)
                        busy = false
                    }
                }
                .bidButton(.primary, compact: true)
                .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .card(padding: 18)
        .task { await store.loadSettings(); text = store.settings[key] ?? "" }
        .onChange(of: key) { k in text = store.settings[k] ?? ""; error = nil }
    }
}

// MARK: - VIP / admin: own AI keys (shown on the Setup screen)

struct AIKeysCard: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: L("aikeys.group"), icon: "key.fill").padding(.bottom, 6)
            Text(L("aikeys.intro")).font(Typo.font(.callout)).foregroundColor(Theme.secondary).padding(.bottom, 6)
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
                .font(Typo.font(.subhead)).foregroundColor(status.connected ? Theme.ready : Theme.tertiary).frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(status.name).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                Text(status.connected ? L("aikeys.connectedHint", status.hint ?? "") : L("aikeys.notConnected"))
                    .font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
            }
            Spacer()
            if status.connected {
                Button(L("aikeys.remove")) { Task { await model.deleteAIKey(provider: status.provider) } }.bidButton(.ghost, compact: true)
            } else {
                BIDField(placeholder: L("aikeys.placeholder"), text: $key, kind: .secure)
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

/// Cloud readiness for the owner (WP03): secrets set or not, scheduler heartbeat, Paddle price ids, legal links,
/// database functions. Only yes/no answers leave the cloud — never a value.
struct AdminDiagnosticsCard: View {
    @EnvironmentObject var model: AppModel
    private var store: AdminStore { model.adminStore }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                SectionLabel(text: L("admin.diag.title"), icon: "stethoscope")
                Spacer()
                Button { Task { await store.loadDiagnostics() } } label: { Label(L("common.refresh"), systemImage: "arrow.clockwise") }
                    .bidButton(.ghost, compact: true)
            }
            if let d = store.diagnostics {
                if d.ready {
                    Label(L("admin.diag.ready"), systemImage: "checkmark.seal.fill").font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.ready)
                } else {
                    Text(L("admin.diag.todo", String(d.todo.count))).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.warn)
                }
                row(L("admin.diag.scheduler"), ok: d.scheduler.state == "ok", detail: d.scheduler.lastRunAt.map { Fmt.relative($0) } ?? L("admin.diag.never"))
                ForEach(d.secrets.keys.sorted(), id: \.self) { k in row(k, ok: d.secrets[k] == true, detail: d.secrets[k] == true ? L("admin.diag.set") : L("admin.diag.missing")) }
                ForEach(d.functions.keys.sorted(), id: \.self) { k in row(k, ok: d.functions[k] == true, detail: d.functions[k] == true ? L("admin.diag.present") : L("admin.diag.applySchema")) }
                row(L("admin.diag.prices"), ok: d.missingPrices.isEmpty, detail: d.missingPrices.isEmpty ? L("admin.diag.set") : d.missingPrices.joined(separator: ", "))
                ForEach(d.links.keys.sorted(), id: \.self) { k in row(k, ok: d.links[k] == true, detail: d.links[k] == true ? L("admin.diag.set") : L("admin.diag.missing")) }
            } else if let e = store.diagnosticsError {
                Text(e).font(Typo.font(.callout)).foregroundColor(Theme.warn).textSelection(.enabled)
            } else {
                Spinner(size: 14)
            }
        }
        .card()
        .task { await store.loadDiagnostics() }
    }

    private func row(_ title: String, ok: Bool, detail: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: ok ? "checkmark.circle.fill" : "exclamationmark.circle.fill").foregroundColor(ok ? Theme.ready : Theme.warn)
            Text(title).font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.text)
            Spacer()
            Text(detail).font(Typo.font(.callout)).foregroundColor(Theme.secondary).lineLimit(1).truncationMode(.middle)
        }
        .accessibilityElement(children: .combine)
    }
}
