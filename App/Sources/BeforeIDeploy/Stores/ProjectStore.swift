import SwiftUI

/// Project library, the selected project, its status snapshot and history.
@MainActor
final class ProjectStore: ObservableObject {
    @Published var projects: [Project] = []
    @Published var selectedKey: String?
    @Published var status: ProjectStatus?
    @Published var loadingStatus = false
    @Published var history: [HistoryEntry] = []
    @AppStorage("lastSelectedKey") var lastSelectedKey = ""

    let engine: EngineClient
    weak var feedback: Feedback?

    init(engine: EngineClient) {
        self.engine = engine
    }

    var selected: Project? { projects.first { $0.key == selectedKey } }

    func loadProjects() async {
        do {
            projects = try await engine.call(["project", "list"], as: [Project].self)
        } catch {
            feedback?.show(error)
        }
    }

    /// Marks `key` as the selected project (clears the status of a previous selection).
    func setSelected(_ key: String) {
        if selectedKey != key { status = nil }
        selectedKey = key
        lastSelectedKey = key
    }

    func touch(_ key: String) async {
        _ = try? await engine.run(["project", "touch", "--project", key])
    }

    /// Quiet background refresh of things that need the network (git fetch, Netlify site info).
    func backgroundSync(_ key: String) {
        Task {
            if status?.git.remote != nil {
                _ = try? await engine.run(["git", "fetch", "--project", key])
            }
            if status?.detect.netlifyLinked == true, status?.netlifyAuth.loggedIn == true,
               status?.project.netlify?.liveUrl == nil {
                _ = try? await engine.run(["netlify", "info", "--project", key])
            }
            if selectedKey == key { await refreshStatus(quiet: true) }
        }
    }

    func refreshStatus(quiet: Bool = false) async {
        guard let key = selectedKey else { return }
        if !quiet { loadingStatus = true }
        defer { loadingStatus = false }
        do {
            let s = try await engine.call(["status", "--project", key], as: ProjectStatus.self)
            if selectedKey == key {
                status = s
                if let i = projects.firstIndex(where: { $0.key == key }) {
                    var p = s.project
                    p.lastStatus = s.check?.status
                    projects[i] = p
                }
            }
        } catch {
            if !quiet { feedback?.show(error) }
        }
    }

    func loadHistory() async {
        guard let key = selectedKey else { return }
        history = (try? await engine.call(["history", "--project", key, "--limit", "30"], as: [HistoryEntry].self)) ?? []
    }

    @discardableResult
    func addProject(path: String) async -> Project? {
        do {
            let p = try await engine.call(["project", "add", "--path", path], as: Project.self)
            await loadProjects()
            feedback?.flash("Добавен: \(p.name)", error: false)
            return p
        } catch {
            feedback?.show(error)
            return nil
        }
    }

    /// Removes the project; clears the selection if it was selected.
    func remove(_ key: String) async {
        _ = try? await engine.run(["project", "remove", "--project", key])
        if selectedKey == key {
            selectedKey = nil
            status = nil
        }
        await loadProjects()
    }
}
