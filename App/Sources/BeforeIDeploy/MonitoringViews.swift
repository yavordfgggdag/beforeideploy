import AppKit
import SwiftUI

/// Monitoring and incidents (V11). Says where the checks run (this Mac — the app's timer or the launchd
/// agent), when they last ran, and lists open incidents. No server-side scheduler exists yet, and the
/// card says so rather than implying 24/7 coverage.
struct MonitorCard: View {
    @EnvironmentObject var model: AppModel
    @Local private var confirmAgent = false
    @Local private var webhookDraft = ""

    var body: some View {
        let m = model.monitor
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                SectionLabel(text: L("monitor.title"), icon: "waveform.path.ecg.rectangle")
                PulseDot(color: m?.serverSide == true ? Theme.ready : (m?.stale == true ? Theme.warn : Theme.accent), size: 6, active: m != nil && m?.stale != true)
                    .frame(width: 14, height: 14)
                Spacer()
                if let at = m?.lastRunAt {
                    Label(L("monitor.lastRun", Fmt.relative(at)), systemImage: m?.stale == true ? "exclamationmark.triangle.fill" : "clock")
                        .font(.system(size: 11)).foregroundColor(m?.stale == true ? Theme.warn : Theme.tertiary)
                } else {
                    Text(L("monitor.neverRan")).font(.system(size: 11)).foregroundColor(Theme.tertiary)
                }
                Button { model.runMonitorOnce() } label: { Label(L("monitor.checkNow"), systemImage: "arrow.clockwise") }
                    .bidButton(.secondary, compact: true).disabled(model.busy.contains("monitor"))
            }

            HStack(spacing: 8) {
                Image(systemName: "desktopcomputer").foregroundColor(Theme.accent)
                Text(m?.agent.installed == true ? L("monitor.runsOnAgent", m?.settings.intervalMin ?? 10) : L("monitor.runsOnApp", m?.settings.intervalMin ?? 10))
                    .font(.system(size: 12)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                Spacer()
                Toggle(L("monitor.agentToggle"), isOn: Binding(get: { m?.agent.installed == true }, set: { on in
                    if on { confirmAgent = true } else { model.setMonitorAgent(on: false) }
                }))
                .toggleStyle(.switch).controlSize(.small)
                .disabled(model.busy.contains("monitor-agent"))
            }
            if m == nil, let e = model.loadErrors["monitor"] {
                // the status could not be read: the reason and Retry, not an empty card (WP02)
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundColor(Theme.warn)
                    Text(e).font(.system(size: 11.5)).foregroundColor(Theme.secondary).lineLimit(2)
                    Spacer()
                    Button(L("common.retry")) { Task { await model.loadMonitor() } }.bidButton(.ghost, compact: true)
                }
            }
            cloudSection(m)
            if let w = m?.maintenance, !w.isEmpty {
                ForEach(w) { win in
                    Label(L("monitor.maintenanceWindow", Fmt.dateTime(win.from), Fmt.dateTime(win.to), win.note ?? ""), systemImage: "wrench.and.screwdriver")
                        .font(.system(size: 11)).foregroundColor(Theme.warn)
                }
            }
            channelRow(m)

            if let s = m?.settings {
                HStack(spacing: 14) {
                    Text(L("monitor.notifyLabel")).font(.system(size: 11.5, weight: .semibold)).foregroundColor(Theme.secondary)
                    notifyToggle(L("monitor.notify.down"), s.notify.down) { model.setMonitorNotify(down: $0) }
                    notifyToggle(L("monitor.notify.ssl"), s.notify.ssl) { model.setMonitorNotify(ssl: $0) }
                    notifyToggle(L("monitor.notify.domain"), s.notify.domain) { model.setMonitorNotify(domain: $0) }
                    notifyToggle(L("monitor.notify.recovered"), s.notify.recovered) { model.setMonitorNotify(recovered: $0) }
                    Spacer()
                }
            }

            if let open = m?.openIncidents, !open.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(L("monitor.openIncidents", count: open.count)).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.blocked)
                    ForEach(open) { i in IncidentRow(incident: i) }
                }
            } else if m != nil {
                EmptyLine(icon: "checkmark.circle.fill", text: L("monitor.noIncidents"), tint: Theme.ready)
            }
            if let recent = m?.recentIncidents, !recent.isEmpty {
                DisclosureGroup(L("monitor.recentIncidents", count: recent.count)) {
                    VStack(alignment: .leading, spacing: 4) { ForEach(recent.prefix(10)) { i in IncidentRow(incident: i) } }.padding(.top, 4)
                }
                .font(.system(size: 12)).foregroundColor(Theme.secondary)
            }
        }
        .card()
        .alert(L("monitor.agentConfirmTitle"), isPresented: $confirmAgent) {
            Button(L("monitor.agentConfirmButton")) { model.setMonitorAgent(on: true) }
            Button(L("common.cancel"), role: .cancel) {}
        } message: {
            Text(L("monitor.agentConfirmBody"))
        }
    }

    /// Where the checks really run. Cloud = registered target + a fresh scheduler heartbeat; anything less is said as it is.
    @ViewBuilder private func cloudSection(_ m: MonitorStatus?) -> some View {
        let c = m?.cloud
        let key = model.selectedKey
        let target = c?.targets?.first { $0.projectKey == key }
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "cloud").foregroundColor(c?.active == true ? Theme.ready : Theme.tertiary)
            VStack(alignment: .leading, spacing: 3) {
                if m == nil || c == nil {
                    Text(L("monitor.cloudUnknown")).font(.system(size: 12)).foregroundColor(Theme.secondary)
                } else if c?.unavailable == true {
                    Text(c?.reason == "not_logged_in" ? L("monitor.cloudSignedOut") : L("monitor.cloudOffline")).font(.system(size: 12)).foregroundColor(Theme.secondary)
                } else if c?.active == true {
                    Text(L("monitor.cloudActive", c?.targets?.count ?? 0)).font(.system(size: 12)).foregroundColor(Theme.text)
                    Text(L("monitor.cloudScheduler", Fmt.relative(c?.scheduler?.lastRunAt), c?.nextRunAt.map { Fmt.relative($0) } ?? "—", c?.retentionDays ?? 90)).font(.system(size: 11)).foregroundColor(Theme.tertiary)
                } else if c?.scheduler?.state == "never" {
                    Text(L("monitor.cloudNever")).font(.system(size: 12)).foregroundColor(Theme.warn)
                } else if c?.scheduler?.state == "stale" {
                    Text(L("monitor.cloudStale", Fmt.relative(c?.scheduler?.lastRunAt))).font(.system(size: 12)).foregroundColor(Theme.warn)
                } else {
                    Text(L("monitor.cloudNoTargets")).font(.system(size: 12)).foregroundColor(Theme.secondary)
                }
                if let t = target {
                    Text(L("monitor.cloudTarget", t.url, t.intervalMin, t.lastOk.map { $0 ? L("signal.healthy") : L("signal.problem") } ?? L("signal.unchecked"))).font(.system(size: 11)).foregroundColor(Theme.tertiary).lineLimit(1).truncationMode(.middle)
                }
                if m?.serverSide != true { Text(L("monitor.noServerSide")).font(.system(size: 11)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer()
            if key != nil, c?.unavailable != true, c != nil {
                Toggle(L("monitor.cloudToggle"), isOn: Binding(get: { target != nil }, set: { model.setCloudMonitoring(on: $0) }))
                    .toggleStyle(.switch).controlSize(.small)
                    .disabled(model.busy.contains("monitor-cloud"))
                    .help(L("monitor.cloudToggleHelp"))
            }
        }
    }

    /// External channels: a webhook URL (chat tools) and Pushover (the phone). "Send test" reaches every configured one.
    private func channelRow(_ m: MonitorStatus?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "bell.badge").foregroundColor(Theme.accent)
                if let w = m?.channels?.webhook {
                    Text(L("monitor.webhookSet", w)).font(.system(size: 11.5)).foregroundColor(Theme.secondary).lineLimit(1).truncationMode(.middle)
                    Button(L("monitor.webhookTest")) { model.testMonitorWebhook() }.bidButton(.ghost, compact: true).disabled(model.busy.contains("monitor-webhook"))
                    Button(L("monitor.webhookRemove")) { model.setMonitorWebhook(nil) }.bidButton(.ghost, compact: true).disabled(model.busy.contains("monitor-webhook"))
                } else {
                    TextField(L("monitor.webhookPlaceholder"), text: $webhookDraft).textFieldStyle(.roundedBorder).font(.system(size: 11.5)).frame(maxWidth: 360)
                        .onSubmit { model.setMonitorWebhook(webhookDraft) }
                    Button(L("common.save")) { model.setMonitorWebhook(webhookDraft) }.bidButton(.secondary, compact: true).disabled(webhookDraft.isEmpty || model.busy.contains("monitor-webhook"))
                }
                Spacer()
            }
            HStack(spacing: 8) {
                Image(systemName: "iphone.radiowaves.left.and.right").foregroundColor(Theme.accent)
                if let p = m?.channels?.pushover, p.connected {
                    Text(L("monitor.pushoverSet", p.user ?? "…")).font(.system(size: 11.5)).foregroundColor(Theme.secondary).lineLimit(1)
                    if m?.channels?.webhook == nil {
                        Button(L("monitor.webhookTest")) { model.testMonitorWebhook() }.bidButton(.ghost, compact: true).disabled(model.busy.contains("monitor-webhook"))
                    }
                    Button(L("monitor.webhookRemove")) { model.disconnectPushover() }.bidButton(.ghost, compact: true).disabled(model.busy.contains("monitor-pushover"))
                } else {
                    Text(L("monitor.pushoverIntro")).font(.system(size: 11.5)).foregroundColor(Theme.tertiary).lineLimit(1)
                    Button(L("monitor.pushoverConnect")) { model.sheet = .pushover }.bidButton(.secondary, compact: true)
                }
                Spacer()
            }
        }
    }

    private func notifyToggle(_ title: String, _ value: Bool, _ set: @escaping (Bool) -> Void) -> some View {
        Toggle(title, isOn: Binding(get: { value }, set: set)).toggleStyle(.checkbox).font(.system(size: 11.5))
    }
}

struct IncidentRow: View {
    @EnvironmentObject var model: AppModel
    let incident: Incident

    var tint: Color {
        if incident.status != "open" { return Theme.ready }
        return incident.severity == "critical" ? Theme.blocked : Theme.warn
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: incident.status == "open" ? (incident.severity == "critical" ? "xmark.octagon.fill" : "exclamationmark.triangle.fill") : "checkmark.circle.fill")
                .foregroundColor(tint).frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(incident.projectName ?? incident.project).font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.text)
                    Text(K.incidentKind(incident.kind)).font(.system(size: 11)).foregroundColor(Theme.secondary)
                    if let src = incident.source {
                        Text(src == "cloud" ? L("monitor.sourceCloud") : L("monitor.sourceMac")).font(.system(size: 10, weight: .semibold)).foregroundColor(Theme.tertiary)
                            .padding(.horizontal, 5).padding(.vertical, 1).background(Capsule().fill(Theme.hairline))
                    }
                    if let d = incident.detail { Text(d).font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.tertiary) }
                }
                Text(incident.status == "open"
                     ? L("monitor.incidentOpen", Fmt.relative(incident.openedAt), incident.count ?? 1)
                     : L("monitor.incidentResolved", Fmt.relative(incident.openedAt), Fmt.relative(incident.resolvedAt)))
                    .font(.system(size: 11)).foregroundColor(Theme.tertiary)
            }
            Spacer()
            if let u = incident.url {
                Button { model.open(u) } label: { Image(systemName: "safari") }.buttonStyle(.plain).foregroundColor(Theme.secondary).help(u)
            }
            if !incident.project.hasPrefix("domain:") {
                Button { Task { await model.select(incident.project) } } label: { Image(systemName: "chevron.right") }
                    .buttonStyle(.plain).foregroundColor(Theme.tertiary)
            }
        }
        .padding(.vertical, 3)
    }
}

/// One provenance-aware value on a portfolio card: state colour, value, source and age.
struct SignalPill: View {
    let name: String
    let signal: Signal?
    let icon: String

    var tint: Color {
        switch signal?.state {
        case "healthy": return Theme.ready
        case "problem": return Theme.blocked
        case "stale": return Theme.warn
        case "unsupported": return Theme.tertiary
        default: return Theme.tertiary
        }
    }

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 10, weight: .semibold)).foregroundColor(tint)
            Text(signal?.value ?? K.signalState(signal?.state ?? "unchecked")).font(.system(size: 11, weight: .medium)).foregroundColor(signal?.state == "unsupported" || signal == nil ? Theme.tertiary : Theme.text)
            if let at = signal?.at { Text(Fmt.relative(at)).font(.system(size: 10)).foregroundColor(Theme.tertiary) }
        }
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(Capsule().fill(tint.opacity(signal?.state == "healthy" || signal?.state == "problem" ? 0.12 : 0.06)))
        .help("\(name): \(K.signalState(signal?.state ?? "unchecked"))\(signal?.source.map { " · \($0)" } ?? "")\(signal?.detail.map { " · \($0)" } ?? "")")
        .accessibilityLabel("\(name): \(signal?.value ?? K.signalState(signal?.state ?? "unchecked"))")
    }
}

/// Small sheet: which client a site belongs to (portfolio filter).
struct ClientSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var name = ""

    var body: some View {
        SheetScaffold(icon: "person.crop.rectangle", title: L("client.title"), subtitle: model.status?.project.name ?? "", width: 420) {
            VStack(alignment: .leading, spacing: 8) {
                Text(L("client.hint")).font(.system(size: 12)).foregroundColor(Theme.secondary)
                TextField(L("client.placeholder"), text: $name).textFieldStyle(.roundedBorder)
                    .onAppear { name = model.status?.project.client ?? "" }
            }
        } actions: {
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button(L("common.save")) { model.setClient(name); dismiss() }.bidButton(.primary).keyboardShortcut(.defaultAction)
        }
    }
}

/// Backups: honest "not connected" until a real provider API exists. Never shows a simulated backup.
struct BackupCard: View {
    let backup: BackupStatus?
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: L("backup.title"), icon: "externaldrive.badge.timemachine", trailing: backup?.name)
            if let b = backup, b.connected, let at = b.lastBackupAt {
                InfoRow(label: L("signal.backup"), value: Fmt.relative(at))
            } else {
                EmptyLine(icon: "xmark.circle", text: L("backup.notConnected"))
                Text(L("backup.honest")).font(.system(size: 11.5)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                if let missing = backup?.missing, !missing.isEmpty {
                    Text(L("backup.missing")).font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.tertiary)
                    ForEach(missing, id: \.self) { m in
                        Text("• \(m)").font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.tertiary).textSelection(.enabled)
                    }
                }
            }
        }
        .card()
    }
}
