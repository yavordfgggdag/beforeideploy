#!/bin/zsh
# Double-click: undo "Try as New User" — puts your projects, history and settings back.
# What the test run created is kept too, in ~/BeforeIDeploy Backups/test-run-<time>.
APP_ID="bg.yavor.beforeideploy"
DATA="$HOME/Library/Application Support/BeforeIDeploy"
ROOT="$HOME/BeforeIDeploy Backups"

# newest backup made by "Try as New User": it must exist, sit in ROOT and hold the .source marker.
# Nothing found = nothing is touched.
saved=("$ROOT"/user-data-*(N/))
LAST=${saved[-1]:-}
if [[ -z "$LAST" || "${LAST:h}" != "$ROOT" || ! -f "$LAST/.source" ]]; then
  echo "Nothing to restore: no backup from \"Try as New User\" in $ROOT"
  read -k1; exit 0
fi

osascript -e 'quit app "Before I Deploy"' 2>/dev/null; sleep 1
TEST="$ROOT/test-run-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$TEST" "$DATA" || exit 1
for item in "$DATA"/*(DN); do
  case "${item:t}" in engine|tools|runtime) ;; *) mv "$item" "$TEST/" ;; esac
done
defaults export "$APP_ID" "$TEST/defaults.plist" 2>/dev/null; defaults delete "$APP_ID" 2>/dev/null

for item in "$LAST"/*(DN); do
  case "${item:t}" in defaults.plist|.source) ;; *) mv "$item" "$DATA/" ;; esac
done
[[ -f "$LAST/defaults.plist" ]] && defaults import "$APP_ID" "$LAST/defaults.plist"
# renamed so it is never picked again: the next restore only looks at user-data-*
mv "$LAST" "$ROOT/restored-${LAST:t}"
echo "✅ Your data is back. The test run is kept in: $TEST"
read -k1 "?Натисни клавиш за затваряне…"
