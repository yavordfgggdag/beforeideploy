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
    /// V11.1: where the site is on the way from a folder to a live, watched site.
    var launch: LaunchStatus?
}

/// `bid launch` — the checklist the project screen opens with until every required step is done.
struct LaunchStatus: Codable, Hashable {
    struct Step: Codable, Hashable, Identifiable {
        var id: String
        var status: String      // done | attention | todo | waiting
        var optional: Bool
        var title: String
        var hint: String
        var action: String?     // check | fix | hosting | deploy | release | domain | monitor
    }
    var steps: [Step]
    var done: Int
    var total: Int
    var requiredDone: Int
    var requiredTotal: Int
    var next: String?
    var complete: Bool
}

/// `bid new list` — a template the engine ships.
struct SiteTemplate: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var description: String
    var pages: Int
    /// Picker grouping and look (V11.1 template gallery); optional so an older engine still decodes.
    var category: String?
    var categoryTitle: String?
    var icon: String?
    var accent: String?
}

/// `bid new create` — the site that was just created.
struct NewSiteResult: Codable {
    var project: Project
    var path: String
    var template: String
    var lang: String
    var git: Bool
    var files: [String]
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
    struct NodeInfo: Codable { var path: String; var version: String; var runtime: String? }
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
    /// Path class from the engine's policy: source | config | secret | blocked (WP01).
    var cls: String?
    /// A config change (scripts, build/hosting config, lockfile): applied only with its own explicit tick.
    var needsApproval: Bool?
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

/// `bid cloud doctor`: what the bundled Supabase project can do right now (owner setup state).
struct CloudDoctorResult: Codable {
    var configured: Bool
    var url: String?
    var ref: String?
    var reachable: Bool
    var error: String?
    var auth: Auth?
    var schemaApplied: Bool?
    var tablesMissing: [String]?
    var functionsMissing: [String]?
    var dashboard: Dashboard?
    var checkedAt: String?

    struct Auth: Codable {
        var signupEnabled: Bool?
        var emailConfirmRequired: Bool?
        var providers: [String]?
    }

    struct Dashboard: Codable {
        var project: String?
        var sql: String?
        var functions: String?
        var auth: String?
        var api: String?
    }
}

/// `bid cloud schema`: the bundled supabase/schema.sql.
struct CloudSchema: Codable {
    var sql: String?
    var file: String?
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
    /// Readable name from the engine (Netlify's field paths are never shown raw).
    var label: String?
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
    /// Sign-in succeeded but `profiles` does not exist: supabase/schema.sql was never applied (owner's job).
    var schemaMissing: Bool?
    var hasOwnKey: Bool?
    var features: Features?
    /// OAuth providers enabled in the cloud project (engine: GET /auth/v1/settings) — present before login.
    var providers: [String]?
    /// Base URL of the error help pages (cloud `settings.help.url`); toasts link `<helpUrl>/<code>`.
    var helpUrl: String?
    /// Privacy / Terms / Refund pages and the support address (engine `publicLinks`).
    var links: Links?

    var settings: [String: JSONValue]?

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
    var source: String?     // mac | cloud
    var alsoCloud: Bool?
}

struct MonitorStatus: Codable {
    var runsOn: String          // mac | cloud | both
    var serverSide: Bool
    var cloud: CloudMonitor?    // nil: not asked (offline view); unavailable: signed out / no network
    var maintenance: [MaintenanceWindow]?
    var channels: MonitorChannels?
    var settings: MonitorSettings
    var agent: MonitorAgent
    var lastRunAt: String?
    var lastRunBy: String?
    var stale: Bool
    var openIncidents: [Incident]
    var recentIncidents: [Incident]
}

struct CloudMonitor: Codable, Hashable {
    struct Scheduler: Codable, Hashable { var lastRunAt: String?; var healthy: Bool; var state: String; var checked: Int? }
    struct Target: Codable, Identifiable, Hashable {
        var projectKey: String
        var projectName: String?
        var url: String
        var enabled: Bool
        var intervalMin: Int
        var lastRunAt: String?
        var nextRunAt: String?
        var lastOk: Bool?
        var lastStatus: Int?
        var failures: Int?
        var id: String { projectKey }
    }
    var unavailable: Bool?
    var reason: String?
    var active: Bool?
    var scheduler: Scheduler?
    var targets: [Target]?
    var retentionDays: Int?
    var nextRunAt: String?
}

struct MaintenanceWindow: Codable, Identifiable, Hashable {
    var from: String
    var to: String
    var project: String?
    var note: String?
    var id: String { from + to + (project ?? "") }
}

struct MonitorChannels: Codable, Hashable {
    var webhook: String?
    var pushover: PushoverChannel?
}

/// Pushover (phone push notifications): the keys live in the Keychain; status carries only a masked user key.
struct PushoverChannel: Codable, Hashable {
    var connected: Bool
    var user: String?
    var savedAt: String?
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

// MARK: - Embedded assistant (V11 RC)

/// A free-form JSON value: the assistant's validated structured output is rendered generically.
indirect enum JSONValue: Codable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else if let o = try? c.decode([String: JSONValue].self) { self = .object(o) }
        else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "unsupported JSON") }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .null: try c.encodeNil()
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    var string: String? { if case .string(let s) = self { return s } else { return nil } }
    var array: [JSONValue]? { if case .array(let a) = self { return a } else { return nil } }
    var object: [String: JSONValue]? { if case .object(let o) = self { return o } else { return nil } }
    subscript(_ key: String) -> JSONValue? { object?[key] }
    var strings: [String] { array?.compactMap(\.string) ?? [] }
    /// Short human text for any value (used for list items that are objects).
    var text: String {
        switch self {
        case .string(let s): return s
        case .number(let n): return n == n.rounded() ? String(Int(n)) : String(n)
        case .bool(let b): return b ? "true" : "false"
        case .null: return "—"
        case .array(let a): return a.map(\.text).joined(separator: ", ")
        case .object(let o): return o.keys.sorted().compactMap { k in o[k].map { "\(k): \($0.text)" } }.joined(separator: " · ")
        }
    }
}

struct AssistantEvidence: Codable, Identifiable, Hashable {
    var id: String
    var kind: String       // issue | log | file | git | diff | incident
    var label: String
    var chars: Int
    var redactions: Int
}

struct AssistantBudget: Codable, Hashable {
    var limit: Int
    var used: Int
    var calls: Int?
}

struct AssistantApplied: Codable, Hashable {
    var applied: [String]
    var skipped: [AISkipped]?
    var undoFile: String?
}

struct AssistantResult: Codable, Hashable {
    var conversation: String
    var action: String
    var provider: String
    var model: String?
    var template: String?
    var output: JSONValue?
    var valid: Bool
    var errors: [String]?
    var repairs: Int?
    var usage: AIUsage?
    var stopped: String?     // nil = finished; invalid_output | needs_input | no_change | stale_base_hash | needs_confirmation | not_applicable | no_progress | regression | max_iterations | budget
    var budget: AssistantBudget?
    var duration: Double?
    var patchFile: String?
    var files: [AIPatchFile]?
    var risk: String?
    var verificationPlan: [String]?
    var rollbackNotes: String?
    var iterations: Int?
    var applied: AssistantApplied?
    var recheck: AIRecheck?
    var verified: Bool?
    var undone: Bool?
    var evidence: [AssistantEvidence]?
    var engineStatus: String?
    var historyId: String?
    var discarded: Bool?
}

struct AssistantHistoryEntry: Codable, Identifiable, Hashable {
    var at: String
    var conversation: String?
    var action: String
    var message: String?
    var template: String?
    var valid: Bool?
    var stopped: String?
    var summary: String?
    var patchFile: String?
    var duration: Double?
    var historyId: String?
    var id: String { historyId ?? (at + action) }
    var result: AssistantResult?
    var request: AssistantStore.Request?
    var usage: AIUsage?
    var provider: String?
    var error: String?
    var code: String?

}

struct AssistantHistory: Codable {
    var project: String
    var conversation: String?
    var entries: [AssistantHistoryEntry]
    var hasMore: Bool?
}

struct AssistantSettings: Codable, Hashable {
    var autoApplyLowRisk: Bool
    var maxIterations: Int
    var maxTokensPerOperation: Int
    var maxContextChars: Int?
    var maxFileChars: Int?
    var maxFiles: Int?
    var callTimeoutMs: Int?
}

struct PromptInfo: Codable, Identifiable, Hashable {
    var id: String
    var version: Int
    var kind: String
    var purpose: String
    var title: [String: [String: String]]?
    var inputs: [String]
    var outputs: [String]
}

// MARK: - Plan & usage (V11 RC): server-authoritative, all in tokens

struct UsageReport: Codable {
    struct Period: Codable, Hashable { var start: String; var end: String; var renewsAt: String?; var source: String }
    struct Tokens: Codable, Hashable { var tokens: Int; var operations: Int? }
    struct Remaining: Codable, Hashable { var plan: Int; var purchased: Int; var total: Int; var available: Int }
    struct Purchased: Codable, Hashable { var tokens: Int; var expires: String? }
    struct Limits: Codable, Hashable { var perMinute: Int; var perHour: Int; var sessionHours: Int?; var sessionCapPercent: Int?; var sessionCap: Int?; var sessionUsed: Int? }
    /// The rolling session (as in Claude): a share of the monthly credits per N hours, with the time it resets.
    struct Session: Codable, Hashable { var windowHours: Int; var capPercent: Int; var cap: Int; var used: Int; var remaining: Int; var resetsAt: String? }
    struct ModelUsage: Codable, Hashable, Identifiable { var model: String; var tokens: Int; var operations: Int; var id: String { model } }
    struct Pricing: Codable, Hashable { var version: String; var spendOrder: [String]? }
    struct Reconciled: Codable, Hashable { var releasedHolds: Int }
    struct Operation: Codable, Identifiable, Hashable {
        var id: String
        var at: String
        var step: String?
        var project: String?
        var model: String?
        var status: String?
        var tokens: Int
        var input: Int?
        var output: Int?
        var pricingVersion: String?
        var operationId: String?
    }
    struct LedgerRow: Codable, Identifiable, Hashable {
        var id: JSONValue
        var at: String
        var delta: Int
        var bucket: String
        var reason: String
        var ref: String?
        var pricingVersion: String?
    }
    struct History: Codable { var operations: [Operation]; var ledger: [LedgerRow] }

    var serverTime: String
    var unit: String
    var plan: String
    var subscription: BillingStatus.Subscription?
    var trialAvailable: Bool?
    var period: Period
    var included: Tokens
    var used: Tokens
    var reserved: Tokens
    var remaining: Remaining
    var purchased: Purchased
    var session: Session?
    var byModel: [ModelUsage]?
    var limits: Limits
    var pricing: Pricing
    var reconciled: Reconciled?
    var history: History
}

struct BillingSync: Codable {
    var synced: [String]
    var status: BillingStatus
}

/// `bid admin diagnostics` (WP03): what the owner still has to configure in the cloud — yes/no only.
struct AdminDiagnostics: Codable, Hashable {
    struct Scheduler: Codable, Hashable {
        var lastRunAt: String?
        var ageMinutes: Int?
        var state: String      // ok | stale | never
    }
    var secrets: [String: Bool]
    var scheduler: Scheduler
    var missingPrices: [String]
    var links: [String: Bool]
    var functions: [String: Bool]
    var todo: [String]
    var ready: Bool
}
