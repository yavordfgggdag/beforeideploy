import XCTest
@testable import BeforeIDeploy

final class AssistantTests: XCTestCase {
    func testLegacyHistoryStillDecodesWithoutNewFields() throws {
        let data = Data(#"{"project":"site","conversation":"one","entries":[{"at":"2026-10-01T12:00:00Z","conversation":"one","action":"ask","summary":"A saved answer","valid":true}]}"#.utf8)
        let history = try JSONDecoder().decode(AssistantHistory.self, from: data)
        XCTAssertEqual(history.entries.first?.summary, "A saved answer")
        XCTAssertNil(history.entries.first?.result)
        XCTAssertNil(history.entries.first?.request)
    }

    func testFullHistoryRestoresRetrySourcesAndUndo() throws {
        let data = Data(#"{"project":"site","conversation":"one","entries":[{"at":"2026-10-01T12:00:00Z","action":"propose","request":{"action":"propose","message":"Fix it","issue":"build","files":"src/app.js"},"result":{"conversation":"one","action":"propose","provider":"cloud","valid":true,"output":{"summary":"A proposal"},"evidence":[{"id":"E1","kind":"file","label":"src/app.js","chars":42,"redactions":0}],"applied":{"applied":["src/app.js"],"undoFile":"/saved/undo"},"usage":{"charged":80,"balance":920},"verified":false}}]}"#.utf8)
        let entry = try XCTUnwrap(JSONDecoder().decode(AssistantHistory.self, from: data).entries.first)
        XCTAssertEqual(entry.request?.issue, "build")
        XCTAssertEqual(entry.request?.files, "src/app.js")
        XCTAssertEqual(entry.result?.evidence?.first?.label, "src/app.js")
        XCTAssertEqual(entry.result?.applied?.undoFile, "/saved/undo")
        XCTAssertEqual(entry.result?.usage?.charged, 80)
        XCTAssertEqual(entry.result?.verified, false)
    }

    func testMarkdownKeepsCodeLiteralAndAcceptsAnUnfinishedFenceDuringStreaming() {
        let blocks = AssistantMarkdownParser.parse("A **bold** answer\n\n```js\nconst x = '<script>';\n```\nNext step")
        XCTAssertEqual(blocks.count, 3)
        XCTAssertEqual(blocks[1].language, "js")
        XCTAssertEqual(blocks[1].text, "const x = '<script>';")
        XCTAssertEqual(AssistantMarkdownParser.parse("```swift\nlet value = 1").last?.language, "swift")
    }

    func testDiffLineNumbersFollowHunkOffsetsAndAdditions() {
        let lines = AssistantDiff.lines("--- a/test\n+++ b/test\n@@ -10,2 +20,2 @@\n same\n-old\n+new")
        XCTAssertNil(lines[0].old)
        XCTAssertEqual(lines[3].old, 10)
        XCTAssertEqual(lines[3].new, 20)
        XCTAssertEqual(lines[4].old, 11)
        XCTAssertNil(lines[4].new)
        XCTAssertNil(lines[5].old)
        XCTAssertEqual(lines[5].new, 21)
    }

    @MainActor
    func testStreamResetDiscardsPendingPartialOutput() {
        let stream = AssistantStreamBuffer()
        stream.append("Rejected answer")
        stream.reset()
        stream.append("Validated answer")
        stream.flush()
        XCTAssertEqual(stream.text, "Validated answer")
    }
}
