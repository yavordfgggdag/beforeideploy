#!/usr/bin/env bash
# Where am I and what is going on: branch, unsaved changes, distance to main, everyone's open branches, last backup.
set -u
root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1
git fetch -q origin 2>/dev/null || echo "(offline — showing the last known state)"

branch=$(git symbolic-ref --short -q HEAD || echo "detached")
echo "Branch:   $branch"
changed=$(git status --porcelain | wc -l | tr -d ' ')
echo "Unsaved:  $changed file(s)"
if git rev-parse -q --verify origin/main >/dev/null; then
  ahead=$(git rev-list --count origin/main..HEAD)
  behind=$(git rev-list --count HEAD..origin/main)
  echo "vs main:  $ahead ahead, $behind behind"
  [ "$behind" -gt 0 ] && echo "          → main has news: git merge origin/main"
fi
echo
echo "Active branches on GitHub (newest first):"
git for-each-ref --sort=-committerdate --count=12 refs/remotes/origin \
  --format='  %(committerdate:relative)|%(refname:lstrip=3)|%(authorname)|%(subject)' \
  | grep -v '|HEAD|' | awk -F'|' '{printf "  %-16s %-34s %-14s %s\n", $1, $2, $3, substr($4,1,50)}'
dest="${BID_BACKUP_DIR:-$HOME/BeforeIDeploy Backups}"
last=$(ls -1t "$dest"/snapshots/*.bundle 2>/dev/null | head -1)
echo
[ -n "$last" ] && echo "Last backup snapshot: $last" || echo "No backup on this computer yet (it is made on the first save)."
