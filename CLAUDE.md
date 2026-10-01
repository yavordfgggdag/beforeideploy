# Before I Deploy — notes for Claude

One repository for every platform: macOS (`App/`, Swift), Windows and Linux (`desktop/`, Tauri, sharing the
`web/` UI), the website (`site/`), the engine (`engine/`, Node, zero npm dependencies) and the cloud
(`supabase/`). Who owns what, branches and pull requests: [CONTRIBUTING.md](CONTRIBUTING.md).

Team workflow (skills in `.claude/skills/`):
- `start` — new task on its own branch (`mac/…`, `win/…`, `linux/…`, `site/…`, `web/…`, `engine/…`, `docs/…`)
- `save` — commit everything, push, backup on this computer. Also runs automatically when a reply ends
  (`.claude/hooks/autosave.sh`); turn off with `BID_AUTOSAVE=0`.
- `ship` — checks for the changed areas, then a pull request to `main`
- `site` — website work; `team-status` — where things stand; `restore` — recover from the local backup

Rules:
- Never commit on `main`, never force-push a shared branch, never merge a PR yourself.
- No real keys, tokens or passwords anywhere in the repository (`scripts/team/secret-guard.sh` blocks them).
- Paddle only in sandbox; no production deploy of the website or client sites.
- UI text through translation files, English first; prices only from `supabase/functions/_shared/plans-catalog.json`.
- Talk to the people in Bulgarian unless they write in another language; code, commits and comments in English.
