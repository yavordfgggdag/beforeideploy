import AppKit
import SwiftUI

/// Release sheet (V11): preview → smoke checks → typed DEPLOY → production → verification → rollback.
/// Everything shown comes from the engine's operation record (`bid release status`).
struct ReleaseSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var typed = ""

    private var project: Project? { model.status?.project }
    private var rel: ReleaseStatus? { model.release }
    private var current: ReleaseOp? { rel?.current }
    private var last: ReleaseOp? { rel?.ops.first }

    var body: some View {
        SheetScaffold(icon: "paperplane.fill", iconTint: Theme.accent, title: L("release.title"),
                      subtitle: L("release.subtitle", project?.name ?? ""), width: 600) {
            VStack(alignment: .leading, spacing: 14) {
                if model.loadingRelease && rel == nil {
                    HStack { Spinner(size: 14); Text(L("billing.loading")).foregroundColor(Theme.secondary) }.frame(maxWidth: .infinity, minHeight: 80)
                } else if let op = current {
                    awaiting(op)
                } else if let op = last, !op.isFinal {
                    inProgress(op)
                } else {
                    start
                    if let op = last { lastResult(op) }
                }
                if let caps = rel?.capabilities { CapabilityRow(caps: caps) }
            }
        } actions: {
            Button(L("common.close")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            if let op = current {
                Button(L("release.cancel")) { Task { await model.cancelRelease(op); dismiss() } }.bidButton(.ghost)
                Button(L("release.promote")) { dismiss(); model.promoteRelease(op) }
                    .bidButton(.danger)
                    .disabled(typed != "DEPLOY" || model.run != nil)
                    .keyboardShortcut(.defaultAction)
            } else if last == nil || last?.isFinal == true {
                Button(L("release.start")) { dismiss(); model.startRelease() }.bidButton(.primary).disabled(model.run != nil).keyboardShortcut(.defaultAction)
            }
        }
        .task { await model.loadRelease() }
    }

    private var start: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L("release.startHint")).font(.system(size: 12.5)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
            StageList(stages: ["check", "preview", "smoke", "promote", "verify"].map { ReleaseStage(id: $0, status: "pending") })
        }
    }

    private func awaiting(_ op: ReleaseOp) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            StateLine(op: op)
            StageList(stages: op.stages)
            if let url = op.preview?.url {
                HStack(spacing: 8) {
                    Button { model.open(url) } label: { Label(L("release.openPreview"), systemImage: "safari") }.bidButton(.secondary, compact: true)
                    Text(Fmt.host(url)).font(.system(size: 12, design: .monospaced)).foregroundColor(Theme.secondary).textSelection(.enabled)
                    Spacer()
                }
            }
            if let smoke = op.smoke {
                SectionLabel(text: L("release.smokeChecks"))
                SmokeList(result: smoke)
            }
            VStack(alignment: .leading, spacing: 6) {
                if let id = op.preview?.deployId { Text(L("release.publishes", id)).font(.system(size: 11.5, design: .monospaced)).foregroundColor(Theme.tertiary) }
                Text(L("release.willPublish")).font(.system(size: 12)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                Text(L("release.confirmHint")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text).fixedSize(horizontal: false, vertical: true)
                TextField("DEPLOY", text: $typed)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .frame(width: 160)
                    .accessibilityLabel(L("release.promote"))
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.blocked.opacity(0.08)))
        }
    }

    private func inProgress(_ op: ReleaseOp) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            StateLine(op: op)
            StageList(stages: op.stages)
        }
    }

    private func lastResult(_ op: ReleaseOp) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: L("release.lastOps"))
            StateLine(op: op)
            if let f = op.failure, op.state == "failed" { Text(L("release.failure", f)).font(.system(size: 11.5)).foregroundColor(Theme.blocked) }
            if op.state == "stale" { Text(L("release.staleHint")).font(.system(size: 11.5)).foregroundColor(Theme.warn) }
            if let v = op.verify, op.state == "verify_failed" { SmokeList(result: v) }
            RollbackLine(rollback: op.rollback ?? rel?.rollback)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bg))
    }
}

struct StateLine: View {
    let op: ReleaseOp
    var tint: Color {
        switch op.state {
        case "succeeded": return Theme.ready
        case "failed", "verify_failed", "stale", "interrupted": return Theme.blocked
        case "cancelled": return Theme.tertiary
        default: return Theme.accent
        }
    }
    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(tint).frame(width: 8, height: 8)
            Text(K.releaseState(op.state)).font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.text)
            Spacer()
            if let c = op.confirmation, let by = c.by {
                Text(L("release.byActor", K.actor(by), Fmt.relative(c.at))).font(.system(size: 11)).foregroundColor(Theme.tertiary)
            } else {
                Text(Fmt.relative(op.updatedAt ?? op.createdAt)).font(.system(size: 11)).foregroundColor(Theme.tertiary)
            }
        }
    }
}

struct StageList: View {
    @EnvironmentObject var model: AppModel
    let stages: [ReleaseStage]
    var body: some View {
        VStack(spacing: 4) {
            ForEach(stages) { s in
                HStack(spacing: 10) {
                    Image(systemName: Theme.symbol(for: s.status)).foregroundColor(Theme.color(for: s.status)).frame(width: 16)
                    Text(K.releaseStage(s.id)).font(.system(size: 12.5, weight: .medium)).foregroundColor(s.status == "pending" ? Theme.tertiary : Theme.text)
                    if let sum = s.summary { Text(sum).font(.system(size: 11.5)).foregroundColor(Theme.secondary).lineLimit(1) }
                    Spacer()
                    if let log = s.log { Button(L("release.viewLog")) { model.openFile(log) }.bidButton(.ghost, compact: true) }
                    if let f = s.finishedAt, let st = s.startedAt, let a = Fmt.date(st), let b = Fmt.date(f) {
                        Text(Fmt.duration(b.timeIntervalSince(a))).font(.system(size: 11)).foregroundColor(Theme.tertiary)
                    }
                }
                .padding(.vertical, 3)
            }
        }
    }
}

struct SmokeList: View {
    let result: SmokeResult
    var body: some View {
        let checks = result.checks ?? []
        let failed = checks.filter { !$0.ok }
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: result.ok ? "checkmark.seal.fill" : "xmark.octagon.fill").foregroundColor(result.ok ? Theme.ready : Theme.blocked)
                Text(result.ok ? L("release.pagesOk", checks.count) : L("release.pagesFailed", failed.count)).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
            }
            ForEach(checks.prefix(8)) { c in
                HStack(spacing: 8) {
                    Text(c.ok ? "✓" : "✗").foregroundColor(c.ok ? Theme.ready : Theme.blocked).font(.system(size: 11, weight: .bold))
                    Text("\(c.status ?? 0)").font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.secondary).frame(width: 30, alignment: .trailing)
                    Text(c.url).font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.text).lineLimit(1).truncationMode(.middle)
                    if let r = c.reason { Text(r).font(.system(size: 11)).foregroundColor(Theme.blocked) }
                    Spacer()
                    if let ms = c.ms { Text("\(ms) ms").font(.system(size: 11)).foregroundColor(Theme.tertiary) }
                }
            }
        }
    }
}

struct RollbackLine: View {
    @EnvironmentObject var model: AppModel
    let rollback: ReleaseRollback?
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.uturn.backward.circle").foregroundColor(rollback?.available == true ? Theme.accent : Theme.tertiary)
            if let rb = rollback, rb.available, let id = rb.deployId {
                Text(L("release.rollbackAvailable", id)).font(.system(size: 12)).foregroundColor(Theme.text)
                Spacer()
                Button(L("release.rollbackTitle")) { model.sheet = .rollback }.bidButton(.secondary, compact: true).disabled(model.run != nil)
            } else {
                Text(L("release.rollbackUnavailable", K.rollbackReason(rollback?.reason))).font(.system(size: 12)).foregroundColor(Theme.secondary)
                Spacer()
            }
        }
    }
}

struct CapabilityRow: View {
    let caps: ReleaseCapabilities
    var body: some View {
        let items: [(String, Bool)] = [("preview", caps.preview), ("production", caps.production), ("status", caps.status), ("rollback", caps.rollback), ("publishArtifact", caps.publishArtifact)]
        HStack(spacing: 6) {
            Text(L("release.capabilities")).font(.system(size: 10.5, weight: .bold)).tracking(0.6).foregroundColor(Theme.tertiary)
            ForEach(items, id: \.0) { item in
                HStack(spacing: 3) {
                    Image(systemName: item.1 ? "checkmark" : "xmark").font(.system(size: 9, weight: .bold))
                    Text(K.capability(item.0)).font(.system(size: 10.5, weight: .medium))
                }
                .foregroundColor(item.1 ? Theme.ready : Theme.tertiary)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Capsule().fill(Theme.panel))
            }
            Spacer()
        }
    }
}

/// Typed-ROLLBACK confirmation. States what is restored and what is not.
struct RollbackSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var typed = ""

    var body: some View {
        let rb = model.release?.rollback
        SheetScaffold(icon: "arrow.uturn.backward.circle.fill", iconTint: Theme.warn, title: L("release.rollbackTitle"),
                      subtitle: model.status?.project.name ?? "") {
            VStack(alignment: .leading, spacing: 12) {
                if let rb, rb.available {
                    InfoRow(label: L("release.deployments"), value: rb.deployId ?? "—")
                    if let at = rb.createdAt { InfoRow(label: L("common.history"), value: Fmt.relative(at)) }
                    if let note = rb.note { Text(note).font(.system(size: 12)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true) }
                    Text(L("release.rollbackHint", model.status?.project.name ?? "")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text).fixedSize(horizontal: false, vertical: true)
                    TextField("ROLLBACK", text: $typed).textFieldStyle(.roundedBorder).font(.system(size: 14, weight: .bold, design: .monospaced)).frame(width: 180)
                } else {
                    EmptyLine(icon: "xmark.circle", text: L("release.rollbackUnavailable", K.rollbackReason(rb?.reason)))
                }
            }
        } actions: {
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button(L("release.rollbackButton")) { dismiss(); model.rollbackRelease(deployId: rb?.deployId) }
                .bidButton(.danger).disabled(typed != "ROLLBACK" || rb?.available != true || model.run != nil).keyboardShortcut(.defaultAction)
        }
    }
}

/// Hosting tab: what the host holds (deploys, which one is published) and the release actions.
struct DeploymentsCard: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus

    var body: some View {
        let rel = model.release
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: L("release.deployments"), icon: "shippingbox.fill", trailing: rel?.site?.publishedDeployId.map { "\(L("release.published")): \($0)" })
            if let caps = rel?.capabilities ?? status.release?.capabilities { CapabilityRow(caps: caps) }
            if model.loadingRelease && rel == nil {
                HStack { Spinner(size: 12); Text(L("settings.checking")).foregroundColor(Theme.secondary).font(.system(size: 12)) }
            } else if let deploys = rel?.deploys, !deploys.isEmpty {
                VStack(spacing: 4) {
                    ForEach(deploys.prefix(6)) { d in
                        HStack(spacing: 10) {
                            Image(systemName: d.id == rel?.site?.publishedDeployId ? "checkmark.circle.fill" : "circle").foregroundColor(d.id == rel?.site?.publishedDeployId ? Theme.ready : Theme.tertiary)
                            Text(d.id).font(.system(size: 11.5, design: .monospaced)).foregroundColor(Theme.text)
                            Text(K.deployContext(d.context)).font(.system(size: 11)).foregroundColor(Theme.secondary)
                            Spacer()
                            Text(Fmt.relative(d.publishedAt ?? d.createdAt)).font(.system(size: 11)).foregroundColor(Theme.tertiary)
                            if let u = d.url { Button { model.open(u) } label: { Image(systemName: "safari") }.buttonStyle(.plain).foregroundColor(Theme.secondary).help(u) }
                        }
                        .padding(.vertical, 2)
                    }
                }
            } else if rel != nil {
                EmptyLine(icon: "tray", text: L("release.noDeploys"))
            }
            HStack(spacing: 8) {
                Button { model.sheet = .release } label: { Label(L("release.button"), systemImage: "paperplane.fill") }.bidButton(.primary, compact: true).disabled(model.run != nil)
                Spacer()
                RollbackLine(rollback: rel?.rollback)
            }
            if let ops = rel?.ops, !ops.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    SectionLabel(text: L("release.lastOps"))
                    ForEach(ops.prefix(3)) { op in StateLine(op: op) }
                }
            }
        }
        .card()
        .task { await model.loadRelease() }
    }
}
