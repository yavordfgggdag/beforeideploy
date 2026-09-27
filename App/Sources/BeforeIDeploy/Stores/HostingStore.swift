import SwiftUI

/// Hosting advisor for the selected project and Spaceship domains / DNS.
@MainActor
final class HostingStore: ObservableObject {
    @Published var advice: HostingAdvice?
    @Published var spaceship: SpaceshipStatus?
    @Published var loadingSpaceship = false
    @Published var domainForConnect: String?

    let engine: EngineClient
    let projects: ProjectStore
    weak var feedback: Feedback?
    /// Called when tool / account state changed and the Setup screen should reload.
    var onSetupChanged: (@MainActor () async -> Void)?

    init(engine: EngineClient, projects: ProjectStore) {
        self.engine = engine
        self.projects = projects
    }

    // MARK: - Hosting

    func loadAdvice() async {
        guard let p = projects.selected else { return }
        advice = try? await engine.call(["hosting", "advise", "--project", p.key], as: HostingAdvice.self)
    }

    func setHosting(_ id: String) {
        guard let p = projects.selected else { return }
        Task {
            let o = try? await engine.run(["hosting", "set", "--project", p.key, "--provider", id])
            if o?.ok == true { feedback?.flash(L("hosting.set", advice?.providers.first { $0.id == id }?.name ?? id), error: false) }
            await loadAdvice()
            await projects.refreshStatus(quiet: true)
            await onSetupChanged?()
        }
    }

    // MARK: - Spaceship

    func loadSpaceship(refresh: Bool = false) async {
        loadingSpaceship = true
        defer { loadingSpaceship = false }
        var args = ["spaceship", "status"]
        if refresh { args.append("--refresh") }
        do { spaceship = try await engine.call(args, as: SpaceshipStatus.self) } catch { feedback?.show(error) }
    }

    func connectSpaceship(key: String, secret: String) async -> Bool {
        do {
            let outcome = try await engine.run(["spaceship", "connect"],
                                               env: ["BID_SPACESHIP_KEY": key, "BID_SPACESHIP_SECRET": secret])
            guard outcome.ok else {
                feedback?.flash(outcome.errorMessage ?? L("spaceship.keyRejected"), error: true)
                return false
            }
            feedback?.flash(L("spaceship.connected"), error: false)
            await loadSpaceship(refresh: true)
            await onSetupChanged?()
            return true
        } catch {
            feedback?.show(error)
            return false
        }
    }

    func disconnectSpaceship() {
        Task {
            _ = try? await engine.run(["spaceship", "disconnect"])
            spaceship = nil
            await loadSpaceship()
            await onSetupChanged?()
        }
    }

    func dns(_ domain: String) async -> [DnsRecord] {
        (try? await engine.call(["spaceship", "dns", "--domain", domain], as: DnsResult.self))?.records ?? []
    }

    func planDomain(_ domain: String) async throws -> DomainPlan {
        guard let p = projects.selected else { throw EngineError.failed(L("common.pickProject"), nil) }
        return try await engine.call(["spaceship", "connect-domain", "--project", p.key, "--domain", domain], as: ConnectDomainResult.self).plan
    }
}
