#!/usr/bin/env bash
# Claude Code "Stop" hook: when Claude finishes a reply and files changed, save everything
# (commit → push → backup on this computer). Turn off for one session: BID_AUTOSAVE=0.
input=$(cat)
case "$input" in *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;; esac
[ "${BID_AUTOSAVE:-1}" = "0" ] && exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
out=$(bash scripts/team/save.sh --auto 2>&1)
[ -z "$out" ] && exit 0
# one line for the person in the chat; JSON-escape quotes and backslashes, join lines
line=$(printf '%s' "$out" | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"systemMessage":"%s"}\n' "$line"
exit 0
