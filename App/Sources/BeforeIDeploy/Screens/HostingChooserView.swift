import SwiftUI

// MARK: - Hosting chooser

struct HostingChooserCard: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(title: L("hosting.whereTitle"), icon: "server.rack", trailing: model.advice.map { "\($0.framework ?? "") · \($0.ssr ? "SSR" : L("hosting.staticSite"))" })
            if let a = model.advice {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 10)], spacing: 10) {
                    ForEach(a.providers) { p in HostingOptionTile(option: p) }
                }
                Text(L("hosting.pricesNote"))
                    .font(Typo.font(.caption)).foregroundColor(Theme.tertiary)
            } else {
                HStack { Spinner(size: 13); Text(L("hosting.analyzing")).font(Typo.font(.callout)).foregroundColor(Theme.secondary) }
            }
        }
        .card()
        .task { await model.loadAdvice() }
    }
}

struct HostingOptionTile: View {
    @EnvironmentObject var model: AppModel
    let option: HostingOption

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(option.name).font(Typo.font(.subhead, weight: .bold)).foregroundColor(option.compatible ? Theme.text : Theme.tertiary)
                Spacer()
                if option.current {
                    Tag(text: L("hosting.selectedBadge"), tint: Theme.accent)
                } else if option.recommended == true {
                    Tag(text: L("hosting.recommendedBadge"), tint: Theme.ready)
                }
            }
            Text(option.free).font(Typo.font(.callout)).foregroundColor(Theme.secondary).fixedSize(horizontal: false, vertical: true)
            ForEach(option.reasons, id: \.self) { r in
                Label(r, systemImage: option.compatible ? "exclamationmark.triangle" : "xmark.circle")
                    .font(Typo.font(.caption)).foregroundColor(option.compatible ? Theme.warn : Theme.blocked)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 6) {
                StatusPill(ok: option.installed, text: L("hosting.tool"))
                StatusPill(ok: option.loggedIn, text: L("hosting.signInLower"))
                if option.preview { StatusPill(ok: true, text: L("hosting.previewButton")) }
                Spacer()
            }
            HStack {
                Button(L("hosting.prices")) { model.open(option.pricing) }.bidButton(.ghost, compact: true)
                Spacer()
                if !option.current {
                    Button(L("hosting.choose")) { model.setHosting(option.id) }
                        .bidButton(option.recommended == true ? .primary : .secondary, compact: true)
                        .disabled(!option.compatible)
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(option.current ? Theme.accentSoft : Theme.elevated))
        .overlay(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).strokeBorder(option.current ? Theme.accent.opacity(0.6) : Theme.hairline, lineWidth: 1))
        .opacity(option.compatible ? 1 : 0.6)
    }
}

struct Tag: View {
    let text: String
    let tint: Color
    var body: some View { Badge(text: text, size: .sm, tint: tint) }
}

struct StatusPill: View {
    let ok: Bool
    let text: String
    var body: some View { Badge(text: text, icon: ok ? "checkmark" : "xmark", tone: ok ? .success : .neutral, size: .sm) }
}

/// Deploy card for non-Netlify providers.
struct GenericHostingCard: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus

    var body: some View {
        let h = status.hosting
        let live = h?.liveUrl ?? status.lastProd?.url
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(title: h?.name ?? L("common.hosting"), icon: "globe", status: h?.ready == true ? "pass" : nil,
                        trailing: h?.loggedIn == true ? L("common.signedInLower") : L("common.notSignedInLower"))
            if h?.installed != true || h?.loggedIn != true {
                HStack {
                    Text(h?.installed != true ? L("hosting.cliMissing", h?.name ?? "") : L("hosting.signInHint", h?.name ?? ""))
                        .font(Typo.font(.body)).foregroundColor(Theme.secondary)
                    Spacer()
                    Button(L("hosting.setUp")) { model.screen = .setup; Task { await model.loadSetup() } }
                        .bidButton(.primary, compact: true)
                }
            } else {
                HStack(alignment: .top, spacing: 24) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L("hosting.liveLabel")).font(Typo.font(.micro, weight: .bold)).tracking(1).foregroundColor(Theme.tertiary)
                        Text(live.map { Fmt.host($0) } ?? L("hosting.noProductionYet"))
                            .font(Typo.font(.subhead, weight: .semibold)).foregroundColor(live == nil ? Theme.tertiary : Theme.text)
                    }
                    DeployStat(title: L("hosting.lastProduction"), record: status.lastProd, fallback: nil)
                    DeployStat(title: L("hosting.lastPreview"), record: status.lastDraft, fallback: nil)
                    Spacer()
                }
                HStack(spacing: 8) {
                    if h?.preview == true {
                        Button { model.draftPreview() } label: { Label(L("hosting.previewButton"), systemImage: "eye") }
                            .bidButton(.secondary, compact: true)
                    }
                    Spacer()
                    if let live {
                        Button { model.open(live) } label: { Label(L("common.openSite"), systemImage: "safari") }
                            .bidButton(.secondary, compact: true)
                        Button { model.copy(live) } label: { Image(systemName: "doc.on.doc") }
                            .bidButton(.secondary, compact: true)
                            .accessibilityLabel(L("common.copyUrl"))
                    }
                }
            }
        }
        .card()
    }
}
