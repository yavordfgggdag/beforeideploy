# Before I Deploy — desktop shell (Tauri 2)

One UI (`../web`) for macOS, Windows and Linux. The Node engine (`../engine`) runs as a separate process
(sidecar); the web view never gets a shell — it can only call the commands listed in `src-tauri/src/lib.rs`
(`ENGINE_COMMANDS`) and the capabilities in `src-tauri/capabilities/default.json`.

Prototype status (stage Е1, docs/PLAN-UNIFIED-BG.md §5): runs the engine, streams its NDJSON events to the UI,
stores secrets in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service). Site Builder
S6: the UI's "Create a new site" runs on the engine here — `engine_run` (with the UI's language as `BID_LANG`),
`theme_preview` (a theme's picture by validated id), the dialog plugin for photos and the folder; `web/src/lib/engine.ts`
is the only place the UI talks to these commands (`docs/SITE-BUILDER.md`).

```bash
cd web && npm ci && npm run build          # the UI
cd desktop/src-tauri && cargo test          # allowlist + engine runner tests (headless)
cargo run                                   # opens the window (needs a display)
```
Engine lookup: `BID_ENGINE_DIR` (dev) → the bundled `engine/` resource → `../../engine` next to the sources.
