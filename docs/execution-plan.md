# План за изпълнение: V10.0 до публичен release

Този документ е за следващите сесии (агент или човек), които продължават работата **без контекста на
досегашните разговори**. Стратегията и пълният обхват са в `ROADMAP.md`; тук е само **какво се прави сега,
в какъв ред, в кои файлове и кога е готово**. Всяка стъпка е самостоятелна: може да се изпълни в отделна
сесия и завършва с commit + зелен CI.

## 0. Как се работи (правила, наследени от седмици 1–5)

- Клон: `claude/nifty-edison-1195gi` (без PR, докато собственикът не поиска). По един commit на стъпка;
  push след всеки commit. Commit съобщенията описват *какво и защо*, без идентификатори на модели.
- Облачната среда е Linux **без Swift/Xcode**. Swift код се пише внимателно и се проверява от CI
  (`.github/workflows/app.yml`, macos-15: `swift build -c release`, `swift test`, i18n-check). Никога не се
  обявява Swift стъпка за готова, преди app workflow-ът да е зелен на GitHub Actions.
- Engine (Node 22) тестове се пускат локално: `node tests/run.mjs > /tmp/t.txt; tail -1 /tmp/t.txt`
  (не през `| tail` — губи се exit кодът). Нужен е `zsh` (`apt-get install zsh` в контейнера).
- Edge Functions: Deno не е в контейнера; `npm install deno@2` в scratch папка и
  `node_modules/.bin/deno test supabase/functions` (32 теста) + `deno check` на всеки `index.ts`.
- Проверки преди всеки commit: `node tests/run.mjs`, `node scripts/i18n-check.mjs`,
  `node scripts/error-codes.mjs`. CI пуска същите.
- **Не се пипат secrets, не се добавят истински ключове.** Ключове към engine-а — само през env
  (`BID_PASSWORD`, `BID_AI_KEY`, `BID_SPACESHIP_*`) или Keychain; никога в argv.
- Всеки видим текст е ключ в `App/Resources/{en,bg}.lproj/Localizable.strings` (през `L("key")`) или в
  `engine/i18n/{en,bg}.json` (през `t()`/`msg()`). Добавяне на ключове: най-лесно с малък Node скрипт
  върху `scripts/i18n-lib.mjs` (`readStrings`/`writeStrings` пазят формата и сортирането).
- Всеки нов `EngineError` код влиза в `docs/errors.md` (иначе `scripts/error-codes.mjs` е червен).
- Фикстурите за Swift тестовете (`App/Tests/BeforeIDeployTests/Fixtures/*.json`) се генерират от engine
  тестовете: `BID_WRITE_FIXTURES=1 node tests/run.mjs`. Регенерирането пренаписва всички; върни
  непроменените с `git checkout -- App/Tests/BeforeIDeployTests/Fixtures/` и остави само новите.

### Капани, в които вече сме стъпвали

| Капан | Какво да правиш |
|---|---|
| Mock сървърите в `tests/run.mjs` са JS в template literal | вътре няма backticks и `${}`; `\\n` за нови редове |
| `@AppStorage` в `ObservableObject` не публикува промени | `@Published` + `UserDefaults` в `didSet` (виж `AIStore`) |
| `Bundle.module` се чупи в ръчно сглобен `.app` | каталозите се четат през `Bundle.main` (`Localization.swift`) |
| `====` или `=x` в началото на zsh команда | zsh го третира като команда; ползвай `echo "----"` |
| i18n „неизползван ключ“ вижда само литерали `'a.b'` | динамични ключове → литерална карта (напр. `REASON_KEYS`) |
| Английски литерал в `Text("…")`/`label:`/`help:` | i18n-check го спира; ползвай `L()` |
| Два реда в едно и също ms в fake Supabase | `nextTimestamp()` дава строго растящи `created_at` |
| GitHub Actions default shell няма pipefail | `defaults: run: shell: bash` (app.yml) |
| `@State` не се ползва в проекта | `@Local` (дефиниран в `LocalState.swift`) |

## 1. Състояние към 2026-09-28

Готово и зелено в CI (engine 54 теста, Swift 25, Deno 32): WP6.1, WP1, WP2, WP6.8 CI, WP3 (вграден AI Fix,
own-key + cloud), WP6.2 инкрементален check, WP6.3 версии/self-update, WP6.4 сираци на Local Preview,
WP6.6/6.9 логове и доклад, WP6.7 Swift тестове, WP5 (export/delete, тур, providers от облака, първи
стъпки), WP7 (грешки с код/копиране/помощ, меню „Изглед“ ⌘1–⌘4 ⌘] ⌘[, каталог на грешките), L1, L2, L6,
WP8-A част 1 (release скриптове). Последен commit: виж `git log`.

Не е готово: L3, L4, L5 (собственик), WP6.5 (нужни акаунти), WP4 (чака решения), WP8-A част 2 (runbook +
тестове), QA седмица, самият release. Светла тема, Xcode track и всичко от V11 остават както в ROADMAP.

## 1a. Визуален език на V10 (готово, 2026-09-28)

`Theme.swift` е единственият източник: `Card` (sheen, осветен ръб `edgeHighlight`, двуслойна сянка,
`tint:` за статус), `AmbientBackground` (светлината следва статуса на проекта), `ProjectAvatar`
(стабилен градиент по име), `StatusRing`, `Motion` (spring/quick/gentle → nil при „Намалено движение“).
Нов екран или карта ползва тези, не собствени цветове/сенки. Следващи кандидати за полиране:
Sheets (Settings, Production, Commit), Domains, Costs графика на разходите, Setup редовете.

## 2. Стъпки в ред на изпълнение

Формат: **цел → файлове → какво точно → тестове → готово когато → оценка**.

### S1. WP8-A част 2: runbook и тестове на release скриптовете (0.5 ден) — ✅ готово (`docs/release.md`, тест в `tests/run.mjs`)

- Файлове: `docs/release.md` (нов), `tests/run.mjs` (нов тест), `README.md` (линк).
- `docs/release.md` описва еднократната настройка и всеки release:
  1. Apple Developer Program; сертификат *Developer ID Application* (CSR от Keychain Access → developer
     portal → двоен клик за инсталиране). `security find-identity -v -p codesigning` показва името за
     `BID_SIGN_IDENTITY`.
  2. `xcrun notarytool store-credentials BID --apple-id <email> --team-id <TEAMID> --password <app-specific>`.
  3. Хостинг за `releases/` (статичен, HTTPS): `BID_RELEASE_BASE_URL=https://<домейн>/releases`.
  4. Release: `engine/VERSION` без `-dev`; `CHANGELOG.md` без „(in development)“; commit; `zsh scripts/release.sh`;
     качване на DMG + `latest.json`; `git tag v<версия>`; cask в tap.
  5. Първи път: в облака `settings` ключове `release.url` (= `<base>/latest.json`) и `help.url`
     (= `<домейн>/help/errors`) — `bid admin set_settings --json '{"release.url":"…","help.url":"…"}'`.
  6. Rollback: предишният DMG остава на хоста; `latest.json` се връща (`git`/копие) — под 1 минута.
  7. Beta канал: `--channel beta` пише само `latest.json.beta`; приложението го вижда с канал `beta`.
- Тест в `tests/run.mjs` (след теста за error-codes): `release-notes.mjs 10.0.0` дава `notes.en/bg` с „AI Fix“
  и `inDevelopment === true`; `--check` излиза с 1 за „(in development)“ и с 0 при `--allow-dev`;
  `release-feed.mjs` във временна папка: stable запис → `minVersion` остава; beta запис → `.beta`; по-нова
  stable маха по-стара beta. Ползвай `mk('release-feed', {})` за папката и `spawnSync(process.execPath, …)`.
- Готово когато: тестът е зелен, `docs/release.md` е линкнат от README и ROADMAP §4.1 WP8-A.

### S2. L3: бадж „бета превод“ (0.5 ден) — ✅ готово

- Файлове: `App/Resources/{en,bg}.lproj/Localizable.strings` (ключ `_meta.reviewed` = `"true"`),
  `App/Sources/BeforeIDeploy/Localization.swift` (`static func isReviewed(_ code: String) -> Bool`, чете
  `string("_meta.reviewed", in: code) == "true"`), `LanguageViews.swift` (в `LanguageTile` и `LanguageRow`
  малък бадж `L("language.beta")` когато не е reviewed), `scripts/i18n-translate.mjs` (пише `"_meta.reviewed" = "false"`
  за машинно преведени каталози), `scripts/i18n-check.mjs` (ключове с префикс `_meta.` се пропускат в
  проверката за неизползвани и в проверката за английски литерали), Swift тест в `EngineTests.swift`
  (`Localization.isReviewed("xx") == false` без каталог).
- Готово когато: i18n-check зелен, app CI зелен, ключът присъства и в двата каталога.

### S3. L4: плурали със `.stringsdict` (1 ден)

- Файлове: `App/Resources/{en,bg}.lproj/Localizable.stringsdict` (нови), `Localization.swift`
  (`func L(_ key: String, count: Int, _ args: Any...)` — подава `count` като `Int` за `%d`, останалите
  като текст), `scripts/i18n-check.mjs` (парсва stringsdict — plist XML — и проверява, че en и bg имат едни и
  същи ключове и категории `one`/`other`), `scripts/build.sh` (нищо: копира целите `.lproj`).
- Кандидати за плурал (сега с `%@`): `production.warnings`, `dashboard.changes`, `domains.count`,
  `ai.applied`, `dashboard.issuesOnePrompt`, `overview.missingSetup`, `domains.expiresIn`,
  `run.checkCounts` (три числа → три отделни ключа или остава с `%@`).
- Механика: `Bundle.localizedString(forKey:)` връща формат от stringsdict, `String(format:locale:arguments:)`
  избира формата по `count`. Извикването в изгледите става `L("domains.count", count: n)`.
- Готово когато: Swift тест с двата езика (без каталог → ключът), i18n-check вижда stringsdict, CI зелен.
  Ако времето е малко: **пропусни S3 за V10.1** — en и bg имат еднаква структура one/other и текстовете
  сега са граматически приемливи.

### S4. Синхронизация на документите (0.5 ден, повтаря се след всяка седмица)

- `ROADMAP.md` §2: L3/L4/L6 статус, добави „Готово в седмица 5“ (WP5, WP7, L6, WP8-A част 1); §6 график:
  седмица 6 = WP4 (ако има решения) или QA; §7.1 таблицата с бройки (engine 54+, Swift 25+, Deno 32).
- `AUDIT.md` §6a: ред за седмица 5 (файлове по-долу).
- `CHANGELOG.md` 10.0.0: onboarding (тур, Apple), клавиатура, грешки с код, каталог на грешките,
  release скриптове, Deno тестове.
- `docs/manual-qa.md`: редове 1.7 тур (веднъж, Esc), 3.9 бутон Apple само когато е включен в Supabase,
  7.4 меню „Изглед“ и ⌘] ⌘[, 6.6 toast с код + копиране + помощ.

### S5. WP6.5: реални тестове на Vercel / Cloudflare / GitHub Pages (2 дни + акаунти)

- Собственикът дава тестови акаунти (или пуска сам `docs/manual-qa.md` §5.2). От реалните изходи на
  `vercel`, `wrangler`, `gh` се записват фикстури в `tests/fixtures/cli/*.txt`, а парсерите в
  `engine/src/hosting.mjs` (preview URL, production URL, грешки) получават replay тестове.
- Готово когато: три replay теста, ръчният ред 5.2 е ✅.

### S6. Задачи само за собственика (без код) — преди QA седмицата

1. Supabase: `supabase/schema.sql` в SQL Editor; `supabase functions deploy admin ai-fix account`;
   `supabase secrets set ANTHROPIC_API_KEY=…`; `update public.profiles set role='admin' where email='…'`.
2. Authentication → Providers: GitHub (както във V9); Apple — Services ID + ключ (изисква Apple Developer
   Program); Redirect URL `beforeideploy://auth-callback`. Бутоните се появяват сами.
3. `settings`: `release.url`, `help.url`, при нужда `ai.models`, `ai.dailyCapPercent` (Admin панел / `bid admin set_settings`).
4. Apple Developer Program + Developer ID сертификат + notarytool профил (S1).
5. Решенията от ROADMAP §9: цени/квоти (1), Paddle vs Lemon Squeezy (2), домейн/фирма/имейл (4),
   beta тестери (11). Без 1, 2 и 4 WP4 не започва.

### S7. WP4: планове, кредити, `BillingProvider` (7 дни, след решенията)

Схемата вече има `subscriptions`, `credit_ledger` (bucket `plan`/`topup`), `credit_balance`, `settings.plans`.
Ред на работа:
1. **Edge Function `billing`** (`supabase/functions/billing/{handler,index}.ts` + `billing_test.ts` по модела
   на `ai-fix`): webhook на Paddle (`subscription.created/updated/canceled`, `transaction.completed`),
   проверка на подписа (`Paddle-Signature`, HMAC), идемпотентност по `event_id` (таблица `billing_events`),
   `subscriptions` → `profiles.plan`, месечен грант в `credit_ledger` (bucket `plan`, reason `monthly_grant`,
   изтичане на предишния грант), пакети → bucket `topup`. Действие `portal` връща URL на клиентския портал.
   Схема: миграция `supabase/schema.sql` (таблица `billing_events`, колона `subscriptions.provider_ref`
   вече я има, `current_period_end`).
2. **Engine `engine/src/billing.mjs`**: `bid billing plans` (от `settings.plans` + цени), `bid billing checkout --plan high`
   (връща URL за Paddle overlay с `custom_data.user_id`), `bid billing status` (абонамент, дата на подновяване,
   баланс по bucket, история от `ai_usage`), `bid billing portal`. Mock endpoints в `tests/run.mjs` + тестове:
   webhook с грешен подпис → 401, повторен event → без втори грант, grant → `credit_balance`.
3. **Приложение**: екран „Абонамент“ (`Sheets.swift` или нов `BillingViews.swift`): планове от engine-а,
   „Продължи с Free“, бутон checkout (отваря браузър), статус, история, пакети, портал. `AccountBadge`
   показва план + оставащи токени (вече има). `features.mjs` не се променя — гейтовете вече четат `plan`.
4. Trial 7 дни High при регистрация: `handle_new_user` тригер → `subscriptions(provider='trial')` + грант;
   изтичане чрез `pg_cron` или при `account status` (engine проверява `current_period_end`).
5. `account delete` вече анулира локално; добави извикване на Paddle API за реално анулиране.
- Готово когато: sandbox абонамент активира High за < 30 s; QA ред за refund; Deno тестове ≥ 8.

### S8. WP7 остатък (1 ден)

- Празни състояния: одит на всеки екран без данни (Costs преди зареждане — има спинер; Domains без Spaceship —
  има; Admin — има; Dashboard без история — има). Добави `EmptyStateView` само където липсва.
- VoiceOver: `accessibilityLabel` на всички `IconButton` (имат `help`), на `LanguageTile`, `ProjectRow`.
- Светла тема остава за V11 (WP17).

### S9. QA седмица (ROADMAP §7, 5 дни)

- `docs/manual-qa.md` на bg и en, macOS 13/14/15 (VM или втори потребител), чист Mac без Node.
- 3–5 beta тестери с роля `vip`; „топ 10 дразнещи неща“ → поправки → повторен чеклист.
- Критерии за release: §8 в `docs/manual-qa.md`.

### S10. Release V10.0

1. `engine/VERSION` → `10.0.0`; `CHANGELOG.md`: махни „(in development)“, добави датата.
2. Commit „Release 10.0.0“; CI зелен на трите workflow-а.
3. `zsh scripts/release.sh` с env променливите от S1; качване; `settings.release.url` (веднъж); tag.
4. Смяна на `engine/VERSION` на `10.1.0-dev`; нов CHANGELOG запис.

### След V10.0

V10.5 (Xcode track, XcodeGen, sandbox, StoreKit) и V11 (WP10–WP19) — по ROADMAP §4.2–4.3 и графика §6.
Първи кандидати за V10.1: L4 (ако е пропуснат), езици de/es/fr/it/pt-BR/pl/ro/tr през
`scripts/i18n-translate.mjs` (собственикът го пуска на Mac-а със свой ключ) + бадж „бета превод“.

## 3. Тестове и команди (справка)

| Слой | Команда | Днес |
|---|---|---|
| Engine | `node tests/run.mjs` | 54 |
| i18n | `node scripts/i18n-check.mjs` | ✓ |
| Кодове на грешки | `node scripts/error-codes.mjs` (`--list` показва къде се вдигат) | ✓ |
| Swift | `cd App && swift test` (само на Mac / CI) | 25 |
| Edge Functions | `deno test supabase/functions`; `deno check supabase/functions/*/index.ts` | 32 |
| Release | `node scripts/release-notes.mjs --check`, `zsh -n scripts/release.sh` | ✓ |

## 4. Решения, които блокират работа (ROADMAP §9, накратко)

| # | Решение | Препоръка | Блокира |
|---|---|---|---|
| 1 | Цени и квоти | €4.99 / €9.99 / €19.99 за 250k / 1M / 2.5M токена | S7 |
| 2 | Доставчик на плащания | Paddle (overlay checkout, данъци, desktop лицензи) | S7 |
| 4 | Домейн, фирма, имейл за поддръжка | нужни за `release.url`, `help.url`, Terms/Privacy | S1, S10 |
| 11 | Beta тестери | 3–5 имена + имейли за роля `vip` | S9 |
| 12 | Apple Developer Program, Supabase Pro | купуват се преди S9 | S1, S6 |
