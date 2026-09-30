# Before I Deploy — стратегия и подробен план за развитие (V10 → V12)

Дата: 27.09.2026 · За: собственика и Claude Code · Допълва `AUDIT.md` (какво е приложението днес) и `V10-PLAN.md` (продуктовизация). Този документ е **главният план**: казва накъде отива продуктът, по какви критерии ще мерим „най-доброто“, кои работни пакети следват и в какъв ред, как тестваме и пускаме. `V10-PLAN.md` остава валиден за WP1–WP9 с корекциите в раздел 3.

---

## 0. Резюме на една страница

**Каква е амбицията.** Before I Deploy да бъде най-добрият macOS „control center“ за уеб проекти на самостоятелни разработчици и микро-агенции: от папка с код до жив, наблюдаван и платен от клиента сайт — без нито една команда в терминала, без нищо счупено да стигне до production и без нито един ключ да напусне Mac-а.

**Трите обещания** (всяка функция трябва да подкрепя поне едно):
1. **Нищо счупено не отива live.** Проверки преди deploy, проверка след deploy, връщане назад с един бутон.
2. **Всичко, което може да е автоматично, е автоматично.** Инструменти, входове, DNS, SSL, отчети, напомняния.
3. **Кодът и ключовете остават на твоя Mac.** Keychain, redaction, AI само след клик и само с изчистен контекст.

**Къде сме (27.09.2026).** V9 е стабилна лична версия (40 теста). От V10 са готови като код седмици 1–3: разделен AppModel, пълна i18n (engine + приложение, en/bg, смяна без рестарт), профили/роли/планове, feature gates, VIP AI ключове, Admin панел и `admin` Edge Function. Engine тестове: 46/46. Swift кодът от седмици 1–3 още **не е компилиран** (в облачната среда няма Swift) — първата задача по-долу решава точно това с CI.

**Какво следва (в този ред).**

| Етап | Съдържание | Резултат |
|---|---|---|
| **V10.0** (седмици 4–9) | CI, вграден AI Fix, абонаменти, onboarding, инженерни подобрения от одита, полиране, Developer ID + DMG + сайт | публичен продукт, en + bg |
| **V10.5** (седмици 10–15) | Xcode track: sandbox, бандълван Node, API-базирани deploy-и, StoreKit, App Store review; Shortcuts и widget | Mac App Store |
| **V11** (седмици 16–27) | „Качество и сигурност на сайта“: проверки за съдържание/SEO/достъпност/правни изисквания, rollback и проверка след deploy, наблюдение във фонов режим, env/DNS/имейл здраве, класически хостинг (SFTP), engine демон, native macOS интеграции, светла тема, шаблони за нови сайтове | най-пълният pre-deploy инструмент в нишата |
| **V12** (седмици 28+) | „Агенция в кутия“: клиенти и отчети, екипи, web dashboard, повече AI функции, Windows/Linux клиент | продукт за микро-агенции |

---

## 1. Принципи и как мерим „най-доброто“

### 1.1 Продуктови принципи (допълват AUDIT.md §1)

1. **Zero-terminal.** Всяко действие има бутон. Терминалът е опция, не изискване.
2. **Безопасност по подразбиране.** Production иска `DEPLOY`. Всяко действие, което променя нещо извън проекта (DNS, remote, изтриване), първо показва **план** и иска потвърждение — както днес `connect-domain`.
3. **Обяснявай, не само отказвай.** Всяка грешка има причина, код, бутон „Оправи“ или „Оправи с AI“ и линк към помощ (`…/help/errors/<code>`).
4. **Native first.** Конвенции на macOS: меню лента, клавишни комбинации, известия с действия, Keychain, drag & drop, VoiceOver, системен външен вид (светла/тъмна тема), Services, Shortcuts.
5. **Бързо.** Snapshot на статус < 300 ms; старт на проверка < 1 s; проверка без промени < 10 s (инкрементално); команда към engine-а p50 < 250 ms (с демона).
6. **Честни числа.** Кредити, разходи и квоти са реални и се показват като реални.
7. **Частно.** Без телеметрия без изрично съгласие; нищо чувствително не напуска Mac-а; AI вижда само редактиран контекст и само след клик.
8. **Дисциплина на кода.** Всеки текст през i18n, всяка функция зад `features`, всеки доставчик зад адаптер, всеки WP с тестове и с ред в AUDIT.md §6a.

### 1.2 Измерими цели (KPI)

| Метрика | Цел | Как се мери |
|---|---|---|
| Време от инсталация до първи Draft Preview (нов потребител) | < 10 мин | ръчен QA с хронометър на чист Mac + (опционална) телеметрия |
| Проверка на проект без промени | < 10 s | `check.duration` при cache hit (WP6.2) |
| Пълна проверка | ≤ време за build + 15 s | `check.duration` − `build.duration` |
| Crash-free сесии | ≥ 99.5 % | crash reports (WP6.6) |
| Грешки, хванати преди production | > 95 % от всички неуспехи | история: `blocked` срещу `deploy fail` + post-deploy verification (WP12) |
| Команда към engine (status) | p50 < 250 ms | `engine.log` тайминги (WP18) |
| Съобщения за грешка с код и помощ | 100 % | `i18n-check` + каталог на кодовете (§10.6) |
| Покритие с тестове | engine ≥ 80 теста, Swift ≥ 30, Deno ≥ 15 | CI |

---

## 2. Текущо състояние и незавършени неща

Готово във V10 (седмици 1–3), всичко в клон `claude/nifty-edison-1195gi`:

- **WP6.1** — `Stores/{ProjectStore,AccountStore,HostingStore,RunController,AdminStore}`; `AppModel` е фасада.
- **WP1** — `engine/src/i18n.mjs`, `engine/i18n/{en,bg}.json` (313 ключа), `Localization.swift` + `L()`, `App/Resources/{en,bg}.lproj` (417 ключа), `WelcomeLanguageView`, смяна на езика без рестарт, `scripts/i18n-{check,lib,translate}.mjs`.
- **WP2** — `supabase/schema.sql` v10, `features.mjs`, `aikeys.mjs`, `admin.mjs`, `supabase/functions/admin`, `AdminView`, AI ключове в Настройка, `profiles.locale`.

Готово в седмици 4–5 (виж AUDIT.md §6a): WP6.8 CI, WP3, WP6.2–6.4, WP6.6/6.7/6.9, WP5 (export/delete, тур,
доставчици за вход от облака, първи стъпки), WP7 (грешки с код, клавиатура, каталог на грешките), L6, WP8-A
част 1. **Планът за следващите сесии е в `docs/execution-plan.md`** (S1–S10, в ред на изпълнение).

Седмица 6 (2026-09-28): WP4 (billing през Paddle, пакети, trial, refund), Admin покана/употреба/настройки, S1–S3,
нов визуален език, crash отчети, двуезични имейли. **Проверка точка по точка срещу плана: `docs/v10-checklist.md`.**
Одит V10 (2026-09-28/29): 82 находки, всички затворени — `docs/AUDIT-V10.md`, предаване `docs/HANDOFF-V10.md`.

**V11 (2026-09-29, клон `claude/nifty-edison-1195gi`)** — контролен център за клиентски сайтове, вертикално по
основния поток „добавям → разбирам → проблеми → поправки → preview → публикуване → следене → връщане“:
- готово: единен модел на проблемите (`engine/src/issues.mjs`), проверени поправки (`--recheck`, `ai undo`),
  пускания с preview smoke checks, публикуване на провереното preview, проверка на production, rollback,
  идемпотентност и заключване (`engine/src/release.mjs`, `postdeploy.mjs`), портфолио със сигнали и клиенти,
  наблюдение с инциденти на този Mac (`engine/src/monitor.mjs`), честна граница за backup/CodeGuard;
- WP12 (rollback / post-deploy) ✅ за Netlify; WP13 ✅ локално (без сървърен scheduler — блокер: облачен cron);
  WP10 ✅ (11.1, стъпка `site` + `bid.config.json`), WP19 ✅ (11.1, `bid new` с 2 шаблона), WP11 (Lighthouse) ⏳; WP15/WP16 ⏳; WP17 частично (портфолио, без светла тема).
  Доказателства и ограничения: `docs/AUDIT-V11.md`; архитектура и команди: `docs/V11-HANDOFF.md`.

**V11 release candidate (2026-09-29, `11.0.0-rc.1`)** — завършване до инсталируем кандидат за тест от собственика:
- затворени рискове: SHA-256 manifest на всички файлове (без size+mtime), повторна проверка на артефакта около
  качването, обвързване с build конфигурацията, честно ограничение за SSR, заключване устойчиво на повторно
  използван PID, изолирани undo записи;
- вграден AI асистент с версионирани prompt ресурси, схеми и валидация (`engine/prompts`, `docs/AI-PROMPTS.md`),
  бюджети, undo, цикъл analyze → patch → verify с ограничения, 20 eval сценария;
- „План и използване“ от сървъра (`billing usage`), идемпотентни AI операции, освобождаване на изоставени
  резервации, версия на ценоразписа, `billing sync` (`docs/BILLING-AND-USAGE.md`);
- сървърен мониторинг: Edge функция `monitor` с IP-закрепени проби и SSRF защита, pg_cron scheduler с heartbeat,
  обединени инциденти, прозорци за поддръжка, един външен канал (webhook) — WP13 ✅ (сървърната част е
  **неактивна до** изпълнение на `supabase/monitor-cron.sql` от собственика);
- RLS тестове на истински Postgres (PGlite) за всички таблици; вграден Node runtime в .app (`scripts/bundle-node.sh`);
- блокери за публично пускане: подпис/нотаризация (Developer ID), реален тест на Mac с реален Netlify/Paddle
  sandbox — `docs/OWNER-ACCEPTANCE-TEST-BG.md`; пълният tracker: `docs/RELEASE-CANDIDATE-AUDIT.md`.

**V11.1 „Launchpad“ (2026-09-30, `11.1.0-rc.1`)** — най-лесният път от папка до жив сайт:
- стъпка `site` (WP10): SEO, съдържание, достъпност, бюджети, файлове за пускане; `bid.config.json`; безопасни
  поправки `site.robots / site.sitemap / site.404`; проблеми с файл и ред; AI поправя на ниво страница;
- списък „Пускане“ (`bid launch`, в `status`): папка → проверка → готов за посетители → хостинг → на живо →
  домейн → наблюдение, със следващото действие;
- „Нов сайт“ (WP19): `bid new` с шаблони `landing` и `portfolio` (BG/EN), минават проверката от първия път.

Незавършени от седмици 1–3:

| # | Какво | Защо е важно |
|---|---|---|
| L1 | ~~`swift build` на Swift кода от седмици 1–3~~ — **готово**: CI (`app.yml`) компилира на macos-15 при всеки push; първият run мина | — |
| L2 | ~~Английските литерали в Swift през `L()`~~ — **готово** | — |
| L3 | ~~Бадж „бета превод“~~ — **готово** | — |
| L4 | ~~Плурали~~ — **готово** (`L(key, count:)`) | — |
| L5 | Ръчно пускане на `schema.sql` и `supabase functions deploy admin` в продуктовия облак; `update profiles set role='admin'` | без това Admin панелът не работи |
| L6 | ~~Deno `check`/тестове на `admin` функцията~~ — **готово** (седмица 5): 32 теста за трите функции | — |

---

## 3. Корекции към V10-PLAN.md (научено по пътя)

- **WP1:** каталозите се четат през `Bundle.main` от `<lang>.lproj` в `Contents/Resources` (build.sh ги копира), **не** през `Bundle.module` — при ръчно сглобен `.app` `Bundle.module` търси до изпълнимия файл и се чупи. `.strings` вместо `.xcstrings` е потвърдено правилно за CLT.
- **WP1:** V9 инсталация се разпознава (V9 настройки или `projects.json`) и остава на български без въпрос; само нова инсталация вижда избора на език.
- **WP2:** решения 3 и 5 са константи в `engine/src/features.mjs` (`CLOUD_AI_PROVIDER`, `FREE_CLOUD_SYNC`). Профилът се кешира в `APP_DIR/profile.json` (без secrets) за офлайн. `account sync` връща `skipped:"plan"` за планове без sync — приложението трябва да показва това в AccountBadge, не като грешка.
- **WP2:** `credit_balance` е view със `security_invoker`, така че RLS на `credit_ledger` го филтрира — без отделна политика.
- **WP3:** моделите по план **не** се кодират в engine-а — идват от таблица `settings` (`ai.models`, `ai.multipliers`, `ai.dailyCapPercent`) през `account status`, така че Admin панелът ги сменя без нова версия. Актуални идентификатори към днешна дата: бърз клас `claude-haiku-4-5`, среден `claude-sonnet-5`, най-силен `claude-opus-5` (Дълбока поправка). Нов exit код **8** = `quota_exhausted`; **3** вече се ползва и за `forbidden`.
- **WP3:** моделът връща промените като **SEARCH/REPLACE блокове** (`<<<FILE path>>>` … `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE`, плюс `<<<NEW FILE>>>`/`<<<DELETE FILE>>>`), а не unified diff — точното съвпадение е много по-надеждно от ръчно писани hunk-ове; unified diff-ът за изгледа се изчислява от engine-а (`engine/src/ai/patch.mjs`). Всички доставчици (own-key Anthropic/OpenAI, cloud `ai-fix`) излъчват един и същ поток `delta | usage | done`.
- **WP3:** всеки deploy запис пази `sha` на HEAD (нужно за „какво се промени“ и rollback в WP12) — добавя се сега, за да има история.
- **WP6:** ново **WP6.8 CI** (виж §4.1) — първо в седмица 4. **WP6.9** структурирано логване на engine-а се прави заедно с 6.6.
- **Тестове:** `engine/bid` е zsh; на Linux CI се инсталира `zsh`. Mock Supabase вече има profiles/ledger/admin; всеки нов Edge endpoint първо влиза в mock-а.
- **Ред:** седмица 4 започва с CI и компилация (1–2 дни), после WP3. Общата оценка за V10.0 става 9 седмици (не 8).

---

## 4. Работни пакети (детайлно)

Номерацията продължава V10-PLAN.md (WP1–WP9). За всеки пакет: цел → какво се строи → данни → тестове → готово когато → оценка (агент-дни) → зависимости/рискове. „Готово“ винаги включва: тестове зелени, ключове в `en` и `bg`, ред в AUDIT.md §6a, нула кирилица извън каталозите (`i18n-check`).

### 4.1 V10.0 — довършване (седмици 4–9)

#### WP6.8 — CI и непрекъсната компилация (първо!)

**Цел.** Всеки push да компилира Swift, да пуска engine тестовете и да проверява Edge функциите — така облачната среда без Swift/Deno спира да е сляпа.

**Какво се строи.** `.github/workflows/ci.yml` с три job-а:
- `engine` (ubuntu): `apt-get install zsh`, Node 22, `node tests/run.mjs`, `node scripts/i18n-check.mjs`.
- `app` (macos-15): `cd App && swift build -c release`; `swift test` когда има тестове (WP6.7); артефакт: бинарният файл (за ръчен smoke).
- `functions` (ubuntu + Deno 2): `deno check supabase/functions/*/index.ts`, `deno test supabase/functions`.
- Бадж в README; задължителни статус проверки за клона по подразбиране (настройка в GitHub, ръчно от собственика).

**Готово когато** зелен workflow на текущия клон; compile грешките от седмици 1–3 са оправени. **Оценка:** 1–2 дни. **Риск:** macOS runner-ите за частни репота имат лимит минути (10× множител) — при нужда `app` job само при промяна в `App/**`.

#### WP3 — Вграден AI Fix (own-key първо, после cloud)

**Цел.** Както в V10-PLAN.md WP3, с уточненията от §3.

**Engine (`engine/src/ai/`).**
- `provider.mjs` — адаптер `{ stream({model, system, messages, maxTokens}) → async iterator {delta|usage|done}}`; имплементации `anthropic.mjs` (Messages API, SSE, `output_config.effort`), `openai.mjs` (за own-key потребители с OpenAI ключ), `cloud.mjs` (към Edge Function `ai-fix`, същият формат).
- `prompt.mjs` — преизползва `aifix.buildPrompt`; системен prompt **от i18n каталога** (`ai.system.fix`), изисква отговор: обяснение + блокове `--- FILE path` с unified diff; лимит 60k символа с умно съкращаване на лога (последните редове + редовете с error).
- `patch.mjs` — парсва diff блоковете, отхвърля пътища извън проекта и символни връзки, `git apply --check` (или собствен dry-run без repo), връща `{file, hunks, additions, deletions, preview}`; `apply --yes` записва, по избор auto-commit „AI fix: <step>“.
- Команди: `bid ai fix --project P --step S [--model M|--deep]` (стрийм), `bid ai apply --project P --patch-file F --yes [--commit]`, `bid ai usage`, `bid ai explain --project P --step S` (кратко обяснение, евтин модел).
- Redaction задължителна преди всяко изпращане; prompt файловете в кеша се трият след успешен отговор (виж WP-S по-долу).
- `deploy` записът получава `sha`.

**Edge Function `ai-fix`** (Deno): JWT → profile → нормален потребител изисква активен абонамент и баланс > 0 (иначе `quota_exhausted`, HTTP 402); rate limit 6/мин и 60/час (таблица `ai_rate`); дневен таван 15 % от месечната квота; стрийм към клиента; при край `ai_usage` + `credit_ledger` (−charged_tokens, първо `plan`, после `topup`); при прекъснат стрийм таксува само отчетените токени. Ключът на Anthropic е само в Supabase secrets.

**Приложение.** `AIPanel` в RunOverlay: „Оправи с AI“ → стрийм с Markdown → списък файлове с diff (side-by-side `DiffView`) → чекбокс по файл → „Приложи избраните“ → нова проверка автоматично (настройка). Индикатор „Остават N токена · подновява се на дата“. За normal без план: карта с плановете (WP4). За vip без ключ: линк към Настройка → AI ключове.

**Тестове.** Mock `ai-fix` (стриймва фиксиран отговор с diff) и mock Anthropic SSE в `tests/run.mjs`: prompt е редактиран; diff се прилага само с `--yes`; файл извън проекта се отхвърля; `quota_exhausted` → exit 8; own-key без ключ → ясна грешка; usage се записва. Deno тестове на функцията: 401/402/403/429/200.

**Готово когато** normal с план и vip със собствен ключ прилагат diff и повторната проверка минава; балансът намалява с реалните токени. **Оценка:** 7 дни.

#### WP4 — Абонаменти, кредити, `BillingProvider`

Както в V10-PLAN.md. Допълнения: `BillingProvider` протокол в Swift и `engine/src/billing.mjs` (полинг на `usage`); Paddle overlay checkout с `custom_data.user_id`; webhook с идемпотентност; `subscriptions` → `profiles.plan`; месечен грант/expiry; пакети (`bucket='topup'`); trial 7 дни High; страница „Абонамент“ (история от `ai_usage`, дата на подновяване, пакети, портал). **Блокира се от решения 1 и 2 (§9).** **Оценка:** 7 дни.

#### WP5 — Onboarding, Apple/GitHub вход, изтриване на акаунт

Както в плана: Език (готово) → Добре дошъл (3 екрана стойност) → Вход (email, GitHub, Apple) → План (с „продължи с Free“) → Setup wizard (само задължителните за ролята) → Първи проект. `delete_me` Edge функция (анулира абонамент, `auth.admin.deleteUser`), експорт на данни (JSON) за GDPR. **Оценка:** 5 дни.

#### WP6 — Инженерни подобрения (6.2–6.7 + 6.9)

- **6.2 Инкрементален check.** Fingerprint = `git rev-parse HEAD` + hash на `git status --porcelain` + hash на lockfile + hash на `bid.config.json` + версия на Node. Кеш по стъпка в `state/<key>.json` (`stepCache[step] = {fingerprint, result}`); `lint/typecheck/build` се пропускат при съвпадение с последен `pass` и наличен build output; UI бадж „от кеша“ и „Пълна проверка“ (⌥⌘R). Lint и typecheck вървят паралелно. **3 дни.**
- **6.3 Версии и self-update.** `VERSION` файл — единствен източник (build.sh го пише в Info.plist и `bid.mjs`); `bid update check` → `https://<домейн>/releases/latest.json` (версия, минимална версия, бележки, URL на DMG, sha256, подпис); банер в приложението; изтегляне + проверка на sha256 + отваряне на DMG; канал `stable|beta`. **3 дни.**
- **6.4 Сираци на Local Preview.** Сканиране 4173–4300 за header `X-BID-Project`; осиновяване/спиране. **1 ден.**
- **6.5 Реални тестове на Vercel/Cloudflare/GH Pages.** Тестови акаунти, `docs/manual-qa.md`, парсене на preview URL от реалния изход. **2 дни + акаунти от собственика.**
- **6.6 + 6.9 Грешки и логове.** `os_log` категории в приложението; `engine.log` (NDJSON, нива, тайминги на всяка команда) с ротация; необработени грешки в engine-а → `engine.log`; „Изпрати доклад“ пакетира последните логове **след redaction** в zip → Edge Function `support` → имейл (Resend) с номер на тикет; crash handler в Swift (сигнали + NSException) пише минимален отчет. **3 дни.**
- **6.7 Swift тестове.** `App/Tests/`: `EngineOutcome` парсер, декодиране на всички модели от NDJSON фикстури (`tests/fixtures/*.ndjson` — генерирани от engine тестовете, така че двата слоя се проверяват срещу един и същ JSON), `Localization` fallback, `Features` декодиране, `BillingProvider` mock. `swift test` в CI. **3 дни.**

#### WP7 — Дизайн и UX на новите екрани

Както в плана (Welcome/Language готово; Plans, Account, Admin ✓, AIPanel, Setup по роля). Добавя се: празни състояния за всеки екран, единна система за грешки (карта с код + „Помощ“ + „Оправи с AI“), клавиатурна навигация на всички листи. Светлата тема е във V11 (WP17), защото засяга всеки изглед. **4 дни.**

#### WP8-A — Пускане (Developer ID, DMG, сайт)

> Статус: скриптовете и runbook-ът са готови (`scripts/release.sh`, `docs/release.md`); остава акаунтът и самият release.

Както в плана + Homebrew cask в собствен tap (`brew install --cask before-i-deploy`) — разработчиците го очакват; `scripts/release.sh` прави и cask формулата. Проверка: `xcrun notarytool`/`stapler` са налични и с Command Line Tools (ако не — release се прави от Mac с Xcode). **4 дни + акаунт Apple Developer.**

**Общо V10.0: ~45 агент-дни ≈ 9 седмици при един агент/разработчик, с 1 седмица резерв за QA (раздел 6).**

### 4.2 V10.5 — Mac App Store (Xcode track)

Както в V10-PLAN.md WP8-B, с два принципа: (1) Xcode проектът се **генерира** от `project.yml` (XcodeGen), за да остане репото декларативно и CLT пътят да работи паралелно; (2) всичко, което Xcode отключва, се планира тук:

- App Sandbox, entitlements, security-scoped bookmarks за проекти.
- Бандълван Node (arm64 + x86_64) и статичен `git`; deploy-и през REST API (Netlify Deploy API с digest на файлове, Vercel Deployments API, Cloudflare Pages Direct Upload, GitHub Contents/Pages API) — CLI-тата стават опционални ускорители. Това пътем решава и „Node не е намерен“ за не-dev потребители.
- Keychain през Security framework; secrets към engine-а по stdin.
- **Shortcuts (App Intents):** „Провери проект“, „Draft preview“, „Статус на всички сайтове“ — App Intents метаданните се извличат само от Xcode build.
- **Widget** (WidgetKit extension): статус на портфолиото / изисква внимание.
- StoreKit 2 `StoreKitBilling`, App Store Server Notifications V2 → `billing-webhook`.
- App Store Connect: локализирани описания (генерирани от каталозите), скрийншоти, App Privacy, demo акаунт с High план, Review Notes.

**Оценка:** 6 седмици. **Риск:** review (изпълнение на потребителски build скриптове; външни линкове за плащане се скриват в MAS билда през `features`).

### 4.3 V11 — „Качество и сигурност на сайта“ (WP10–WP19)

#### WP10 — Проверки на съдържание, SEO, достъпност и правни изисквания

**Цел.** Проверката хваща не само дали build-ът минава, а дали сайтът е **готов за клиент**: без lorem ipsum, без счупени линкове, с мета данни, с 404, с правните страници за държавата.

**Механизъм.** Нова стъпка `site` (категория „Site Quality“) върху build output-а (`publishDir`) и — за SSR — върху локален preview (GET на страниците от sitemap). HTML се разбира от малък собствен токенизатор `engine/src/vendor/html.mjs` (~200 реда; engine-ът остава без npm зависимости). Правила в `engine/src/checks/site/*.mjs`, всяко с `id, severity, fix?, docs`:

| Група | Правила (severity по подразбиране) |
|---|---|
| SEO | `<title>` (fail ако липсва; warn ако < 10 или > 70 знака), `meta description` (warn), дублирани заглавия (warn), `<html lang>` (warn), canonical (info), `og:title/og:image` (info), `robots.txt` (warn), `sitemap.xml` (warn), `noindex` на production (fail), favicon + apple-touch-icon (warn) |
| Съдържание | lorem ipsum / placeholder текст (**fail**), placeholder изображения (fail), линкове към `localhost`/`127.0.0.1` (**fail**), счупени вътрешни линкове и липсващи assets (fail), `http://` ресурси в https сайт (warn), празни `href="#"` (info), `TODO/FIXME` в HTML (warn) |
| Достъпност | `<img>` без `alt` (warn, брой), input без label (warn), бутони без текст (warn), контраст — по-късно през Lighthouse (WP11) |
| Assets | изображение > 500 KB (warn), страница > 3 MB (warn), `img` без размери (info), не-минифициран JS > 1 MB (info) |
| Правни (по държава на проекта) | линк към политика за поверителност (warn), бисквитки: открит GA/gtag/fbq/hotjar без consent банер (warn, EU), Impressum за DE/AT (warn), общи условия при магазин (info) |
| Структура | 404 страница (warn), `_redirects`/`netlify.toml` синтаксис (fail при грешка), `www`↔apex редирект след deploy (WP12) |

Конфигурация: `bid.config.json` в проекта (commit-ва се): `{ "country": "BG", "site": { "disable": ["seo.canonical"], "severity": { "content.lorem": "warn" }, "budgets": { "imageKB": 800 } } }` + `.bidignore` (glob-ове). Всяко правило има `fix` (напр. създава `robots.txt`, `404.html`, добавя `lang`) или AI Fix prompt. UI: нова плочка в HealthGrid, детайли по правило с „Отвори файла на реда“.

**Тестове.** Фикстури с нарочно счупени сайтове; всяко правило има positive/negative тест; `bid.config.json` променя severity. **Оценка:** 8 дни.

#### WP11 — Производителност и Lighthouse („Дълбока проверка“)

Опционална стъпка `perf` (по бутон „Дълбока проверка“, не в стандартния check): `npx lighthouse` срещу Local Preview (mobile + desktop), бюджети (`performance ≥ 80`, LCP < 2.5 s), топ 5 препоръки с AI Fix prompt; резултатът се пази в history, тенденция по deploy-и в CostsView/Overview. **4 дни.**

#### WP12 — Безопасност на deploy-а: rollback, проверка след deploy, „какво се промени“

- **Rollback** през адаптерите: Netlify `restoreSiteDeploy` (API), Vercel `vercel rollback`, Cloudflare Pages API rollback, GH Pages — редеплой на предишен `sha`. Матрица на възможностите се показва честно (какво може всеки хостинг). Бутон „Върни предишната версия“ в NetlifyCard/GenericHostingCard и в известието при неуспешна проверка след deploy.
- **Проверка след deploy** (`postdeploy`): homepage + до 20 URL от sitemap → 200, `<title>`, http→https, www↔apex, TTFB; резултат в history; при неуспех: известие с действие „Rollback“ (UNNotificationCategory с бутони).
- **„Какво се промени“**: `git log <lastProd.sha>..HEAD` + `diff --stat` → AI (евтин модел, кредити) → обяснение на прост език за клиента с „Копирай“ (на езика на проекта/клиента). Показва се преди Production и в историята.
- **Deploy по график** (опционално): планира се с `launchd` one-shot; при изпълнение прави свежа проверка, известие 10 мин преди с „Отказ“; `DEPLOY` се въвежда при планирането. **Общо 6 дни.**

#### WP13 — Наблюдение във фонов режим и известия

- Headless режим на същия бинарен файл: `BeforeIDeploy --agent` (в бандъла → валиден bundle identifier → UNUserNotificationCenter работи без extension). `launchd` агент `bg.yavor.beforeideploy.watch.plist` (StartInterval 300) го пуска; той вика `bid watch --once`: uptime (HEAD, 5 s timeout), SSL дни (веднъж дневно), домейни (веднъж дневно, кеш), Netlify кредити (на час), DNS drift (веднъж дневно). Резултат в `state/monitor.json`; инциденти в `incidents.jsonl`; известия с действия („Отвори“, „Провери“, „Rollback“).
- Настройка „Наблюдавай сайтовете във фонов режим“ (инсталира/маха plist-а със съгласие), интервал, тихи часове.
- Меню лента (WP17) показва „N сайта онлайн · 1 изисква внимание“.
- **Оценка:** 5 дни.

#### WP14 — Паритет на env и конфигурация

- Сравнява ключовете в `.env.example`/`.env` с env на хостинга (`netlify env:list --json`, `vercel env ls`); липсващи на хостинга → warn със „Задай“ (стойността се пише в приложението и отива към CLI; никога не се записва).
- Валидира `netlify.toml`, `_redirects`, `_headers`, `vercel.json` (синтаксис + типични грешки: SPA fallback липсва при client-side routing).
- **Оценка:** 3 дни.

#### WP15 — DNS доставчици и здраве на DNS/имейл

- Адаптери `engine/src/providers/dns/{spaceship,cloudflare}.mjs` (Cloudflare DNS е най-разпространеният при клиенти) и `registrar/{spaceship,cloudflare,porkbun}.mjs`; `connect-domain` за Vercel, Cloudflare Pages и GH Pages (днес само Netlify); `www` редирект.
- Проверка `dns-health` (Node `dns` модул, без външни зависимости): A/AAAA на apex, CNAME www, MX, SPF (един запис, валиден синтаксис), DMARC (присъствие и политика), CAA (info), DNSSEC (info). Резултатът влиза в „Домейни“ и в Mission Control „изисква внимание“ (напр. „SPF липсва — писмата на клиента могат да отиват в спам“).
- **Оценка:** 6 дни.

#### WP16 — Класически хостинг (SFTP/rsync) и експорт

Много сайтове на малки бизнеси живеят на споделен хостинг (cPanel). Адаптер `classic`: `rsync -az --delete --checksum -e ssh` (rsync и ssh са в macOS) с SSH ключ, генериран от приложението (публичният ключ се копира в cPanel); FTP fallback през `curl`. Draft = качване в поддиректория `_preview/`; production = основната директория с `DEPLOY`. „Експортирай build като zip“ за ръчно качване. Credentials в Keychain. **5 дни.**

#### WP17 — Native macOS интеграции и външен вид

- `MenuBarExtra` (SwiftUI, macOS 13): статус на всички проекти, бързи действия (Провери, Draft, Отвори live), инциденти от WP13; опция „Само в меню лентата“ (`setActivationPolicy(.accessory)`).
- Drag & drop на папка върху прозореца и върху иконата в Dock (`CFBundleDocumentTypes` с `public.folder`).
- Services меню: „Провери с Before I Deploy“ за папки (`NSServices` в Info.plist, `NSApp.servicesProvider`).
- Dock badge: брой blocked проекти/инциденти.
- Известия с действия (категории: deploy, check, monitor).
- **Системен външен вид (светла/тъмна)**: `Theme` → семантични цветове (NSColor с двa варианта), настройка System/Dark/Light; премахване на принудения `darkAqua`; преглед на всеки изглед.
- Достъпност: `accessibilityLabel` на всички икон-бутони (от `help`), пълна клавиатурна навигация, `reduceMotion`, минимален контраст 4.5:1 за текст.
- Възстановяване на прозореца и последния екран; втори прозорец за лог (⌘⇧L?) — по желание.
- Shortcuts/App Intents и Widget остават в Xcode track (V10.5).
- **Оценка:** 8 дни (от които 4 за светлата тема).

#### WP18 — Engine демон, производителност, наблюдаемост

- `bid daemon`: Unix socket `APP_DIR/bid.sock`, NDJSON заявки `{id, argv, env}` → събития `{id, type: step|log|notify|result}`, `{id, cancel: true}`; ръкостискане с версия (стар демон се спира при update); излиза след 10 мин без работа. `EngineClient` опитва socket, иначе spawn (същият протокол → нула промени в изгледите). CLI също минава през демона, ако работи.
- Ефект: Node стартира веднъж; кеширани `which`, `detect`, статуси; `fs.watch` на проекта обновява статуса без бутон „Обнови“.
- Паралелни стъпки (lint ∥ typecheck), кеш на `detect` по mtime, `status` без git при непроменено дърво.
- `engine.log` тайминги на команда → метрики за KPI; `bid doctor --full` (само-диагностика с 20 проверки).
- **Оценка:** 7 дни. **Риск:** два пътя (socket/spawn) → тестовете пускат целия пакет и по двата.

#### WP19 — Шаблони и „Нов сайт“ wizard

Собствено repo с курирани шаблони (Astro static, Vite + React, 11ty, Next static export) с вграден baseline: SEO мета, sitemap, robots, 404, favicon сет, `netlify.toml`, `.gitignore`, `.env.example`, страници „Поверителност/Условия/Impressum“ по държава, аналитика с consent. Wizard: име, клиент (V12), framework, езици, държава → папка, `git init`, първа проверка, GitHub repo, хостинг → Draft Preview. Цел: „нов клиентски сайт за 5 минути“. **5 дни.**

**Сигурност (напречен пакет WP-S, върви през V11):** `.bidignore` и entropy-базирано откриване на secrets (допълва regex-ите); `npm audit --json` като стъпка `deps` (warn при high/critical); проверка на лицензи (info); Spaceship/AI ключове към engine-а по stdin вместо env; prompt файловете в кеша се трият след употреба; подпис на engine файловете (sha256 manifest, проверен от приложението при старт); rate limits и размери на всички Edge функции; проверка на Edge функциите с `deno check` в CI.

**Общо V11: ~57 агент-дни ≈ 12 седмици.**

### 4.4 V12 — „Агенция в кутия“ (WP20–WP24)

- **WP20 Клиенти и отчети.** Обект „клиент“ (име, контакт, държава, проекти), екран „Клиенти“, месечен отчет per клиент (HTML → PDF през WKWebView: uptime, deploy-и, какво се промени, разходи, изтичащи домейни/SSL) с „Изпрати“ (mailto/копирай), напомняния за подновявания. **6 дни.**
- **WP21 Екипи и споделяне.** Покана на сътрудник (read-only / deploy), споделени метаданни, activity feed; RLS по `team_id`. **6 дни.**
- **WP22 Web dashboard** (Next.js на Vercel): акаунт, абонамент, usage, публична статус страница per проект с токен (WP9). **8 дни.**
- **WP23 Windows/Linux клиент** (Tauri) над същия engine и демон протокол. **10+ дни.**
- **WP24 Още AI (през кредити):** commit съобщения, release notes, alt текстове за изображения, SEO мета предложения, обяснение на грешка от build, „питай за този проект“ чат с редактиран контекст. **6 дни.**

---

## 5. Целева архитектура (V11+)

```
┌───────────────────────────── Mac ─────────────────────────────┐        ┌──────────────── Supabase ───────────────┐
│ Before I Deploy.app (SwiftUI)                                  │        │ Auth · profiles · subscriptions          │
│  ├─ Stores (Project/Account/Hosting/Run/Admin/Billing)         │  JWT   │ credit_ledger · ai_usage · settings      │
│  ├─ L() i18n · features gates · Theme (light/dark)             │ ─────▶ │ Edge: admin · ai-fix · billing-webhook   │
│  ├─ MenuBarExtra · Services · Drag&Drop · Notifications        │        │       support · usage · delete_me        │
│  └─ EngineClient ── unix socket ──▶ bid daemon ──┐             │        │ Storage: releases (latest.json, DMG)     │
│        (fallback: spawn `bid …`)                 │             │        └──────────────────────────────────────────┘
│ BeforeIDeploy --agent (launchd, наблюдение) ─────┤             │
│                                                  ▼             │        Paddle / StoreKit ─▶ billing-webhook
│  engine (Node, без npm зависимости)                            │
│   ├─ checks/  git secrets deps lint typecheck build hosting    │        Netlify · Vercel · Cloudflare · GitHub
│   │           site perf postdeploy dns-health env              │ ◀────▶ Spaceship · Cloudflare DNS · SFTP хост
│   ├─ providers/ hosting/ dns/ registrar/ ai/  (адаптери)       │        Anthropic (own-key) / ai-fix (cloud)
│   ├─ ai/ prompt · stream · patch                               │
│   ├─ i18n/ · features · store · costs · overview · watch       │
│   └─ engine.log (NDJSON) · state/ · history · ledger           │
└────────────────────────────────────────────────────────────────┘
```

Принципи: engine-ът остава самостоятелен CLI с NDJSON (инвариант 1) — демонът е транспорт, не нов протокол; всеки външен доставчик е адаптер с еднакъв интерфейс; проверките са приставки с манифест; приложението е тънък клиент, който рисува събития.

---

## 6. График и етапи

| Седмица | Пакети | Резултат / критерий |
|---|---|---|
| 4 | **WP6.8 CI** (ден 1–2), L1–L6, WP3 engine (own-key) | CI зелен на macOS + Linux + Deno; `bid ai fix` работи със собствен ключ |
| 5 | WP3 `ai-fix` функция + AIPanel + diff apply | вграден AI end-to-end; тестове с mock стрийм |
| 6 | WP4 схема за билинг + Paddle sandbox + webhook + Plans/Account екрани | абонамент активира High за < 30 s (sandbox) |
| 7 | WP5 onboarding, Apple/GitHub вход, изтриване; WP6.2–6.4 | пълен поток за нов потребител; инкрементален check |
| 8 | WP6.5–6.7, WP7 полиране, `docs/manual-qa.md` | Swift тестове в CI; QA чеклист минат на 2 езика |
| 9 | **QA седмица** (раздел 7) + WP8-A: Developer ID, notarization, DMG, cask, сайт, Paddle live | **V10.0 публичен** |
| 10–15 | V10.5 Xcode track (§4.2) | **V10.5 в Mac App Store** |
| 16–17 | WP18 демон + WP-S сигурност | бърз engine, наблюдаемост |
| 18–19 | WP10 site quality + WP14 env паритет | „готов за клиент“ проверка |
| 20–21 | WP12 rollback/postdeploy/промени + WP13 наблюдение | безопасен deploy, фонов монитор |
| 22–23 | WP15 DNS/имейл + WP16 класически хостинг | повече домейни и хостинги |
| 24–26 | WP17 native + светла тема; WP11 Lighthouse; WP19 шаблони | **V11.0** |
| 27+ | V12 пакети по приоритет от обратната връзка | V12.x |

Всяка седмица завършва с: `node tests/run.mjs` зелен, CI зелен, `Install Before I Deploy.command` на Mac-а на собственика и ръчна проверка на чеклиста (AUDIT.md §8 + `docs/manual-qa.md`). Всяка версия има бележки в `CHANGELOG.md` (на en и bg, генерирани от commit-ите + ръчна редакция).

---

## 7. План за тестване и качество („накрая ще тестваме“ — и по пътя)

### 7.1 Автоматични тестове

| Слой | Инструмент | Днес | Цел V10.0 | Цел V11 |
|---|---|---|---|---|
| Engine | `node tests/run.mjs` (mock Supabase, Spaceship, Anthropic) | 58 | 80 (AI, billing, update, cache) | 130 (site, dns, rollback, daemon по двата пътя) |
| i18n | `scripts/i18n-check.mjs` | ✓ | + плурали, + бета бадж | + всички езици |
| Swift | `swift test` (парсери, модели от NDJSON фикстури, Localization, Features, Billing mock) | 34 | 30 | 60 |
| Edge Functions | `deno check` + `deno test` с фикстури (JWT, Paddle/Apple webhooks) | 49 | 15 | 30 |
| Записани CLI изходи | „replay“ фикстури от реалните `netlify/vercel/wrangler/gh` изходи за парсерите | 0 | 10 | 20 |
| CI | GitHub Actions: ubuntu (engine, i18n, deno), macos (swift build/test, node tests) | — | задължителни проверки | + nightly пълен QA скрипт |

Правило: фикстурите NDJSON, които Swift тестовете декодират, се **генерират от engine тестовете** — така двата слоя не могат да се разминат тихо.

### 7.2 Ръчен QA чеклист (`docs/manual-qa.md`, за всяка версия)

1. **Инсталация**: чист Mac (VM или втори акаунт) без Node → ясно съобщение; с Node през nvm/volta/brew; upgrade от V9 (езикът остава bg, проектите са тук).
2. **Onboarding**: език → добре дошъл → регистрация (email потвърждение) → GitHub → Apple → Free/план → Setup → първи проект; „Продължи без акаунт“ и връщане.
3. **Роли**: normal free (лимит 2 проекта, без sync, без Admin), normal High (AI cloud, кредити намаляват), vip (ключове, без план), admin (панел, одит).
4. **Проверка**: static, Vite, Next SSR, failing build; инкрементално (2-ра проверка < 10 s); стъпка по стъпка детайли; AI Fix външно и вградено; прилагане на diff и повторна проверка.
5. **Deploy**: Netlify draft/prod (с `DEPLOY`), Vercel, Cloudflare, GH Pages (тестови акаунти); guard-ове (stale, blocked, без confirm); rollback (V11); проверка след deploy (V11).
6. **Local Preview**: старт/стоп/рестарт, сирак на 4173, dev режим, лог.
7. **Git**: commit избрани файлове, push без remote, remote нормализация, GitHub repo create.
8. **Домейни**: Spaceship connect с грешен/верен ключ, DNS, connect-domain план и изпълнение, изтичащ домейн в Mission Control.
9. **Разходи**: ценоразпис редактиран остава; usage от Netlify; бюджет предупреждение.
10. **Език**: смяна bg↔en без рестарт на всички екрани; съобщения от engine-а; числа/дати; профил на друг Mac.
11. **Известия, меню лента, drag & drop, Services** (V11).
12. **Офлайн**: без мрежа — приложението работи локално, sync/AI дават ясни съобщения, профилът е от кеша.
13. **Достъпност**: VoiceOver през основните екрани; само с клавиатура: добави проект → провери → deploy.
14. **Сигурност**: `ps` по време на връзка с ключ; grep на кеша за ключове; prompt файлове изтрити; Keychain записи.
15. **Update**: банер за нова версия, изтегляне, sha256, канал beta.

### 7.3 Критерии за пускане на V10.0

- Всички автоматични тестове зелени в CI; 0 известни crash-ове в beta седмицата.
- QA чеклистът минат на bg и en, на macOS 13, 14, 15.
- Paddle sandbox → live тест с реална карта и refund.
- Notarization минава; Gatekeeper отваря DMG без предупреждение на чист Mac.
- Privacy Policy, Terms, Refund policy публикувани; изтриване на акаунт работи.
- Rollback план: предишният DMG остава в `releases/`, `latest.json` може да се върне за 1 минута.

### 7.4 Beta програма

3–5 VIP приятели (роля `vip`, безплатно) 1 седмица преди всяка версия; форма за обратна връзка от приложението („Изпрати доклад“ + текст); crash reports; списък „топ 10 дразнещи неща“ се решава преди release.

---

## 8. Рискове и смекчаване

| Риск | Вероятност / ефект | Смекчаване |
|---|---|---|
| Swift кодът от облачната среда не компилира | висока / блокира | CI на macOS от седмица 4, ден 1; малки commit-и |
| Apple review отхвърля (build скриптове, външни плащания) | средна / забавя V10.5 | коловоз A първи; MAS билд крие Paddle през `features`; Review Notes; прецеденти |
| Supabase free tier паузира проекта | висока / срив за всички | Pro план преди V10.0; monitoring на функциите; статус страница |
| Недокументирани Netlify полета се сменят | средна / грешни числа | „replay“ фикстури; graceful degradation („Netlify не върна лимити“) |
| AI разходите надхвърлят приходите | средна / загуба | дневен таван 15 %, лимит на prompt, alert към admin при 80 % от бюджета, `settings.ai.models` сменяеми без release |
| Node/nvm на машината на потребителя | средна / „не работи“ | бандълван Node във V10.5; `doctor` с ясни стъпки; Setup бутон |
| CLT-only ограничения (Shortcuts, widgets, sandbox) | сигурна / липсващи native функции | Xcode track V10.5 с XcodeGen; CLT пътят остава за бърза итерация |
| Машинни преводи с грешки | висока / доверие | бадж „бета превод“, `reviewed` флаг, glossary, лесно докладване на грешка в превод |
| Един разработчик/агент | сигурна / темпо | седмичен ритъм, CI, чеклист, резервна QA седмица; V11/V12 пакетите са независими и могат да се преподреждат |
| Изтичане на ключове през логове/prompt-ове | ниска / критична | redaction преди всеки изход, тестове за изтичане, ключове по stdin (WP-S), триене на prompt файлове |

---

## 9. Решения за собственика (с препоръка и срок)

| # | Решение | Препоръка | Нужно преди |
|---|---|---|---|
| 1 | Цени и квоти Flash/High/Knight | приеми таблицата от V10-PLAN WP4 (€4.99/€9.99/€19.99; 250k/1M/2.5M); ако тежките потребители са много — Knight → 2M или €24.99 | седмица 6 (WP4) |
| 2 | Paddle или Lemon Squeezy | **Paddle**: overlay checkout, по-зряла поддръжка за desktop лицензи и данъци; Lemon Squeezy е част от Stripe от 2024 г. и посоката му за desktop е по-малко ясна | седмица 6 |
| 3 | Централен AI доставчик | Anthropic (готово като константа) | ✓ прието по подразбиране |
| 4 | Домейн, име на фирмата (Terms/Privacy), имейл за поддръжка | нужни за сайта, имейлите и `latest.json` | седмица 7 |
| 5 | Free план с cloud sync? | **не** (готово като константа); Free = 2 проекта, външни AI бутони | ✓ прието по подразбиране |
| 6 | Езици за V10.0 | ✓ en + bg; V10.1: de, es, fr, it, pt-BR, pl, ro, tr след преглед | — |
| 7 | Кога започва Xcode track | веднага след V10.0 (седмица 10), проектът се генерира с XcodeGen | седмица 9 |
| 8 | Светла тема | да, във V11 WP17 | седмица 16 |
| 9 | Анонимна телеметрия (opt-in) | да, само агрегати (времена, статуси), без имена/пътища; въпрос при onboarding | седмица 7 |
| 10 | Класически хостинг (SFTP) | да, ако ≥ 2 от beta тестерите го искат | седмица 20 |
| 11 | Beta тестери | 3–5 имена + имейли за `vip` | седмица 8 |
| 12 | Apple Developer Program ($99/год.) и Supabase Pro | купуват се в седмица 8 | седмица 8 |

---

## 10. Нови инварианти (добавят се към AUDIT.md §4 и V10-PLAN §4)

17. Engine-ът няма npm зависимости; малки vendored помощници живеят в `engine/src/vendor/` с лиценз и версия в заглавието.
18. Всяка външна услуга (хостинг, DNS, регистратор, AI, билинг) е адаптер зад общ интерфейс; UI никога не вика доставчик директно.
19. Всяка проверка е приставка с манифест (`id, category, severity, requires, parallel`) и има positive/negative тест.
20. Всеки код на грешка (`EngineError.code`) е уникален, документиран и има страница за помощ; приложението показва кода.
21. Демонът и spawn пътят говорят един и същ NDJSON протокол; тестовете минават и по двата.
22. Фонови процеси (`--agent`, `launchd`) се инсталират само с изрично съгласие и се махат при изтриване на приложението/акаунта.
23. Секрети към engine-а се подават по stdin или Keychain — не по argv, а по env само там, където CLI на доставчика не позволява друго (документирано).
24. Всяка стойност, показана като „кредити“, „цена“ или „квота“, идва от източник на истина (ledger, API на доставчика, ценоразпис) — никога изчислена наум.
25. Всяка нова версия има `CHANGELOG.md` запис на en и bg и е инсталируема върху предишната без ръчни стъпки (миграции в engine-а).

---

## 11. Приложение: спецификации

### 11.1 Протокол на демона (WP18)

```
client → daemon   {"id":"r1","argv":["check","--project","abc"],"env":{"BID_LANG":"bg"}}
daemon → client   {"id":"r1","type":"step",...}  {"id":"r1","type":"log",...}  {"id":"r1","type":"result",...}
client → daemon   {"id":"r1","cancel":true}
daemon → client   {"type":"hello","version":"11.0.0","pid":123}   (при връзка; клиентът затваря при несъвпадение на major)
```
Socket: `APP_DIR/bid.sock` (0600). Стартира се от `EngineClient` при първа нужда (`bid daemon --idle 600`). `bid daemon stop`.

### 11.2 Манифест на проверка (WP10+)

```js
export const manifest = { id: 'site', label: t('check.step.site'), category: 'Site Quality', requires: ['build'], parallel: true, optional: false };
export async function run(ctx) { /* → { status, summary, details[], fixes[], findings: [{ rule, severity, file, line, message, fix }] } */ }
```

### 11.3 Интерфейси на адаптери (WP12, WP15, WP16)

```js
// providers/hosting/<name>.mjs
export const meta = { id, name, cli, npm, ssr, preview, commercialFree, free, note, pricing };
export const status = () => ({ installed, loggedIn });
export const link = (project, opts) => …;
export const deploy = (project, { prod }) => ({ url, deployId, sha, duration, log });
export const listDeploys = (project) => [{ id, url, sha, at, prod }];
export const rollback = (project, deployId) => …;          // null ако не се поддържа
export const envList = (project) => [{ key, scope }];       // без стойности
export const envSet = (project, key, value) => …;
// providers/dns/<name>.mjs: records(domain) · set(domain, records[]) · zones()
// providers/registrar/<name>.mjs: domains() · expiry(domain) · autoRenew(domain)
// providers/ai/<name>.mjs: stream({ model, system, messages, maxTokens }) → async iterator { delta | usage | done }
```

### 11.4 `bid.config.json` (в проекта) и `.bidignore`

```json
{ "country": "BG", "hosting": "netlify", "checks": { "disable": ["seo.canonical"], "severity": { "content.lorem": "warn" } },
  "budgets": { "imageKB": 800, "pageMB": 3, "lighthouse": 80 }, "postdeploy": { "urls": ["/", "/kontakti"] } }
```
`.bidignore` — glob-ове, изключени от secrets и site проверките (напр. `docs/**`, `*.min.js`).

### 11.5 Ключове в cloud таблица `settings` (Admin панел)

`ai.models = { flash: "claude-haiku-4-5", high: "claude-sonnet-5", knight: "claude-sonnet-5", deep: "claude-opus-5" }` · `ai.multipliers = { deep: 5 }` · `ai.dailyCapPercent = 15` · `ai.promptMaxChars = 60000` · `plans = { flash: { tokens: 250000, priceEUR: 4.99 }, … }` · `release = { minVersion: "10.0.0" }` · `alerts.aiBudgetUSD = 200`.

### 11.6 Каталог на кодовете за грешки

Всеки `EngineError.code` се описва в `docs/errors.md` (генерира се от `engine/src/errors.json`: код → ключ на i18n съобщение → exit код → помощ). `i18n-check` проверява, че всеки код, използван в кода, е в каталога. Приложението показва „Помощ“ → `https://<домейн>/help/errors/<code>` (fallback към локален текст офлайн).

### 11.7 Категории известия (UNNotificationCategory)

`check` (Отвори лога · Оправи с AI) · `deploy` (Отвори preview · Rollback) · `monitor` (Провери · Отвори сайта) · `update` (Инсталирай · По-късно) · `billing` (Виж плана).

---

## 12. Как работим по този план

1. Един WP = поредица от малки commit-и, всеки с тестове; push след всеки; CI трябва да е зелен преди следващия WP.
2. Преди всеки WP: кратък „план за деня“ в чата (какво, къде, как ще се тества); след WP: какво да се провери на Mac-а и какво остава.
3. Решенията от §9 се питат **преди** седмицата, в която са нужни — не по средата.
4. AUDIT.md §6a се допълва при всеки WP; V10-PLAN.md не се пренаписва — корекциите са в §3 тук.
5. При спор между бързина и безопасност печели безопасността (принципи 2 и 7).
