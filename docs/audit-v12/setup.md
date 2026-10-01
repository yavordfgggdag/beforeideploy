# Приложение C — Автоматична настройка (SU-1 … SU-37)

# Audit: automatic setup in "Before I Deploy"

Scope: `engine/src/setup.mjs`, `engine/src/bid.mjs` (`setup` and `doctor`), `engine/bid` (the launcher), `scripts/bundle-node.sh`, `scripts/install.sh`, `scripts/build.sh`, `scripts/release.sh`, `engine/src/netlify.mjs`, `engine/src/hosting.mjs`, `engine/src/cloud.mjs`, `engine/src/util.mjs`, `engine/src/checks.mjs` (`--auto`), `engine/src/update.mjs`, and on the Swift side `Engine.swift`, `EngineInstaller.swift`, `AppModel.swift`, `Stores/RunController.swift`, `RunSession.swift`, `RunOverlay.swift`, `V7Views.swift` (SetupView and SetupBanner), `OnboardingViews.swift`, `AutoCheck.swift`, plus the Bulgarian strings in `engine/i18n/bg.json` and `App/Resources/bg.lproj`. No files were edited.

**Two runs confirmed the main problems.** I ran the engine with the PATH a Finder-launched app gets (`env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin`):
- `bid setup status --local` reports **Node.js missing**, even though it is running on Node. It also reports netlify-cli, gh and npm missing, `ready:false`, `missingRequired:6`.
- `bid setup auto --yes` returns **`{"ok":true, "failed":["netlify-cli","gh-auth","git-identity","netlify-login"], "installed":[]}`**. The Netlify CLI step logs `spawn npm ENOENT` with the summary "Грешка (код -2)". The app shows that result as a green "Настройката приключи" with confetti.

Root cause in one sentence: **the shipped app runs the engine on the bundled `node` binary with the GUI PATH and no npm, so nothing the setup detects or installs can be found or run.** Everything after that point is built on that gap.

---

## Findings

### A. Environment and PATH (the root cause)

**SU-1 · Critical · With the bundled Node, the engine runs with the GUI PATH, so no user tool is ever found**
- Evidence: `engine/bid:10-13` runs `exec "$BUNDLED_NODE" …` *before* line 18 (`export PATH="$PATH:…/opt/homebrew/bin:/usr/local/bin…"`). Only `env.zsh` (line 6) could widen PATH, and only `scripts/install.sh:40` writes it. DMG customers never have it. `Engine.swift:124` passes `ProcessInfo.processInfo.environment` unchanged.
- Impact: Finder-launched apps get `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. So `which('netlify'|'gh'|'brew'|'npm'|'node')` fails for everything in `/opt/homebrew/bin` and `/usr/local/bin`. Even after the user installs a tool by hand, Setup still says "missing", and auto setup can never finish. Project checks also fail with `check.deps.noNode` (`checks.mjs:222`), so auto-check tells the user their last change "broke" the project.
- Fix: in `engine/bid`, build PATH **before** the bundled exec:
  1. `source env.zsh` if present.
  2. Prepend `"$APP_SUPPORT/tools/bin"` (see SU-4).
  3. Append the standard directories (volta, asdf, `/opt/homebrew/bin`, `/usr/local/bin`, bun, pnpm, `~/.npm-global/bin`, the nvm default).
  4. Append the bundled runtime's `bin` **last**, so the user's Node wins for their projects but a `node` is always available.

  Then `exec` the bundled node. Optionally, have the app capture the login-shell PATH once (`/bin/zsh -lic 'print -r -- $PATH'`, 5 s timeout) into `APP_DIR/path.env` and source it like `env.zsh`. Add a test that runs `bid setup status` with `env -i PATH=/usr/bin:/bin`. The release dry run currently proves only that `bid version` runs that way (CHANGELOG WP02).

**SU-2 · Critical · The "Node.js" row is required and always red in the shipped app**
- Evidence: `setup.mjs:40` uses `!!which('node')`; this is not `process.execPath`. Its action is `open https://nodejs.org` (`setup.mjs:41-44`).
- Impact: a DMG user sees "1 задължително нещо липсва", the SetupBanner (`V7Views.swift:161`) and the FirstStepsCard hint forever. They are sent to install Node, which they don't need. Even after they install it, it stays red because of SU-1. `ready` is never true, and the "Настрой всичко автоматично" button is never disabled.
- Fix: the row is OK when `process.env.BID_NODE_RUNTIME === 'bundled'` **or** `which('node')`. Detail: "Вграден Node v22.12.0" or the user's version. A missing system Node becomes an optional info row ("Твоите проекти ще ползват вградения Node").

**SU-3 · Critical · The bundled runtime has no npm or npx, so every "Инсталирай" for netlify-cli, vercel, wrangler, codex or claude fails with ENOENT**
- Evidence: `bundle-node.sh:50-52` extracts only `bin/node` and `LICENSE`. `setup.mjs:32` runs `cmd: 'npm', args: ['install','-g',pkg]`. Reproduced: `{"type":"log","step":"netlify-cli","line":"spawn npm ENOENT"}` and the summary `Грешка (код -2)`.
- Impact: on a fresh Mac, the only required install step that can be automated fails immediately with a meaningless code. The same applies to `deps.install` (`fixes.mjs:203`) and to project scripts (`npm run …`).
- Fix: in `bundle-node.sh`, also extract `lib/node_modules/npm` and create `bin/npm` and `bin/npx` (or call `node lib/node_modules/npm/bin/npm-cli.js` directly). In `setup.mjs`, resolve npm as: user npm on the fixed PATH, else the bundled npm-cli via `process.execPath`. Before spawning, check that the resolved binary exists. If it doesn't, emit `fail` with a clear message (`setup.npmMissing`), not an errno code.

**SU-4 · High · `npm install -g` writes to a prefix that may need sudo (EACCES) or isn't on PATH**
- Evidence: `setup.mjs:32` uses `-g`. With the nodejs.org `.pkg`, the prefix is `/usr/local` and `lib/node_modules` belongs to root. With the bundled npm, the prefix would be inside the app's engine folder, which `EngineInstaller.swift:49-52` overwrites on every engine update.
- Impact: `npm ERR! code EACCES … mkdir '/usr/local/lib/node_modules/netlify-cli'`. The UI shows "Грешка (код 243)" with no guidance, and the user may try `sudo npm`, which leaves root-owned caches behind. With the bundled npm, tools vanish after each app update.
- Fix: never use `-g`. Install into a managed, user-owned prefix: `~/Library/Application Support/BeforeIDeploy/tools`, with `npm install --prefix "$TOOLS" --no-audit --no-fund --loglevel=http --fetch-timeout=60000 --fetch-retries=2 netlify-cli@<pinned major>`. Link `$TOOLS/node_modules/.bin/*` into `$TOOLS/bin`, which SU-1 puts first on PATH. `EngineInstaller` must not touch `tools/`. If a user still runs into EACCES (for example through their own npm), detect `EACCES` in the log tail and show "Нямаш права за запис в /usr/local — инсталирам в собствена папка на приложението", then retry in the managed prefix automatically.

**SU-5 · High · npm-installed CLIs need `node` on PATH, and only the bundled node exists**
- Evidence: npm shims use `#!/usr/bin/env node`. The bundled runtime isn't on PATH (`engine/bid:13`). `runStream` and `cliEnv` pass `process.env` unchanged (`isolation.mjs:37-41`).
- Impact: even after a successful install, `netlify --version` fails with `env: node: No such file or directory` (exit 127). Setup shows the CLI as present but its version as null, and every deploy or login fails.
- Fix: covered by SU-1, which appends the runtime `bin` to PATH. Also add `PATH` handling in `cliEnv()` so the runtime `bin` is present even if the caller strips it. Verify after install by actually running `<cli> --version` (SU-10).

**SU-6 · High · The `/usr/bin/git` stub counts as "Git installed" and opens the Xcode CLT dialog on every Setup refresh**
- Evidence: `setup.mjs:45` uses `!!which('git')`, which finds the `/usr/bin/git` shim on every Mac. `version('git')` (line 45) and `sh('git',['config','--global',…])` (lines 50-51) run that shim. `loadSetup` runs at app start (`AppModel.swift:255`), on sidebar clicks (`SidebarView.swift:58`) and after every action.
- Impact: on a Mac without CLT, the system dialog "The git command requires the command line developer tools…" pops up at launch and on each refresh. Meanwhile the Git row is green with an empty detail, so the "Инсталирай (xcode-select --install)" action is never offered. `deriveIssues({gitInstalled})` is wrong too.
- Fix: write `gitAvailable()`:
  - If the path is `/usr/bin/git`, it is real only if `xcode-select -p` exits 0 **and** `xcrun --find git` succeeds (2 s timeout).
  - Otherwise, the path must be an executable that isn't the shim.

  Never execute `/usr/bin/git` before that check. Use the helper in `setup.mjs`, `bid.mjs:121,503` and `git.mjs`.

**SU-7 · Medium · Homebrew installed through Setup is still not found afterwards**
- Evidence: `setup.mjs:57-62` and `which('brew')`. The Homebrew installer adds `/opt/homebrew/bin` only to the user's `.zprofile`, and only if they follow its "Next steps". The engine's PATH comes from SU-1.
- Impact: the user installs brew (sudo password, 5-15 min), presses "Обнови", and still sees "Homebrew липсва" and "GitHub CLI → Изтегли".
- Fix: SU-1 fixes this through the standard directories. In addition, `which('brew')` should fall back to checking `/opt/homebrew/bin/brew` and `/usr/local/bin/brew` directly.

### B. Wrong success reporting, progress and step identities

**SU-8 · Critical · `setup auto` returns `ok:true` even when every step failed, and the app shows green with confetti**
- Evidence: `setup.mjs:213-228` puts failures in `failed[]` and still returns `ok`. `AppModel.swift:834-846` never reads `r.failed`. `RunController.swift:50-52` treats `outcome.ok` as success. `RunOverlay.swift:47` shows `Celebration()` when `finished && success`.
- Impact: this is the owner's "doesn't work properly". After a run in which nothing was installed, the user sees "Настройката приключи ✓" with confetti.
- Fix: the engine returns `ok:false` with code `setup_incomplete` when any required step failed, or adds `partial:true` and a `steps:[{id,status,reason}]` summary. In `setupAuto()`, when `!r.failed.isEmpty`, set `s.success = false`, `s.outcomeTitle = L("setup.autoPartial", failedCount)` and `s.outcomeMessage` = the titles of the failed items. Add `failed` and `interactive` to `SetupAutoResult` (`Models.swift:661`).

**SU-9 · High · Steps that were never closed turn green when the run ends**
- Evidence:
  - `RunSession.swift:158-160` turns every step still `running` into `pass` when the run ends with `success: true`.
  - `gitIdentityFromGitHub` emits `git-identity running` (`setup.mjs:275`). Then `ghDeviceLogin` throws `missing_cli` (`setup.mjs:234`) **without emitting `fail`**.
  - `netlifyLogin` emits `login running` (`netlify.mjs:62`). Then `requireCli()` throws `no_cli` without a `fail` event.
- Impact: in the reproduction, "Git име и имейл" and "Netlify вход" end with green checkmarks although both failed.
- Fix: in `setupRun`, wrap every handler in `try/catch`, emit `ev.step(id, {status:'fail', summary: e.message})`, then rethrow. In `RunSession.finish`, never convert `running` to `pass`: use `skipped`, or `fail` if the result is not OK.

**SU-10 · High · An install counts as successful when npm exits 0, without checking that the tool works**
- Evidence: `setup.mjs:196-200` sets `ok = r.code === 0`.
- Impact: npm can exit 0 while the binary is unusable (SU-5, a prefix not on PATH, a shim without node). The step shows "Инсталирано", but the row stays red after the refresh, or deploys fail later.
- Fix: after the install, run a fresh `which(<bin>)` and `<bin> --version` (15 s). If either fails, emit `fail` with "Инсталирано, но не се стартира: <stderr tail>" and the log link.

**SU-11 · High · Step ids don't match, so the bar never fills and pending rows stay grey**
- Evidence: `setup.mjs:207,212` pre-announce `netlify-login` as `pending`. `netlifyLogin()` reports as id `'login'` (`netlify.mjs:62-70`). When `gh-auth` fails because gh is missing, it emits nothing (`setup.mjs:234`), so its row stays `pending`.
- Impact: a duplicate "Netlify вход" row appears. "Netlify акаунт" stays pending forever. `RunSession.progress` (`RunSession.swift:52-56`) never reaches 100%. The run looks stuck or half-done even when it finished.
- Fix: give `netlifyLogin` and `ghDeviceLogin` a `stepId` parameter (default `'login'`/`'gh-auth'`). `setupRun` passes the item id. Every pre-announced step must end in `pass`, `fail` or `skipped` (with a reason) before `setupAuto` returns. `finish()` marks any leftover `pending` as `skipped`.

**SU-12 · Medium · After the "spinner forever" fix, an empty run shows a green "nothing to do" even when it failed**
- Evidence: `RunOverlay.swift:118-128` tests `if session.finished` and draws the green `checkmark` with `overlay.nothingToDo` without looking at `session.success`.
- Impact: when the engine fails before its first step (no_node, engine crash, `confirm_required`, a timeout), the left column says "Нямаше нищо за правене." with a green check, while the header shows a red X.
- Fix: `if session.finished && session.success` → green check. `else if session.finished` → red `xmark` + `L("overlay.failedBeforeStart")` + `session.outcomeMessage`.

**SU-13 · Medium · `engine.run` reads stdout until EOF with no deadline: the remaining way to spin forever**
- Evidence: `Engine.swift:168` (`for try await line in out.fileHandleForReading.bytes.lines`). `RunController.swift:47` calls it with `timeout: nil`.
- Impact: if a child process inherits the engine's stdout (a future `stdio:'inherit'`, a shell wrapper, or a `zsh` sourcing a `~/.zshenv` that spawns a background job), the overlay spins after the engine has exited. Cancel's SIGKILL kills only the engine, not whoever holds the pipe.
- Fix: after `terminationHandler` fires, give the reader 2 s, then close `out.fileHandleForReading` and stop the loop. Start the launcher with `/bin/zsh -f` so user rc files are not read. Give `setup auto` an overall deadline: the sum of the step budgets plus 2 min (about 35 min).

**SU-14 · Medium · npm prints nothing for minutes, and there is no heartbeat or elapsed time per step**
- Evidence: `runStream` runs npm without a TTY, so npm is silent until it finishes or fails. `RunOverlay.swift:167` shows "Чакам изход…".
- Impact: netlify-cli is about 200 MB. One to four silent minutes looks like a hang, and users cancel half-way.
- Fix: pass `--loglevel=http --progress=false` so npm prints each fetch line. From the engine, emit `{"type":"step", id, status:"running", summary:"Изтеглям пакети… 1:20"}` every 5 s. Show elapsed time per step in `RunStepRow`.

### C. Timeouts, offline and hanging

**SU-15 · High · Offline, auto setup sits up to 10 minutes on npm with no message**
- Evidence: `setup.mjs:196` (`timeout: 10*60*1000`) with npm's default `fetch-timeout` (5 min) × retries. There is no network check before the run.
- Impact: offline, "Netlify CLI" spins for 10 minutes, then shows "Времето изтече (600s)". Netlify and GitHub logins fail at once after that.
- Fix: before the run, probe `registry.npmjs.org`, `github.com` and `api.netlify.com` (HEAD with `fetchT`, 5 s each). If they are unreachable, skip network steps with `status:'skipped'` and the summary "Няма интернет — опитай пак, когато си онлайн", and return `code:'offline'`. Also add `--fetch-timeout=60000 --fetch-retries=2` and lower the per-install timeout to 6 min.

**SU-16 · High · Offline gives false "not logged in" results, and cloud rows become a required item nobody can fix**
- Evidence: `gh auth status` validates the token over the network (`setup.mjs:82`, `hosting.mjs:93`). Offline, `cloudSetupItems` adds `cloud-config` with `ok:false, action:null` (`cloud.mjs:122-124`), and the row is required.
- Impact: offline, Setup shows "GitHub акаунт" not connected and offers a new login. "Supabase проект" is red with no button, and the sidebar badge counts it as missing.
- Fix: check gh with `gh auth token` (works offline) or by parsing `~/.config/gh/hosts.yml`. Rows whose state depends on the network become `state:'unknown'` ("Не мога да проверя — няма връзка"), are never counted as missing, and never trigger an auto-login.

**SU-17 · Medium · The GitHub login can run twice in one auto run (10+ minutes, two browser tabs)**
- Evidence: in `ORDER`, `gh-auth` runs before `git-identity` (`setup.mjs:207`). If `gh-auth` times out after 5 min (`setup.mjs:255`), `git-identity` calls `ghDeviceLogin()` again (`setup.mjs:274-277`).
- Impact: the user gets a second device code and another 5-minute wait.
- Fix: in `setupAuto`, keep track of steps that already failed. If `gh-auth` failed or was skipped, mark `git-identity` as `blocked` ("Нужен е GitHub вход") without starting it.

**SU-18 · Medium · The gh login child is not tracked: Cancel leaves it running and it is never force-killed**
- Evidence: `setup.mjs:238` uses its own `spawn`, which is not added to `children` (`util.mjs:244`). The timeout sends only `SIGTERM` (line 255). There is no `child.on('error')`.
- Impact: after Cancel, an orphaned `gh auth login` keeps polling. It can finish the login later without the app knowing. A spawn error becomes an uncaught exception.
- Fix: register the child in `children` (export a helper from util). On timeout, SIGTERM then SIGKILL after 5 s. Add an `error` handler that resolves with 127.

**SU-19 · Medium · During the Netlify browser login there is no URL, no countdown and no "open again"**
- Evidence: `netlify.mjs:61-71` emits only "Отварям браузъра — потвърди входа там". The `https://app.netlify.com/authorize?...ticket=…` URL netlify prints goes only to the log.
- Impact: if the browser didn't open (no default browser, or it opened in another profile), the user waits 5 min and fails.
- Fix: parse the `https://app.netlify.com/authorize\S+` URL from the output and emit `{type:'devicecode', service:'Netlify', url, code:null}`. Make `DeviceCodeCard` show "Отвори отново" without a code, plus a 5:00 countdown.

**SU-20 · Medium · The Xcode CLT step says "done" immediately while the download is still running**
- Evidence: `setup.mjs:46-49` sets `script: 'xcode-select --install'`. `writeCommand` adds `echo 'Можеш да затвориш прозореца и да натиснеш „Обнови“…'` (`setup.mjs:165`). `xcode-select --install` only opens the system dialog and returns at once.
- Impact: the user closes Terminal and presses "Обнови" while the 1+ GB CLT download (5-20 min) is still running. Git stays missing, and the user concludes setup is broken. Offline, the dialog fails with "not currently available from the Software Update server", and we say nothing.
- Fix: start `xcode-select --install` from the engine (it opens a GUI dialog, so no Terminal is needed). Then poll `xcode-select -p` every 10 s for up to 30 min under a state `waiting_user` with the copy "Потвърди инсталацията в прозореца на macOS (≈10 мин)". The app shows "Проверявам на всеки 10 s" and a "Готово съм" button. On success the step turns `pass`. After a timeout it shows "Не открих Command Line Tools — пусни `xcode-select --install` пак".

**SU-21 · Low · `setup status` is slow and recomputed before each step**
- Evidence: `setupStatus()` runs about 10 synchronous subprocesses (`--version` ×7 at 15 s max each, `gh auth status` 12 s, a Keychain read twice through `spaceshipConnected()` at `setup.mjs:88`). `setupRun` calls it again for every step (`setup.mjs:185`). `loadSetup` adds `cloudDoctor` on top.
- Impact: Setup takes 5-30 s to load, and auto setup pauses between steps while "Работи…" is shown with no active step.
- Fix: in `setupRun`, compute only the target item, not the whole list. Run `version()` calls in parallel (async `execFile`) with a 5 s limit. Call `spaceshipConnected()` once. Cache `--version` output by binary mtime.

### D. What counts as required

**SU-22 · High · Owner-only cloud rows are required for every customer**
- Evidence: `setup.mjs:141-152` puts `cloudSetupItems` into `required`. `cloud.mjs:126-145` covers the schema, Edge Functions and sign-ups, with actions that open the Supabase dashboard and the SQL editor.
- Impact: if the product cloud is incomplete (the CHANGELOG says it had no schema or functions), every customer sees "Схема на базата / Edge Functions" as red required items they cannot and must not fix. `ready` never becomes true.
- Fix: show the cloud group only to `role === 'admin'` (from `profile.json`) or when the user has their own cloud. Keep it out of `required` either way. Customers get one optional row, "Акаунт в облака: достъпен / недостъпен".

**SU-23 · High · GitHub CLI, the GitHub login and Git identity are required, but without Homebrew they cannot be automated**
- Evidence: `setup.mjs:74-87` makes them required. Without brew, gh's action is `open https://cli.github.com` (line 80), which `setupAuto` skips, and that page leads to a manual `.pkg` download. `git-identity` can only be done through GitHub (lines 52-56, 273-292).
- Impact: on a fresh Mac without brew, "ready" is impossible without manual downloads, even for a Netlify-only user who doesn't need GitHub. After a `.pkg` install into `/usr/local/bin`, gh is still not found because of SU-1.
- Fix:
  1. Make `gh` and `gh-auth` optional unless a project uses `hosting:'ghpages'` or the user turns on GitHub.
  2. Install gh without brew: download `gh_<ver>_macOS_<arm64|amd64>.zip` from GitHub releases, check it against the release's `checksums.txt`, and unzip it into `tools/bin`.
  3. For `git-identity`, offer a second action: an in-app form (name + email) that runs `git config --global`. Make it required only when Git is available.

**SU-24 · Medium · The required set ignores the chosen hosting provider**
- Evidence: `netlify-cli` and `netlify-login` are always required (`setup.mjs:66-72`). Vercel and Wrangler are always optional (lines 94-101).
- Impact: a Cloudflare- or Vercel-only user always sees Netlify as missing, while their real CLI is "optional" and is skipped by auto setup.
- Fix: the required set = the CLI and login for each `hosting` value used by `listProjects()`, defaulting to Netlify when there are no projects. `setupAuto` installs the required ones and logs into them.

**SU-25 · Medium · "Open URL" items left after auto setup are never shown**
- Evidence: `setupAuto` returns `interactive`, but the app neither decodes nor shows it (`Models.swift:661-666`, `AppModel.swift:836-845`). Only `type:'terminal'` gets a `.command` file.
- Impact: after auto setup, the user doesn't learn that "GitHub CLI: Изтегли" or similar steps are still open. The message is just "Настройката приключи".
- Fix: decode `interactive`. In the overlay footer, list each one ("Остава: GitHub CLI (изтегли), Vercel вход (Terminal)") with its action button.

### E. Re-running, partial installs, logs

**SU-26 · High · Setup steps have no visible log**
- Evidence: `setupRun` writes `CACHE_DIR/setup/<id>.log` (`setup.mjs:196`) but doesn't put `log:` on the step event, so the "Пълен лог" button (`RunOverlay.swift:155`) never appears. The fail `details` hold only the last 10 lines. `auto.command` and the logs sit hidden in `~/Library/Caches`. `bid doctor` is not shown anywhere in Setup.
- Impact: when an install fails, neither the user nor support can see why, and there is nothing to send.
- Fix: add `log: path.join(setupDir(), \`${id}.log\`)` to every step event. In Setup, add "Покажи логовете" (opens the folder in Finder) and "Копирай диагностика", which runs `bid doctor` plus `setup status` plus the tails of the setup logs, redacted, onto the clipboard.

**SU-27 · Medium · No per-row retry, no "retry failed" after auto, and no refresh after a failed run**
- Evidence: `AppModel.swift:802-804` passes `{ loadSetup }` as the trailing closure, which binds to `onSuccess`, so a failed run doesn't refresh. `setupAuto` (`AppModel.swift:834`) has no `onDone`. The overlay has no Retry button.
- Impact: after a failure, rows show stale status until a manual "Обнови", and the only way to retry is to run the whole auto setup again.
- Fix: pass the refresh as `onDone:` in both calls. In the overlay, add "Опитай пак" to failed setup steps (it runs `setup run <id> --yes`) and "Опитай пак неуспешните" to the footer.

**SU-28 · Medium · Half-finished installs leave a mess behind; there is no lock against two setup runs**
- Evidence: npm into a global prefix can leave `.netlify-cli-XXXX` directories, so the next run fails with `ENOTEMPTY`. Nothing stops a CLI `bid setup auto` from running alongside the app's run. `runStream` kills on timeout, but there is no cleanup.
- Impact: a cancel or timeout in the middle of an install breaks the next attempt.
- Fix: install into `tools/.staging-<id>-<pid>`, check it, then rename it atomically to `tools/pkgs/<id>`. On failure, delete the staging directory. Take a lock at `APP_DIR/setup.lock` (pid plus start time via `processHolds`). A second run returns `code:'setup_busy'`.

**SU-29 · Medium · Setup Auto replaces the full status (with cloud rows) with the local one**
- Evidence: `setupAuto()` returns `setupStatus()` (local only, `setup.mjs:221,228`). The app sets `self.setup = r.status` (`AppModel.swift:837`).
- Impact: right after auto setup, the cloud rows disappear and the ring and counters jump to different numbers until the next refresh.
- Fix: after a run, always call `loadSetup()` (the full status), or have `setupAuto` return `setupStatusFull()`.

**SU-30 · Low · Terminal steps don't report back to the app**
- Evidence: `writeCommand` ends with "натисни „Обнови“" (`setup.mjs:165`). The app only shows a flash message (`AppModel.swift:808-810`).
- Impact: the user has to know to come back and press Refresh.
- Fix: the `.command` script ends with `open "beforeideploy://setup-refresh"` (handled in the URL scheme). Otherwise, the app reloads Setup when its window regains focus (`NSApplication.didBecomeActiveNotification`) while a terminal step is pending.

### F. Messages and UI copy (Bulgarian)

**SU-31 · High · Several Bulgarian messages are wrong or out of date**
- Evidence:
  - `setup.netlifyCli.detail` = "Без него всяка команда минава през по-бавния npx". npx was removed (`netlify.mjs:15-20`), so without the CLI, deploys are impossible.
  - `netlify.noCli` = "Не намирам Netlify CLI или npx. Инсталирай Node.js или `npm i -g netlify-cli`."
  - `setup.errorCode` = "Грешка (код {code})" gives -2, 243 or 1 with no explanation.
  - `engine.missingAt` (app) = "… Пусни install.sh." DMG users have no install.sh.
  - `setup.group.hosting` = "Hosting & GitHub" is in English.
  - `setup.autoNetlifyToo` is dead code: the app looks for `appAction == "netlify-login"` (`AppModel.swift:826,842`), which the engine never sends.
- Fix:
  - `netlifyCli.detail`: "Нужен за публикуване в Netlify".
  - `noCli`: "Netlify CLI не е инсталиран — отвори Настройка → Инсталирай".
  - Map errors to messages: ENOENT → "Липсва npm — …", EACCES → "Няма права за запис в {dir}", ETIMEDOUT/ENOTFOUND → "Няма връзка с npm", 127 → "Програмата не се стартира", and anything else → "Неуспех (код {code}) — виж лога".
  - `engine.missingAt`: "Преинсталирай приложението от DMG-то".
  - Group: "Хостинг и GitHub".
  - Remove the dead `netlify-login` appAction branch.

**SU-32 · Low · The AI Fix bar appears on failed setup steps**
- Evidence: `RunOverlay.swift:201-205` shows `AIFixBar(step: s.id)` for any `fail`, including `netlify-cli` and `gh-auth`. It works on the selected project's step logs.
- Impact: buttons such as "Оправи с AI" for an npm install error send the wrong context, and may charge credits.
- Fix: show the bar only when `session.kind` is `.check`, `.smart`, `.draft`, `.production` or `.local`. For `.fix` runs started from setup, show "Покажи лог" and "Опитай пак" instead.

**SU-33 · Low · Two browser tabs and a silently overwritten clipboard for the GitHub code; the code card stays up after login**
- Evidence: the engine writes `\n` to "Press Enter", so gh opens the browser itself (`setup.mjs:251`). The app also opens the URL and overwrites the clipboard (`RunSession.swift:135-139`). `DeviceCodeCard` hides only when the session finishes (`DomainViews.swift:363`).
- Fix: open the browser in one place only: let the app open it and don't press Enter in gh (send `\n` only after the app confirms). Mention "Кодът е копиран" in the card. Clear `deviceCode` when the `gh-auth` step reaches `pass` or `fail`.

### G. Auto-check and onboarding

**SU-34 · Medium · Auto-check on a new project immediately says "scripts changed"**
- Evidence: `checks.mjs:521-525`: when `trust` is undefined (no manual check yet), the check is refused with `scripts_changed`. The toast `autocheck.scriptsChanged` says "скриптовете… са променени" (`AppModel.swift:1137-1143`).
- Impact: a user adds a project, edits a file and gets a confusing security warning about changes they never made. After that one toast (per session), auto-check silently does nothing and nothing shows that it is paused.
- Fix: a separate code, `scripts_untrusted` (no trust yet), with the toast "Пусни първата проверка ръчно (⌘R) — после ще проверявам автоматично". Add a persistent "Автоматичната проверка е на пауза — [Провери сега]" chip in the project hero while trust is missing or outdated.

**SU-35 · Low · Auto-check failures are silent, and a hung check blocks every later auto-check**
- Evidence: `AppModel.swift:1134` uses `try? await engine.run([... "--auto"])` with no timeout. `autoChecking` guards new runs (line 1113). Errors other than `scripts_changed` are ignored.
- Impact: if the engine is broken (no_node) or a step hangs (up to 15 min per script), the spinner in the menu bar stays, and later saves never trigger a check.
- Fix: give the quiet check `timeout: 20*60`. On `no_node`, `crash` or `timeout`, show a one-time toast and set `autoCheckPausedReason`.

**SU-36 · Medium · The onboarding checklist is static and doesn't reflect setup progress**
- Evidence: `FirstStepsCard` (`OnboardingViews.swift:159-221`) has seven fixed steps with no done state. The setup hint appears whenever `!setup.ready`, which is always true because of SU-2 and SU-22.
- Impact: new users are always told tools are missing, and the list never ticks anything off.
- Fix: work out a done state per step (account signed in, `projects.count>0`, `hostingReady`, `check != nil`, …). Show "Инсталирай нужното (N)" with a direct `setupAuto()` button only when `missingRequired>0` after SU-2 and SU-22 are fixed.

**SU-37 · Low · The engine reinstall keeps a stale `env.zsh` forever, and the launcher reads user zsh rc files**
- Evidence: `EngineInstaller.swift:44-47` copies `env.zsh` forward on every update. `Engine.swift:121` runs `/bin/zsh <launcher>` without `-f`, so `~/.zshenv` is sourced.
- Impact: a PATH captured months ago (for example an nvm version since deleted) replaces the live one. A noisy or slow `.zshenv` slows down or pollutes every engine call.
- Fix: treat `env.zsh` as a hint and merge it (append) rather than replace. Refresh it from the login shell when Setup's "Обнови" is pressed. Use `/bin/zsh -f`.

---

## Target setup flow (spec)

### 0. Principles
- No sudo, ever. All tools the app installs go to `~/Library/Application Support/BeforeIDeploy/tools/` (`bin/`, `pkgs/`, `.staging-*`). Engine updates never touch `tools/`.
- One PATH, computed only in the launcher, in this order:
  1. `tools/bin`
  2. `env.zsh` / the captured login PATH
  3. the standard directories (`~/.volta/bin`, `~/.asdf/shims`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.bun/bin`, `~/.local/bin`, `~/Library/pnpm`, `~/.npm-global/bin`, the nvm default `bin`)
  4. `/usr/bin:/bin:/usr/sbin:/sbin`
  5. the bundled `runtime/<arch>/bin` (node, npm, npx), last
- A row is "ok" only after the tool has actually run (`--version` exit 0), never just because `which` found it.
- Every step that starts must end in exactly one of: `pass`, `fail`, `skipped`, `blocked`. The result is `ok:false` (`code:'setup_incomplete'`) if any required step is not `pass`.

### 1. Item model (`bid setup status`)
```
{ id, group, title, required: bool, state, detail, reason?, action?, log?, version?, path? }
state ∈ ok | missing | broken | needs_login | blocked | waiting_user | unknown_offline | installing
action.type ∈ install | login | terminal | open | form | app
```

Required set:
- `runtime` (always ok when bundled)
- `npm` (ok when bundled npm exists)
- one hosting CLI + login per hosting provider in use (default Netlify)
- `git` + `git-identity` only when GitHub is turned on or a project has `.git`

Optional: gh / gh-auth (required only when GitHub Pages is used), brew, vercel, wrangler, codex, claude, spaceship, and cloud rows. Cloud rows are visible only to admins or for a custom cloud.

Detection rules:
- `git`: SU-6 (never run the `/usr/bin` shim when `xcode-select -p` fails).
- gh login: `gh auth token`, which works offline.
- Netlify login: the config file (as today).
- Anything that needs the network and can't be checked → `unknown_offline`, not counted.

Performance: each check runs async with a 5 s limit; the whole call finishes in ≤ 6 s, plus 5 s for cloud rows when they are shown.

### 2. Preflight (`bid setup auto`, step `preflight`)
1. Take `APP_DIR/setup.lock`. If another run holds it, return `setup_busy`.
2. Probe the network with HEAD requests to `https://registry.npmjs.org/-/ping`, `https://github.com`, `https://api.netlify.com` (5 s each, in parallel).
3. Check free disk space in `tools/`; at least 1.5 GB is needed.
4. Emit `preflight pass` with the summary "Онлайн · 23 GB свободни", or `fail` / `skipped` with reasons.

If offline, every install and login step becomes `skipped` with `reason:'offline'`. The result is `ok:false, code:'offline'`. UI: "Няма интернет — нищо не е променено. [Опитай пак]".

### 3. Step order and commands

| # | id | Runs when | Command / mechanism | Timeout | Success check |
|---|----|-----------|---------------------|---------|---------------|
| 1 | `clt` | git required and `xcode-select -p` fails | `xcode-select --install` (spawn, no Terminal), then poll `xcode-select -p` every 10 s; state `waiting_user` | 30 min, user can cancel | `xcode-select -p` and `xcrun --find git` |
| 2 | `npm` | bundled npm missing and no user npm | fail: "повреден пакет на приложението — преинсталирай" | n/a | `npm --version` |
| 3 | `<host>-cli` (netlify-cli, vercel, wrangler) | missing or broken | `npm install --prefix tools/.staging-<id> --no-audit --no-fund --loglevel=http --progress=false --fetch-timeout=60000 --fetch-retries=2 <pkg>@<pinned>`, then atomic rename to `tools/pkgs/<id>` and symlinks to `tools/bin` | 6 min, 5 s heartbeat | `<bin> --version` within 15 s |
| 4 | `gh` | required/selected and missing | brew if present (`brew install gh`, 6 min); else download the release zip, check sha256 against `checksums.txt`, unzip into `tools/bin` | 3 min | `gh --version` |
| 5 | `<host>-login` | CLI ok and not logged in | netlify: `netlify login`, with the URL parsed and sent as `devicecode` (url only); state `waiting_user` with a countdown | 5 min, then SIGTERM, SIGKILL after 5 s | config token present |
| 6 | `gh-auth` | gh ok and token missing | `gh auth login --web …` with the code sent to the app; the app alone opens the browser | 5 min | `gh auth token` |
| 7 | `git-identity` | git ok and name/email missing | from GitHub if gh-auth passed; else `waiting_user` with an in-app form | — | `git config --global user.email` not empty |

Dependency rule: when a step fails, every step that depends on it becomes `blocked` with the reason "Изисква: <title>". It is never run.

Error mapping (scan the log tail): `ENOENT` → npm/binary missing; `EACCES` → retry once in the managed prefix, then "Няма права за {dir}"; `ETIMEDOUT|ENOTFOUND|EAI_AGAIN` → offline; `ENOSPC` → disk full; 127 → "не се стартира (липсва node?)". Each summary is one Bulgarian sentence plus "[Покажи лог]".

### 4. Event contract
- `step` events carry `id`, `label`, `status`, `summary`, `log` (absolute path), `elapsed`, and `reason` for skipped or blocked steps.
- A heartbeat `step` event is sent every 5 s while a step runs, with "… 1:20".
- `devicecode` is `{service, code|null, url, expiresIn}`.
- The final `result.data` is `{ steps:[{id,status,reason}], installed, failed, blocked, interactive, status: <full status> }`.

### 5. UI per state

**Setup screen rows:**
- ok: green check, version/path.
- missing: "Инсталирай".
- broken: amber, "Поправи" (reinstall).
- needs_login: "Вход".
- blocked: grey, "Първо: X".
- unknown_offline: grey cloud icon, "Не мога да проверя — няма връзка".
- installing: spinner with elapsed time.
- waiting_user: pulsing dot, "Чакам те в браузъра / в прозореца на macOS", with "Отвори пак" and "Готово съм".

Header: the ring counts **required** rows only. "Настрой всичко" is disabled while `ready`, offline or busy. Also on the header: "Покажи логовете", "Копирай диагностика", and "Обнови" (re-captures the login PATH).

**Overlay:**
- Steps on the left, each with status and elapsed time. Log on the right, with "Пълен лог".
- The device card shows the code (or only the URL for Netlify), "Отвори пак", and a countdown.
- Footer while running: "Стъпка 3/6 · Netlify CLI · 1:20", and Cancel.
- Footer when finished:
  - all required steps pass: green, celebration, "Всичко задължително е готово".
  - partial: amber, no celebration, "Готово 3 от 5 — неуспешни: Netlify CLI (няма права)", "[Опитай пак неуспешните]", plus a list of what is left (interactive) with an action button each.
  - offline: grey, "Няма интернет — нищо не е променено".
- No AI Fix bar for setup runs.

**Banner and FirstSteps:** shown only when `missingRequired > 0` after the fixes. The button runs auto setup directly.

### 6. Recovery
- Idempotent: rows already ok are skipped, staging directories are cleaned at start, and the lock is released in `finally` and also on SIGTERM.
- Cancel kills every child, including gh (SIGTERM, then SIGKILL after 5 s), deletes staging, and marks the current step `skipped` ("Прекъснато").
- After any run, success or not, the app calls `loadSetup()` (full status).
- Terminal or `.command` steps end with `open beforeideploy://setup-refresh`. The app also refreshes when it becomes active while a Terminal step is pending.
- Logs: `CACHE_DIR/setup/<id>.log`, keeping the last 5 per id. `bid report` includes them, redacted.

### 7. App-side timeouts
- `setup status`: 30 s.
- `setup run <id>`: the step budget + 60 s.
- `setup auto`: 40 min overall.
- After the engine exits, the stdout reader closes within 2 s (SU-13).
- The quiet check: 20 min.

### 8. Auto-check
- No trust yet → `scripts_untrusted`. The hero chip says "Автоматичната проверка ще започне след първата ти ръчна проверка (⌘R)".
- Changed scripts → `scripts_changed`. The chip lists the changed files and offers "Провери и одобри".
- Engine-level errors pause auto-check with a visible reason; it is never silent.

### 9. Acceptance matrix (manual plus `tests/run.mjs` with `env -i PATH=/usr/bin:/bin`)
1. Fresh macOS 15 on Apple Silicon (no brew, no CLT, no Node, no git), online: auto setup ends green for the Netlify-only required set in under 6 min. The CLT dialog appears only if Git/GitHub is turned on. No Node download is asked for.
2. The same Mac offline: the result appears within 15 s with `code:'offline'`, nothing turns green, and there is no 10-minute wait.
3. A nodejs.org Node in `/usr/local` that is root-owned: no EACCES reaches the user, and the CLI installs into `tools/`.
4. Cancel during the npm install, then re-run: it installs cleanly with no ENOTEMPTY.
5. The user ignores the GitHub browser login: the step fails after 5 min, git-identity is `blocked`, and there is no second login.
6. Homebrew installed through Terminal, then "Обнови": brew is detected without restarting the app.
7. Every pre-announced step ends in a final state, and the progress bar reaches 100%.
8. Setup refresh never opens the "install command line developer tools" dialog.
