import AppKit
import SwiftUI

// MARK: - Shared sheet chrome

// MARK: - Production

struct InfoRow: View {
    let label: String
    let value: String
    var tint: Color = Theme.text
    var body: some View {
        HStack {
            Text(label).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
            Spacer()
            Text(value).font(Typo.font(.body, weight: .medium)).foregroundColor(tint).lineLimit(1).truncationMode(.middle)
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
                                .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 120)
                    } else if let error {
                        Text(error).foregroundColor(Theme.blocked).font(Typo.font(.body))
                        Button(L("common.retry")) { Task { await load() } }.bidButton(.secondary, compact: true)
                    } else if mode == .link {
                        BIDTextField(placeholder: L("netlifySetup.searchSite"), text: $query)
                        ScrollView {
                            VStack(spacing: 4) {
                                ForEach(filtered) { site in
                                    SiteRow(site: site, selected: chosenSite == site.id)
                                        .tapAction { chosenSite = site.id }
                                }
                                if filtered.isEmpty {
                                    Text(L("netlifySetup.noSites")).foregroundColor(Theme.tertiary).font(Typo.font(.callout)).padding(20)
                                }
                            }
                        }
                        .frame(height: 240)
                        .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.bg))
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(L("netlifySetup.siteName")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                            BIDTextField(placeholder: "moyat-sait", text: $newName, mono: true)
                            Text("\(slug.isEmpty ? L("netlifySetup.namePlaceholder") : slug).netlify.app").font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.tertiary)
                        }
                        if teams.count > 1 {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(L("netlifySetup.team")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                                Menu {
                                    ForEach(teams) { t in Button(t.name ?? t.slug) { team = t.slug } }
                                } label: {
                                    Text(teams.first { $0.slug == team }?.name ?? team)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .menuStyle(.borderlessButton)
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.bg))
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
                Text(site.name).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                Text(site.url ?? "").font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            }
            Spacer()
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(selected ? Theme.elevated : .clear))
        .contentShape(Rectangle())
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
                    Text(L("commit.filesCount", included.count, files.count)).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
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
                                Text(f.code).font(Typo.font(.caption, weight: .bold, design: .monospaced)).foregroundColor(Theme.warn).frame(width: 20, alignment: .leading)
                                Text(f.path).font(Typo.font(.callout, design: .monospaced)).foregroundColor(on ? Theme.text : Theme.tertiary)
                                    .lineLimit(1).truncationMode(.middle)
                                Spacer()
                            }
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .tapAction {
                                if on { excluded.insert(f.path) } else { excluded.remove(f.path) }
                            }
                        }
                    }
                    .padding(6)
                }
                .frame(height: 220)
                .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.bg))

                VStack(alignment: .leading, spacing: 6) {
                    Text(L("commit.message")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                    BIDTextField(placeholder: L("commit.placeholder"), text: $message)
                }
                if model.status?.git.remote == nil {
                    Label(L("commit.noRemote"), systemImage: "info.circle")
                        .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
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
        return L("git.defaultMessage", f.string(from: Date()))
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
                    .font(Typo.font(.body)).foregroundColor(Theme.secondary)
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
                    .font(Typo.font(.body)).foregroundColor(Theme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let p = fix.preview, !p.isEmpty {
                    Text(p)
                        .font(Typo.font(.callout, design: .monospaced))
                        .foregroundColor(Theme.text)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.bg))
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
    @Local private var loadingHistory = true
    @Local private var historyError: String?

    var body: some View {
        SheetScaffold(icon: "clock.arrow.circlepath", title: L("historySheet.title"),
                      subtitle: all ? L("common.allProjects") : model.selected?.name, width: 760) {
            VStack(alignment: .leading, spacing: 10) {
                SegmentedControl(options: [(L("historySheet.thisProject"), false), (L("common.allProjects"), true)], selection: $all)
                    .frame(width: 320)
                ScrollView {
                    VStack(spacing: 0) {
                        if loadingHistory { LoadingState() }
                        else if let historyError { ErrorState(message: historyError, retry: { Task { await load() } }) }
                        else { ForEach(entries) { e in HistoryRow(entry: e, showProject: all) } }
                        if !loadingHistory && historyError == nil && entries.isEmpty {
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
        loadingHistory = true; historyError = nil
        do {
            let result = try await model.engine.call(args, as: [HistoryEntry].self)
            guard !Task.isCancelled else { return }; entries = result
        } catch { guard !Task.isCancelled else { return }; historyError = error.localizedDescription }
        loadingHistory = false
    }
}

// MARK: - Settings

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
                        .font(Typo.font(.callout, weight: .medium))
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
        SheetScaffold(icon: "plus.square.on.square", iconTint: Theme.accent, title: L("newsite.title"), subtitle: L("newsite.subtitle"), width: 780) {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(L("newsite.name")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                    BIDTextField(placeholder: L("newsite.namePlaceholder"), text: $name)
                }
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(L("newsite.template")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                        Spacer()
                        if !model.templates.isEmpty { Text(L("newsite.count", model.templates.count)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
                    }
                    if model.templates.isEmpty {
                        HStack(spacing: 8) { Spinner(size: 12); Text(L("newsite.loading")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary) }
                    } else {
                        TemplateGallery(templates: model.templates, selection: $template)
                    }
                }
                HStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(L("newsite.language")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                        SegmentedControl(options: [(Localization.nativeName("bg"), "bg"), (Localization.nativeName("en"), "en")], selection: $lang)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(L("newsite.folder")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                        HStack(spacing: 8) {
                            Text((dir as NSString).abbreviatingWithTildeInPath).font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.secondary).lineLimit(1).truncationMode(.middle)
                            Button(L("newsite.chooseFolder")) { pickFolder() }.bidButton(.secondary, compact: true)
                        }
                    }
                }
                Text(L("newsite.whatYouGet")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
                if let error { Label(error, systemImage: "exclamationmark.circle.fill").font(Typo.font(.body)).foregroundColor(Theme.blocked).fixedSize(horizontal: false, vertical: true) }
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

/// The template gallery in the "New site" sheet: category chips over a grid of cards, each with the
/// template's own accent, so the choice reads like a set of finished designs rather than a list of names.
struct TemplateGallery: View {
    let templates: [SiteTemplate]
    @Binding var selection: String
    @Local private var category = "all"

    private var categories: [(id: String, title: String)] {
        var seen = Set<String>()
        var out: [(String, String)] = [("all", L("newsite.allCategories"))]
        for t in templates {
            let id = t.category ?? "other"
            if seen.insert(id).inserted { out.append((id, t.categoryTitle ?? id)) }
        }
        return out
    }

    private var shown: [SiteTemplate] {
        category == "all" ? templates : templates.filter { ($0.category ?? "other") == category }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            FlowLayout(spacing: 6, lineSpacing: 6) {
                ForEach(categories, id: \.id) { c in
                    let on = category == c.id
                    Text(c.title)
                        .font(Typo.font(.callout, weight: on ? .semibold : .regular))
                        .foregroundColor(on ? .white : Theme.secondary)
                        .padding(.horizontal, 11).padding(.vertical, 5)
                        .background(Capsule().fill(on ? Theme.accent : Theme.elevated))
                        .fixedSize()
                        .contentShape(Capsule())
                        .tapAction { withAnimation(.easeOut(duration: 0.15)) { category = c.id } }
                        .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
                }
            }
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 166), spacing: 10, alignment: .top)], spacing: 10) {
                    ForEach(shown) { t in
                        TemplateCard(template: t, selected: selection == t.id) { selection = t.id }
                    }
                }
                .padding(2)
            }
            .frame(height: 300)
        }
    }
}

private struct TemplateCard: View {
    let template: SiteTemplate
    let selected: Bool
    let action: () -> Void

    private var tint: Color { Color(hexString: template.accent) ?? Theme.accent }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                ZStack(alignment: .topTrailing) {
                    RoundedRectangle(cornerRadius: Radius.s, style: .continuous)
                        .fill(LinearGradient(colors: [tint, tint.opacity(0.55)], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(height: 58)
                        .overlay(Image(systemName: template.icon ?? "doc.richtext").font(Typo.font(.title, weight: .semibold)).foregroundColor(.white))
                    if selected {
                        Image(systemName: "checkmark.circle.fill").font(Typo.font(.subhead)).foregroundStyle(.white, tint).padding(6)
                    }
                }
                Text(template.title).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text).lineLimit(1)
                Text(template.description).font(Typo.font(.caption)).foregroundColor(Theme.secondary).lineLimit(3).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Text(L("newsite.pages", template.pages)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 176, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).fill(selected ? tint.opacity(0.14) : Theme.elevated))
            .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(selected ? tint : Color.clear, lineWidth: 1.5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .lift(radius: Theme.smallRadius, amount: 1.02)
        .accessibilityLabel(template.title)
        .accessibilityHint(template.description)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private extension Color {
    /// "#RRGGBB" from the engine, or nil.
    init?(hexString: String?) {
        guard let s = hexString, s.hasPrefix("#"), s.count == 7, let v = UInt32(s.dropFirst(), radix: 16) else { return nil }
        self.init(hex: v)
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
                        Text(L("aikeys.orPlan")).font(Typo.font(.callout)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                        Spacer()
                        Button(L("aikeys.seePlans")) { dismiss(); model.sheet = .plans }.bidButton(.ghost, compact: true)
                    }
                }
                Text(L("aikeys.privacy")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
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
                    StepLine(n: 1, text: L("pushover.step1"))
                    StepLine(n: 2, text: L("pushover.step2"))
                    StepLine(n: 3, text: L("pushover.step3"))
                }
                HStack(spacing: 8) {
                    Button { model.open("https://pushover.net/") } label: { Label(L("pushover.openSite"), systemImage: "safari") }.bidButton(.secondary, compact: true)
                    Button { model.open("https://pushover.net/apps/build") } label: { Label(L("pushover.openBuild"), systemImage: "plus.app") }.bidButton(.ghost, compact: true)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(L("pushover.userKey")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                    BIDTextField(placeholder: "uQiRzpo4DXghDmr9QzzfQu27cmVRsG", text: $user, mono: true)
                    Text(L("pushover.token")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                    BIDField(placeholder: L("pushover.token"), text: $token, kind: .secure)
                }
                Text(L("pushover.keyNote")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
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
                Text(L("deleteAccount.explain")).font(Typo.font(.body)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                Text(L("deleteAccount.typeDelete")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
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
                Text(title).font(Typo.font(.body, weight: .medium)).foregroundColor(Theme.text)
                Text(subtitle).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 16)
            Toggle(title, isOn: $isOn)
                .toggleStyle(.switch)
                .labelsHidden()
                .tint(Theme.accent)
        }
    }
}
