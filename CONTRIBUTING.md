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

## Синхронизация

- **Всеки ден:** `git pull origin main` в началото на работата.
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
