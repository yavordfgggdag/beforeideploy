import AppKit
import SwiftUI

/// Account-scoped billing. Every asynchronous result is checked against the session generation.
@MainActor
final class BillingStore: ObservableObject {
    @Published var catalog: BillingCatalog?
    @Published var status: BillingStatus?
    @Published var loadingCatalog = false
    @Published var loadingUsage = false
    @Published var waitingForPayment = false
    @Published var busy: String?
    @Published var usage: UsageReport?
    @Published var usageError: String?
    @Published var billingUnavailable: String?
    var loading: Bool { loadingCatalog }
    var demo: Bool { (Snapshot.argument("BIDSnapshot") && Snapshot.argument("BIDBillingDemo")) || ProcessInfo.processInfo.environment["BID_BILLING_DEMO"] == "1" }
    var canReadUsage: Bool { identity != nil || demo }
    let engine: EngineClient
    weak var feedback: Feedback?
    var onChanged: (@MainActor () async -> Void)?
    private var pollTask: Task<Void, Never>?
    private var identity: String?
    private var generation = UUID()

    init(engine: EngineClient) { self.engine = engine }

    func sessionChanged(_ account: AccountState?) {
        let next = account?.loggedIn == true ? account?.id : nil
        guard next != identity else { return }
        reset(); identity = next
    }

    func reset() {
        generation = UUID(); pollTask?.cancel(); pollTask = nil
        identity = nil; catalog = nil; status = nil; usage = nil
        loadingCatalog = false; loadingUsage = false; busy = nil
        waitingForPayment = false; usageError = nil; billingUnavailable = nil
    }

    func load() async {
        guard !loadingCatalog else { return }
        let epoch = generation
        loadingCatalog = true
        defer { if epoch == generation { loadingCatalog = false } }
        do {
            let result = try await engine.call(["billing", "catalog"], as: BillingCatalog.self)
            guard epoch == generation, !Task.isCancelled else { return }
            catalog = result
            if canReadUsage {
                let value = try await engine.call(["billing", "status"], as: BillingStatus.self)
                guard epoch == generation, !Task.isCancelled else { return }
                status = value; billingUnavailable = nil
            }
        } catch {
            guard epoch == generation else { return }
            if unavailable(error) { billingUnavailable = error.localizedDescription }
            else { feedback?.show(error) }
        }
    }

    func loadUsage() async {
        guard canReadUsage, !loadingUsage else { return }
        let epoch = generation
        loadingUsage = true
        defer { if epoch == generation { loadingUsage = false } }
        do {
            let report = try await engine.call(["billing", "usage"], as: UsageReport.self)
            guard epoch == generation, !Task.isCancelled else { return }
            usage = report; usageError = nil; billingUnavailable = nil
        } catch {
            guard epoch == generation, !Task.isCancelled else { return }
            if unavailable(error) { billingUnavailable = error.localizedDescription; usageError = nil }
            else { usageError = error.localizedDescription }
        }
    }

    /// SwiftUI owns this task's lifetime. Hidden views stop polling; signed-out users make no usage calls.
    func observeUsage(every seconds: UInt64) async {
        while !Task.isCancelled {
            await loadUsage()
            do { try await Task.sleep(nanoseconds: seconds * 1_000_000_000) } catch { return }
        }
    }

    func checkout(plan: String? = nil, pack: String? = nil, yearly: Bool = false) {
        guard busy == nil, !demo else { return }
        var args = ["billing", "checkout"]
        if let plan { args += ["--plan", plan] }
        if yearly, plan != nil { args.append("--yearly") }
        if let pack { args += ["--pack", pack] }
        let epoch = generation
        perform(plan ?? pack ?? "checkout") {
            // Capture a baseline before opening checkout; the first later read is never a false success.
            let before = try await self.engine.call(["billing", "status"], as: BillingStatus.self)
            guard epoch == self.generation else { throw CancellationError() }
            let result = try await self.engine.call(args, as: BillingURL.self)
            return {
                self.status = before
                if let preview = result.preview { await self.confirm(preview, epoch: epoch) }
                else if let text = result.url, let url = URL(string: text) { NSWorkspace.shared.open(url); self.waitForPayment(before: before) }
            }
        }
    }

    private func confirm(_ preview: BillingURL.Preview, epoch: UUID) async {
        guard epoch == generation else { return }
        let alert = NSAlert()
        alert.messageText = L("billing.reviewChange", BillingFormat.planName(preview.plan))
        alert.informativeText = L("billing.reviewAmounts", BillingFormat.money(Double(preview.amount)/100, currency: preview.currency), BillingFormat.money(Double(preview.nextAmount)/100, currency: preview.currency)) + "\n\n" +
            (preview.downgrade ? L("billing.changeLater", BillingFormat.day(preview.effectiveAt)) : L("billing.changeNow"))
        alert.addButton(withTitle: L("billing.confirmChange"))
        alert.addButton(withTitle: L("common.cancel"))
        guard alert.runModal() == .alertFirstButtonReturn, epoch == generation else { return }
        do {
            _ = try await engine.call(["billing", "confirm-change", "--preview-id", preview.id], as: BillingURL.self)
            guard epoch == generation else { return }
            await load(); await loadUsage(); await onChanged?()
            feedback?.flash(L("billing.updated"), error: false)
        } catch { if epoch == generation { feedback?.show(error) } }
    }

    func startTrial() {
        perform("trial") {
            let result = try await self.engine.call(["billing", "trial"], as: BillingStatus.self)
            return { self.status = result; self.feedback?.flash(L("billing.trialStarted"), error: false); await self.loadUsage(); await self.onChanged?() }
        }
    }

    func openPortal() {
        perform("portal") {
            let result = try await self.engine.call(["billing", "portal"], as: BillingURL.self)
            return { if let text = result.url, let url = URL(string: text) { NSWorkspace.shared.open(url) } }
        }
    }

    func sync() {
        perform("sync") {
            let result = try await self.engine.call(["billing", "sync"], as: BillingSync.self)
            return { self.status = result.status; self.feedback?.flash(result.synced.isEmpty ? L("usage.syncNothing") : L("usage.synced"), error: false); await self.loadUsage(); await self.onChanged?() }
        }
    }

    func creditAction(_ action: String, arguments: [String] = []) {
        perform(action) {
            _ = try await self.engine.call(["billing", action] + arguments, as: CreditActionReceipt.self)
            return { if action == "domain_request" { self.feedback?.flash(L("usage.domainRequested"), error: false) }; await self.loadUsage(); await self.onChanged?() }
        }
    }

    func changeSite(projectKey: String, active: Bool) {
        perform(active ? "site_activate" : "site_pause") {
            if active {
                let estimate = try await self.engine.call(["billing", "estimate", "--usage-action", "site.day"], as: CreditActionReceipt.self)
                guard let credits = estimate.credits else { throw CancellationError() }
                return { await self.confirmActivation(projectKey, credits: credits) }
            }
            _ = try await self.engine.call(["billing", "site_pause", "--project", projectKey], as: CreditActionReceipt.self)
            return { await self.loadUsage() }
        }
    }

    private func confirmActivation(_ projectKey: String, credits: Int) async {
        let epoch = generation
        let alert = NSAlert()
        alert.messageText = L("usage.activateSite")
        alert.informativeText = L("usage.activationCost", Fmt.tokens(credits))
        alert.addButton(withTitle: L("usage.activateSite")); alert.addButton(withTitle: L("common.cancel"))
        guard alert.runModal() == .alertFirstButtonReturn, epoch == generation else { return }
        do {
            _ = try await engine.call(["account", "sync"], as: JSONValue.self)
            guard epoch == generation else { return }
            _ = try await engine.call(["billing", "site_activate", "--project", projectKey], as: CreditActionReceipt.self)
            guard epoch == generation else { return }
            await loadUsage(); await onChanged?()
        } catch { if epoch == generation { feedback?.show(error) } }
    }

    /// Serialize billing mutations; a second click cannot overwrite the first operation's busy state.
    private func perform(_ key: String, action: @escaping () async throws -> (@MainActor () async -> Void)) {
        guard busy == nil, canReadUsage, !demo else { return }
        let epoch = generation; busy = key
        Task {
            defer { if epoch == generation { busy = nil } }
            do {
                let apply = try await action()
                guard epoch == generation else { return }
                await apply()
            } catch { if epoch == generation { feedback?.show(error) } }
        }
    }

    private func waitForPayment(before: BillingStatus) {
        stopWaiting()
        let epoch = generation
        waitingForPayment = true
        pollTask = Task {
            defer { if epoch == generation { waitingForPayment = false } }
            for _ in 0..<36 {
                do { try await Task.sleep(nanoseconds: 5_000_000_000) } catch { return }
                guard epoch == generation, !Task.isCancelled else { return }
                guard let now = try? await engine.call(["billing", "status"], as: BillingStatus.self) else { continue }
                guard epoch == generation, !Task.isCancelled else { return }
                status = now
                if now.plan != before.plan || now.balance != before.balance || now.subscription != before.subscription {
                    feedback?.flash(L("billing.updated"), error: false)
                    await loadUsage(); await onChanged?(); return
                }
            }
        }
    }

    func stopWaiting() { pollTask?.cancel(); waitingForPayment = false }
    private func unavailable(_ error: Error) -> Bool {
        ["cloud_function_missing", "not_configured"].contains((error as? EngineError)?.code ?? "")
    }
}
