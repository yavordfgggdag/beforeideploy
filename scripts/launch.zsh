#!/bin/zsh
# Launcher used by the "Before I Deploy 🚀" Shortcut.
#  • no input          → opens the Control Center
#  • a folder as input → adds/selects that project (Finder Quick Action / Shortcut input)
APP="$HOME/Applications/Before I Deploy.app"
[ -d "$APP" ] || APP="/Applications/Before I Deploy.app"

TARGET="${1:-}"
if [ -z "$TARGET" ] && [ ! -t 0 ]; then
  TARGET="$(cat 2>/dev/null | head -n 1)"
fi

if [ -n "$TARGET" ] && [ -d "$TARGET" ]; then
  ENC="$(/usr/bin/python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$TARGET" 2>/dev/null || printf '%s' "$TARGET")"
  open -a "$APP" "beforeideploy://open?path=$ENC"
else
  open -a "$APP"
fi
