# Research: desktop shell, Paddle Billing, cloud runners, LLM pricing

Date of research: 2026-10-01. Product: "Before I Deploy" (zero-dependency Node.js CLI engine that spawns git/npm/netlify CLI and runs project builds; Supabase backend; SwiftUI macOS app; target is web, macOS, Windows and Linux sharing one UI).

**Method note.** WebFetch was egress-blocked in this environment for every domain tried (docs.anthropic.com, openai.com, v2.tauri.app, developer.paddle.com). All facts below come from WebSearch result summaries of the cited URLs, or from the bundled Anthropic `claude-api` skill reference (cached 2026-09-25). Where a figure comes only from a third-party page, or a summary that could not be checked against the primary page, it is marked **UNVERIFIED** or "(3rd-party)". Re-check every price in this file on the primary page before committing to a budget.

---

## 1. Desktop shell comparison

### 1.1 Requirements specific to this product
- The engine is plain Node.js and needs no npm dependencies. It spawns `git`, `npm`, `netlify` and the project's own build. So the desktop app needs either (a) a Node runtime, bundled or already installed, plus child-process spawning, or (b) a rewrite. A rewrite is not justified.
- The same web UI ships as the web app. The desktop shell should load that UI with a thin native bridge (keychain, file dialogs, spawning the engine, updates).
- The engine runs the user's own toolchain (their `npm`, `git` and `netlify` on PATH). **This rules out a strict sandbox such as Flatpak or the Mac App Store sandbox** as the main distribution channel (see 1.6).

### 1.2 Candidates at a glance

| Criterion | Tauri 2 | Electron | Wails (v2 stable / v3 beta) | Neutralinojs | Flutter desktop |
|---|---|---|---|---|---|
| Running the Node engine | Bundle Node as a **sidecar** via `bundle.externalBin`. You must ship one binary per target triple (e.g. `my-sidecar-x86_64-unknown-linux-gnu`, `-aarch64-apple-darwin`). The shell plugin must be granted execute/spawn permission with `"sidecar": true` in `capabilities/*.json` ([Tauri sidecar](https://v2.tauri.app/develop/sidecar/), [Node.js as a sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)) | Node is built in; the main process can `child_process.spawn` the engine directly | Go backend. You would ship a Node binary and spawn it from Go (no first-class sidecar concept, **UNVERIFIED**) | "Extensions" are child processes spawned by the framework. They connect back over WebSocket with a token passed on stdin ([Neutralino extensions](https://neutralino.js.org/docs/how-to/extensions-overview/), [security](https://neutralino.js.org/docs/contributing/security/)) | Dart `Process.start` could spawn Node. The UI would have to be rewritten in Flutter, or embedded through third-party webview plugins ([flutter#99597](https://github.com/flutter/flutter/issues/99597)) |
| Bundle size | About 2.5–10 MB installer for a hello-world app (3rd-party: [levminer](https://www.levminer.com/blog/tauri-vs-electron), [buildmvpfast](https://www.buildmvpfast.com/blog/tauri-v2-vs-electron-desktop-apps-2026)). **Add about 40–110 MB for a bundled Node SEA binary** (UNVERIFIED estimate; Node binary size depends on version and platform) | About 85 MB or more for hello-world, because it ships Chromium and Node ([levminer](https://www.levminer.com/blog/tauri-vs-electron), [gethopp](https://www.gethopp.app/blog/tauri-vs-electron)) | Similar to Tauri (system webview), plus Node if bundled | Smallest shell. Node must still be bundled or required | Larger than Tauri. No web UI reuse |
| WebView | WKWebView (macOS), WebView2 (Windows), WebKitGTK 4.1 (Linux) | Bundled Chromium, identical on every OS | Same as Tauri. v3 defaults to GTK4 with WebKitGTK 6.0 ([Wails v3 beta](https://v3.wails.io/blog/wails-v3-beta/)) | System webviews | None (Skia/Impeller canvas) |
| Auto-updater | Official updater plugin. Signatures are mandatory and cannot be disabled. Static JSON or a dynamic server. Linux updates cover AppImage, and deb/rpm since updater v2.10 ([Updater](https://v2.tauri.app/plugin/updater/), [changelog](https://v2.tauri.app/release/updater/all-versions/)) | electron-updater checks code signatures on macOS and Windows, supports staged rollouts and differential (blockmap/delta) downloads, and on Linux covers AppImage, deb, rpm and pacman ([electron.build auto-update](https://www.electron.build/docs/features/auto-update/)) | DIY or third-party (**UNVERIFIED**) | Built-in updater based on a manifest (**UNVERIFIED**) | No official updater (**UNVERIFIED**) |
| Security model | Tauri 2 capabilities, permissions and scopes. Every IPC command is denied by default and the webview is treated as untrusted ([Capabilities](https://v2.tauri.app/security/capabilities/)) | Since Electron 12, contextIsolation is on by default. nodeIntegration has been off since Electron 5, and the renderer sandbox has been on since Electron 20. You expose a minimal preload API with `contextBridge` ([Electron security](https://www.electronjs.org/docs/latest/tutorial/security)) | Go bindings are generated from exported methods | Token-based WebSocket API plus an allowlist of native APIs (`nativeAllowList`) in config ([config](https://neutralino.js.org/docs/configuration/neutralino.config.json/)) | Not applicable |
| Maturity / maintenance | v2 stable. Rust toolchain needed. Linux WebKitGTK quirks (1.3) | Most mature. Chromium upgrades (major release every 8 weeks, **UNVERIFIED**) are the main maintenance cost | v3 is still beta (v3.0.0-beta.26, 2026-09-25). v2 is the stable line ([Wails v3 beta](https://v3.wails.io/blog/wails-v3-beta/), [releases](https://github.com/wailsapp/wails/releases)) | Small project; fewer resources | Strong framework, but no reuse of the web UI |

### 1.3 WebView differences and known Linux WebKitGTK issues
- Tauri 2 on Linux needs **webkit2gtk-4.1**. Build on the oldest distro you support that ships it: **Ubuntu 22.04 or Debian 12** (glibc 2.35 floor) ([Tauri AppImage](https://v2.tauri.app/distribute/appimage/), [Distribute](https://v2.tauri.app/distribute/)).
- Known problems:
  - Blank windows or rendering glitches with NVIDIA drivers ([Linux graphics](https://v2.tauri.app/develop/debug/linux-graphics/), [tauri#9394](https://github.com/tauri-apps/tauri/issues/9394), [tauri#13157](https://github.com/tauri-apps/tauri/issues/13157)).
  - AppImages showing a blank window on Mesa 25+ / Wayland with `EGL_BAD_PARAMETER` errors. The common workaround, `WEBKIT_DISABLE_DMABUF_RENDERER=1`, forces software compositing.
  - AppImages missing `libwebkit2gtkinjectedbundle.so` ([tauri#12463](https://github.com/tauri-apps/tauri/issues/12463)).
  - AppImage crashes with no XWayland when `GDK_BACKEND` is unset ([tauri#15902](https://github.com/tauri-apps/tauri/issues/15902)).
  - Slower initial render in recent wry/WebKitGTK versions ([wry#1315](https://github.com/tauri-apps/wry/issues/1315)).
- The UI also has to work in three engines: Safari/WebKit on macOS and Linux, Chromium on Windows (WebView2). Budget cross-engine QA for CSS and JS features. Electron avoids this because it ships one Chromium.
- For this product the UI is mostly forms, logs and lists. That is low risk on WebKitGTK, but a streaming log view should be tested with software rendering.

### 1.4 Code signing and notarization per OS

**macOS**
- Distributing outside the App Store needs a **Developer ID** certificate and **notarization** (with `notarytool`). Notarization requires the **hardened runtime** ([Xojo overview](https://blog.xojo.com/2024/08/22/macos-apps-from-sandboxing-to-notarization-the-basics/), [Apple Developer forums](https://developer.apple.com/forums/tags/notarization)).
- Only the Account Holder can create Developer ID certificates.
- The Apple Developer Program costs **USD 99 per membership year** ([Apple](https://developer.apple.com/programs/whats-included/)).
- A bundled Node sidecar is an extra Mach-O binary. It must be signed with hardened runtime too, and if it is a Node SEA its signature must be stripped before injection and re-applied afterwards ([Node SEA docs](https://nodejs.org/api/single-executable-applications.html)).
- Node's JIT probably needs the `com.apple.security.cs.allow-jit` entitlement (**UNVERIFIED**; test it in the spike).

**Windows**
- Use Authenticode signing.
- **Azure Artifact Signing** (formerly Trusted Signing):
  - Price: Basic **$9.99/month** (5,000 signatures), Premium $99.99/month (100,000), overage $0.005 per signature (3rd-party summaries: [my-ssl](https://my-ssl.com/learn/azure-trusted-signing-vs-code-signing-certificate), [Rick Strahl](https://weblog.west-wind.com/posts/2025/Jul/20/Fighting-through-Setting-up-Microsoft-Trusted-Signing); confirm on the Azure pricing page).
  - Organizations: public-trust certificates are available to organizations in the US, Canada, **EU**, UK and several other countries.
  - **Individual developers: US and Canada only** ([MS Learn code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options), [Q&A: country not available](https://learn.microsoft.com/en-us/answers/questions/5810735/cant-create-a-new-trusted-signing-individual-ident), [artifact-signing-action#81](https://github.com/Azure/artifact-signing-action/issues/81)).
  - One 2026 report says the service went GA and accepts **self-employed individuals / businesses in the US, CA, EU and UK** without the earlier 3-year history requirement ([itwriting](https://www.itwriting.com/blog/12462-getting-started-with-azure-artifact-signing.html), [devclass 2026-01](https://www.devclass.com/security/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/4079554)). **UNVERIFIED for Bulgaria specifically.** A Bulgarian EOOD/OOD with a registered legal entity and DUNS-style validation is the likely route. A Bulgarian natural person probably cannot onboard.
  - Fallback: an OV certificate on a cloud HSM or token from a commercial CA. The price varies with the CA (**UNVERIFIED**).
- **SmartScreen:** since about March 2024, EV certificates **no longer give instant reputation**. OV and EV certificates both build reputation through download volume ([ToDesktop PSA](https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore), [DigiCert KB](https://knowledge.digicert.com/alerts/ev-signed-application-showing-microsoft-defender-smartscreen-warnings)). Plan for "Windows protected your PC" warnings on the first releases. Mitigations: also publish to the Microsoft Store/winget (Store-signed builds avoid SmartScreen; **UNVERIFIED**), and keep the same signing identity across releases.

**Linux**
- No OS-level signing is required.
- Sign the updater artifacts: Tauri uses minisign keys, and electron-updater supports a hash/signature in `latest-linux.yml`.
- Optionally GPG-sign .deb/.rpm repos.

### 1.5 Linux packaging formats and distros
- Tauri can bundle **.deb, .rpm and AppImage**. Flatpak, Snap and AUR are documented distribution options ([Tauri Distribute](https://v2.tauri.app/distribute/)).
- Electron (electron-builder) can auto-update AppImage, deb, rpm and pacman ([electron.build](https://www.electron.build/docs/features/auto-update/)).
- **Flatpak is a poor fit as the primary channel.** The engine must spawn the user's host `git`, `npm` and `netlify`. Inside Flatpak that needs `flatpak-spawn --host`, which mishandles TTYs, does not pass through host PATH or npm-global, and needs the `org.freedesktop.Flatpak` D-Bus permission ([flatpak-spawn(1)](https://man7.org/linux/man-pages/man1/flatpak-spawn.1.html), [Obsidian/Flatpak notes](https://dev.to/rbcn/running-obsidian-community-plugins-in-flatpak-battle-notes-and-a-move-to-appimage-4c1f)). Flathub review may also object to `--talk-name=org.freedesktop.Flatpak` (**UNVERIFIED**).
- Recommended Linux matrix:
  - **Tier 1:** Ubuntu 22.04/24.04 LTS and Debian 12/13, shipped as .deb plus AppImage.
  - **Tier 2:** Fedora (current two releases), shipped as .rpm. Treat AppImage as the catch-all for Arch and others.
  - Support x86_64 first, then aarch64.
  - Build in CI on an ubuntu-22.04 runner or container ([Tauri GitHub pipeline](https://tauri.app/distribute/pipelines/github/)).

### 1.6 Secure credential storage per OS
- **macOS:** Keychain. **Windows:** Credential Manager / DPAPI. **Linux:** Secret Service API (gnome-keyring, KWallet) through libsecret or D-Bus.
- **Tauri:** the Stronghold plugin "is no longer recommended and will be deprecated and removed in v3" ([Tauri stronghold docs](https://v2.tauri.app/reference/javascript/stronghold/), [discussion #7846](https://github.com/orgs/tauri-apps/discussions/7846)). Use the `keyring` crate (keyring-core) or a community plugin ([tauri-plugin-keyring](https://github.com/charlesportwoodii/tauri-plugin-keyring/tree/master)).
- **Electron:** `safeStorage`.
  - On Linux it picks `gnome_libsecret`, `kwallet`, `kwallet5` or `kwallet6`, or **`basic_text`, which uses a hard-coded key and is effectively plaintext** when no keyring is detected. Check `safeStorage.getSelectedStorageBackend()` and treat `basic_text` as "no secure storage" ([Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [Signal-Desktop#7944](https://github.com/signalapp/Signal-Desktop/issues/7944)).
  - Tiling WMs (Hyprland, Sway, i3) often report no backend even when a keyring is running ([semaphore-chat#549](https://github.com/semaphore-chat/semaphore-chat/issues/549)).
- **No keyring daemon (headless, minimal WM, some KDE setups):**
  - Some keyring libraries silently fall back to the **in-memory kernel keyutils** store. Secrets then vanish on reboot, and "get" returns null instead of throwing, so a file fallback never triggers ([kody-bot/cli#5](https://github.com/kody-bot/cli/issues/5), [mynd#74](https://github.com/oxHive/mynd/pull/74), [openclaw#156945](https://github.com/openclaw/openclaw/issues/156945)).
  - Policy for this product:
    1. Probe Secret Service over D-Bus explicitly.
    2. If it is missing, tell the user clearly. Offer (a) installing or unlocking gnome-keyring/KWallet, or (b) a passphrase-encrypted file (Argon2id + AES-GCM), or (c) session-only tokens.
    3. Never write plaintext silently.
  - The Supabase refresh token, Netlify token and GitHub token all go through this path.

### 1.7 Recommendation

**Primary: Tauri 2 for Windows and Linux, plus a Tauri (WKWebView) macOS build that replaces the SwiftUI app over time. Electron stays as the fallback if the spike fails.**

Reasoning:
1. **Shared UI.** The web app and all desktop apps render the same SPA. Tauri's system webview gives small installers (single-digit MB plus Node).
2. **Node engine.** Ship the existing engine unchanged as a Node SEA sidecar. `node --build-sea` arrived in Node 25.5 and simplifies the build ([Node 25.5.0 release](https://nodejs.org/en/blog/release/v25.5.0), [Joyee Cheung blog](https://joyeecheung.github.io/blog/2026/01/26/improving-single-executable-application-building-for-node-js/)). Alternatively ship a plain `node` binary plus the engine JS as a sidecar. Either way the engine keeps zero dependencies. Talk to it over stdio JSON-lines from Rust, and expose only a few typed Tauri commands to the webview (`run_check`, `cancel`, `get_status`). **Do not grant the webview generic `shell:allow-execute`.**
3. **Security.** Capabilities are deny-by-default, so the webview cannot spawn arbitrary commands. Electron can be made equally safe (contextIsolation plus sandbox plus a narrow preload), but there it is a discipline rather than a default.
4. **Updater.** Mandatory signatures. Static JSON can sit on Supabase Storage, Netlify or S3. Rollback means publishing an older version under a higher version number, or using a dynamic server ([Updater](https://v2.tauri.app/plugin/updater/)). Electron has better built-in staged rollouts and delta updates, so this is a small point in Electron's favour.
5. **Costs and risks.** The team needs Rust for the thin host layer (a few hundred lines). There is real Linux WebKitGTK QA burden (1.3) and three-engine CSS testing.
6. **Why not keep SwiftUI.** It doubles UI work. Keep it only if there is a mac-only native feature roadmap. A pragmatic path is to keep SwiftUI shipping until the Tauri mac build reaches parity, then retire it.
7. **Why not Wails.** v3 is still beta (2026-09) and Go adds a third language. **Why not Neutralino.** Smaller ecosystem and a weaker security story. **Why not Flutter.** The UI cannot be reused with the web app.
8. **Choose Electron instead if** the spike shows WebKitGTK rendering problems on target distros that cannot be fixed, or if sidecar signing or notarization of Node proves painful. Electron removes both problems: Node is in-process, and Chromium is identical everywhere. The cost is about 100 MB or more per install and Chromium-cadence upgrades.

### 1.8 Spike checklist (time-box: about 5–7 dev-days)
- [ ] Scaffold Tauri 2 with the existing web UI build as `frontendDist`. Hot reload works in dev.
- [ ] Build the engine as a Node SEA (`node --build-sea`) for x86_64/aarch64 macOS, x86_64 Windows and x86_64 Linux. Name binaries by target triple. Wire up `externalBin`.
- [ ] Rust command layer: spawn the sidecar, stream stdout JSON-lines to the UI through Tauri events, cancel by killing the process tree (on Windows use a Job Object), and handle sidecar crash and restart.
- [ ] Check that the sidecar sees the user's PATH (nvm, fnm, volta, Homebrew, `%APPDATA%\npm`). A GUI app on macOS does **not** inherit the shell PATH. Implement a login-shell PATH probe.
- [ ] Capabilities file: only custom commands plus the dialog/updater permissions. Confirm the webview cannot call `shell.execute`.
- [ ] Keychain: store and retrieve tokens on macOS, Windows, Ubuntu GNOME, Fedora KDE, and a headless/i3 VM. Verify the "no Secret Service" UX.
- [ ] macOS: sign the app and sidecar with hardened runtime, notarize, staple. Test entitlements (JIT) and the Gatekeeper first launch.
- [ ] Windows: sign with Azure Artifact Signing (confirm the Bulgarian legal entity can onboard) or an OV certificate. NSIS installer. Observe SmartScreen on a clean VM.
- [ ] Linux: build on ubuntu-22.04 and produce .deb, .rpm and AppImage. Test on Ubuntu 22.04/24.04, Debian 12, Fedora 40+, an NVIDIA GPU and Wayland. Test `WEBKIT_DISABLE_DMABUF_RENDERER`.
- [ ] Updater: generate keys, publish static `latest.json`, upgrade from 0.1 to 0.2 on all three OSes, and test a "rollback" by publishing 0.2.1 that contains the 0.1 code.
- [ ] Measure installer size, cold start time and idle RAM. Compare with a minimal Electron build of the same UI (half a day) to make the go/no-go decision.
- [ ] Run the same UI in the browser (web app) against the cloud runner. Confirm one codebase with a `platform` adapter (local sidecar or cloud API).

---

## 2. Paddle Billing

| Topic | Finding | Source |
|---|---|---|
| Monthly ↔ annual switch | **Yes.** Replace the subscription items with prices that have the new interval. "All items must share the same billing period," so swap **all** recurring prices together | [Upgrade/downgrade](https://developer.paddle.com/build/subscriptions/replace-products-prices-upgrade-downgrade/) |
| Proration modes allowed when billing frequency changes | Only `prorated_immediately`, `full_immediately` and `do_not_bill`. `do_not_bill` for frequency changes was added in 2024. The `*_next_billing_period` modes are **not** allowed for frequency changes | [Change billing dates](https://developer.paddle.com/build/subscriptions/change-billing-dates/), [changelog 2024](https://developer.paddle.com/changelog/2024/change-billing-frequency-proration-billing-mode/) |
| All proration modes | `prorated_immediately` (prorate and charge now), `prorated_next_billing_period` (prorate and add to the next renewal), `full_immediately`, `full_next_billing_period`, `do_not_bill`. Proration is calculated to the minute | [Update subscription](https://developer.paddle.com/api-reference/subscriptions/update-subscription/), [Upgrade/downgrade](https://developer.paddle.com/build/subscriptions/replace-products-prices-upgrade-downgrade/) |
| Billing anchor | `next_billed_at` can be updated to move the anchor. This may produce a prorated charge or credit, controlled by the proration mode. Whether a frequency change resets the anchor to "now" is **UNVERIFIED**; preview it with "Preview an update" | [Change billing dates](https://developer.paddle.com/build/subscriptions/change-billing-dates/), [Preview update](https://developer.paddle.com/api-reference/subscriptions/preview-subscription-update/) |
| Rate limit on chargeable updates | Up to 20 chargeable updates per subscription per hour, 100 per day | [changelog 2024](https://developer.paddle.com/changelog/2024/subscription-immediate-charge-limits/) |
| Scheduled changes | Cancel or pause at the period end creates `scheduled_change` (`effective_at` = `next_billed_at`). Set `scheduled_change: null` to remove it. To update a subscription that has a scheduled change you must use `full_immediately`, `prorated_immediately` or `do_not_bill` | [Cancel](https://developer.paddle.com/api-reference/subscriptions/cancel-subscription/), [error doc](https://developer.paddle.com/errors/subscriptions/subscription_invalid_billing_mode_for_scheduled_change), [changelog 2025](https://developer.paddle.com/changelog/2025/update-subscriptions-scheduled-change/) |
| Pause / resume | Pause with `effective_from` = `next_billing_period` or `immediately`. Resume at any time, or set `resume_at`. On resume Paddle bills immediately by default. **Not available in the customer portal**; build it yourself through the API | [Pause](https://developer.paddle.com/build/subscriptions/pause-subscriptions/), [Resume](https://developer.paddle.com/api-reference/subscriptions/resume-subscription/) |
| Cancel / reactivate | **Canceled subscriptions cannot be reinstated.** Before the effective date you can remove the scheduled cancel (`scheduled_change: null`). After it, create a new subscription. Paddle recommends pause rather than cancel when you want self-serve reactivation | [Pause guide](https://developer.paddle.com/build/subscriptions/pause-subscriptions/), [Dunning](https://developer.paddle.com/build/lifecycle/subscription-renewal-dunning) |
| past_due / dunning | When a renewal fails the status becomes `past_due` (`subscription.past_due` webhook). Payment Recovery retries **up to 7 times over 30 days**: retries 1–4 within about 10–12 days, 5–7 by about day 20. Retries are on by default for all Billing accounts (2025). At the end the subscription pauses or cancels (configurable). Recovery emails go out on days 1, 3, 5 and 7. Manually collected (invoice) subscriptions also move to past_due | [Dunning](https://developer.paddle.com/build/lifecycle/subscription-renewal-dunning), [default retries 2025](https://developer.paddle.com/changelog/2025/default-dunning-payment-recovery/), [Payment Recovery](https://developer.paddle.com/concepts/retain/payment-recovery-dunning/), [subscription.past_due](https://developer.paddle.com/webhooks/subscriptions/subscription-past-due/) |
| Refunds | Create an **adjustment** with `action: refund`, `type: full` or `partial` (item-level). Partial refunds can use tax-exclusive amounts (2025). **Refunds on live accounts usually need Paddle approval.** `action: credit` needs no approval | [Refund or credit](https://developer.paddle.com/build/transactions/create-transaction-adjustments/), [Create adjustment](https://developer.paddle.com/api-reference/adjustments/create-adjustment/), [tax-exclusive refunds](https://developer.paddle.com/changelog/2025/tax-exclusive-refunds/) |
| Chargebacks / disputes | Paddle auto-creates adjustments with `action` `chargeback_warning` (early warning) or `chargeback`, and `chargeback_reverse` if Paddle wins. Listen to `adjustment.created` and `adjustment.updated`. **Chargeback fee is 20 USD/GBP/EUR (40 CAD/AUD) and is not refunded even if Paddle wins** | [Refund or credit](https://developer.paddle.com/build/transactions/create-transaction-adjustments/), [adjustment.created](https://developer.paddle.com/webhooks/adjustments/adjustment-created), [Understanding chargebacks](https://www.paddle.com/help/manage/risk-prevention/understanding-chargebacks-with-paddle) |
| Invoices for customers | The hosted **customer portal** shows payments, PDF invoice download, payment method updates and subscription management. Use `POST /customers/{id}/portal-sessions` for deep links. API: `GET /transactions/{id}/invoice` returns a PDF URL that **expires after 1 hour** (`disposition` = attachment or inline). Available for completed (auto-collected) or billed/completed (manual) transactions, and not for zero-value ones | [Customer portal](https://developer.paddle.com/concepts/sell/customer-portal/), [Portal session](https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/), [Invoice PDF](https://developer.paddle.com/api-reference/transactions/get-invoice-pdf) |
| Sandbox test cards | Visa debit 4000 0566 5566 5556; no 3DS 4242 4242 4242 4242; **3DS 4000 0038 0000 0446**; **declined 4000 0000 0000 0002**; **succeeds first, declines later 4000 0027 6000 3184** (use this for dunning tests). Any name and any future expiry | [Sandbox](https://developer.paddle.com/sdks/sandbox/), [Cards](https://developer.paddle.com/concepts/payment-methods/card/) |
| Webhook simulator | Sends single events or scenario flows (configurable payment outcomes) to your endpoint. Lets you inspect and replay payloads | [Webhook simulator](https://developer.paddle.com/webhooks/simulator/), [Simulate webhooks](https://developer.paddle.com/webhooks/test-webhooks) |
| Retain testing | Retain interventions can be simulated in sandbox | [Test Retain](https://developer.paddle.com/paddle-js/about/test-retain/) |
| Webhook ordering / idempotency | **Order is not guaranteed.** Store `occurred_at` per entity and ignore older events. Delivery is **at least once**, so dedupe on `event_id`. Respond 2xx within **5 seconds**. Retries: live **60 times over 3 days** with exponential backoff; sandbox 3 times in 15 minutes. Verify the `Paddle-Signature` header (**UNVERIFIED** header name; standard SDK `unmarshal` helper) | [Handle delivery](https://developer.paddle.com/webhooks/about/respond-to-webhooks/), [How webhooks work](https://developer.paddle.com/webhooks/about/how-webhooks-work/), [Provision access](https://developer.paddle.com/build/subscriptions/provision-access-webhooks/) |
| Merchant of Record / VAT (EU, Bulgaria) | Paddle is the MoR. It calculates, collects and remits VAT/GST/sales tax wherever required. Bulgaria is listed at **20%** VAT. B2B buyers who enter a valid VAT ID on a cross-border sale pay no VAT (reverse charge). The seller sells to Paddle, which is a B2B reverse-charge supply to Paddle (UK). The seller does **not** invoice Paddle; Paddle issues a reverse invoice / self-bill for payouts | [Which countries](https://www.paddle.com/help/sell/tax/which-countries-does-paddle-charge-sales-tax-or-vat-for), [How Paddle handles VAT](https://www.paddle.com/help/sell/tax/how-paddle-handles-vat-on-your-behalf), [Should I charge Paddle VAT](https://www.paddle.com/help/manage/get-paid/should-i-charge-paddle-vattax-for-payouts), [Do I invoice Paddle](https://www.paddle.com/help/manage/get-paid/do-i-need-to-invoice-paddle-for-my-payout) |
| Fees | **5% + $0.50 per transaction**, no monthly fee. Custom pricing for large volume or micro-transactions | 3rd-party summaries ([dodopayments](https://dodopayments.com/blogs/paddle-fees-explained), [G2](https://www.g2.com/products/paddle/pricing)). Confirm on paddle.com/pricing (**UNVERIFIED** primary) |

**Bulgarian-seller specifics.** Whether the Bulgarian company must treat Paddle payouts as reverse-charge B2B services income (a Bulgarian VAT return line, and possibly a VIES filing for a non-EU recipient) needs an accountant. Paddle's help pages say no VAT is charged to Paddle. **UNVERIFIED** for Bulgarian domestic reporting.

**Implementation notes for Before I Deploy:**
- Monthly → annual: use `prorated_immediately` so the customer pays the annual price minus the unused monthly credit now.
- Annual → monthly: use `do_not_bill` together with a scheduled change, or use a `next_billed_at` update. Annual → monthly cannot use the next-period proration modes, so the usual pattern is to apply the swap at renewal through your own scheduler or a scheduled job (**UNVERIFIED best practice**).
- Webhook handler: keep an `events_processed(event_id)` table and a `subscriptions.last_event_at`. Upsert entity state from the payload, or better, re-fetch the entity from the API on each event.

---

## 3. Cloud runners for untrusted customer builds (npm install + build, 1–10 min)

Cost assumption: 2 vCPU / 4 GB. Per-minute figures are computed from the listed unit prices, exclude free tiers, egress and storage, and assume USD list prices.

| Option | Isolation | Cold start | Max duration | Egress controls | ≈ $/min (2 vCPU / 4 GB) | EU regions | Log streaming |
|---|---|---|---|---|---|---|---|
| **Fly.io Machines** | **Firecracker microVM**, own kernel ([Fly Firecracker](https://fly.io/learn/firecracker-vm/), [Architecture](https://fly.io/docs/architecture/)) | Starting a stopped machine takes about 300 ms. A first create (image pull, rootfs) can take "low double-digit seconds" ([Machines blog](https://fly.io/blog/fly-machines/), [Machine states](https://fly.io/docs/machines/machine-states/)) | No hard limit (machines run until stopped) | **Network policies**: per-direction default-deny once a rule exists, port/protocol allowlists. Not domain-based ([Network policies](https://fly.io/docs/machines/guides-examples/network-policies/)) | performance-2x with 4 GB = $0.0861/h → **≈ $0.0014/min** (3rd-party: [Fly pricing](https://fly.io/pricing/) via search). shared-cpu-2x is cheaper but **UNVERIFIED** | ams, arn, cdg, fra, lhr ([Regions](https://fly.io/docs/reference/regions/)) | stdout/stderr shipped over NATS. Logs API / NATS subjects `logs.<app>.<region>.<instance>` ([Logs API](https://fly.io/docs/monitoring/logs-api-options/)). Or stream directly from the machine to your backend |
| **Google Cloud Run jobs** | Jobs always use the **2nd-gen environment = microVM** (gen1 uses gVisor) ([Execution envs](https://docs.cloud.google.com/run/docs/about-execution-environments)) | Seconds (image-size dependent; **UNVERIFIED**) | Task timeout up to **168 h** ([Create jobs](https://docs.cloud.google.com/run/docs/create-jobs)) | Direct VPC egress `all-traffic` plus VPC firewall rules and Cloud NAT. No firewall logging with Direct VPC ([Direct VPC](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc)) | $0.000018/vCPU-s + $0.000002/GiB-s ([pricing](https://cloud.google.com/run/pricing) via search) → **≈ $0.0026/min** | Many europe-* regions (e.g. europe-west1/3/4); exact tier pricing **UNVERIFIED** | Cloud Logging tail API (~seconds latency). For live UX, have the job POST lines to your backend |
| **AWS Fargate** | Firecracker microVM per task (**UNVERIFIED** for all Fargate platforms) | Tens of seconds is typical (**UNVERIFIED**) | No limit | Security groups (IP/port), NAT plus Network Firewall for domain filtering | us-east-1: $0.04048/vCPU-h + $0.004445/GB-h ([Vantage](https://www.vantage.sh/blog/fargate-pricing), 3rd-party) → **≈ $0.0016/min**; eu-central-1 slightly higher (**UNVERIFIED**) | eu-central-1, eu-west-1, etc. | CloudWatch Logs (awslogs driver), live tail possible |
| **AWS Lambda** | Firecracker | ms to s | **15 min hard cap**; up to 10,240 MB memory and 10 GB /tmp ([Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)) | VPC + SG | n/a: **not suitable**, because 10-minute builds come too close to the 15-minute cap and the image/toolchain constraints get in the way | EU | CloudWatch |
| **Modal Sandboxes** | **gVisor** | Sub-second to seconds (**UNVERIFIED**) | Default 5 min, configurable up to **24 h** | Network blocking and CIDR allowlists (**UNVERIFIED** detail) | CPU $0.00003942 per physical core-s (1 core = 2 vCPU) + $0.00000672/GiB-s (3rd-party: [northflank](https://northflank.com/blog/ai-sandbox-pricing), [blaxel](https://blaxel.ai/blog/modal-pricing-alternatives-guide)) → **≈ $0.0040/min** | Region selection exists; EU **UNVERIFIED** | SDK streams stdout/stderr |
| **e2b.dev** | **Firecracker microVM** | About 150 ms–1 s (**UNVERIFIED**) | Hobby 1 h, **Pro 24 h** ([e2b session limit](https://blaxel.ai/blog/e2b-session-limit), 3rd-party) | Firewall with domain allowlist plus IP/CIDR allow/deny (3rd-party summary) | $0.000014/vCPU-s + $0.0000045/GiB-s ([e2b price FAQ](https://e2b.dev/docs/faq/calculate-sandbox-price)) → **≈ $0.0028/min** | **US, EU, APAC** cloud regions; BYOC on Enterprise ([e2b enterprise](https://e2b.dev/enterprise), 3rd-party summary) | SDK `onStdout`/`onStderr` callbacks (**UNVERIFIED** naming) |
| **Daytona** | **Default: Docker containers (Sysbox) on a shared kernel.** Kata/gVisor optional ([northflank vs daytona](https://northflank.com/blog/northflank-vs-daytona), 3rd-party) | Sub-second claimed (**UNVERIFIED**) | Auto-stop timers (**UNVERIFIED**) | **UNVERIFIED** | $0.0504/vCPU-h + $0.0162/GiB-h ([Daytona pricing](https://www.daytona.io/pricing)) → **≈ $0.0028/min** | **UNVERIFIED** | SDK process sessions with log streaming (**UNVERIFIED**) |
| **GitHub Actions on customer repo (GitHub App)** | Fresh hosted-runner VM per job (strong isolation; runs in **the customer's** account) | 10–30 s queue plus boot (**UNVERIFIED**) | **6 h per job** ([Actions limits](https://docs.github.com/en/actions/reference/limits)) | None built in (open internet) | Linux 2-core **$0.006/min** from 2026-01-01 (3rd-party: [dev.to](https://dev.to/kalemi/the-2026-github-actions-reset-cheaper-runners-stricter-security-and-smarter-pipelines-1mh6), [cicdcalculator](https://cicdcalculator.com/github-actions)). **Billed to the customer** (free minutes on their plan); $0 to us | Not selectable for standard runners (**UNVERIFIED**) | Logs available after steps finish (live logs via UI; API is post-hoc). Needs workflow-file write access or `workflow_dispatch` on a committed workflow. A heavier permission ask |
| **Cloudflare Containers** | **VM per container instance** ([Concepts](https://developers.cloudflare.com/containers/concepts/)) | **1–3 s typical** ([FAQ](https://developers.cloudflare.com/containers/faq/), [Limits](https://developers.cloudflare.com/containers/platform-details/limits/)) | Lifecycle driven by Durable Objects and `sleepAfter` (default 10 min of inactivity, configurable) ([Container class](https://developers.cloudflare.com/containers/api/container-class/)). A hard max is **UNVERIFIED** | **Outbound Workers**: allow/deny host lists, HTTPS interception, per-instance dynamic egress policy, credential injection ([community changelog](https://community.cloudflare.com/t/containers-agents-secure-credential-injection-and-dynamic-egress-policies-for-sandboxes/918586)) | CPU $0.000020 per **active** vCPU-s + memory $0.0000025/GiB-s + disk ([pricing](https://developers.cloudflare.com/containers/pricing/)). No exact 2/4 type; standard-3 is 2 vCPU/8 GiB → **≈ $0.0036/min at 100% CPU**, less when idle on I/O | **Placement / jurisdiction `eu`** (WEUR/EEUR) ([Placement](https://developers.cloudflare.com/containers/platform-details/placement/)) | Via Worker / Sandbox SDK streaming; WebSocket to the client |

### Recommendation

1. **Primary: Fly.io Machines (EU region `fra` or `ams`).**
   - Firecracker microVM isolation, no duration cap, and the cheapest of the strong-isolation options at about $0.0014/min.
   - Machines API: create, start, wait, destroy per job. Pre-create a pool of stopped machines per region to get about 300 ms starts.
   - Egress lockdown via Machines network policies. Allow 443/80 only, and route through your own npm and Git proxy if you want domain-level control.
   - Logs: the runner agent streams lines to Supabase Realtime or your API over HTTPS. Do not rely on the platform log pipeline for live UX.
   - Gaps: egress control is port-based rather than domain-based, and you build the orchestration and job queue yourself.
2. **Secondary or alternative: Cloudflare Containers with Sandbox SDK** when you need **domain-level egress allowlists** (npm registry, GitHub, Netlify API only) and the `eu` jurisdiction pin.
   - Isolation is a VM per container.
   - Cold start is 1–3 s.
   - Memory-to-vCPU ratios are fixed (standard-3 = 2 vCPU/8 GiB), so cost is about 2.5× Fly at full CPU.
   - The duration and lifecycle model (Durable Object-driven) needs validation for 10-minute jobs.
   - **e2b** is the equivalent managed-sandbox alternative (Firecracker, EU region, about $0.0028/min, 24 h on Pro) if you prefer an SDK-first sandbox product with less infrastructure to build.

**Avoid:**
- Lambda (15-minute cap).
- Daytona's default containers on a shared kernel (weaker isolation) unless Kata is enabled.
- GitHub Actions as the default. It shifts cost to the customer and is attractive as an **optional "run in your own CI" mode**, but it needs broad repo permissions and gives post-hoc logs.

Cloud Run jobs are a solid choice if you want GCP-native IAM and logging. They cost about 1.8× Fly and have no cheap domain-egress control without NAT and a proxy.

**Hardening regardless of provider:**
- Use a fresh VM per job and destroy it afterwards.
- No cloud metadata endpoint reachable. No long-lived secrets in the VM. Inject short-lived Netlify/GitHub tokens only for the deploy step.
- Run `npm install --ignore-scripts` where possible. Set CPU, memory and disk quotas, and a wall-clock kill at about 15 minutes.
- Egress allowlist: registry.npmjs.org, github.com/codeload, api.netlify.com and the customer's declared hosts.

---

## 4. LLM pricing (list, per 1M tokens, USD)

### Anthropic Claude (first-party API)

Source: Anthropic's official `claude-api` skill reference (cached 2026-09-25), corroborated by search on [platform.claude.com pricing](https://platform.claude.com/docs/en/about-claude/pricing) and the model pages ([Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview), [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), [Haiku 4.5](https://www.anthropic.com/news/claude-haiku-4-5)). Direct fetch of the pricing page was blocked.

| Model | ID | Input | Output | Cache read | Notes |
|---|---|---|---|---|---|
| Claude Fable 5.1 | `claude-fable-5-1` | $10.00 | $50.00 | $0.25 (0.025×) | Top tier; batch $5/$25 |
| Claude Fable 5 | `claude-fable-5` | $10.00 | $50.00 | $1.00 | Previous Fable |
| **Claude Opus 5.5** | `claude-opus-5-5` | **$4.00** | **$20.00** | **$0.20 (0.05×)** | Current Opus; fast mode $8/$40 |
| Claude Opus 5 / 4.8 / 4.7 / 4.6 | | $5.00 | $25.00 | ~$0.50 (0.1×) | Older Opus |
| **Claude Sonnet 5.5** | `claude-sonnet-5-5` | **$2.00** | **$10.00** | **$0.20 (0.1×)** | Current Sonnet |
| Claude Sonnet 5 | `claude-sonnet-5` | $2.00 | $10.00 | ~$0.20 | |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | $3.00 | $15.00 | ~$0.30 | |
| **Claude Haiku 4.5** | `claude-haiku-4-5` | **$1.00** | **$5.00** | ~$0.10 | Cheapest current; 200K context |

Prompt caching:
- Cache **writes** cost **1.25× base input for the 5-minute TTL** and **2× for the 1-hour TTL**.
- Cache **reads** cost about **0.1× base input**, except Opus 5.5 at 0.05× and Fable 5.1 at 0.025×.
- With the 5-minute TTL, two requests already break even.
- Message Batches get a **50% discount** on input and output.
- 1M context at standard pricing on current models (no long-context premium noted for Opus 4.8 and later).
- Minimum cacheable prefix is 512–4096 tokens depending on the model.

### OpenAI (API)

Source: search results of [OpenAI API pricing](https://developers.openai.com/api/docs/pricing), [GPT-6.1 Sol announcement](https://openai.com/index/introducing-gpt-6-1-sol/) and [model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol). Direct fetch was blocked. Output prices for the GPT-6 family were confirmed only by 3rd-party pages ([datacamp](https://www.datacamp.com/blog/gpt-6-1-sol), [marktechpost 2026-09-30](https://www.marktechpost.com/2026/09/30/openai-releases-gpt-6-1-sol-near-astra-coding-and-computer-use-at-one-fifth-of-astras-token-price/)), so they are **partially UNVERIFIED**.

| Model | Input | Cached input | Cache write | Output |
|---|---|---|---|---|
| GPT-6 Astra (flagship) | $10.00 | $1.00 | $12.50 | $50.00 (3rd-party) |
| **GPT-6.1 Sol** (released about 2026-09-30) | **$2.00** | **$0.10** | $2.50 | **$10.00** (3rd-party) |
| GPT-6 Luna (small) | $0.10 | $0.01 | $0.125 | $0.50 (3rd-party) |
| GPT-5.6 Sol (short context; promo through at least 2026-11-21) | $4.00 | $0.40 | – | $20.00 |
| GPT-5.6 Sol (long context) | $8.00 | $0.80 | – | $30.00 |
| GPT-5 (legacy) | $1.25 | $0.125 | – | $10.00 |

OpenAI caching: cached input costs about 0.05–0.1× input. The GPT-6 family now lists explicit **cache-write** prices at 1.25× input. The Batch API discount is about 50% (**UNVERIFIED** for the GPT-6 family).

### Cost-modelling defaults
- Use **Claude Sonnet 5.5 ($2/$10)** or **GPT-6.1 Sol ($2/$10)** for build-log diagnosis and explanation.
- Use **Haiku 4.5 ($1/$5)** or **GPT-6 Luna ($0.10/$0.50)** for classification and triage of log lines.
- Use **Opus 5.5 ($4/$20)** for deep fix suggestions.
- Assume a 60–80% cache-read share on the system prompt plus rules context.
- Example: 20K input (15K cached) and 1.5K output on Sonnet 5.5 ≈ 5K×$2/M + 15K×$0.20/M + 1.5K×$10/M = $0.010 + $0.003 + $0.015 = **$0.028 per analysis** (excluding the first cache write).
