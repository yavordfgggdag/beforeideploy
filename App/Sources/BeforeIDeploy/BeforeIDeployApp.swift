import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        CrashReporter.install()
        (Appearance(rawValue: UserDefaults.standard.string(forKey: Appearance.storageKey) ?? "system") ?? .system).apply()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        Notifier.shared.setup()
        Snapshot.scheduleIfRequested()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        Task { @MainActor in
            for url in urls { AppModel.shared.enqueueURL(url) }
        }
    }

    /// The menu bar icon keeps watching projects after the window closes; the Dock icon or the menu reopens it (audit A6).
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

@main
struct BeforeIDeployApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var model = AppModel.shared
    /// Changing the language rebuilds the window content, so every L() text is read again.
    @AppStorage(Localization.storageKey) private var locale = ""
    @AppStorage(Appearance.storageKey) private var appearance = "system"
    @AppStorage(Onboarding.tourSeenKey) private var tourSeen = false

    /// Project commands only while the main screen is showing — never behind the sign-in or the tour (audit A8).
    private var projectCommandsOff: Bool { locale.isEmpty || !tourSeen || model.mustAuthenticate || model.selectedKey == nil || model.run != nil || model.aiStore.current != nil || model.showPalette }

    var body: some Scene {
        Window("Before I Deploy", id: "main") {
            RootView()
                .id(locale)
                .environment(\.locale, Localization.locale)
                .environmentObject(model)
                .frame(minWidth: 900, minHeight: 640)

                .tint(Theme.accent)
                .accentColor(Theme.accent)
                .task { await model.start() }
                .onChange(of: appearance) { (Appearance(rawValue: $0) ?? .system).apply() }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1280, height: 820)
        .commands { commands }

        Settings {
            SettingsView()
                .id(locale)
                .environment(\.locale, Localization.locale)
                .environmentObject(model)
                .tint(Theme.accent)
        }

        MenuBarExtra {
            MenuBarView()
                .environment(\.locale, Localization.locale)
                .environmentObject(model)

        } label: {
            Image(systemName: model.menuBarSymbol)
                .accessibilityLabel("Before I Deploy")
        }
        .menuBarExtraStyle(.window)
    }

    @CommandsBuilder private var commands: some Commands {
            CommandGroup(replacing: .newItem) {
                Button(L("menu.addProject")) { model.addProjectPanel() }
                    .keyboardShortcut("o")
            }
            CommandGroup(replacing: .appSettings) {
                if #available(macOS 14, *) { SettingsLink { Text(L("menu.settings")) }.keyboardShortcut(",") }
                else { Button(L("menu.settings")) { SettingsWindow.legacyOpen() }.keyboardShortcut(",") }
            }
            CommandMenu(L("menu.actions")) {
                Button(L("menu.commands")) { model.showPalette.toggle() }
                    .keyboardShortcut("k")
            }
            CommandMenu(L("common.project")) {
                Button(L("common.check")) { model.runCheck() }
                    .keyboardShortcut("r")
                    .disabled(projectCommandsOff)
                Button(L("menu.fullCheck")) { model.runCheck(force: true) }
                    .keyboardShortcut("r", modifiers: [.command, .option])
                    .disabled(projectCommandsOff)
                Button(L("run.smartDeploy")) { model.smartDeploy() }
                    .keyboardShortcut("d")
                    .disabled(projectCommandsOff)
                Divider()
                Button(L("run.localPreview")) { model.localStart() }
                    .keyboardShortcut("l")
                    .disabled(projectCommandsOff)
                Button(L("menu.stopLocal")) { model.localStop() }
                    .keyboardShortcut("l", modifiers: [.command, .shift])
                    .disabled(projectCommandsOff)
                Divider()
                Button(L("menu.commitPush")) { model.sheet = .commit }
                    .keyboardShortcut("k", modifiers: [.command, .shift])
                    .disabled(projectCommandsOff)
                Button(L("common.history")) { model.sheet = .history }
                    .keyboardShortcut("y")
                    .disabled(projectCommandsOff)
                Divider()
                Button(L("common.refresh")) { Task { await model.refreshStatus() } }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
                    .disabled(projectCommandsOff)
            }
            CommandMenu(L("menu.view")) {
                Button(L("nav.missionControl")) { model.screen = .overview }
                    .keyboardShortcut("1")
                Button(L("common.domains")) { model.screen = .domains }
                    .keyboardShortcut("2")
                Button(L("assistant.nav")) { model.screen = .assistant }
                    .keyboardShortcut("3")
                Button(L("common.costs")) { model.screen = .costs }
                    .keyboardShortcut("4")
                Button(L("common.setup")) { model.screen = .setup }
                    .keyboardShortcut("5")
                Button(L("usage.nav")) { model.screen = .usage }
                    .keyboardShortcut("6")
                    .disabled(model.account?.loggedIn != true)
                Button(L("common.account")) { model.screen = .account }
                    .keyboardShortcut("7")
                    .disabled(model.account?.loggedIn != true)
                Button(L("admin.title")) { model.screen = .admin }
                    .keyboardShortcut("8")
                    .disabled(model.account?.isAdmin != true)
                Divider()
                Button(L("menu.nextProject")) { model.selectAdjacent(1) }
                    .keyboardShortcut("]")
                Button(L("menu.previousProject")) { model.selectAdjacent(-1) }
                    .keyboardShortcut("[")
            }

    }
}
