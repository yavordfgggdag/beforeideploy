import SwiftUI

// MARK: - Domains screen (Spaceship)

struct DomainsView: View {
    @EnvironmentObject var model: AppModel
    @Local private var selectedDomain: String?
    @Local private var records: [DnsRecord] = []
    @Local private var loadingDNS = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader(title: L("common.domains"), subtitle: L("domains.subtitle"), icon: "network") {
                    HStack(spacing: 8) {
                        if model.loadingSpaceship { Spinner(size: 14) }
                        if model.spaceship?.connected == true {
                            Button { Task { await model.loadSpaceship(refresh: true) } } label: { Label(L("common.refresh"), systemImage: "arrow.clockwise") }
                                .bidButton(.secondary, compact: true)
                            Button { model.open("https://www.spaceship.com/domains/") } label: { Label(L("domains.buy"), systemImage: "cart") }
                                .bidButton(.secondary, compact: true)
                        }
                    }
                }

                if let s = model.spaceship, s.connected {
                    let expiring = s.domains.filter { ($0.daysLeft ?? 999) < 30 }.count
                    HStack(spacing: 12) {
                        KPITile(value: "\(s.domains.count)", label: L("domains.countLabel"), icon: "network")
                        KPITile(value: "\(expiring)", label: L("domains.expiring30"), icon: "calendar.badge.exclamationmark",
                                tint: expiring > 0 ? Theme.warn : Theme.text)
                        KPITile(value: "\(s.domains.filter { !$0.autoRenew }.count)", label: L("domains.noAutoRenew"), icon: "arrow.triangle.2.circlepath",
                                tint: s.domains.contains { !$0.autoRenew } ? Theme.warn : Theme.text)
                    }

                    HStack(alignment: .top, spacing: 14) {
                        VStack(alignment: .leading, spacing: 2) {
                            SectionLabel(text: L("domains.yours"), icon: "list.bullet").padding(.bottom, 8)
                            if s.domains.isEmpty {
                                Text(L("domains.none")).foregroundColor(Theme.tertiary).font(Typo.font(.body))
                            }
                            ForEach(s.domains) { d in
                                DomainRow(domain: d, selected: selectedDomain == d.name)
                                    .tapAction { select(d.name) }
                            }
                        }
                        .card()
                        .frame(width: 380)

                        VStack(alignment: .leading, spacing: 12) {
                            if let dom = selectedDomain {
                                HStack {
                                    Text(dom).font(Typo.font(.headline, weight: .bold)).foregroundColor(Theme.text)
                                    Spacer()
                                    Button { model.open(s.domains.first { $0.name == dom }?.dashboard) } label: { Label("Spaceship", systemImage: "arrow.up.right") }
                                        .bidButton(.ghost, compact: true)
                                    Button {
                                        model.domainForConnect = dom
                                        model.sheet = .connectDomain
                                    } label: { Label(L("domains.connectToProject"), systemImage: "link") }
                                        .bidButton(.primary, compact: true)
                                        .disabled(model.selected == nil)
                                        .help(model.selected == nil ? L("domains.pickProjectHint") : L("domains.connectsTo", model.selected?.name ?? ""))
                                }
                                SectionLabel(text: L("domains.dnsRecords"), icon: "list.dash")
                                if loadingDNS {
                                    HStack { Spinner(size: 13); Text(L("domains.loadingDns")).foregroundColor(Theme.secondary).font(Typo.font(.callout)) }
                                } else if records.isEmpty {
                                    Text(L("domains.noRecords")).foregroundColor(Theme.tertiary).font(Typo.font(.callout))
                                } else {
                                    VStack(spacing: 0) {
                                        ForEach(records) { r in
                                            HStack(spacing: 12) {
                                                Text(r.type).font(Typo.font(.caption, weight: .bold, design: .monospaced))
                                                    .foregroundColor(Theme.accent).frame(width: 52, alignment: .leading)
                                                Text(r.name).font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.text).frame(width: 90, alignment: .leading)
                                                Text(r.value).font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.secondary)
                                                    .lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                                                Spacer()
                                                if let t = r.ttl { Text("\(t)s").font(Typo.font(.caption)).foregroundColor(Theme.tertiary) }
                                            }
                                            .padding(.vertical, 7)
                                            Rectangle().fill(Theme.hairline).frame(height: 1)
                                        }
                                    }
                                }
                            } else {
                                VStack(spacing: 10) {
                                    Image(systemName: "hand.point.left").font(Typo.font(.display)).foregroundColor(Theme.tertiary)
                                    Text(L("domains.pickDomainHint"))
                                        .font(Typo.font(.body)).foregroundColor(Theme.secondary).multilineTextAlignment(.center)
                                }
                                .frame(maxWidth: .infinity, minHeight: 200)
                            }
                        }
                        .card()
                        .frame(maxWidth: .infinity)
                    }

                    HStack {
                        Text(L("domains.keyInKeychain")).font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                        Spacer()
                        Button(L("domains.disconnect")) { model.disconnectSpaceship() }.bidButton(.ghost, compact: true)
                    }
                } else {
                    SpaceshipConnectCard()
                }
            }
            .padding(.horizontal, Space.page)
            .padding(.top, Space.top)
            .padding(.bottom, Space.page)
            .frame(maxWidth: 1120)
            .frame(maxWidth: .infinity)
        }
        .task { if model.spaceship == nil { await model.loadSpaceship() } }
    }

    func select(_ name: String) {
        selectedDomain = name
        loadingDNS = true
        Task {
            records = await model.dns(name)
            loadingDNS = false
        }
    }
}

struct DomainRow: View {
    let domain: SpaceshipDomain
    let selected: Bool
    @Local private var hover = false

    var body: some View {
        let days = domain.daysLeft ?? 9999
        HStack(spacing: 10) {
            Image(systemName: "globe").foregroundColor(selected ? .white : Theme.accent).frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(domain.unicodeName ?? domain.name).font(Typo.font(.body, weight: .semibold))
                    .foregroundColor(selected ? .white : Theme.text).lineLimit(1)
                HStack(spacing: 6) {
                    Text(domain.daysLeft.map { L("domains.expiresIn", count: $0) } ?? "—")
                    Text("·")
                    Text(domain.autoRenew ? "auto-renew" : L("domains.noAutoRenew"))
                }
                .font(Typo.font(.caption))
                .foregroundColor(selected ? Color.white.opacity(0.8) : (days < 30 ? Theme.warn : Theme.tertiary))
            }
            Spacer()
            if days < 30 {
                Image(systemName: "exclamationmark.triangle.fill").foregroundColor(selected ? .white : Theme.warn)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(selected ? Theme.accentFill : (hover ? Theme.elevated : .clear)))
        .contentShape(Rectangle())
        .onHover { hover = $0 }
    }
}

// MARK: - Connect Spaceship

struct SpaceshipConnectCard: View {
    @EnvironmentObject var model: AppModel
    @Local private var key = ""
    @Local private var secret = ""
    @Local private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: "network").font(Typo.font(.title, weight: .semibold)).foregroundColor(Theme.accent)

                VStack(alignment: .leading, spacing: 3) {
                    Text(L("spaceship.connect")).font(Typo.font(.headline, weight: .bold)).foregroundColor(Theme.text)
                    Text(L("spaceship.connectIntro"))
                        .font(Typo.font(.body)).foregroundColor(Theme.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                StepLine(n: 1, text: L("spaceship.step1"))
                StepLine(n: 2, text: L("spaceship.step2"))
                StepLine(n: 3, text: L("spaceship.step3"))
            }
            Button { model.open("https://www.spaceship.com/application/api-manager/") } label: { Label(L("spaceship.openApiManager"), systemImage: "safari") }
                .bidButton(.secondary)
            HStack(spacing: 10) {
                BIDTextField(placeholder: L("field.apiKey"), text: $key, mono: true)
                BIDField(placeholder: L("field.apiSecret"), text: $secret, kind: .secure)
                Button {
                    busy = true
                    Task {
                        _ = await model.connectSpaceship(key: key, secret: secret)
                        busy = false
                    }
                } label: {
                    if busy { Spinner(size: 12, color: .white) } else { Text(L("common.connect")) }
                }
                .bidButton(.primary)
                .disabled(key.isEmpty || secret.isEmpty || busy)
            }
            Text(L("spaceship.keyNote"))
                .font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
        }
        .card(padding: 22)
        .glowBorder(Theme.accent, strength: 0.8)

    }
}

struct StepLine: View {
    let n: Int
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)").font(Typo.font(.caption, weight: .bold)).foregroundColor(.white)
                .frame(width: 20, height: 20).background(Circle().fill(Theme.accentFill))
            Text(text).font(Typo.font(.body)).foregroundColor(Theme.text).fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct SpaceshipConnectSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        SheetScaffold(icon: "globe", title: L("spaceship.connect"), size: .l) {
            SpaceshipConnectCard()
        } actions: {
            Button(L("common.close")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
        }
        .onChange(of: model.spaceship?.connected == true) { connected in
            if connected { dismiss() }
        }
    }
}

// MARK: - Project hosting tab: domain card

struct DomainProjectCard: View {
    @EnvironmentObject var model: AppModel
    let status: ProjectStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(title: L("domains.projectCardTitle"), icon: "network",
                        status: model.spaceship?.connected == true ? "pass" : nil,
                        trailing: model.spaceship?.connected == true ? L("domains.count", count: model.spaceship?.domains.count ?? 0) : L("common.notConnectedLower"))
            if model.spaceship?.connected != true {
                HStack {
                    Text(L("domains.connectSpaceshipHint"))
                        .font(Typo.font(.body)).foregroundColor(Theme.secondary)
                    Spacer()
                    Button(L("spaceship.connect")) { model.sheet = .spaceshipConnect }.bidButton(.primary, compact: true)
                }
            } else if status.detect.netlifyLinked != true {
                Text(L("domains.linkNetlifyFirst")).font(Typo.font(.body)).foregroundColor(Theme.secondary)
            } else {
                Text(L("domains.pickDomainPlan"))
                    .font(Typo.font(.body)).foregroundColor(Theme.secondary)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8)], spacing: 8) {
                    ForEach(model.spaceship?.domains ?? []) { d in
                        Button {
                            model.domainForConnect = d.name
                            model.sheet = .connectDomain
                        } label: {
                            HStack {
                                Image(systemName: "globe")
                                Text(d.name).lineLimit(1)
                                Spacer()
                                Image(systemName: "link")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .bidButton(.secondary, compact: true)
                    }
                }
            }
        }
        .card()
    }
}

// MARK: - Connect domain → Netlify (preview then apply)

struct ConnectDomainSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var plan: DomainPlan?
    @Local private var error: String?

    var domain: String { model.domainForConnect ?? "" }

    var body: some View {
        SheetScaffold(icon: "link", title: L("domains.connectDomainTitle", domain), subtitle: L("domains.withProjectOnNetlify", model.selected?.name ?? L("domains.theProject")), width: 600) {
            VStack(alignment: .leading, spacing: 12) {
                if let error {
                    Text(error).foregroundColor(Theme.blocked).font(Typo.font(.body))
                } else if let plan {
                    Text(L("domains.whatIWillDo")).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(plan.add, id: \.self) { r in
                            planRow(symbol: "plus.circle.fill", tint: Theme.ready, r: r)
                        }
                        ForEach(plan.replace, id: \.self) { r in
                            planRow(symbol: "minus.circle.fill", tint: Theme.blocked, r: r)
                        }
                        HStack(spacing: 8) {
                            Image(systemName: "globe").foregroundColor(Theme.accent)
                            Text("Netlify: custom domain \(plan.domain) + www.\(plan.domain)")
                                .font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.text)
                        }
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: Radius.s, style: .continuous).fill(Theme.bg))
                    if !plan.replace.isEmpty {
                        Label(L("domains.redRecordsWarning"), systemImage: "exclamationmark.triangle.fill")
                            .font(Typo.font(.callout)).foregroundColor(Theme.warn)
                    }
                    if let n = plan.note { Text(n).font(Typo.font(.callout)).foregroundColor(Theme.tertiary) }
                } else {
                    HStack { Spinner(size: 13); Text(L("domains.checkingDns")).foregroundColor(Theme.secondary).font(Typo.font(.body)) }
                }
            }
        } actions: {
            Button(L("common.cancel")) { dismiss() }.bidButton(.secondary).keyboardShortcut(.cancelAction)
            Button(L("domains.connectDomain")) {
                dismiss()
                model.applyDomain(domain)
            }
            .bidButton(.primary)
            .disabled(plan == nil)
        }
        .task {
            do { plan = try await model.planDomain(domain) } catch { self.error = error.localizedDescription }
        }
    }

    func planRow(symbol: String, tint: Color, r: PlanRecord) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).foregroundColor(tint)
            Text("\(r.type)  \(r.name)  →  \(r.value)").font(Typo.font(.callout, design: .monospaced)).foregroundColor(Theme.text)
        }
    }
}

// MARK: - Device code card (GitHub browser login)

struct DeviceCodeCard: View {
    @ObservedObject var session: RunSession
    var body: some View {
        if session.deviceURL != nil, !session.finished {
            VStack(spacing: 10) {
                Text(L("devicecode.title", session.deviceService ?? "GitHub")).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.secondary)
                if let code = session.deviceCode {
                Text(code)
                    .font(Typo.font(.display, weight: .bold, design: .monospaced))
                    .tracking(4)
                    .foregroundColor(Theme.text)
                    .textSelection(.enabled)
                }
                if let expiry = session.deviceExpiresAt { Text(expiry, style: .timer).monospacedDigit() }
                Text(session.deviceCode == nil ? L("devicecode.browserHint") : L("devicecode.hint"))
                    .font(Typo.font(.callout)).foregroundColor(Theme.tertiary)
                if let u = session.deviceURL, let url = URL(string: u) {
                    Button { NSWorkspace.shared.open(url) } label: { Label(L("devicecode.reopen"), systemImage: "safari") }
                        .bidButton(.secondary, compact: true)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(18)
            .background(RoundedRectangle(cornerRadius: Radius.m, style: .continuous).fill(Theme.accentSoft))
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
    }
}
