# Codex V12 setup/engine review + Windows/Linux platform coupling

Branch reviewed: `origin/codex/v12-completion` @ `8d5fbec` (14 commits over `origin/claude/nifty-edison-1195gi`).
Setup work: `a66d5f1` "fix(setup): make bundled tools and setup outcomes reliable" (33 files, +800/-206) and `48b2369` "fix(setup): retain bounded per-step logs" (3 files).
Spec: `docs/audit-v12/setup.md` (SU-1 … SU-37 + "Target setup flow").
Method: read-only `git show`/`git diff`, detached worktree at the codex head for tests, then removed. Line numbers are for the codex head unless a commit is named.

---

## 0. Test results (Linux container, Node v22.22.2, worktree at 8d5fbec)

| Command | Result |
|---|---|
| `BID_NO_SANDBOX=1 node tests/run.mjs` | **114 passed, 0 failed** (exit 0). Includes the new `setup V12: Finder PATH, honest failure, managed install, locks and offline` wrapper test. |
| `node --test tests/setup-v12.mjs` | **7/7 pass** (0.5 s): Finder PATH order, honest status, offline → all `skipped`, failed install → `setup_incomplete` with dependent `blocked`, O_EXCL lock with dead-owner recovery, verified managed install that keeps the old tool on failure, parallel preflight with disk check. |
| `node scripts/i18n-check.mjs` | ✅ engine 814 keys, app 1280 keys [bg, en] |
| `node scripts/error-codes.mjs` | ✅ 82 engine + 47 cloud codes, 121 documented. Warns about 2 dynamic codes (`data.code`, `code`). |
| Manual: `env -i PATH=/usr/bin:/bin zsh -f engine/bid setup status --local` (temp APP_DIR) | Took 2.6 s. `node`/`npm` show ok. `git`/`gh` are optional for a Netlify-only user. Required: netlify-cli and netlify-login. **The English copy is stale:** "Without it every command goes through the slower npx". |

Rules check: the engine has **zero npm dependencies** (every import is `node:*` or relative; `scripts/package.json` holds a dev-only SDK). There is **no `sudo`** anywhere in engine/ or scripts/.

---

## 1. Task A: SU-1 … SU-37 against the codex branch

Legend: ✅ implemented · 🟡 partial · ❌ not done

| SU | Verdict | Evidence (codex head) | Gap |
|---|---|---|---|
| 1 PATH before bundled exec | ✅ | `engine/bid:10-12` puts `tools/bin` first, then inherited/env.zsh PATH, standard dirs (incl. `~/.npm-global/bin`) and system dirs. `:33-36` appends the bundled bin **last**, then execs. Test `tests/setup-v12.mjs:24-37` runs it with `PATH=/usr/bin:/bin`. | The optional login-shell PATH capture (`path.env`) is not done. Empty `$PATH` produces an empty `::` element, which means cwd (see §3). |
| 2 Node row always red | ✅ | `setup.mjs:37` versions `process.execPath`; `:66` is always ok and shows "bundled Node vX". | — |
| 3 bundled npm/npx | ✅ | `scripts/bundle-node.sh:50-57` extracts `lib/node_modules/npm` and symlinks `bin/npm`/`bin/npx`. `setup-tools.mjs:30-37` `resolveNpm()` falls back to `process.execPath npm-cli.js`. `setup.npmMissing` is used at `:96`. | — |
| 4 no `-g`, managed prefix | ✅ | `setup-tools.mjs:92-129` runs `npm install --prefix tools/.staging-<id>-<uuid>`, renames to `tools/pkgs/<id>-<uuid>`, then swaps the `tools/bin/<bin>` symlink atomically. `APP_DIR/tools` is outside the engine dir that `EngineInstaller` replaces. EACCES maps to `setup.permissions` (`:85`). | **Old `pkgs/<id>-<uuid>` are never pruned.** Every reinstall leaks a full netlify-cli tree (hundreds of MB). |
| 5 CLIs need node on PATH | ✅ | The launcher appends the runtime bin (`engine/bid:33`). Install verifies `<candidate> --version` (`setup-tools.mjs:116`). | `cliEnv()` (`isolation.mjs`) still does not guarantee the runtime bin when a caller strips PATH (minor). |
| 6 `/usr/bin/git` shim | 🟡 | `gitAvailable()` at `setup-tools.mjs:18-28` (xcode-select -p + xcrun --find). Used in `setup.mjs:32`, `bid.mjs:125,139,531`, `git.mjs:12`. | **Shim still executed:** `detect.mjs:76-79` `gitBasics()` runs `git rev-parse` on every `detect()`. `detect.mjs:1` imports `gitAvailable` but never uses it. Also `checks.mjs:141/52/151`, `fixes.mjs:90`, `newsite.mjs:154`, `aifix.mjs:132`. On a Mac without CLT, the "install developer tools" dialog can still pop on project load and check. Acceptance item 8 is not met. |
| 7 brew not found after install | ✅ | Covered by the launcher's standard dirs. | — |
| 8 `ok:true` on failure / confetti | ✅ | `setup.mjs:297-301` returns `ok:false, code:'setup_incomplete'` unless ready, nothing failed and nothing blocked. `bid.mjs` setup auto emits `result ok:false` and exits 1. The app relies on `outcome.ok`; `SetupAutoResult` is no longer decoded. | The spec's amber "partial" footer listing failures and what is left is not built. |
| 9 running→pass on finish | ✅ | `runItem` emits `fail` in `catch` (`setup.mjs:253-255`). `RunSession.swift:160-161` turns pending/running/waiting_user into `skipped`, never `pass`. | — |
| 10 install verified by running | ✅ | `setup-tools.mjs:115-117` (staging candidate `--version`, 15 s). The generic path re-reads status (`setup.mjs:249`). | — |
| 11 step ids / progress | ✅ | `netlifyLogin({stepId})` (`netlify.mjs:62`). Every pre-announced step ends `pass/fail/blocked/skipped` (`setup.mjs:269-296`). `RunSession.progress` counts waiting_user as unfinished. | — |
| 12 empty run green on failure | ✅ | `RunOverlay.swift:~96-100` shows a red xmark with `overlay.failedBeforeStart`. | — |
| 13 stdout reader with no deadline | ✅ | `Engine.swift:122` runs `/bin/zsh -f`. `:147-170` uses a readabilityHandler + `EngineLines` and finishes the stream 2 s after termination. `RunController.swift:47` sets a 2400 s deadline for setup. | — |
| 14 heartbeat / elapsed | 🟡 | `npm --loglevel=http --progress=false` (`setup-tools.mjs:110`). Heartbeat every 5 s: `setup.mjs:238` `ev.step(id,{elapsed})`. | The heartbeat has no `summary`. **The app ignores `elapsed`** (`RunSession.swift:96-110` does not read it), so no elapsed time is shown anywhere. |
| 15 offline 10-min hang | ✅ | `setupPreflight` (`setup-tools.mjs:67-81`): parallel HEAD probes, 4 s each, plus a 1.5 GB disk check. `--fetch-timeout=60000 --fetch-retries=2`, 6-min install timeout. Offline makes every step `skipped` with `code:'offline'` (`setup.mjs:275-281`). | Preflight needs **all three** hosts (a Netlify-only user behind a GitHub block counts as "offline"). The 1.5 GB check also blocks login-only runs. |
| 16 offline false "not logged in" | 🟡 | `gh auth token` (offline-safe) in `setup.mjs:43`. Cloud rows are optional (`:174`). | No `unknown_offline` state. `hosting.mjs:93-95` `ghAuthed()` still uses network `gh auth status`. |
| 17 double GitHub login | ✅ | `DEPENDENCIES` (`setup.mjs:222`) with `git-identity: ['git','gh-auth']` makes it `blocked`, never re-run. | See bug B3: the dependency also blocks the in-app form path. |
| 18 gh child untracked | ✅ | `ghDeviceLogin` goes through `runStream` (tracked in `children`; SIGTERM, then SIGKILL after 5 s; `error` handler). | — |
| 19 Netlify URL / countdown | ✅ | `netlify.mjs:62-74` parses `https://app.netlify.com/...` and emits `devicecode {code:null,url,expiresIn:300}` + `waiting_user`. `DomainViews.swift` DeviceCodeCard shows a URL-only variant and a timer. | `BROWSER=echo` for netlify-cli is fragile. `better-opn` treats it as an app name; `BROWSER=none` is the documented off-switch. |
| 20 CLT "done" immediately | 🟡 | `installCLT` (`setup.mjs:350-361`) spawns `xcode-select --install`, emits `waiting_user` and polls `gitAvailable()` every 10 s for up to 30 min. | No "Готово съм" or "проверявам на всеки 10 s" UI. |
| 21 slow status | 🟡 | Version probes run async and in parallel with 4 s limits (`setup.mjs:35-46`). The auto loop passes known items (`:294`). | `spaceshipConnected()` is still called twice (`:117`, a Keychain read ×2). `setupRun` recomputes full status (`:231`). No mtime cache. |
| 22 cloud rows required | ✅ | `setupStatusFull` (`setup.mjs:170-184`): only admin, `cloud.json` or `BID_SUPABASE_URL`; always `optional:true`. | — |
| 23 gh/git required without brew | ✅ | Required set at `:51-58` (gh only for ghpages, git only with a `.git`/github project). `installGitHub()` (`setup-tools.mjs:132-179`) with checksum. Identity form: `setupIdentity` (`setup.mjs:363-374`) + `GitIdentitySheet.swift`. | Bug B3 (auto never uses "from GitHub" after an in-run gh login). |
| 24 required ignores hosting | ✅ | `setup.mjs:51-58` derives it from `listProjects()` hosting (default netlify). | — |
| 25 interactive leftovers hidden | 🟡 | The engine returns `interactive` (`:298`). | The app doesn't decode or show it (`Models.swift:659-664` unchanged; `setupAuto()` now only refreshes). |
| 26 step logs | 🟡 | `log` on every step event (`setup.mjs:237,251,254`). Per-run files `<id>-<ts>.log`, keep 4+1 (`:190-196`). The report includes them, redacted via `tailText` (`log.mjs:67,100`). | Setup screen has no "Покажи логовете" / "Копирай диагностика". |
| 27 retry / refresh after failure | 🟡 | `onDone:` refresh in both calls (`AppModel.swift:807,840`). Footer has "retry" (`RunOverlay.swift:241`). | "Retry" re-runs the **whole** auto. No per-row retry. |
| 28 half installs / lock | 🟡 | Staging + atomic rename; `setup.lock` O_EXCL with pid+start time (`setup-tools.mjs:40-65`); cleanup on `exit`. | **No sweep of stale `.staging-*` at start** (spec §6). See bug B1 (SIGKILL race). Old `pkgs/` leak. |
| 29 auto replaces full status | ✅ | The app calls `loadSetup()` after every run. | — |
| 30 terminal steps report back | ❌ | No `beforeideploy://setup-refresh` and no `didBecomeActive` refresh on Setup. | — |
| 31 Bulgarian copy | 🟡 | Group is now "Хостинг и GitHub". Error mapping `installError()` (`setup-tools.mjs:83-90`). `setup.errorCode` removed. Dead `netlify-login` appAction removed. | **Still stale:** `setup.netlifyCli.detail` ("…по-бавния npx"), `netlify.noCli` ("…или npx… `npm i -g netlify-cli`"), app `engine.missingAt` ("Пусни install.sh", bg.lproj:506), `setup.identity.detail` (says "from GitHub" while the action is now a form). `setup.requires` shows raw ids ("Requires: gh-auth"). |
| 32 AI Fix bar on setup | ✅ | `RunOverlay.swift:178` `session.kind != .setup`. New `Kind.setup`. | — |
| 33 two tabs / clipboard | 🟡 | gh gets `BROWSER=echo` and the app alone opens the URL (`RunSession.swift:141`). | The clipboard is still overwritten silently. `deviceCode` is not cleared when gh-auth reaches pass/fail. |
| 34 auto-check "scripts changed" | ✅ | `checks.mjs:522` `scripts_untrusted`. The app shows a paused chip with a Check button (`DashboardView.swift:249`). | — |
| 35 silent / hung auto-check | ✅ | `timeout: 1200` (`AppModel.swift:1121`). Any non-ok sets `autoCheckPaused` (`:1133`). | — |
| 36 static onboarding | ❌ | `OnboardingViews.swift:202` still keys on `!setup.ready`. No per-step done state and no direct auto button. | — |
| 37 stale env.zsh / rc files | 🟡 | `-f` in both the launcher shebang and `Engine.swift:122`. | `EngineInstaller.swift:44-46` still copies `env.zsh` forward unchanged (no merge or refresh). |

**Score: 22 ✅ · 13 🟡 · 2 ❌.** Every Critical item (SU-1, 2, 3, 8) is done. Most Highs are done; SU-6 and SU-16 are partial.

### Target-flow spec conformance (beyond the SU list)

| Spec point | Status |
|---|---|
| §0 PATH order | ✅ exactly as specified |
| §0 "ok only after `--version` exit 0" | ✅ for CLIs (`setup.mjs:39-40`); netlify/vercel/wrangler login is config-file based (as specified) |
| §1 item model `state ∈ ok/missing/broken/needs_login/blocked/waiting_user/unknown_offline/installing`, `log/version/path` | 🟡 only `ok`, `missing` and `needs_login` are emitted (`setup.mjs:63`). `required` is added. The app decodes neither `state` nor `required` (`Models.swift:642-650`). |
| §2 preflight (lock, probes, disk, `preflight` step) | ✅ (thresholds as spec; 4 s instead of 5 s) |
| §3 steps/commands/timeouts | ✅ npm flags and 6 min; gh zip+checksum; CLT 30 min poll; gh/netlify 5 min. ❌ "brew if present" for gh (always downloads, which is fine) |
| §3 dependency → `blocked` | ✅ |
| §3 error mapping | ✅ (`installError`), but non-200 on the gh download is reported as "offline" (`setup-tools.mjs:147`) |
| §4 event contract (`elapsed`, `reason`, final `steps/installed/failed/blocked/interactive/status`) | ✅ engine side |
| §5 UI per state, header buttons, partial footer | 🟡 required-only ring ✅ (`Screens/SetupView.swift:20`), auto disabled while busy ✅. Everything else ❌. |
| §6 recovery: clean staging at start, cancel deletes staging, keep last 5 logs | 🟡 last-5 ✅. Cancel cleanup only on graceful exit. No start sweep. |
| §7 app timeouts | ✅ status 30 s, auto 2400 s, quiet check 1200 s, reader 2 s. `setup run` has no per-step budget (uses the same 2400 s). |
| §9 acceptance in `env -i` | ✅ launcher test only. Not the full suite. |

---

## 2. Bugs and regressions found (Task A)

| # | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| B1 | **High** | `util.mjs:259-268` vs `Engine.swift:80-88` | **Cancel race.** On SIGTERM the engine waits **5 s** before SIGKILLing children and emitting the result. The app SIGKILLs the engine at **5 s**. If the app wins, the npm/gh process groups (spawned `detached:true`) have only had SIGTERM. The `exit` handlers that delete `.staging-*` never run, and the `cancelled` result line is lost. | Engine grace 3 s (or app 8 s). Sweep `tools/.staging-*` (older than the lock owner) at the start of `setupAuto`/`setupRun`. |
| B2 | Med | `setup-tools.mjs:101,139` | `tools/pkgs/<id>-<uuid>` from previous installs are never deleted (disk leak of about 300-500 MB per netlify-cli reinstall). `tools/npm-cache` is unbounded. | After the atomic link swap, remove `pkgs/<id>-*` not targeted by `bin/<bin>`. Prune the npm cache or use `--prefer-online` with a temp cache. |
| B3 | Med | `setup.mjs:115-116, 222, 286-291` | `git-identity` gets the `app` (form) action whenever gh isn't logged in at status time, and depends on `gh-auth`. Result: (a) if gh-auth succeeds **during** the run, identity is still `blocked:user_action` (the stale action), so "from GitHub" never runs in auto. (b) A Netlify-only user with a `.git` project and no identity always gets `ok:false` with "Requires: gh-auth", although the real remedy is the form, and the app doesn't show `interactive`. | Re-read the item after its dependencies pass. Make `git-identity` depend only on `git`, and choose GitHub vs form at run time. Show `interactive` in the footer. |
| B4 | Med | `detect.mjs:76-79` (+ checks/fixes/newsite/aifix) | The SU-6 fix is incomplete: the `/usr/bin/git` shim is still executed on every `detect()`. The unused `gitAvailable` import in `detect.mjs:1` shows the fix was intended but not done. | Guard `gitBasics()` and the check/fix paths with a cached `gitAvailable()`. |
| B5 | Low-Med | `setup-tools.mjs:11-15` | npm packages are pinned only by **major/minor range** (`netlify-cli@23`, `@openai/codex@0.115`) with lifecycle scripts enabled. Installs are not reproducible, and a compromised patch release runs postinstall code as the user. | Pin exact versions (bumped by `catalog-sync`) and record the `integrity` from the lockfile. Consider `--ignore-scripts` per tool where the tool works without them. |
| B6 | Low-Med | `setup-tools.mjs:132-159` | gh integrity: `checksums.txt` comes from the **same release origin** as the zip. That protects against corruption, not against a replaced release asset. Version `2.101.0` is hard-coded; a 404 is reported as "offline". | Embed the expected sha256 per arch in source (like the pinned version), and map non-200 to `install_failed`. Optionally verify GitHub artifact attestations. |
| B7 | Low | `netlify.mjs:65` | `BROWSER=echo`: netlify-cli uses `better-opn`, where `BROWSER` is an app name. `none` is the supported off value. With `echo` on macOS it may try `open -a echo`. | `BROWSER: 'none'` (URL parsing already handles the rest). |
| B8 | Low | `setup-tools.mjs:67-81` | Preflight requires npm, github.com **and** api.netlify.com, plus 1.5 GB free, even for a login-only or Vercel-only run. | Probe only the hosts the todo list needs. Check disk only when an install step is queued. |
| B9 | Low | `bundle-node.sh:28-33` | (Pre-existing) a failed SHASUMS signature check only warns, and the build continues. | Make gpg verification mandatory in `release.sh`. |
| B10 | Low | `util.mjs:224` | (Pre-existing) `which()` interpolates its argument into `/bin/sh -c "command -v \"${cmd}\""`. Today all callers pass allowlisted values, but it is an injection foot-gun. | Do the PATH walk in JS (also needed for Windows, see §3). |
| B11 | Low | `engine/bid:12` | If the inherited PATH is empty, `tools/bin::…` contains an empty element (= cwd). A repo could then shadow `git`/`netlify` when spawned with `cwd=project`. | Strip empty and relative PATH elements in the launcher (or in `bid.mjs` at startup). |
| B12 | Low | i18n | Stale copy (SU-31 list above). `setup.requires` shows ids, not titles. | Copy fixes. |

**No regressions found in the existing suite** (114/114). `killTree` now group-kills even after the leader exited (`util.mjs:248`). That is needed for grandchildren and safe, because callers only pass live set members. `local-runner.cjs` (new relay for Local Preview) keeps the sandboxed child in the runner's process group, so the stop path still kills the whole tree.

**Security summary:**
- No secrets reach setup logs: `gh auth token` runs `quiet` with no logFile, and reports pass through `redact`.
- No sudo.
- The tools dir is user-owned; the lock file is 0600.
- Tool download integrity is OK for corruption but weak for authenticity (B5, B6).

**Later commits (35f…8d5fbec)** touch engine only for credits, meter and assistant (`meter.mjs`, `billing.mjs`, `release.mjs` metering wrapper, `ai/*`, `fetchT` pre-aborted signal fix). None of them change setup or platform code, and all still use `node:*` only.

### Task A verdict per area

| Area | Verdict |
|---|---|
| Launcher PATH + bundled npm (SU-1/2/3/5/7) | **Keep** |
| Managed install, staging, lock, preflight (SU-4/10/15/28) | **Keep + fix** B1, B2, B8 |
| Honest outcomes, step contract, overlay (SU-8/9/11/12/13/32) | **Keep** |
| Git shim detection (SU-6) | **Fix** (B4) |
| Dependency/identity logic (SU-17/23) | **Fix** (B3) |
| Tool supply chain (gh download, npm pins) | **Fix** (B5, B6) |
| UI leftovers (SU-14 elapsed, 20, 25, 26 buttons, 27 per-row, 30, 33, 36, state model) | **Defer to V13 UI pass**; engine contract already supports most |

---

## 3. Task B: platform coupling inventory (codex branch)

Legend for impact: **W** = Windows, **L** = Linux. "Blocker" = the feature or engine cannot start; "Degrade" = runs with a missing feature or a false state.

### 3.1 Engine core (cross-cutting; fix these first)

| # | Location | macOS assumption | Linux | Windows | Proposed abstraction |
|---|---|---|---|---|---|
| P1 | `engine/bid:1-61` | zsh launcher (`${0:A:h}`, globs `(N/)`, `print -r`), `/usr/bin/uname`, `~/Library/pnpm`, `/opt/homebrew/bin` | **Blocker on distros without zsh** (Debian/Ubuntu/Fedora default to bash). The `uname -m` value is `aarch64`, which doesn't match the bundle's `arm64` folder. | **Blocker**: no zsh, no exec | Move PATH building into JS: `engine/src/platform/path.mjs` `buildPath()` runs first in `bid.mjs`. Keep thin launchers: `bid` (POSIX sh) and `bid.cmd`. Use a runtime folder keyed by `${process.platform}-${process.arch}` (`darwin-arm64`, `linux-x64`, `win32-x64`). |
| P2 | `util.mjs:223-226` `which()` | `/bin/sh -c command -v` | OK | **Blocker**: every tool is reported missing | Pure-JS PATH walk with `PATHEXT` on win32 (also fixes B10). |
| P3 | `util.mjs:228-243 sh`, `:275-350 runStream`, `local.mjs:170` | spawning `npm`, `netlify`, `gh`, `vercel` directly | OK | **Blocker**: npm-installed CLIs are `.cmd` shims. Node ≥18.20/20.12 refuses to spawn `.cmd`/`.bat` without `shell` (CVE-2024-27980). | `platform.spawnSpec(cmd,args)`: on win32, resolve `.cmd`, then run `node <real js entry>` (read the shim target) or `cmd.exe /d /s /c` with strict quoting. Use `windowsHide:true`. |
| P4 | `util.mjs:248-268 killTree`, signal handlers; `local.mjs:205,248-259`; `assistant.mjs:271` | POSIX process groups (`process.kill(-pid)`), `detached:true` as setsid, SIGTERM/SIGHUP | OK | **Degrade**: `-pid` throws, so it falls back to `child.kill` (no tree). Grandchildren (dev servers, npm) leak. `detached` opens a new console. SIGTERM is never delivered (app cancel = hard kill). | `platform.killTree(pid)`: POSIX group kill, or `taskkill /T /F /PID` on win32. Cancel via a stdin "cancel" line or a named-pipe control message instead of signals. |
| P5 | `util.mjs:13-14` APP_DIR/CACHE_DIR | `~/Library/Application Support`, `~/Library/Caches` | Degrade (works, but creates `~/Library` in $HOME) | Degrade (same) | `platform.dirs()`: XDG `$XDG_DATA_HOME`/`$XDG_CACHE_HOME`/`$XDG_STATE_HOME` on Linux; `%APPDATA%`/`%LOCALAPPDATA%` on Windows. Keep the `BID_APP_DIR`/`BID_CACHE_DIR` overrides. Also used by `engine/bid:10`, `ai/index.mjs:172` comments, `scripts/*`. |
| P6 | `util.mjs:409-424 pidStartTime`, `local.mjs:12` | `ps -o lstart=` | OK (procps supports lstart) | Degrade (null, so pid-only locks) | `/proc/<pid>/stat` field 22 on Linux. On win32, `wmic`/PowerShell `Get-Process`, or accept pid-only plus an mtime TTL. |
| P7 | `local.mjs:58-59` | `lsof` for port owner | Degrade (often not installed; returns null) | Degrade | `ss -ltnp` / `/proc/net/tcp` on Linux; `netstat -ano` on win32. Or drop it: `usable()` already probes by bind + HTTP. |
| P8 | `log.mjs:113-115` | `zip` CLI for support report | Degrade (folder fallback) | Degrade (`which` fails) | Pure-JS store-only zip writer (~80 lines, zero-dep), or `tar` (present on Win10+). |
| P9 | file modes `0o600/0o700` (`secrets.mjs:37`, `setup.mjs:194`, lock) | POSIX perms | OK | Degrade (ignored; ACLs inherit from profile, usually fine) | Document it; on Windows rely on the per-user profile ACL. |
| P10 | `fs.symlinkSync` in `setup-tools.mjs:119,170`; `bundle-node.sh:56-57` | symlinks are free | OK | **Blocker** for managed installs (EPERM without Developer Mode/admin) | On win32, write `tools/bin/<bin>.cmd` shims pointing at `pkgs/<id>/node_modules/.bin/<bin>.cmd`, or use directory junctions plus PATH entries. |
| P11 | `fs.statfsSync` (preflight) | — | OK | OK (libuv supports Windows) | none |

### 3.2 Security, secrets and isolation

| # | Location | macOS assumption | Linux | Windows | Proposed abstraction |
|---|---|---|---|---|---|
| P12 | `secrets.mjs:1-62` | Keychain via `security -i`/`find-generic-password` | **Degrade, security-relevant**: falls back to plaintext JSON files `APP_DIR/secrets/<account>.json` (0600). Session tokens, AI keys, Pushover and Spaceship keys are readable by any same-user process, including project scripts (P13). | Same fallback, plus `which` fails | `platform/secrets.mjs` backends: macOS `security`; Linux `secret-tool` (libsecret, CLI only, zero npm), else an explicit "file (unprotected)" mode surfaced in Setup; Windows DPAPI via `powershell -NoProfile [Security.Cryptography.ProtectedData]` (CurrentUser) to an encrypted file, or Credential Manager via `cmdkey` (no read-back) / PowerShell CredMan P/Invoke. |
| P13 | `isolation.mjs:79-101` | `sandbox-exec` SBPL profile denying Keychain mach services and APP_DIR/CACHE_DIR/`~/Library/Keychains` | **Degrade, security-relevant**: `isolationLevel()='none'`. Project scripts run unsandboxed next to plaintext secrets (P12). Auto-check still requires trust; manual checks run unisolated. | Same | `platform/isolate.mjs`: Linux `bwrap` (bubblewrap) with `--tmpfs` over APP_DIR/CACHE_DIR and `--ro-bind /`, network shared; fall back to Landlock via a tiny helper if available, else `none` and say so in UI. Windows: no cheap equivalent; run as `none`, keep secrets DPAPI-encrypted (useless to a script without the user's DPAPI context, though same-user scripts can still call DPAPI), and require explicit trust per run. |
| P14 | `aikeys.mjs`, `pushover.mjs`, `account.mjs`, `providers/backup/codeguard.mjs:33` | comments and messages say "Keychain" | copy only | copy only | Rename copy to "secure storage", per platform. |

### 3.3 Setup / tools

| # | Location | macOS assumption | Linux | Windows | Proposed abstraction |
|---|---|---|---|---|---|
| P15 | `setup-tools.mjs:18-28 gitAvailable`, `setup.mjs:72-76, 242, 350-361 installCLT` | xcode-select/xcrun, CLT dialog | git row: `installCLT` throws `not_runnable`, so auto setup reports `fail`. | Same, plus git from `which` fails (P2) | `platform.gitInstall`: Linux gives an `open`/instructions action ("sudo apt install git" shown, never run). Windows: `winget install --scope user Git.Git` if winget exists, else a MinGit portable zip with pinned sha256 into `tools/`. |
| P16 | `setup-tools.mjs:132-179 installGitHub` | `gh_<v>_macOS_<arch>.zip`, `/usr/bin/unzip` | Fails (wrong asset; `unzip` path) | Fails | Asset table `{darwin: macOS_*.zip, linux: linux_*.tar.gz, win32: windows_*.zip}` with pinned sha256 each. Extract with `tar` (bsdtar on macOS and Win10+; GNU tar on Linux handles .tar.gz). |
| P17 | `setup.mjs:33, 84-89` brew row; `engine/bid:12` `/opt/homebrew/bin` | Homebrew | Degrade (optional row with a wrong hint; Linuxbrew exists but is rare) | Degrade (meaningless row) | Hide the brew row unless darwin. |
| P18 | `setup.mjs:198-220 writeCommand`, `aifix.mjs:199-215` | `.command` zsh script opened by Terminal (app `NSWorkspace.open`) | Not runnable by double-click. No standard terminal. | Not runnable | `platform.openTerminal(script)`: Linux `x-terminal-emulator -e` / `gnome-terminal --` / `konsole -e` with a `.sh`; Windows `.cmd` or `.ps1` via `cmd /c start`. Return `{terminalScript, launcher}` for the UI. |
| P19 | `bundle-node.sh` (whole file) | darwin tarballs, `shasum`, arch folders `arm64`/`x86_64` | Needs `linux-x64`/`linux-arm64` .tar.xz | Needs `win-x64.zip` (node.exe + npm .cmd) | Parameterize by `PLATFORMS="darwin-arm64 darwin-x64 linux-x64 linux-arm64 win-x64"`. Use `sha256sum` or `openssl dgst` fallback. Make gpg mandatory (B9). |
| P20 | `setup-tools.mjs:30-37 resolveNpm` | `../lib/node_modules/npm` relative to node, `x64→x86_64` folder map | Mismatch with `uname -m`=`aarch64` | Windows layout is `node_modules/npm` next to `node.exe` | Derive from the P1 platform key. |
| P21 | `netlify.mjs:48-53`, `hosting.mjs:76-91` auth-file candidates | `~/Library/Preferences/netlify`, `~/Library/Application Support/com.vercel.cli`, `~/Library/Preferences/.wrangler` | OK (XDG candidates already listed) | **Degrade**: Windows paths missing (`%APPDATA%\netlify\Config\config.json`, `%APPDATA%\xdg.data\com.vercel.cli\auth.json`, `%USERPROFILE%\.wrangler\config\default.toml`), so "not logged in" | One `platform.configCandidates(tool)` table. |

### 3.4 Background, update, packaging, app

| # | Location | macOS assumption | Linux | Windows | Proposed abstraction |
|---|---|---|---|---|---|
| P22 | `monitor.mjs:31-32, 416-465` | launchd agent plist in `~/Library/LaunchAgents`, `launchctl load`, `/bin/zsh` | `unsupported` (guarded at `:426`) | same | `platform/scheduler.mjs`: Linux systemd `--user` `.service`+`.timer` (`systemctl --user enable --now`), cron fallback; Windows `schtasks /Create /SC MINUTE /MO n /TN …` (no admin). The plist XML also interpolates paths without XML escaping (fix in passing). |
| P23 | `update.mjs:5, 95-140` | DMG feed, download to `~/Downloads/*.dmg`, the app opens it | Download + sha256 is pure Node and works; artifact type is wrong | same | Feed v2: `assets: { "darwin-universal": {url,sha256}, "linux-x64-appimage"/"deb", "win32-x64-msi"/"msix" }`. The engine picks by platform key; installation stays in the shell app. |
| P24 | `scripts/build.sh, release.sh, install.sh, uninstall.sh, launch.zsh`, `packaging/` | swift build, sips/iconutil, codesign, notarytool/stapler, hdiutil, lsregister, osascript, Homebrew cask, `security delete-generic-password`, launchctl | n/a | n/a | New per-platform packaging jobs. Reuse only `release-feed.mjs` (Node) and `bundle-node.sh` (after P19). |
| P25 | `App/` (37 Swift files: SwiftUI + AppKit; `MenuBarExtra` `BeforeIDeployApp.swift:64`; `UNUserNotificationCenter` `Notifier.swift`; `NSWorkspace`/`NSPasteboard`; `Process("/bin/zsh -f")` `Engine.swift:121-122`; `EngineInstaller.swift` copies into `~/Library/Application Support`) | macOS-only UI shell | **Replace** | **Replace** | The engine is already a headless NDJSON CLI, so a new shell only has to reimplement `Engine.swift` (spawn + line stream + cancel) and the views. Options: (a) Tauri or Electron shell (npm deps live in the shell, not the engine, so the rule holds); (b) a local web UI served by the engine (`static-server.cjs` + an NDJSON-over-SSE bridge) with a tray helper per OS. Menu bar maps to the Windows tray and Linux StatusNotifier/AppIndicator. Notifications map to `notify-send` and Windows toasts. |

### 3.5 Already portable (pure Node; would work on Linux today, and on Windows once P2/P3/P4 are fixed)

- **Project checks pipeline**: `checks.mjs` (env, deps, lint/typecheck/build via the package manager, secrets scan, gitignore, size, links), `detect.mjs`, `issues.mjs`, `fixes.mjs` (git-based), `pathpolicy.mjs`, `staging.mjs`, `postdeploy.mjs`. On Linux the only gap is isolation (P13).
- **Static preview server** `static-server.cjs` and `local.mjs` (Linux OK; Windows needs P4).
- **Netlify/Vercel/Wrangler/GitHub Pages deploy flows** (`netlify.mjs`, `hosting.mjs`, `release.mjs`, `site.mjs`, `newsite.mjs`): they drive the vendor CLIs. Linux OK; Windows needs P3 and P21.
- **Monitoring "once"** (`monitor.mjs` HTTP/TLS/DNS via `node:tls`, `node:dns`), incidents and overview. Only the scheduler is mac-specific.
- **Cloud and account**: `account.mjs`, `cloud.mjs`, `billing.mjs`, `meter.mjs`, `admin.mjs`, `monitor-cloud.mjs`, all `fetch` (secrets via P12).
- **AI**: `ai/*` (providers over fetch/SSE, assistant, conversation, answer-stream), `aifix.mjs` prompt/URL modes (CLI mode needs P18).
- **Plumbing**: i18n, store, costs, plans catalog, log/report (zip via P8), `update check|download` (hash-verified download, P23), setup **status** logic, lock, preflight and npm managed install (Linux OK after P1/P20; Windows needs P10).
- **Test suite**: `tests/run.mjs` passes 114/114 on Linux with `BID_NO_SANDBOX=1`, and `tests/setup-v12.mjs` 7/7, which is direct evidence that the engine core already runs on Linux.

### 3.6 Recommended order for a cross-platform engine

1. `engine/src/platform/` with `dirs`, `which`, `spawnSpec`, `killTree`, `pathBuild`, `secrets`, `isolate`, `scheduler`, `terminal`, `configCandidates`, `runtimeKey`. Replace the direct call sites listed above (≈25 sites).
2. A POSIX `bid` launcher plus `bid.cmd` that only locate the bundled node and exec `bid.mjs`; PATH logic moves to JS (P1).
3. Linux secrets (`secret-tool`) and `bwrap` isolation **before** shipping Linux. Otherwise plaintext secrets sit beside unsandboxed project scripts.
4. Windows: P2/P3/P4/P10 are hard blockers; P21 is a correctness issue.
5. Packaging and UI shell last (P24/P25).
