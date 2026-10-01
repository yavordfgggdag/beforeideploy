import Foundation
import XCTest

/// Engine results captured by the engine test-suite (`BID_WRITE_FIXTURES=1 node tests/run.mjs`).
enum Fixtures {
    static func data(_ name: String) throws -> Data {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else {
            throw XCTSkip("fixture \(name).json is missing — run BID_WRITE_FIXTURES=1 node tests/run.mjs")
        }
        return try Data(contentsOf: url)
    }

    static func decode<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
        try JSONDecoder().decode(T.self, from: try data(name))
    }

    /// The engine writes `{"type":"result","ok":true,"data":…}`; fixtures hold the `data` part.
    static func resultLine(_ name: String) throws -> Data {
        let payload = try data(name)
        var line = Data("{\"type\":\"result\",\"ok\":true,\"data\":".utf8)
        line.append(payload)
        line.append(Data("}".utf8))
        return line
    }
}
