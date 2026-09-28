import XCTest
@testable import BeforeIDeploy

final class EngineOutcomeTests: XCTestCase {
    func testOkResultDecodes() throws {
        let line = try Fixtures.resultLine("doctor")
        let outcome = EngineOutcome(exitCode: 0, resultData: line, stderr: "")
        XCTAssertTrue(outcome.ok)
        XCTAssertNil(outcome.errorMessage)
        XCTAssertNil(outcome.errorCode)
        let d = try outcome.decode(DoctorInfo.self)
        XCTAssertFalse(d.engine.isEmpty)
    }

    func testFailedResultExposesMessageCodeAndKey() throws {
        let json = #"{"type":"result","ok":false,"error":"Production deploy requires --confirm DEPLOY","code":"confirm_required","key":"deploy.confirmRequired"}"#
        let outcome = EngineOutcome(exitCode: 2, resultData: Data(json.utf8), stderr: "")
        XCTAssertFalse(outcome.ok)
        XCTAssertEqual(outcome.errorCode, "confirm_required")
        XCTAssertEqual(outcome.errorMessage, "Production deploy requires --confirm DEPLOY")
        XCTAssertThrowsError(try outcome.decode(DoctorInfo.self)) { error in
            guard case EngineError.failed(let message, let code) = error else { return XCTFail("expected EngineError.failed, got \(error)") }
            XCTAssertEqual(code, "confirm_required")
            XCTAssertEqual(message, "Production deploy requires --confirm DEPLOY")
        }
    }

    func testMissingResultLineFallsBackToStderr() {
        let outcome = EngineOutcome(exitCode: 127, resultData: nil, stderr: "zsh: command not found: node\n")
        XCTAssertFalse(outcome.ok)
        XCTAssertEqual(outcome.errorMessage, "zsh: command not found: node")
    }

    func testEngineEventAccessors() throws {
        let json = #"{"type":"step","id":"build","label":"Build","status":"pass","details":["Output: dist"],"duration":1.5,"cached":true}"#
        let raw = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        let ev = EngineEvent(raw: raw, data: Data(json.utf8))
        XCTAssertEqual(ev.type, "step")
        XCTAssertEqual(ev.string("id"), "build")
        XCTAssertEqual(ev.strings("details"), ["Output: dist"])
        XCTAssertEqual(ev.double("duration"), 1.5)
        XCTAssertEqual(ev.raw["cached"] as? Bool, true)
    }
}

final class LocalizationTests: XCTestCase {
    func testUnknownKeyFallsBackToTheKey() {
        XCTAssertEqual(L("this.key.does.not.exist"), "this.key.does.not.exist")
    }

    func testFormatArgumentsAreInsertedAsText() {
        // no catalog in the test bundle → the key itself is the format string
        XCTAssertEqual(L("%@ tokens", 250000), "250000 tokens")
        XCTAssertEqual(L("%@ of %@", 1, 2), "1 of 2")
    }

    func testCurrentLanguageDefaultsToEnglishWithoutASetting() {
        UserDefaults.standard.removeObject(forKey: Localization.storageKey)
        XCTAssertEqual(Localization.current, "en")
        XCTAssertNil(Localization.stored)
    }

    func testLanguageWithoutCatalogIsNotReviewed() {
        XCTAssertFalse(Localization.isReviewed("xx"))
    }

    func testTokensFormatterGroupsDigits() {
        UserDefaults.standard.set("en", forKey: Localization.storageKey)
        let s = Fmt.tokens(1_000_000)
        XCTAssertTrue(s.count >= 7, s) // grouped: "1,000,000" / "1 000 000"
        XCTAssertTrue(s.contains("000"))
        UserDefaults.standard.removeObject(forKey: Localization.storageKey)
    }
}

final class RunSessionTests: XCTestCase {
    @MainActor
    func testStepEventsCreateAndUpdateSteps() throws {
        let session = RunSession(title: "t", subtitle: "s", kind: .check)
        func event(_ json: String) throws -> EngineEvent {
            let raw = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
            return EngineEvent(raw: raw, data: Data(json.utf8))
        }
        session.handle(try event(#"{"type":"step","id":"git","label":"Git","status":"running"}"#))
        session.handle(try event(#"{"type":"log","step":"git","line":"On branch main"}"#))
        session.handle(try event(#"{"type":"step","id":"git","status":"pass","summary":"Clean working tree","cached":false}"#))
        session.handle(try event(#"{"type":"step","id":"build","label":"Build","status":"pass","cached":true}"#))
        XCTAssertEqual(session.steps.count, 2)
        XCTAssertEqual(session.steps[0].status, "pass")
        XCTAssertEqual(session.steps[0].summary, "Clean working tree")
        XCTAssertEqual(session.steps[0].lines, ["On branch main"])
        XCTAssertTrue(session.steps[1].cached)
        XCTAssertEqual(session.progress, 1)
        session.finish(success: true, title: "done", message: nil)
        XCTAssertTrue(session.finished)
    }
}
