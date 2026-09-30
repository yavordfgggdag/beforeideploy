import XCTest
@testable import BeforeIDeploy

/// Every fixture is a real engine result; if a model stops matching the engine's JSON, this is where it shows.
final class ModelsTests: XCTestCase {
    func testStatusSnapshot() throws {
        let s = try Fixtures.decode("status", as: ProjectStatus.self)
        XCTAssertFalse(s.project.key.isEmpty)
        XCTAssertNotNil(s.check)
        XCTAssertNotNil(s.hosting)
    }

    func testCheckStateWithCachedSteps() throws {
        let c = try Fixtures.decode("check", as: CheckState.self)
        XCTAssertEqual(c.status, "ready")
        XCTAssertEqual(c.steps.count, 7)
        XCTAssertTrue(c.steps.contains { $0.id == "build" })
        // `cached` is optional: absent on a full run, true when reused
        XCTAssertNoThrow(c.steps.map { $0.cached ?? false })
    }

    func testAccountStateCarriesRolePlanAndGates() throws {
        let a = try Fixtures.decode("account-status", as: AccountState.self)
        XCTAssertTrue(a.loggedIn)
        XCTAssertEqual(a.role, "admin")
        XCTAssertEqual(a.plan, "free")
        XCTAssertNotNil(a.credits)
        let f = try XCTUnwrap(a.features)
        XCTAssertTrue(f.adminPanel)
        XCTAssertTrue(f.aiOwnKey)
        XCTAssertTrue(f.cloudSync)
        XCTAssertFalse(f.aiCloud)
        XCTAssertNil(f.projectsMax) // unlimited for admin
        XCTAssertTrue(a.isAdmin)
    }

    func testCreditsCarryTheMonthlyGrantAndRenewal() throws {
        let a = try Fixtures.decode("account-status-high", as: AccountState.self)
        let c = try XCTUnwrap(a.credits)
        XCTAssertEqual(c.monthlyGrant, 250_000)
        XCTAssertEqual(c.renewsAt, "2026-11-01T00:00:00Z")
        XCTAssertEqual(c.fraction ?? -1, 1.0, accuracy: 0.0001)
        XCTAssertNil(AccountState.Credits(balance: 5, monthlyGrant: nil).fraction)
    }

    func testAnonymousAccountStateCarriesTheEnabledProviders() throws {
        let a = try Fixtures.decode("account-status-anon", as: AccountState.self)
        XCTAssertFalse(a.loggedIn)
        XCTAssertEqual(a.configured, true)
        XCTAssertEqual(a.providers, ["github"])
        XCTAssertEqual(a.oauthProviders, ["github"])
        // an engine without the list (V9 shape) keeps the GitHub button
        let legacy = try JSONDecoder().decode(AccountState.self, from: Data(#"{"configured":true,"loggedIn":false}"#.utf8))
        XCTAssertNil(legacy.providers)
        XCTAssertEqual(legacy.oauthProviders, ["github"])
    }

    func testLaunchChecklistAndNewSiteDecode() throws {
        let l = try Fixtures.decode("launch-status", as: LaunchStatus.self)
        XCTAssertEqual(l.steps.map(\.id), ["project", "check", "site", "hosting", "deploy", "domain", "monitor"])
        XCTAssertEqual(l.next, "hosting")
        XCTAssertFalse(l.complete)
        XCTAssertEqual(l.requiredTotal, 5)
        XCTAssertTrue(l.steps.filter(\.optional).map(\.id).contains("domain"))
        XCTAssertEqual(l.steps.first { $0.id == "hosting" }?.action, "hosting")
        let n = try Fixtures.decode("new-site", as: NewSiteResult.self)
        XCTAssertEqual(n.template, "landing")
        XCTAssertTrue(n.git)
        XCTAssertTrue(n.files.contains("robots.txt") && n.files.contains("404.html"))
        let s = try Fixtures.decode("site-step", as: StepResult.self)
        XCTAssertEqual(s.id, "site")
        XCTAssertEqual(s.status, "fail")
        // status carries the launch list, so the project screen needs no extra call; an older engine leaves it nil
        let legacy = try JSONDecoder().decode(LaunchStatus.self, from: Data(#"{"steps":[],"done":0,"total":0,"requiredDone":0,"requiredTotal":0,"next":null,"complete":false}"#.utf8))
        XCTAssertNil(legacy.next)
    }

    func testCloudDoctorDecodesTheOwnerSetupState() throws {
        let d = try Fixtures.decode("cloud-doctor", as: CloudDoctorResult.self)
        XCTAssertTrue(d.configured)
        XCTAssertTrue(d.reachable)
        XCTAssertEqual(d.schemaApplied, true)
        XCTAssertEqual(d.functionsMissing, [])
        XCTAssertEqual(d.auth?.emailConfirmRequired, true)
        XCTAssertEqual(d.auth?.providers, ["github", "email"])
        // an unreachable project keeps the shape the sign-in screen renders
        let off = try JSONDecoder().decode(CloudDoctorResult.self, from: Data(#"{"configured":true,"url":"https://x.supabase.co","reachable":false,"error":"timeout","functionsMissing":[]}"#.utf8))
        XCTAssertFalse(off.reachable)
        XCTAssertNil(off.auth)
        // a signed-in account against a project without the schema says so
        let a = try JSONDecoder().decode(AccountState.self, from: Data(#"{"configured":true,"loggedIn":true,"plan":"free","schemaMissing":true}"#.utf8))
        XCTAssertEqual(a.schemaMissing, true)
    }

    func testFeaturesDecodeDottedKeys() throws {
        let json = #"{"ai.cloud":true,"ai.ownKey":false,"ai.builtin":true,"ai.external":true,"ai.deep":false,"cloud.sync":true,"admin.panel":false,"billing.plans":true,"projects.max":5}"#
        let f = try JSONDecoder().decode(AccountState.Features.self, from: Data(json.utf8))
        XCTAssertTrue(f.aiCloud)
        XCTAssertEqual(f.projectsMax, 5)
        XCTAssertTrue(f.billingPlans)
    }

    func testSetupStatus() throws {
        let s = try Fixtures.decode("setup-status", as: SetupStatus.self)
        XCTAssertFalse(s.items.isEmpty)
        XCTAssertTrue(s.items.contains { $0.id == "node" })
    }

    func testOverview() throws {
        let o = try Fixtures.decode("overview", as: Overview.self)
        XCTAssertFalse(o.cards.isEmpty)
    }

    func testCosts() throws {
        let c = try Fixtures.decode("costs", as: CostSummary.self)
        XCTAssertFalse(c.prices.items.isEmpty)
    }

    func testHostingAdvice() throws {
        let h = try Fixtures.decode("hosting-advise", as: HostingAdvice.self)
        XCTAssertEqual(h.providers.count, 4)
        XCTAssertTrue(h.providers.contains { $0.recommended == true })
    }

    func testSpaceshipStatus() throws {
        let s = try Fixtures.decode("spaceship-status", as: SpaceshipStatus.self)
        XCTAssertTrue(s.connected)
        XCTAssertEqual(s.domains.first?.name, "moyat-sait.bg")
    }

    func testAIFixOutcome() throws {
        let r = try Fixtures.decode("ai-fix", as: AIFixOutcome.self)
        XCTAssertEqual(r.mode, "fix")
        let files = try XCTUnwrap(r.files)
        XCTAssertTrue(files.contains { $0.path == "src/app.js" && $0.applicable })
        XCTAssertTrue(files.contains { $0.error == "outside_project" })
        XCTAssertEqual(r.usage?.input, 4500)
    }

    func testDoctor() throws {
        let d = try Fixtures.decode("doctor", as: DoctorInfo.self)
        XCTAssertFalse(d.engine.isEmpty)
        XCTAssertFalse(d.node.version.isEmpty)
    }

    func testHistory() throws {
        let h = try Fixtures.decode("history", as: [HistoryEntry].self)
        XCTAssertFalse(h.isEmpty)
        XCTAssertTrue(h.contains { $0.kind == "check" })
    }

    func testUpdateInfo() throws {
        let u = try Fixtures.decode("update-check", as: UpdateInfo.self)
        XCTAssertTrue(u.configured)
        XCTAssertTrue(u.available)
        XCTAssertEqual(u.latest, "11.1.0")
        XCTAssertEqual(u.notes?["bg"], "Поправки")
    }

    func testAdminUsers() throws {
        let r = try Fixtures.decode("admin-users", as: AdminUsersResult.self)
        XCTAssertFalse(r.users.isEmpty)
        XCTAssertTrue(r.users.contains { $0.role == "admin" })
    }

    func testBillingCatalog() throws {
        let c = try Fixtures.decode("billing-catalog", as: BillingCatalog.self)
        XCTAssertEqual(c.currency, "EUR")
        XCTAssertEqual(c.plans.map(\.id), ["flash", "high", "knight"])
        XCTAssertEqual(c.plans.first { $0.id == "high" }?.tokens, 250_000)
        XCTAssertFalse(c.plans.first { $0.id == "knight" }?.available ?? true)
        XCTAssertEqual(c.trial?.days, 7)
        XCTAssertEqual(c.plans.first { $0.id == "high" }?.yearlyPrice, 299.9)
        XCTAssertEqual(c.plans.first { $0.id == "high" }?.yearlyAvailable, true)
    }

    func testUsageReportCarriesTheSessionAndPerModelBreakdown() throws {
        let u = try Fixtures.decode("usage-report", as: UsageReport.self)
        XCTAssertEqual(u.unit, "credits")
        XCTAssertNotNil(u.byModel)
        XCTAssertNil(u.limits.sessionCap) // Free has no session
        // a High report: the 5-hour session with its cap, what was used and when it resets
        let high = try JSONDecoder().decode(UsageReport.Session.self, from: Data(#"{"windowHours":5,"capPercent":20,"cap":50000,"used":1472,"remaining":48528,"resetsAt":"2026-10-09T15:00:00Z"}"#.utf8))
        XCTAssertEqual(high.remaining, 48_528)
        XCTAssertEqual(high.resetsAt, "2026-10-09T15:00:00Z")
        // an older engine without the session fields still decodes
        let legacy = try JSONDecoder().decode(UsageReport.Limits.self, from: Data(#"{"perMinute":6,"perHour":60}"#.utf8))
        XCTAssertNil(legacy.sessionCap)
    }

    func testBillingStatusAfterTrial() throws {
        let s = try Fixtures.decode("billing-status", as: BillingStatus.self)
        XCTAssertEqual(s.plan, "high")
        XCTAssertEqual(s.subscription?.provider, "trial")
        XCTAssertEqual(s.balance.plan, 50_000)
        XCTAssertFalse(s.trialAvailable)
        XCTAssertEqual(s.usage.first?.tokens, 6000)
    }

    func testBillingMoneyFormatUsesTheCurrency() {
        let s = BillingFormat.money(9.99, currency: "EUR")
        XCTAssertTrue(s.contains("9"), s)
        XCTAssertTrue(s.contains("€") || s.contains("EUR"), s)
        XCTAssertEqual(BillingFormat.money(nil, currency: "EUR"), "—")
    }

    func testAdminUsage() throws {
        let r = try Fixtures.decode("admin-usage", as: AdminUsageResult.self)
        XCTAssertEqual(r.usage.first?.chargedTokens, 6000)
        XCTAssertEqual(r.usage.first?.step, "build")
    }

    @MainActor
    func testAdminSettingsPrettyPrinting() {
        XCTAssertEqual(AdminStore.pretty(15), "15")
        XCTAssertEqual(AdminStore.pretty("https://x"), "\"https://x\"")
        XCTAssertTrue(AdminStore.pretty(["b": 1, "a": 2]).hasPrefix("{"))
    }

    func testAIKeys() throws {
        let k = try Fixtures.decode("ai-keys", as: [AIKeyStatus].self)
        XCTAssertEqual(k.map(\.provider).sorted(), ["anthropic", "openai"])
    }

    // MARK: V11

    func testIssuesAreSortedBlockersFirstAndCarryEvidenceAndFix() throws {
        let l = try Fixtures.decode("issues", as: IssueList.self)
        XCTAssertFalse(l.issues.isEmpty)
        XCTAssertEqual(l.issues.first?.severity, "blocker")
        XCTAssertEqual(l.issues.first?.blocksRelease, true)
        XCTAssertTrue(l.issues.allSatisfy { ["defect", "recommendation", "signal"].contains($0.kind) })
        XCTAssertTrue(l.issues.allSatisfy { ["confirmed", "likely", "heuristic"].contains($0.confidence) })
        XCTAssertGreaterThan(l.counts.blocker, 0)
        XCTAssertTrue(l.issues.contains { $0.fix != nil && $0.verify != nil })
    }

    func testReleasePreviewWaitsForConfirmation() throws {
        let op = try Fixtures.decode("release-preview", as: ReleaseOp.self)
        XCTAssertEqual(op.state, "awaiting_confirmation")
        XCTAssertEqual(op.readyFor, "production")
        XCTAssertFalse(op.isFinal)
        XCTAssertEqual(op.stages.map(\.id).prefix(3), ["check", "preview", "smoke"])
        XCTAssertNotNil(op.preview?.url)
        XCTAssertEqual(op.smoke?.ok, true)
    }

    func testReleasePromotePublishesTheSmokeTestedDeploy() throws {
        let op = try Fixtures.decode("release-promote", as: ReleaseOp.self)
        XCTAssertEqual(op.state, "succeeded")
        XCTAssertTrue(op.isFinal)
        XCTAssertEqual(op.production?.deployId, op.preview?.deployId)
        XCTAssertEqual(op.confirmation?.typed, "DEPLOY")
        XCTAssertEqual(op.verify?.ok, true)
    }

    func testReleaseStatusCarriesCapabilitiesDeploysAndRollbackTarget() throws {
        let s = try Fixtures.decode("release-status", as: ReleaseStatus.self)
        XCTAssertEqual(s.provider, "netlify")
        XCTAssertTrue(s.capabilities.rollback)
        XCTAssertGreaterThanOrEqual(s.deploys.count, 4)
        XCTAssertTrue(s.rollback.available)
        XCTAssertEqual(s.rollback.restores, "files")
        XCTAssertNotNil(s.site?.publishedDeployId)
    }

    func testMonitorStatusSaysWhereItRunsAndKeepsIncidents() throws {
        let m = try Fixtures.decode("monitor-status", as: MonitorStatus.self)
        XCTAssertEqual(m.runsOn, "mac")
        XCTAssertFalse(m.serverSide)
        XCTAssertEqual(m.openIncidents.count, 1)
        XCTAssertEqual(m.openIncidents.first?.kind, "down")
        XCTAssertEqual(m.openIncidents.first?.count, 2)
        XCTAssertGreaterThanOrEqual(m.settings.intervalMin, 5)
    }

    func testBackupStatusIsHonestlyNotConnected() throws {
        let b = try Fixtures.decode("backup-status", as: BackupStatus.self)
        XCTAssertEqual(b.provider, "codeguard")
        XCTAssertFalse(b.connected)
        XCTAssertEqual(b.state, "unsupported")
        XCTAssertNil(b.lastBackupAt)
        XCTAssertFalse(b.missing?.isEmpty ?? true)
    }

    func testOverviewCardsCarrySignalsWithProvenanceAndANextAction() throws {
        let o = try Fixtures.decode("overview", as: Overview.self)
        let card = try XCTUnwrap(o.cards.first { $0.signals != nil })
        let signals = try XCTUnwrap(card.signals)
        XCTAssertTrue(signals.values.allSatisfy { ["healthy", "problem", "unchecked", "stale", "unsupported"].contains($0.state) })
        // never green without data: a healthy signal always says when and from where
        XCTAssertTrue(signals.values.filter { $0.state == "healthy" }.allSatisfy { $0.at != nil && $0.source != nil })
        XCTAssertNotNil(card.nextAction)
    }

    func testStatusSnapshotCarriesIssuesReleaseAndBackup() throws {
        let s = try Fixtures.decode("status", as: ProjectStatus.self)
        XCTAssertNotNil(s.issues)
        XCTAssertNotNil(s.release?.capabilities)
        XCTAssertEqual(s.backup?.connected, false)
    }
}
