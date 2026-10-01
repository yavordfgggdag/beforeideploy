import SwiftUI

// MARK: - Command palette (⌘K)

struct PaletteCommand: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let icon: String
    let action: () -> Void
}

struct CommandPalette: View {
    @EnvironmentObject var model: AppModel
    @Local private var query = ""
    /// Highlighted row: ↑/↓ move it, Return runs it (audit A14).
    @Local private var selection = 0
    @FocusState private var searchFocused: Bool
    @Local private var appeared = false

    var commands: [PaletteCommand] {
        var c: [PaletteCommand] = [
            PaletteCommand(title: L("nav.missionControl"), subtitle: L("common.allProjects"), icon: "square.grid.2x2.fill") { model.screen = .overview; Task { await model.loadOverview() } },
            PaletteCommand(title: L("common.domains"), subtitle: L("palette.domainsDetail"), icon: "network") { model.screen = .domains; Task { await model.loadSpaceship() } },
            PaletteCommand(title: L("common.costs"), subtitle: L("palette.costsDetail"), icon: "creditcard.fill") { model.screen = .costs; Task { await model.loadCosts() } },
            PaletteCommand(title: L("common.setup"), subtitle: L("palette.setupDetail"), icon: "wand.and.stars") { model.screen = .setup; Task { await model.loadSetup() } },
            PaletteCommand(title: L("ai.askAssistant"), subtitle: L("palette.assistantDetail"), icon: "sparkles") { model.openAssistant() },
        ]
        if model.account?.canUseOwnKey == true {
            c.append(PaletteCommand(title: L("ai.addKeyButton"), subtitle: L("palette.aiKeyDetail"), icon: "key.fill") { model.sheet = .aiKeys })
        }
        c += [
            PaletteCommand(title: L("common.settings"), subtitle: L("settings.languageSection"), icon: "gearshape") { SettingsWindow.open() },
            PaletteCommand(title: L("common.history"), subtitle: L("common.project"), icon: "clock.arrow.circlepath") { model.sheet = .history },
        ]
        if model.account?.loggedIn == true {
            c.append(PaletteCommand(title: L("usage.nav"), subtitle: L("billing.menu"), icon: "gauge.with.dots.needle.33percent") { model.screen = .usage })
            c.append(PaletteCommand(title: L("common.account"), subtitle: L("account.open"), icon: "person.crop.circle") { model.screen = .account })
        }
        if model.account?.isAdmin == true {
            c.append(PaletteCommand(title: L("admin.title"), subtitle: L("admin.subtitle"), icon: "person.2.badge.gearshape.fill") { model.screen = .admin })
        }
        c += [
            PaletteCommand(title: L("common.addProject"), subtitle: L("palette.pickFolder"), icon: "plus") { model.addProjectPanel() },
            PaletteCommand(title: L("newsite.button"), subtitle: L("newsite.subtitle"), icon: "sparkles.rectangle.stack") { model.sheet = .newSite },
        ]
        if let p = model.selected {
            c += [
                PaletteCommand(title: L("palette.checkProject", p.name), subtitle: L("palette.checkDetail"), icon: "arrow.triangle.2.circlepath") { model.runCheck() },
                PaletteCommand(title: "\(L("run.smartDeploy")) — \(p.name)", subtitle: L("palette.smartDetail"), icon: "bolt.fill") { model.smartDeploy() },
                PaletteCommand(title: "\(L("run.localPreview")) — \(p.name)", subtitle: L("palette.localDetail"), icon: "desktopcomputer") { model.localStart() },
                PaletteCommand(title: L("menu.commitPush"), subtitle: p.name, icon: "arrow.up.circle.fill") { model.sheet = .commit },
                PaletteCommand(title: "\(L("palette.production")) — \(p.name)", subtitle: L("palette.productionDetail"), icon: "paperplane.fill") { model.sheet = .release },
            ]
        }
        for p in model.projects {
            c.append(PaletteCommand(title: p.name, subtitle: L("palette.openProject"), icon: "folder.fill") { Task { await model.select(p.key) } })
        }
        return c
    }

    var visible: [PaletteCommand] { filtered }

    private func move(_ delta: Int) {
        let n = visible.count
        guard n > 0 else { return }
        selection = (selection + delta + n) % n
    }

    var filtered: [PaletteCommand] {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return commands }
        return commands.filter { $0.title.lowercased().contains(q) || $0.subtitle.lowercased().contains(q) }
    }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.scrim.ignoresSafeArea().onTapGesture { model.showPalette = false }
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundColor(Theme.tertiary)
                    TextField(L("palette.placeholder"), text: $query)
                        .textFieldStyle(.plain)
                        .font(Typo.font(.headline))
                        .foregroundColor(Theme.text)
                        .focused($searchFocused)
                        .onSubmit { run(visible.indices.contains(selection) ? visible[selection] : nil) }
                        .onChange(of: query) { _ in selection = 0 }
                    Text("⎋").font(Typo.font(.caption, weight: .semibold)).foregroundColor(Theme.tertiary)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: Radius.xs).fill(Theme.elevated))
                }
                .padding(16)
                Rectangle().fill(Theme.hairline).frame(height: 1)
                ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(Array(visible.enumerated()), id: \.element.id) { index, cmd in
                            Button { run(cmd) } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: cmd.icon).foregroundColor(index == selection ? .white : Theme.accent).frame(width: 22)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(cmd.title).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(index == selection ? .white : Theme.text)
                                        Text(cmd.subtitle).font(Typo.font(.callout)).foregroundColor(index == selection ? .white.opacity(0.75) : Theme.tertiary)
                                    }
                                    Spacer()
                                    if index == selection { Image(systemName: "return").foregroundColor(.white.opacity(0.8)) }
                                }
                                .padding(.horizontal, 12).padding(.vertical, 9)
                                .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(index == selection ? Theme.accentFill : Color.clear))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain).id(index)

                        }
                        if filtered.isEmpty {
                            Text(L("palette.nothingFound")).foregroundColor(Theme.tertiary).padding(20)
                        }
                    }
                    .padding(8)
                }
                .frame(maxHeight: 380)
                .onChange(of: selection) { value in withAnimation(Motion.quick) { proxy.scrollTo(value) } }
                }
            }
            .frame(width: 620)
            .background(RoundedRectangle(cornerRadius: Radius.l, style: .continuous).fill(Theme.panel))
            .overlay(RoundedRectangle(cornerRadius: Radius.l, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
            .glowBorder(Theme.accent, radius: 16, strength: 0.8)
            .elevation(.popover)
            .padding(.top, 110)
            .scaleEffect(appeared || Motion.reduced ? 1 : 0.94, anchor: .top)
            .opacity(appeared || Motion.reduced ? 1 : 0)
            .onAppear { withAnimation(.spring(response: 0.36, dampingFraction: 0.8)) { appeared = true } }
            // arrow keys move the highlight even while the search field has focus
            Group {
                Button("") { move(-1) }.keyboardShortcut(.upArrow, modifiers: [])
                Button("") { move(1) }.keyboardShortcut(.downArrow, modifiers: [])
            }
            .opacity(0)
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
        }
        .accessibilityAddTraits(.isModal)
        .onExitCommand { model.showPalette = false }
        .onAppear { DispatchQueue.main.async { searchFocused = true } }
    }

    func run(_ cmd: PaletteCommand?) {
        guard let cmd else { return }
        model.showPalette = false
        cmd.action()
    }
}
