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
        // AppKit swallows exceptions thrown on the main thread unless told to crash (audit A11)
        UserDefaults.standard.register(defaults: ["NSApplicationCrashOnExceptions": true])
        // a stack overflow can only be reported from a separate signal stack
        let altSize = 128 * 1024
        var alt = stack_t()
        alt.ss_sp = UnsafeMutableRawPointer.allocate(byteCount: altSize, alignment: 16)
        alt.ss_size = altSize
        alt.ss_flags = 0
        sigaltstack(&alt, nil)
        for sig in [SIGSEGV, SIGBUS, SIGILL, SIGTRAP, SIGABRT, SIGFPE] {
            var action = sigaction()
            action.__sigaction_u.__sa_handler = { writeSignalCrash($0) }
            action.sa_flags = SA_ONSTACK
            sigemptyset(&action.sa_mask)
            sigaction(sig, &action, nil)
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

/// Screenshot mode (CI and docs): `open "Before I Deploy.app" --args -BIDSnapshot /tmp/x.png [-BIDSnapshotDelay 6]`
/// renders the main window into a PNG after the delay and quits. The app draws itself, so no screen-recording
/// permission is needed. Does nothing unless the argument is given.
enum Snapshot {
    /// Only a command-line argument counts — a value someone wrote into the app's defaults must not keep the
    /// app quitting after every launch (audit A16).
    static func argument(_ name: String) -> Bool { ProcessInfo.processInfo.arguments.contains("-\(name)") }

    static func scheduleIfRequested() {
        guard argument("BIDSnapshot"), let path = UserDefaults.standard.string(forKey: "BIDSnapshot"), !path.isEmpty else { return }
        let delay = UserDefaults.standard.double(forKey: "BIDSnapshotDelay")
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if argument("BIDWindowSize"), let value = UserDefaults.standard.string(forKey: "BIDWindowSize") {
                let dimensions = value.split(separator: "x").compactMap { Double($0) }
                if dimensions.count == 2, let window = NSApp.windows.first(where: { $0.isVisible && $0.sheetParent == nil }) {
                    window.setContentSize(NSSize(width: max(900, dimensions[0]), height: max(640, dimensions[1])))
                }
            }
            try? await Task.sleep(nanoseconds: UInt64(max(1, (delay > 0 ? delay : 6) - 1) * 1_000_000_000))
            write(to: URL(fileURLWithPath: path))
            NSApp.terminate(nil)
        }
    }

    @MainActor
    static func write(to url: URL) {
        guard let main = NSApp.windows.first(where: { $0.isVisible && $0.contentView != nil && $0.sheetParent == nil }),
              let window = Optional(main.attachedSheet ?? main),
              let view = window.contentView?.superview ?? window.contentView,
              let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
            AppLog.ui.error("snapshot: no window")
            return
        }
        view.cacheDisplay(in: view.bounds, to: rep)
        if let png = rep.representation(using: .png, properties: [:]) {
            try? png.write(to: url)
            AppLog.ui.notice("snapshot written")
        }
    }
}
