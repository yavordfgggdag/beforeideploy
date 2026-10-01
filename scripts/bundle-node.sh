#!/bin/zsh
# Bundles a Node.js runtime into the engine so the app does not depend on a developer Node on the client's Mac
# (V11 RC). Downloads the official tarballs for both architectures from nodejs.org, verifies them against
# SHASUMS256.txt (signed by the Node release team; the .sig is checked when gpg is available) and places the
# `node` binaries at engine/runtime/<arch>/bin/node. The launcher (engine/bid) prefers this runtime over PATH.
#
#   zsh scripts/bundle-node.sh [--version v22.12.0] [--dest engine/runtime]
#
# build.sh / release.sh run this before packaging; the result is ~110 MB per architecture and is not
# committed (engine/runtime is in .gitignore). Nothing here touches secrets.
set -euo pipefail
VERSION="v22.12.0"
DEST="engine/runtime"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
cd "$(dirname "$0")/.."
BASE="https://nodejs.org/dist/$VERSION"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "▸ Node $VERSION → $DEST"
curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
if command -v gpg >/dev/null 2>&1 && curl -fsSL "$BASE/SHASUMS256.txt.sig" -o "$TMP/SHASUMS256.txt.sig" 2>/dev/null; then
  if gpg --verify "$TMP/SHASUMS256.txt.sig" "$TMP/SHASUMS256.txt" >/dev/null 2>&1; then
    echo "  ✓ SHASUMS256.txt signature verified"
  else
    echo "  ⚠ SHASUMS256.txt signature not verified (import the Node release keys: https://github.com/nodejs/node#release-keys)"
  fi
fi

for ARCH in arm64 x64; do
  TARBALL="node-$VERSION-darwin-$ARCH.tar.gz"
  echo "▸ $TARBALL"
  curl -fsSL "$BASE/$TARBALL" -o "$TMP/$TARBALL"
  EXPECTED="$(grep " $TARBALL\$" "$TMP/SHASUMS256.txt" | awk '{print $1}')"
  ACTUAL="$(shasum -a 256 "$TMP/$TARBALL" | awk '{print $1}')"
  if [[ -z "$EXPECTED" || "$EXPECTED" != "$ACTUAL" ]]; then
    echo "❌ sha256 mismatch for $TARBALL" >&2
    exit 1
  fi
  echo "  ✓ sha256 ok"
  OUT="$DEST/$([[ "$ARCH" == "x64" ]] && echo x86_64 || echo arm64)"
  rm -rf "$OUT"
  mkdir -p "$OUT/bin"
  tar -xzf "$TMP/$TARBALL" -C "$TMP" "node-$VERSION-darwin-$ARCH/bin/node" "node-$VERSION-darwin-$ARCH/LICENSE" "node-$VERSION-darwin-$ARCH/lib/node_modules/npm"
  cp "$TMP/node-$VERSION-darwin-$ARCH/bin/node" "$OUT/bin/node"
  cp "$TMP/node-$VERSION-darwin-$ARCH/LICENSE" "$OUT/LICENSE"
  chmod 755 "$OUT/bin/node"
  mkdir -p "$OUT/lib/node_modules"
  cp -R "$TMP/node-$VERSION-darwin-$ARCH/lib/node_modules/npm" "$OUT/lib/node_modules/npm"
  ln -s ../lib/node_modules/npm/bin/npm-cli.js "$OUT/bin/npm"
  ln -s ../lib/node_modules/npm/bin/npx-cli.js "$OUT/bin/npx"
  echo "$VERSION" > "$OUT/VERSION"
done
echo "✅ bundled Node $VERSION for arm64 and x86_64 under $DEST"
