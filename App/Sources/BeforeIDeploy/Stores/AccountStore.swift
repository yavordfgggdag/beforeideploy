import AppKit
import SwiftUI

/// Supabase account session, offline mode and cloud configuration.
@MainActor
final class AccountStore: ObservableObject {
    @Published var account: AccountState?
    @Published var accountChecked = false
    @AppStorage("offlineMode") var offlineMode = false

    let engine: EngineClient
    weak var feedback: Feedback?
    /// Called after a successful login, before the background sync (the facade starts the app here).
    var onLogin: (@MainActor () async -> Void)?

    init(engine: EngineClient) {
        self.engine = engine
    }

    var mustAuthenticate: Bool {
        guard accountChecked, let a = account else { return false }
        if a.loggedIn { return false }
        return !offlineMode
    }

    func loadAccount() async {
        account = try? await engine.call(["account", "status"], as: AccountState.self)
        accountChecked = true
    }

    /// Returns an error message, or nil on success.
    func signup(email: String, password: String, name: String) async -> String? {
        do {
            let r = try await engine.call(["account", "signup", "--email", email, "--name", name], as: AccountState.self,
                                          env: ["BID_PASSWORD": password])
            if r.confirmEmail == true { return "CONFIRM" }
            account = r
            await afterLogin()
            return nil
        } catch { return error.localizedDescription }
    }

    func login(email: String, password: String) async -> String? {
        do {
            account = try await engine.call(["account", "login", "--email", email], as: AccountState.self,
                                            env: ["BID_PASSWORD": password])
            await afterLogin()
            return nil
        } catch { return error.localizedDescription }
    }

    func recover(email: String) async -> String? {
        do {
            _ = try await engine.call(["account", "recover", "--email", email], as: [String: Bool].self)
            return nil
        } catch { return error.localizedDescription }
    }

    func oauth(_ provider: String) {
        Task {
            do {
                let r = try await engine.call(["account", "oauth", "--provider", provider], as: OAuthStart.self)
                if let u = URL(string: r.url) { NSWorkspace.shared.open(u) }
            } catch { feedback?.show(error) }
        }
    }

    func completeOAuth(_ url: URL) async {
        let fragment = url.fragment ?? URLComponents(url: url, resolvingAgainstBaseURL: false)?.query ?? ""
        var params: [String: String] = [:]
        for pair in fragment.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 { params[kv[0]] = kv[1].removingPercentEncoding ?? kv[1] }
        }
        guard let access = params["access_token"] else {
            feedback?.flash(params["error_description"]?.replacingOccurrences(of: "+", with: " ") ?? L("auth.denied"), error: true)
            return
        }
        do {
            account = try await engine.call(["account", "session"], as: AccountState.self,
                                            env: ["BID_ACCESS": access, "BID_REFRESH": params["refresh_token"] ?? ""])
            NSApp.activate(ignoringOtherApps: true)
            await afterLogin()
        } catch { feedback?.show(error) }
    }

    private func afterLogin() async {
        offlineMode = false
        feedback?.flash(L("auth.hello", account?.name ?? account?.email ?? ""), error: false)
        await onLogin?()
        Task { _ = try? await engine.run(["account", "sync"]) }
    }

    func logout() {
        Task {
            _ = try? await engine.run(["account", "logout"])
            offlineMode = false
            await loadAccount()
        }
    }

    func syncNow() {
        Task {
            let o = try? await engine.run(["account", "sync"])
            if o?.ok == true {
                feedback?.flash(L("account.synced"), error: false)
            } else {
                feedback?.flash(o?.errorMessage ?? L("account.syncFailed"), error: true)
            }
        }
    }

    func configureCloud(url: String, key: String) async -> String? {
        do {
            _ = try await engine.call(["cloud", "config", "--url", url, "--anon-key", key], as: [String: Bool].self)
            await loadAccount()
            return nil
        } catch { return error.localizedDescription }
    }

    static let cloudSchema = #"""
-- Before I Deploy — Supabase schema (run once in Supabase → SQL Editor)
-- Only project METADATA is stored. Service tokens (Netlify, Vercel, GitHub…) never leave the user's Mac.

create table if not exists public.bid_projects (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  key         text        not null,
  name        text        not null,
  framework   text,
  hosting     text,
  live_url    text,
  domain      text,
  last_status text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.bid_projects enable row level security;

-- Every user sees and edits only their own rows.
drop policy if exists "own rows" on public.bid_projects;
create policy "own rows" on public.bid_projects
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
"""#
}
