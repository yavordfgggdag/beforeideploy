import SwiftUI

// MARK: - Shared sheet chrome

struct SheetScaffold<Content: View, Actions: View>: View {
    let icon: String
    var iconTint: Color = Theme.accent
    let title: String
    var subtitle: String? = nil
    var width: CGFloat = 520
    @ViewBuilder var content: Content
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 11, style: .continuous).fill(iconTint.opacity(0.14))
                    Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundColor(iconTint)
                }
                .frame(width: 38, height: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 17, weight: .bold)).foregroundColor(Theme.text)
                    if let subtitle { Text(subtitle).font(.system(size: 12)).foregroundColor(Theme.secondary) }
                }
                Spacer()
            }
            .padding(22)

            content
                .padding(.horizontal, 22)
                .padding(.bottom, 18)

            Rectangle().fill(Theme.hairline).frame(height: 1)
            HStack(spacing: 10) {
                Spacer()
                actions
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 14)
        }
        .frame(width: width)
        .background(Theme.panel)
    }
}

// MARK: - Production

struct ProductionSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var typed = ""

    var costText: String {
        if let p = model.costs?.prices.items["netlify:production"] {
            return p.amount == 0 ? "безплатно" : "~\(CostsView.amount(p.amount)) \(CostsView.unitName(p.unit)) (оценка)"
        }
        return "~15 кредита (оценка)"
    }

    var body: some View {
        let s = model.status
        let live = s?.project.netlify?.liveUrl ?? s?.lastProd?.url
        let warnings = s?.check?.steps.filter { $0.status == "warn" } ?? []
        SheetScaffold(icon: "paperplane.fill", iconTint: Theme.blocked, title: "Production Deploy",
                      subtitle: "Това ще обнови LIVE сайта на \(s?.project.name ?? "")") {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    InfoRow(label: "Сайт", value: live.map(Fmt.host) ?? s?.project.netlify?.siteName ?? "—")
                    InfoRow(label: "Какво се качва", value: s?.detect.ssr == true || s?.detect.hasFunctions == true
                            ? "Netlify build (framework / functions)"
                            : "\(s?.detect.publishDir ?? "dist")/ след свеж build")
                    InfoRow(label: "Branch", value: s?.git.branch ?? "—")
                    InfoRow(label: "Неприбрани промени", value: "\(s?.git.changedCount ?? 0)",
                            tint: (s?.git.changedCount ?? 0) > 0 ? Theme.warn : Theme.text)
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bg))

                HStack(spacing: 10) {
                    Image(systemName: "creditcard.fill").foregroundColor(Theme.accent)
                    Text("Цена: \(costText)").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.text)
                    Spacer()
                    Button("Разходи") { dismiss(); model.screen = .costs }.bidButton(.ghost, compact: true)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.accentSoft))

                if !warnings.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("\(warnings.count) предупреждение(я) от последната проверка", systemImage: "exclamationmark.triangle.fill")
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundColor(Theme.warn)
                        ForEach(warnings) { w in
                            Text("• \(w.label ?? w.id): \(w.summary ?? "")")
                                .font(.system(size: 12)).foregroundColor(Theme.secondary)
                        }
                    }
                }

                Text("Преди качването ще мине пълна проверка (Git → Secrets → Lint → Typecheck → Build). При грешка deploy-ът спира. Production може да използва build минути/кредити от Netlify плана ти.")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 6) {
                    Text("За да продължиш, напиши DEPLOY")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(Theme.text)
                    BIDTextField(placeholder: "DEPLOY", text: $typed, mono: true)
                }
            }
        } actions: {
            Button("Отказ") { dismiss() }
                .bidButton(.secondary)
                .keyboardShortcut(.cancelAction)
            Button {
                dismiss()
                model.productionDeploy(confirm: typed)
            } label: {
                Label("Deploy to Production", systemImage: "paperplane.fill")
            }
            .bidButton(.danger)
            .disabled(typed != "DEPLOY")
        }
    }
}

struct InfoRow: View {
    let label: String
    let value: String
    var tint: Color = Theme.text
    var body: some View {
        HStack {
            Text(label).font(.system(size: 12)).foregroundColor(Theme.tertiary)
            Spacer()
            Text(value).font(.system(size: 12.5, weight: .medium)).foregroundColor(tint).lineLimit(1).truncationMode(.middle)
        }
    }
}

// MARK: - Netlify setup

struct NetlifySetupSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss

    enum Mode { case link, create }
    @Local private var mode: Mode = .link
    @Local private var sites: [NetlifySite] = []
    @Local private var teams: [NetlifyTeam] = []
    @Local private var loading = false
    @Local private var error: String?
    @Local private var query = ""
    @Local private var chosenSite: String?
    @Local private var newName = ""
    @Local private var team = ""

    var loggedIn: Bool { model.status?.netlifyAuth.loggedIn == true }

    var filtered: [NetlifySite] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? sites : sites.filter { $0.name.lowercased().contains(q) || ($0.url ?? "").lowercased().contains(q) }
    }

    var body: some View {
        SheetScaffold(icon: "globe", title: "Свържи с Netlify",
                      subtitle: "Без `netlify init` — GitHub CI няма да се включи, deploy-ите остават ръчни",
                      width: 580) {
            VStack(alignment: .leading, spacing: 14) {
                if !loggedIn {
                    HStack {
                        Text("Първо влез в Netlify.").foregroundColor(Theme.secondary)
                        Spacer()
                        Button("Вход в Netlify") {
                            dismiss()
                            model.netlifyLogin { model.sheet = .netlifySetup }
                        }
                        .bidButton(.primary)
                    }
                } else {
                    SegmentedControl(options: [("Свържи съществуващ", Mode.link), ("Създай нов", Mode.create)], selection: $mode)

                    if loading {
                        HStack(spacing: 8) {
                            Spinner(size: 14)
                            Text("Зареждам от Netlify… (първия път през npx може да отнеме минута)")
                                .font(.system(size: 12)).foregroundColor(Theme.secondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 120)
                    } else if let error {
                        Text(error).foregroundColor(Theme.blocked).font(.system(size: 12.5))
                        Button("Опитай пак") { Task { await load() } }.bidButton(.secondary, compact: true)
                    } else if mode == .link {
                        BIDTextField(placeholder: "Търси сайт…", text: $query)
                        ScrollView {
                            VStack(spacing: 4) {
                                ForEach(filtered) { site in
                                    SiteRow(site: site, selected: chosenSite == site.id)
                                        .onTapGesture { chosenSite = site.id }
                                }
                                if filtered.isEmpty {
                                    Text("Няма намерени сайтове").foregroundColor(Theme.tertiary).font(.system(size: 12)).padding(20)
                                }
                            }
                        }
                        .frame(height: 240)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bg))
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Име на сайта").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                            BIDTextField(placeholder: "moyat-sait", text: $newName, mono: true)
                            Text("\(slug.isEmpty ? "име" : slug).netlify.app").font(.system(size: 11.5, design: .monospaced)).foregroundColor(Theme.tertiary)
                        }
                        if teams.count > 1 {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Team").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                                Menu {
                                    ForEach(teams) { t in Button(t.name ?? t.slug) { team = t.slug } }
                                } label: {
                                    Text(teams.first { $0.slug == team }?.name ?? team)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .menuStyle(.borderlessButton)
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.bg))
                            }
                        }
                    }
                }
            }
        } actions: {
            Button("Отказ") { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            if loggedIn {
                if mode == .link {
                    Button("Свържи") {
                        guard let id = chosenSite else { return }
                        dismiss()
                        model.netlifyLink(siteId: id)
                    }
                    .bidButton(.primary)
                    .disabled(chosenSite == nil)
                } else {
                    Button("Създай и свържи") {
                        dismiss()
                        model.netlifyCreate(name: slug, team: team.isEmpty ? nil : team)
                    }
                    .bidButton(.primary)
                    .disabled(slug.isEmpty)
                }
            }
        }
        .task { await load() }
    }

    var slug: String {
        let lowered = newName.lowercased()
        var out = ""
        for ch in lowered {
            if ch.isASCII && (ch.isLetter || ch.isNumber) { out.append(ch) } else if !out.hasSuffix("-") { out.append("-") }
        }
        return out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }

    func load() async {
        guard loggedIn else { return }
        loading = true
        error = nil
        defer { loading = false }
        if newName.isEmpty, let n = model.status?.project.name { newName = n }
        do {
            async let s = model.engine.call(["netlify", "sites"], as: [NetlifySite].self)
            async let t = model.engine.call(["netlify", "teams"], as: [NetlifyTeam].self)
            sites = try await s
            teams = (try? await t) ?? []
            if team.isEmpty { team = teams.first?.slug ?? "" }
            if let name = model.status?.project.name.lowercased(),
               let guess = sites.first(where: { $0.name.lowercased().contains(name) || name.contains($0.name.lowercased()) }) {
                chosenSite = guess.id
            }
            if sites.isEmpty { mode = .create }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct SiteRow: View {
    let site: NetlifySite
    let selected: Bool
    var body: some View {
        HStack {
            Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                .foregroundColor(selected ? Theme.accent : Theme.tertiary)
            VStack(alignment: .leading, spacing: 1) {
                Text(site.name).font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.text)
                Text(site.url ?? "").font(.system(size: 11)).foregroundColor(Theme.tertiary)
            }
            Spacer()
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(selected ? Theme.elevated : .clear))
        .contentShape(Rectangle())
    }
}

struct SegmentedControl<T: Hashable>: View {
    let options: [(String, T)]
    @Binding var selection: T
    var body: some View {
        HStack(spacing: 4) {
            ForEach(options.indices, id: \.self) { i in
                let opt = options[i]
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { selection = opt.1 }
                } label: {
                    Text(opt.0)
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundColor(selection == opt.1 ? Theme.text : Theme.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(selection == opt.1 ? Theme.hover : .clear))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Theme.bg))
    }
}

// MARK: - Commit

struct CommitSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var message = ""
    @Local private var excluded: Set<String> = []

    var files: [ChangedFile] { model.status?.git.changed ?? [] }
    var included: [String] { files.map(\.path).filter { !excluded.contains($0) } }

    var body: some View {
        SheetScaffold(icon: "arrow.up.circle.fill", title: "Commit & Push",
                      subtitle: "\(model.status?.git.branch ?? "") → \(Fmt.host(model.status?.git.githubUrl ?? "origin"))",
                      width: 600) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("\(included.count) от \(files.count) файла").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                    Spacer()
                    Button(excluded.isEmpty ? "Махни всички" : "Избери всички") {
                        excluded = excluded.isEmpty ? Set(files.map(\.path)) : []
                    }
                    .bidButton(.ghost, compact: true)
                }
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(files) { f in
                            let on = !excluded.contains(f.path)
                            HStack(spacing: 10) {
                                Image(systemName: on ? "checkmark.square.fill" : "square")
                                    .foregroundColor(on ? Theme.accent : Theme.tertiary)
                                Text(f.code).font(.system(size: 10.5, weight: .bold, design: .monospaced)).foregroundColor(Theme.warn).frame(width: 20, alignment: .leading)
                                Text(f.path).font(.system(size: 12, design: .monospaced)).foregroundColor(on ? Theme.text : Theme.tertiary)
                                    .lineLimit(1).truncationMode(.middle)
                                Spacer()
                            }
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                if on { excluded.insert(f.path) } else { excluded.remove(f.path) }
                            }
                        }
                    }
                    .padding(6)
                }
                .frame(height: 220)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bg))

                VStack(alignment: .leading, spacing: 6) {
                    Text("Съобщение").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                    BIDTextField(placeholder: "Какво промени?", text: $message)
                }
                if model.status?.git.remote == nil {
                    Label("Няма GitHub remote — ще направя само commit.", systemImage: "info.circle")
                        .font(.system(size: 12)).foregroundColor(Theme.secondary)
                }
            }
        } actions: {
            Button("Отказ") { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button("Само commit") {
                dismiss()
                model.commit(message: finalMessage, files: excluded.isEmpty ? nil : included, push: false)
            }
            .bidButton(.secondary)
            .disabled(included.isEmpty)
            if model.status?.git.remote != nil {
                Button {
                    dismiss()
                    model.commit(message: finalMessage, files: excluded.isEmpty ? nil : included, push: true)
                } label: { Label("Commit & Push", systemImage: "arrow.up") }
                    .bidButton(.primary)
                    .disabled(included.isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
        }
    }

    var finalMessage: String {
        let m = message.trimmingCharacters(in: .whitespacesAndNewlines)
        if !m.isEmpty { return m }
        let f = DateFormatter()
        f.dateFormat = "dd.MM.yyyy HH:mm"
        return "Update — \(f.string(from: Date()))"
    }
}

// MARK: - Remote

struct RemoteSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var url = ""

    var body: some View {
        SheetScaffold(icon: "link", title: "GitHub remote", subtitle: "Свържи проекта с GitHub repository") {
            VStack(alignment: .leading, spacing: 10) {
                Text("1. Създай празно repo в GitHub (без README).\n2. Постави URL-а му тук.")
                    .font(.system(size: 12.5)).foregroundColor(Theme.secondary)
                Button { model.open("https://github.com/new") } label: { Label("Отвори github.com/new", systemImage: "arrow.up.right") }
                    .bidButton(.ghost, compact: true)
                BIDTextField(placeholder: "https://github.com/user/repo.git", text: $url, mono: true)
            }
        } actions: {
            Button("Отказ") { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button("Запази") {
                dismiss()
                model.setRemote(url.trimmingCharacters(in: .whitespaces))
            }
            .bidButton(.primary)
            .disabled(!(url.contains("github.com") || url.hasPrefix("git@") || url.hasPrefix("https://")))
        }
    }
}

// MARK: - Fix confirm

struct FixConfirmSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let fix: FixItem

    var body: some View {
        SheetScaffold(icon: fix.risk == "caution" ? "exclamationmark.triangle.fill" : "wand.and.stars",
                      iconTint: fix.risk == "caution" ? Theme.warn : Theme.accent,
                      title: fix.title, subtitle: model.status?.project.name) {
            VStack(alignment: .leading, spacing: 12) {
                Text(fix.description)
                    .font(.system(size: 13)).foregroundColor(Theme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let p = fix.preview, !p.isEmpty {
                    Text(p)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(Theme.text)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.bg))
                }
            }
        } actions: {
            Button("Отказ") { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button("Приложи") {
                dismiss()
                model.applyFix(fix)
            }
            .bidButton(.primary)
            .keyboardShortcut(.defaultAction)
        }
    }
}

// MARK: - History

struct HistorySheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var all = false
    @Local private var entries: [HistoryEntry] = []

    var body: some View {
        SheetScaffold(icon: "clock.arrow.circlepath", title: "Deploy история",
                      subtitle: all ? "Всички проекти" : model.selected?.name, width: 760) {
            VStack(alignment: .leading, spacing: 10) {
                SegmentedControl(options: [("Този проект", false), ("Всички проекти", true)], selection: $all)
                    .frame(width: 320)
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(entries) { e in
                            HistoryRow(entry: e, showProject: all)
                        }
                        if entries.isEmpty {
                            Text("Няма записи").foregroundColor(Theme.tertiary).padding(30)
                        }
                    }
                }
                .frame(height: 420)
            }
        } actions: {
            Button("Затвори") { dismiss() }.bidButton(.primary).keyboardShortcut(.defaultAction)
        }
        .task(id: all) { await load() }
    }

    func load() async {
        var args = ["history", "--limit", "200"]
        if !all, let k = model.selectedKey { args += ["--project", k] }
        entries = (try? await model.engine.call(args, as: [HistoryEntry].self)) ?? []
    }
}

// MARK: - Settings

struct SettingsSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("autoOpenPreview") private var autoOpenPreview = true
    @AppStorage("checkOnSelect") private var checkOnSelect = false
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true
    @Local private var doctor: DoctorInfo?

    var body: some View {
        SheetScaffold(icon: "gearshape.fill", title: "Настройки", subtitle: "Before I Deploy V9", width: 600) {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    SectionLabel(text: "Поведение")
                    ToggleRow(title: "Отваряй preview автоматично", subtitle: "След успешен Draft / Production deploy", isOn: $autoOpenPreview)
                    ToggleRow(title: "Проверявай при избор на проект", subtitle: "Пуска пълна проверка (с build) щом избереш проект", isOn: $checkOnSelect)
                    ToggleRow(title: "macOS известия", subtitle: "Когато build / deploy приключи", isOn: $notificationsEnabled)
                }
                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: "Среда")
                    if let d = doctor {
                        InfoRow(label: "Engine", value: "v\(d.engine)")
                        InfoRow(label: "Node", value: d.node.version)
                        InfoRow(label: "npm", value: d.npm?.version ?? "—")
                        if let p = d.pnpm { InfoRow(label: "pnpm", value: p.version) }
                        InfoRow(label: "git", value: d.git?.version ?? "няма", tint: d.git == nil ? Theme.blocked : Theme.text)
                        InfoRow(label: "Netlify CLI", value: d.netlify?.version ?? (d.npx != nil ? "през npx" : "няма"))
                        InfoRow(label: "Netlify акаунт", value: d.netlifyAuth.email ?? (d.netlifyAuth.loggedIn ? "влязъл" : "не си влязъл"))
                        HStack {
                            Button("Папка с данни") { model.openFile(d.appDir) }.bidButton(.ghost, compact: true)
                            Button("Логове") { model.openFile(d.cacheDir) }.bidButton(.ghost, compact: true)
                        }
                    } else {
                        HStack { Spinner(size: 12); Text("Проверявам…").foregroundColor(Theme.secondary).font(.system(size: 12)) }
                    }
                }
            }
        } actions: {
            Button("Готово") { dismiss() }.bidButton(.primary).keyboardShortcut(.defaultAction)
        }
        .task { doctor = try? await model.engine.call(["doctor"], as: DoctorInfo.self) }
    }
}

struct ToggleRow: View {
    let title: String
    let subtitle: String
    @Binding var isOn: Bool
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13, weight: .medium)).foregroundColor(Theme.text)
                Text(subtitle).font(.system(size: 11.5)).foregroundColor(Theme.tertiary)
            }
            Spacer()
            Toggle("", isOn: $isOn)
                .toggleStyle(.switch)
                .labelsHidden()
                .tint(Theme.accent)
        }
    }
}
