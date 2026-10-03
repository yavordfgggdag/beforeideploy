import AppKit
import SwiftUI
import WebKit

// Site Builder (S4): change a generated site with words. The site is shown from its folder; the owner types
// what to change ("make it darker", "remove the reviews", "add a section with prices"), the engine turns it
// into a commit (`bid site edit`), the preview reloads. Every edit is in the list below with Undo.

struct SiteEditSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var busy = false
    @Local private var info: SiteInfo?
    @Local private var device = "desktop"
    @Local private var page = "index"
    @Local private var reloadToken = 0

    private var project: Project? { model.status?.project }
    private var sheetWidth: CGFloat { min(1080, (NSApp.keyWindow?.screen?.visibleFrame.width ?? 1280) - 80) }
    private var sheetHeight: CGFloat { min(720, (NSApp.keyWindow?.screen?.visibleFrame.height ?? 900) - 120) }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Theme.hairline).frame(height: 1)
            HStack(spacing: 0) {
                if let project {
                    SiteTalkPane(project: project, canUndo: info?.history?.contains(where: { $0.kind == "edit" }) == true, onUndo: undo, onChanged: {
                        reloadToken += 1
                        Task { await loadInfo() }
                    })
                    .frame(width: 430)
                }
                Rectangle().fill(Theme.hairline).frame(width: 1)
                ZStack(alignment: .topTrailing) {
                    Theme.bg
                    if let project {
                        let framed = device != "desktop"
                        SiteFolderPreview(folder: project.path, file: pageFile, token: reloadToken)
                            .frame(maxWidth: device == "phone" ? 390 : device == "tablet" ? 768 : .infinity)
                            .clipShape(RoundedRectangle(cornerRadius: framed ? Radius.l : 0, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: framed ? Radius.l : 0, style: .continuous).strokeBorder(framed ? Theme.hairline : Color.clear, lineWidth: 1))
                            .padding(framed ? 14 : 0)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .padding(.top, 44)
                    }
                    HStack(spacing: 10) {
                        if let pages = info?.pages, pages.count > 1 {
                            Menu {
                                ForEach(pages, id: \.self) { p in Button(pageTitle(p)) { page = p } }
                            } label: { Label(pageTitle(page), systemImage: "doc.text") }
                                .menuStyle(.borderlessButton).fixedSize()
                                .accessibilityLabel(L("siteedit.page"))
                        }
                        SegmentedControl(options: [(L("newsite.desktop"), "desktop"), (L("siteedit.tablet"), "tablet"), (L("newsite.phone"), "phone")], selection: $device, icons: ["desktop": "desktopcomputer", "tablet": "ipad", "phone": "iphone"]).fixedSize()
                    }
                    .padding(10)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Rectangle().fill(Theme.hairline).frame(height: 1)
            HStack {
                if let project { Text((project.path as NSString).abbreviatingWithTildeInPath).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary).lineLimit(1).truncationMode(.middle) }
                Spacer()
                Button(L("common.done")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 22).padding(.vertical, 14)
        }
        .frame(width: sheetWidth, height: sheetHeight)
        .background(ZStack { Theme.panel; Theme.sheen })
        .task { await loadInfo() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.accent.opacity(0.14))
                RoundedRectangle(cornerRadius: Radius.m, style: .continuous).strokeBorder(Theme.accent.opacity(0.22), lineWidth: 1)
                Image(systemName: "text.bubble").font(Typo.icon(size: 16, weight: .semibold)).foregroundColor(Theme.accent)
            }
            .frame(width: 38, height: 38)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(L("siteedit.title")).font(Typo.font(.headline)).foregroundColor(Theme.text)
                Text(L("siteedit.subtitle")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            }
            Spacer()
            if let m = info?.modified, !m.isEmpty { Badge(text: L("siteedit.handEdited", m.count), icon: "pencil", tone: .warning) }
        }
        .padding(.horizontal, 22).padding(.vertical, 16)
    }

    /// `index` is index.html; every other page is <id>.html (sitegen/render.mjs).
    private var pageFile: String { page == "index" ? "index.html" : "\(page).html" }

    private func pageTitle(_ id: String) -> String { id == "index" ? L("siteedit.pageHome") : id.prefix(1).uppercased() + id.dropFirst() }

    private func loadInfo() async {
        guard let project else { return }
        info = await model.siteInfo(project)
    }

    private func undo() {
        guard let project, !busy else { return }
        busy = true
        Task {
            do {
                try await model.siteUndo(project)
                reloadToken += 1
                model.flash(L("siteedit.undone"))
            } catch { model.flash(error.localizedDescription, error: true) }
            busy = false
            await loadInfo()
        }
    }
}

/// A multi-line field that submits on ⌘↩.
struct SayField: View {
    @Binding var text: String
    let placeholder: String
    let onSubmit: () -> Void
    @FocusState private var focused: Bool
    var body: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty { Text(placeholder).font(Typo.font(.body)).foregroundColor(Theme.tertiary).padding(.horizontal, Space.m + 4).padding(.vertical, Space.m).allowsHitTesting(false) }
            TextEditor(text: $text)
                .font(Typo.font(.body))
                .foregroundColor(Theme.text)
                .scrollContentBackground(.hidden)
                .padding(Space.s)
                .frame(minHeight: 76)
                .focused($focused)
                .accessibilityLabel(placeholder)
        }
        .background(RoundedRectangle(cornerRadius: Radius.m).fill(Theme.inset))
        .overlay(RoundedRectangle(cornerRadius: Radius.m).strokeBorder(focused ? Theme.accent : Theme.hairline, lineWidth: focused ? 2 : 1))
        .onAppear { focused = true }
    }
}

/// The site as it is on disk: `index.html` from the project folder, reloaded when `token` changes.
private struct SiteFolderPreview: NSViewRepresentable {
    let folder: String
    var file = "index.html"
    let token: Int

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        view.allowsBackForwardNavigationGestures = false
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        let key = "\(folder)/\(file)#\(token)"
        guard context.coordinator.loaded != key else { return }
        context.coordinator.loaded = key
        let dir = URL(fileURLWithPath: folder, isDirectory: true)
        // a changed token reloads from disk; WebKit may otherwise serve the cached page
        view.loadFileURL(dir.appendingPathComponent(file), allowingReadAccessTo: dir)
    }

    final class Coordinator { var loaded = "" }
}
