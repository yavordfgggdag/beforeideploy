import SwiftUI

struct PanelHeader: View {
    let title: String
    let icon: String
    var status: String? = nil
    var trailing: String? = nil
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(Typo.font(.callout, weight: .semibold))
                .foregroundColor(Theme.accent)
            Text(title)
                .font(Typo.font(.subhead, weight: .bold))
                .foregroundColor(Theme.text)
            Spacer()
            if let trailing {
                Text(trailing).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
            }
            if let status { StatusDot(status: status) }
        }
    }
}

// MARK: - Local

struct LocalCard: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus

    var body: some View {
        let l = status.local
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(title: L("run.localPreview"), icon: "desktopcomputer", status: l.running ? "pass" : nil)

            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(l.running ? L("local.running") : L("local.stopped"))
                        .font(Typo.font(.headline, weight: .bold))
                        .foregroundColor(l.running ? Theme.ready : Theme.secondary)
                    if l.running, let url = l.url {
                        Text(Fmt.host(url))
                            .font(Typo.font(.callout, design: .monospaced))
                            .foregroundColor(Theme.text)
                            .textSelection(.enabled)
                        Text(L("local.since", l.label ?? l.mode ?? "", Fmt.time(l.startedAt)))
                            .font(Typo.font(.caption))
                            .foregroundColor(Theme.tertiary)
                    } else {
                        Text(status.detect.publishReady == true && status.detect.ssr != true
                             ? L("local.willServeBuild", status.detect.publishDir ?? "dist")
                             : L("local.willStartDev"))
                            .font(Typo.font(.callout))
                            .foregroundColor(Theme.tertiary)
                    }
                }
                Spacer()
                if model.busy.contains("local") { Spinner(size: 16) }
            }

            HStack(spacing: 8) {
                if l.running {
                    Button { model.open(l.url) } label: { Label(L("common.open"), systemImage: "safari") }
                        .bidButton(.primary, compact: true)
                    Button { model.copy(l.url) } label: { Image(systemName: "doc.on.doc") }
                        .bidButton(.secondary, compact: true).help(L("common.copyUrl"))
                    Button { model.localRestart() } label: { Image(systemName: "arrow.clockwise") }
                        .bidButton(.secondary, compact: true).help(L("local.restart"))
                    Button { model.localStop() } label: { Label(L("local.stop"), systemImage: "stop.fill") }
                        .bidButton(.danger, compact: true)
                    if let log = l.log {
                        Spacer()
                        Button { model.openFile(log) } label: { Image(systemName: "doc.text") }
                            .bidButton(.ghost, compact: true).help(L("local.serverLog"))
                    }
                } else {
                    Button { model.localStart(mode: "auto") } label: { Label(L("local.start"), systemImage: "play.fill") }
                        .bidButton(.primary, compact: true)
                    if status.detect.hasPackageJson == true {
                        Button(L("local.buildPreview")) { model.localStart(mode: "build") }
                            .bidButton(.secondary, compact: true)
                            .help(L("local.servesBuild"))
                        Button(L("local.devServer")) { model.localStart(mode: "dev") }
                            .bidButton(.secondary, compact: true)
                            .help(L("local.devHelp"))
                    }
                }
            }
            .disabled(model.busy.contains("local"))
        }
        .card()
        .frame(maxHeight: .infinity, alignment: .top)
    }
}

// MARK: - GitHub

struct GitCard: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus

    var body: some View {
        let g = status.git
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(title: "GitHub", icon: "arrow.triangle.branch",
                        status: g.isRepo ? ((g.changedCount ?? 0) > 0 ? "warn" : "pass") : nil)

            if !g.isRepo {
                Text(L("git.notRepo"))
                    .font(Typo.font(.body))
                    .foregroundColor(Theme.secondary)
                Button(L("git.init")) { model.requestFix("git.init") }
                    .bidButton(.primary, compact: true)
            } else {
                HStack(spacing: 16) {
                    Metric(value: g.branch ?? "—", label: "branch")
                    Metric(value: "\(g.changedCount ?? 0)", label: L("git.changes"), tint: (g.changedCount ?? 0) > 0 ? Theme.warn : Theme.text)
                    if g.hasUpstream == true {
                        Metric(value: "↑\(g.ahead ?? 0) ↓\(g.behind ?? 0)", label: "ahead / behind",
                               tint: (g.behind ?? 0) > 0 ? Theme.warn : Theme.text)
                    } else if g.remote != nil {
                        Metric(value: "—", label: L("git.notPushed"))
                    }
                    Spacer()
                    if model.busy.contains("fetch") { Spinner(size: 13) }
                }

                if let c = g.lastCommit {
                    HStack(spacing: 6) {
                        Text(c.hash).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.accent)
                        Text(c.subject).font(Typo.font(.callout)).foregroundColor(Theme.secondary).lineLimit(1)
                        Spacer()
                        Text(c.relative).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                    }
                }

                if let changed = g.changed, !changed.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(changed.prefix(4)) { f in
                            HStack(spacing: 8) {
                                Text(f.code).font(Typo.font(.caption, weight: .bold, design: .monospaced))
                                    .foregroundColor(f.code.contains("D") ? Theme.blocked : f.code.contains("?") || f.code.contains("A") ? Theme.ready : Theme.warn)
                                    .frame(width: 18, alignment: .leading)
                                Text(f.path).font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.secondary)
                                    .lineLimit(1).truncationMode(.middle)
                            }
                        }
                        if changed.count > 4 {
                            Text(L("git.more", (g.changedCount ?? changed.count) - 4)).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
                        }
                    }
                }

                HStack(spacing: 8) {
                    Button { model.sheet = .commit } label: { Label(L("run.commitPush"), systemImage: "arrow.up.circle.fill") }
                        .bidButton(.primary, compact: true)
                        .disabled((g.changedCount ?? 0) == 0)
                    Button(L("run.push")) { model.push() }
                        .bidButton(.secondary, compact: true)
                        .disabled(g.remote == nil || (g.hasUpstream == true && (g.ahead ?? 0) == 0))
                    Button { model.fetch() } label: { Image(systemName: "arrow.down.circle") }
                        .bidButton(.secondary, compact: true).help(L("git.fetchHelp"))
                    Spacer()
                    if let url = g.githubUrl {
                        Button { model.open(url) } label: { Label("GitHub", systemImage: "arrow.up.right") }
                            .bidButton(.ghost, compact: true)
                    } else if status.fixes.contains(where: { $0.id == "github.create" }) {
                        Button { model.requestFix("github.create") } label: { Label(L("git.createRepo"), systemImage: "plus") }
                            .bidButton(.primary, compact: true)
                    } else {
                        Button(L("git.addRemote")) { model.sheet = .remote }
                            .bidButton(.ghost, compact: true)
                    }
                }
            }
        }
        .card()
        .frame(maxHeight: .infinity, alignment: .top)
    }
}

struct Metric: View {
    let value: String
    let label: String
    var tint: Color = Theme.text
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(Typo.font(.subhead, weight: .bold)).foregroundColor(tint).lineLimit(1)
            Text(label).font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
        }
    }
}

// MARK: - Netlify

struct NetlifyCard: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus

    var body: some View {
        let linked = status.detect.netlifyLinked == true
        let auth = status.netlifyAuth
        let n = status.project.netlify
        let live = n?.liveUrl ?? status.lastProd?.url
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(title: "Netlify", icon: "globe",
                        status: linked ? "pass" : nil,
                        trailing: auth.loggedIn ? (auth.email ?? L("common.signedInLower")) : L("common.notSignedInLower"))

            if !auth.loggedIn {
                HStack {
                    Text(L("netlify.signInHint"))
                        .font(Typo.font(.body)).foregroundColor(Theme.secondary)
                    Spacer()
                    Button(L("netlify.signIn")) { model.netlifyLogin() }.bidButton(.primary, compact: true)
                }
            } else if !linked {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(L("netlify.notLinked")).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(Theme.text)
                        Text(L("netlify.linkHint"))
                            .font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                    }
                    Spacer()
                    Button(L("netlify.connect")) { model.sheet = .netlifySetup }.bidButton(.primary, compact: true)
                }
            } else {
                HStack(alignment: .top, spacing: 24) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L("hosting.liveLabel")).font(Typo.font(.micro, weight: .bold)).tracking(1).foregroundColor(Theme.tertiary)
                        if let live {
                            Button { model.open(live) } label: {
                                Text(Fmt.host(live)).font(Typo.font(.subhead, weight: .semibold)).foregroundColor(Theme.text)
                            }.buttonStyle(.plain)
                        } else {
                            Text(n?.siteName ?? "—").font(Typo.font(.subhead, weight: .semibold)).foregroundColor(Theme.text)
                        }
                        if n?.repoLinked == true {
                            Label(L("netlify.hasCi"), systemImage: "exclamationmark.triangle")
                                .font(Typo.font(.caption)).foregroundColor(Theme.warn)
                        }
                    }
                    DeployStat(title: L("hosting.lastProduction"), record: status.lastProd, fallback: n?.lastPublishedAt)
                    DeployStat(title: L("netlify.lastDraft"), record: status.lastDraft, fallback: nil)
                    Spacer()
                }

                HStack(spacing: 8) {
                    Button { model.draftPreview() } label: { Label(L("run.draftPreview"), systemImage: "eye") }
                        .bidButton(.secondary, compact: true)
                    if let d = status.lastDraft?.url {
                        Button { model.open(d) } label: { Label(L("netlify.theLastDraft"), systemImage: "clock.arrow.circlepath") }
                            .bidButton(.ghost, compact: true)
                    }
                    Spacer()
                    if let live {
                        Button { model.open(live) } label: { Label(L("common.openSite"), systemImage: "safari") }
                            .bidButton(.secondary, compact: true)
                        Button { model.copy(live) } label: { Image(systemName: "doc.on.doc") }
                            .bidButton(.secondary, compact: true).help(L("common.copyUrl"))
                    }
                    Button {
                        model.open(n?.adminUrl ?? "https://app.netlify.com/sites/\(n?.siteName ?? "")")
                    } label: { Label(L("netlify.dashboard"), systemImage: "speedometer") }
                        .bidButton(.ghost, compact: true)
                }
            }
        }
        .card()
    }
}

struct DeployStat: View {
    let title: String
    let record: DeployRecord?
    let fallback: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased()).font(Typo.font(.micro, weight: .bold)).tracking(1).foregroundColor(Theme.tertiary)
            Text(Fmt.relative(record?.at ?? fallback))
                .font(Typo.font(.subhead, weight: .semibold))
                .foregroundColor((record?.at ?? fallback) == nil ? Theme.tertiary : Theme.text)
        }
    }
}
