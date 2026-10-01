import SwiftUI

// MARK: - Setup

struct SetupView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader(title: L("common.setup"), subtitle: L("setup.subtitle"), icon: "wand.and.stars") {
                    HStack(spacing: 8) {
                        if model.loadingSetup { Spinner(size: 14) }
                        Button { Task { await model.loadSetup() } } label: { Label(L("common.refresh"), systemImage: "arrow.clockwise") }
                            .bidButton(.secondary, compact: true)
                    }
                }

                if let s = model.setup {
                    let required = s.items.filter { !$0.optional }
                    let done = required.filter(\.ok).count
                    HStack(spacing: 18) {
                        ZStack {
                            ProgressRing(fraction: required.isEmpty ? 1 : Double(done) / Double(required.count))
                            Text("\(done)/\(required.count)").font(Typo.font(.subhead, weight: .bold)).foregroundColor(Theme.text)
                        }
                        .frame(width: 64, height: 64)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(s.ready ? L("setup.allRequiredSet") : L("setup.missingRequired", count: s.missingRequired))
                                .font(Typo.font(.headline, weight: .bold)).foregroundColor(Theme.text)
                            Text(L("setup.missingOptional", count: s.missingOptional))
                                .font(Typo.font(.body)).foregroundColor(Theme.secondary)
                        }
                        Spacer()
                        Button { model.setupAuto() } label: { Label(L("setup.autoAll"), systemImage: "bolt.fill") }
                            .bidButton(.primary)
                            .disabled(s.ready || model.loadingSetup || model.run?.finished == false)
                    }
                    .card(padding: 20)
                    .glowBorder(s.ready ? Theme.ready : Theme.accent, strength: 0.8)


                    if model.account?.canUseOwnKey == true { AIKeysCard().lift() }

                    ForEach(Array(groups(s.items).enumerated()), id: \.element.id) { gi, group in
                        VStack(alignment: .leading, spacing: 4) {
                            SectionLabel(text: group.name).padding(.bottom, 6)
                            ForEach(Array(group.items.enumerated()), id: \.element.id) { ii, item in
                                SetupRow(item: item)
                                if item.id != group.items.last?.id { Rectangle().fill(Theme.hairline).frame(height: 1) }
                            }
                        }
                        .card()
                        .lift()

                    }
                } else if let e = model.loadErrors["setup"] {
                    LoadFailedView(message: e) { await model.loadSetup() }
                } else {
                    HStack { Spinner(size: 16); Text(L("setup.checking")).foregroundColor(Theme.secondary) }
                        .frame(maxWidth: .infinity, minHeight: 200)
                }
            }
            .padding(.horizontal, Space.page)
            .padding(.top, Space.top)
            .padding(.bottom, Space.page)
            .frame(maxWidth: 1120)
            .frame(maxWidth: .infinity)
        }
    }

    struct SetupGroup: Identifiable {
        let name: String
        let items: [SetupItem]
        var id: String { name }
    }

    func groups(_ items: [SetupItem]) -> [SetupGroup] {
        var order: [String] = []
        var map: [String: [SetupItem]] = [:]
        for i in items {
            if map[i.group] == nil { order.append(i.group) }
            map[i.group, default: []].append(i)
        }
        return order.map { SetupGroup(name: $0, items: map[$0] ?? []) }
    }
}

struct SetupRow: View {
    @EnvironmentObject var model: AppModel
    let item: SetupItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.ok ? "checkmark.circle.fill" : (item.optional ? "circle.dashed" : "exclamationmark.circle.fill"))
                .font(Typo.font(.subhead))
                .foregroundColor(item.ok ? Theme.ready : (item.optional ? Theme.tertiary : Theme.accent))
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(item.title).font(Typo.font(.body, weight: .semibold)).foregroundColor(Theme.text)
                    if item.optional && !item.ok {
                        Text(L("setup.optional")).font(Typo.font(.micro, weight: .semibold)).foregroundColor(Theme.tertiary)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Capsule().fill(Theme.elevated))
                    }
                }
                Text(item.detail ?? "").font(Typo.font(.callout)).foregroundColor(Theme.tertiary).lineLimit(2).help(item.detail ?? "")
            }
            Spacer()
            if let a = item.action {
                if let d = a.display {
                    Text(d).font(Typo.font(.caption, design: .monospaced)).foregroundColor(Theme.tertiary).lineLimit(1)
                }
                Button(a.label) { model.setupAction(item) }
                    .bidButton(item.optional ? .secondary : .primary, compact: true)
            }
        }
        .padding(.vertical, 8)
    }
}
