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
        XCTAssertEqual(u.latest, "10.1.0")
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
        XCTAssertEqual(c.plans.first { $0.id == "high" }?.tokens, 1_000_000)
        XCTAssertFalse(c.plans.first { $0.id == "knight" }?.available ?? true)
        XCTAssertEqual(c.trial?.days, 7)
    }

    func testBillingStatusAfterTrial() throws {
        let s = try Fixtures.decode("billing-status", as: BillingStatus.self)
        XCTAssertEqual(s.plan, "high")
        XCTAssertEqual(s.subscription?.provider, "trial")
        XCTAssertEqual(s.balance.plan, 150_000)
        XCTAssertFalse(s.trialAvailable)
        XCTAssertEqual(s.usage.first?.tokens, 6000)
    }

    func testBillingMoneyFormatUsesTheCurrency() {
        let s = BillingFormat.money(9.99, currency: "EUR")
        XCTAssertTrue(s.contains("9"), s)
        XCTAssertTrue(s.contains("€") || s.contains("EUR"), s)
        XCTAssertEqual(BillingFormat.money(nil, currency: "EUR"), "—")
    }

    func testAIKeys() throws {
        let k = try Fixtures.decode("ai-keys", as: [AIKeyStatus].self)
        XCTAssertEqual(k.map(\.provider).sorted(), ["anthropic", "openai"])
    }
}
