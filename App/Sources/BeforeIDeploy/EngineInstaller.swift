import Foundation
import os

/// The engine ships inside the app (Contents/Resources/engine) and is installed into
/// ~/Library/Application Support/BeforeIDeploy/engine on first launch and whenever the bundled
/// version differs (audit B1/B2/B5): a DMG or an update is all a customer needs.
enum EngineInstaller {
    enum Outcome: Equatable {
        /// Nothing bundled (development build run from the Swift package, or BID_ENGINE set).
        case notBundled
        case upToDate(String)
        case installed(String)
        case failed(String)
    }

    static var bundledEngine: URL? {
        guard ProcessInfo.processInfo.environment["BID_ENGINE"] == nil,
              let dir = Bundle.main.resourceURL?.appendingPathComponent("engine"),
              FileManager.default.fileExists(atPath: dir.appendingPathComponent("bid").path) else { return nil }
        return dir
    }

    static func version(at dir: URL) -> String? {
        (try? String(contentsOf: dir.appendingPathComponent("VERSION"), encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Copies the bundled engine next to the installed one and swaps them; keeps the PATH file
    /// (env.zsh) that install.sh may have written. Runs off the main thread.
    static func installIfNeeded(into target: URL) async -> Outcome {
        guard let source = bundledEngine else { return .notBundled }
        return await Task.detached(priority: .userInitiated) { () -> Outcome in
            let fm = FileManager.default
            let bundled = version(at: source) ?? "?"
            if fm.isExecutableFile(atPath: target.appendingPathComponent("bid").path), version(at: target) == bundled {
                return .upToDate(bundled)
            }
            let parent = target.deletingLastPathComponent()
            let fresh = parent.appendingPathComponent("engine.new")
            do {
                try fm.createDirectory(at: parent, withIntermediateDirectories: true)
                try? fm.removeItem(at: fresh)
                try fm.copyItem(at: source, to: fresh)
                let env = target.appendingPathComponent("env.zsh")
                if fm.fileExists(atPath: env.path) {
                    try? fm.copyItem(at: env, to: fresh.appendingPathComponent("env.zsh"))
                }
                try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: fresh.appendingPathComponent("bid").path)
                if fm.fileExists(atPath: target.path) {
                    _ = try fm.replaceItemAt(target, withItemAt: fresh)
                } else {
                    try fm.moveItem(at: fresh, to: target)
                }
                AppLog.engine.notice("engine \(bundled, privacy: .public) installed")
                return .installed(bundled)
            } catch {
                try? fm.removeItem(at: fresh)
                AppLog.engine.error("engine install failed: \(error.localizedDescription, privacy: .public)")
                return .failed(error.localizedDescription)
            }
        }.value
    }
}
