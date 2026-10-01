# Release runbook

How a version of Before I Deploy goes from `main` to a notarized DMG that the app offers as an update.
The script is `scripts/release.sh`; this page is the one-time setup and the checklist around it.

## One-time setup (owner, on the release Mac)

1. **Apple Developer Program** ($99/year). In Keychain Access → Certificate Assistant → *Request a
   Certificate From a Certificate Authority*; upload the CSR at developer.apple.com → Certificates →
   *Developer ID Application*; double-click the downloaded certificate.
   ```bash
   security find-identity -v -p codesigning      # copy the "Developer ID Application: …" name
   ```
2. **Notary credentials** (app-specific password from appleid.apple.com):
   ```bash
   xcrun notarytool store-credentials BID --apple-id you@example.com --team-id TEAMID --password xxxx-xxxx-xxxx-xxxx
   ```
3. **Release host**: any static HTTPS location, e.g. `https://<domain>/releases/`. The previous DMGs stay
   there (rollback).
4. **Cloud settings** (once): the app reads the feed and the error help pages from the `settings` table.
   ```bash
   bid admin set_settings --json '{"settings":{"release.url":"https://<domain>/releases/latest.json","help.url":"https://<domain>/help/errors"}}'
   ```
5. Optional **Homebrew tap**: a repo `homebrew-tap` with a `Casks/` folder.
6. **Legal pages and support** (Paddle requires them before approving the account): publish Privacy,
   Terms and Refund policy pages on your domain, then set them once — the app shows them in Settings,
   on the sign-in screen and under the plans:
   ```bash
   bid admin set_settings --json '{"settings":{"legal.privacy":"https://<domain>/privacy","legal.terms":"https://<domain>/terms","legal.refund":"https://<domain>/refund","support.email":"support@<domain>"}}'
   ```
   For people who never sign in, add the same values under `"links"` in `engine/cloud.json`
   (keys `legal.privacy`, `legal.terms`, `legal.refund`, `support.email`, `help.url`).
7. **Paddle checkout page**: host `site/checkout.html` at `https://<domain>/checkout`, put the
   client-side token (`live_…`, public by design) into it, and set it as the default payment link in
   Paddle → Checkout settings.

## What the build contains

- One universal binary (Apple silicon + Intel): `release.sh` builds each architecture and joins them.
- The engine in `Contents/Resources/engine` — on first launch and after every update the app installs it
  into `~/Library/Application Support/BeforeIDeploy/engine`. Customers only need Node.js 18+; without it
  the app shows a "Node.js is needed" screen with the download link and the Homebrew command.
- `release.json` in that engine points at `BID_RELEASE_BASE_URL/latest.json`, so the update banner works
  without an account. The version compared is the app's own (`CFBundleShortVersionString`).
- `CFBundleVersion` is the commit count, so every build (betas too) is newer than the last.

Keep in the shell profile of the release Mac (never in the repo):

```bash
export BID_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export BID_NOTARY_PROFILE=BID
export BID_RELEASE_BASE_URL=https://<domain>/releases
```

## Every release

1. CI green on all three workflows for the release commit; `docs/manual-qa.md` passed on bg and en.
2. `engine/VERSION` → the version (no `-dev`); `CHANGELOG.md` → remove "(in development)", add the date.
   `node scripts/release-notes.mjs --check` must pass. Commit "Release X.Y.Z".
3. `zsh scripts/release.sh` (stable) or `zsh scripts/release.sh --channel beta` (a `-beta.N` version).
   `--min-version X.Y.Z` forces an update for older installs. The script tests, builds, signs with the
   hardened runtime, makes the DMG, notarizes and staples it, and writes `releases/latest.json`,
   `releases/notes-X.Y.Z.json` and `releases/before-i-deploy.rb`.
4. Upload `releases/Before-I-Deploy-X.Y.Z.dmg` first, then `releases/latest.json`.
5. `git tag vX.Y.Z && git push --tags`; copy the cask into the tap.
6. Bump `engine/VERSION` to the next `-dev` and open its CHANGELOG entry.

Check on a second Mac: the sidebar banner appears (within 6 h, or Settings → Check for updates), the
download passes the sha256 check, Gatekeeper opens the DMG without a warning.

## Rollback

Put the previous `latest.json` back on the host (it is in `releases/` history or the previous tag's
build). Installed apps that already updated keep the new version; everyone else stops being offered it.
For a broken release also publish X.Y.Z+1 with the fix — never reuse a version number.

## Local smoke build

Without `BID_SIGN_IDENTITY` the script signs ad-hoc and skips notarization; with `--allow-dev
--allow-dirty` it builds from a work tree. Such a DMG opens only on the build Mac.
