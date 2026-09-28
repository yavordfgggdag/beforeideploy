import AppKit
import Foundation
import os

/// Unified logging (V10 WP6.6): Console.app → filter by subsystem, category engine / ui / billing / account.
/// Never log secrets or full argument lists — only the command name and the outcome.
enum AppLog {
    static let subsystem = Bundle.main.bundleIdentifier ?? "bg.yavor.beforeideploy"
    static let engine = Logger(subsystem: subsystem, category: "engine")
    static let ui = Logger(subsystem: subsystem, category: "ui")
    static let billing = Logger(subsystem: subsystem, category: "billing")
    static let account = Logger(subsystem: subsystem, category: "account")

    /// "account login", "check" … — the first words of a command, never its values.
    static func commandName(_ args: [String]) -> String {
        args.prefix(2).filter { !$0.hasPrefix("-") }.joined(separator: " ")
    }
}

/// Path of the signal crash file as a C string, prepared before any crash (the signal handler may not allocate).
private var crashSignalPath: UnsafeMutablePointer<CChar>?

private func writeSignalCrash(_ sig: Int32) {
    guard let path = crashSignalPath else { return }
    let fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0o644)
    if fd >= 0 {
        let name: StaticString
        switch sig {
        case SIGSEGV: name = "Before I Deploy crashed: SIGSEGV (invalid memory access)\n"
        case SIGBUS: name = "Before I Deploy crashed: SIGBUS (bus error)\n"
        case SIGILL: name = "Before I Deploy crashed: SIGILL (illegal instruction / Swift runtime trap)\n"
        case SIGTRAP: name = "Before I Deploy crashed: SIGTRAP (Swift runtime trap)\n"
        case SIGABRT: name = "Before I Deploy crashed: SIGABRT (abort)\n"
        case SIGFPE: name = "Before I Deploy crashed: SIGFPE (arithmetic error)\n"
        default: name = "Before I Deploy crashed: fatal signal\n"
        }
        _ = write(fd, name.utf8Start, name.utf8CodeUnitCount)
        close(fd)
    }
    signal(sig, SIG_DFL)
    raise(sig)
}

/// Minimal crash reports (V10 WP6.6): a file in `…/BeforeIDeploy/logs/` for an uncaught Objective-C exception
/// or a fatal signal. The next launch mentions it once; "Save support report" includes the files (redacted).
enum CrashReporter {
    static var logsDir: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return support.appendingPathComponent("BeforeIDeploy/logs", isDirectory: true)
    }

    private static let signalFileName = "crash-signal.txt"
    private static let seenKey = "diagnostics.lastCrashSeen"

    static func install() {
        try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
        crashSignalPath = strdup(logsDir.appendingPathComponent(signalFileName).path)
        NSSetUncaughtExceptionHandler { exception in
            let text = """
            Before I Deploy crashed: uncaught exception
            name: \(exception.name.rawValue)
            reason: \(exception.reason ?? "—")
            version: \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")
            stack:
            \(exception.callStackSymbols.joined(separator: "\n"))
            """
            let file = CrashReporter.logsDir.appendingPathComponent("crash-\(CrashReporter.stamp()).txt")
            try? text.write(to: file, atomically: true, encoding: .utf8)
        }
        for sig in [SIGSEGV, SIGBUS, SIGILL, SIGTRAP, SIGABRT, SIGFPE] {
            signal(sig) { writeSignalCrash($0) }
        }
    }

    /// Crash files newer than the last one the user was told about (the signal file is renamed with a date).
    static func newCrashesSinceLastLaunch() -> [URL] {
        let fm = FileManager.default
        let signalFile = logsDir.appendingPathComponent(signalFileName)
        if fm.fileExists(atPath: signalFile.path) {
            try? fm.moveItem(at: signalFile, to: logsDir.appendingPathComponent("crash-\(stamp())-signal.txt"))
        }
        let files = ((try? fm.contentsOfDirectory(at: logsDir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [])
            .filter { $0.lastPathComponent.hasPrefix("crash-") }
        let seen = UserDefaults.standard.double(forKey: seenKey)
        let fresh = files.filter { url in
            let d = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)?.timeIntervalSince1970 ?? 0
            return d > seen
        }
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: seenKey)
        return fresh
    }

    static func stamp() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd-HHmmss"
        return f.string(from: Date())
    }
}
