#!/bin/zsh
# Builds "Before I Deploy.app" from the Swift package (needs only Xcode Command Line Tools).
set -euo pipefail
ROOT="${0:A:h:h}"
OUT="$ROOT/build"
APP="$OUT/Before I Deploy.app"

cd "$ROOT/App"
# BID_UNIVERSAL=1 (release.sh sets it): one binary for Apple silicon and Intel (audit R1).
# Each architecture is built on its own and joined with lipo — this works with the Command Line Tools alone.
if [[ "${BID_UNIVERSAL:-0}" == 1 ]]; then
  echo "▸ swift build (release, arm64 + x86_64)…"
  for ARCH in arm64 x86_64; do
    swift build -c release --arch "$ARCH" || { echo "❌ swift build ($ARCH) failed"; exit 1; }
  done
  UNIVERSAL_BIN="$(mktemp -d)/BeforeIDeploy"
  lipo -create -output "$UNIVERSAL_BIN" \
    "$(swift build -c release --arch arm64 --show-bin-path)/BeforeIDeploy" \
    "$(swift build -c release --arch x86_64 --show-bin-path)/BeforeIDeploy"
  BIN="$UNIVERSAL_BIN"
else
  echo "▸ swift build (release)…"
  swift build -c release || { echo "❌ swift build се провали"; exit 1; }
  BIN="$(swift build -c release --show-bin-path)/BeforeIDeploy"
fi

echo "▸ Сглобявам .app…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/BeforeIDeploy"
cp "$ROOT/App/Info.plist" "$APP/Contents/Info.plist"
# engine/VERSION is the single source of the version (WP6.3); CFBundleVersion must be numeric
VERSION="$(tr -d '[:space:]' < "$ROOT/engine/VERSION")"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist"
# CFBundleVersion must grow with every build, betas included (audit R10): the commit count does
BUILD_NUMBER="${BID_BUILD_NUMBER:-$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo "${VERSION%%[-.]*}")}"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"
# translations (read via Bundle.main — see Localization.swift)
for LPROJ in "$ROOT/App/Resources/"*.lproj(N); do
  cp -R "$LPROJ" "$APP/Contents/Resources/"
done

echo "▸ Engine в пакета…"
# The app installs this copy into Application Support on first launch and after every update (audit B1)
ENGINE_DST="$APP/Contents/Resources/engine"
mkdir -p "$ENGINE_DST/supabase"
cp -R "$ROOT/engine/bid" "$ROOT/engine/VERSION" "$ROOT/engine/cloud.json" "$ROOT/engine/i18n" "$ROOT/engine/src" "$ROOT/engine/prompts" "$ENGINE_DST/"
# bundled Node runtime (scripts/bundle-node.sh, V11 RC): the launcher prefers it over a developer Node on PATH
if [[ -d "$ROOT/engine/runtime" ]]; then
  cp -R "$ROOT/engine/runtime" "$ENGINE_DST/runtime"
  echo "  runtime: $(cat "$ROOT/engine/runtime/arm64/VERSION" 2>/dev/null || echo '?') (arm64 + x86_64)"
else
  echo "  ⚠ no bundled Node runtime (zsh scripts/bundle-node.sh) — the app will need Node.js on the Mac"
fi
cp "$ROOT/supabase/schema.sql" "$ENGINE_DST/supabase/schema.sql"   # `bid cloud schema` (Cloud setup screen)
chmod +x "$ENGINE_DST/bid"
# the release feed, so people without an account get updates too (audit R3)
if [[ -n "${BID_RELEASE_BASE_URL:-}" ]]; then
  print -r -- "{\"url\": \"${BID_RELEASE_BASE_URL%/}/latest.json\"}" > "$ENGINE_DST/release.json"
fi

echo "▸ Икона…"
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
SRC="$ROOT/assets/AppIcon-1024.png"
for s in 16 32 128 256 512; do
  sips -z $s $s "$SRC" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "▸ Подписване (ad-hoc)…"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "  (codesign пропуснат)"

echo "✅ $APP"
