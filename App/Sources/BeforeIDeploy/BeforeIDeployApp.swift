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
                Button("Добави проект…") { model.addProjectPanel() }
                    .keyboardShortcut("o")
            }
            CommandMenu("Действия") {
                Button("Команди…") { model.showPalette.toggle() }
                    .keyboardShortcut("k")
            }
            CommandMenu("Проект") {
                Button("Провери") { model.runCheck() }
                    .keyboardShortcut("r")
                Button("Smart Deploy") { model.smartDeploy() }
                    .keyboardShortcut("d")
                Divider()
                Button("Local Preview") { model.localStart() }
                    .keyboardShortcut("l")
                Button("Спри Local Preview") { model.localStop() }
                    .keyboardShortcut("l", modifiers: [.command, .shift])
                Divider()
                Button("Commit & Push…") { model.sheet = .commit }
                    .keyboardShortcut("k", modifiers: [.command, .shift])
                Button("История") { model.sheet = .history }
                    .keyboardShortcut("y")
                Divider()
                Button("Обнови") { Task { await model.refreshStatus() } }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
            }
            CommandGroup(replacing: .appSettings) {
                Button("Настройки…") { model.sheet = .settings }
                    .keyboardShortcut(",")
            }
        }
    }
}
