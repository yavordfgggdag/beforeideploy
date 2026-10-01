#!/bin/zsh
# Release build for Before I Deploy (V10 WP8-A): tests → signed .app → notarized DMG → releases/latest.json
# → Homebrew cask. Runs on a Mac with Xcode Command Line Tools. See docs/release.md for the one-time setup.
#
#   BID_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
#   BID_NOTARY_PROFILE=BID \
#   BID_RELEASE_BASE_URL=https://example.com/releases \
#   zsh scripts/release.sh [--channel stable|beta] [--min-version X.Y.Z] [--skip-notarize] [--allow-dirty] [--allow-dev] [--skip-tests]
#
# Without BID_SIGN_IDENTITY the DMG is ad-hoc signed and not notarized (local smoke builds only —
# Gatekeeper will refuse it on other Macs).
set -euo pipefail
ROOT="${0:A:h:h}"
cd "$ROOT"

CHANNEL=stable
MIN_VERSION=""
SKIP_NOTARIZE=0
ALLOW_DIRTY=0
ALLOW_DEV=0
SKIP_TESTS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) CHANNEL="$2"; shift 2 ;;
    --min-version) MIN_VERSION="$2"; shift 2 ;;
    --skip-notarize) SKIP_NOTARIZE=1; shift ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --allow-dev) ALLOW_DEV=1; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done
[[ "$CHANNEL" == stable || "$CHANNEL" == beta ]] || { echo "--channel must be stable or beta"; exit 2; }

bold() { print -P "%B$1%b"; }
ok()   { print -P "  %F{green}✓%f $1"; }
warn() { print -P "  %F{yellow}!%f $1"; }
die()  { print -P "  %F{red}✗ $1%f"; exit 1; }

IDENTITY="${BID_SIGN_IDENTITY:-}"
PROFILE="${BID_NOTARY_PROFILE:-}"
BASE_URL="${BID_RELEASE_BASE_URL:-}"
VERSION="$(tr -d '[:space:]' < engine/VERSION)"
APP="$ROOT/build/Before I Deploy.app"
OUT="$ROOT/releases"
DMG_NAME="Before-I-Deploy-$VERSION.dmg"
DMG="$OUT/$DMG_NAME"

bold "🚀 Before I Deploy $VERSION — release ($CHANNEL)"
echo

bold "1. Preconditions"
command -v node >/dev/null || die "Node.js is required"
command -v swift >/dev/null || die "swift (Command Line Tools) is required"
if [[ "$VERSION" == *-dev* && $ALLOW_DEV -ne 1 ]]; then die "engine/VERSION is $VERSION — set the release version first (or --allow-dev for a local build)"; fi
if [[ "$CHANNEL" == stable && "$VERSION" == *-* && $ALLOW_DEV -ne 1 ]]; then die "$VERSION is a pre-release — publish it on --channel beta"; fi
if [[ -n "$(git status --porcelain)" && $ALLOW_DIRTY -ne 1 ]]; then die "the working tree is not clean (commit first, or --allow-dirty)"; fi
ok "version $VERSION, commit $(git rev-parse --short HEAD)"
if [[ $ALLOW_DEV -eq 1 ]]; then node scripts/release-notes.mjs --check --allow-dev; else node scripts/release-notes.mjs --check; fi
if [[ -z "$IDENTITY" ]]; then warn "BID_SIGN_IDENTITY is not set — ad-hoc signature, no notarization (local build only)"; SKIP_NOTARIZE=1; fi
if [[ -n "$IDENTITY" && $SKIP_NOTARIZE -ne 1 && -z "$PROFILE" ]]; then die "BID_NOTARY_PROFILE is required for notarization (xcrun notarytool store-credentials …)"; fi
if [[ -z "$BASE_URL" ]]; then warn "BID_RELEASE_BASE_URL is not set — latest.json will point to a placeholder URL"; BASE_URL="https://example.invalid/releases"; fi
echo

bold "2. Checks"
if [[ $SKIP_TESTS -eq 1 ]]; then
  warn "engine tests skipped (--skip-tests)"
else
  node tests/run.mjs > tests/last-run.txt 2>&1 || { tail -20 tests/last-run.txt; die "engine tests failed (tests/last-run.txt)"; }
  ok "$(tail -1 tests/last-run.txt)"
fi
node scripts/i18n-check.mjs >/dev/null || die "i18n-check failed"
node scripts/error-codes.mjs >/dev/null || die "error-codes failed"
ok "i18n and error codes consistent"
echo

bold "3. Build"
# one binary for Apple silicon and Intel; the feed URL goes into the bundled engine (audit R1/R3)
if [[ "${BID_SKIP_NODE_BUNDLE:-0}" != "1" ]]; then
  zsh scripts/bundle-node.sh >/dev/null || die "bundle-node.sh failed — set BID_SKIP_NODE_BUNDLE=1 only for a local smoke build (the app would then need Node on the Mac)"
  ok "bundled Node runtime $(cat engine/runtime/arm64/VERSION) (arm64 + x86_64)"
fi
BID_UNIVERSAL=1 BID_RELEASE_BASE_URL="${BID_RELEASE_BASE_URL:-}" zsh scripts/build.sh >/dev/null || die "build.sh failed"
[[ -d "$APP" ]] || die "no app at $APP"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"
(cd App && swift test 2>&1 | tail -1) || die "swift test failed"
ok "$APP ($BUNDLE_ID)"
echo

bold "4. Signature"
if [[ -n "$IDENTITY" ]]; then
  codesign --force --options runtime --timestamp --entitlements packaging/entitlements.plist --sign "$IDENTITY" "$APP" \
    || die "codesign failed — is the Developer ID certificate in the login keychain?"
  codesign --verify --strict --deep "$APP" || die "signature does not verify"
  ok "signed with $IDENTITY (hardened runtime)"
else
  ok "ad-hoc signature from build.sh kept"
fi
echo

bold "5. DMG"
mkdir -p "$OUT"
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "Before I Deploy" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null || die "hdiutil failed"
rm -rf "$STAGE"
if [[ -n "$IDENTITY" ]]; then codesign --force --timestamp --sign "$IDENTITY" "$DMG" >/dev/null; fi
ok "$DMG"
echo

bold "6. Notarization"
if [[ $SKIP_NOTARIZE -eq 1 ]]; then
  warn "skipped"
else
  xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait || die "notarization failed — xcrun notarytool log <id> --keychain-profile $PROFILE"
  xcrun stapler staple "$DMG" || die "stapler failed"
  # Gatekeeper must accept the stapled DMG, otherwise customers see "cannot be opened" (audit R10)
  spctl -a -t open --context context:primary-signature -v "$DMG" 2>&1 | sed 's/^/  /'
  [[ ${pipestatus[1]} -eq 0 ]] || die "Gatekeeper (spctl) rejected the DMG"
  ok "notarized, stapled and accepted by Gatekeeper"
fi
echo

bold "7. Feed and cask"
SHA="$(shasum -a 256 "$DMG" | awk '{print $1}')"
URL="${BASE_URL%/}/$DMG_NAME"
NOTES="$OUT/notes-$VERSION.json"
if [[ $ALLOW_DEV -eq 1 ]]; then node scripts/release-notes.mjs "$VERSION" > "$NOTES"; else node scripts/release-notes.mjs "$VERSION" > "$NOTES"; fi
FEED_ARGS=(--out "$OUT/latest.json" --version "$VERSION" --url "$URL" --sha256 "$SHA" --channel "$CHANNEL" --notes "$NOTES")
[[ -n "$MIN_VERSION" ]] && FEED_ARGS+=(--min-version "$MIN_VERSION")
node scripts/release-feed.mjs "${FEED_ARGS[@]}"
HOMEPAGE="${BID_HOMEPAGE_URL:-${BASE_URL%/releases}}"
sed -e "s|__VERSION__|$VERSION|g" -e "s|__SHA256__|$SHA|g" -e "s|__URL__|$URL|g" \
    -e "s|__HOMEPAGE__|$HOMEPAGE|g" -e "s|__FEED_URL__|${BASE_URL%/}/latest.json|g" -e "s|__BUNDLE_ID__|$BUNDLE_ID|g" \
    packaging/homebrew/before-i-deploy.rb.tmpl > "$OUT/before-i-deploy.rb"
ok "sha256 $SHA"
ok "$OUT/latest.json, $OUT/before-i-deploy.rb"
echo

bold "✅ Done. Next:"
echo "  1. Upload releases/$DMG_NAME and releases/latest.json to ${BASE_URL%/}/ (keep the previous DMG for rollback)."
echo "  2. Admin panel / bid admin set_settings: release.url = ${BASE_URL%/}/latest.json (once)."
echo "  3. git tag v$VERSION && git push --tags; copy releases/before-i-deploy.rb into your Homebrew tap."
echo "  4. CHANGELOG.md: start the next version's entry; bump engine/VERSION."
