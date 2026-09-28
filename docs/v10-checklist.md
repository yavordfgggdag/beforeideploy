# V10 — проверка срещу плана

Всяка точка от `V10-PLAN.md` (WP1–WP8) и `ROADMAP.md` §4.1 с текущия статус, къде е в кода и кой тест я
пази. Легенда: ✅ готово · 🟡 частично (виж бележката) · ⏳ чака собственика (акаунт/решение, не код) ·
➡️ отложено за по-късна версия с причина. Статус към 2026-09-28, клон `claude/nifty-edison-1195gi`.

Автоматични проверки (всички зелени в CI): engine `node tests/run.mjs` — 61 (Linux и macOS) · Swift `swift test` — 34 ·
Edge Functions `deno test supabase/functions` — 51 · `scripts/i18n-check.mjs` · `scripts/error-codes.mjs`.

## WP1 — Интернационализация и избор на език

| Точка | Статус | Къде | Тест |
|---|---|---|---|
| Първи екран на английски с избор на език, предизбран системният | ✅ | `LanguageViews.swift` (`WelcomeLanguageView`), `Localization.suggested` | ръчен QA 1.4 |
| en и bg ръчно; останалите езици машинно с `reviewed:false` | ✅ en+bg (решение на собственика: само тези два за V10.0) | `App/Resources/{en,bg}.lproj`, `engine/i18n/{en,bg}.json`, `scripts/i18n-translate.mjs` | i18n-check |
| Бадж „бета превод“ за непрегледани езици | ✅ | `Localization.isReviewed`, `BetaBadge`, ключ `_meta.reviewed` | Swift `testLanguageWithoutCatalogIsNotReviewed` |
| `L()` навсякъде, без твърд текст | ✅ | `Localization.swift`; i18n-check спира кирилица и английски изречения в Swift | engine тест `i18n: scripts/i18n-check.mjs` |
| Плурали | ✅ (ключове `.one/.few/.many/.other` + правила по CLDR вместо `.stringsdict` — причина в `Localization.plural`) | `L(key, count:)`, `Plural` | Swift `testPluralCategories` |
| Смяна на езика без рестарт (UI + engine) | ✅ | `AppModel.setLanguage`, `.id(locale)`, `BID_LANG` | ръчен QA 2.1–2.3 |
| Числа, дати, валути по избрания език | ✅ | `Fmt` с `Localization.locale`, `BillingFormat.money` | Swift `testTokensFormatterGroupsDigits`, `testBillingMoneyFormat…` |
| RTL | ➡️ V10.1+ (втори етап по план; няма RTL език във V10.0) | — | — |
| Engine: грешки и стъпки като ключове, `code` в резултата, `BID_LANG`, fallback en | ✅ | `engine/src/i18n.mjs`, `EngineError` с `key/params` | engine тестове `i18n: …` (5) |
| `profiles.locale` при регистрация; езикът от профила на друг Mac | ✅ | `account.mjs` signup, `AppModel.adoptProfileLanguage` | engine тест за `account locale` |
| Имейли на Supabase на езика на потребителя | ✅ (двуезични шаблони по `.Data.locale`; локализирани subject-и изискват custom SMTP — WP9) | `supabase/email-templates/` | engine тест `имейл шаблони` |
| V9 инсталация остава на български без въпрос | ✅ | `Localization.migrateFromV9` | ръчен QA 1.3 |

## WP2 — Профили, роли, Admin панел

| Точка | Статус | Къде | Тест |
|---|---|---|---|
| Схема: роли, планове, profiles (trigger), subscriptions, credit_ledger + balance, ai_usage, admin_audit, settings, RLS | ✅ | `supabase/schema.sql` | Deno тестове на функциите; ръчен QA 0.2 |
| Никой не пише role/plan/ledger през REST | ✅ | trigger `profiles_protect_columns`, RLS само select | — |
| `account status` → role, plan, locale, credits {balance, monthlyGrant, renewsAt}, features | ✅ | `engine/src/account.mjs`, `features.mjs` | engine тестове за акаунт, фикстури `account-status*` |
| Admin панел: списък, търсене, роля, план, кредити с причина, спиране на AI, AI употреба на потребител, глобални настройки, одит | ✅ | `AdminView.swift` (`AdminSettingsCard`, usage в детайла), `AdminStore` | Deno `admin_test.ts` (15), engine admin тестове |
| VIP: AI ключове в Настройка, Keychain, проверка при въвеждане | ✅ | `aikeys.mjs`, `AIKeysCard` | engine тест с грешен/верен ключ |
| Роля/план се обновяват при старт, на 15 мин и след покупка | ✅ | `AppModel.start` (15-мин цикъл), `BillingStore.onChanged` | — |

## WP3 — Вграден AI Fix

| Точка | Статус | Къде | Тест |
|---|---|---|---|
| Cloud път (normal с план) през `ai-fix` със SSE | ✅ | `supabase/functions/ai-fix`, `engine/src/ai/providers.mjs` | Deno `ai_fix_test.ts` (15), engine `ai: cloud път` |
| Own-key път (vip/admin), Anthropic и OpenAI, един формат на стрийма | ✅ | `ai/providers.mjs` | engine `ai: собствен ключ` |
| Модел по план от `settings`, „Дълбока поправка“ ×5 | ✅ | `ai-fix/handler.ts` `chooseModel` | Deno тестове deep/explain/settings |
| Промени като блокове, проверка на пътищата, прилагане само с `--yes`, по избор commit | ✅ (SEARCH/REPLACE вместо unified diff — причина в ROADMAP §3) | `ai/patch.mjs`, `ai/index.mjs` | engine: файл извън проекта се отхвърля |
| Redaction преди всяко изпращане; prompt ≤ 60 000 символа с умно съкращаване | ✅ | `aifix.mjs` `redact`, `ai/fit.mjs` | engine `ai: prompt над 60 000…` |
| quota_exhausted → exit 8; rate limit 6/мин, 60/час; дневен таван 15 % | ✅ | `ai-fix/handler.ts`, `ai/providers.mjs` | Deno 402/429/daily_cap; engine exit 8 |
| Таксуване по реални токени, и при прекъснат стрийм; първо план, после пакети | ✅ | `ai-fix/handler.ts` `record` | Deno „plan tokens are spent first…“ |
| AI панел: стрийм, Markdown, файлове с diff, чекбокс, „Приложи избраните“, нова проверка | ✅ | `AIFixView.swift`, `AIStore` | ръчен QA 4.4 |
| Индикатор „Остават N токена · подновява се на…“ | ✅ | `AIFixView` header | ръчен QA 4.6 |
| normal без план → плановете; vip без ключ → Настройка | ✅ | `AIFixBar` | — |
| Външните бутони (ChatGPT/Claude/Codex/Claude Code) | ✅ непроменени | `aifix.mjs` | engine тестове aifix |

## WP4 — Абонаменти, кредити, икономика

| Точка | Статус | Къде | Тест |
|---|---|---|---|
| Планове Flash/High/Knight, цени и квоти | ✅ по препоръката (€4.99/9.99/19.99, 250k/1M/2.5M) — в `settings`, сменят се без версия; ⏳ окончателните цени решава собственикът | `schema.sql` (seed), `billing/handler.ts` | Deno `catalog` |
| Пакети 500k / 2M, валидни 12 месеца, харчат се след плана | ✅ | `billing.catalog.packs`, bucket `topup` | Deno пакети, „plan first“ |
| Trial 7 дни High | ✅ (без карта, веднъж на акаунт, изтича сам) | `billing` action `trial` | Deno trial + изтичане |
| Paddle checkout с `custom_data.user_id`, webhook с подпис и идемпотентност, `billing_events` | ✅ | `supabase/functions/billing` | Deno подпис, дубликати |
| Грант при подновяване + изтичане на неизползваното; refund отнема остатъка; отказ важи от края на периода | ✅ | `billing/handler.ts` | Deno тестове (6 сценария) |
| Страница „План и кредити“: баланс, история, подновяване, пакети, портал | ✅ | `BillingViews.swift` (`PlansSheet`), `BillingStore` | Swift фикстури `billing-*` |
| Пръстен за кредитите в AccountBadge | ✅ | `AccountBadge` | Swift `testCreditsCarry…` |
| Годишен вариант (−20 %) | ✅ (месечните токени на годишния план се дават лениво, веднъж на месец, без cron; цените 47.90/95.90/191.90 чакат Paddle price id-та) | `_shared/credits.ts` `ensureMonthlyGrant`, превключвател в `PlansSheet` | Deno yearly (2) |
| `BillingProvider` протокол (Paddle / StoreKit) | 🟡 Paddle е `BillingStore` + `billing` функцията; StoreKit идва с Xcode track (V10.5), тогава се изважда протоколът | — | — |
| Реален sandbox тест < 30 s | ⏳ нужни са Paddle акаунт, продукти и `PADDLE_*` secrets (виж `supabase/functions/README.md`) | — | ръчен QA 3.10 |

## WP5 — Onboarding и вход

| Точка | Статус | Къде | Тест |
|---|---|---|---|
| Език → Добре дошъл (3 екрана) → Вход → План („продължи с Free“) → Setup → първи проект | ✅ | `WelcomeTourView`, `AuthView`, `AppModel.offerPlansOnce`, `FirstStepsCard` | ръчен QA 1.7 |
| Email, GitHub, Apple вход; бутоните според включените в Supabase доставчици | ✅ код; ⏳ Apple изисква Apple Developer Program + Services ID | `account.mjs` `authProviders`, `AppleSignInButton` | engine `providers`, Swift `testAnonymousAccountState…` |
| Покана за vip по имейл | ✅ | admin `invite`, `AdminInviteCard` | Deno invite, engine admin |
| Изтриване на акаунт (анулира Paddle, `deleteUser`); експорт на данните | ✅ | `supabase/functions/account`, `DeleteAccountSheet` | Deno account (6), engine export/delete |

## WP6 — Инженерни подобрения

| Точка | Статус | Къде | Тест |
|---|---|---|---|
| 6.1 AppModel → stores (Project, Account, Hosting, Run, Admin, AI, Billing) | ✅ | `Stores/` | Swift + CI build |
| 6.2 Инкрементален check, „Пълна проверка“ ⌥⌘R, паралелни lint + typecheck | ✅ | `checks.mjs` (`PARALLEL_GROUPS`) | engine `incremental`, `паралелно` |
| 6.3 VERSION, self-update feed, sha256, beta канал | ✅ | `engine/VERSION`, `update.mjs`, Settings | engine `update` |
| 6.4 Сираци на Local Preview | ✅ | `local.mjs`, `static-server.cjs` | engine тест |
| 6.5 Реални тестове Vercel / Cloudflare / GH Pages | ⏳ нужни са тестови акаунти (ръчен QA 5.2) | — | — |
| 6.6 os_log, crash отчет, доклад за поддръжка с redaction | ✅; изпращане по имейл (Edge `support` + Resend) ➡️ WP9 — докладът се запазва като zip | `Diagnostics.swift`, `log.mjs` | engine `logs & report` |
| 6.7 Swift тестове (`swift test` в CI) | ✅ 34 | `App/Tests` | CI app.yml |
| 6.8 CI: engine (Linux + macOS), app, functions, screenshots | ✅ | `.github/workflows/` | — |

## WP7 — Дизайн и UX

| Точка | Статус | Къде |
|---|---|---|
| Визуален език: повърхности с дълбочина, фон по статус, аватари, пръстен, плъзгащи табове, Reduce motion | ✅ | `Theme.swift` (`Card`, `AmbientBackground`, `ProjectAvatar`, `StatusRing`, `Motion`) |
| Welcome/Language, Plans (три карти, препоръчан High, „Скоро“ за непродаваните), Admin, AI панел | ✅ | съответните изгледи |
| Setup по роля (normal не вижда AI ключове) | ✅ | `SetupView` |
| Грешки с код, копиране, линк към помощ; каталог на кодовете | ✅ | `ToastView`, `docs/errors.md` |
| Клавиатура: ⌘1–⌘4, ⌘] ⌘[, ⌘R, ⌥⌘R, ⌘D, ⌘K | ✅ | `BeforeIDeployApp` |
| VoiceOver етикети на икон-бутоните | ✅ | `IconButton` |
| Отделна страница „Акаунт“ в sidebar-а | ✅ | `AccountView.swift` |
| Месечно/годишно превключване | ✅ | `PlansSheet` |
| Светла тема | ➡️ V11 WP17 (решение в ROADMAP §9) | — |

## WP8-A — Пускане (Developer ID)

| Точка | Статус | Къде |
|---|---|---|
| `scripts/release.sh`: подпис с Hardened Runtime, DMG, notarytool, stapler, `latest.json`, Homebrew cask | ✅ | `scripts/release.sh`, `release-notes.mjs`, `release-feed.mjs`, `packaging/` |
| Runbook, rollback | ✅ | `docs/release.md` |
| Apple Developer Program, сертификат, сайт, Privacy/Terms/Refund, Paddle продукти | ⏳ собственикът (ROADMAP §9) | — |
| WP8-B App Store | ➡️ V10.5 (Xcode track) | ROADMAP §4.2 |

## Одит V10 и надграждане (docs/AUDIT-V10.md)

| Партида | Статус | Какво |
|---|---|---|
| 1 — сигурност на engine-а | ✅ | Keychain през stdin, AI промени без `.git`/hooks, Local Preview без dotfiles и чужд Host, чисто копие за GitHub Pages / Cloudflare, HTTPS + sha256 за обновления |
| 2 — облак и пари | ✅ | резервация на кредити, веднъж-само грантове, trial на имейл, частичен refund, миграция на схемата (проверена в Postgres) |
| 3 — приложение | ✅ | потвърждение за линкове, защита на входа, без блокиране на нишки, без двойни проверки, crash отчети |
| 4 — готово за пускане | ✅ | engine в .app и самоинсталация, екран за Node, universal build, обновления без акаунт, задължително обновление, правни линкове, съгласие за AI, checkout страница |
| 5 — коректност на engine-а | ✅ | deploy само на провереният код, кирилица в Git, DNS без прекъсване, AI промени „всичко или нищо“, изтекъл SSL |
| 6 — документи и CI | ✅ | README на английски + български, release dry-run (universal DMG), синтактични проверки, engine-macos на PR |

## Какво остава преди публичен V10.0

Само неща извън кода (собственикът): Supabase — `schema.sql`, `supabase functions deploy admin ai-fix account billing`,
secrets `ANTHROPIC_API_KEY`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENV`; Paddle продукти и price id-та в
`settings.billing.catalog`; имейл шаблоните; Apple Developer Program; домейн, сайт и правни страници; ръчният QA
чеклист на bg и en (`docs/manual-qa.md`); Privacy / Terms / Refund линковете и имейл за поддръжка в
настройките, `site/checkout.html` с клиентския токен на Paddle; после `docs/release.md`.
