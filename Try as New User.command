#!/bin/zsh
# Double-click: open Before I Deploy the way a brand-new user sees it — language picker, tour, no account, no projects.
# Your own data is NOT deleted: it is moved to ~/BeforeIDeploy Backups/user-data-<time> and comes back with
# "Restore My Data.command". The engine and installed tools stay, so nothing has to be downloaded again.
# Saved keys in the Keychain are left alone and simply not read in this run (-BIDNoKeychain).
APP_ID="bg.yavor.beforeideploy"
DATA="$HOME/Library/Application Support/BeforeIDeploy"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$HOME/BeforeIDeploy Backups/user-data-$STAMP"

APP="/Applications/Before I Deploy.app"; [[ -d "$APP" ]] || APP="$HOME/Applications/Before I Deploy.app"
[[ -d "$APP" ]] || { echo "❌ The app is not installed — run \"Install Before I Deploy.command\" first."; read -k1; exit 1; }

osascript -e 'quit app "Before I Deploy"' 2>/dev/null; sleep 1
mkdir -p "$BACKUP" || { echo "❌ Could not create $BACKUP"; read -k1; exit 1; }
echo "$DATA" > "$BACKUP/.source"

# app settings (language, tour seen, appearance, offline mode …)
defaults export "$APP_ID" "$BACKUP/defaults.plist" 2>/dev/null && defaults delete "$APP_ID" 2>/dev/null
# user data: everything except the engine and the installed tools
if [[ -d "$DATA" ]]; then
  for item in "$DATA"/*(DN); do
    case "${item:t}" in engine|tools|runtime) ;; *) mv "$item" "$BACKUP/" ;; esac
  done
fi
echo "✅ Your data is safe in: $BACKUP"
echo "   To bring it back: double-click \"Restore My Data.command\""
echo
open -n "$APP" --args -BIDNoKeychain 1
echo "▶︎  Before I Deploy opened as a new user. Choose \"continue without an account\" to stay offline."
read -k1 "?Натисни клавиш за затваряне…"
