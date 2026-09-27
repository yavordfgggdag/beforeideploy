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

struct OverviewCard: Codable, Identifiable, Hashable {
    var key: String
    var name: String
    var path: String
    var exists: Bool
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
}

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
