import AppKit
import SwiftUI

/// Three visible/pending notices. Success messages never replace an unacknowledged error.
@MainActor
final class ToastCenter: ObservableObject {
    @Published private(set) var queue: [Toast] = []
    private var timer: Task<Void, Never>?
    private var hovered = false
    var current: Toast? { queue.first }

    func enqueue(_ toast: Toast) {
        guard !queue.contains(where: { $0.text == toast.text && $0.code == toast.code }) else { return }
        if queue.count == 3 {
            if let index = queue.lastIndex(where: { !$0.isError }) { queue.remove(at: index) }
            else { return }
        }
        queue.append(toast)
        if queue.count == 1 { announce(); schedule() }
    }
    func dismiss() {
        guard !queue.isEmpty else { return }
        queue.removeFirst(); announce(); schedule()
    }
    func hover(_ value: Bool) { hovered = value; schedule() }
    private func schedule() {
        timer?.cancel()
        guard let current, !current.isError, !hovered else { return }
        let id = current.id
        timer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            guard !Task.isCancelled, self?.current?.id == id else { return }
            self?.dismiss()
        }
    }
    private func announce() {
        guard let current, let window = NSApp.keyWindow else { return }
        // The AppKit announcement API supports the app's macOS 13 minimum.
        NSAccessibility.post(element: window, notification: .announcementRequested,
            userInfo: [.announcement: current.text, .priority: NSAccessibilityPriorityLevel.high.rawValue])
    }
}
