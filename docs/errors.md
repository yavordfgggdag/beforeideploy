# Error codes

Every failure the engine reports carries a stable `code` (`EngineError.code`, also the `code` field of the
`result` line in the NDJSON protocol). The app shows the code next to the message and, when the cloud
settings define `help.url`, links to `<help.url>/<code>`. `scripts/error-codes.mjs` (CI) fails when a code
is raised but not listed here, or listed but no longer raised. Exit codes: 2 usage / confirmation, 3
blocked · stale · forbidden, 4 not linked, 5 not logged in, 6 Spaceship, 7 cloud not configured, 8 AI
quota, 127 Node missing; everything else exits 1.

## Engine

| Code | Exit | Meaning | What to do |
|---|---|---|---|
| `usage` | 2 | A command got wrong or missing arguments. | Only reachable from the CLI; the app always passes complete arguments. `bid help` lists the commands. |
| `confirm_required` | 2 | A production deploy, an account deletion, a paid setup step or a fix needs its confirmation word (`DEPLOY`, `DELETE`, `--yes`). | Type the word in the sheet; the engine refuses silently otherwise. |
| `blocked` | 3 | The last check ended BLOCKED — deploying would publish a broken site. | Open the failed step, fix it (AI Fix or by hand) and check again. |
| `stale_check` | 3 | Files changed after the last check, so its result no longer describes the working tree — or the staged files to publish differ from the manifest the check recorded. | Run the check again (⌘R). |
| `scripts_changed` | 2 | An automatic check (`check --auto`, the app's file watcher) found changed project scripts or executable configs since the user last started a check. Nothing ran. | Start the check yourself once; that approves the scripts as they are. |
| `secret_in_argv` | 2 | A secret was given as a command-line flag (`--password`, `--access`, `--refresh`, `--key`, `--secret`, `--token`). Refused before anything happened. | Pass it through the environment variable the message names. |
| `needs_check` | 3 | No check has been run for this project yet. | Run the check first. |
| `forbidden` | 3 | The account's role or plan does not allow the action (Admin panel, Deep fix, cloud sync…). | An admin can change the role or plan; plans come with WP4. |
| `not_linked` | 4 | The project is not linked to a site on its hosting yet. | Use Smart Deploy: it creates or links the site on the first run. |
| `not_logged_in` | 5 | The action needs an account session (sync, Admin, cloud AI, export…). | Sign in from the sidebar badge. |
| `spaceship_error` | 6 | The Spaceship API returned an error for a DNS or domain operation. | The message carries Spaceship's text; check the domain in Spaceship and retry. |
| `not_configured` | 7 | No cloud (Supabase) is configured on this Mac. | Owner: Cloud setup screen (URL + anon key). Users normally never see this — the config ships with the app. |
| `quota_exhausted` | 8 | The monthly AI credits are used up. | Wait for the renewal date shown in the message, buy a pack (WP4) or use the external AI buttons. |
| `exists` | 1 | `bid new` would overwrite a folder that already exists. | Pick another site name or parent folder. |
| `network` | 1 | A server (Supabase, hosting, registrar, AI, release feed) could not be reached. | Check the connection, VPN or proxy and retry; the app keeps working offline. |
| `auth_error` | 1 | Supabase Auth refused the request: wrong email or password, unconfirmed email, expired link. | Read the message; "Forgot your password?" sends a new link. |
| `weak_password` | 1 | The password is shorter than 8 characters. | Choose a longer password. |
| `rest_failed` | 1 | A cloud table request failed (RLS, schema not applied, network mid-request). | Owner: check `supabase/schema.sql` is applied; users: retry, then send a support report. |
| `sync_failed` | 1 | Cloud sync of the project list failed. | Retry from the account menu; local projects are never lost. |
| `account_failed` | 1 | The `account` Edge Function (export / delete) returned an error. | Retry; owner: `supabase functions deploy account`. |
| `email_not_confirmed` | 1 | Supabase Auth refused the sign-in because the address was never confirmed. | "Send the confirmation again" on the sign-in screen; owner: Supabase's built-in mailer reaches only the project's team, so turn "Confirm email" off or set up SMTP (docs/CLOUD-SETUP-BG.md). |
| `cloud_function_missing` | 1 | An Edge Function the engine called is not deployed on the cloud project (`Requested function was not found`). | Owner: GitHub → Actions → cloud-deploy, or `supabase functions deploy <name>`; Setup → Cloud lists the missing ones. |
| `subscription_active` | 1 | Account deletion was refused because a paid subscription is still running and the cloud cannot cancel it. | Cancel it in Plans → Manage subscription, then delete the account again. |
| `billing_failed` | 1 | A billing request failed: item not on sale, trial already used, no subscription, payments not set up, or the provider did not answer. | The message says which; the plans screen shows only what can be bought. |
| `admin_failed` | 1 | The `admin` Edge Function returned an error. | The message has the server's text; owner: function deployed and caller is `admin`? |
| `aikey_failed` | 1 | Storing or checking an AI key in the Keychain failed. | Retry; if Keychain prompts appear, allow BeforeIDeploy. |
| `unauthorized` | 1 | The provider rejected the credentials (AI key, Spaceship key). | Re-enter the key; for Spaceship also check the API secret. |
| `ai_unavailable` | 1 | Built-in AI Fix is not available for this account: no plan, no own key for the role, or AI disabled. | VIP/admin: add an Anthropic or OpenAI key in Setup; normal users: a plan (WP4); the external AI buttons always work. |
| `ai_rate_limited` | 1 | Too many AI requests in a minute or hour (cloud limit, or the provider's). | Wait a minute and retry. |
| `ai_session_cap` | 1 | The rolling 5-hour session used its share of the monthly credits (20 %). | Wait for the reset time in the message, buy a pack or change the plan; the external buttons stay free. |
| `ai_failed` | 1 | The AI provider returned an error or an unusable stream. | Retry; if it repeats, the support report has the response. |
| `ai_refused` | 1 | The model declined to answer (safety refusal). | Rephrase by fixing the prompt's log manually, or use an external assistant. |
| `bad_patch` | 1 | The saved AI answer does not belong to this project or has no applicable file changes. | Run AI Fix again; apply only from the panel it produced. |
| `fix_failed` | 1 | An automatic fix (git init, untrack secrets, deps install, GitHub repo…) failed. | The message has the command output; fix by hand and check again. |
| `ui_action` | 1 | This fix opens a panel in the app and cannot run from the CLI. | Use the app's button for it. |
| `install_failed` | 1 | Installing a tool from Setup failed (Homebrew, npm). | Run the shown command in Terminal to see the full output. |
| `not_runnable` | 1 | The Setup item has no automatic action. | Follow the manual instructions of the item. |
| `login_failed` | 1 | Signing in to a hosting CLI (Netlify, Vercel, Cloudflare, GitHub) failed or was cancelled. | Retry; the browser must finish the login. |
| `github_failed` | 1 | The GitHub CLI returned an error (repo creation, auth). | `gh auth status` in Terminal; retry. |
| `git_failed` | 1 | A Git command failed (commit, push, fetch). | The message has Git's output; usually a conflict or missing upstream. |
| `no_repo` | 1 | The project folder is not a Git repository. | Use the "Initialize Git" fix on the dashboard. |
| `no_remote` | 1 | The repository has no remote (`origin`). | Add one from the Git panel (create the repo on GitHub or paste a URL). |
| `prompt_not_found` | 1 | An assistant prompt resource (`engine/prompts/<id>.v<n>.json`) is missing — broken engine install. | Reinstall the engine (Settings → Engine → Reinstall). |
| `prompt_input_missing` | 2 | The engine tried to render an assistant prompt without one of its declared inputs. | Report it; the prompt files and `assistant.mjs` disagree. |
| `bad_path` | 2 | `ai chat --files` named a file outside the project, in a protected folder, or through a symlink. | Select files inside the project. |
| `secret_file` | 2 | `ai chat --files` named a secret file (`.env*`, keys, certificates). Secrets are never sent to a model. | Select source files; describe the configuration in the message instead. |
| `budget_exceeded` | 1 | The assistant operation would exceed its token budget (AI settings → max tokens per operation). | Reduce the selected files or raise the budget. |
| `ai_timeout` | 1 | The AI provider did not answer within the call timeout (default 120 s). Nothing was changed. | Try again; check the provider status. |
| `monitor_cloud_failed` | 1 | The `monitor` Edge Function refused or failed a cloud-monitoring call (the message carries the cloud's reason). | See the message: sync the project, deploy first, or check the function deployment. |
| `webhook_rejected` | 2 | The notification webhook URL is not https, uses an IP literal / local name / credentials, or resolves to a private address. | Use the public https URL your chat tool gave you. |
| `pushover_rejected` | 2 | Pushover did not accept the user key + application token pair (wrong format, or Pushover's validate call answered with an error). Nothing was stored. | Copy the user key from pushover.net and the API token of an application you created at pushover.net/apps/build. |
| `rate_limited` | 1 | A cloud function refused the call: too many of this kind for this account in its window (checkout / portal / sync 5 per minute, monitor test 10 per minute, register 120 per hour, export 3 per hour, admin writes 60 per minute), or it could not check the limit. | Wait for the window; nothing was charged or changed. |
| `nothing` | 1 | Nothing to do: no failing steps for AI Fix, no setup items, no new version. | Informational. |
| `missing_cli` | 1 | A CLI this action needs is not installed (`gh`, an AI CLI, …). | Setup installs it. |
| `no_cli` | 1 | The hosting CLI for the selected provider is missing (`netlify`, `vercel`, `wrangler`). | Setup installs it. |
| `no_build` | 1 | No build output in the publish folder. | Run the check (it builds), or check the framework's output folder. |
| `unsupported` | 1 | The action is not possible for this project on this hosting (SSR on Cloudflare/GitHub Pages, draft on GitHub Pages…). | Pick a hosting from the advice card that supports the project. |
| `deploy_failed` | 1 | The hosting CLI failed during deploy. | The log has the details; usually a build or auth problem. |
| `release_in_progress` | 3 | Another release (or rollback) of this project is still running in another engine process. | Wait for it, or check Release status: a dead process is detected and its release marked interrupted. |
| `release_not_ready` | 3 | `release promote`/`cancel` was called for a release that is not awaiting confirmation. | Run `release preview` again; a finished release cannot be promoted twice. |
| `stale_release` | 3 | The source or the build output changed after the preview was smoke-tested, so it can no longer be promoted. | Run the preview again — production only ever publishes what was verified. |
| `release_unsupported` | 3 | A server-rendered project on a provider that rebuilds from source: the release flow has no way to prove that production is the checked build. | Use Netlify (the preview deploy is published by id) or a static build output; `bid deploy` still works and says the same. |
| `smoke_failed` | 1 | The preview deploy does not answer correctly (status, missing title, redirect off-site, timeout). | Open the smoke log in the release, fix the page, run the preview again. |
| `netlify_failed` | 1 | The Netlify CLI or API returned an error. | Read the message; `netlify status` in Terminal helps. |
| `local_failed` | 1 | Local Preview could not start (port, build, dev server). | The log shows the server output; stop other servers on the port. |
| `no_server` | 1 | Local Preview is not running. | Start it (⌘L). |
| `not_connected` | 1 | Spaceship is not connected (no API key on this Mac). | Domains → Connect Spaceship. |
| `no_site` | 1 | The domain cannot be connected: the project has no live site yet. | Deploy to production first. |
| `not_found` | 1 | The project folder no longer exists, or a record is missing. | Re-add the project or remove it from the list. |
| `update_failed` | 1 | The release feed could not be read or the download failed. | Retry later; the feed URL comes from the cloud settings. |
| `update_corrupt` | 1 | The downloaded DMG does not match the published sha256. | Download again; never open a DMG that fails this check. |
| `error` | 1 | An unexpected failure without a specific code. | The message and the engine log (support report) describe it. |

## App

| Code | Meaning | What to do |
|---|---|---|
| `missing` | The engine (Node script) is not installed at the expected path, or Node.js is missing. | Run the installer again; install Node.js (nvm, Volta or Homebrew). |

## Cloud (Edge Functions)

Returned as `code` in the JSON body; the engine maps them to the codes above (`quota_exhausted`,
`ai_rate_limited`, `ai_session_cap`, `ai_unavailable`, `forbidden`, `not_configured`).

| Code | HTTP | Meaning |
|---|---|---|
| `no_profile` | 403 | Valid session but no `profiles` row — the signup trigger did not run. |
| `disabled` | 403 | An admin disabled AI for this account. |
| `no_plan` | 403 | Normal user on the Free plan asked for cloud AI. |
| `forbidden` | 403 | Admin function called by a non-admin. |
| `session_cap` | 403 | The 5-hour session's AI credit share is used; the body carries `resetsAt`, `cap`, `spent`. |
| `quota_exhausted` | 402 | No credits left. |
| `bad_secret` | 401 | `monitor` scheduler call without the `x-monitor-secret` that matches `MONITOR_CRON_SECRET` (V11 RC). |
| `url_rejected` | 400 | `monitor register`: the URL is not a public http(s) hostname (`reason`: scheme, ip_literal, local_host, credentials_in_url, port, hostname, invalid_url). |
| `project_not_synced` | 404 | `monitor register`: the project has no `bid_projects` row for this user yet — sign in and let the app sync the project first. |
| `not_owner` | 403 | `monitor register`: the URL's host is not the project's live host / domain as the cloud knows it (`known` lists them). |
| `not_registered` | 404 | `monitor test`: no target registered for this project. |
| `rate_limited` | 429 | More than 6 requests a minute or 60 an hour. |
| `prompt_too_long` | 413 | Prompt plus system prompt above `ai.promptMaxChars` (60 000 by default) + 8 000. |
| `model_error` | stream | The model reported an error mid-answer; what was produced is billed, the details are in the function log. |
| `interrupted` | stream | The answer broke off (network or the app closed it); only what was produced is billed. |
| `unknown_setting` | 400 | Admin → Global settings: a key outside the allowed list (see `SETTINGS_KEYS` in `admin/handler.ts`). |
| `upstream` | 502 | The model API failed (network or 5xx). |
| `invite_failed` | 409 | Supabase refused the invitation (the email is already registered, or SMTP is not set up). |
| `bad_signature` | 401 | A billing webhook without a valid Paddle signature (not from Paddle, or a wrong `PADDLE_WEBHOOK_SECRET`). |
| `not_available` | 409 | Checkout for a plan or pack that has no Paddle price id in `billing.catalog`. |
| `trial_used` | 409 | The one-time trial was already used (or the account has paid before). |
| `no_subscription` | 404 | Customer portal asked for an account without a Paddle customer. |
| `provider_error` | 502 | The Paddle API answered with an error or without the expected URL. |
| `not_configured` | 500 / 503 | `ANTHROPIC_API_KEY` (ai-fix) or `PADDLE_API_KEY` (billing) secret is missing on the function. |

| `internal` | 500 | An unexpected server error; details stay in the function log (`internalError`), the client gets only this code. |
| `rate_limited` | 429 | The shared per-user limit for this action is reached (`bid_rate_hit`, schema.sql). |
| `rate_limit_unavailable` | 503 | The limit could not be checked (database error). The call is refused rather than skipping the limit; a database without the function (schema not updated) lets calls through and logs it. |