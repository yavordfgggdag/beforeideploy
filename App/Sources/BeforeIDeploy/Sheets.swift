import AppKit
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
                    RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(iconTint.opacity(0.22), lineWidth: 1)
                    Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundColor(iconTint)
                }
                .frame(width: 38, height: 38)
                .shadow(color: iconTint.opacity(0.25), radius: 8, y: 2)
                .accessibilityHidden(true)
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
        .background(ZStack { Theme.panel; Theme.sheen })
    }
}

// MARK: - Production

struct ProductionSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var typed = ""

    var costText: String {
        if let p = model.costs?.prices.items["netlify:production"] {
            return p.amount == 0 ? L("common.free") : L("production.costEstimate", CostsView.amount(p.amount), CostsView.unitName(p.unit))
        }
        return L("production.costDefault")
    }

    var body: some View {
        let s = model.status
        let live = s?.project.netlify?.liveUrl ?? s?.lastProd?.url
        let warnings = s?.check?.steps.filter { $0.status == "warn" } ?? []
        SheetScaffold(icon: "paperplane.fill", iconTint: Theme.blocked, title: L("run.productionDeploy"),
                      subtitle: L("production.title", s?.project.name ?? "")) {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    InfoRow(label: L("production.site"), value: live.map(Fmt.host) ?? s?.project.netlify?.siteName ?? "—")
                    InfoRow(label: L("production.whatUploads"), value: s?.detect.ssr == true || s?.detect.hasFunctions == true
                            ? "Netlify build (framework / functions)"
                            : L("production.freshBuild", s?.detect.publishDir ?? "dist"))
                    InfoRow(label: L("production.branch"), value: s?.git.branch ?? "—")
                    InfoRow(label: L("production.uncommitted"), value: "\(s?.git.changedCount ?? 0)",
                            tint: (s?.git.changedCount ?? 0) > 0 ? Theme.warn : Theme.text)
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bg))

                HStack(spacing: 10) {
                    Image(systemName: "creditcard.fill").foregroundColor(Theme.accent)
                    Text(L("production.price", costText)).font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.text)
                    Spacer()
                    Button(L("production.costs")) { dismiss(); model.screen = .costs }.bidButton(.ghost, compact: true)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.accentSoft))

                if !warnings.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Label(L("production.warnings", count: warnings.count), systemImage: "exclamationmark.triangle.fill")
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundColor(Theme.warn)
                        ForEach(warnings) { w in
                            Text("• \(w.label ?? w.id): \(w.summary ?? "")")
                                .font(.system(size: 12)).foregroundColor(Theme.secondary)
                        }
                    }
                }

                Text(L("production.explain"))
                    .font(.system(size: 12))
                    .foregroundColor(Theme.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 6) {
                    Text(L("production.typeDeploy"))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(Theme.text)
                    BIDTextField(placeholder: "DEPLOY", text: $typed, mono: true)
                }
            }
        } actions: {
            Button(L("common.cancel")) { dismiss() }
                .bidButton(.secondary)
                .keyboardShortcut(.cancelAction)
            Button {
                dismiss()
                model.productionDeploy(confirm: typed)
            } label: {
                Label(L("production.deployButton"), systemImage: "paperplane.fill")
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
        SheetScaffold(icon: "globe", title: L("netlify.connectTitle"),
                      subtitle: L("netlifySetup.subtitle"),
                      width: 580) {
            VStack(alignment: .leading, spacing: 14) {
                if !loggedIn {
                    HStack {
                        Text(L("netlifySetup.signInFirst")).foregroundColor(Theme.secondary)
                        Spacer()
                        Button(L("netlify.signIn")) {
                            dismiss()
                            model.netlifyLogin { model.sheet = .netlifySetup }
                        }
                        .bidButton(.primary)
                    }
                } else {
                    SegmentedControl(options: [(L("netlifySetup.linkExisting"), Mode.link), (L("netlifySetup.createNew"), Mode.create)], selection: $mode)

                    if loading {
                        HStack(spacing: 8) {
                            Spinner(size: 14)
                            Text(L("netlifySetup.loading"))
                                .font(.system(size: 12)).foregroundColor(Theme.secondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 120)
                    } else if let error {
                        Text(error).foregroundColor(Theme.blocked).font(.system(size: 12.5))
                        Button(L("common.retry")) { Task { await load() } }.bidButton(.secondary, compact: true)
                    } else if mode == .link {
                        BIDTextField(placeholder: L("netlifySetup.searchSite"), text: $query)
                        ScrollView {
                            VStack(spacing: 4) {
                                ForEach(filtered) { site in
                                    SiteRow(site: site, selected: chosenSite == site.id)
                                        .onTapGesture { chosenSite = site.id }
                                }
                                if filtered.isEmpty {
                                    Text(L("netlifySetup.noSites")).foregroundColor(Theme.tertiary).font(.system(size: 12)).padding(20)
                                }
                            }
                        }
                        .frame(height: 240)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bg))
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(L("netlifySetup.siteName")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                            BIDTextField(placeholder: "moyat-sait", text: $newName, mono: true)
                            Text("\(slug.isEmpty ? L("netlifySetup.namePlaceholder") : slug).netlify.app").font(.system(size: 11.5, design: .monospaced)).foregroundColor(Theme.tertiary)
                        }
                        if teams.count > 1 {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(L("netlifySetup.team")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
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
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            if loggedIn {
                if mode == .link {
                    Button(L("common.connect")) {
                        guard let id = chosenSite else { return }
                        dismiss()
                        model.netlifyLink(siteId: id)
                    }
                    .bidButton(.primary)
                    .disabled(chosenSite == nil)
                } else {
                    Button(L("netlifySetup.createAndLink")) {
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
        SheetScaffold(icon: "arrow.up.circle.fill", title: L("run.commitPush"),
                      subtitle: "\(model.status?.git.branch ?? "") → \(Fmt.host(model.status?.git.githubUrl ?? "origin"))",
                      width: 600) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(L("commit.filesCount", included.count, files.count)).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                    Spacer()
                    Button(excluded.isEmpty ? L("commit.deselectAll") : L("commit.selectAll")) {
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
                    Text(L("commit.message")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                    BIDTextField(placeholder: L("commit.placeholder"), text: $message)
                }
                if model.status?.git.remote == nil {
                    Label(L("commit.noRemote"), systemImage: "info.circle")
                        .font(.system(size: 12)).foregroundColor(Theme.secondary)
                }
            }
        } actions: {
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button(L("commit.commitOnly")) {
                dismiss()
                model.commit(message: finalMessage, files: excluded.isEmpty ? nil : included, push: false)
            }
            .bidButton(.secondary)
            .disabled(included.isEmpty)
            if model.status?.git.remote != nil {
                Button {
                    dismiss()
                    model.commit(message: finalMessage, files: excluded.isEmpty ? nil : included, push: true)
                } label: { Label(L("run.commitPush"), systemImage: "arrow.up") }
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
        SheetScaffold(icon: "link", title: L("remote.sheetTitle"), subtitle: L("remote.title")) {
            VStack(alignment: .leading, spacing: 10) {
                Text(L("remote.steps"))
                    .font(.system(size: 12.5)).foregroundColor(Theme.secondary)
                Button { model.open("https://github.com/new") } label: { Label(L("remote.openNew"), systemImage: "arrow.up.right") }
                    .bidButton(.ghost, compact: true)
                BIDTextField(placeholder: "https://github.com/user/repo.git", text: $url, mono: true)
            }
        } actions: {
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button(L("common.save")) {
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
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button(L("fix.apply")) {
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
        SheetScaffold(icon: "clock.arrow.circlepath", title: L("historySheet.title"),
                      subtitle: all ? L("common.allProjects") : model.selected?.name, width: 760) {
            VStack(alignment: .leading, spacing: 10) {
                SegmentedControl(options: [(L("historySheet.thisProject"), false), (L("common.allProjects"), true)], selection: $all)
                    .frame(width: 320)
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(entries) { e in
                            HistoryRow(entry: e, showProject: all)
                        }
                        if entries.isEmpty {
                            Text(L("historySheet.empty")).foregroundColor(Theme.tertiary).padding(30)
                        }
                    }
                }
                .frame(height: 420)
            }
        } actions: {
            Button(L("common.close")) { dismiss() }.bidButton(.primary).keyboardShortcut(.defaultAction)
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
        SheetScaffold(icon: "gearshape.fill", title: L("common.settings"), subtitle: "Before I Deploy \(doctor.map { "v\($0.engine)" } ?? "")", width: 600) {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    SectionLabel(text: L("settings.languageSection"))
                    LanguageRow()
                }
                VStack(alignment: .leading, spacing: 10) {
                    SectionLabel(text: L("settings.behavior"))
                    ToggleRow(title: L("settings.autoOpenPreview"), subtitle: L("settings.autoOpenPreviewHint"), isOn: $autoOpenPreview)
                    ToggleRow(title: L("settings.autoCheck"), subtitle: L("settings.autoCheckHint"),
                              isOn: Binding(get: { model.autoCheck }, set: { model.autoCheck = $0 }))
                    ToggleRow(title: L("settings.checkOnSelect"), subtitle: L("settings.checkOnSelectHint"), isOn: $checkOnSelect)
                    ToggleRow(title: L("settings.notifications"), subtitle: L("settings.notificationsHint"), isOn: $notificationsEnabled)
                }
                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: L("settings.environment"))
                    if let d = doctor {
                        InfoRow(label: "Engine", value: "v\(d.engine)")
                        InfoRow(label: "Node", value: d.node.runtime == "bundled" ? L("engine.nodeBundled", d.node.version) : d.node.version)
                        InfoRow(label: "npm", value: d.npm?.version ?? "—")
                        if let p = d.pnpm { InfoRow(label: "pnpm", value: p.version) }
                        InfoRow(label: "git", value: d.git?.version ?? L("common.none"), tint: d.git == nil ? Theme.blocked : Theme.text)
                        InfoRow(label: "Netlify CLI", value: d.netlify?.version ?? (d.npx != nil ? L("settings.viaNpx") : L("common.none")))
                        InfoRow(label: L("settings.netlifyAccount"), value: d.netlifyAuth.email ?? (d.netlifyAuth.loggedIn ? L("common.signedInLower") : L("common.notSignedInLower")))
                        HStack {
                            Button(L("settings.dataFolder")) { model.openFile(d.appDir) }.bidButton(.ghost, compact: true)
                            Button(L("settings.logs")) { model.openFile(d.cacheDir) }.bidButton(.ghost, compact: true)
                        }
                    } else {
                        HStack { Spinner(size: 12); Text(L("settings.checking")).foregroundColor(Theme.secondary).font(.system(size: 12)) }
                    }
                }
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
                    Text(L("report.hint")).font(.system(size: 11)).foregroundColor(Theme.tertiary)
                    LegalLinks()
                }
                if model.account?.loggedIn == true {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: L("settings.account"))
                        HStack {
                            Button(L("account.export")) { model.exportAccountData() }.bidButton(.secondary, compact: true)
                            Button(L("account.deleteButton")) { model.sheet = .deleteAccount }.bidButton(.danger, compact: true)
                        }
                        Text(L("account.exportHint")).font(.system(size: 11)).foregroundColor(Theme.tertiary)
                    }
                }
            }
        } actions: {
            Button(L("common.done")) { dismiss() }.bidButton(.primary).keyboardShortcut(.defaultAction)
        }
        .task { doctor = try? await model.engine.call(["doctor"], as: DoctorInfo.self) }
    }
}

/// Privacy, Terms, Refund policy and "Contact support" — each only when its link is configured (audit B6/R6).
struct LegalLinks: View {
    @EnvironmentObject var model: AppModel
    private struct Item: Identifiable {
        let id: String
        let url: URL
    }
    var body: some View {
        let l = model.account?.links
        let items: [(String, URL?)] = [
            (L("legal.privacy"), l?.privacy.flatMap(URL.init(string:))),
            (L("legal.terms"), l?.terms.flatMap(URL.init(string:))),
            (L("legal.refund"), l?.refund.flatMap(URL.init(string:))),
            (L("legal.contact"), l?.support.flatMap { $0.contains("@") ? URL(string: "mailto:\($0)") : URL(string: $0) }),
        ]
        let shown = items.compactMap { title, url in url.map { Item(id: title, url: $0) } }
        if !shown.isEmpty {
            HStack(spacing: 14) {
                ForEach(shown) { item in
                    Button(item.id) { NSWorkspace.shared.open(item.url) }
                        .buttonStyle(.plain)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundColor(Theme.accent)
                }
            }
        }
    }
}

// MARK: - New site from a template (V11.1 Launchpad)

struct NewSiteSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var name = ""
    @Local private var template = "landing"
    @Local private var lang = Localization.current.hasPrefix("bg") ? "bg" : "en"
    @Local private var dir = (NSSearchPathForDirectoriesInDomains(.desktopDirectory, .userDomainMask, true).first ?? NSHomeDirectory())
    @Local private var busy = false
    @Local private var error: String?

    var body: some View {
        SheetScaffold(icon: "plus.square.on.square", iconTint: Theme.accent, title: L("newsite.title"), subtitle: L("newsite.subtitle"), width: 620) {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(L("newsite.name")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                    BIDTextField(placeholder: L("newsite.namePlaceholder"), text: $name)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(L("newsite.template")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                    if model.templates.isEmpty {
                        HStack(spacing: 8) { Spinner(size: 12); Text(L("newsite.loading")).font(.system(size: 12)).foregroundColor(Theme.tertiary) }
                    }
                    HStack(spacing: 10) {
                        ForEach(model.templates) { t in
                            Button { template = t.id } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Image(systemName: t.id == "portfolio" ? "rectangle.3.group" : "rectangle.inset.filled").foregroundColor(Theme.accent)
                                        Text(t.title).font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.text)
                                        Spacer()
                                        if template == t.id { Image(systemName: "checkmark.circle.fill").foregroundColor(Theme.accent) }
                                    }
                                    Text(t.description).font(.system(size: 11.5)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                                    Text(L("newsite.pages", t.pages)).font(.system(size: 10.5)).foregroundColor(Theme.tertiary)
                                }
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                                .background(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).fill(template == t.id ? Theme.accentSoft : Theme.elevated))
                                .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(template == t.id ? Theme.accent : Color.clear, lineWidth: 1))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .lift(radius: Theme.smallRadius, amount: 1.02)
                        }
                    }
                }
                HStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(L("newsite.language")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                        SegmentedControl(options: [(Localization.nativeName("bg"), "bg"), (Localization.nativeName("en"), "en")], selection: $lang)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(L("newsite.folder")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                        HStack(spacing: 8) {
                            Text((dir as NSString).abbreviatingWithTildeInPath).font(.system(size: 12, design: .monospaced)).foregroundColor(Theme.secondary).lineLimit(1).truncationMode(.middle)
                            Button(L("newsite.chooseFolder")) { pickFolder() }.bidButton(.secondary, compact: true)
                        }
                    }
                }
                Text(L("newsite.whatYouGet")).font(.system(size: 11.5)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
                if let error { Label(error, systemImage: "exclamationmark.circle.fill").font(.system(size: 12.5)).foregroundColor(Theme.blocked).fixedSize(horizontal: false, vertical: true) }
            }
        } actions: {
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button {
                busy = true
                error = nil
                Task {
                    let e = await model.createSite(name: name.trimmingCharacters(in: .whitespaces), template: template, dir: dir, lang: lang)
                    busy = false
                    if let e { error = e } else { dismiss() }
                }
            } label: {
                HStack { if busy { Spinner(size: 12, color: .white) }; Text(L("newsite.create")) }
            }
            .bidButton(.primary)
            .keyboardShortcut(.defaultAction)
            .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || model.templates.isEmpty)
        }
        .task { if model.templates.isEmpty { await model.loadTemplates() } }
    }

    private func pickFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = L("newsite.chooseFolder")
        panel.message = L("newsite.folderMessage")
        if panel.runModal() == .OK, let u = panel.url { dir = u.path }
    }
}

// MARK: - AI key (embedded AI on your own key)

/// One place to connect an Anthropic or OpenAI key: reached from every "AI" button when no key or plan is set.
struct AIKeysSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SheetScaffold(icon: "sparkles", iconTint: Theme.accent, title: L("aikeys.sheetTitle"), subtitle: L("aikeys.sheetSubtitle"), width: 560) {
            VStack(alignment: .leading, spacing: 12) {
                AIKeysCard()
                if model.account?.features?.billingPlans == true, model.account?.loggedIn == true {
                    HStack(spacing: 8) {
                        Image(systemName: "creditcard").foregroundColor(Theme.secondary)
                        Text(L("aikeys.orPlan")).font(.system(size: 12)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                        Spacer()
                        Button(L("aikeys.seePlans")) { dismiss(); model.sheet = .plans }.bidButton(.ghost, compact: true)
                    }
                }
                Text(L("aikeys.privacy")).font(.system(size: 11.5)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
            }
        } actions: {
            Button(L("common.done")) { dismiss() }.bidButton(.primary).keyboardShortcut(.defaultAction)
        }
    }
}

// MARK: - Pushover (phone notifications, V11.1)

/// Connects Pushover: the user key from the Pushover dashboard and the API token of an application the user
/// creates there. The engine verifies the pair with Pushover and keeps it in the Keychain; the app never
/// writes the keys anywhere and passes them through the environment, not argv.
struct PushoverSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var user = ""
    @Local private var token = ""
    @Local private var busy = false

    var body: some View {
        SheetScaffold(icon: "iphone.radiowaves.left.and.right", iconTint: Theme.accent, title: L("pushover.title"), subtitle: L("pushover.subtitle"), width: 560) {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 8) {
                    StepLine(n: 1, text: L("pushover.step1")).entrance(1, offset: 8)
                    StepLine(n: 2, text: L("pushover.step2")).entrance(2, offset: 8)
                    StepLine(n: 3, text: L("pushover.step3")).entrance(3, offset: 8)
                }
                HStack(spacing: 8) {
                    Button { model.open("https://pushover.net/") } label: { Label(L("pushover.openSite"), systemImage: "safari") }.bidButton(.secondary, compact: true)
                    Button { model.open("https://pushover.net/apps/build") } label: { Label(L("pushover.openBuild"), systemImage: "plus.app") }.bidButton(.ghost, compact: true)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(L("pushover.userKey")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                    BIDTextField(placeholder: "uQiRzpo4DXghDmr9QzzfQu27cmVRsG", text: $user, mono: true)
                    Text(L("pushover.token")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                    SecureField("azGDORePK8gMaC0QOYAMyEEuzJnyUi", text: $token)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13, design: .monospaced))
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).fill(Theme.bg))
                        .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
                }
                Text(L("pushover.keyNote")).font(.system(size: 11.5)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
            }
        } actions: {
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button {
                busy = true
                Task {
                    if await model.connectPushover(user: user, token: token) { dismiss() }
                    busy = false
                }
            } label: {
                if busy { Spinner(size: 12, color: .white) } else { Text(L("common.connect")) }
            }
            .bidButton(.primary)
            .keyboardShortcut(.defaultAction)
            .disabled(user.count < 30 || token.count < 30 || busy)
        }
    }
}

// MARK: - Delete account (GDPR, WP5)

struct DeleteAccountSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var confirm = ""
    @Local private var busy = false

    var body: some View {
        SheetScaffold(icon: "person.crop.circle.badge.xmark", iconTint: Theme.blocked, title: L("deleteAccount.title"), subtitle: model.account?.email ?? "", width: 520) {
            VStack(alignment: .leading, spacing: 12) {
                Text(L("deleteAccount.explain")).font(.system(size: 12.5)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                Text(L("deleteAccount.typeDelete")).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
                BIDTextField(placeholder: "DELETE", text: $confirm, mono: true)
            }
        } actions: {
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button(busy ? L("deleteAccount.deleting") : L("deleteAccount.confirm")) {
                busy = true
                Task {
                    if await model.deleteAccount(confirm: confirm) { dismiss() }
                    busy = false
                }
            }
            .bidButton(.danger)
            .disabled(confirm != "DELETE" || busy)
        }
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
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 16)
            Toggle("", isOn: $isOn)
                .toggleStyle(.switch)
                .labelsHidden()
                .tint(Theme.accent)
        }
    }
}
