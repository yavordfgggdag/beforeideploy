# Before I Deploy — пълен одит на приложението (V9.0.0)

Дата: 27.09.2026 · Автор на одита: Claude · Предназначение: контекст за Codex при надграждане към V10.

Този документ описва какво представлява приложението, как е устроено, всяка функция която има, какви инварианти трябва да се пазят, известните слабости и къде е най-разумно да се надгражда. Написан е така, че AI агент или разработчик без предишен контекст да може да работи по кода веднага.

---

## 1. Какво е приложението

**Before I Deploy** е macOS „control center" за уеб проекти на един самостоятелен уеб разработчик (сайтове за малки бизнеси). Целта му е: преди всеки deploy да провери проекта (Git, secrets, зависимости, lint, typecheck, build, hosting), да пусне локален preview, да направи draft или production deploy на избран хостинг, да управлява домейни и DNS, да показва разходи и кредити по акаунти, и при грешка да отвори с един бутон чат в ChatGPT/Claude/Codex с готов, редактиран (без secrets) prompt за поправка.

Философия на продукта, която трябва да остане:

- **AI само мисли и поправя; приложението прави всичко останало.** AI Fix бутонът подготвя prompt, но не изпълнява нищо сам.
- **Production е ръчен и защитен.** Production deploy изисква потребителят да напише `DEPLOY`. Няма Netlify CI — всичко минава през приложението.
- **Кредитите са пари.** Draft preview е безплатен; production харчи Netlify кредити. Всяка операция има цена в ценоразписа и се записва в ledger.
- **Secrets никога не напускат Mac-а.** Токени за Netlify/Vercel/GitHub/Spaceship и сесията на акаунта стоят в macOS Keychain. В облака (Supabase) се синхронизират само метаданни на проектите.
- **Всичко, което може да е автоматично, е автоматично.** Setup екранът има бутон за всеки инструмент; GitHub login е с device code; Git име и имейл се вземат от GitHub автоматично.
- **Дизайн:** тъмна тема, системно синьо (`systemBlue`, градиент `#3B9CFF → #0A6EF0`), подредени карти, минимален шум. Целият UI е на български.

Приложението ще се продава и дава на приятели, затова: multi-account (Supabase Auth), cloud конфигурацията е bundled в `engine/cloud.json`, и всеки потребител вижда само своите редове (RLS).

---

## 2. Архитектура

```
┌──────────────────────────────┐        zsh engine/bid <cmd> …        ┌──────────────────────────────┐
│ SwiftUI приложение (macOS 13+)│ ───────────────────────────────────▶ │ Node ESM engine (bid.mjs)     │
│ ~/Applications/Before I       │ ◀─────────────────────────────────── │ ~/Library/Application Support/│
│ Deploy.app                    │   NDJSON по stdout (step/log/notify/ │ BeforeIDeploy/engine          │
│                               │   devicecode/result), exit code      │                               │
└──────────────────────────────┘                                      └──────────────┬───────────────┘
        │ URL scheme beforeideploy://                                                 │ spawn
        │ (auth-callback, open project)                                              ▼
        │                                                     netlify · vercel · wrangler · gh · git · npm/pnpm/yarn/bun
        │                                                     codex · claude · security (Keychain) · curl-free fetch()
        ▼
  Supabase Auth + REST (само метаданни)        Spaceship API (домейни/DNS)        Netlify API (custom_domain)
```

Двата слоя са напълно разделени. **Engine-ът е самостоятелен CLI** и може да се тества и ползва без приложението (`bid …`). Приложението е тънък клиент: стартира engine процеси, чете NDJSON събития и ги рисува.

### 2.1 Протокол engine ↔ app (NDJSON)

Всеки ред на stdout е JSON обект с поле `type`:

| type | Полета | Смисъл |
|---|---|---|
| `step` | `id, label, category, status (running/pass/warn/fail/skipped), summary, details[], fixes[], log, duration` | Прогрес на стъпка; повторен `id` обновява реда |
| `log` | `step, line` | Ред от лог (стриймва се в overlay-а) |
| `notify` | `title, body, url` | macOS нотификация |
| `devicecode` | `code, url` | GitHub device-code login — показва се карта с кода |
| `result` | `ok, data \| error, code` | **Винаги последен ред.** Единственият ред, който приложението декодира като резултат |

Exit codes: `0` ok · `2` usage / липсва confirm · `3` blocked или stale check · `4` проектът не е linked · `5` не си влязъл (Netlify/акаунт) · `6` Spaceship не е свързан · `7` облакът не е конфигуриран · `127` няма Node.

Важно: човешките текстове в `error` и в `step` идват от каталога `engine/i18n/<lang>.json` на езика от `BID_LANG` (fallback en; приложението подава `bg`, докато няма избор на език); приложението ги показва директно. При грешка `result` носи и `key` (+ `params`), за да може приложението да превежда самостоятелно. (V10 WP1)

### 2.2 Къде живеят данните

| Какво | Път |
|---|---|
| Engine (инсталирано копие) | `~/Library/Application Support/BeforeIDeploy/engine/` (+ `env.zsh` с PATH от терминала на потребителя) |
| Проекти | `…/BeforeIDeploy/projects.json` |
| Състояние по проект (check, local, lastDraft, lastProd) | `…/BeforeIDeploy/state/<key>.json` |
| История | `…/BeforeIDeploy/history.jsonl` |
| Ledger на разходите | `…/BeforeIDeploy/ledger.jsonl` |
| Бюджети, ценоразпис, cloud override, Spaceship кеш | `budgets.json`, `prices.json`, `cloud.json`, `spaceship-cache.json` |
| Логове | `~/Library/Caches/BeforeIDeploy/<key>/{check,build,deploy,local,fix}.log`, `…/setup/` |
| Secrets | macOS Keychain, service `BeforeIDeploy`, accounts: `session`, `spaceship` (fallback: 0600 файл само без `security`, т.е. в тестове на Linux) |
| Launcher за Shortcuts | `…/BeforeIDeploy/launcher/launch.zsh` |

Env override-и за тестове: `BID_APP_DIR`, `BID_CACHE_DIR`, `BID_NO_KEYCHAIN=1`, `BID_NO_BUNDLED_CLOUD=1`, `BID_SUPABASE_URL/ANON_KEY`, `BID_SPACESHIP_API`, `BID_CLIENT=app`, `BID_LANG` (език на съобщенията на engine-а; тестовете ползват `en`).

### 2.3 Файлова структура

```
engine/
  bid                    zsh launcher: PATH (Homebrew, volta, bun, pnpm, nvm), после exec node src/bid.mjs
  cloud.json             bundled Supabase URL + publishable key (продуктовият облак)
  src/
    bid.mjs        312   entrypoint, dispatch на командите, HELP, statusSnapshot
    util.mjs       319   APP_DIR/CACHE_DIR/ENGINE_DIR, EngineError, emit/ok/fail, sh, runStream (стрийм + лог + timeout), портове, JSON helpers, parseArgs
    store.mjs      151   projects.json, state/, history.jsonl
    detect.mjs     158   framework, package manager, scripts, publishDir, ssr, git, netlify link
    checks.mjs     370   7 стъпки + secrets scanner (11 regex-а) + overallStatus
    fixes.mjs      226   безопасни авто-поправки (list/apply)
    local.mjs      177   Local Preview (static server / preview / dev), PID state, порт
    static-server.cjs 71 мини статичен сървър със SPA fallback
    git.mjs        109   status/fetch/commit/push/remote
    netlify.mjs    228   auth/login/teams/sites/info/link/create/deploy + deployGuard
    hosting.mjs    289   PROVIDERS, advisor, setHosting, deployProject (netlify/vercel/cloudflare/ghpages)
    spaceship.mjs  183   API клиент, connect/disconnect, домейни, DNS, connect-domain към Netlify
    account.mjs    192   Supabase Auth (signup/login/recover/oauth/refresh/logout) + syncProjects
    aifix.mjs      232   redacted prompt, ChatGPT/Claude URL, .command файлове за Codex/Claude Code
    costs.mjs      210   ценоразпис, ledger, реален Netlify usage, бюджети
    setup.mjs      257   status на инструментите, run/auto/terminal, gh device login, git identity
    overview.mjs   137   Mission Control: карти, uptime, SSL дни, „изисква внимание"
    secrets.mjs     48   Keychain wrapper
App/
  Package.swift, Info.plist (bundle bg.yavor.beforeideploy, URL scheme beforeideploy)
  Sources/BeforeIDeploy/
    BeforeIDeployApp.swift  App + AppDelegate (dark, URL open, меню и shortcuts)
    AppModel.swift     810  единствен ObservableObject — цялото състояние и всички действия
    Engine.swift       146  EngineClient.run/call, NDJSON парсер, ResultEnvelope
    RunSession.swift   131  модел на активна операция (стъпки, логове, device code)
    Models.swift       507  всички Codable модели, 1:1 с JSON-а на engine-а
    RootView.swift     191  auth gating, sidebar+content, toast, palette overlay, welcome/engine-missing
    SidebarView.swift  227  навигация, проекти, ⌘K бутон, AccountBadge, футър
    DashboardView.swift 604 проект: header, табове, HeroCard (статус + Провери/Smart Deploy/Production), HealthGrid, FixesCard, HistoryStrip
    Panels.swift       285  LocalCard, GitCard, NetlifyCard
    Sheets.swift       583  Production (DEPLOY), NetlifySetup, Commit, Remote, FixConfirm, History, Settings
    RunOverlay.swift   299  модал за операция: стъпки, лог, AI Fix бар, device code
    V7Views.swift      630  MissionControlView, CostsView, SetupView, AIFixBar, KPITile
    V9Views.swift      570  AuthView, CloudSetupView, AccountBadge, HostingChooserCard, GenericHostingCard, CommandPalette
    DomainViews.swift  382  DomainsView, SpaceshipConnect, DomainProjectCard, ConnectDomainSheet
    Theme.swift        303  палитра, Card, Chip, StatusDot, BIDButtonStyle, BIDTextField, Fmt
    LocalState.swift    27  @Local — заместител на @State (CLT build без макро плъгини)
    Notifier.swift      58  UNUserNotificationCenter
scripts/
  install.sh   инсталация: проверка на средата → копира engine → тестове → swift build → .app → ~/Applications → lsregister → launcher
  build.sh     сглобява .app бандъла, икона, ad-hoc подпис
  launch.zsh   за Shortcuts: отваря приложението
  uninstall.sh
supabase/schema.sql   таблица bid_projects + RLS
tests/run.mjs   547   40 интеграционни теста с mock Supabase (:4798) и mock Spaceship (:4799)
Install Before I Deploy.command / Rebuild.command   двойно-кликаеми за потребителя
```

---

## 3. Пълен списък на функциите

### 3.1 Проекти (`store.mjs`, `detect.mjs`)

- **Добавяне на проект** от папка (`bid project add --path`). Ключът е детерминистичен hash от пътя. При добавяне се пуска `detect`.
- **Detect**: framework (next, nuxt, remix, sveltekit, astro, vite, cra, gatsby, eleventy, static…), package manager по lockfile (npm/pnpm/yarn/bun), скриптове, publishDir (от `netlify.toml`/конфиг/подразбиране за framework), `ssr` флаг за SSR frameworks, дали е git repo, Netlify link (`.netlify/state.json`).
- **Списък / премахване / touch / преименуване.**
- **Status snapshot** (`bid status`) — бърз, без мрежа: project, detect, git, local, check, lastDraft, lastProd, fixes, hosting.

### 3.2 Проверка преди deploy (`checks.mjs`)

Седем стъпки, всяка емитва `step` събития и пише лог:

1. **Git** — repo ли е, чисто ли е working tree, branch, ahead/behind.
2. **Secrets** — сканира файлове (без node_modules/dist/.git) с 11 regex-а: AWS, Stripe live, GitHub token/PAT, Slack, private key, OpenAI/Anthropic, Google API, Netlify, Discord bot, Supabase service key; проверява дали `.env*` е проследен в Git и дали `.gitignore` го покрива. Стойностите се маскират в изхода.
3. **Зависимости** — има ли `node_modules`, съответства ли на lockfile; предлага fix `deps.install`.
4. **Lint** — пуска `lint` скрипт ако има; иначе `info`.
5. **Typecheck** — `typecheck`/`tsc --noEmit` ако има TS; иначе `info`.
6. **Build** — production build с package manager-а, стриймва лога, timeout; резултат в `build.log`.
7. **Hosting** — според избрания доставчик: CLI инсталиран, влязъл, проектът linked.

`overallStatus`: `ready` / `warnings` / `blocked`. Резултатът се пази в state с timestamp; **deploy изисква check не по-стар от 25 минути** (иначе „stale", exit 3).

### 3.3 Безопасни авто-поправки (`fixes.mjs`)

`fix list` връща приложимите за проекта; `fix apply ID --yes` изисква явно потвърждение. Списък: `gitignore.create`, `gitignore.env` (защитава .env и служебните папки), `env.untrack` (`git rm --cached`, файлът остава на диска), `git.init`, `deps.install`, `github.create` (`gh repo create --private --source .`), `netlify.link`. Всяка поправка е идемпотентна и се записва в историята.

### 3.4 Local Preview (`local.mjs`, `static-server.cjs`)

- Режими `auto | build | dev`. `auto`: ако има build output → статичен сървър от `publishDir` (със SPA fallback); иначе `preview`/`start`/`dev` скрипт с порт и host 127.0.0.1.
- Свободен порт 4173–4300 (проверка bind **и** HTTP, за да не се хване „сирак"); детектира ако dev сървърът е избрал друг порт от лога.
- Процесът е detached, PID + URL в state; `stop` праща SIGTERM към process group, после SIGKILL. `status`, `restart`.
- При неуспех: последните 20 реда от лога отиват в `step.details`, грешката съдържа първия ред с „error" от лога. Приложението показва RunOverlay с лога и AI Fix бутоните.

### 3.5 Git (`git.mjs`)

`status` (branch, changed files с тип, ahead/behind, последен commit, remote URL), `fetch`, `commit` (всички или избрани файлове, `--files-json`), `push` (ясна грешка без remote), `remote` (нормализира `owner/repo` и `git@` към https GitHub URL). Приложението: GitCard, CommitSheet (⌘⇧K) с избор на файлове и „push след commit", RemoteSheet.

### 3.6 Netlify (`netlify.mjs`)

`auth`, `login` (браузър), `teams`, `sites`, `info`, `link --id|--name`, `create --name --team`, `deploy [--prod --confirm DEPLOY]`. `deployGuard`: проектът трябва да има свеж (<25 мин) check, който не е `blocked`; production изисква `--confirm DEPLOY`. Draft deploy връща preview URL; записва `lastDraft`/`lastProd`, ledger `netlify:draft`/`netlify:production`.

### 3.7 Хостинг доставчици и съветник (`hosting.mjs`)

`PROVIDERS`: **netlify**, **vercel**, **cloudflare** (Pages), **ghpages** — всеки с CLI команда, install команда, login команда, `free`, `note`, `pricing` URL.

- `hosting status` — за всеки: инсталиран, влязъл.
- `hosting advise --project` — оценява всеки доставчик за проекта: съвместимост (SSR/functions изключват статичните хостинги), комерсиална употреба (Vercel Hobby е некомерсиален → предупреждение „за клиентски сайтове е нужен Pro"), GitHub Pages без собствен домейн е под `/repo-name/`, състояние на login. Връща препоръка и подредени опции с `warnings[]`.
- `hosting set --provider` — сменя доставчика на проекта.
- `deploy --project [--prod --confirm DEPLOY]` — маршрутизира по `project.hosting`: netlify → `netlifyDeploy`; vercel → `vercel deploy --yes [--prod]`; cloudflare → `wrangler pages project create` (ако липсва) + `wrangler pages deploy <dir> --project-name --branch`; ghpages → `npx gh-pages -d <dir> -t` + `gh api` за включване на Pages. Същият `deployGuard` за всички.
- `smart --project [--prod --confirm DEPLOY]` — пълна проверка → ако не е blocked → deploy с избрания хостинг. Спира при грешка.

### 3.8 Домейни и DNS — Spaceship (`spaceship.mjs`)

- `spaceship connect` (ключ и secret през env `BID_SPACESHIP_KEY/SECRET`, валидира с реална заявка, пази в Keychain; грешен ключ не се записва), `disconnect`, `status [--refresh]` (домейни, дати на изтичане, autorenew; кеш).
- `spaceship dns --domain` — записи (A → `address`, CNAME → `cname`).
- `spaceship connect-domain --project --domain [--yes]` — план и изпълнение: `A @ → 75.2.60.5`, `CNAME www → <site>.netlify.app`, после Netlify API `updateSite custom_domain`. Без `--yes` само показва плана.
- `domainAttention` — изтичащи домейни попадат в „изисква внимание" в Mission Control.
- В приложението: екран **Домейни** (SpaceshipConnectCard с бутон към API Manager, списък домейни, DNS), **DomainProjectCard** в таба „Хостинг & домейн" на проекта, **ConnectDomainSheet** с преглед на плана.

### 3.9 Акаунти и облак — Supabase (`account.mjs`, `supabase/schema.sql`)

- Конфигурация: `engine/cloud.json` (bundled, продуктов облак) → override `APP_DIR/cloud.json` → env. `bid cloud config --url --anon-key` за собствен облак (CloudSetupView, с бутон „копирай SQL схемата").
- `account signup --email --password [--name]` (парола през env `BID_PASSWORD`), `login`, `recover` (reset имейл), `logout` (revoke + Keychain delete), `status` (с auto refresh на токена при <5 мин до изтичане; при offline пази сесията), `oauth --provider github` (връща URL `…/authorize?provider=github&redirect_to=beforeideploy://auth-callback`), `session --access --refresh` (довършва OAuth от URL fragment), `sync`.
- Header логика: `apikey` винага; `Authorization: Bearer` само с user token или ако ключът е legacy JWT (`eyJ…`) — новите `sb_publishable_…` не са JWT.
- **Sync** — upsert в `bid_projects (user_id, key, name, framework, hosting, live_url, domain, last_status, updated_at)` с `on_conflict=user_id,key`; RLS `auth.uid() = user_id`. Никакви токени.
- Supabase Auth конфигурация (направена): Site URL и Redirect URL = `beforeideploy://auth-callback`. Email confirm е включен.
- Приложението: **AuthView** (вход/регистрация/забравена парола/GitHub/„продължи без акаунт" — offlineMode в AppStorage), `mustAuthenticate` gating в RootView, **AccountBadge** (popover: имейл, „Синхронизирай", „Изход"), `afterLogin` → sync.

### 3.10 AI Fix (`aifix.mjs`)

- `aifix --project --step ID|all --target chatgpt|claude|codex|claude-code|copy`.
- Строи самостоятелен prompt: проект (framework, PM, скриптове), стъпката, summary/details, последните 80 реда от лога, споменатите в лога файлове (с относителни пътища), инструкции „предложи минимална поправка". `all` = всички fail + warn стъпки.
- **Redaction**: secrets по същите regex-и, имейли, home path → `~`, токени в URL-и.
- Targets: `chatgpt` → `https://chatgpt.com/?q=…`; `claude` → `https://claude.ai/new?q=…`; `codex` / `claude-code` → генерира `.command` файл в кеша, който `cd`-ва в проекта и стартира CLI-а с prompt-а (ясна грешка ако CLI не е инсталиран); `copy` → само текст. Записва `*:aifix` в ledger.
- Приложението: **AIFixBar** в RunOverlay (за fail и warn стъпки) и в StepDetailPopover; бутони „Оправи в ChatGPT", Claude, Codex, Claude Code, Copy.

### 3.11 Разходи и кредити (`costs.mjs`)

- **Ценоразпис** (`prices.json`, редактируем): netlify production 15 кредита, draft 0, bandwidth 10/GB, AI fix 1 съобщение/задача, GitHub push / Vercel / Cloudflare / GH Pages / локална проверка — безплатни.
- **Ledger** (`ledger.jsonl`): всяка операция с цена, проект, timestamp; обобщение по месец и по проект.
- **Реален usage**: Netlify API (team, plan, credits: capabilities.credits, plan credits, auto topup, dev servers…). ChatGPT и Claude нямат публично API за лимити → карта с линк „Отвори лимитите". Spaceship → линк.
- **Бюджет**: `budget --netlify-min N` — предупреждение когато Netlify кредитите паднат под прага.
- Приложението: **CostsView** (акаунти, този месец, по проект, бюджет, ценоразпис с „Редактирай"), бутон „Обнови от доставчиците".

### 3.12 Setup / Настройка (`setup.mjs`)

`setup status` връща групи с елементи `{id, title, ok, detail, action, optional}`:

- **Основа**: `node`, `git`, `git-identity`, `brew`
- **Hosting & GitHub**: `netlify-cli`, `netlify-login`, `gh`, `gh-auth`, `spaceship`, `vercel`, `vercel-auth`, `wrangler`, `wrangler-auth`
- **AI помощници**: `codex`, `codex-auth`, `claude-code`, `claude-auth`

Действия: `setup run ID --yes` (npm/brew install, `gh-auth` през device code с `devicecode` събитие, `git-identity` от GitHub noreply имейл, `netlify-login`), `setup terminal ID|all` (генерира `.command` за интерактивни login-и: vercel, wrangler, codex, claude), `setup auto --yes [--optional]` в ред `ORDER`. Приложението: **SetupView** с пръстен „11/17", бутон „Настрой всичко автоматично", по ред бутон „Инсталирай"/„Свържи"/„Вход в браузъра".

### 3.13 Mission Control (`overview.mjs`)

Карта за всеки проект: статус на последния check, framework, hosting, live URL, последен production/draft, променени файлове, branch, ahead/behind, Local Preview URL, **uptime** (HTTP ping на live URL) и **SSL дни до изтичане**. Totals: проекти, ready, blocked, онлайн. **„Изисква внимание"** списък: липсваща папка, blocked, live не отговаря (но 404 без production deploy е само info), SSL <14 дни, зад GitHub, стари неприбрани промени, непроверен проект, изтичащи домейни. Приложението: **MissionControlView** с KPI плочки и карти; клик отваря проекта.

### 3.14 История (`store.mjs`, `HistorySheet`, `HistoryStrip`)

Всяка проверка, fix, commit/push, deploy, Spaceship операция → запис в `history.jsonl` (`ts, project, op, status, summary, url, log, duration`). Показва се в таба „История" на проекта и в глобален лист (⌘Y), с бутони „отвори URL" и „отвори лог".

### 3.15 Приложение — навигация и UX

- **Sidebar**: Mission Control, Домейни, Разходи & кредити, Настройка; списък проекти със статус точка; „Добави проект" (⌘O, NSOpenPanel); „Търси или действай…" (⌘K); AccountBadge; История / Настройки.
- **Command Palette (⌘K)**: навигация, добавяне на проект, „Провери X", „Smart Deploy X", „Local Preview X", проекти, действия за акаунта.
- **Проект**: header с чипове (branch, PM, framework, publishDir, Netlify site) и бутони (Finder, отвори в редактор, Terminal, Refresh); табове **Преглед** (HeroCard със статус, лента „Провери / Smart Deploy / Production", HealthGrid със 7 плочки с popover детайли + AI Fix, FixesCard, кратки карти Local/GitHub/Live), **Local**, **GitHub**, **Хостинг & домейн** (HostingChooserCard със съветника, NetlifyCard или GenericHostingCard, DomainProjectCard), **История**.
- **RunOverlay**: стъпки в лявата колона, лог вдясно, „Пълен лог", долу AI Fix бар, статус ред, „Draft Preview" бутон след успешен check, „Прекъсни" (убива процеса).
- **Sheets**: Production (напиши `DEPLOY`), Netlify setup (login / избери сайт / създай), Commit, Remote, FixConfirm, History, Settings (autoOpenPreview, checkOnSelect, offlineMode…).
- **Menu / shortcuts**: ⌘O добави, ⌘K команди, ⌘R провери, ⌘D Smart Deploy, ⌘L Local Preview, ⌘⇧L спри, ⌘⇧K Commit & Push, ⌘Y история, ⌘⇧R обнови, ⌘, настройки.
- **URL scheme** `beforeideploy://auth-callback#access_token=…&refresh_token=…` (OAuth и имейл линкове), `beforeideploy://project?path=…` (от Shortcut).
- **Нотификации** (UNUserNotificationCenter) от `notify` събития.
- **Toast** за бързи съобщения, **busy** сет за спинъри по действие.

### 3.16 Инсталация и разпространение

`Install Before I Deploy.command` → `scripts/install.sh`: проверка (Swift CLT, Node, git, Netlify CLI) → копира engine → пуска 40-те теста (толерантно, резултат в `tests/last-run.txt`) → пише `env.zsh` с PATH → `swift build -c release` → `build.sh` (бандъл, икона, ad-hoc `codesign`) → `~/Applications` → `lsregister` за URL scheme → launcher → отваря приложението. Лог в `install.log`. **Само с Command Line Tools, без Xcode** — заради това `@State` е заменен с `@Local` (макро плъгините липсват в CLT).

---

## 4. Инварианти и правила, които V10 трябва да спази

1. Последният stdout ред на всяка команда е `{"type":"result",…}`; всичко друго е събитие. Никога `console.log` с не-JSON.
2. Production deploy изисква `--confirm DEPLOY` и свеж (<25 мин) check, който не е `blocked`. Не отслабвай `deployGuard`.
3. Secrets: Keychain само. Никакви токени в `projects.json`, state, history, ledger, prompt-и (redaction) или Supabase.
4. Bearer header само с user token или legacy JWT ключ. `sb_secret_*` ключ никога не се използва в клиента.
5. Всички текстове към потребителя са на български; кодът и коментарите — на английски.
6. Тестовете (`node tests/run.mjs`) трябва да минават без мрежа към реални услуги: `BID_NO_KEYCHAIN=1`, `BID_NO_BUNDLED_CLOUD=1`, mock Supabase и Spaceship.
7. Swift кодът трябва да се билдва само с CLT: няма `@State`/`@Observable` макроси (ползвай `@Local`, `@Published`, `@AppStorage`), няма Xcode проект, няма външни Swift пакети.
8. Приложението не пише файлове в проекта на потребителя освен през явни fix-ове с `--yes`.
9. Draft е безплатен, production харчи кредити — всяка нова платена операция трябва да влезе в ценоразписа и ledger-а.
10. Пътищата с интервали („Application Support") — винаги `fileURLToPath`, никога `new URL().pathname`.

---

## 5. Известни слабости и технически дълг

**Engine**

- `check` пуска build винаги (няма кеш по git hash) — при големи проекти е бавно. Идея: пропусни build ако HEAD + working tree hash съвпадат с последния успешен.
- Secrets scanner чете всички файлове синхронно; няма лимит по размер на файл и няма `.bidignore`.
- Vercel, Cloudflare и GitHub Pages deploy-ите са имплементирани и покрити от тестове само „без CLI → ясна грешка"; **не са пускани срещу реални акаунти**. Cloudflare `wrangler pages deploy` при SSR (Astro/Next adapters) не е обработен.
- `netlifyUsage` разчита на недокументирани полета на Netlify API (`capabilities.credits`), могат да се променят.
- `local.mjs`: detached процеси остават живи ако приложението се убие; при рестарт `localStatus` чисти state-а само ако PID-ът не е жив, но не намира сървъри без state (сирак на 4173 е реален случай).
- Няма `bid update`/self-update; версията е константа `VERSION` в `bid.mjs` и `9.0.0` в Info.plist — трябва да се синхронизират ръчно.
- `parseArgs` е домашен; флагове с интервали или `--flag=value` не са поддържани навсякъде.
- Няма структурирано логване на самия engine (само логовете на подпроцесите).

**Приложение**

- `AppModel` е 810 реда и държи всичко — кандидат за разделяне (ProjectStore, AccountStore, HostingStore, RunController).
- Няма unit/UI тестове за Swift; проверката е ръчна.
- `@Local` е workaround; при преминаване към Xcode може да се върне `@State`.
- Табът „Хостинг & домейн" зарежда `advise` при всяко отваряне (без кеш).
- Няма локализация (само български hard-coded стрингове).
- Ad-hoc подпис: Gatekeeper предупреждение при първо отваряне на чужд Mac; за продажба е нужен Developer ID + notarization.
- Няма in-app update и няма crash reporting.

**Облак**

- Supabase free tier: проектът се паузира при неактивност; няма monitoring. За продажба — платен план или self-host.
- Само една таблица (`bid_projects`); няма история/ledger в облака, няма екипи/споделяне.
- GitHub OAuth в Supabase не е конфигуриран (бутонът „Продължи с GitHub" ще даде грешка от Supabase до създаване на GitHub OAuth App).
- Няма изтриване на акаунт от приложението (GDPR).

**Security**

- Prompt redaction е regex-базирана — нов тип ключ може да изтече в AI prompt.
- `.command` файловете за Codex/Claude Code съдържат prompt-а в plain text в кеша.
- Ключовете на Spaceship се подават през env към engine процеса (видимо в `ps` за милисекунди).

---

## 6. Тестове (40, всички минават)

Групи: doctor · project · detect · check (static, vite, failed build) · smart · deploy guards (blocked, без DEPLOY, без check, без login) · secrets (.env, ключ в кода) · fixes (env.untrack, git.init, gitignore, --yes) · git (status, commit, selective commit, push без remote, remote нормализация) · aifix (prompt, redaction, ChatGPT URL, codex без CLI, all) · costs (ledger, ценоразпис) · setup (status, --yes защита) · overview (карти, внимание, изтичащ домейн) · spaceship (грешен ключ, свързване, домейни, DNS, план) · акаунт (без облак, signup/login/грешна парола/sync/logout срещу mock) · хостинг (SSR съветник, смяна, deploy без CLI) · local (start/stop static, dev mode) · status · history.

Пускане: `cd engine && node ../tests/run.mjs` (или от корена `node tests/run.mjs`). Тестовете създават временни `BID_APP_DIR`/`BID_CACHE_DIR` и временни проекти.

---

## 6a. Промени във V10 (актуализира се по седмици)

- **Седмица 1–2 (WP6.1, WP1):** `App/Sources/BeforeIDeploy/Stores/` (ProjectStore, AccountStore, HostingStore, RunController; AppModel е фасада) · `engine/src/i18n.mjs` + `engine/i18n/{en,bg}.json` (`t()`, `msg()`, `BID_LANG`; `result.key/params` при грешка) · `App/Sources/BeforeIDeploy/Localization.swift` (`L()`), `App/Resources/{en,bg}.lproj`, `LanguageViews.swift` (избор на език при първо пускане, смяна без рестарт) · `scripts/i18n-check.mjs`, `scripts/i18n-lib.mjs`, `scripts/i18n-translate.mjs` (машинен превод, пуска се от собственика с негов ключ).
- **Седмица 3 (WP2):** `supabase/schema.sql` v10 (profiles, subscriptions, credit_ledger + credit_balance, ai_usage, admin_audit, settings) · `supabase/functions/admin/index.ts` · `engine/src/features.mjs` (гейтове по роля/план; решения 3 и 5 са константи там) · `engine/src/aikeys.mjs` (VIP ключове в Keychain `ai-anthropic`/`ai-openai`) · `engine/src/admin.mjs` (`bid admin`) · `account status` връща `role, plan, locale, credits, features`; профилът се кешира в `profile.json` (без secrets); `account sync` се пропуска, ако планът няма cloud sync · App: `AdminView.swift`, `Stores/AdminStore.swift`, група „AI ключове“ в Настройка за vip/admin, роля/план в AccountBadge, езикът се записва в `profiles.locale`.
- **Седмица 4 (WP6.8, WP3):** `.github/workflows/{engine,app,functions}.yml` (Linux тестове, `swift build` на macOS, `deno check`) · `engine/src/ai/{providers,patch,index}.mjs` (`bid ai fix|explain|apply|usage`; SEARCH/REPLACE блокове; own-key Anthropic/OpenAI или metered `ai-fix`) · `supabase/functions/ai-fix` · App: `Stores/AIStore.swift`, `AIFixView.swift` (стрийм + diff + „Приложи избраните“), бутон „Оправи с AI“ в AIFixBar по `features.ai.builtin` · deploy записите пазят `sha`.
- Нов exit код: `3` и за `forbidden` (не-admin вика `bid admin`); `8` = `quota_exhausted`.

## 7. Насоки за V10 (кандидати, приоритизирани по стойност/риск)

> Актуалният план е в `V10-PLAN.md` и `ROADMAP.md`; списъкът по-долу е историческият вход към тях.

1. **Реално покритие на Vercel / Cloudflare / GitHub Pages** — ръчно тестване с акаунти, SSR адаптери, връщане на preview URL от `vercel`/`wrangler` изхода, `hosting` стъпката да проверява и linked проект за тези доставчици.
2. **Инкрементален check** — пропускай build/lint/typecheck по git hash; „бърза проверка" преди всеки commit.
3. **Разделяне на AppModel** и добавяне на Swift тестове за Engine парсера и моделите.
4. **Self-update** — `bid update` (git pull или изтегляне на release), проверка на версията при старт, банер „има нова версия".
5. **Cloud разширение** — history/ledger sync, споделяне на проект с клиент (read-only линк към статус), изтриване на акаунт, GitHub OAuth App.
6. **Множество Spaceship действия** — купуване/подновяване на домейн от приложението, автоматично `www` redirect, DNS шаблони за Vercel/Cloudflare (сега само Netlify).
7. **Preflight за производителност/SEO** — Lighthouse (`npx lighthouse`) като опционална стъпка с оценка и AI Fix prompt.
8. **Клиентски режим** — профил „клиент" с ограничен UI (само статус и Local Preview) за когато приложението се дава на клиенти.
9. **Developer ID подпис + notarization + DMG** за разпространение извън приятелски кръг.
10. **Локализация** (EN) чрез String Catalog, ако продуктът ще се продава извън България.

---

## 8. Бързи команди за Codex

```bash
# тестове
cd ~/Desktop/BeforeIDeploy-V6 && node tests/run.mjs

# engine директно
~/Desktop/BeforeIDeploy-V6/engine/bid doctor
~/Desktop/BeforeIDeploy-V6/engine/bid project list
~/Desktop/BeforeIDeploy-V6/engine/bid check --project <key>
~/Desktop/BeforeIDeploy-V6/engine/bid hosting advise --project <key>

# build + инсталация (същото като двойния клик на Install Before I Deploy.command)
bash ~/Desktop/BeforeIDeploy-V6/scripts/install.sh

# само приложението
cd ~/Desktop/BeforeIDeploy-V6/App && swift build -c release
```

Ключове за проверка на промяна: тестовете минават · `install.sh` завършва с „Готово" · приложението стартира, влиза с акаунта, Mission Control се зарежда, `check` на ПОРТФОЛИО е READY, Local Preview стартира и спира.
