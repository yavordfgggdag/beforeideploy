import SwiftUI

struct PanelHeader: View {
    let title: String
    let icon: String
    var status: String? = nil
    var trailing: String? = nil
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Theme.accent)
            Text(title)
                .font(.system(size: 13.5, weight: .bold))
                .foregroundColor(Theme.text)
            Spacer()
            if let trailing {
                Text(trailing).font(.system(size: 11.5)).foregroundColor(Theme.secondary)
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
            PanelHeader(title: "Local Preview", icon: "desktopcomputer", status: l.running ? "pass" : nil)

            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(l.running ? "Работи" : "Спрян")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(l.running ? Theme.ready : Theme.secondary)
                    if l.running, let url = l.url {
                        Text(Fmt.host(url))
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(Theme.text)
                            .textSelection(.enabled)
                        Text("\(l.label ?? l.mode ?? "") · от \(Fmt.time(l.startedAt))")
                            .font(.system(size: 11))
                            .foregroundColor(Theme.tertiary)
                    } else {
                        Text(status.detect.publishReady == true && status.detect.ssr != true
                             ? "Ще сервира build-а от \(status.detect.publishDir ?? "dist")/"
                             : "Ще стартира dev сървъра")
                            .font(.system(size: 11.5))
                            .foregroundColor(Theme.tertiary)
                    }
                }
                Spacer()
                if model.busy.contains("local") { Spinner(size: 16) }
            }

            HStack(spacing: 8) {
                if l.running {
                    Button { model.open(l.url) } label: { Label("Отвори", systemImage: "safari") }
                        .bidButton(.primary, compact: true)
                    Button { model.copy(l.url) } label: { Image(systemName: "doc.on.doc") }
                        .bidButton(.secondary, compact: true).help("Копирай URL")
                    Button { model.localRestart() } label: { Image(systemName: "arrow.clockwise") }
                        .bidButton(.secondary, compact: true).help("Рестартирай")
                    Button { model.localStop() } label: { Label("Стоп", systemImage: "stop.fill") }
                        .bidButton(.danger, compact: true)
                    if let log = l.log {
                        Spacer()
                        Button { model.openFile(log) } label: { Image(systemName: "doc.text") }
                            .bidButton(.ghost, compact: true).help("Лог на сървъра")
                    }
                } else {
                    Button { model.localStart(mode: "auto") } label: { Label("Старт", systemImage: "play.fill") }
                        .bidButton(.primary, compact: true)
                    if status.detect.hasPackageJson == true {
                        Button("Build preview") { model.localStart(mode: "build") }
                            .bidButton(.secondary, compact: true)
                            .help("Сервира production build-а")
                        Button("Dev server") { model.localStart(mode: "dev") }
                            .bidButton(.secondary, compact: true)
                            .help("npm run dev с hot reload")
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
                Text("Проектът не е Git repository.")
                    .font(.system(size: 12.5))
                    .foregroundColor(Theme.secondary)
                Button("Инициализирай Git") { model.requestFix("git.init") }
                    .bidButton(.primary, compact: true)
            } else {
                HStack(spacing: 16) {
                    Metric(value: g.branch ?? "—", label: "branch")
                    Metric(value: "\(g.changedCount ?? 0)", label: "промени", tint: (g.changedCount ?? 0) > 0 ? Theme.warn : Theme.text)
                    if g.hasUpstream == true {
                        Metric(value: "↑\(g.ahead ?? 0) ↓\(g.behind ?? 0)", label: "ahead / behind",
                               tint: (g.behind ?? 0) > 0 ? Theme.warn : Theme.text)
                    } else if g.remote != nil {
                        Metric(value: "—", label: "не е push-вано")
                    }
                    Spacer()
                    if model.busy.contains("fetch") { Spinner(size: 13) }
                }

                if let c = g.lastCommit {
                    HStack(spacing: 6) {
                        Text(c.hash).font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.accent)
                        Text(c.subject).font(.system(size: 11.5)).foregroundColor(Theme.secondary).lineLimit(1)
                        Spacer()
                        Text(c.relative).font(.system(size: 11)).foregroundColor(Theme.tertiary)
                    }
                }

                if let changed = g.changed, !changed.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(changed.prefix(4)) { f in
                            HStack(spacing: 8) {
                                Text(f.code).font(.system(size: 10.5, weight: .bold, design: .monospaced))
                                    .foregroundColor(f.code.contains("D") ? Theme.blocked : f.code.contains("?") || f.code.contains("A") ? Theme.ready : Theme.warn)
                                    .frame(width: 18, alignment: .leading)
                                Text(f.path).font(.system(size: 11.5, design: .monospaced)).foregroundColor(Theme.secondary)
                                    .lineLimit(1).truncationMode(.middle)
                            }
                        }
                        if changed.count > 4 {
                            Text("+ още \((g.changedCount ?? changed.count) - 4)").font(.system(size: 11)).foregroundColor(Theme.tertiary)
                        }
                    }
                }

                HStack(spacing: 8) {
                    Button { model.sheet = .commit } label: { Label("Commit & Push", systemImage: "arrow.up.circle.fill") }
                        .bidButton(.primary, compact: true)
                        .disabled((g.changedCount ?? 0) == 0)
                    Button("Push") { model.push() }
                        .bidButton(.secondary, compact: true)
                        .disabled(g.remote == nil || (g.hasUpstream == true && (g.ahead ?? 0) == 0))
                    Button { model.fetch() } label: { Image(systemName: "arrow.down.circle") }
                        .bidButton(.secondary, compact: true).help("git fetch")
                    Spacer()
                    if let url = g.githubUrl {
                        Button { model.open(url) } label: { Label("GitHub", systemImage: "arrow.up.right") }
                            .bidButton(.ghost, compact: true)
                    } else if status.fixes.contains(where: { $0.id == "github.create" }) {
                        Button { model.requestFix("github.create") } label: { Label("Създай GitHub repo", systemImage: "plus") }
                            .bidButton(.primary, compact: true)
                    } else {
                        Button("Добави remote") { model.sheet = .remote }
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
            Text(value).font(.system(size: 15, weight: .bold)).foregroundColor(tint).lineLimit(1)
            Text(label).font(.system(size: 10.5)).foregroundColor(Theme.tertiary)
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
                        trailing: auth.loggedIn ? (auth.email ?? "влязъл") : "не си влязъл")

            if !auth.loggedIn {
                HStack {
                    Text("Влез в Netlify, за да свържеш и публикуваш проекта.")
                        .font(.system(size: 12.5)).foregroundColor(Theme.secondary)
                    Spacer()
                    Button("Вход в Netlify") { model.netlifyLogin() }.bidButton(.primary, compact: true)
                }
            } else if !linked {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Проектът не е свързан").font(.system(size: 14, weight: .semibold)).foregroundColor(Theme.text)
                        Text("Създай нов сайт или свържи съществуващ. CI от GitHub няма да се включи — deploy-ите остават ръчни.")
                            .font(.system(size: 12)).foregroundColor(Theme.secondary)
                    }
                    Spacer()
                    Button("Свържи Netlify") { model.sheet = .netlifySetup }.bidButton(.primary, compact: true)
                }
            } else {
                HStack(alignment: .top, spacing: 24) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("LIVE").font(.system(size: 10, weight: .bold)).tracking(1).foregroundColor(Theme.tertiary)
                        if let live {
                            Button { model.open(live) } label: {
                                Text(Fmt.host(live)).font(.system(size: 15, weight: .semibold)).foregroundColor(Theme.text)
                            }.buttonStyle(.plain)
                        } else {
                            Text(n?.siteName ?? "—").font(.system(size: 15, weight: .semibold)).foregroundColor(Theme.text)
                        }
                        if n?.repoLinked == true {
                            Label("Сайтът има CI от GitHub — push-овете deploy-ват автоматично", systemImage: "exclamationmark.triangle")
                                .font(.system(size: 11)).foregroundColor(Theme.warn)
                        }
                    }
                    DeployStat(title: "Последен production", record: status.lastProd, fallback: n?.lastPublishedAt)
                    DeployStat(title: "Последен draft", record: status.lastDraft, fallback: nil)
                    Spacer()
                }

                HStack(spacing: 8) {
                    Button { model.draftPreview() } label: { Label("Draft Preview", systemImage: "eye") }
                        .bidButton(.secondary, compact: true)
                    if let d = status.lastDraft?.url {
                        Button { model.open(d) } label: { Label("Последният draft", systemImage: "clock.arrow.circlepath") }
                            .bidButton(.ghost, compact: true)
                    }
                    Spacer()
                    if let live {
                        Button { model.open(live) } label: { Label("Отвори сайта", systemImage: "safari") }
                            .bidButton(.secondary, compact: true)
                        Button { model.copy(live) } label: { Image(systemName: "doc.on.doc") }
                            .bidButton(.secondary, compact: true).help("Копирай URL")
                    }
                    Button {
                        model.open(n?.adminUrl ?? "https://app.netlify.com/sites/\(n?.siteName ?? "")")
                    } label: { Label("Dashboard", systemImage: "speedometer") }
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
            Text(title.uppercased()).font(.system(size: 10, weight: .bold)).tracking(1).foregroundColor(Theme.tertiary)
            Text(Fmt.relative(record?.at ?? fallback))
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundColor((record?.at ?? fallback) == nil ? Theme.tertiary : Theme.text)
        }
    }
}
