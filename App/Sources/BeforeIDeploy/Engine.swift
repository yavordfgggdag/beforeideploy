import Foundation

/// One NDJSON line from the engine.
struct EngineEvent {
    let raw: [String: Any]
    let data: Data

    var type: String { raw["type"] as? String ?? "" }
    func string(_ k: String) -> String? { raw[k] as? String }
    func strings(_ k: String) -> [String]? { raw[k] as? [String] }
    func double(_ k: String) -> Double? { (raw[k] as? NSNumber)?.doubleValue }
}

struct EngineOutcome {
    let exitCode: Int32
    let resultData: Data?
    let stderr: String

    var ok: Bool {
        guard let d = resultData,
              let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return false }
        return obj["ok"] as? Bool ?? false
    }

    var errorMessage: String? {
        guard let d = resultData,
              let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else {
            let tail = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            return tail.isEmpty ? L("engine.noResponse", exitCode) : tail
        }
        return obj["error"] as? String
    }

    var errorCode: String? {
        guard let d = resultData,
              let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
        return obj["code"] as? String
    }

    func decode<T: Decodable>(_ type: T.Type) throws -> T {
        guard let d = resultData else { throw EngineError.failed(errorMessage ?? L("engine.noResult"), nil) }
        let env = try JSONDecoder().decode(ResultEnvelope<T>.self, from: d)
        guard env.ok else { throw EngineError.failed(env.error ?? L("engine.unknownError"), env.code) }
        guard let v = env.data else { throw EngineError.failed(L("engine.emptyResult"), nil) }
        return v
    }
}

struct ResultEnvelope<V: Decodable>: Decodable {
    let ok: Bool
    let data: V?
    let error: String?
    let code: String?
}

enum EngineError: LocalizedError {
    case failed(String, String?)
    case missing(String)

    var errorDescription: String? {
        switch self {
        case .failed(let m, _): return m
        case .missing(let p): return L("engine.missingAt", p)
        }
    }

    var code: String? {
        if case .failed(_, let c) = self { return c }
        return "missing"
    }
}

/// Handle for a running engine process (used to cancel long runs).
final class EngineHandle {
    fileprivate var process: Process?
    func cancel() {
        guard let p = process, p.isRunning else { return }
        p.terminate()
    }
}

final class EngineClient {
    static let shared = EngineClient()

    var enginePath: String {
        if let env = ProcessInfo.processInfo.environment["BID_ENGINE"], !env.isEmpty { return env }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return support.appendingPathComponent("BeforeIDeploy/engine/bid").path
    }

    var isInstalled: Bool { FileManager.default.isExecutableFile(atPath: enginePath) }

    /// Language for engine messages (BID_LANG) — the same one the app uses.
    static var engineLanguage: String {
        Localization.current
    }

    /// Runs `bid <args>`; streams every event to `onEvent` on the main actor.
    func run(_ args: [String],
             handle: EngineHandle? = nil,
             env extra: [String: String] = [:],
             onEvent: (@MainActor (EngineEvent) -> Void)? = nil) async throws -> EngineOutcome {
        guard isInstalled else { throw EngineError.missing(enginePath) }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [enginePath] + args
        process.standardInput = FileHandle.nullDevice
        var env = ProcessInfo.processInfo.environment
        env["BID_CLIENT"] = "app"
        if env["BID_LANG"] == nil { env["BID_LANG"] = Self.engineLanguage }
        for (k, v) in extra { env[k] = v }
        process.environment = env

        let out = Pipe()
        let err = Pipe()
        process.standardOutput = out
        process.standardError = err
        handle?.process = process

        try process.run()

        let errTask = Task.detached { () -> Data in
            err.fileHandleForReading.readDataToEndOfFile()
        }

        var resultLine: Data? = nil
        for try await line in out.fileHandleForReading.bytes.lines {
            guard let d = line.data(using: .utf8),
                  let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { continue }
            let event = EngineEvent(raw: obj, data: d)
            if event.type == "result" { resultLine = d }
            if let onEvent { await onEvent(event) }
        }

        let errData = await errTask.value
        process.waitUntilExit()
        return EngineOutcome(
            exitCode: process.terminationStatus,
            resultData: resultLine,
            stderr: String(decoding: errData, as: UTF8.self)
        )
    }

    /// Convenience: run and decode the result payload.
    func call<T: Decodable>(_ args: [String], as type: T.Type,
                            env: [String: String] = [:],
                            onEvent: (@MainActor (EngineEvent) -> Void)? = nil) async throws -> T {
        let outcome = try await run(args, env: env, onEvent: onEvent)
        return try outcome.decode(T.self)
    }
}
