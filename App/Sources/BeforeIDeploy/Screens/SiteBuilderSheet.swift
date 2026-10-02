import AppKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

// Site Builder (S2): "New site" in three screens — pick a theme, tell us about yourself, look and save.
// Every screen asks for one decision; the engine renders the preview (`bid new preview`) and, on save, writes
// the site (`bid new generate`). Nothing touches the disk before "Save". No AI in this package (S3).

/// Everything the wizard collects; one object so every field binds from any step.
final class SiteBuilderDraft: ObservableObject {
    @Published var step: SiteBuilderStep = .theme
    @Published var brief = SiteBrief(lang: Localization.current.hasPrefix("bg") ? "bg" : "en")
    @Published var query = ""
    @Published var category = "all"
    @Published var showAll = false
    @Published var dir = NSSearchPathForDirectoriesInDomains(.desktopDirectory, .userDomainMask, true).first ?? NSHomeDirectory()
    @Published var phone = false
    @Published var preview: [String: String] = [:]
    @Published var previewError: String?
    @Published var loadingPreview = false
    @Published var busy = false
    @Published var error: String?

    init() {
        brief.services = [SiteBrief.Service()]
        // screenshots (CI): a filled-in brief and the requested step, so every screen renders with real content
        if Snapshot.argument("BIDSnapshot"), let stepName = UserDefaults.standard.string(forKey: "BIDSiteBuilderStep") {
            brief.name = L("newsite.demo.name")
            brief.offer = L("newsite.demo.offer")
            brief.audience = L("newsite.demo.audience")
            brief.services = [
                SiteBrief.Service(name: L("newsite.demo.service1"), price: L("newsite.demo.price1"), text: L("newsite.demo.text1")),
                SiteBrief.Service(name: L("newsite.demo.service2"), price: L("newsite.demo.price2"), text: L("newsite.demo.text2")),
            ]
            brief.contacts = SiteBrief.Contacts(email: "iva@example.com", phone: "+359 888 000 000", instagram: "iva.coach", address: L("newsite.demo.address"), website: "")
            brief.style = "calm"
            brief.palette = "sand"
            step = SiteBuilderStep(rawValue: stepName) ?? .theme
        }
    }

    var nameOK: Bool { !brief.name.trimmingCharacters(in: .whitespaces).isEmpty }

    /// A key that changes whenever the preview would: the brief without photos (the preview never shows them).
    var previewKey: String {
        var b = brief
        b.photos = []
        return b.json()
    }
}

enum SiteBuilderStep: String, CaseIterable {
    case theme, details, preview
    var index: Int { Self.allCases.firstIndex(of: self) ?? 0 }
    var title: String {
        switch self {
        case .theme: return L("newsite.step.theme")
        case .details: return L("newsite.step.details")
        case .preview: return L("newsite.step.preview")
        }
    }
}

struct SiteBuilderSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var draft = SiteBuilderDraft()

    private var sheetWidth: CGFloat { min(1080, (NSApp.keyWindow?.screen?.visibleFrame.width ?? 1280) - 80) }
    private var sheetHeight: CGFloat { min(720, (NSApp.keyWindow?.screen?.visibleFrame.height ?? 900) - 120) }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Theme.hairline).frame(height: 1)
            Group {
                switch draft.step {
                case .theme: ThemeStep(draft: draft)
                case .details: DetailsStep(draft: draft)
                case .preview: PreviewStep(draft: draft)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Rectangle().fill(Theme.hairline).frame(height: 1)
            footer
        }
        .frame(width: sheetWidth, height: sheetHeight)
        .background(ZStack { Theme.panel; Theme.sheen })
        .task {
            if model.templates.isEmpty { await model.loadTemplates() }
            if model.siteStyles.isEmpty { await model.loadSiteStyles() }
            if draft.brief.style == nil, let t = model.templates.first(where: { $0.id == draft.brief.theme }) { draft.brief.style = t.style }
        }
        .task(id: draft.previewKey + (draft.step == .theme ? "theme" : "full")) {
            // the preview follows the theme on step 1 and the whole brief on step 3; step 2 renders nothing
            guard draft.step != .details, !model.templates.isEmpty || draft.step == .preview else { return }
            await loadPreview()
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Theme.accent.opacity(0.14))
                RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(Theme.accent.opacity(0.22), lineWidth: 1)
                Image(systemName: "sparkles.rectangle.stack").font(.system(size: 16, weight: .semibold)).foregroundColor(Theme.accent)
            }
            .frame(width: 38, height: 38)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(L("newsite.title")).font(Typo.font(.headline)).foregroundColor(Theme.text)
                Text(L("newsite.stepOf", draft.step.index + 1, SiteBuilderStep.allCases.count, draft.step.title)).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            }
            Spacer()
            HStack(spacing: 6) {
                ForEach(SiteBuilderStep.allCases, id: \.self) { s in
                    Capsule().fill(s.index <= draft.step.index ? Theme.accent : Theme.elevated).frame(width: s == draft.step ? 26 : 14, height: 6)
                        .animation(Motion.quick, value: draft.step)
                }
            }
            .accessibilityHidden(true)
        }
        .padding(.horizontal, 22).padding(.vertical, 16)
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if draft.step == .theme {
                Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            } else {
                Button(L("newsite.back")) { withAnimation(Motion.quick) { draft.step = draft.step == .preview ? .details : .theme } }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            }
            if let error = draft.error {
                Label(error, systemImage: "exclamationmark.circle.fill").font(Typo.font(.callout)).foregroundColor(Theme.blocked).lineLimit(2)
            }
            Spacer()
            switch draft.step {
            case .theme:
                Button(L("newsite.continue")) { withAnimation(Motion.quick) { draft.step = .details } }
                    .bidButton(.primary).keyboardShortcut(.defaultAction).disabled(model.templates.isEmpty)
            case .details:
                Text(L("newsite.free")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                Button(L("newsite.show")) { withAnimation(Motion.quick) { draft.step = .preview } }
                    .bidButton(.primary).keyboardShortcut(.defaultAction).disabled(!draft.nameOK)
            case .preview:
                Button(L("newsite.otherTheme")) { withAnimation(Motion.quick) { draft.step = .theme } }.bidButton(.secondary)
                Button {
                    save()
                } label: {
                    HStack { if draft.busy { Spinner(size: 12, color: .white) }; Text(L("newsite.save")) }
                }
                .bidButton(.primary).keyboardShortcut(.defaultAction).disabled(draft.busy || !draft.nameOK)
            }
        }
        .padding(.horizontal, 22).padding(.vertical, 14)
    }

    private func loadPreview() async {
        var brief = draft.brief
        if draft.step == .theme {
            // step 1 shows the theme as it ships, with the owner's name when they typed one
            brief = SiteBrief(theme: draft.brief.theme, lang: draft.brief.lang, name: draft.nameOK ? draft.brief.name : L("newsite.demo.name"), style: draft.brief.style, palette: draft.brief.palette)
        }
        draft.loadingPreview = true
        draft.previewError = nil
        do {
            let files = try await model.previewSite(brief)
            if !Task.isCancelled { draft.preview = files }
        } catch {
            if !Task.isCancelled { draft.previewError = error.localizedDescription }
        }
        draft.loadingPreview = false
    }

    private func save() {
        draft.busy = true
        draft.error = nil
        var brief = draft.brief
        brief.name = brief.name.trimmingCharacters(in: .whitespaces)
        Task {
            let e = await model.generateSite(brief, dir: draft.dir)
            draft.busy = false
            if let e { draft.error = e } else { dismiss() }
        }
    }
}

// MARK: - Step 1: theme

private struct ThemeStep: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var draft: SiteBuilderDraft

    private var categories: [(id: String, title: String)] {
        var seen = Set<String>()
        var out: [(String, String)] = [("all", L("newsite.allCategories"))]
        for t in model.templates {
            let id = t.category ?? "other"
            if seen.insert(id).inserted { out.append((id, t.categoryTitle ?? id)) }
        }
        return out
    }

    /// Featured first; a search in the owner's words ranks by title/description matches, "More" shows the rest.
    private var shown: [SiteTemplate] {
        let q = draft.query.trimmingCharacters(in: .whitespaces).lowercased()
        var list = model.templates.filter { draft.category == "all" || ($0.category ?? "other") == draft.category }
        if !q.isEmpty {
            let words = q.split(separator: " ").map(String.init)
            list = list.map { t -> (SiteTemplate, Int) in
                let hay = (t.title + " " + t.description + " " + (t.categoryTitle ?? "")).lowercased()
                return (t, words.reduce(0) { $0 + (hay.contains($1) ? 1 : 0) })
            }
            .filter { $0.1 > 0 }
            .sorted { $0.1 > $1.1 }
            .map { $0.0 }
            return list
        }
        if draft.showAll || draft.category != "all" { return list }
        return list.filter { $0.featured ?? false }
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                BIDField(placeholder: L("newsite.describePlaceholder"), text: $draft.query, kind: .search)
                FlowLayout(spacing: 6, lineSpacing: 6) {
                    ForEach(categories, id: \.id) { c in
                        let on = draft.category == c.id
                        Text(c.title)
                            .font(Typo.font(.callout, weight: on ? .semibold : .regular))
                            .foregroundColor(on ? .white : Theme.secondary)
                            .padding(.horizontal, 11).padding(.vertical, 5)
                            .background(Capsule().fill(on ? Theme.accent : Theme.elevated))
                            .fixedSize()
                            .contentShape(Capsule())
                            .tapAction { withAnimation(.easeOut(duration: 0.15)) { draft.category = c.id } }
                            .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
                    }
                }
                if model.templates.isEmpty {
                    HStack(spacing: 8) { Spinner(size: 12); Text(L("newsite.loading")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary) }
                    Spacer()
                } else {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10, alignment: .top)], spacing: 10) {
                            ForEach(shown) { t in
                                ThemeCard(template: t, selected: draft.brief.theme == t.id) {
                                    draft.brief.theme = t.id
                                    draft.brief.style = t.style
                                    draft.brief.palette = nil
                                }
                            }
                        }
                        .padding(2)
                        if draft.query.isEmpty, draft.category == "all", !draft.showAll, model.templates.count > shown.count {
                            Button(L("newsite.moreThemes", model.templates.count - shown.count)) { withAnimation(Motion.quick) { draft.showAll = true } }
                                .bidButton(.secondary, compact: true).padding(.top, 6)
                        }
                        if shown.isEmpty { EmptyState(icon: "magnifyingglass", title: L("newsite.noMatch"), message: L("newsite.noMatchHint")) }
                    }
                }
            }
            .padding(22)
            .frame(width: 520)
            Rectangle().fill(Theme.hairline).frame(width: 1)
            SitePreviewPane(draft: draft, caption: L("newsite.previewTheme"))
        }
    }
}

private struct ThemeCard: View {
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
                        .frame(height: 54)
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
            .frame(maxWidth: .infinity, minHeight: 164, alignment: .topLeading)
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

// MARK: - Step 2: details

private struct DetailsStep: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var draft: SiteBuilderDraft

    var body: some View {
        ScrollView {
            HStack(alignment: .top, spacing: 22) {
                VStack(alignment: .leading, spacing: 16) {
                    field(L("newsite.name"), required: true) { BIDTextField(placeholder: L("newsite.namePlaceholder"), text: $draft.brief.name) }
                    field(L("newsite.offer"), hint: L("newsite.offerHint")) { MultilineField(placeholder: L("newsite.offerPlaceholder"), text: $draft.brief.offer, lines: 3) }
                    field(L("newsite.audience"), hint: L("newsite.audienceHint")) { BIDTextField(placeholder: L("newsite.audiencePlaceholder"), text: $draft.brief.audience) }
                    field(L("newsite.services"), hint: L("newsite.servicesHint")) { ServicesEditor(services: $draft.brief.services) }
                    field(L("newsite.contacts"), hint: L("newsite.contactsHint")) {
                        VStack(spacing: 8) {
                            HStack(spacing: 8) {
                                BIDTextField(placeholder: L("newsite.contactEmail"), text: $draft.brief.contacts.email)
                                BIDTextField(placeholder: L("newsite.contactPhone"), text: $draft.brief.contacts.phone)
                            }
                            HStack(spacing: 8) {
                                BIDTextField(placeholder: L("newsite.contactInstagram"), text: $draft.brief.contacts.instagram)
                                BIDTextField(placeholder: L("newsite.contactAddress"), text: $draft.brief.contacts.address)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                VStack(alignment: .leading, spacing: 16) {
                    field(L("newsite.style"), hint: L("newsite.styleHint")) { StylePicker(draft: draft, styles: model.siteStyles) }
                    field(L("newsite.photos"), hint: L("newsite.photosHint")) { PhotosEditor(photos: $draft.brief.photos) }
                    field(L("newsite.language")) {
                        SegmentedControl(options: [(Localization.nativeName("bg"), "bg"), (Localization.nativeName("en"), "en")], selection: $draft.brief.lang)
                    }
                    field(L("newsite.folder"), hint: L("newsite.folderMessage")) {
                        HStack(spacing: 8) {
                            Text((draft.dir as NSString).abbreviatingWithTildeInPath).font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.secondary).lineLimit(1).truncationMode(.middle)
                            Spacer()
                            Button(L("newsite.chooseFolder")) { pickFolder() }.bidButton(.secondary, compact: true)
                        }
                    }
                }
                .frame(width: 380)
            }
            .padding(22)
        }
    }

    @ViewBuilder
    private func field<C: View>(_ title: String, required: Bool = false, hint: String? = nil, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(title).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                if !required { Text(L("newsite.optional")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
            }
            content()
            if let hint { Text(hint).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true) }
        }
    }

    private func pickFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = L("newsite.chooseFolder")
        panel.message = L("newsite.folderMessage")
        if panel.runModal() == .OK, let u = panel.url { draft.dir = u.path }
    }
}

/// A short multi-line text in the look of BIDField.
private struct MultilineField: View {
    let placeholder: String
    @Binding var text: String
    var lines: Int = 3
    @FocusState private var focused: Bool
    var body: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty { Text(placeholder).font(Typo.font(.body)).foregroundColor(Theme.tertiary).padding(.horizontal, Space.m + 4).padding(.vertical, Space.m).allowsHitTesting(false) }
            TextEditor(text: $text)
                .font(Typo.font(.body))
                .foregroundColor(Theme.text)
                .scrollContentBackground(.hidden)
                .padding(Space.s)
                .frame(minHeight: CGFloat(lines) * 20 + 16)
                .focused($focused)
                .accessibilityLabel(placeholder)
        }
        .background(RoundedRectangle(cornerRadius: Radius.m).fill(Theme.inset))
        .overlay(RoundedRectangle(cornerRadius: Radius.m).strokeBorder(focused ? Theme.accent : Theme.hairline, lineWidth: focused ? 2 : 1))
    }
}

private struct ServicesEditor: View {
    @Binding var services: [SiteBrief.Service]
    var body: some View {
        VStack(spacing: 8) {
            ForEach($services) { $s in
                HStack(spacing: 8) {
                    BIDTextField(placeholder: L("newsite.serviceName"), text: $s.name)
                    BIDTextField(placeholder: L("newsite.servicePrice"), text: $s.price).frame(width: 110)
                    BIDTextField(placeholder: L("newsite.serviceText"), text: $s.text)
                    IconButton(symbol: "minus", help: L("newsite.removeService")) { services.removeAll { $0.id == s.id } }
                        .disabled(services.count == 1 && s.name.isEmpty)
                }
            }
            if services.count < 8 {
                HStack {
                    Button { services.append(SiteBrief.Service()) } label: { Label(L("newsite.addService"), systemImage: "plus") }.bidButton(.secondary, compact: true)
                    Spacer()
                }
            }
        }
    }
}

/// Three styles with the four palettes of each: the owner picks a feel, then a colour. The theme's own look
/// stays when nothing is picked.
private struct StylePicker: View {
    @ObservedObject var draft: SiteBuilderDraft
    let styles: [String: SiteStyle]
    private let order = ["calm", "bold", "elegant"]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ForEach(order, id: \.self) { id in
                    let on = draft.brief.style == id
                    VStack(alignment: .leading, spacing: 6) {
                        Text(SiteBuilderText.style(id)).font(Typo.font(.body, weight: .semibold)).foregroundColor(on ? Theme.text : Theme.secondary)
                        Text(SiteBuilderText.styleHint(id)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 4) {
                            ForEach(styles[id]?.palettes ?? []) { p in
                                Circle().fill(Color(hexString: p.accent) ?? Theme.accent).frame(width: 10, height: 10)
                            }
                        }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .background(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).fill(on ? Theme.accent.opacity(0.12) : Theme.elevated))
                    .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(on ? Theme.accent : Color.clear, lineWidth: 1.5))
                    .tapAction { withAnimation(Motion.quick) { draft.brief.style = id; draft.brief.palette = nil } }
                    .accessibilityLabel(SiteBuilderText.style(id))
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            if let style = draft.brief.style, let s = styles[style] {
                HStack(spacing: 8) {
                    Text(L("newsite.palette")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                    ForEach(s.palettes) { p in
                        let on = draft.brief.palette == p.id
                        ZStack {
                            Circle().fill(Color(hexString: p.bg) ?? .white)
                            Circle().fill(LinearGradient(colors: [Color(hexString: p.accent) ?? Theme.accent, Color(hexString: p.accent2) ?? Theme.accent], startPoint: .topLeading, endPoint: .bottomTrailing)).padding(5)
                        }
                        .frame(width: 26, height: 26)
                        .overlay(Circle().strokeBorder(on ? Theme.accent : Theme.hairline, lineWidth: on ? 2 : 1))
                        .tapAction { withAnimation(Motion.quick) { draft.brief.palette = on ? nil : p.id } }
                        .help(SiteBuilderText.palette(p.id))
                        .accessibilityLabel(SiteBuilderText.palette(p.id))
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                    Spacer()
                }
            }
        }
    }
}

/// Photos: drop them on the zone or pick them; thumbnails with a remove button. Paths only — the engine copies
/// and resizes the files when the site is saved.
private struct PhotosEditor: View {
    @Binding var photos: [SiteBrief.Photo]
    @Local private var targeted = false
    private static let types: [UTType] = [.png, .jpeg, .gif, .webP, .heic]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !photos.isEmpty {
                FlowLayout(spacing: 8, lineSpacing: 8) {
                    ForEach(photos) { p in
                        ZStack(alignment: .topTrailing) {
                            Thumb(path: p.path)
                            Button { photos.removeAll { $0.path == p.path } } label: {
                                Image(systemName: "xmark.circle.fill").font(Typo.font(.subhead)).foregroundStyle(.white, .black.opacity(0.6))
                            }
                            .buttonStyle(.plain).padding(3).accessibilityLabel(L("newsite.removePhoto"))
                        }
                    }
                }
            }
            HStack(spacing: 10) {
                Image(systemName: "photo.on.rectangle.angled").foregroundColor(targeted ? Theme.accent : Theme.secondary)
                Text(photos.isEmpty ? L("newsite.dropPhotos") : L("newsite.dropMore")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                Spacer()
                Button(L("newsite.choosePhotos")) { pick() }.bidButton(.secondary, compact: true)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: Radius.m).fill(targeted ? Theme.accent.opacity(0.08) : Theme.inset))
            .overlay(RoundedRectangle(cornerRadius: Radius.m).strokeBorder(targeted ? Theme.accent : Theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
            .onDrop(of: [.fileURL], isTargeted: $targeted) { providers in
                for p in providers {
                    p.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                        guard let data = item as? Data, let url = URL(dataRepresentation: data, relativeTo: nil) else { return }
                        DispatchQueue.main.async { add([url]) }
                    }
                }
                return true
            }
        }
    }

    private func add(_ urls: [URL]) {
        for u in urls where Self.types.contains(where: { UTType(filenameExtension: u.pathExtension)?.conforms(to: $0) ?? false }) {
            if photos.count < 12, !photos.contains(where: { $0.path == u.path }) { photos.append(SiteBrief.Photo(path: u.path)) }
        }
    }

    private func pick() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = Self.types
        panel.prompt = L("newsite.choosePhotos")
        if panel.runModal() == .OK { add(panel.urls) }
    }

    private struct Thumb: View {
        let path: String
        var body: some View {
            Group {
                if let img = NSImage(contentsOfFile: path) {
                    Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
                } else {
                    Image(systemName: "photo").foregroundColor(Theme.secondary)
                }
            }
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: Radius.s, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
            .accessibilityLabel((path as NSString).lastPathComponent)
        }
    }
}

// MARK: - Step 3: preview

private struct PreviewStep: View {
    @ObservedObject var draft: SiteBuilderDraft
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(L("newsite.previewFull")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                if !draft.brief.photos.isEmpty { Text(L("newsite.photosOnSave", draft.brief.photos.count)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
                Spacer()
                SegmentedControl(options: [(L("newsite.desktop"), false), (L("newsite.phone"), true)], selection: $draft.phone, icons: [false: "desktopcomputer", true: "iphone"]).frame(width: 220)
            }
            .padding(.horizontal, 22).padding(.vertical, 10)
            SitePreviewPane(draft: draft, caption: nil)
        }
    }
}

/// The rendered site: a WKWebView over the engine's preview files, desktop or phone width.
private struct SitePreviewPane: View {
    @ObservedObject var draft: SiteBuilderDraft
    let caption: String?
    var body: some View {
        ZStack {
            Theme.bg
            if draft.preview.isEmpty {
                if let e = draft.previewError { ErrorState(message: e) } else { LoadingState(message: L("newsite.rendering")) }
            } else {
                WebPreview(files: draft.preview)
                    .frame(maxWidth: draft.phone ? 390 : .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: draft.phone ? Radius.l : 0, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: draft.phone ? Radius.l : 0, style: .continuous).strokeBorder(draft.phone ? Theme.hairline : Color.clear, lineWidth: 1))
                    .padding(draft.phone ? 14 : 0)
            }
            if draft.loadingPreview, !draft.preview.isEmpty {
                VStack { HStack { Spacer(); Spinner(size: 12).padding(10).background(Capsule().fill(Theme.panel)).padding(10) }; Spacer() }
            }
            if let caption {
                VStack { Spacer(); Text(caption).font(Typo.font(.caption)).foregroundColor(Theme.secondary).padding(.horizontal, 10).padding(.vertical, 5).background(Capsule().fill(Theme.panel)).padding(10) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(L("newsite.previewLabel"))
    }
}

/// `bid new preview` returns the site's files; the stylesheet is inlined and page links stay inside the preview.
private struct WebPreview: NSViewRepresentable {
    let files: [String: String]

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        let key = "\(files["index.html"]?.hashValue ?? 0)-\(files["styles.css"]?.hashValue ?? 0)"
        context.coordinator.files = files
        guard context.coordinator.loaded != key else { return }
        context.coordinator.loaded = key
        context.coordinator.show("index.html", in: view)
    }

    static let base = URL(string: "https://preview.beforeideploy.local/")!

    final class Coordinator: NSObject, WKNavigationDelegate {
        var files: [String: String] = [:]
        var loaded = ""
        var page = "index.html"

        func show(_ name: String, in view: WKWebView) {
            guard let html = files[name] else { return }
            page = name
            let css = files["styles.css"] ?? ""
            let inlined = html.replacingOccurrences(of: "<link rel=\"stylesheet\" href=\"/styles.css\">", with: "<style>\(css)</style>")
            view.loadHTMLString(inlined, baseURL: WebPreview.base)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url else { return decisionHandler(.allow) }
            let path = url.path
            let name = path.isEmpty || path == "/" ? "index.html" : String(path.dropFirst())
            if name == page, url.fragment != nil { return decisionHandler(.allow) }
            if files[name] != nil { show(name, in: webView) } else if files["\(name).html"] != nil { show("\(name).html", in: webView) }
            decisionHandler(.cancel)
        }
    }
}

/// The names of styles and palettes, by their engine ids.
enum SiteBuilderText {
    static func style(_ id: String) -> String {
        switch id {
        case "calm": return L("newsite.style.calm")
        case "bold": return L("newsite.style.bold")
        case "elegant": return L("newsite.style.elegant")
        default: return id
        }
    }
    static func styleHint(_ id: String) -> String {
        switch id {
        case "calm": return L("newsite.style.calm.hint")
        case "bold": return L("newsite.style.bold.hint")
        case "elegant": return L("newsite.style.elegant.hint")
        default: return ""
        }
    }
    static func palette(_ id: String) -> String {
        switch id {
        case "sand": return L("newsite.palette.sand")
        case "forest": return L("newsite.palette.forest")
        case "terracotta": return L("newsite.palette.terracotta")
        case "sea": return L("newsite.palette.sea")
        case "lemon": return L("newsite.palette.lemon")
        case "indigo": return L("newsite.palette.indigo")
        case "coral": return L("newsite.palette.coral")
        case "electric": return L("newsite.palette.electric")
        case "ivory": return L("newsite.palette.ivory")
        case "bordeaux": return L("newsite.palette.bordeaux")
        case "olive": return L("newsite.palette.olive")
        case "champagne": return L("newsite.palette.champagne")
        default: return id
        }
    }
}

extension Color {
    /// "#RRGGBB" from the engine, or nil.
    init?(hexString: String?) {
        guard let s = hexString, s.hasPrefix("#"), s.count == 7, let v = UInt32(s.dropFirst(), radix: 16) else { return nil }
        self.init(hex: v)
    }
}
