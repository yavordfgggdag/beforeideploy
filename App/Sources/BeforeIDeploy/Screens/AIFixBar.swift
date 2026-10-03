import SwiftUI

// MARK: - AI Fix bar

struct AIFixBar: View {
    @EnvironmentObject var model: AppModel
    let step: String
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !compact {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles").foregroundColor(Theme.accent)
                    Text(L("aifix.help"))
                        .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                }
            }
            let builtin = model.account?.features?.aiBuiltin == true
            // buttons keep one-line labels and move to the next row when the pane is narrow
            FlowLayout(spacing: 6, lineSpacing: 6) {
                if builtin {
                    Button { model.aiStore.start(step: step) } label: { Label(L("ai.fixButton"), systemImage: "sparkles") }
                        .bidButton(.primary, compact: true)
                        .help(L("ai.fixHelp"))
                    if model.account?.features?.aiDeep == true {
                        Button { model.aiStore.start(step: step, deep: true) } label: { Label(L("ai.deepButton"), systemImage: "brain") }
                            .bidButton(.secondary, compact: true)
                            .help(L("ai.deepHelp"))
                    }
                } else if model.account?.canUseOwnKey == true {
                    Button { model.sheet = .aiKeys } label: { Label(L("ai.addKeyButton"), systemImage: "key.fill") }
                        .bidButton(.primary, compact: true)
                        .help(L("ai.addKeyHelp"))
                } else {
                    Button { model.aiUnavailableAction() } label: { Label(L("ai.fixButton"), systemImage: "sparkles") }
                        .bidButton(.primary, compact: true)
                        .help(L("ai.planHelp"))
                }
                Button { model.openAssistant() } label: { Label(L("ai.askAssistant"), systemImage: "bubble.left.and.text.bubble") }
                    .bidButton(.secondary, compact: true)
                    .help(L("ai.askAssistantHelp"))
                if compact {
                    // the hero card has no room for five external buttons: one menu, same actions
                    Menu {
                        Button { model.aiFix(step: step, target: "chatgpt") } label: { Label(L("aifix.chatgpt"), systemImage: "bubble.left.and.bubble.right.fill") }
                        Button { model.aiFix(step: step, target: "claude") } label: { Label("Claude", systemImage: "sparkle") }
                        Button { model.aiFix(step: step, target: "codex") } label: { Label("Codex", systemImage: "terminal") }
                        Button { model.aiFix(step: step, target: "claude-code") } label: { Label("Claude Code", systemImage: "chevron.left.forwardslash.chevron.right") }
                        Divider()
                        Button { model.aiFix(step: step, target: "copy") } label: { Label(L("aifix.copyOnly"), systemImage: "doc.on.doc") }
                    } label: {
                        Label(L("aifix.external"), systemImage: "arrow.up.right.square")
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .help(L("aifix.externalHelp"))
                } else {
                    Button { model.aiFix(step: step, target: "chatgpt") } label: { Label(L("aifix.chatgpt"), systemImage: "bubble.left.and.bubble.right.fill") }
                        .bidButton(builtin ? .secondary : .primary, compact: true)
                        .help(L("aifix.chatgptHelp"))
                    Button { model.aiFix(step: step, target: "claude") } label: { Label("Claude", systemImage: "sparkle") }
                        .bidButton(.secondary, compact: true)
                        .help(L("aifix.claudeHelp"))
                    Button { model.aiFix(step: step, target: "codex") } label: { Label("Codex", systemImage: "terminal") }
                        .bidButton(.secondary, compact: true)
                        .help(L("aifix.codexHelp"))
                    Button { model.aiFix(step: step, target: "claude-code") } label: { Label("Claude Code", systemImage: "chevron.left.forwardslash.chevron.right") }
                        .bidButton(.secondary, compact: true)
                        .help(L("aifix.claudeCodeHelp"))
                    Button { model.aiFix(step: step, target: "copy") } label: { Image(systemName: "doc.on.doc") }
                        .bidButton(.ghost, compact: true)
                        .help(L("aifix.copyOnly"))
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}
