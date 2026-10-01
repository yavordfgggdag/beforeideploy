import SwiftUI

// MARK: - Cloud setup (owner, once)

struct CloudSetupView: View {
    @EnvironmentObject var model: AppModel
    @Local private var url = ""
    @Local private var key = ""
    @Local private var error: String?
    @Local private var busy = false

    var body: some View {
        HStack(spacing: 0) {
            BrandPanel().frame(maxWidth: .infinity, maxHeight: .infinity)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(L("cloud.title")).font(Typo.font(.title, weight: .bold)).foregroundColor(Theme.text)
                    Text(L("cloud.subtitle"))
                        .font(Typo.font(.body)).foregroundColor(Theme.secondary)
                    VStack(alignment: .leading, spacing: 10) {
                        StepLine(n: 1, text: L("cloud.step1"))
                        StepLine(n: 2, text: L("cloud.step2"))
                        StepLine(n: 3, text: L("cloud.step3"))
                        StepLine(n: 4, text: L("cloud.step4"))
                    }
                    HStack {
                        Button { model.open("https://supabase.com/dashboard/new") } label: { Label(L("cloud.openSupabase"), systemImage: "safari") }
                            .bidButton(.secondary, compact: true)
                        Button { Task { if await model.copyCloudSchema() { model.flash(L("cloud.schemaCopied")) } } } label: { Label(L("cloud.copySchema"), systemImage: "doc.on.doc") }
                            .bidButton(.secondary, compact: true)
                    }
                    BIDTextField(placeholder: "https://xxxx.supabase.co", text: $url, mono: true)
                    BIDTextField(placeholder: L("cloud.anonKeyPlaceholder"), text: $key, mono: true)
                    if let error { Text(error).foregroundColor(Theme.blocked).font(Typo.font(.body)) }
                    Button {
                        busy = true
                        Task {
                            error = await model.configureCloud(url: url.trimmingCharacters(in: .whitespaces), key: key.trimmingCharacters(in: .whitespaces))
                            busy = false
                        }
                    } label: {
                        HStack {
                            Spacer()
                            if busy { Spinner(size: 12, color: .white) }
                            Text(L("common.connect"))
                            Spacer()
                        }
                    }
                        .bidButton(.primary)
                        .disabled(url.isEmpty || key.isEmpty || busy)
                    Button(L("cloud.continueOffline")) { model.continueOffline() }
                        .buttonStyle(.plain).foregroundColor(Theme.tertiary).font(Typo.font(.callout))
                }
                .padding(48)
            }
            .frame(width: 480)
            .background(Theme.bg)
        }
    }
}

/// "Trouble signing in?" — runs `bid cloud doctor` and shows the owner exactly what the cloud project lacks.
struct CloudCheckLine: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                Task { await model.checkCloud() }
            } label: {
                HStack(spacing: 6) {
                    if model.cloudChecking { Spinner(size: 11) } else { Image(systemName: "stethoscope") }
                    Text(L("auth.checkCloud"))
                }
            }
            .buttonStyle(.plain).foregroundColor(Theme.accent).font(Typo.font(.body))
            .disabled(model.cloudChecking)
            if let d = model.cloudDoctor {
                VStack(alignment: .leading, spacing: 5) {
                    line(d.reachable, d.reachable ? L("cloud.doctor.reachable", d.ref ?? d.url ?? "") : L("cloud.doctor.unreachable", d.error ?? ""))
                    if d.reachable {
                        line(d.schemaApplied == true, d.schemaApplied == true ? L("cloud.doctor.schemaOk") : L("cloud.doctor.schemaMissing", (d.tablesMissing ?? []).joined(separator: ", ")))
                        line((d.functionsMissing ?? []).isEmpty, (d.functionsMissing ?? []).isEmpty ? L("cloud.doctor.functionsOk") : L("cloud.doctor.functionsMissing", (d.functionsMissing ?? []).joined(separator: ", ")))
                        if let a = d.auth {
                            line(a.signupEnabled != false, a.signupEnabled != false ? L("cloud.doctor.signupOn") : L("cloud.doctor.signupOff"))
                            line(a.emailConfirmRequired != true, a.emailConfirmRequired != true ? L("cloud.doctor.confirmOff") : L("cloud.doctor.confirmOn"))
                        }
                        if d.schemaApplied != true || !(d.functionsMissing ?? []).isEmpty || d.auth?.emailConfirmRequired == true {
                            Text(L("cloud.doctor.ownerHint")).font(Typo.font(.callout)).foregroundColor(Theme.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                            HStack(spacing: 8) {
                                if let u = d.dashboard?.project {
                                    Button { model.open(u) } label: { Label(L("cloud.doctor.openDashboard"), systemImage: "arrow.up.right") }
                                        .bidButton(.secondary, compact: true)
                                }
                                Button { model.screen = .setup; model.continueOffline(); Task { await model.loadSetup() } } label: { Label(L("cloud.doctor.openSetup"), systemImage: "wand.and.stars") }
                                    .bidButton(.ghost, compact: true)
                            }
                        }
                    }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).fill(Theme.panel))
                .overlay(RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))

            }
        }
    }

    private func line(_ ok: Bool, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(Typo.font(.callout)).foregroundColor(ok ? Theme.ready : Theme.blocked)
            Text(text).font(Typo.font(.callout)).foregroundColor(Theme.text).fixedSize(horizontal: false, vertical: true)
        }
    }
}
