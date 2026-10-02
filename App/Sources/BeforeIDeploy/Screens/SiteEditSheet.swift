import AppKit
import SwiftUI
import WebKit

// Site Builder (S4): change a generated site with words. The site is shown from its folder; the owner types
// what to change ("make it darker", "remove the reviews", "add a section with prices"), the engine turns it
// into a commit (`bid site edit`), the preview reloads. Every edit is in the list below with Undo.

struct SiteEditSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var say = ""
    @Local private var busy = false
    @Local private var error: String?
    @Local private var modifiedFiles: [String] = []
    @Local private var last: SiteEditResult?
    @Local private var steps: [String] = []
    @Local private var info: SiteInfo?
    @Local private var phone = false
    @Local private var reloadToken = 0

    private var project: Project? { model.status?.project }
    private var sheetWidth: CGFloat { min(1080, (NSApp.keyWindow?.screen?.visibleFrame.width ?? 1280) - 80) }
    private var sheetHeight: CGFloat { min(720, (NSApp.keyWindow?.screen?.visibleFrame.height ?? 900) - 120) }
    private let examples = ["siteedit.example.darker", "siteedit.example.reviews", "siteedit.example.prices", "siteedit.example.title", "siteedit.example.calm"]

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Theme.hairline).frame(height: 1)
            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(L("siteedit.say")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                    SayField(text: $say, placeholder: L("siteedit.placeholder"), onSubmit: { apply(force: false) })
                    FlowLayout(spacing: 6, lineSpacing: 6) {
                        ForEach(examples, id: \.self) { key in
                            Text(L(key)).font(Typo.font(.caption)).foregroundColor(Theme.secondary)
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Capsule().fill(Theme.elevated)).fixedSize().contentShape(Capsule())
                                .tapAction { say = L(key) }
                        }
                    }
                    HStack(spacing: 10) {
                        Button {
                            apply(force: false)
                        } label: {
                            HStack { if busy { Spinner(size: 12, color: .white) }; Text(L("siteedit.apply")) }
                        }
                        .bidButton(.primary).keyboardShortcut(.defaultAction).disabled(busy || say.trimmingCharacters(in: .whitespaces).isEmpty)
                        Text(model.aiReady ? L("siteedit.costHint") : L("siteedit.localOnlyHint")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).fixedSize(horizontal: false, vertical: true)
                    }
                    if busy, !steps.isEmpty { Text(steps.last ?? "").font(Typo.font(.caption)).foregroundColor(Theme.secondary) }
                    if let error {
                        VStack(alignment: .leading, spacing: 8) {
                            Label(error, systemImage: "exclamationmark.circle.fill").font(Typo.font(.callout)).foregroundColor(Theme.blocked).fixedSize(horizontal: false, vertical: true)
                            if !modifiedFiles.isEmpty {
                                Button(L("siteedit.replaceAnyway")) { apply(force: true) }.bidButton(.danger, compact: true)
                            }
                        }
                    }
                    if let last {
                        VStack(alignment: .leading, spacing: 4) {
                            Label(last.summary.isEmpty ? L("siteedit.applied", count: last.applied.count) : last.summary, systemImage: "checkmark.circle.fill").font(Typo.font(.callout)).foregroundColor(Theme.ready).fixedSize(horizontal: false, vertical: true)
                            if let charged = last.usage?.charged { Text(L("newsite.ai.charged", charged)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
                            if !last.refused.isEmpty { Text(L("siteedit.refused", last.refused.joined(separator: " · "))).font(Typo.font(.caption)).foregroundColor(Theme.warn).fixedSize(horizontal: false, vertical: true) }
                        }
                    }
                    Rectangle().fill(Theme.hairline).frame(height: 1).padding(.vertical, 4)
                    HStack {
                        Text(L("siteedit.history")).font(Typo.font(.callout, weight: .semibold)).foregroundColor(Theme.text)
                        Spacer()
                        if info?.history?.contains(where: { $0.kind == "edit" }) == true {
                            Button(L("siteedit.undo")) { undo() }.bidButton(.secondary, compact: true).disabled(busy)
                        }
                    }
                    ScrollView {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(info?.history ?? []) { h in
                                HStack(alignment: .top, spacing: 8) {
                                    Image(systemName: h.kind == "undo" ? "arrow.uturn.backward" : h.kind == "created" ? "sparkles" : "text.bubble").foregroundColor(Theme.secondary).frame(width: 16).accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(h.say).font(Typo.font(.callout)).foregroundColor(Theme.text).lineLimit(2)
                                        Text(Fmt.relative(h.at)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                                    }
                                }
                            }
                            if info?.history?.isEmpty ?? true { Text(L("siteedit.noHistory")).font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(22)
                .frame(width: 400)
                Rectangle().fill(Theme.hairline).frame(width: 1)
                ZStack(alignment: .topTrailing) {
                    Theme.bg
                    if let project {
                        SiteFolderPreview(folder: project.path, token: reloadToken)
                            .frame(maxWidth: phone ? 390 : .infinity)
                            .clipShape(RoundedRectangle(cornerRadius: phone ? Radius.l : 0, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: phone ? Radius.l : 0, style: .continuous).strokeBorder(phone ? Theme.hairline : Color.clear, lineWidth: 1))
                            .padding(phone ? 14 : 0)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    SegmentedControl(options: [(L("newsite.desktop"), false), (L("newsite.phone"), true)], selection: $phone, icons: [false: "desktopcomputer", true: "iphone"]).frame(width: 200).padding(10)
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

    private func loadInfo() async {
        guard let project else { return }
        info = await model.siteInfo(project)
    }

    private func apply(force: Bool) {
        guard let project, !busy else { return }
        let words = say.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return }
        busy = true
        error = nil
        modifiedFiles = []
        steps = []
        Task {
            do {
                let r = try await model.siteEdit(project, say: words, force: force) { e in
                    if let s = e.string("summary"), !s.isEmpty { steps.append(s) }
                }
                last = r
                say = ""
                reloadToken += 1
                model.flash(r.summary.isEmpty ? L("siteedit.applied", count: r.applied.count) : r.summary)
            } catch {
                self.error = error.localizedDescription
                // the engine refused to overwrite hand-edited files; the owner may replace them on purpose
                if let e = error as? EngineError, case .failed(_, let code) = e, code == "site_modified" { modifiedFiles = ["modified"] }
            }
            busy = false
            await loadInfo()
        }
    }

    private func undo() {
        guard let project, !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                try await model.siteUndo(project)
                last = nil
                reloadToken += 1
                model.flash(L("siteedit.undone"))
            } catch { self.error = error.localizedDescription }
            busy = false
            await loadInfo()
        }
    }
}

/// A multi-line field that submits on ⌘↩.
private struct SayField: View {
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
    let token: Int

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        view.allowsBackForwardNavigationGestures = false
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        let key = "\(folder)#\(token)"
        guard context.coordinator.loaded != key else { return }
        context.coordinator.loaded = key
        let dir = URL(fileURLWithPath: folder, isDirectory: true)
        // a changed token reloads from disk; WebKit may otherwise serve the cached page
        view.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
    }

    final class Coordinator { var loaded = "" }
}
