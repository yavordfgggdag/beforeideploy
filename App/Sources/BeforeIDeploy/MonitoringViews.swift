import AppKit
import SwiftUI

/// Monitoring and incidents (V11). Says where the checks run (this Mac — the app's timer or the launchd
/// agent), when they last ran, and lists open incidents. No server-side scheduler exists yet, and the
/// card says so rather than implying 24/7 coverage.
struct MonitorCard: View {
    @EnvironmentObject var model: AppModel
    @Local private var confirmAgent = false

    var body: some View {
        let m = model.monitor
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                SectionLabel(text: L("monitor.title"), icon: "waveform.path.ecg.rectangle")
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
            Text(L("monitor.noServerSide")).font(.system(size: 11)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)

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
