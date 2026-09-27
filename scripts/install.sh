#!/bin/zsh
# Before I Deploy V6 — installer. Run from Terminal:  zsh ~/Desktop/BeforeIDeploy-V6/scripts/install.sh
set -euo pipefail
ROOT="${0:A:h:h}"
SUPPORT="$HOME/Library/Application Support/BeforeIDeploy"
ENGINE="$SUPPORT/engine"
APPS="$HOME/Applications"
APP_NAME="Before I Deploy.app"
exec > >(tee "$ROOT/install.log") 2>&1

bold() { print -P "%B$1%b"; }
ok()   { print -P "  %F{green}✓%f $1"; }
warn() { print -P "  %F{yellow}!%f $1"; }
die()  { print -P "  %F{red}✗ $1%f"; exit 1; }

bold "🚀 Before I Deploy V9 — инсталация"
echo

bold "1. Проверка на средата"
xcode-select -p >/dev/null 2>&1 || die "Липсват Xcode Command Line Tools. Пусни: xcode-select --install"
command -v swift >/dev/null 2>&1 || die "swift не е намерен (Command Line Tools)."
ok "Swift $(swift --version 2>/dev/null | head -1 | sed -E 's/.*version ([0-9.]+).*/\1/')"
command -v node >/dev/null 2>&1 || die "Node.js не е намерен."
ok "Node $(node --version)"
command -v git >/dev/null 2>&1 && ok "git $(git --version | awk '{print $3}')" || warn "git липсва"
if command -v netlify >/dev/null 2>&1; then ok "Netlify CLI"; else warn "Netlify CLI не е глобален — ще ползвам npx netlify-cli"; fi
echo

bold "2. Engine"
mkdir -p "$SUPPORT"
rm -rf "$ENGINE.new"
cp -R "$ROOT/engine" "$ENGINE.new"
rm -rf "$ENGINE"
mv "$ENGINE.new" "$ENGINE"
chmod +x "$ENGINE/bid"
# remember the PATH of this Terminal session so the app finds node/npm/netlify exactly like you do
print -r -- "export PATH=\"${PATH}\"" > "$ENGINE/env.zsh"
"$ENGINE/bid" version >/dev/null || die "Engine-ът не стартира."
ok "Инсталиран в $ENGINE"
echo

if [[ "${1:-}" != "--skip-tests" ]]; then
  bold "3. Тестове на engine-а"
  if node "$ROOT/tests/run.mjs" > "$ROOT/tests/last-run.txt" 2>&1; then
    ok "$(tail -2 "$ROOT/tests/last-run.txt" | tr -d '\n')"
  else
    grep -A1 "❌" "$ROOT/tests/last-run.txt" | head -20
    warn "Някои тестове не минаха — продължавам с инсталацията (виж tests/last-run.txt)"
  fi
  echo
fi

bold "4. Приложение"
zsh "$ROOT/scripts/build.sh"
mkdir -p "$APPS"
osascript -e 'tell application "Before I Deploy" to quit' >/dev/null 2>&1 || true
rm -rf "$APPS/$APP_NAME"
cp -R "$ROOT/build/$APP_NAME" "$APPS/$APP_NAME"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APPS/$APP_NAME" >/dev/null 2>&1 || true
ok "Инсталирано в $APPS/$APP_NAME"
echo

bold "5. Launcher за Shortcuts"
mkdir -p "$SUPPORT/launcher"
cp "$ROOT/scripts/launch.zsh" "$SUPPORT/launcher/launch.zsh"
chmod +x "$SUPPORT/launcher/launch.zsh"
ok "В Shortcut-а „Before I Deploy 🚀“ сложи Run Shell Script с:"
print -r -- "      zsh \"\$HOME/Library/Application Support/BeforeIDeploy/launcher/launch.zsh\""
echo

bold "✅ Готово — отварям Before I Deploy"
open "$APPS/$APP_NAME"
