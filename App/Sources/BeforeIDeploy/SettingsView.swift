import AppKit
import SwiftUI

/// One native Settings window. The notification also works from the command palette/account menu.
enum SettingsWindow {
    static let request = Notification.Name("BeforeIDeploy.openSettings")
    @MainActor static func open() { NotificationCenter.default.post(name: request, object: nil) }
    @MainActor static func legacyOpen() {
        NSApp.activate(ignoringOtherApps: true)
        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
    }
}
@available(macOS 14, *)
private struct SettingsNavigation: ViewModifier {
    @Environment(\.openSettings) private var openSettings
    func body(content: Content) -> some View {
        content.onReceive(NotificationCenter.default.publisher(for: SettingsWindow.request)) { _ in
            openSettings(); NSApp.activate(ignoringOtherApps: true)
        }
    }
}
extension View {
    @ViewBuilder func settingsNavigation() -> some View {
        if #available(macOS 14, *) { modifier(SettingsNavigation()) }
        else { onReceive(NotificationCenter.default.publisher(for: SettingsWindow.request)) { _ in SettingsWindow.legacyOpen() } }
    }
}
struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @AppStorage(Appearance.storageKey) private var appearance = "system"
    @AppStorage("autoOpenPreview") private var autoOpenPreview = true
    @AppStorage("checkOnSelect") private var checkOnSelect = false
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true
    @Local private var doctor: DoctorInfo?

    @Local private var doctorError: String?
    @Environment(\.openWindow) private var openWindow
    @Local private var deleting = false

    var body: some View {
        TabView {
            page { general }.tabItem { Label(L("settings.general"), systemImage: "slider.horizontal.3") }
            page { behavior }.tabItem { Label(L("settings.behavior"), systemImage: "bell") }
            page { environment }.tabItem { Label(L("settings.environment"), systemImage: "wrench.and.screwdriver") }
            page { account }.tabItem { Label(L("settings.account"), systemImage: "person.crop.circle") }
            page { support }.tabItem { Label(L("settings.support"), systemImage: "questionmark.circle") }
        }
        .padding(Space.l)
        .frame(width: 600, height: 420)
        .background(Theme.bg)
        .task { await loadDoctor() }
        .sheet(isPresented: $deleting) { DeleteAccountSheet().environmentObject(model) }
    }
    private func page<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView { content().frame(maxWidth: .infinity, alignment: .leading).padding(Space.l) }
    }
    private func loadDoctor() async {
        doctorError = nil
        do { doctor = try await model.engine.call(["doctor"], as: DoctorInfo.self) }
        catch { doctorError = error.localizedDescription }
    }
    private var account: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            SectionLabel(text: L("settings.account"))
            if let account = model.account, account.loggedIn {
                Text(account.email ?? L("common.account")).font(Typo.font(.headline))
                Button(L("settings.openAccount")) { model.screen = .account; openWindow(id: "main") }.bidButton(.secondary)
                Button(L("account.export")) { model.exportAccountData() }.bidButton(.secondary)
                Text(L("account.exportHint")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                Button(L("account.deleteButton")) { deleting = true }.bidButton(.danger)
            } else {
                Text(L("account.signInToSync")).font(Typo.font(.body)).foregroundColor(Theme.secondary)
            }
        }
    }
    private var general: some View {
        VStack(alignment: .leading, spacing: 10) {
                    SectionLabel(text: L("settings.languageSection"))
                    LanguageRow()
                    Text(L("appearance.title")).font(Typo.font(.body))
                    Segmented(options: Appearance.allCases.map { ($0.label, $0.rawValue) }, selection: $appearance)
                    .onChange(of: appearance) { (Appearance(rawValue: $0) ?? .system).apply() }
                }
    }
    private var behavior: some View {
        VStack(alignment: .leading, spacing: 10) {
                    SectionLabel(text: L("settings.behavior"))
                    ToggleRow(title: L("settings.autoOpenPreview"), subtitle: L("settings.autoOpenPreviewHint"), isOn: $autoOpenPreview)
                    ToggleRow(title: L("settings.autoCheck"), subtitle: L("settings.autoCheckHint"),
                              isOn: Binding(get: { model.autoCheck }, set: { model.autoCheck = $0 }))
                    ToggleRow(title: L("settings.checkOnSelect"), subtitle: L("settings.checkOnSelectHint"), isOn: $checkOnSelect)
                    ToggleRow(title: L("settings.notifications"), subtitle: L("settings.notificationsHint"), isOn: $notificationsEnabled)
                }
    }
    private var environment: some View {
        VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: L("settings.environment"))
                    if let d = doctor {
                        InfoRow(label: L("settings.engine"), value: "v\(d.engine)")
                        InfoRow(label: "Node", value: d.node.runtime == "bundled" ? L("engine.nodeBundled", d.node.version) : d.node.version)
                        InfoRow(label: "npm", value: d.npm?.version ?? "—")
                        if let p = d.pnpm { InfoRow(label: "pnpm", value: p.version) }
                        InfoRow(label: "Git", value: d.git?.version ?? L("common.none"), tint: d.git == nil ? Theme.blocked : Theme.text)
                        InfoRow(label: "Netlify CLI", value: d.netlify?.version ?? L("settings.netlifyMissing"))
                        InfoRow(label: L("settings.netlifyAccount"), value: d.netlifyAuth.email ?? (d.netlifyAuth.loggedIn ? L("common.signedInLower") : L("common.notSignedInLower")))
                        HStack {
                            Button(L("settings.dataFolder")) { model.openFile(d.appDir) }.bidButton(.ghost, compact: true)
                            Button(L("settings.logs")) { model.openFile(d.cacheDir) }.bidButton(.ghost, compact: true)
                        }
                    } else if let doctorError {
                        ErrorState(message: doctorError, retry: { Task { await loadDoctor() } })
                    } else {
                        HStack { Spinner(size: 12); Text(L("settings.checking")).foregroundColor(Theme.secondary).font(Typo.font(.callout)) }
                    }
                }
    }
    private var support: some View {
        VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: L("settings.support"))
                    InfoRow(label: L("settings.version"), value: doctor.map { "v\($0.engine)" } ?? "—")
                    ToggleRow(title: L("update.betaChannel"), subtitle: L("update.betaChannelHint"),
                              isOn: Binding(get: { model.updateChannel == "beta" }, set: { model.updateChannel = $0 ? "beta" : "stable" }))
                    if let u = model.update, u.available { UpdateBanner(info: u) }
                    HStack {
                        Button(L("update.checkNow")) { Task { await model.checkForUpdates(force: true, announce: true) } }.bidButton(.secondary, compact: true)
                        Button(L("report.save")) { model.saveReport() }.bidButton(.secondary, compact: true).disabled(model.busy.contains("report"))
                    }
                    // its own row: three buttons side by side were cut off in Bulgarian
                    Button { model.prepareFeedback() } label: { Label(L("feedback.send"), systemImage: "envelope") }
                        .bidButton(.secondary, compact: true).disabled(model.busy.contains("report"))
                    Text(L("report.hint")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                    if let r = model.feedbackReport {
                        // what the report holds, before the user decides to send it (WP08, audit D6)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(L("feedback.contains")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                            ForEach(r.files, id: \.self) { f in
                                Label(f, systemImage: "doc.text").font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.secondary)
                            }
                            Text(L("feedback.redacted")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
                            HStack {
                                Button(L("feedback.writeMail")) { model.writeFeedbackMail(r) }.bidButton(.primary, compact: true)
                                Button(L("common.cancel")) { model.feedbackReport = nil }.bidButton(.ghost, compact: true)
                            }
                        }
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).fill(Theme.bg))
                    }
                    LegalLinks()
                }
    }
}
