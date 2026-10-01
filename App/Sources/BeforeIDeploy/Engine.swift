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
    case timedOut(Int)

    var errorDescription: String? {
        switch self {
        case .failed(let m, _): return m
        case .missing(let p): return L("engine.missingAt", p)
        case .timedOut(let s): return L("engine.timedOut", String(s))
        }
    }

    var code: String? {
        switch self {
        case .failed(_, let c): return c
        case .missing: return "missing"
        case .timedOut: return "timeout"
        }
    }
}

/// Handle for a running engine process (used to cancel long runs).
/// Cancel is real (WP02, audit A3): SIGTERM first — the engine stops its own child process groups — and
/// SIGKILL five seconds later if the engine is still there.
final class EngineHandle {
    fileprivate var process: Process?
    func cancel() {
        guard let p = process, p.isRunning else { return }
        p.terminate()
        let pid = p.processIdentifier
        DispatchQueue.global().asyncAfter(deadline: .now() + 5) {
            if p.isRunning { kill(pid, SIGKILL) }
        }
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
    /// `timeout`: seconds until the run is cancelled (SIGTERM, then SIGKILL) and `EngineError.timedOut` is
    /// thrown; nil = no deadline (long runs with a Cancel button: check, deploy, AI).
    func run(_ args: [String],
             handle: EngineHandle? = nil,
             env extra: [String: String] = [:],
             timeout: TimeInterval? = nil,
             onEvent: (@MainActor (EngineEvent) -> Void)? = nil) async throws -> EngineOutcome {
        guard isInstalled else { throw EngineError.missing(enginePath) }
        let control = handle ?? EngineHandle()

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-f", enginePath] + args
        process.standardInput = FileHandle.nullDevice
        var env = ProcessInfo.processInfo.environment
        env["BID_CLIENT"] = "app"
        if env["BID_LANG"] == nil { env["BID_LANG"] = Self.engineLanguage }
        // screenshot / CI runs: never touch the login keychain (`open --args -BIDNoKeychain 1`)
        if Snapshot.argument("BIDNoKeychain") { env["BID_NO_KEYCHAIN"] = "1" }
        if Snapshot.argument("BIDSnapshot"), Snapshot.argument("BIDBillingDemo") { env["BID_BILLING_DEMO"] = "1" }
        for (k, v) in extra { env[k] = v }
        process.environment = env

        let out = Pipe()
        let err = Pipe()
        process.standardOutput = out
        process.standardError = err
        control.process = process

        // stderr and the exit are collected by callbacks, never by a blocking read: blocking calls would park
        // threads of Swift's small cooperative pool and, with a few engine calls at once, hang all of them (audit A3)
        let errBuffer = PipeBuffer()
        err.fileHandleForReading.readabilityHandler = { h in
            let chunk = h.availableData
            if chunk.isEmpty {
                h.readabilityHandler = nil
                errBuffer.finish()
            } else {
                errBuffer.append(chunk)
            }
        }
        let lines = EngineLines()
        out.fileHandleForReading.readabilityHandler = { h in
            let chunk = h.availableData
            if chunk.isEmpty {
                h.readabilityHandler = nil
                lines.finish()
            } else { lines.append(chunk) }
        }
        let exit = ExitSignal()
        process.terminationHandler = { p in
            exit.fire(p.terminationStatus)
            // A grandchild can inherit stdout and keep it open after the engine exits.
            DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                out.fileHandleForReading.readabilityHandler = nil
                lines.finish()
            }
        }
        defer {
            out.fileHandleForReading.readabilityHandler = nil
            err.fileHandleForReading.readabilityHandler = nil
            lines.finish()
            try? out.fileHandleForReading.close()
            try? err.fileHandleForReading.close()
        }
        try process.run()

        let expired = TimeoutFlag()
        var watchdog: Task<Void, Never>?
        if let timeout {
            watchdog = Task.detached {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                guard !Task.isCancelled else { return }
                expired.set()
                control.cancel()
            }
        }
        defer { watchdog?.cancel() }

        var resultLine: Data? = nil
        for await line in lines.stream {
            guard let d = line.data(using: .utf8),
                  let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { continue }
            let event = EngineEvent(raw: obj, data: d)
            if event.type == "result" { resultLine = d }
            if let onEvent { await onEvent(event) }
        }

        let status = await exit.wait()
        let errData = await errBuffer.drained()
        let name = AppLog.commandName(args)
        if expired.value, let timeout {
            AppLog.engine.error("\(name, privacy: .public) timed out after \(Int(timeout), privacy: .public) s")
            throw EngineError.timedOut(Int(timeout))
        }
        if status == 0 {
            AppLog.engine.debug("\(name, privacy: .public) ok")
        } else {
            AppLog.engine.error("\(name, privacy: .public) exit \(status, privacy: .public)")
        }
        return EngineOutcome(
            exitCode: status,
            resultData: resultLine,
            stderr: String(decoding: errData, as: UTF8.self)
        )
    }

    /// Convenience: run and decode the result payload. Short questions get a deadline (default 120 s);
    /// callers that start long work (AI apply with a re-check, update download) pass `timeout: nil`.
    func call<T: Decodable>(_ args: [String], as type: T.Type,
                            env: [String: String] = [:],
                            timeout: TimeInterval? = 120,
                            onEvent: (@MainActor (EngineEvent) -> Void)? = nil) async throws -> T {
        let outcome = try await run(args, env: env, timeout: timeout, onEvent: onEvent)
        do {
            return try outcome.decode(T.self)
        } catch {
            // a model that stopped matching the engine's JSON is the most common silent failure: say so in the log
            AppLog.engine.error("\(AppLog.commandName(args), privacy: .public) decode \(String(describing: T.self), privacy: .public): \(String(describing: error), privacy: .public)")
            throw error
        }
    }
}

/// Set once by the timeout watchdog; read after the process ended.
final class TimeoutFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var fired = false
    func set() { lock.lock(); fired = true; lock.unlock() }
    var value: Bool { lock.lock(); defer { lock.unlock() }; return fired }
}

/// Collects a pipe's output from its readability handler (a background queue) without blocking anyone.
final class PipeBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()
    private var done = false

    func append(_ chunk: Data) { lock.lock(); data.append(chunk); lock.unlock() }
    func finish() { lock.lock(); done = true; lock.unlock() }

    /// Everything written so far; waits briefly for end-of-file (a detached grandchild may keep the pipe open).
    func drained() async -> Data {
        for _ in 0..<20 {
            lock.lock(); let finished = done; lock.unlock()
            if finished { break }
            try? await Task.sleep(nanoseconds: 25_000_000)
        }
        lock.lock(); defer { lock.unlock() }
        return data
    }
}

/// The process exit as something to `await` (terminationHandler may fire before or after the wait starts).
final class ExitSignal: @unchecked Sendable {
    private let lock = NSLock()
    private var status: Int32?
    private var waiter: CheckedContinuation<Int32, Never>?

    func fire(_ code: Int32) {
        lock.lock()
        status = code
        let w = waiter
        waiter = nil
        lock.unlock()
        w?.resume(returning: code)
    }

    func wait() async -> Int32 {
        await withCheckedContinuation { (c: CheckedContinuation<Int32, Never>) in
            lock.lock()
            if let status {
                lock.unlock()
                c.resume(returning: status)
            } else {
                waiter = c
                lock.unlock()
            }
        }
    }
}

/// Byte buffering preserves split UTF-8 and flushes the final line exactly once.
final class EngineLines: @unchecked Sendable {
    let stream: AsyncStream<String>
    private let continuation: AsyncStream<String>.Continuation
    private let lock = NSLock()
    private var pending = Data()
    private var done = false
    init() {
        var c: AsyncStream<String>.Continuation!
        stream = AsyncStream { c = $0 }
        continuation = c
    }
    func append(_ data: Data) {
        lock.lock(); defer { lock.unlock() }
        guard !done else { return }
        pending.append(data)
        while let newline = pending.firstIndex(of: 10) {
            continuation.yield(String(decoding: pending[..<newline], as: UTF8.self))
            pending.removeSubrange(...newline)
        }
    }
    func finish() {
        lock.lock(); defer { lock.unlock() }
        guard !done else { return }
        done = true
        if !pending.isEmpty { continuation.yield(String(decoding: pending, as: UTF8.self)) }
        pending.removeAll()
        continuation.finish()
    }
}
