---
name: start
description: Start a new task in the beforeideploy repo on its own branch from the latest main (mac/, win/, linux/, site/, web/, engine/, docs/). Use when the user starts working on something new, says "започвам", "нова задача", "start", or asks which branch to use.
---

# Start a task

1. Pick the area from what the user wants to do (see CONTRIBUTING.md → "Кой какво прави"):
   `mac` (App/), `win` (Windows in desktop/ + engine/src/platform/win32.mjs), `linux` (Linux in desktop/ +
   engine/src/platform/linux.mjs), `site` (site/, scripts/site-build.py), `web` (web/, design/),
   `engine` (engine/, supabase/), `docs`.
2. Choose a 2–4 word task name. Ask only if the task is genuinely unclear.
3. Run: `bash scripts/team/start.sh <area> "<task name>"` — it saves open work, fetches main and
   creates or reuses `<area>/<task-name>`.
4. Tell the user the branch name in one line, and who reviews this area (from .github/CODEOWNERS).
