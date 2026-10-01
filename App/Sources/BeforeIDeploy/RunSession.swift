import AppKit
import Foundation
import SwiftUI

/// A live step shown in the Run sheet.
struct RunStep: Identifiable, Equatable {
    let id: String
    var label: String
    var category: String?
    var status: String
    var summary: String?
    var details: [String] = []
    var fixes: [String] = []
    var log: String?
    var duration: Double?
    var cached = false
    var lines: [String] = []
}

/// Observable state of one long-running engine operation (check, smart deploy, push, login…).
@MainActor
final class RunSession: ObservableObject, Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let kind: Kind
    let startedAt = Date()
    let handle = EngineHandle()

    enum Kind { case check, smart, production, draft, git, netlify, fix, local, setup }

    @Published var steps: [RunStep] = []
    @Published var selectedStep: String?
    @Published var finished = false
    @Published var success = false
    @Published var outcomeTitle: String?
    @Published var outcomeMessage: String?
    @Published var resultURL: String?
    @Published var finishedAt: Date?
    @Published var deviceCode: String?
    @Published var deviceURL: String?
    @Published var deviceService: String?
    @Published var deviceExpiresAt: Date?

    init(title: String, subtitle: String, kind: Kind) {
        self.title = title
        self.subtitle = subtitle
        self.kind = kind
    }

    var runningStep: RunStep? { steps.first { ["running", "waiting_user"].contains($0.status) } }

    var progress: Double {
        guard !steps.isEmpty else { return finished ? 1 : 0 }
        let done = steps.filter { !["pending", "running", "waiting_user"].contains($0.status) }.count
        return Double(done) / Double(steps.count)
    }

    /// Log lines wait here and reach the UI together at most every 0.1 s: a noisy build prints thousands of
    /// lines, and one view update per line made the run window stutter (audit A9).
    private var pendingLines: [(step: String, line: String)] = []
    private var flushScheduled = false

    private func scheduleFlush() {
        guard !flushScheduled else { return }
        flushScheduled = true
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 100_000_000)
            self?.flushScheduled = false
            self?.flushLines()
        }
    }

    /// Applies the waiting lines in one change of `steps`.
    func flushLines() {
        guard !pendingLines.isEmpty else { return }
        var copy = steps
        for (stepId, line) in pendingLines {
            if let i = copy.firstIndex(where: { $0.id == stepId }) {
                copy[i].lines.append(line)
            } else {
                var s = RunStep(id: stepId, label: stepId, status: "running")
                s.lines = [line]
                copy.append(s)
            }
        }
        for i in copy.indices where copy[i].lines.count > 600 {
            copy[i].lines.removeFirst(copy[i].lines.count - 600)
        }
        pendingLines.removeAll()
        steps = copy
    }

    func handle(_ e: EngineEvent) {
        switch e.type {
        case "step":
            flushLines() // keep the order: lines printed before this step change come first
            guard let id = e.string("id") else { return }
            if let i = steps.firstIndex(where: { $0.id == id }) {
                var s = steps[i]
                if let v = e.string("label") { s.label = v }
                if let v = e.string("category") { s.category = v }
                if let v = e.string("status") { s.status = v }
                if let v = e.string("summary") { s.summary = v }
                if let v = e.strings("details") { s.details = v }
                if let v = e.strings("fixes") { s.fixes = v }
                if let v = e.string("log") { s.log = v }
                if let v = e.double("duration") { s.duration = v }
                if let v = e.raw["cached"] as? Bool { s.cached = v }
                steps[i] = s
            } else {
                steps.append(RunStep(
                    id: id,
                    label: e.string("label") ?? id,
                    category: e.string("category"),
                    status: e.string("status") ?? "pending",
                    summary: e.string("summary"),
                    details: e.strings("details") ?? [],
                    fixes: e.strings("fixes") ?? [],
                    log: e.string("log"),
                    duration: e.double("duration")
                ))
                if let v = e.raw["cached"] as? Bool { steps[steps.count - 1].cached = v }
            }
            if e.string("status") == "running" { selectedStep = id }
            if e.string("status") == "fail" { selectedStep = id }
        case "log":
            let stepId = e.string("step") ?? "run"
            guard let line = e.string("line") else { return }
            pendingLines.append((step: stepId, line: line))
            scheduleFlush()
        case "devicecode":
            deviceCode = e.string("code")
            deviceURL = e.string("url")
            deviceService = e.string("service")
            deviceExpiresAt = Date().addingTimeInterval(e.double("expiresIn") ?? 300)
            if let c = deviceCode {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(c, forType: .string)
            }
            if let u = deviceURL.flatMap(URL.init(string:)) { NSWorkspace.shared.open(u) }
        case "notify":
            Notifier.shared.post(title: e.string("title") ?? "Before I Deploy",
                                 body: e.string("body") ?? "",
                                 url: e.string("url"))
            if let u = e.string("url"), !u.isEmpty { resultURL = u }
        default:
            break
        }
    }

    func finish(success: Bool, title: String, message: String?) {
        flushLines()
        self.success = success
        self.outcomeTitle = title
        self.outcomeMessage = message
        self.finished = true
        self.finishedAt = Date()
        // anything still spinning is no longer running
        for i in steps.indices where ["pending", "running", "waiting_user"].contains(steps[i].status) {
            steps[i].status = "skipped"
        }
        if !success, let failed = steps.last(where: { $0.status == "fail" }) {
            selectedStep = failed.id
        }
    }
}
