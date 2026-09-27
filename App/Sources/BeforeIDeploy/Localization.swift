import Foundation

/// App language (V10 WP1). Texts live in `<lang>.lproj/Localizable.strings` inside the .app's
/// Contents/Resources — scripts/build.sh copies them there from App/Resources. We read them through
/// `Bundle.main` (not SwiftPM's `Bundle.module`, which looks next to the executable and breaks once the
/// .app is assembled by hand), and pick the .lproj ourselves so the language can change without a restart.
enum Localization {
    static let storageKey = "locale"
    static let fallback = "en"

    /// The language chosen in the app, or nil before the user picked one.
    static var stored: String? {
        let v = UserDefaults.standard.string(forKey: storageKey)
        return (v?.isEmpty ?? true) ? nil : v
    }

    /// Active language. Until the language picker has been answered the app stays Bulgarian, as in V9.
    static var current: String { stored ?? "bg" }

    static var locale: Locale { Locale(identifier: current) }

    /// Languages that have a catalog in the app bundle, e.g. ["bg", "en"].
    static var available: [String] {
        let dir = Bundle.main.resourceURL
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir?.path ?? "")) ?? []
        return names.filter { $0.hasSuffix(".lproj") && $0 != "Base.lproj" }
            .map { String($0.dropLast(".lproj".count)) }
            .sorted()
    }

    /// The language's own name ("Български", "English", "Deutsch" …).
    static func nativeName(_ code: String) -> String {
        let name = Locale(identifier: code).localizedString(forIdentifier: code) ?? code
        return name.prefix(1).uppercased() + name.dropFirst()
    }

    static func set(_ code: String) {
        UserDefaults.standard.set(code, forKey: storageKey)
    }

    // MARK: - Lookup

    private static let lock = NSLock()
    private static var bundles: [String: Bundle] = [:]
    private static let missing = "\u{1}missing"

    private static func bundle(for lang: String) -> Bundle? {
        lock.lock()
        defer { lock.unlock() }
        if let b = bundles[lang] { return b }
        guard let path = Bundle.main.path(forResource: lang, ofType: "lproj"), let b = Bundle(path: path) else { return nil }
        bundles[lang] = b
        return b
    }

    /// Text for `key` in the active language, then English, else the key itself.
    static func string(_ key: String) -> String {
        for lang in [current, fallback] {
            if let b = bundle(for: lang) {
                let s = b.localizedString(forKey: key, value: missing, table: nil)
                if s != missing { return s }
            }
        }
        return key
    }
}

/// Localized text. Formats use `%@` placeholders (`%1$@`, `%2$@` when a language needs another order);
/// every argument is passed as text, so numbers keep the look they had in V9.
func L(_ key: String) -> String {
    Localization.string(key)
}

func L(_ key: String, _ args: Any...) -> String {
    let texts: [CVarArg] = args.map { "\($0)" as CVarArg }
    return String(format: Localization.string(key), locale: Localization.locale, arguments: texts)
}
