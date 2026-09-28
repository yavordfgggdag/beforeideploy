#!/bin/zsh
# Removes Before I Deploy from this Mac.
#   zsh scripts/uninstall.sh         app + engine; your project list, history and settings stay
#   zsh scripts/uninstall.sh --all   everything: library, history, logs, caches, settings and the
#                                    saved keys in the Keychain (audit R7). Your project folders are never touched.
set -u
SUPPORT="$HOME/Library/Application Support/BeforeIDeploy"
BUNDLE_ID="bg.yavor.beforeideploy"

osascript -e 'tell application "Before I Deploy" to quit' >/dev/null 2>&1 || true
rm -rf "/Applications/Before I Deploy.app" "$HOME/Applications/Before I Deploy.app" 2>/dev/null
rm -rf "$SUPPORT/engine" "$SUPPORT/launcher"

if [[ "${1:-}" == "--all" ]]; then
  rm -rf "$SUPPORT" "$HOME/Library/Caches/BeforeIDeploy" "$HOME/Library/Caches/$BUNDLE_ID" "$HOME/Library/Logs/BeforeIDeploy"
  # every Keychain item the engine saved (session, AI keys, provider tokens) uses the service "BeforeIDeploy"
  n=0
  while security delete-generic-password -s BeforeIDeploy >/dev/null 2>&1; do n=$((n + 1)); done
  defaults delete "$BUNDLE_ID" >/dev/null 2>&1 || true
  echo "Изтрити са библиотеката, историята, логовете, настройките и $n ключа от Keychain."
fi
echo "✅ Before I Deploy е премахнат."
