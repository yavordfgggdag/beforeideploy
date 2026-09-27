#!/bin/zsh
# Builds "Before I Deploy.app" from the Swift package (needs only Xcode Command Line Tools).
set -euo pipefail
ROOT="${0:A:h:h}"
OUT="$ROOT/build"
APP="$OUT/Before I Deploy.app"

echo "▸ swift build (release)…"
cd "$ROOT/App"
swift build -c release || { echo "❌ swift build се провали"; exit 1; }
BIN_DIR="$(swift build -c release --show-bin-path)"

echo "▸ Сглобявам .app…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/BeforeIDeploy" "$APP/Contents/MacOS/BeforeIDeploy"
cp "$ROOT/App/Info.plist" "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"
# translations (read via Bundle.main — see Localization.swift)
for LPROJ in "$ROOT/App/Resources/"*.lproj(N); do
  cp -R "$LPROJ" "$APP/Contents/Resources/"
done

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
