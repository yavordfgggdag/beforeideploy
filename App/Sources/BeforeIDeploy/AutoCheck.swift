import AppKit
import CoreServices
import SwiftUI

/// Watches one project folder with FSEvents and calls back (debounced) when source files change.
/// Build output, dependencies and VCS folders are ignored, so a check never triggers itself.
final class ProjectWatcher {
    private var stream: FSEventStreamRef?
    private let path: String
    /// The real path (FSEvents reports resolved paths, e.g. /private/var for /var).
    fileprivate var root: String { (path as NSString).resolvingSymlinksInPath }
    private let onChange: () -> Void

    static let ignored = ["/node_modules/", "/.git/", "/dist/", "/build/", "/.next/", "/.nuxt/", "/.svelte-kit/",
                          "/.output/", "/.vercel/", "/.netlify/", "/out/", "/.cache/", "/coverage/", "/.turbo/", ".DS_Store"]
    /// Files the check itself (tsc, eslint, editors) rewrites — they must not start another check.
    static let ignoredSuffixes = [".tsbuildinfo", ".eslintcache", ".swp", "~", ".log"]

    init(path: String, onChange: @escaping () -> Void) {
        self.path = path
        self.onChange = onChange
    }

    deinit { stop() }

    /// True when at least one changed path is a real source change (not build output / deps / VCS).
    /// Paths are judged relative to the project root, so a project that lives under …/build/… still works (audit A10).
    static func isRelevant(_ paths: [String], root: String = "") -> Bool {
        let base = root.hasSuffix("/") ? root : root + "/"
        return paths.contains { p in
            let rel = !root.isEmpty && p.hasPrefix(base) ? "/" + p.dropFirst(base.count) : p
            return !ignored.contains { rel.contains($0) } && !ignoredSuffixes.contains { rel.hasSuffix($0) }
        }
    }

    func start() {
        stop()
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, info, count, paths, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<ProjectWatcher>.fromOpaque(info).takeUnretainedValue()
            let list = (Unmanaged<CFArray>.fromOpaque(paths).takeUnretainedValue() as NSArray as? [String]) ?? []
            if count > 0, ProjectWatcher.isRelevant(list, root: watcher.root) { watcher.onChange() }
        }
        let flags = UInt32(kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer)
        guard let s = FSEventStreamCreate(kCFAllocatorDefault, callback, &context, [path] as CFArray,
                                          FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 1.0, flags) else { return }
        FSEventStreamSetDispatchQueue(s, DispatchQueue.main)
        FSEventStreamStart(s)
        stream = s
    }

    func stop() {
        guard let s = stream else { return }
        FSEventStreamStop(s)
        FSEventStreamInvalidate(s)
        FSEventStreamRelease(s)
        stream = nil
    }
}

/// Menu bar status (V10): every project with its state, one click to open it, check the selected one.
struct MenuBarView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                AppGlyph(size: 22)
                Text("Before I Deploy").font(.system(size: 13, weight: .bold)).foregroundColor(Theme.text)
                Spacer()
                if model.autoChecking { Spinner(size: 11) }
            }
            if model.projects.isEmpty {
                Text(L("root.emptyHint")).font(.system(size: 11.5)).foregroundColor(Theme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 2) {
                    ForEach(model.projects) { p in
                        Button {
                            showApp()
                            Task { await model.select(p.key) }
                        } label: {
                            HStack(spacing: 9) {
                                ProjectAvatar(name: p.name, size: 22, dimmed: p.exists == false)
                                Text(p.name).font(.system(size: 12.5, weight: .medium)).foregroundColor(Theme.text).lineLimit(1)
                                Spacer()
                                Text(Self.statusText(p.lastStatus)).font(.system(size: 10, weight: .heavy)).tracking(0.5)
                                    .foregroundColor(Theme.color(for: p.lastStatus))
                                StatusDot(status: p.lastStatus, size: 7)
                            }
                            .padding(.horizontal, 6).padding(.vertical, 5)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            Divider()
            HStack(spacing: 8) {
                Button { showApp(); model.runCheck() } label: { Label(L("common.check"), systemImage: "arrow.triangle.2.circlepath") }
                    .bidButton(.secondary, compact: true)
                    .disabled(model.selectedKey == nil)
                Button { showApp() } label: { Label(L("menubar.open"), systemImage: "macwindow") }
                    .bidButton(.secondary, compact: true)
                Spacer()
                Button { NSApp.terminate(nil) } label: { Image(systemName: "power") }
                    .bidButton(.ghost, compact: true)
                    .help(L("menubar.quit"))
            }
            Toggle(L("settings.autoCheck"), isOn: Binding(get: { model.autoCheck }, set: { model.autoCheck = $0 }))
                .toggleStyle(.switch).controlSize(.small).tint(Theme.accent)
                .font(.system(size: 11.5))
        }
        .padding(14)
        .frame(width: 300)
        .background(Theme.panel)
    }

    static func statusText(_ s: String?) -> String {
        switch s {
        case "ready": return L("status.ready")
        case "warnings": return L("status.warnings")
        case "blocked": return L("status.blocked")
        default: return ""
        }
    }

    private func showApp() {
        openWindow(id: "main")
        NSApp.activate(ignoringOtherApps: true)
    }
}

/// Placeholder block with a slow shimmer while data loads (static when Reduce motion is on).
struct SkeletonBlock: View {
    var height: CGFloat = 16
    var width: CGFloat? = nil
    var radius: CGFloat = 8
    @Local private var phase: CGFloat = -1

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(Theme.elevated)
            .overlay(
                GeometryReader { geo in
                    LinearGradient(colors: [.clear, Color.white.opacity(0.06), .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: geo.size.width * 0.6)
                        .offset(x: phase * geo.size.width)
                }
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            )
            .frame(width: width, height: height)
            .onAppear {
                guard !Motion.reduced else { return }
                withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { phase = 1.4 }
            }
            .accessibilityHidden(true)
    }
}

/// Mission Control while the first overview loads: the real layout in skeleton form.
struct MissionControlSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 12) {
                ForEach(0..<4, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 12) {
                        SkeletonBlock(height: 26, width: 26)
                        SkeletonBlock(height: 26, width: 60)
                        SkeletonBlock(height: 10, width: 90)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card(padding: 16)
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14, alignment: .top)], spacing: 14) {
                ForEach(0..<4, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 10) {
                            SkeletonBlock(height: 32, width: 32, radius: 9)
                            VStack(alignment: .leading, spacing: 6) {
                                SkeletonBlock(height: 12, width: 120)
                                SkeletonBlock(height: 9, width: 80)
                            }
                            Spacer()
                            SkeletonBlock(height: 18, width: 70, radius: 9)
                        }
                        SkeletonBlock(height: 10, width: 160)
                        SkeletonBlock(height: 10)
                    }
                    .card(padding: 16)
                }
            }
        }
    }
}
