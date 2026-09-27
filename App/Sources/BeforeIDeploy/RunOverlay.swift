import SwiftUI

/// Live progress for check / Smart Deploy / production / git / Netlify operations.
struct RunOverlay: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var session: RunSession

    var headerTint: Color {
        if !session.finished { return Theme.accent }
        return session.success ? Theme.ready : Theme.blocked
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.55)
                .ignoresSafeArea()
                .onTapGesture { if session.finished { close() } }

            VStack(spacing: 0) {
                header
                Rectangle().fill(Theme.hairline).frame(height: 1)
                HStack(spacing: 0) {
                    stepList
                        .frame(width: 300)
                    Rectangle().fill(Theme.hairline).frame(width: 1)
                    logPane
                }
                Rectangle().fill(Theme.hairline).frame(height: 1)
                footer
            }
            .frame(width: 900, height: 600)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Theme.panel)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .shadow(color: .black.opacity(0.5), radius: 40, y: 16)
        }
        .onExitCommand { if session.finished { close() } }
    }

    private func close() {
        withAnimation(.spring(response: 0.3)) { model.run = nil }
    }

    // MARK: header

    private var header: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(headerTint.opacity(0.14)).frame(width: 40, height: 40)
                if session.finished {
                    Image(systemName: session.success ? "checkmark" : "xmark")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(headerTint)
                } else {
                    Spinner(size: 18)
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(session.finished ? (session.outcomeTitle ?? session.title) : session.title)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(Theme.text)
                Text(session.subtitle)
                    .font(.system(size: 12))
                    .foregroundColor(Theme.secondary)
                    .lineLimit(1)
            }
            Spacer()
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let end = session.finishedAt ?? ctx.date
                Text(Fmt.duration(end.timeIntervalSince(session.startedAt)))
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(Theme.tertiary)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 16)
        .overlay(alignment: .bottom) {
            GeometryReader { geo in
                Rectangle()
                    .fill(headerTint)
                    .frame(width: geo.size.width * session.progress, height: 2)
                    .animation(.easeInOut(duration: 0.4), value: session.progress)
            }
            .frame(height: 2)
        }
    }

    // MARK: steps

    private var stepList: some View {
        ScrollView {
            VStack(spacing: 4) {
                ForEach(session.steps) { s in
                    RunStepRow(step: s, selected: session.selectedStep == s.id)
                        .onTapGesture { session.selectedStep = s.id }
                }
                if session.steps.isEmpty {
                    HStack(spacing: 8) {
                        Spinner(size: 12)
                        Text(L("overlay.starting")).font(.system(size: 12)).foregroundColor(Theme.secondary)
                    }
                    .padding(.top, 16)
                }
            }
            .padding(12)
        }
        .background(Theme.bg.opacity(0.4))
    }

    // MARK: log

    private var selected: RunStep? {
        session.steps.first { $0.id == session.selectedStep } ?? session.runningStep ?? session.steps.last
    }

    private var logPane: some View {
        VStack(alignment: .leading, spacing: 0) {
            DeviceCodeCard(session: session)
                .padding(.top, 12)
            if let s = selected {
                HStack(spacing: 8) {
                    Image(systemName: Theme.symbol(for: s.status)).foregroundColor(Theme.color(for: s.status))
                    Text(s.label).font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.text)
                    if let sum = s.summary {
                        Text(sum).font(.system(size: 12)).foregroundColor(Theme.secondary).lineLimit(1)
                    }
                    Spacer()
                    if let log = s.log {
                        Button(L("overlay.fullLog")) { model.openFile(log) }.bidButton(.ghost, compact: true)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 1) {
                            let lines = s.lines.isEmpty ? s.details : s.lines
                            if lines.isEmpty {
                                Text(s.status == "running" ? L("overlay.waitingOutput") : L("overlay.noOutput"))
                                    .foregroundColor(Theme.tertiary)
                            }
                            ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                                Text(line)
                                    .foregroundColor(lineColor(line))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .id(i)
                            }
                            if !s.lines.isEmpty && !s.details.isEmpty && s.status == "fail" {
                                Divider().padding(.vertical, 6)
                                ForEach(Array(s.details.enumerated()), id: \.offset) { _, d in
                                    Text(d).foregroundColor(Theme.blocked)
                                }
                            }
                            Color.clear.frame(height: 1).id("bottom")
                        }
                        .font(.system(size: 11.5, design: .monospaced))
                        .textSelection(.enabled)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                    }
                    .onChange(of: s.lines.count) { _ in
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                    .onChange(of: s.id) { _ in
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
                .background(Theme.bg)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.horizontal, 12)
                .padding(.bottom, 12)

                if s.status == "fail" || s.status == "warn" {
                    AIFixBar(step: s.id)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                }

                if session.finished, !s.fixes.isEmpty {
                    HStack {
                        Text(L("overlay.safeFix")).font(.system(size: 12)).foregroundColor(Theme.secondary)
                        Spacer()
                        ForEach(s.fixes, id: \.self) { f in
                            Button(L("common.fix")) {
                                model.run = nil
                                model.requestFix(f)
                            }
                            .bidButton(.primary, compact: true)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                }
            } else {
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func lineColor(_ line: String) -> Color {
        let l = line.lowercased()
        if l.contains("error") || l.contains("failed") || l.contains("✖") || l.contains("❌") { return Theme.blocked }
        if l.contains("warn") { return Theme.warn }
        if l.contains("✓") || l.contains("success") || l.contains("built in") || l.contains("deploy is live") { return Theme.ready }
        return Theme.text.opacity(0.85)
    }

    // MARK: footer

    private var footer: some View {
        HStack(spacing: 10) {
            if session.finished {
                if let m = session.outcomeMessage {
                    Text(m)
                        .font(.system(size: 12.5))
                        .foregroundColor(session.success ? Theme.secondary : Theme.blocked)
                        .lineLimit(2)
                        .textSelection(.enabled)
                }
                Spacer()
                if let url = session.resultURL {
                    Button { model.copy(url) } label: { Image(systemName: "doc.on.doc") }
                        .bidButton(.secondary).help(L("common.copyUrl"))
                    Button { model.open(url) } label: { Label(L("common.open"), systemImage: "safari") }
                        .bidButton(.primary)
                }
                if session.kind == .check && session.success && model.status?.detect.netlifyLinked == true {
                    Button {
                        model.run = nil
                        model.draftPreview()
                    } label: { Label("Draft Preview", systemImage: "eye") }
                        .bidButton(.secondary)
                }
                Button(L("common.close")) { close() }
                    .bidButton(session.resultURL == nil ? .primary : .secondary)
                    .keyboardShortcut(.defaultAction)
            } else {
                Text(session.runningStep.map { "\($0.label)…" } ?? L("overlay.working"))
                    .font(.system(size: 12.5))
                    .foregroundColor(Theme.secondary)
                Spacer()
                Button(L("overlay.cancel")) { session.handle.cancel() }
                    .bidButton(.danger)
                    .disabled(session.kind == .production && session.runningStep?.id == "deploy")
                    .help(session.kind == .production ? L("overlay.dontCancelProd") : L("overlay.stopsProcess"))
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
    }
}

struct RunStepRow: View {
    let step: RunStep
    let selected: Bool

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                if step.status == "running" {
                    Spinner(size: 13)
                } else {
                    Image(systemName: Theme.symbol(for: step.status))
                        .font(.system(size: 13))
                        .foregroundColor(Theme.color(for: step.status))
                }
            }
            .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.label)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundColor(step.status == "pending" || step.status == "skipped" ? Theme.tertiary : Theme.text)
                if let s = step.summary {
                    Text(s)
                        .font(.system(size: 11))
                        .foregroundColor(Theme.tertiary)
                        .lineLimit(1)
                }
            }
            Spacer()
            if let d = step.duration, d >= 1 {
                Text(Fmt.duration(d)).font(.system(size: 10.5, design: .monospaced)).foregroundColor(Theme.tertiary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(selected ? Theme.elevated : .clear)
        )
        .contentShape(Rectangle())
    }
}
