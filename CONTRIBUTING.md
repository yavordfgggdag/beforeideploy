# Работа в екип — Before I Deploy

Едно хранилище за всичко: macOS, Windows, Linux, уеб приложението и сайта. Те споделят един двигател
(`engine/`), един облак (`supabase/`) и една дизайн система (`design/`). Така поправка в общия код стига до
всички платформи наведнъж и никой не чака синхронизация между отделни хранилища.

## Кой какво прави

| Част | Папки | Отговаря |
| --- | --- | --- |
| macOS приложение | `App/` (Swift), `engine/src/platform/darwin.mjs`, `packaging/` | собственикът |
| Windows приложение | `desktop/` (Tauri), `engine/src/platform/win32.mjs`, `engine/bid.cmd` | собственикът |
| Linux приложение | `desktop/` (Tauri), `engine/src/platform/linux.mjs` | партньорът |
| Сайт | `site/`, `scripts/site-build.py` | партньорът |
| Общо UI | `web/`, `design/tokens.json` | двамата |
| Двигател и облак | `engine/`, `supabase/` | собственикът; партньорът пуска заявка (issue) |

Windows и Linux са **едно и също** Tauri приложение (`desktop/`). Специфичното за всяка ОС е в
`engine/src/platform/<ос>.mjs` и в пакетирането (Windows: MSI/NSIS; Linux: AppImage/deb). Ако Rust кодът в
`desktop/src-tauri/src/` има нужда от нещо само за една ОС, то влиза в блок `#[cfg(target_os = "…")]`. Промяна в общия код на `desktop/` или `web/` се
преглежда от двамата. Точното разпределение е в [`.github/CODEOWNERS`](.github/CODEOWNERS).

## Клонове

- `main` е стабилният клон. Не се пише директно в него, само чрез pull request.
- Всеки работи в свой клон с представка по платформа:
  `mac/…`, `win/…`, `linux/…`, `site/…`, `web/…`, `engine/…`. Пример: `linux/appimage-package`, `site/pricing-page`.
- Клонът е малък и живее кратко (1–3 дни). По-добре два малки PR, отколкото един голям.
- Преди PR: `git fetch origin && git merge origin/main` (без rebase на споделени клонове).

## Pull request

1. Отвори PR към `main`. Шаблонът се попълва сам.
2. CI трябва да е зелен. Всяка част си има проверки: `app`, `desktop`, `engine`, `engine-cross`, `web`, `site`, `functions`.
3. Притежателят на папката (CODEOWNERS) одобрява. При общите папки одобряват двамата.
4. Сливане със „Squash and merge“.

## Ежедневна работа (3 команди)

С Claude Code просто казваш какво искаш. Уменията (skills) в `.claude/skills/` вършат останалото:

| Кажи на Claude | Умение | Какво става |
| --- | --- | --- |
| „започвам ценовата страница“ | `start` | нов клон `site/pricing-page` от най-новия `main` |
| (нищо — става само) | автоматично | след всеки отговор на Claude: commit → GitHub → бакъп |
| „запази“ | `save` | същото, на ръка, с хубаво съобщение |
| „готово, пусни за преглед“ | `ship` | проверки за променените части → pull request към `main` |
| „какво става?“ | `team-status` | твоят клон, новото в `main`, по какво работи другият |
| „изгубих файл“ | `restore` | връщане от бакъпа на компютъра |
| работа по сайта | `site` | правилата за сайта: генератор, цени, преглед |

Без Claude — същото от терминала:

```sh
bash scripts/team/start.sh site "pricing page"   # нова задача
bash scripts/team/save.sh "Pricing: yearly toggle"  # запази (commit → push → бакъп)
bash scripts/team/status.sh                      # къде съм
```

На Mac: двоен клик на **Save.command** запазва всичко. На Windows скриптовете вървят в Git Bash
(идва с Git for Windows).

**Предпазни мерки, вградени навсякъде:**
- Никога не се записва в `main`. Ако си на `main`, работата отива в нов клон `wip/<име>-<дата>`.
- Проверка за ключове преди всеки commit, от всеки инструмент (`.githooks/pre-commit`). Истински ключ спира commit-а.
- Бакъп след всеки commit на твоя компютър: `~/BeforeIDeploy Backups/`. Пази огледало на всички клонове
  (обновява се при всяко запазване) и по едно пълно копие на ден за последните 7 дни. В облачни сесии
  бакъп не се прави, защото контейнерът се изтрива; там пазител е GitHub.
- Автоматичното запазване се спира за една сесия с `BID_AUTOSAVE=0`, а бакъпът с `BID_BACKUP=0`.

Първи път след `git clone`: `bash scripts/team/setup.sh`. Claude Code го пуска сам при всяко стартиране.

## Синхронизация

- **Всеки ден:** `git pull origin main` в началото на работата (или умението `team-status`).
- **Задачи:** GitHub Issues с етикети `mac`, `windows`, `linux`, `site`, `web`, `engine`, `blocked`.
  Заявка към другия = issue с неговия етикет.
- **Седмично:** 15 минути общ преглед. Какво е слято, какво блокира, какво следва.
- **Промяна в общ договор** (команди на двигателя, отговори на облака, токени): първо issue, после код.
  Двигателят говори с приложенията чрез NDJSON команди (`engine/src/bid.mjs`); всяка промяна там засяга всички ОС.

## Правила, които не се нарушават

- Никакви истински ключове, токени или пароли в хранилището. Тайните са в системния трезор на ОС
  (Keychain / Secret Service / DPAPI) или в настройките на GitHub и Supabase.
- Плащанията се тестват само в Paddle sandbox.
- Деплой на сайта в продукция прави само собственикът. За преглед се ползват Netlify preview адресите на PR.
- Двигателят остава без npm зависимости.
- Текстовете минават през файловете за превод (`web/src/i18n/`, `engine/src/i18n.mjs`). Английският е по подразбиране.
- Цените идват от `supabase/functions/_shared/plans-catalog.json` и никога не се пишат на ръка.

## Бърз старт

```sh
# двигател (Node 22)
node tests/run.mjs

# уеб UI (споделено от desktop)
cd web && npm ci && npm run dev

# desktop (Windows / Linux / macOS) — нужни са Rust и Node
cd web && npm run build && cd ../desktop/src-tauri && cargo test && cargo build

# Linux: системни библиотеки за Tauri
sudo apt-get install -y libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev patchelf

# сайт
python3 scripts/site-build.py   # генерира страниците в site/
python3 -m http.server -d site 8080

# macOS приложение (само на Mac)
swift build --package-path App
```

## Документи

- [docs/PLAN-UNIFIED-BG.md](docs/PLAN-UNIFIED-BG.md) — одобреният общ план
- [docs/errors.md](docs/errors.md) — кодове на грешки
- [desktop/README.md](desktop/README.md) — Tauri обвивката
