import Foundation

/// Toast / error reporting the stores use; implemented by `AppModel`.
@MainActor
protocol Feedback: AnyObject {
    func flash(_ text: String, error: Bool)
    func show(_ error: Error)
}
