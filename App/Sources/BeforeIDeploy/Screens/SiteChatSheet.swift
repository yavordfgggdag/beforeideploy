import AppKit
import SwiftUI

// Site Builder v2: "New site" starts as a conversation. One message from the owner; the assistant asks a few
// short questions with tap-able answers (`bid site chat`), then builds the site from the brief it hands back
// (the AI writes the texts when the account can use it, then the engine saves the site and the app opens it).
// The three-step wizard stays one tap away for people who would rather pick a theme themselves.

struct SiteChatSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss

    struct Item: Identifiable {
        let id = UUID()
        var role: String // "user" | "assistant"
        var text: String
        var questions: [SiteChatTurn.Question] = []
    }

    static let models: [(id: String, title: String)] = [
        ("auto", "Auto"),
        ("claude-haiku-4-5", "Haiku 4.5"),
        ("claude-sonnet-5-5", "Sonnet 5.5"),
        ("claude-opus-5-5", "Opus 5.5"),
        ("claude-fable-5-1", "Fable 5.1"),
    ]

    @State private var items: [Item] = []
    @State private var input = ""
    @State private var modelChoice = "auto"
    @State private var asked = 0
    @State private var busy = false
    @State private var building = false
    @State private var error: String?
    @State private var wizard = false

    private var sheetWidth: CGFloat { min(760, (NSApp.keyWindow?.screen?.visibleFrame.width ?? 1280) - 80) }
    private var sheetHeight: CGFloat { min(660, (NSApp.keyWindow?.screen?.visibleFrame.height ?? 900) - 120) }

    var body: some View {
        if wizard {
            SiteBuilderSheet()
        } else {
            chat
        }
    }

    private var chat: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Theme.hairline).frame(height: 1)
            transcript
            Rectangle().fill(Theme.hairline).frame(height: 1)
            composer
        }
        .frame(width: sheetWidth, height: sheetHeight)
        .background(ZStack { Theme.panel; Theme.sheen })
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles.rectangle.stack").font(Typo.icon(size: 16, weight: .semibold)).foregroundColor(Theme.accent).accessibilityHidden(true)
            Text(L("newsite.chat.title")).font(Typo.font(.headline)).foregroundColor(Theme.text)
            Spacer()
            Menu {
                ForEach(Self.models, id: \.id) { m in
                    Button(m.id == "auto" ? L("newsite.chat.auto") : m.title) { modelChoice = m.id }
                }
            } label: {
                Text("\(L("newsite.chat.model")): \(Self.models.first(where: { $0.id == modelChoice })?.title ?? "Auto")")
            }
            .menuStyle(.borderlessButton).fixedSize().disabled(busy || building)
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 22).padding(.vertical, 14)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    bubble(role: "assistant", text: L("newsite.chat.welcome"))
                    ForEach(items) { item in
                        VStack(alignment: .leading, spacing: 8) {
                            bubble(role: item.role, text: item.text)
                            if !item.questions.isEmpty { questionChips(item.questions) }
                        }
                        .id(item.id)
                    }
                    if busy || building {
                        HStack(spacing: 8) { Spinner(size: 12, color: Theme.accent); Text(building ? L("newsite.chat.building") : "…").font(Typo.font(.callout)).foregroundColor(Theme.secondary) }
                    }
                    if let error {
                        Label(error, systemImage: "exclamationmark.circle.fill").font(Typo.font(.callout)).foregroundColor(Theme.blocked)
                    }
                }
                .padding(22)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: items.count) { _ in
                if let last = items.last { withAnimation(Motion.quick) { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private func bubble(role: String, text: String) -> some View {
        HStack {
            if role == "user" { Spacer(minLength: 60) }
            Text(text)
                .font(Typo.font(.body)).foregroundColor(Theme.text)
                .textSelection(.enabled)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(role == "user" ? Theme.accent.opacity(0.16) : Theme.elevated))
            if role != "user" { Spacer(minLength: 60) }
        }
    }

    /// One row per question: its text and the answers to tap; typing a different answer in the box works too.
    private func questionChips(_ questions: [SiteChatTurn.Question]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(questions) { q in
                VStack(alignment: .leading, spacing: 6) {
                    Text(q.text).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                        ForEach(q.options, id: \.self) { option in
                            Button(option) { send("\(q.text) \(option)") }.bidButton(.secondary, compact: true).disabled(busy || building)
                        }
                    }
                }
            }
        }
        .padding(.leading, 4)
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                TextField(L("newsite.chat.placeholder"), text: $input)
                    .textFieldStyle(.plain).font(Typo.font(.body))
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.elevated))
                    .onSubmit { sendInput() }
                Button(L("newsite.chat.send")) { sendInput() }
                    .bidButton(.primary).keyboardShortcut(.defaultAction)
                    .disabled(busy || building || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            Button(L("newsite.chat.manual")) { wizard = true }.buttonStyle(.plain).font(Typo.font(.caption)).foregroundColor(Theme.tertiary).disabled(building)
        }
        .padding(.horizontal, 22).padding(.vertical, 14)
    }

    private func sendInput() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        input = ""
        send(text)
    }

    /// The whole conversation goes to the engine each turn (it keeps no state), so the model sees every answer.
    private func send(_ text: String) {
        guard model.aiReady else { model.aiUnavailableAction(); return }
        items.append(Item(role: "user", text: text))
        error = nil
        busy = true
        let messages: [[String: String]] = items.map { ["role": $0.role, "content": ($0.questions.isEmpty ? $0.text : ([$0.text] + $0.questions.map { $0.text }).joined(separator: "\n"))] }
        Task {
            defer { busy = false }
            do {
                let turn = try await model.siteChat(messages, modelChoice: modelChoice, asked: asked)
                if turn.action == "ask", let qs = turn.questions, !qs.isEmpty {
                    asked += 1
                    items.append(Item(role: "assistant", text: turn.say, questions: qs))
                } else {
                    items.append(Item(role: "assistant", text: turn.say))
                    if let b = turn.brief { await build(b) }
                }
            } catch { self.error = error.localizedDescription }
        }
    }

    /// The brief becomes a site: AI texts first (when the account can use them), then the engine saves it on the Desktop.
    private func build(_ b: SiteChatTurn.Brief) async {
        building = true
        defer { building = false }
        if model.templates.isEmpty { await model.loadTemplates() }
        var brief = SiteBrief(lang: Localization.current.hasPrefix("bg") ? "bg" : "en")
        if let theme = b.theme, !theme.isEmpty { brief.theme = theme }
        brief.name = b.name ?? ""
        brief.description = b.description ?? ""
        brief.offer = b.offer ?? ""
        brief.audience = b.audience ?? ""
        brief.tone = b.tone
        brief.services = (b.services ?? []).compactMap { s in
            guard let n = s.name, !n.isEmpty else { return nil }
            return SiteBrief.Service(name: n)
        }
        if brief.services.isEmpty { brief.services = [SiteBrief.Service()] }
        if let t = model.templates.first(where: { $0.id == brief.theme }) { brief.style = t.style }
        guard !brief.name.trimmingCharacters(in: .whitespaces).isEmpty else { error = L("newsite.chat.placeholder"); return }
        var contentFile: String?
        if model.aiReady {
            do { contentFile = try await model.siteContent(brief) { _ in }.contentFile } catch { self.error = error.localizedDescription; return }
        }
        let dir = NSSearchPathForDirectoriesInDomains(.desktopDirectory, .userDomainMask, true).first ?? NSHomeDirectory()
        if let failed = await model.generateSite(brief, dir: dir, contentFile: contentFile) { self.error = failed; return }
        dismiss()
    }
}
