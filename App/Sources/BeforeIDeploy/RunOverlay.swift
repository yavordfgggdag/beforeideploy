import SwiftUI

/// Live progress for check / Smart Deploy / production / git / Netlify operations.
struct RunOverlay: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var session: RunSession

    var headerTint: Color {
        if !session.finished { return Theme.accent }
        if !session.success { return Theme.blocked }
        return session.steps.contains { $0.status == "warn" } ? Theme.warn : Theme.ready
    }

    var body: some View {
        ModalShell(size: .xl, height: 600, dismiss: { if session.finished { close() } }) {
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
        }
        .onExitCommand { if session.finished { close() } }
    }

    private func close() {
        withAnimation(Motion.spring) { model.run = nil }
    }

    // MARK: header

    private var header: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(headerTint.opacity(0.14)).frame(width: 40, height: 40)
                if session.finished {
                    Image(systemName: !session.success ? "xmark" : (headerTint == Theme.warn ? "exclamationmark" : "checkmark"))
                        .font(Typo.font(.headline, weight: .bold))
                        .foregroundColor(headerTint)
                } else {
                    Orbit(size: 20)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(session.finished ? (session.outcomeTitle ?? session.title) : session.title)
                    .font(Typo.font(.headline, weight: .bold))
                    .foregroundColor(Theme.text)
                Text(session.subtitle)
                    .font(Typo.font(.callout))
                    .foregroundColor(Theme.secondary)
                    .lineLimit(1)
            }
            Spacer()
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let end = session.finishedAt ?? ctx.date
                Text(Fmt.duration(end.timeIntervalSince(session.startedAt)))
                    .font(Typo.font(.callout, design: .monospaced))
                    .foregroundColor(Theme.tertiary)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 16)
        .overlay(alignment: .bottom) {
            GeometryReader { geo in
                Capsule()
                    .fill(LinearGradient(colors: [headerTint.opacity(0.6), headerTint], startPoint: .leading, endPoint: .trailing))
                    .frame(width: geo.size.width * session.progress, height: 2)
                    .shimmer(active: !session.finished)
                    .animation(Motion.gentle, value: session.progress)
            }
            .frame(height: 2)
        }
    }

    // MARK: steps

    private var stepList: some View {
        ScrollView {
            VStack(spacing: 4) {
                ForEach(Array(session.steps.enumerated()), id: \.element.id) { i, s in
                    RunStepRow(step: s, selected: session.selectedStep == s.id)
                        .tapAction { session.selectedStep = s.id }

                }
                if session.steps.isEmpty {
                    // a run that finished without steps (nothing to install) must not spin "Starting…" forever
                    HStack(spacing: 8) {
                        if session.finished && session.success {
                            Image(systemName: "checkmark.circle.fill").foregroundColor(Theme.ready)
                            Text(L("overlay.nothingToDo")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                        } else if session.finished {
                            Image(systemName: "xmark.circle.fill").foregroundColor(Theme.blocked)
                            Text(L("overlay.failedBeforeStart")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                        } else {
                            Spinner(size: 12)
                            Text(L("overlay.starting")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                        }
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
                    Text(s.label).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                    if let sum = s.summary {
                        Text(sum).font(Typo.font(.callout)).foregroundColor(Theme.secondary).lineLimit(1)
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
                                // no log lines: show the step's own finding in full (the header cuts it to one line)
                                if s.status != "running", let sum = s.summary, !sum.isEmpty {
                                    Text(sum)
                                        .font(Typo.font(.body))
                                        .foregroundColor(Theme.text)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .padding(.vertical, 4)
                                }
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
                        .font(Typo.font(.callout, design: .monospaced))
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
                .clipShape(RoundedRectangle(cornerRadius: Radius.m, style: .continuous))
                .padding(.horizontal, 12)
                .padding(.bottom, 12)

                if session.kind != .setup && (s.status == "fail" || s.status == "warn") {
                    AIFixBar(step: s.id)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                }

                if session.finished, !s.fixes.isEmpty {
                    HStack {
                        Text(L("overlay.safeFix")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
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
                        .font(Typo.font(.body))
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
                    } label: { Label(L("run.draftPreview"), systemImage: "eye") }
                        .bidButton(.secondary)
                }
                if session.kind == .setup && !session.success {
                    Button(L("setup.retryFailed")) { model.run = nil; model.setupAuto() }.bidButton(.secondary)
                }
                Button(L("common.close")) { close() }
                    .bidButton(session.resultURL == nil ? .primary : .secondary)
                    .keyboardShortcut(.defaultAction)
            } else {
                Text(session.runningStep.map { "\($0.label)…" } ?? L("overlay.working"))
                    .font(Typo.font(.body))
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
                    Orbit(size: 14)
                } else {
                    Image(systemName: Theme.symbol(for: step.status))
                        .font(Typo.font(.body))
                        .foregroundColor(Theme.color(for: step.status))
                }
            }
            .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.label)
                    .font(Typo.font(.body, weight: .semibold))
                    .foregroundColor(step.status == "pending" || step.status == "skipped" ? Theme.tertiary : Theme.text)
                if let s = step.summary {
                    Text(s)
                        .font(Typo.font(.caption))
                        .foregroundColor(Theme.tertiary)
                        .lineLimit(1)
                }
            }
            Spacer()
            if step.cached {
                Text(L("overlay.cached")).font(Typo.font(.micro, weight: .semibold)).foregroundColor(Theme.tertiary)
                    .padding(.horizontal, 6).padding(.vertical, 1)
                    .background(Capsule().fill(Theme.elevated))
            }
            if let d = step.duration, d >= 1 {
                Text(Fmt.duration(d)).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: Radius.s, style: .continuous)
                .fill(selected ? Theme.elevated : .clear)
        )
        .contentShape(Rectangle())
    }
}
