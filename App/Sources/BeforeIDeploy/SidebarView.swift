import SwiftUI

/// The sidebar's selection pill slides between rows (matchedGeometryEffect through the environment).
struct NavNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}
extension EnvironmentValues {
    var navNamespace: Namespace.ID? {
        get { self[NavNamespaceKey.self] }
        set { self[NavNamespaceKey.self] = newValue }
    }
}

struct SidebarView: View {
    @EnvironmentObject var model: AppModel
    @Namespace private var navPill

    var expiring: Int { model.spaceship?.domains.filter { ($0.daysLeft ?? 999) < 30 }.count ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                AppGlyph(size: 26).breath(Theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Before I Deploy")
                        .font(Typo.font(.subhead, weight: .bold))
                        .foregroundColor(Theme.text)
                    Text(L("sidebar.tagline"))
                        .font(Typo.font(.caption))
                        .foregroundColor(Theme.tertiary)
                }
            }
            .padding(.top, 44)
            .padding(.horizontal, 18)
            .padding(.bottom, 22)

            VStack(spacing: 2) {
                NavRow(symbol: "square.grid.2x2.fill", title: L("nav.missionControl"), selected: model.screen == .overview) {
                    model.screen = .overview
                    Task { await model.loadOverview() }
                }
                NavRow(symbol: "network", title: L("common.domains"), selected: model.screen == .domains,
                       badge: expiring > 0 ? "\(expiring)" : nil) {
                    model.screen = .domains
                    Task { await model.loadSpaceship() }
                }
                NavRow(symbol: "sparkles", title: L("assistant.nav"), selected: model.screen == .assistant) {
                    model.screen = .assistant
                    Task { await model.assistantStore.load() }
                }
                NavRow(symbol: "creditcard.fill", title: L("common.costs"), selected: model.screen == .costs) {
                    model.screen = .costs
                    Task { await model.loadCosts() }
                }
                NavRow(symbol: "wand.and.stars", title: L("common.setup"), selected: model.screen == .setup,
                       badge: (model.setup?.missingRequired ?? 0) > 0 ? "\(model.setup?.missingRequired ?? 0)" : nil) {
                    model.screen = .setup
                    Task { await model.loadSetup() }
                }
                if model.account?.loggedIn == true {
                    NavRow(symbol: "gauge.with.dots.needle.33percent", title: L("usage.nav"), selected: model.screen == .usage) {
                        model.screen = .usage
                        Task { await model.billingStore.loadUsage() }
                    }
                    NavRow(symbol: "person.crop.circle.fill", title: L("common.account"), selected: model.screen == .account) {
                        model.screen = .account
                    }
                }
                if model.account?.isAdmin == true {
                    NavRow(symbol: "person.2.badge.gearshape.fill", title: L("admin.title"), selected: model.screen == .admin) {
                        model.screen = .admin
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 18)
            .environment(\.navNamespace, navPill)
            .animation(Motion.spring, value: model.screen)

            HStack {
                SectionLabel(text: L("common.projects"))
                Spacer()
                Text("\(model.projects.count)")
                    .font(Typo.font(.caption, weight: .semibold))
                    .foregroundColor(Theme.tertiary)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 8)

            ScrollView {
                VStack(spacing: 2) {
                    ForEach(model.projects) { p in
                        ProjectRow(project: p, selected: model.screen == .project && p.key == model.selectedKey)
                            .tapAction { Task { await model.select(p.key) } }
                            .contextMenu {
                                Button(L("common.showInFinder")) { model.revealInFinder(p.path) }
                                Button(L("sidebar.openInCursor")) { model.openIn(app: ["Cursor", "Visual Studio Code"], path: p.path) }
                                Button(L("common.openInTerminal")) { model.openIn(app: ["Terminal"], path: p.path) }
                                Divider()
                                Button(L("client.set")) { Task { await model.select(p.key, show: false); model.sheet = .client } }
                                Divider()
                                Button(L("sidebar.remove")) { model.removeProject(p.key) }
                            }
                    }
                }
                .padding(.horizontal, 10)
            }

            Spacer(minLength: 0)

            VStack(spacing: 8) {
                Button {
                    model.addProjectPanel()
                } label: {
                    HStack {
                        Image(systemName: "plus")
                        Text(L("common.addProject"))
                        Spacer()
                        Text("⌘O").foregroundColor(Theme.tertiary).font(Typo.font(.caption))
                    }
                    .frame(maxWidth: .infinity)
                }
                .bidButton(.secondary)

                Button { model.sheet = .newSite } label: {
                    HStack {
                        Image(systemName: "sparkles.rectangle.stack")
                        Text(L("newsite.button"))
                        Spacer()
                    }
                    .frame(maxWidth: .infinity)
                }
                .bidButton(.primary)
                .help(L("newsite.buttonHelp"))

                Button { model.showPalette = true } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                        Text(L("sidebar.search"))
                        Spacer()
                        Text("⌘K").foregroundColor(Theme.tertiary).font(Typo.font(.caption))
                    }
                    .font(Typo.font(.body))
                    .foregroundColor(Theme.secondary)
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.panel))
                }
                .buttonStyle(.plain)
                if let u = model.update, u.available {
                    UpdateBanner(info: u)
                }
                AccountBadge()
                HStack(spacing: 8) {
                    SidebarFooterButton(symbol: "clock.arrow.circlepath", title: L("common.history")) { model.sheet = .history }
                    SidebarFooterButton(symbol: "gearshape", title: L("common.settings")) { model.sheet = .settings }
                }
            }
            .padding(14)
        }
        .frame(maxHeight: .infinity)
        .background(Theme.sidebar)
    }
}

/// "New version X" with a Download button (WP6.3). The DMG is verified by the engine and opened by the app.
struct UpdateBanner: View {
    @EnvironmentObject var model: AppModel
    let info: UpdateInfo

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.down.circle.fill").foregroundColor(Theme.accent)
            VStack(alignment: .leading, spacing: 1) {
                Text(L("update.available", info.latest ?? "")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                if let n = info.notes?[Localization.current] ?? info.notes?["en"] {
                    Text(n).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).lineLimit(2)
                }
            }
            Spacer()
            Button(L("update.download")) { model.downloadUpdate() }
                .bidButton(.primary, compact: true)
                .disabled(model.busy.contains("update"))
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.accentSoft))
    }
}

struct SidebarFooterButton: View {
    let symbol: String
    let title: String
    let action: () -> Void
    @Local private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol)
                Text(title)
            }
            .font(Typo.font(.callout, weight: .medium))
            .foregroundColor(hover ? Theme.text : Theme.secondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(hover ? Theme.elevated : .clear))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

struct ProjectRow: View {
    let project: Project
    let selected: Bool
    @Local private var hover = false

    var subtitle: String {
        [project.framework, project.packageManager].compactMap { $0 }.filter { $0 != "unknown" }.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 10) {
            ProjectAvatar(name: project.name, size: 28, dimmed: project.exists == false)

            VStack(alignment: .leading, spacing: 2) {
                Text(project.name)
                    .font(Typo.font(.body, weight: selected ? .semibold : .medium))
                    .foregroundColor(project.exists == false ? Theme.tertiary : Theme.text)
                    .lineLimit(1)
                Text(project.exists == false ? L("sidebar.folderMissing") : (subtitle.isEmpty ? "—" : subtitle))
                    .font(Typo.font(.caption))
                    .foregroundColor(Theme.tertiary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            if project.lastStatus == "blocked" {
                StatusDot(status: project.lastStatus, size: 7).frame(width: 12, height: 12)
            } else {
                StatusDot(status: project.lastStatus, size: 7)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: Radius.m, style: .continuous)
                .fill(selected ? Theme.elevated : (hover ? Theme.panel : .clear))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.m, style: .continuous)
                .strokeBorder(selected ? Theme.edgeHighlight : LinearGradient(colors: [.clear], startPoint: .top, endPoint: .bottom), lineWidth: 1)
        )
        .overlay(alignment: .leading) {
            if selected {
                Capsule().fill(Theme.accentGradient).frame(width: 3, height: 18).offset(x: -6)
                    .elevation(.popover)
            }
        }
        .contentShape(Rectangle())
        .scaleEffect(hover && !Motion.reduced ? 1.015 : 1)
        .onHover { hover = $0 }
        .animation(Motion.quick, value: hover)
        .animation(Motion.quick, value: selected)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }
}

struct NavRow: View {
    let symbol: String
    let title: String
    let selected: Bool
    var badge: String? = nil
    let action: () -> Void
    @Local private var hover = false
    @Environment(\.navNamespace) private var ns

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(Typo.font(.body, weight: .semibold))
                    .foregroundColor(selected ? Theme.accent : Theme.secondary)
                    .frame(width: 20)
                    .scaleEffect(hover && !Motion.reduced ? 1.12 : 1)
                    .rotationEffect(.degrees(hover && !Motion.reduced ? -6 : 0))
                Text(title)
                    .font(Typo.font(.body, weight: selected ? .semibold : .medium))
                    .foregroundColor(selected ? Theme.text : Theme.secondary)
                Spacer()
                if let badge {
                    Text(badge)
                        .font(Typo.font(.caption, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Theme.accentFill))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background {
                if selected {
                    let pill = RoundedRectangle(cornerRadius: Radius.s, style: .continuous)
                        .fill(LinearGradient(colors: [Theme.accent.opacity(0.28), Theme.accent.opacity(0.10)], startPoint: .leading, endPoint: .trailing))
                        .overlay(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).strokeBorder(Theme.accent.opacity(0.32), lineWidth: 1))
                        .elevation(.popover)
                    if let ns { pill.matchedGeometryEffect(id: "nav-pill", in: ns) } else { pill }
                } else {
                    RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(hover ? Theme.panel : .clear)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .animation(Motion.quick, value: hover)
        .animation(Motion.quick, value: selected)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
