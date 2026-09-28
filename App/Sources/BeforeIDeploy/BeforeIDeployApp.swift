import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        CrashReporter.install()
        NSApp.appearance = NSAppearance(named: .darkAqua)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        Notifier.shared.setup()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        Task { @MainActor in
            for url in urls { AppModel.shared.enqueueURL(url) }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
struct BeforeIDeployApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var model = AppModel.shared
    /// Changing the language rebuilds the window content, so every L() text is read again.
    @AppStorage(Localization.storageKey) private var locale = ""

    var body: some Scene {
        Window("Before I Deploy", id: "main") {
            RootView()
                .id(locale)
                .environment(\.locale, Localization.locale)
                .environmentObject(model)
                .frame(minWidth: 1080, minHeight: 700)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                .accentColor(Theme.accent)
                .task { await model.start() }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1280, height: 820)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button(L("menu.addProject")) { model.addProjectPanel() }
                    .keyboardShortcut("o")
            }
            CommandMenu(L("menu.actions")) {
                Button(L("menu.commands")) { model.showPalette.toggle() }
                    .keyboardShortcut("k")
            }
            CommandMenu(L("common.project")) {
                Button(L("common.check")) { model.runCheck() }
                    .keyboardShortcut("r")
                Button(L("menu.fullCheck")) { model.runCheck(force: true) }
                    .keyboardShortcut("r", modifiers: [.command, .option])
                Button(L("run.smartDeploy")) { model.smartDeploy() }
                    .keyboardShortcut("d")
                Divider()
                Button(L("run.localPreview")) { model.localStart() }
                    .keyboardShortcut("l")
                Button(L("menu.stopLocal")) { model.localStop() }
                    .keyboardShortcut("l", modifiers: [.command, .shift])
                Divider()
                Button(L("menu.commitPush")) { model.sheet = .commit }
                    .keyboardShortcut("k", modifiers: [.command, .shift])
                Button(L("common.history")) { model.sheet = .history }
                    .keyboardShortcut("y")
                Divider()
                Button(L("common.refresh")) { Task { await model.refreshStatus() } }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
            }
            CommandMenu(L("menu.view")) {
                Button(L("nav.missionControl")) { model.screen = .overview }
                    .keyboardShortcut("1")
                Button(L("common.domains")) { model.screen = .domains }
                    .keyboardShortcut("2")
                Button(L("common.costs")) { model.screen = .costs }
                    .keyboardShortcut("3")
                Button(L("common.setup")) { model.screen = .setup }
                    .keyboardShortcut("4")
                Divider()
                Button(L("menu.nextProject")) { model.selectAdjacent(1) }
                    .keyboardShortcut("]")
                Button(L("menu.previousProject")) { model.selectAdjacent(-1) }
                    .keyboardShortcut("[")
            }
            CommandGroup(replacing: .appSettings) {
                Button(L("menu.settings")) { model.sheet = .settings }
                    .keyboardShortcut(",")
            }
        }
    }
}
