# Before I Deploy V6 — Project Control Center

Native macOS app (SwiftUI) + локален engine (zsh + Node), който надгражда Shortcut-а `Before I Deploy 🚀`.
Shortcut-ът става само launcher, а цялата работа се върши в приложението.

## Инсталация

```zsh
zsh ~/Desktop/BeforeIDeploy-V6/scripts/install.sh
```

Скриптът проверява средата (Command Line Tools, Node, git, Netlify CLI), инсталира engine-а в
`~/Library/Application Support/BeforeIDeploy/engine`, пуска тестовете, build-ва приложението и го слага в
`~/Applications/Before I Deploy.app`. След промяна в кода просто го пусни отново.

## Shortcut

В Shortcut-а `Before I Deploy 🚀` остави само едно действие **Run Shell Script** (Shell: `/bin/zsh`, Pass Input: `to stdin`):

```zsh
zsh "$HOME/Library/Application Support/BeforeIDeploy/launcher/launch.zsh"
```

Ако подадеш папка като вход (например от Finder Quick Action), приложението я добавя и отваря директно.
URL схема: `beforeideploy://open?path=…`, `beforeideploy://check?path=…`, `beforeideploy://smart?path=…`.

## Какво има

- **Project Library** — помни път, framework, package manager, GitHub, Netlify site, live URL, build dir, последен порт.
- **Dashboard** — READY / WARNINGS / BLOCKED, health по категории (Git, Secrets, Зависимости, Lint, Typecheck, Build, Hosting), клик върху плочка = детайли, лог и поправка.
- **Smart Deploy** (⌘D) — Git → Secrets → Deps → Lint → Typecheck → Build → Netlify Draft. Спира при първата грешка.
- **Production** — само след написване на `DEPLOY`; винаги минава свежа пълна проверка преди качване. Защитата е и в engine-а.
- **Local Preview** — Build preview (сервира `dist/`) или Dev server; Open / Copy / Restart / Stop; помни порта.
- **GitHub** — branch, промени, ahead/behind, последен commit, Commit & Push с избор на файлове, fetch, добавяне на remote.
- **Netlify** — вход, свързване към съществуващ или създаване на нов сайт, Draft, Production, live URL, Dashboard. **Никога не се ползва `netlify init`** — CI от GitHub не се включва.
- **Безопасни поправки** — .gitignore, защита на .env, спиране на проследяван .env, git init, install на зависимости. Винаги с преглед и потвърждение.
- **История и логове**, **macOS известия** при завършен build/deploy.

## Engine (CLI)

Всичко в приложението минава през `bid`, който може да ползваш и от Terminal:

```zsh
BID="$HOME/Library/Application Support/BeforeIDeploy/engine/bid"
"$BID" check --project ~/Desktop/ПОРТФОЛИО
"$BID" smart --project ~/Desktop/ПОРТФОЛИО              # check → draft
"$BID" smart --project ~/Desktop/ПОРТФОЛИО --prod --confirm DEPLOY
"$BID" help
```

Изходът е NDJSON (`step`, `log`, `notify`, последен ред `result`). Кодове: 2 = липсва потвърждение/грешни аргументи,
3 = blocked / няма свежа проверка, 4 = Netlify не е свързан, 5 = не си влязъл в Netlify.

Secrets скенерът пропуска ред, който съдържа коментар `bid-ignore` (за фалшиви тревоги).

## Данни

- Библиотека, състояние, история: `~/Library/Application Support/BeforeIDeploy/`
- Логове: `~/Library/Caches/BeforeIDeploy/<проект>/`

## Премахване

```zsh
zsh ~/Desktop/BeforeIDeploy-V6/scripts/uninstall.sh        # пази библиотеката
zsh ~/Desktop/BeforeIDeploy-V6/scripts/uninstall.sh --all  # трие всичко
```
