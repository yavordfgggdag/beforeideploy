import AppKit
import SwiftUI

/// Plans, credits and checkout (V10 WP4). Payment happens on Paddle's page in the browser; afterwards the
/// store polls `bid billing status` until the webhook has changed the plan or the balance.
@MainActor
final class BillingStore: ObservableObject {
    @Published var catalog: BillingCatalog?
    @Published var status: BillingStatus?
    @Published var loading = false
    /// Set while we wait for Paddle's webhook after the browser checkout.
    @Published var waitingForPayment = false
    @Published var busy: String?

    let engine: EngineClient
    weak var feedback: Feedback?
    /// Called when the plan or balance changed (the facade reloads the account and its feature gates).
    var onChanged: (@MainActor () async -> Void)?
    private var pollTask: Task<Void, Never>?

    init(engine: EngineClient) {
        self.engine = engine
    }

    func load() async {
        loading = true
        defer { loading = false }
        do {
            async let c = engine.call(["billing", "catalog"], as: BillingCatalog.self)
            async let s = engine.call(["billing", "status"], as: BillingStatus.self)
            catalog = try await c
            status = try await s
        } catch { feedback?.show(error) }
    }

    func checkout(plan: String? = nil, pack: String? = nil, yearly: Bool = false) {
        var args = ["billing", "checkout"]
        if let plan { args += ["--plan", plan] }
        if yearly, plan != nil { args.append("--yearly") }
        if let pack { args += ["--pack", pack] }
        busy = plan ?? pack
        Task {
            defer { busy = nil }
            do {
                let r = try await engine.call(args, as: BillingURL.self)
                guard let url = URL(string: r.url) else { return }
                NSWorkspace.shared.open(url)
                waitForPayment()
            } catch { feedback?.show(error) }
        }
    }

    func startTrial() {
        busy = "trial"
        Task {
            defer { busy = nil }
            do {
                status = try await engine.call(["billing", "trial"], as: BillingStatus.self)
                feedback?.flash(L("billing.trialStarted"), error: false)
                await onChanged?()
            } catch { feedback?.show(error) }
        }
    }

    func openPortal() {
        busy = "portal"
        Task {
            defer { busy = nil }
            do {
                let r = try await engine.call(["billing", "portal"], as: BillingURL.self)
                if let url = URL(string: r.url) { NSWorkspace.shared.open(url) }
                waitForPayment()
            } catch { feedback?.show(error) }
        }
    }

    /// Polls every 5 s for up to 3 minutes until the plan or the balance differs from before.
    func waitForPayment() {
        pollTask?.cancel()
        let before = status
        waitingForPayment = true
        pollTask = Task {
            defer { waitingForPayment = false }
            for _ in 0..<36 {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if Task.isCancelled { return }
                guard let now = try? await engine.call(["billing", "status"], as: BillingStatus.self) else { continue }
                status = now
                if now.plan != before?.plan || now.balance.total != before?.balance.total || now.subscription != before?.subscription {
                    feedback?.flash(L("billing.updated"), error: false)
                    await onChanged?()
                    return
                }
            }
        }
    }

    func stopWaiting() {
        pollTask?.cancel()
        waitingForPayment = false
    }
}
