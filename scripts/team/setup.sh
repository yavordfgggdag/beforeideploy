#!/usr/bin/env bash
# One-time (and harmless to repeat) setup of this clone for team work:
#   - git uses the repository's hooks in .githooks/ (key check before every commit, backup after it)
#   - pulls rebase-free, pushes set the upstream automatically
# Claude Code runs it at the start of every session (.claude/settings.json → SessionStart).
set -u
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0
git config core.hooksPath .githooks
git config pull.rebase false
git config push.autoSetupRemote true
chmod +x .githooks/* scripts/team/*.sh 2>/dev/null
[ "${1:-}" = "--quiet" ] && exit 0
echo "✅ Team setup done: key check before each commit, backup after each commit (on your own computer)."
