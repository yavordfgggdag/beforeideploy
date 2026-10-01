#!/usr/bin/env bash
# Backup of the whole repository on this computer, outside the project folder:
#   ~/BeforeIDeploy Backups/beforeideploy.git     a mirror, updated on every save (fast, incremental)
#   ~/BeforeIDeploy Backups/snapshots/*.bundle    one full snapshot a day, the last 7 kept
# Restore:  git clone "$HOME/BeforeIDeploy Backups/beforeideploy.git" beforeideploy-restored
#           (or: git clone "…/snapshots/beforeideploy-2026-10-01.bundle" beforeideploy-restored)
# Settings: BID_BACKUP_DIR (folder), BID_BACKUP_KEEP (days, default 7), BID_BACKUP=0 (off).
set -u
[ "${BID_BACKUP:-1}" = "0" ] && exit 0
# cloud sessions are thrown away when they end: a backup there would protect nothing
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0
dest="${BID_BACKUP_DIR:-$HOME/BeforeIDeploy Backups}"
keep="${BID_BACKUP_KEEP:-7}"
mirror="$dest/beforeideploy.git"
mkdir -p "$dest/snapshots" || { echo "⚠️  Backup folder not writable: $dest"; exit 0; }

[ -d "$mirror" ] || git init -q --bare "$mirror"
if ! git push -q --mirror "$mirror" 2>/dev/null; then
  echo "⚠️  Backup mirror could not be updated ($mirror)"
fi

day=$(date +%Y-%m-%d)
snap="$dest/snapshots/beforeideploy-$day.bundle"
if [ ! -f "$snap" ]; then
  git bundle create -q "$snap" --all 2>/dev/null || rm -f "$snap"
  # keep only the newest $keep snapshots
  ls -1t "$dest"/snapshots/beforeideploy-*.bundle 2>/dev/null | tail -n +"$((keep + 1))" | while IFS= read -r old; do rm -f "$old"; done
fi
echo "💾 Backup: $dest"
