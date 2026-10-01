import XCTest
@testable import BeforeIDeploy

final class BillingTests: XCTestCase {
    func testV12CatalogKeepsPricesWhenSalesAreDisabled() throws {
        let c = try Fixtures.decode("billing-v12-catalog", as: BillingCatalog.self)
        XCTAssertEqual(c.source, "demo")
        XCTAssertEqual(c.plans.map(\.tokens), [100_000,300_000,1_000_000])
        XCTAssertEqual(c.plans.map(\.activeSites), [1,3,10])
        XCTAssertEqual(c.plans.map(\.validityMonths), [1,3,10])
        XCTAssertEqual(c.packs.map(\.price), [4.99,19.99,39.99])
        XCTAssertTrue(c.plans.allSatisfy { !$0.available && $0.price != nil })
    }
    func testV12UsageDecodesOptionalWindowsAndBreakdowns() throws {
        let u = try Fixtures.decode("usage-v12-demo", as: UsageReport.self)
        XCTAssertEqual(u.v, 2)
        XCTAssertEqual(u.source, "demo")
        XCTAssertEqual(u.weekly?.cap, 120_000)
        XCTAssertEqual(u.sites?.limit, 3)
        XCTAssertEqual(u.sites?.items?.count, 2)
        XCTAssertEqual(u.period.forecastDaysLeft, 9)
        XCTAssertEqual(u.remaining.available, 329_000)
        XCTAssertEqual(u.daily?.reduce(0) { $0+$1.credits }, u.used.tokens)
        XCTAssertEqual(u.byAction?.reduce(0) { $0+$1.credits }, u.used.tokens)
        let old = try Fixtures.decode("usage-report", as: UsageReport.self)
        XCTAssertNil(old.weekly)
        XCTAssertNil(old.v)
    }
    func testFractionalWindowSettingsRemainDecodable() throws {
        let value = try JSONDecoder().decode(UsageReport.Session.self, from: Data(#"{"windowHours":2.5,"capPercent":12.5,"cap":37500,"used":10,"remaining":37490}"#.utf8))
        XCTAssertEqual(value.windowHours, 2.5)
        XCTAssertEqual(value.capPercent, 12.5)
    }
    @MainActor func testLogoutResetsBillingAndIdentitySwitchCannotReuseUsage() throws {
        let store = BillingStore(engine: EngineClient())
        var a = AccountState(loggedIn: true); a.id = "a"
        store.sessionChanged(a)
        store.usage = try Fixtures.decode("usage-v12-demo", as: UsageReport.self)
        var b = AccountState(loggedIn: true); b.id = "b"
        store.sessionChanged(b)
        XCTAssertNil(store.usage)
        XCTAssertTrue(store.canReadUsage)
        store.reset()
        XCTAssertFalse(store.canReadUsage)
        XCTAssertNil(store.catalog)
        XCTAssertNil(store.status)
        XCTAssertNil(store.busy)
        XCTAssertFalse(store.waitingForPayment)
    }
}
