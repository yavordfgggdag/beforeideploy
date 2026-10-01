#!/usr/bin/env bash
# Start a task: save what is open, get the latest main, create a branch named by area.
#   scripts/team/start.sh site "pricing page"      → site/pricing-page
#   scripts/team/start.sh linux "appimage"         → linux/appimage
# Areas: mac, win, linux, site, web, engine, docs
set -u
area="${1:-}"
name="${2:-}"
case "$area" in
  mac|win|linux|site|web|engine|docs) ;;
  *) echo "Usage: scripts/team/start.sh <mac|win|linux|site|web|engine|docs> \"short task name\""; exit 1 ;;
esac
[ -n "$name" ] || { echo "Give the task a short name, e.g. \"pricing page\"."; exit 1; }

root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1
bash scripts/team/save.sh --auto

slug=$(echo "$name" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-//; s/-$//' | cut -c1-40)
branch="$area/$slug"
git fetch -q origin main || { echo "⚠️  Could not reach GitHub."; exit 1; }
if git show-ref -q --verify "refs/heads/$branch"; then
  git switch -q "$branch" && git merge -q --no-edit origin/main
  echo "↪︎  Back on $branch (main merged in)"
else
  git switch -q -c "$branch" origin/main
  git push -q -u origin "$branch" 2>/dev/null || true
  echo "🌱 New branch $branch from the latest main"
fi
