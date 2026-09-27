#!/bin/zsh
# Removes the app and engine. Your project library/history stay unless you pass --all.
osascript -e 'tell application "Before I Deploy" to quit' >/dev/null 2>&1 || true
rm -rf "$HOME/Applications/Before I Deploy.app"
rm -rf "$HOME/Library/Application Support/BeforeIDeploy/engine" "$HOME/Library/Application Support/BeforeIDeploy/launcher"
if [[ "${1:-}" == "--all" ]]; then
  rm -rf "$HOME/Library/Application Support/BeforeIDeploy" "$HOME/Library/Caches/BeforeIDeploy"
  echo "Изтрити са и библиотеката, историята и логовете."
fi
echo "✅ Before I Deploy е премахнат."
