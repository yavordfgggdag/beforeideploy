import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
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

    var body: some Scene {
        Window("Before I Deploy", id: "main") {
            RootView()
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
                Button("Smart Deploy") { model.smartDeploy() }
                    .keyboardShortcut("d")
                Divider()
                Button("Local Preview") { model.localStart() }
                    .keyboardShortcut("l")
                Button(L("menu.stopLocal")) { model.localStop() }
                    .keyboardShortcut("l", modifiers: [.command, .shift])
                Divider()
                Button("Commit & Push…") { model.sheet = .commit }
                    .keyboardShortcut("k", modifiers: [.command, .shift])
                Button(L("common.history")) { model.sheet = .history }
                    .keyboardShortcut("y")
                Divider()
                Button(L("common.refresh")) { Task { await model.refreshStatus() } }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
            }
            CommandGroup(replacing: .appSettings) {
                Button(L("menu.settings")) { model.sheet = .settings }
                    .keyboardShortcut(",")
            }
        }
    }
}
