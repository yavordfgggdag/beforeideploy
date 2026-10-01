import SwiftUI

struct CloudAuditSheet: View {
    @Environment(\.dismiss) private var dismiss
    let receipt: CloudAuditReceipt
    var body: some View {
        SheetScaffold(icon: "checkmark.shield", title: L("usage.cloudAudit"), subtitle: receipt.report.url, width: 660) {
            VStack(alignment: .leading, spacing: 14) {
                Text(L("usage.auditScope")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                if receipt.report.status == "unreachable" {
                    ErrorState(message: L("usage.auditUnreachable"))
                }
                if let credits = receipt.charged { InfoRow(label: L("usage.auditCharge"), value: L("usage.creditsCount", Fmt.tokens(credits))) }
                if let ms = receipt.report.responseMs { InfoRow(label: L("usage.auditResponse"), value: L("usage.auditMilliseconds", Int(ms))) }
                if let code = receipt.report.httpStatus { InfoRow(label: L("usage.auditHTTP"), value: String(code)) }
                if let meta = receipt.report.metadata {
                    result(L("usage.auditTitle"), receipt.report.titlePresent == true)
                    result(L("usage.auditDescription"), meta.description)
                    result(L("usage.auditLanguage"), meta.language)
                    result(L("usage.auditCanonical"), meta.canonical)
                    result(L("usage.auditHeading"), meta.h1)
                    result(L("usage.auditAlt"), meta.missingAlt == 0)
                    InfoRow(label: L("usage.auditHeaders"), value: "\(meta.securityHeaders.count)/3")
                    if meta.truncated { Text(L("usage.auditTruncated")).font(Typo.font(.callout)).foregroundColor(Theme.warn) }
                }
                ForEach(receipt.report.links ?? []) { link in
                    HStack {
                        Image(systemName: link.ok ? "checkmark.circle" : "exclamationmark.circle").foregroundColor(link.ok ? Theme.ready : Theme.warn)
                        Text(link.url).font(Typo.font(.caption)).textSelection(.enabled).lineLimit(2)
                        Spacer()
                        Text(link.status.map(String.init) ?? L("usage.auditNoResponse")).font(Typo.font(.caption))
                    }
                }
            }
        } actions: { Button(L("common.close")) { dismiss() }.bidButton(.primary) }
    }
    private func result(_ title: String, _ passed: Bool) -> some View {
        HStack {
            Image(systemName: passed ? "checkmark.circle.fill" : "exclamationmark.circle.fill").foregroundColor(passed ? Theme.ready : Theme.warn)
            Text(title).font(Typo.font(.body))
            Spacer()
            Text(passed ? L("usage.auditPresent") : L("usage.auditReview")).font(Typo.font(.caption)).foregroundColor(Theme.secondary)
        }
    }
}

struct CloudPriceCard: View {
    let pricing: UsageReport.Pricing
    var body: some View {
        if let actions = pricing.actions {
            VStack(alignment: .leading, spacing: 12) {
                Text(L("usage.cloudPrices")).font(Typo.font(.subhead))
                Text(L("usage.cloudPricesDetail")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                ForEach(actions.keys.sorted(), id: \.self) { key in
                    if let price = actions[key] {
                        InfoRow(label: CreditActionName.label(key), value: price.credits.map { L("usage.creditsCount", Fmt.tokens($0)) } ?? L("usage.actualAIPrice"))
                    }
                }
            }.card()
        }
    }
}

enum CreditActionName {
    static func label(_ action: String) -> String {
        switch action {
        case "ai", "ai.chat", "ai.fix", "ai.fix.deep": return L("usage.actionAI")
        case "check", "check.run": return L("usage.actionCheck")
        case "audit", "audit.full": return L("usage.actionAudit")
        case "deploy", "deploy.production": return L("usage.actionDeploy")
        case "deploy.preview": return L("usage.actionPreview")
        case "deploy.rollback": return L("usage.actionRollback")
        case "site.day": return L("usage.actionHosting")
        case "monitor.fast": return L("usage.actionFastMonitor")
        case "monitor.path": return L("usage.actionExtraPath")
        case "backup.snapshot": return L("usage.actionBackup")
        default: return L("usage.actionOther")
        }
    }
}

struct CreditQuotaActions: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var store: BillingStore
    let code: String
    private var windowLimited: Bool { ["ai_session_cap", "window_5h", "window_week"].contains(code) }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if windowLimited {
                Text(L("billing.packWindows")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                if let reset = code == "window_week" ? store.usage?.weekly?.resetsAt : store.usage?.session?.resetsAt {
                    Text(L("usage.quotaReset", Fmt.dateTime(reset))).font(Typo.font(.callout)).foregroundColor(Theme.warn)
                }
            }
            HStack {
                Button(L("usage.buyCredits")) { model.sheet = .plans }.bidButton(.primary, compact: true)
                Button(L("usage.upgrade")) { model.sheet = .plans }.bidButton(.secondary, compact: true)
                if store.usage?.weekly?.boostAvailable == true && windowLimited {
                    Button(L("usage.boost")) { store.creditAction("boost") }.bidButton(.secondary, compact: true).disabled(store.busy != nil || store.demo)
                }
            }
        }.task { await store.loadUsage() }
    }
}
