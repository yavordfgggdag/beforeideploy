---
name: ship
description: Finish a task in the beforeideploy repo — save, bring in the latest main, run the checks for the changed areas, and open a pull request to main for review. Use when the user says done, готово, ship, PR, "пусни за преглед", or wants the work merged.
---

# Ship a task

1. `bash scripts/team/save.sh` (refuse to continue on `main`).
2. `git fetch origin main && git merge --no-edit origin/main`. On a conflict: resolve it if both sides are
   clear, otherwise show the user the conflicting files and stop.
3. Run the checks for the areas this branch touches (`git diff --name-only origin/main...HEAD`):
   | Area | Check |
   | --- | --- |
   | engine/ | `node tests/run.mjs` and `node --test tests/platform.mjs` |
   | web/, design/ | `cd web && npm ci && npm run build && npm test && npm run i18n` |
   | desktop/ | `cd web && npm run build && cd ../desktop/src-tauri && cargo test` |
   | site/, scripts/site-build.py | `python3 scripts/site-build.py && git diff --exit-code -- site/` |
   | App/ (macOS only) | `cd App && swift build` |
   | supabase/ | `deno test --allow-env --allow-net --allow-read supabase/functions` when Deno is installed |
   Fix failures that belong to this branch; report anything else.
4. Save again if the checks changed files, then open a pull request to `main` (GitHub tools or `gh pr create`),
   filling `.github/pull_request_template.md`. The title is the task in plain English.
5. Reply with the PR link and who must review it (CODEOWNERS). Never merge it yourself.
