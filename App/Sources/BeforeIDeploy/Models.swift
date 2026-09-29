import Foundation

struct NetlifyInfo: Codable, Hashable {
    var linked: Bool?
    var siteId: String?
    var siteName: String?
    var liveUrl: String?
    var adminUrl: String?
    var lastPublishedAt: String?
    var repoLinked: Bool?
}

struct Project: Codable, Identifiable, Hashable {
    var key: String
    var name: String
    var path: String
    var client: String?
    var hosting: String?
    var liveUrl: String?
    var framework: String?
    var packageManager: String?
    var publishDir: String?
    var github: String?
    var netlify: NetlifyInfo?
    var lastPort: Int?
    var lastOpened: String?
    var exists: Bool?
    var lastStatus: String?
    var id: String { key }
}

struct StepResult: Codable, Identifiable, Hashable {
    var cached: Bool?
    var id: String
    var label: String?
    var category: String?
    var status: String
    var summary: String?
    var details: [String]?
    var fixes: [String]?
    var log: String?
    var duration: Double?
}

struct Counts: Codable, Hashable {
    var pass: Int
    var info: Int
    var warn: Int
    var fail: Int
}

struct CheckState: Codable, Hashable {
    var status: String
    var at: String
    var counts: Counts?
    var steps: [StepResult]
    var duration: Double?
}

struct ChangedFile: Codable, Hashable, Identifiable {
    var path: String
    var code: String
    var id: String { path }
}

struct CommitInfo: Codable, Hashable {
    var hash: String
    var subject: String
    var relative: String
}

struct GitStatus: Codable, Hashable {
    var isRepo: Bool
    var installed: Bool?
    var branch: String?
    var remote: String?
    var githubUrl: String?
    var changed: [ChangedFile]?
    var changedCount: Int?
    var hasUpstream: Bool?
    var upstream: String?
    var ahead: Int?
    var behind: Int?
    var lastCommit: CommitInfo?
}

struct LocalState: Codable, Hashable {
    var running: Bool
    var pid: Int?
    var port: Int?
    var url: String?
    var mode: String?
    var label: String?
    var startedAt: String?
    var log: String?
}

struct DeployRecord: Codable, Hashable {
    var url: String?
    var at: String?
    var deployId: String?
    var restoredFrom: String?
    var rollback: Bool?
}

struct FixItem: Codable, Identifiable, Hashable {
    var id: String
    var title: String
    var description: String
    var preview: String?
    var risk: String?
    var action: String?
}

struct NetlifyAuth: Codable, Hashable {
    var loggedIn: Bool
    var email: String?
    var name: String?
    var cli: String?
}

struct DetectInfo: Codable, Hashable {
    var exists: Bool?
    var framework: String?
    var ssr: Bool?
    var packageManager: String?
    var hasPackageJson: Bool?
    var hasNodeModules: Bool?
    var scripts: [String]?
    var publishDir: String?
    var publishReady: Bool?
    var hasFunctions: Bool?
    var netlifyLinked: Bool?
    var siteId: String?
}

struct ProjectStatus: Codable {
    var project: Project
    var detect: DetectInfo
    var git: GitStatus
    var local: LocalState
    var check: CheckState?
    var lastDraft: DeployRecord?
    var lastProd: DeployRecord?
    var netlifyAuth: NetlifyAuth
    var fixes: [FixItem]
    var hosting: HostingInfo?
    var issues: IssueList?
    var release: ReleaseInfo?
    var backup: BackupStatus?
}

struct HostingInfo: Codable, Hashable {
    var provider: String
    var name: String
    var ready: Bool
    var preview: Bool
    var installed: Bool?
    var loggedIn: Bool?
    var liveUrl: String?
}

struct HistoryEntry: Codable, Identifiable, Hashable {
    var ts: String
    var project: String
    var projectName: String?
    var kind: String
    var status: String
    var url: String?
    var duration: Double?
    var log: String?
    var message: String?
    var id: String { ts + kind + project }

    var title: String {
        switch kind {
        case "production": return status == "ok" ? "Production" : L("history.productionFailed")
        case "draft": return status == "ok" ? "Draft preview" : L("history.draftFailed")
        case "check": return status == "ok" ? L("common.checkNoun") : L("history.checkBlocked")
        case "commit": return "Commit"
        case "push": return status == "ok" ? "Push" : L("history.pushFailed")
        case "fix": return "Auto-fix"
        case "netlify-link": return L("history.netlifyLinked")
        case "netlify-create": return L("history.netlifyCreated")
        default: return kind
        }
    }

    var symbol: String {
        switch kind {
        case "production": return "paperplane.fill"
        case "draft": return "eye.fill"
        case "check": return "checklist"
        case "commit": return "smallcircle.filled.circle"
        case "push": return "arrow.up.circle.fill"
        case "fix": return "wand.and.stars"
        case "netlify-link", "netlify-create": return "link"
        default: return "circle"
        }
    }
}

struct NetlifySite: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var url: String?
    var adminUrl: String?
}

struct NetlifyTeam: Codable, Identifiable, Hashable {
    var slug: String
    var name: String?
    var id: String { slug }
}

struct DoctorInfo: Codable {
    struct Tool: Codable { var path: String; var version: String }
    struct NodeInfo: Codable { var path: String; var version: String }
    var engine: String
    var engineDir: String
    var appDir: String
    var cacheDir: String
    var node: NodeInfo
    var npm: Tool?
    var pnpm: Tool?
    var yarn: Tool?
    var bun: Tool?
    var git: Tool?
    var netlify: Tool?
    var npx: String?
    var netlifyAuth: NetlifyAuth
}

struct Empty: Codable {}

// MARK: - V7

struct AIFixResult: Codable {
    var target: String
    var step: String
    var prompt: String
    var promptFile: String?
    var url: String?
    var clipboard: Bool
    var commandFile: String?
    var chars: Int?
}

// Built-in AI Fix (engine `bid ai fix|explain|apply`)
struct AIFixOutcome: Codable {
    var provider: String
    var model: String?
    var mode: String
    var step: String
    var stepLabel: String?
    var answer: String?
    var explanation: String?
    var patchFile: String?
    var files: [AIPatchFile]?
    var applicable: Int?
    var usage: AIUsage?
    var duration: Double?
}

struct AIPatchFile: Codable, Identifiable, Hashable {
    var path: String
    var action: String
    var additions: Int
    var deletions: Int
    var diff: String
    var applicable: Bool
    var error: String?
    var id: String { path }
}

struct AIUsage: Codable, Hashable {
    var input: Int?
    var output: Int?
    var model: String?
    var charged: Int?
    var balance: Int?
}

struct AISkipped: Codable, Hashable {
    var path: String
    var reason: String
}

struct AIRecheck: Codable, Hashable {
    var status: String
    var step: String?
    var stepStatus: String?
    var verified: Bool
    var at: String?
}

struct AIApplyResult: Codable {
    var applied: [String]
    var skipped: [AISkipped]
    var committed: String?
    var changedSince: [String]?
    var undoFile: String?
    var recheck: AIRecheck?
}

struct AIUndoResult: Codable {
    var restored: [String]
    var skipped: [AISkipped]
}

// MARK: - Issues (V11): one shape for everything a check found

struct IssueEvidence: Codable, Hashable {
    var file: String?
    var line: Int?
    var resource: String?
    var detail: String?
    var log: String?
}

struct IssueFix: Codable, Hashable {
    var type: String   // safe | ai | ui | manual
    var id: String?
    var risk: String?  // low | medium | high
}

struct IssueVerify: Codable, Hashable {
    var steps: [String]
}

struct Issue: Codable, Identifiable, Hashable {
    var id: String
    var step: String
    var rule: String
    var severity: String    // blocker | high | medium | low | info
    var kind: String        // defect | recommendation | signal
    var confidence: String  // confirmed | likely | heuristic
    var title: String
    var impact: String
    var evidence: IssueEvidence?
    var fix: IssueFix?
    var verify: IssueVerify?
    var blocksRelease: Bool?
}

struct IssueCounts: Codable, Hashable {
    var total: Int
    var blocker: Int
    var high: Int
    var medium: Int
    var low: Int
    var info: Int
    var defects: Int
    var recommendations: Int
    var signals: Int
}

struct IssueList: Codable, Hashable {
    var issues: [Issue]
    var counts: IssueCounts
    var checkedAt: String?
    var partial: Bool?
}

struct FixRecheck: Codable, Hashable {
    var status: String
    var at: String?
    var steps: [String]?
    var verified: Bool
    var resolved: [String]?
    var unresolved: [String]?
}

struct FixApplyResult: Codable {
    var id: String
    var summary: String?
    var recheck: FixRecheck?
}

// MARK: - Releases (V11): operation records with stages, smoke checks and rollback

struct ReleaseCapabilities: Codable, Hashable {
    var provider: String
    var preview: Bool
    var production: Bool
    var status: Bool
    var logs: Bool
    var domains: Bool
    var rollback: Bool
    var publishArtifact: Bool
}

struct AIUndoInfo: Codable, Hashable {
    var at: String?
    var step: String?
    var files: [String]?
}

struct ReleaseInfo: Codable, Hashable {
    var currentOp: String?
    var lastOp: String?
    var capabilities: ReleaseCapabilities
    var aiUndo: AIUndoInfo?
}

struct ReleaseStage: Codable, Identifiable, Hashable {
    var id: String
    var status: String
    var summary: String?
    var details: [String]?
    var startedAt: String?
    var finishedAt: String?
    var log: String?
}

struct SmokeCheck: Codable, Hashable, Identifiable {
    var url: String
    var ok: Bool
    var status: Int?
    var ms: Int?
    var reason: String?
    var id: String { url }
}

struct SmokeResult: Codable, Hashable {
    var ok: Bool
    var url: String?
    var at: String?
    var checks: [SmokeCheck]?
    var log: String?
}

struct ReleasePreview: Codable, Hashable {
    var url: String?
    var deployId: String?
    var at: String?
}

struct ReleaseProduction: Codable, Hashable {
    var url: String?
    var deployId: String?
    var previousDeployId: String?
    var at: String?
}

struct ReleaseRollback: Codable, Hashable {
    var available: Bool
    var reason: String?
    var deployId: String?
    var restores: String?
    var note: String?
    var createdAt: String?
}

struct ReleaseConfirmation: Codable, Hashable {
    var typed: String?
    var at: String?
    var by: String?
}

struct ReleaseOp: Codable, Identifiable, Hashable {
    var id: String
    var kind: String
    var project: String
    var projectName: String?
    var provider: String
    var actor: String?
    var createdAt: String
    var updatedAt: String?
    var state: String
    var stages: [ReleaseStage]
    var preview: ReleasePreview?
    var production: ReleaseProduction?
    var smoke: SmokeResult?
    var verify: SmokeResult?
    var rollback: ReleaseRollback?
    var confirmation: ReleaseConfirmation?
    var failure: String?
    var readyFor: String?
    var log: [String]?

    var isFinal: Bool { ["succeeded", "failed", "cancelled", "stale", "verify_failed", "interrupted"].contains(state) }
}

struct HostDeploy: Codable, Identifiable, Hashable {
    var id: String
    var state: String?
    var context: String?
    var url: String?
    var createdAt: String?
    var publishedAt: String?
    var title: String?
    var sha: String?
    var branch: String?
}

struct ReleaseSite: Codable, Hashable {
    var siteId: String?
    var liveUrl: String?
    var publishedDeployId: String?
    var publishedAt: String?
}

struct ReleaseStatus: Codable {
    var provider: String
    var capabilities: ReleaseCapabilities
    var current: ReleaseOp?
    var ops: [ReleaseOp]
    var deploys: [HostDeploy]
    var site: ReleaseSite?
    var lastProd: DeployRecord?
    var rollback: ReleaseRollback
}

// Self-update (engine `bid update check|download`) and support report (`bid report`)
struct UpdateInfo: Codable {
    var current: String
    var configured: Bool
    var available: Bool
    var mandatory: Bool?
    var channel: String?
    var latest: String?
    var url: String?
    var sha256: String?
    var notes: [String: String]?
    var publishedAt: String?
    var fromCache: Bool?
}

struct UpdateDownload: Codable {
    var path: String
    var version: String
}

struct ExportResult: Codable {
    var path: String
    var tables: [String]?
}

struct DeleteAccountResult: Codable {
    var deleted: Bool
}

struct ReportResult: Codable {
    var path: String
    var dir: String?
    var zip: String?
    var files: [String]
}

struct SetupAction: Codable, Hashable {
    var type: String
    var label: String
    var url: String?
    var display: String?
    var appAction: String?
}

struct SetupItem: Codable, Identifiable, Hashable {
    var group: String
    var id: String
    var title: String
    var ok: Bool
    var detail: String?
    var action: SetupAction?
    var optional: Bool
}

struct SetupStatus: Codable {
    var items: [SetupItem]
    var ready: Bool
    var missingRequired: Int
    var missingOptional: Int
}

struct SetupAutoResult: Codable {
    var installed: [String]
    var failed: [String]
    var commandFile: String?
    var status: SetupStatus
}

struct CommandFileResult: Codable {
    var commandFile: String
}

struct Uptime: Codable, Hashable {
    var ok: Bool
    var status: Int?
    var ms: Int?
    var error: String?
}

/// One monitored value with its provenance (V11): what it is, where it came from, when, and a state that
/// is never "healthy" without data (unchecked / stale / unsupported are their own states).
struct Signal: Codable, Hashable {
    var state: String        // healthy | problem | unchecked | stale | unsupported
    var value: String?
    var at: String?
    var source: String?
    var detail: String?
}

struct NextAction: Codable, Hashable {
    var id: String           // check | fix | release | connect-hosting | investigate | none
    var label: String
}

struct OverviewCard: Codable, Identifiable, Hashable {
    var key: String
    var name: String
    var path: String
    var exists: Bool
    var client: String?
    var hosting: String?
    var signals: [String: Signal]?
    var issues: IssueCounts?
    var nextAction: NextAction?
    var openIncidents: Int?
    var framework: String?
    var status: String?
    var checkedAt: String?
    var failing: [String]
    var liveUrl: String?
    var lastProd: String?
    var lastDraft: String?
    var changed: Int
    var branch: String?
    var ahead: Int?
    var behind: Int?
    var local: String?
    var uptime: Uptime?
    var sslDays: Int?
    var id: String { key }
}

struct AttentionItem: Codable, Identifiable, Hashable {
    var key: String
    var level: String
    var text: String
    var id: String { key + text }
}

struct OverviewTotals: Codable, Hashable {
    var projects: Int
    var ready: Int
    var warnings: Int
    var blocked: Int
    var online: Int
    var live: Int
}

struct Overview: Codable {
    var at: String
    var domains: SpaceshipStatus?
    var cards: [OverviewCard]
    var attention: [AttentionItem]
    var totals: OverviewTotals
}

struct CostAmount: Codable, Hashable {
    var service: String
    var unit: String
    var amount: Double
}

struct ProjectCost: Codable, Identifiable, Hashable {
    var name: String
    var items: [CostAmount]
    var id: String { name }
}

struct LedgerEntry: Codable, Identifiable, Hashable {
    var ts: String
    var project: String?
    var projectName: String?
    var service: String
    var op: String
    var amount: Double
    var unit: String
    var estimated: Bool?
    var ref: String?
    var id: String { ts + op + (project ?? "") }
}

struct PriceItem: Codable, Hashable {
    var unit: String
    var amount: Double
    var label: String
}

struct Prices: Codable {
    var items: [String: PriceItem]
}

struct Budgets: Codable {
    var netlifyMinCredits: Double?
    var warnAtPercent: Double?
}

struct Quota: Codable, Hashable {
    var name: String
    var included: Double?
    var used: Double?
    var remaining: Double?
    var value: Double?
    var unit: String?
}

struct ProviderAccount: Codable, Hashable {
    var name: String?
    var slug: String?
    var plan: String?
    var quotas: [Quota]?
    var credits: [Quota]?
    var dashboard: String?
}

struct ProviderUsage: Codable, Identifiable, Hashable {
    var service: String
    var connected: Bool?
    var error: String?
    var note: String?
    var dashboard: String?
    var accounts: [ProviderAccount]?
    var id: String { service }
}

struct UsageInfo: Codable {
    var at: String
    var providers: [ProviderUsage]
}

struct CostSummary: Codable {
    var month: String
    var totals: [CostAmount]
    var byProject: [ProjectCost]
    var counts: [String: Int]
    var ledger: [LedgerEntry]
    var prices: Prices
    var budgets: Budgets
    var usage: UsageInfo
    var pricesFile: String
}

// MARK: - Spaceship

struct SpaceshipDomain: Codable, Identifiable, Hashable {
    var name: String
    var unicodeName: String?
    var expirationDate: String?
    var daysLeft: Int?
    var autoRenew: Bool
    var status: String?
    var privacy: String?
    var dashboard: String?
    var id: String { name }
}

struct SpaceshipStatus: Codable {
    var connected: Bool
    var at: String?
    var domains: [SpaceshipDomain]
    var apiManager: String?
    var error: String?
}

struct DnsRecord: Codable, Identifiable, Hashable {
    var type: String
    var name: String
    var ttl: Int?
    var value: String
    var id: String { type + name + value }
}

struct DnsResult: Codable {
    var domain: String
    var records: [DnsRecord]
}

struct PlanRecord: Codable, Hashable {
    var type: String
    var name: String
    var value: String
}

struct DomainPlan: Codable {
    var domain: String
    var site: String
    var add: [PlanRecord]
    var replace: [PlanRecord]
    var note: String?
}

struct ConnectDomainResult: Codable {
    var applied: Bool
    var plan: DomainPlan
}

// MARK: - V9: account & hosting

struct AccountState: Codable {
    var configured: Bool?
    var loggedIn: Bool
    var id: String?
    var email: String?
    var name: String?
    var avatar: String?
    var provider: String?
    var confirmEmail: Bool?
    // V10: from the cloud profile (engine `account status`)
    var role: String?
    var plan: String?
    var locale: String?
    var aiDisabled: Bool?
    var credits: Credits?
    var profileStale: Bool?
    var hasOwnKey: Bool?
    var features: Features?
    /// OAuth providers enabled in the cloud project (engine: GET /auth/v1/settings) — present before login.
    var providers: [String]?
    /// Base URL of the error help pages (cloud `settings.help.url`); toasts link `<helpUrl>/<code>`.
    var helpUrl: String?
    /// Privacy / Terms / Refund pages and the support address (engine `publicLinks`).
    var links: Links?

    struct Links: Codable, Hashable {
        var privacy: String?
        var terms: String?
        var refund: String?
        var support: String?
        var help: String?
    }

    struct Credits: Codable, Hashable {
        var balance: Int
        /// Tokens the plan grants each month (nil on Free / vip / admin).
        var monthlyGrant: Int?
        var renewsAt: String?
        var endsAt: String?

        /// 0…1 for the credits ring; nil when there is no monthly grant to compare with.
        var fraction: Double? {
            guard let g = monthlyGrant, g > 0 else { return nil }
            return min(1, max(0, Double(balance) / Double(g)))
        }
    }

    /// Feature gates computed by engine/src/features.mjs — the app only renders them.
    struct Features: Codable, Hashable {
        var aiCloud = false
        var aiOwnKey = false
        var aiBuiltin = false
        var aiExternal = true
        var aiDeep = false
        var cloudSync = false
        var adminPanel = false
        var billingPlans = false
        var projectsMax: Int?

        enum CodingKeys: String, CodingKey {
            case aiCloud = "ai.cloud", aiOwnKey = "ai.ownKey", aiBuiltin = "ai.builtin", aiExternal = "ai.external", aiDeep = "ai.deep"
            case cloudSync = "cloud.sync", adminPanel = "admin.panel", billingPlans = "billing.plans", projectsMax = "projects.max"
        }
    }

    var isAdmin: Bool { features?.adminPanel == true }
    var canUseOwnKey: Bool { features?.aiOwnKey == true }
    /// Buttons the sign-in screen shows; V9 behaviour (GitHub) when the engine did not report a list.
    var oauthProviders: [String] { providers ?? ["github"] }
}

struct AIKeyStatus: Codable, Identifiable, Hashable {
    var provider: String
    var name: String
    var connected: Bool
    var hint: String?
    var savedAt: String?
    var console: String?
    var id: String { provider }
}

struct AdminUser: Codable, Identifiable, Hashable {
    var userId: String
    var email: String
    var displayName: String?
    var locale: String?
    var role: String
    var plan: String
    var aiDisabled: Bool?
    var createdAt: String?
    var balance: Int?
    var lastAiAt: String?
    var id: String { userId }

    enum CodingKeys: String, CodingKey {
        case userId = "user_id", email, displayName = "display_name", locale, role, plan
        case aiDisabled = "ai_disabled", createdAt = "created_at", balance, lastAiAt = "last_ai_at"
    }
}

struct AdminUsage: Codable, Identifiable, Hashable {
    var id: String
    var createdAt: String
    var step: String?
    var model: String?
    var inputTokens: Int?
    var outputTokens: Int?
    var chargedTokens: Int?
    var status: String?
    var projectKey: String?

    enum CodingKeys: String, CodingKey {
        case id, createdAt = "created_at", step, model, inputTokens = "input_tokens", outputTokens = "output_tokens"
        case chargedTokens = "charged_tokens", status, projectKey = "project_key"
    }
}

struct AdminUsageResult: Codable { var usage: [AdminUsage] }

struct AdminUsersResult: Codable { var users: [AdminUser] }
struct AdminUserResult: Codable { var user: AdminUser }
struct AdminGrantResult: Codable { var balance: Int }

struct AdminAuditEntry: Codable, Identifiable, Hashable {
    var id: Int
    var adminId: String?
    var action: String
    var target: String?
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, adminId = "admin_id", action, target, createdAt = "created_at"
    }
}
struct AdminAuditResult: Codable { var entries: [AdminAuditEntry] }

struct OAuthStart: Codable {
    var url: String
}

struct HostingOption: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var compatible: Bool
    var current: Bool
    var installed: Bool
    var loggedIn: Bool
    var linked: Bool
    var free: String
    var note: String
    var pricing: String
    var preview: Bool
    var reasons: [String]
    var recommended: Bool?
}

struct HostingAdvice: Codable {
    var framework: String?
    var ssr: Bool
    var functions: Bool
    var current: String
    var providers: [HostingOption]
}

// MARK: - Billing (V10 WP4) — engine `bid billing …`

struct BillingCatalog: Codable, Hashable {
    struct Plan: Codable, Hashable, Identifiable {
        var id: String
        var price: Double?
        var tokens: Int
        var available: Bool
        var yearlyPrice: Double?
        var yearlyAvailable: Bool?
    }
    struct Pack: Codable, Hashable, Identifiable {
        var id: String
        var tokens: Int
        var price: Double?
        var available: Bool
    }
    struct Trial: Codable, Hashable {
        var days: Int
        var plan: String
        var tokens: Int
    }
    var currency: String
    var plans: [Plan]
    var packs: [Pack]
    var trial: Trial?
}

struct BillingStatus: Codable, Hashable {
    struct Subscription: Codable, Hashable {
        var provider: String
        var tier: String
        var status: String
        var interval: String?
        var renewsAt: String?
        var endsAt: String?
        var manageable: Bool
    }
    struct Balance: Codable, Hashable {
        var plan: Int
        var topup: Int
        var total: Int
    }
    struct Usage: Codable, Hashable, Identifiable {
        var at: String
        var step: String?
        var model: String?
        var tokens: Int
        var project: String?
        var id: String { at + (step ?? "") }
    }
    var plan: String
    var subscription: Subscription?
    var balance: Balance
    var trialAvailable: Bool
    var usage: [Usage]
}

struct BillingURL: Codable, Hashable {
    var url: String
}


// MARK: - Monitoring (V11)

struct MonitorNotify: Codable, Hashable {
    var down = true
    var ssl = true
    var domain = true
    var recovered = true
}

struct MonitorSettings: Codable, Hashable {
    var intervalMin: Int
    var timeoutMs: Int?
    var confirmFailures: Int?
    var notify: MonitorNotify
}

struct MonitorAgent: Codable, Hashable {
    var installed: Bool
    var plist: String?
    var label: String?
    var note: String?
}

struct Incident: Codable, Identifiable, Hashable {
    var id: String
    var project: String
    var projectName: String?
    var kind: String       // down | ssl | domain
    var severity: String   // critical | warning
    var status: String     // open | resolved
    var openedAt: String
    var lastSeenAt: String?
    var resolvedAt: String?
    var count: Int?
    var detail: String?
    var url: String?
}

struct MonitorStatus: Codable {
    var runsOn: String
    var serverSide: Bool
    var settings: MonitorSettings
    var agent: MonitorAgent
    var lastRunAt: String?
    var lastRunBy: String?
    var stale: Bool
    var openIncidents: [Incident]
    var recentIncidents: [Incident]
}

struct MonitorRun: Codable {
    var at: String
    var checked: Int
    var quiet: Bool?
}

struct BackupStatus: Codable, Hashable {
    var provider: String
    var name: String
    var connected: Bool
    var state: String
    var reason: String?
    var missing: [String]?
    var lastBackupAt: String?
    var at: String?
}
