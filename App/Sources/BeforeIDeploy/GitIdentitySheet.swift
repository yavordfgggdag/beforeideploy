import SwiftUI

struct GitIdentitySheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Local private var name = ""
    @Local private var email = ""
    @Local private var busy = false
    @Local private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(L("setup.identity.title")).font(.title2.bold())
            Text(L("setup.identity.explanation")).foregroundColor(Theme.secondary)
            TextField(L("setup.identity.name"), text: $name).textFieldStyle(.roundedBorder)
            TextField(L("setup.identity.email"), text: $email).textFieldStyle(.roundedBorder)
            if let error { Text(error).foregroundColor(Theme.blocked).textSelection(.enabled) }
            HStack {
                Button(L("common.cancel")) { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                if busy { ProgressView().controlSize(.small) }
                Button(L("common.save")) {
                    busy = true; error = nil
                    Task {
                        defer { busy = false }
                        do {
                            let result = try await model.engine.run(["setup", "identity", "--name", name, "--email", email, "--yes"], timeout: 30)
                            if result.ok { await model.loadSetup(); dismiss() }
                            else { error = result.errorMessage }
                        } catch { self.error = error.localizedDescription }
                    }
                }.keyboardShortcut(.defaultAction).disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || !email.contains("@"))
            }
        }.padding(24).frame(width: 420).background(Theme.bg)
    }
}
