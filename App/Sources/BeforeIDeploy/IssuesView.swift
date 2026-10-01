import AppKit
import SwiftUI

/// Unified issues list (V11): every finding of the last check as one card — severity, kind, evidence,
/// impact, the proposed fix with its risk, and how the result is verified. Blockers come first.
struct IssuesCard: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                SectionLabel(text: L("issues.title"), icon: "list.bullet.rectangle.portrait")
                if let c = status.issues?.counts, c.total > 0 {
                    Text(L("issues.count", count: c.total)).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                    if c.blocker > 0 {
                        Text(L("issues.blocking", count: c.blocker))
                            .font(Typo.font(.caption, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(Capsule().fill(Theme.blocked))
                    }
                }
                Spacer()
                if let at = status.issues?.checkedAt {
                    Text(Fmt.relative(at)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                }
            }
            if status.check == nil {
                EmptyLine(icon: "questionmark.circle", text: L("issues.notChecked"))
            } else if let list = status.issues?.issues, !list.isEmpty {
                VStack(spacing: 8) {
                    ForEach(Array(list.enumerated()), id: \.element.id) { i, issue in
                        IssueRow(issue: issue, projectPath: status.project.path)
                            .entrance(i, offset: 8)
                    }
                }
            } else {
                EmptyLine(icon: "checkmark.seal.fill", text: L("issues.none"), tint: Theme.ready)
            }
        }
        .card()
    }
}

struct EmptyLine: View {
    let icon: String
    let text: String
    var tint: Color = Theme.tertiary
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon).foregroundColor(tint)
            Text(text).font(Typo.font(.body)).foregroundColor(Theme.secondary)
        }
        .padding(.vertical, 4)
    }
}

struct IssueRow: View {
    @EnvironmentObject var model: AppModel
    let issue: Issue
    let projectPath: String
    @Local private var expanded = false

    static func tint(_ severity: String) -> Color {
        switch severity {
        case "blocker": return Theme.blocked
        case "high": return Theme.warn
        case "medium": return Theme.accent
        case "low": return Theme.secondary
        default: return Theme.tertiary
        }
    }

    var evidenceLine: String? {
        guard let e = issue.evidence else { return nil }
        if let f = e.file { return e.line.map { "\(f):\($0)" } ?? f }
        return e.resource
    }

    var body: some View {
        let tint = Self.tint(issue.severity)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Text(K.severity(issue.severity))
                    .font(Typo.font(.micro, weight: .bold)).tracking(0.5)
                    .foregroundColor(issue.severity == "blocker" ? .white : tint)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Capsule().fill(issue.severity == "blocker" ? tint : tint.opacity(0.14)))
                    .frame(width: 74, alignment: .leading)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(issue.title).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                        Text("· \(K.kind(issue.kind))").font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                    }
                    Text(issue.impact).font(Typo.font(.callout)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                    if let ev = evidenceLine {
                        Text(ev).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.secondary).textSelection(.enabled)
                    }
                }
                Spacer(minLength: 8)
                fixButton
                Button { withAnimation(Motion.quick) { expanded.toggle() } } label: {
                    Image(systemName: expanded ? "chevron.up" : "chevron.down").font(Typo.font(.micro, weight: .bold)).foregroundColor(Theme.tertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L("common.details"))
            }
            if expanded { details }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.bg))
        .overlay(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).strokeBorder(issue.severity == "blocker" ? tint.opacity(0.45) : Theme.hairline, lineWidth: 1))
        .lift(radius: 12, tint: tint, amount: 1.006)
    }

    @ViewBuilder private var fixButton: some View {
        Button { model.openAssistant(issue: issue.id) } label: { Label(L("ai.askAssistant"), systemImage: "sparkles") }
            .bidButton(.ghost, compact: true)
            .help(L("ai.askIssueHelp"))
        if let fix = issue.fix {
            switch fix.type {
            case "safe":
                Button(L("issue.fix.safe")) { if let id = fix.id { model.requestFix(id) } }.bidButton(.primary, compact: true)
            case "ai":
                Button(L("issue.fix.ai")) { if model.aiReady { model.aiStore.start(step: issue.step) } else { model.aiUnavailableAction() } }.bidButton(.primary, compact: true)
            case "ui":
                Button(K.fixUI(fix.id ?? "setup")) { route(fix.id ?? "setup") }.bidButton(.secondary, compact: true)
            default:
                Text(L("issue.fix.manual")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
            }
        }
    }

    private func route(_ id: String) {
        switch id {
        case "commit": model.sheet = .commit
        case "netlify-setup": model.sheet = .netlifySetup
        default:
            model.screen = .setup
            Task { await model.loadSetup() }
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 14) {
                Text(K.confidence(issue.confidence)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                if let risk = issue.fix?.risk { Text(L("issue.fixRisk", K.risk(risk))).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
                if let steps = issue.verify?.steps, !steps.isEmpty { Text(L("issue.verify", steps.joined(separator: ", "))).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
            }
            Text("\(L("issue.impact")): \(issue.impact)").font(Typo.font(.callout)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
            if let detail = issue.evidence?.detail, !detail.isEmpty {
                Text(L("issue.evidence")).font(Typo.font(.caption, weight: .bold)).tracking(0.5).foregroundColor(Theme.tertiary)
                ScrollView {
                    Text(detail).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.text)
                        .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled).padding(8)
                }
                .frame(maxHeight: 140)
                .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.panel))
            }
            HStack(spacing: 8) {
                if let f = issue.evidence?.file {
                    Button(L("issue.showFile")) { model.revealInFinder((projectPath as NSString).appendingPathComponent(f)) }.bidButton(.ghost, compact: true)
                }
                if let log = issue.evidence?.log {
                    Button(L("issue.openLog")) { model.openFile(log) }.bidButton(.ghost, compact: true)
                }
            }
        }
        .padding(.leading, 84)
    }
}
