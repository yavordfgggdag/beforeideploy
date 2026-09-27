import SwiftUI

struct SidebarView: View {
    @EnvironmentObject var model: AppModel

    var expiring: Int { model.spaceship?.domains.filter { ($0.daysLeft ?? 999) < 30 }.count ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                AppGlyph(size: 26)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Before I Deploy")
                        .font(.system(size: 13.5, weight: .bold))
                        .foregroundColor(Theme.text)
                    Text("Project Control Center")
                        .font(.system(size: 10.5))
                        .foregroundColor(Theme.tertiary)
                }
            }
            .padding(.top, 44)
            .padding(.horizontal, 18)
            .padding(.bottom, 22)

            VStack(spacing: 2) {
                NavRow(symbol: "square.grid.2x2.fill", title: "Mission Control", selected: model.screen == .overview) {
                    model.screen = .overview
                    Task { await model.loadOverview() }
                }
                NavRow(symbol: "network", title: "Домейни", selected: model.screen == .domains,
                       badge: expiring > 0 ? "\(expiring)" : nil) {
                    model.screen = .domains
                    Task { await model.loadSpaceship() }
                }
                NavRow(symbol: "creditcard.fill", title: "Разходи & кредити", selected: model.screen == .costs) {
                    model.screen = .costs
                    Task { await model.loadCosts() }
                }
                NavRow(symbol: "wand.and.stars", title: "Настройка", selected: model.screen == .setup,
                       badge: (model.setup?.missingRequired ?? 0) > 0 ? "\(model.setup?.missingRequired ?? 0)" : nil) {
                    model.screen = .setup
                    Task { await model.loadSetup() }
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 18)

            HStack {
                SectionLabel(text: "Проекти")
                Spacer()
                Text("\(model.projects.count)")
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundColor(Theme.tertiary)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 8)

            ScrollView {
                VStack(spacing: 2) {
                    ForEach(model.projects) { p in
                        ProjectRow(project: p, selected: model.screen == .project && p.key == model.selectedKey)
                            .onTapGesture { Task { await model.select(p.key) } }
                            .contextMenu {
                                Button("Покажи във Finder") { model.revealInFinder(p.path) }
                                Button("Отвори в Cursor") { model.openIn(app: ["Cursor", "Visual Studio Code"], path: p.path) }
                                Button("Отвори в Terminal") { model.openIn(app: ["Terminal"], path: p.path) }
                                Divider()
                                Button("Премахни от библиотеката") { model.removeProject(p.key) }
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
                        Text("Добави проект")
                        Spacer()
                        Text("⌘O").foregroundColor(Theme.tertiary).font(.system(size: 11))
                    }
                    .frame(maxWidth: .infinity)
                }
                .bidButton(.secondary)

                Button { model.showPalette = true } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                        Text("Търси или действай…")
                        Spacer()
                        Text("⌘K").foregroundColor(Theme.tertiary).font(.system(size: 11))
                    }
                    .font(.system(size: 12.5))
                    .foregroundColor(Theme.secondary)
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Theme.panel))
                }
                .buttonStyle(.plain)
                AccountBadge()
                HStack(spacing: 8) {
                    SidebarFooterButton(symbol: "clock.arrow.circlepath", title: "История") { model.sheet = .history }
                    SidebarFooterButton(symbol: "gearshape", title: "Настройки") { model.sheet = .settings }
                }
            }
            .padding(14)
        }
        .frame(maxHeight: .infinity)
        .background(Theme.sidebar)
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
            .font(.system(size: 12, weight: .medium))
            .foregroundColor(hover ? Theme.text : Theme.secondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(hover ? Theme.elevated : .clear))
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
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(selected ? Theme.accentSoft : Theme.elevated)
                Text(String(project.name.prefix(1)).uppercased())
                    .font(.system(size: 12.5, weight: .bold))
                    .foregroundColor(selected ? Theme.accent : Theme.secondary)
            }
            .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(project.name)
                    .font(.system(size: 13, weight: selected ? .semibold : .medium))
                    .foregroundColor(project.exists == false ? Theme.tertiary : Theme.text)
                    .lineLimit(1)
                Text(project.exists == false ? "папката липсва" : (subtitle.isEmpty ? "—" : subtitle))
                    .font(.system(size: 10.5))
                    .foregroundColor(Theme.tertiary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            StatusDot(status: project.lastStatus, size: 7)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(selected ? Theme.elevated : (hover ? Theme.panel : .clear))
        )
        .overlay(alignment: .leading) {
            if selected {
                Capsule().fill(Theme.accent).frame(width: 3, height: 18).offset(x: -6)
            }
        }
        .contentShape(Rectangle())
        .onHover { hover = $0 }
    }
}

struct NavRow: View {
    let symbol: String
    let title: String
    let selected: Bool
    var badge: String? = nil
    let action: () -> Void
    @Local private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundColor(selected ? Theme.accent : Theme.secondary)
                    .frame(width: 20)
                Text(title)
                    .font(.system(size: 13, weight: selected ? .semibold : .medium))
                    .foregroundColor(selected ? Theme.text : Theme.secondary)
                Spacer()
                if let badge {
                    Text(badge)
                        .font(.system(size: 10.5, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Theme.accent))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(selected ? Theme.accentSoft : (hover ? Theme.panel : .clear))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
