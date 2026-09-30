# Одит на Before I Deploy 11.1.0-rc.1 — какво е, какво липсва, план за бета

Клон `claude/nifty-edison-1195gi`, commit `a63fa90` (2026-09-30). Документът е написан за двама читатели:
собственика (решения и ръчни стъпки) и следващия агент, който ще надгражда кода (Codex или друг). Всяка
находка сочи файл и ред; всяка задача има критерий за приемане, който може да се провери с команда или тест.

Речник на статусите: ✅ готово и доказано с тест · ⚠️ готово, доказателството е ограничено (казва как) ·
⏳ не е правено · ⛔ блокирано от нещо извън кода (акаунт, ключ, решение) · 👤 само собственикът може.

---

## 0. Резюме в десет реда

1. Кодът е в състояние **„готов за бета с приятели“, не „готов за публика“**. Всичко, което може да се докаже без
   външни акаунти, е доказано: 101 engine теста (Linux + macOS), 81 Deno теста, 8 RLS сценария на истински
   Postgres (PGlite), 47 Swift теста, CI зелено на последния commit.
2. **Нищо от облака не е пуснато**: схемата не е приложена, петте Edge функции не са качени, тайните не са
   зададени (проверено с `cloud-check` на 2026-09-29, §2.1). Без това входът в акаунт „не работи“, AI през
   облака не работи, планове и кредити не работят. Това е първата стъпка и е само на собственика.
3. **Приложението не е подписано** (Developer ID + notarization). Всеки DMG показва предупреждение на
   Gatekeeper. За бета тестери, които знаят какво правят, е приемливо с инструкция; за публика не е.
4. Намерени са **4 нови находки със сигурностен характер** в engine-а (§3.1): заобикаляне на allowed_paths при
   създаване на файл от AI асистента, липса на защита за файлове, които изпълняват команди (package.json
   скриптове, netlify.toml), пълната среда на engine-а се подава на build скриптовете на проекта, override на
   API адреси през env без тестов ключ. Нито една не е използваема от външен нападател без локален достъп или
   без съгласие на потребителя, но трябва да се затворят преди публика.
5. Намерени са **3 находки в облака** (§3.2): retention на `monitor_probes` не работи над 1000 реда,
   `monitor_heartbeat` никога не се чисти, GDPR експортът пропуска таблиците за мониторинг; политиката за
   поверителност не споменава сървърния мониторинг.
6. Приложението има **слаби места в устойчивостта** (§3.3): няма timeout към engine-а, отказ на първото
   зареждане оставя Mission Control и Setup в безкраен скелет, JSON към engine-а се сглобява на ръка.
7. Документацията е на три места **противоречива** (цени, светла тема, сървърен мониторинг, бройки тестове —
   §6). Трябва едно място на истината.
8. **Няма телеметрия и няма канал за обратна връзка** от бета тестерите освен ръчния „Доклад за поддръжка“
   (zip). За бета това е недостатък, който струва седмици.
9. Планът за бета (§5) е 3 етапа: (A) собственикът пуска облака и подписва, (B) Codex затваря P0/P1 задачите
   от §4, (C) 3–5 тестери минават сценария в `docs/OWNER-ACCEPTANCE-TEST-BG.md` с обратна връзка.
10. Оценка на обема до бета: около **8–12 работни дни** на агент за P0+P1 плюс 1–2 дни на собственика за
    акаунти и ключове. Подробности в §4.

---

## 1. Какво представлява системата (карта за новия читател)

```
┌──────────────────────── macOS app (SwiftUI, 12.5k реда) ────────────────────────┐
│ RootView → Welcome/Tour/Auth → mainView (Mission Control, Project, Domains,        │
│ Assistant, Costs, Setup, Usage, Account, Admin) + 16 листа + палитра ⌘K            │
│ AppModel (фасада) → ProjectStore · AccountStore · HostingStore · RunController ·    │
│ AdminStore · AIStore · AssistantStore · BillingStore                                │
└───────────────┬──────────────────────────────────────────────────────────────────┘
                │ spawn `bid <cmd>` (zsh launcher → bundled Node 22), NDJSON по stdout, тайни през env
┌───────────────▼──────────── engine `bid` (Node 18+, 0 зависимости, 9.1k реда) ────┐
│ 44 команди · checks (8 стъпки) · issues · fixes · site · launch · release (preview→ │
│ smoke→promote→verify→rollback) · hosting (Netlify/Vercel/Cloudflare/GH Pages) ·    │
│ monitor (Mac + облак, webhook, Pushover) · ai (own key / cloud) · account · billing │
│ state: ~/Library/Application Support/BeforeIDeploy · Keychain за тайни              │
└───────────────┬──────────────────────────────────────────────────────────────────┘
                │ HTTPS
┌───────────────▼──────────── Supabase (ref rrnveotqvmsspmzaswlp) ─────────────────┐
│ schema.sql: 13 таблици, RLS, тригери · Edge: account · admin · ai-fix · billing ·  │
│ monitor · pg_cron на 5 мин · Paddle (webhook) · Anthropic (ai-fix)                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Пълните карти по модул са в `docs/RELEASE-HANDOFF.md` §1 (engine), `docs/V11-HANDOFF.md`, `supabase/functions/README.md`.
Планове и кредити: `docs/PLANS-AND-CREDITS-BG.md` (решение от 2026-09-30, единственото валидно).

### 1.1 Какво е доказано и как

| Област | Доказателство | Клас |
|---|---|---|
| Проверка на проект (git, secrets, deps, lint, typecheck, build, site, hosting), инкрементален кеш | `tests/run.mjs` (check: …, site: …) | unit/mock |
| Единен модел на проблемите + безопасни поправки с повторна проверка | `issues: …`, `fix: …` | unit |
| Release: preview → smoke → promote с SHA-256 манифест, заключване, rollback, идемпотентност | `release: …` (11 теста) с фалшив Netlify CLI | sandbox |
| Мониторинг на Mac: 2 неуспеха → инцидент, SSL/домейн, тихи часове, поддръжка, webhook, Pushover | `monitor: …` | sandbox |
| Облачен мониторинг: регистрация само на собствен хост, SSRF guard с pinned IP, cron `run` | `monitor_test.ts` (8), `netguard.ts` | unit |
| AI асистент: 8 действия, доказателства с id, redaction, бюджет, stale base, undo при влошаване | `assistant: …` (6 теста) + `tests/ai-evals` | unit |
| Кредити: charge = ceil(cost × usdToEur / creditEur[plan]), holds, session cap 20 %/5 h, rate limit | `ai_fix_test.ts` (23) | unit |
| Paddle: подпис, dedupe, подредба на събития, грант/пакет/refund, trial веднъж на имейл | `billing_test.ts` (26) | unit |
| RLS: всяка таблица, тригер за защитените колони, каскадно триене | `tests/rls/rls.mjs` (PGlite) | unit |
| Swift модели декодират реални engine резултати (30 fixtures) | `ModelsTests.swift` | unit |
| Приложението се строи, engine-ът вътре тръгва, ad-hoc codesign минава | `app.yml`, `release-dryrun.yml` | CI |
| Екраните се рендират (12 скрийншота на macOS runner) | `screenshots.yml` | CI, визуално |

### 1.2 Какво НЕ е доказано (и няма как оттук)

| Област | Защо | Кой |
|---|---|---|
| Истински вход/регистрация, синхронизация, планове, AI през облака | схема и функции не са пуснати | 👤 |
| Истински Netlify deploy/preview/rollback | само фалшив CLI; няма акаунт в контейнера | 👤 + тестер |
| Vercel / Cloudflare / GitHub Pages | само „няма CLI“ тестове | тестер |
| Paddle sandbox: checkout → webhook → баланс | Paddle недостъпен оттук | 👤 |
| Истински модел (Anthropic) с реален ключ | няма ключ в контейнера | 👤 |
| Gatekeeper, Keychain prompt, „нужен е Node“ екран на чист Mac | няма Mac оттук | 👤 |
| VoiceOver, светла тема (няма такава), дълги BG текстове | нужен Mac | тестер |
| Spaceship API (домейни, DNS) | няма акаунт | 👤 |

---

## 2. Състояние по слоеве

### 2.1 Облак (Supabase) — ❌ нищо не е пуснато

Проверено на 2026-09-29 от workflow `cloud-check` (run 36619580972) срещу проекта `rrnveotqvmsspmzaswlp`:

| Проба | Резултат |
|---|---|
| `/auth/v1/health` | ✅ |
| Регистрация с имейл/парола | ✅ включена; `mailer_autoconfirm: false` → потвърждение по имейл с вградения mailer (праща само на екипа) |
| `GET /rest/v1/settings`, `profiles`, `monitor_targets` | **404** — `schema.sql` никога не е прилагана |
| `POST /functions/v1/{account,billing,monitor,ai-fix,admin}` | **404 NOT_FOUND** — нито една функция не е качена |
| GitHub / Apple sign-in | изключени |

Следствия в приложението днес: входът минава (auth работи), но профилът е 404 → приложението показва
„облакът не е довършен“ (Setup → Облак) и работи в локален режим. Това е поправеното от 2026-09-29
поведение; преди това изглеждаше като „не ми дава да се логна“.

Какво трябва (`docs/CLOUD-SETUP-BG.md`, път A): GitHub secret `SUPABASE_ACCESS_TOKEN` → workflow `cloud-deploy`
с `apply_schema`, `deploy_functions`, `disable_email_confirmation` (докато няма SMTP), `allow_app_redirect`.
След това ръчно (никога от CI): тайните на функциите `ANTHROPIC_API_KEY`, `PADDLE_API_KEY`,
`PADDLE_WEBHOOK_SECRET`, `PADDLE_ENV=sandbox`, `MONITOR_CRON_SECRET`; `supabase/monitor-cron.sql` с двата
placeholder-а; първият admin с `update profiles set role='admin'`; `settings.billing.catalog` с Paddle price ids
(в seed-а всички са `null` → плановете се показват „Скоро“); `release.url`, `help.url`, `legal.*`, `support.email`.

`cloudDoctor` (engine/src/cloud.mjs) и `cloud-check` **не** виждат: липсващи тайни на функциите, heartbeat на
cron-а, Paddle price ids, имейл шаблоните. Само `monitor status` в приложението казва „scheduler: never“.

### 2.2 Engine — ✅ функционално пълен, с находки в §3.1

- 44 команди, всички документирани в `HELP` освен `prices`.
- Състояние на диска: `projects.json`, `state/<key>.json`, `history.jsonl` (подрязва се), `ops/*.json` (не се
  подрязва), `ledger.jsonl` (никога не се подрязва), `chats/*.jsonl` (никога), `undo/` (10 записа / 30 дни),
  `logs/engine.log` (ротация на 5 MB). Кешове в `~/Library/Caches/BeforeIDeploy/<key>/`.
- Тайни: само Keychain (`security -i` през stdin, base64, прочит обратно), file fallback 0600 само без `security`.
  Акаунти: `session`, `ai-anthropic`, `ai-openai`, `spaceship`, `pushover`.
- Изходящ трафик: Anthropic, OpenAI, Supabase, Spaceship, Pushover, feed за обновяване, сайтовете на потребителя
  (smoke, monitor), CLI-та (netlify, vercel, wrangler, gh, git, npm).
- Команди без тест (тестове с успех липсват): `version`, `project touch|rename`, `git fetch`, `netlify auth|login|
  teams|sites|link|create`, `budget`, `setup auto|terminal`, `spaceship disconnect`, `account recover|session`,
  `local restart`, `monitor agent install` (успех), успешен deploy на Vercel/Cloudflare/GH Pages, `smart --prod`.

### 2.3 Приложение (SwiftUI) — ✅ компилира и минава тестове в CI, с находки в §3.3

- 34 екрана/листа/overlay-а; палитра; меню бар; onboarding (език → тур → вход/офлайн → първи стъпки).
- Engine мост (`Engine.swift`): без timeout, отказ само със SIGTERM, `call()` не приема handle (не може да се
  прекъсне). Тайни през env, не argv — правилно.
- Bundled Node 22.12.0 (`scripts/bundle-node.sh`) — **CI никога не го изпълнява**, значи CI проверява
  приложение без runtime; работещото на чист Mac е доказано само логически.
- i18n: 1109 ключа × 2 езика, `%@` навсякъде, множествени числа с ръчна CLDR таблица, проверка в CI.
- Достъпност: 16 `accessibilityLabel`, 9 реда с `onTapGesture` без клавиатурен достъп, иконни бутони само с `.help`.
- Тестове: 47 (модели + envelope + локализация). Няма тестове за stores, `EngineClient.run`, инсталатора.

### 2.4 Доставка — ⚠️ скриптове готови, подпис няма

`scripts/release.sh` прави всичко от тестове до DMG, notarization, `latest.json`, Homebrew cask. Изисква
`BID_SIGN_IDENTITY`, `BID_NOTARY_PROFILE`, `BID_RELEASE_BASE_URL` (иначе feed-ът сочи `example.invalid`).
Без тях: ad-hoc подпис, Gatekeeper предупреждение. CI dry run (`release-dryrun.yml`) строи универсален DMG (~90 MB)
без подпис. Обновяването (`update.mjs`) вярва на sha256 от същия feed — без подпис на feed-а, разчита на
notarization.

---

## 3. Находки (нови, извън досегашните одити)

Приоритет: **P0** преди първия тестер · **P1** преди публична бета · **P2** преди 1.0 · **P3** по-късно.

### 3.1 Engine — сигурност и коректност

| # | Прио | Находка | Къде | Ефект |
|---|---|---|---|---|
| E1 | P0 | `allowed_dirs` включва `''`, когато snapshot файл е в корена → `v.startsWith('')` приема всеки път; `src/../x` също минава prefix проверката. Редакции/трия се спират от base hash, но **създаване на нов файл навсякъде извън блокираните папки е позволено** (напр. `netlify.toml`, `vite.config.js`, `.envrc`). | `engine/src/ai/assistant.mjs:349`, `engine/src/ai/prompts.mjs:136` | AI резултат (възможно повлиян от инжекция в README) може да добави файл, който следващият check изпълнява. Потребителят вижда diff и трябва да каже `--yes`. |
| E2 | P0 | `safePath` не защитава файлове, които изпълняват команди: `package.json` (scripts), `netlify.toml`, `vercel.json`, `wrangler.toml`, `.env*`, build конфигурации. Патч в тях се изпълнява при следващия check (`runScript`). | `engine/src/ai/patch.mjs` (BLOCKED списъци) | Същото като E1, през легитимен път. Нужен е клас „изпълними конфигурации“: позволени само с изричен флаг и отделно предупреждение в UI. |
| E3 | P0 | Build/lint скриптовете на проекта получават **пълната среда на engine-а** (`{...process.env, CI:'1'}`), вкл. `BID_PASSWORD`, `BID_AI_KEY`, `BID_PUSHOVER_*`, `NETLIFY_AUTH_TOKEN`, когато са подадени. | `engine/src/checks.mjs:243` | Зловреден `npm script` в чужд проект чете тайни. Поправка: allowlist на env (PATH, HOME, LANG, CI, NODE_*), махане на `BID_*`. |
| E4 | P1 | Override на API адреси без тестов ключ: `BID_ANTHROPIC_API`, `BID_OPENAI_API`, `BID_SPACESHIP_BASE`, `BID_SUPABASE_URL/ANON_KEY` (последните без валидация). Pushover и webhook правилно искат `BID_TEST_ALLOW_PRIVATE_WEBHOOK=1`. | `engine/src/ai/providers.mjs`, `spaceship.mjs`, `account.mjs` | Env, зададен от друг процес/launch agent, праща ключове към чужд хост. Поправка: същият тестов ключ като при webhook + `*.supabase.co` валидация. |
| E5 | P1 | `aiUndo` пише в `path.join(project.path, f.path)` без `safePath`. | `engine/src/ai/index.mjs:231` | Манипулиран undo запис в APP_DIR пише извън проекта. Ниска вероятност, лесна поправка. |
| E6 | P1 | Netlify deploy с `publishDir='.'` качва корена директно (`--dir .`), без `stagePublicCopy`, за разлика от Cloudflare. Манифестът изключва dotfiles/lockfiles, качването не → манифест ≠ качено. | `engine/src/netlify.mjs:259` | Публикуват се `package.json`, lockfiles, евентуално `.env` ако не е в `.gitignore` (secrets стъпката го лови, но не е гаранция). Поправка: винаги `stagePublicCopy` за root publish. |
| E7 | P1 | Без timeout: всички fetch в `account.mjs` (освен providers), `billing.mjs`, `admin.mjs`, `spaceship.mjs`, `aikeys.mjs`, `update.mjs` (feed и DMG, DMG в паметта без лимит), AI stream-овете (`Promise.race` не прекъсва fetch-а). `gitCommit` без timeout (hooks). | изброените | Приложението „замръзва“ без съобщение при лоша мрежа. Поправка: общ `fetchWithTimeout` (AbortController) + DMG на диск на поток с лимит. |
| E8 | P1 | Non-Netlify promote минава през `deployGuard` с 30-мин лимит → preview по-стар от 30 мин → `stale_check`. | `engine/src/release.mjs`, `netlify.mjs:231` | Release на Vercel/Cloudflare се проваля без причина за потребителя. |
| E9 | P2 | Тайни в argv: `--password`, `--access/--refresh`, `spaceship --key/--secret`, stop token на preview сървъра. Приложението вече ползва env; CLI пътят остава. | `bid.mjs` | Видими в `ps`. Поправка: приемай само env/stdin, предупреждавай за флага. |
| E10 | P2 | `npx --yes netlify-cli`, `npx --yes gh-pages` без pin на версия. | `netlify.mjs`, `hosting.mjs` | Supply-chain риск при първо стартиране. Поправка: pin + sha или изискване Setup да инсталира. |
| E11 | P2 | Неограничен растеж: `ledger.jsonl`, `chats/*.jsonl`, `ops/*.json`, `artifact-*.json`, `report-*`, `smoke-*`; `listOps` чете всеки op файл при всеки status. | `costs.mjs`, `assistant.mjs`, `release.mjs` | След месеци status става бавен. Поправка: retention (90 дни / N записа) + индекс на ops. |
| E12 | P2 | `projects.max` от плана не се налага в engine-а; gates само в UI. | `features.mjs`, `store.mjs` | Free с >2 проекта през CLI. |
| E13 | P2 | `spaceship connect-domain` трие DNS записи само с `--yes`; Netlify IP `75.2.60.5` е hard-coded. | `spaceship.mjs` | Загуба на DNS без typed confirm. Поправка: `--confirm DNS` + IP от Netlify API. |
| E14 | P3 | Loose settings: `monitor settings --json` слива всеки ключ, само interval се валидира; `timeoutMs`/`confirmFailures` не. | `monitor.mjs` | Нужна е схема. |
| E15 | P3 | Два проекта с еднакво име на папка споделят `CACHE_DIR/publish/<basename>`, който се трие преди копиране. | `hosting.mjs:248` | Паралелни publish-и се сблъскват. Ключ по `projectKey`. |

### 3.2 Облак

| # | Прио | Находка | Къде | Ефект |
|---|---|---|---|---|
| C1 | P0 | Retention на `monitor_probes`: `select("id,at")` без филтър и подредба → PostgREST връща максимум 1000 реда; после трие по един ред на заявка. Над 1000 проби старите може никога да не се изберат. Същото за resolved incidents. Чисти cross-tenant с O(n) HTTP на всеки 5 мин. `monitor_heartbeat` **никога** не се чисти (288 реда/ден). | `supabase/functions/monitor/handler.ts:234-238` | Таблиците растат без край; cron минава все по-бавно. Поправка: `delete().lt("at", cutoff)` (един заявка), heartbeat retention 7 дни, тест с >1000 реда. |
| C2 | P0 | GDPR експортът пропуска `monitor_targets`, `monitor_probes`, `monitor_incidents` (header-ът твърди „всеки ред“). | `supabase/functions/account/handler.ts:33-49` | Непълен експорт = правен проблем при бета с външни хора. |
| C3 | P0 | Политиката за поверителност не споменава сървърния мониторинг (URL-и на сайтове, проби с IP, инциденти, 90 дни). Секцията за retention твърди, че платежни записи се пазят, а `account delete` трие `billing_events`. | `site/privacy.html` | Трябва да е вярна преди първия външен тестер. |
| C4 | P1 | Rate limit има само `ai-fix`. `billing checkout/portal/sync`, `monitor test/register`, `account export`, всички admin действия — без. | всички handler-и | Злоупотреба = разходи (Paddle сесии, изходящи проби). Поправка: общ limiter в `_shared` (per user, per action, sliding window в таблица или KV). |
| C5 | P1 | Без retention: `ai_usage`, `credit_ledger` (по дизайн), `admin_audit`, `billing_events`, `hold` редове (reconcile, но не трие). | `schema.sql` | Дефинирай политика: ai_usage 12 м, audit 24 м, holds 24 h след settle. |
| C6 | P2 | `settings` seed: `plans` и `billing.catalog` с trial 150k токена — **противоречи** на `PLANS-AND-CREDITS-BG.md` (50 000 кредита); handler DEFAULTS вече са с новите стойности, но seed-ът в SQL е стар. | `supabase/schema.sql` (seed) | При прилагане на схемата плановете в базата ще са старите, докато admin не ги презапише. |
| C7 | P2 | Feed за обновяване без подпис; DMG sha от същия feed; GPG проверка на Node bundle само предупреждава. | `update.mjs`, `bundle-node.sh` | Приемливо с notarization; P2 за minisign/ed25519 подпис на `latest.json`. |
| C8 | P3 | `README.md` на функциите казва 49 теста, V11-HANDOFF 68; реално 81. | docs | Стари числа. |

### 3.3 Приложение

| # | Прио | Находка | Къде | Ефект |
|---|---|---|---|---|
| A1 | P0 | Провал на първото зареждане (`loadOverview`, `loadSetup`, `loadMonitor` с `try?`) оставя Mission Control в скелет и Setup в спинер **завинаги**, без грешка и без Retry. Скрийншотът от run 36744481195 показва точно това състояние. | `AppModel.swift` (loadOverview/loadSetup/loadMonitor) | Тестерът вижда „счупено приложение“ при най-малкия проблем с engine-а. Поправка: `LoadState {idle, loading, loaded, failed(EngineError)}` на всяка карта + Retry. |
| A2 | P0 | `AccountStore.loadAccount`: грешка от engine-а → `account = nil` → `mustAuthenticate = false` → приложението влиза анонимно без съобщение. | `Stores/AccountStore.swift:38` | Скрива истинската причина за „не мога да вляза“. |
| A3 | P1 | Няма timeout към engine-а; отказ само SIGTERM без SIGKILL/process group; `call()` не може да се прекъсне. | `Engine.swift` | Забиване = force quit. Поправка: `timeout:` параметър (по подразбиране 120 s, 15 мин за check/deploy), SIGTERM → 5 s → SIGKILL на групата. |
| A4 | P1 | JSON към engine-а на ръка: `setMonitorWebhook` escape-ва само `"`; `setMonitorNotify` конкатенира. | `AppModel.swift:345, 392` | Backslash или control char → невалиден JSON → грешка. Поправка: `JSONSerialization`. |
| A5 | P1 | `try?` без обратна връзка на потребителски пътища: `setBudget` винаги казва „запазено“, `setMonitorNotify`, `removeProject`, `local stop`, `git fetch`. | `AppModel.swift:747`, `ProjectStore.swift:94`, `RunController.swift:230,271` | Тестерът докладва „не работи, но казва че работи“. |
| A6 | P1 | `assistantStore.objectWillChange` липсва в `storeObservers` → изгледи през AppModel може да не се опресняват при промени в асистента. | `AppModel.swift:140-148` | Ако е нарочно, коментар; ако не, един ред. |
| A7 | P1 | CI не изпълнява `bundle-node.sh` → приложението в CI е без runtime; „чист Mac без Node“ не е доказан от машина. | `.github/workflows/app.yml`, `release-dryrun.yml` | Добави стъпка `bundle-node.sh` в `release-dryrun` и тест `bid version` с `PATH=/usr/bin:/bin` (без system Node). |
| A8 | P2 | `start()` пробата `try? engine.run(["version"])` третира всяка друга грешка като „Node има“. | `AppModel.swift:start` | Неверен екран при повреден bundle. |
| A9 | P2 | Клавиатура/достъпност: 9 `onTapGesture` реда без фокус; View менюто няма shortcuts за Assistant/Usage/Account/Admin; ⌘Y и ⌘⇧R не се изключват от `projectCommandsOff`; `BIDScreen` не отваря assistant/usage/admin (скрийншотите не ги покриват). | `SidebarView`, `V7Views:219`, `BeforeIDeployApp.swift`, `AppModel:1072` | VoiceOver тестер ще спре на първия ред. |
| A10 | P2 | Мъртъв код `ProductionSheet` (Sheets.swift:53-131); файлове над 700 реда: Models 1420, AppModel 1108, Sheets 853, V7Views 769, DashboardView 741, V9Views 737. | | Поддръжка. Разбий по екран, без промяна в поведението. |
| A11 | P2 | `MenuBarView` няма състояние за липсващ engine. | `AutoCheck.swift:63` | Празно меню. |
| A12 | P3 | `@AppStorage` в ObservableObject (коментар „audit A4“ казва, че не опреснява) в AppModel/RunController/ProjectStore. | | Потенциални „не се обнови“ бъгове. |
| A13 | P3 | Hard-coded URL-и (nodejs.org, spaceship, netlify, github, pushover, supabase) и нелокализирани placeholder-и. | изброени в §(j) на app картата | Един `Links` enum. |

### 3.4 Процес и документация

| # | Прио | Находка |
|---|---|---|
| D1 | P0 | Три версии на цените: `PLANS-AND-CREDITS-BG.md` (валидна), `HANDOFF-V10.md §6` (стара: 4.99/9.99/19.99), `ROADMAP.md §9 #1 и §11.5` (стара). Seed в `schema.sql` (стар, C6). |
| D2 | P1 | Светла тема: `OWNER-ACCEPTANCE-TEST-BG.md §1` иска тест на „Settings → Appearance“, а такава няма (RC audit §4, ROADMAP WP17). |
| D3 | P1 | Сървърен мониторинг: `V11-HANDOFF.md:134` и `AUDIT-V11.md §4.1` казват „не е имплементиран“; построен е (неактивен). |
| D4 | P1 | Бройки тестове: RC audit 97/80/8/44; реално 101/81/8/47. `WP10` в AUDIT-V11 е „отворен“, а е пуснат в 11.1. |
| D5 | P1 | `ai.usdToEur` (0.92) няма процес за поддръжка; `cloudDoctor` не го показва. |
| D6 | P1 | Няма телеметрия (решение §9 #9 в ROADMAP е отворено) и няма in-app „Изпрати обратна връзка“. Има само `bid report` (zip в Caches), който тестерът трябва да прати ръчно. |
| D7 | P2 | `release-dryrun.yml` тригерът комбинира `tags` с `paths` + `branches:'**'` → таг push без промяна в скриптовете не го пуска; всяко докосване на build.sh го пуска. |
| D8 | P2 | Netlify site ID е hard-coded в `Publish Website.command`; сайтът с правните страници се публикува само ръчно. |

---

## 4. План за работа (за Codex или следващия агент)

Правила, които важат за всяка задача (те са и в `CLAUDE.md`/handoff-ите):
- Engine: нула npm зависимости; всеки нов код за грешка в `docs/errors.md` (`scripts/error-codes.mjs`); всеки нов
  текст в `engine/i18n/{en,bg}.json` с литерален ключ в кода (`scripts/i18n-check.mjs`); тестове в `tests/run.mjs`
  (`node tests/run.mjs > OUT`, ~5 мин; mock сървърът е шаблон вътре в run.mjs с удвоени backslash-ове).
- App: `L("key")` винаги с `%@`; без кирилица в Swift; Swift се компилира само в CI (`app.yml`), затова малки,
  чести push-ове; fixtures през `BID_WRITE_FIXTURES=1 node tests/run.mjs` и revert на страничното.
- Cloud: Deno тестове `deno test --allow-env --allow-net supabase/functions`; RLS `cd tests/rls && node rls.mjs`.
- Никога истински ключове в repo-то; payment само test mode; никакво публикуване към клиентски production.
- Commit след всяка задача с ID-то ѝ в заглавието; push към работния клон; PR само при поискване.

### 4.1 P0 — преди първия външен тестер (≈ 4–5 дни агент)

| ID | Задача | Файлове | Критерий за приемане |
|---|---|---|---|
| B-01 | E1+E2: `allowed_dirs` без `''`; нормализирай пътя преди prefix проверката; нов клас `EXECUTABLE_CONFIG` (package.json, netlify.toml, vercel.json, wrangler.toml, .env*, *.config.{js,mjs,ts,cjs}, tsconfig*, .npmrc и др.) → AI патч към тях е `risk: high`, отхвърля се без `--allow-config`, UI показва отделно предупреждение. | `engine/src/ai/assistant.mjs`, `ai/prompts.mjs`, `ai/patch.mjs`, `App/…/AIFixView.swift`, `AssistantView.swift` | Нов тест `assistant: файл в корена не отваря целия проект; src/../x се отхвърля; package.json иска --allow-config`; eval сценарий в `tests/ai-evals`; 101+ теста зелени. |
| B-02 | E3: allowlist на env към project скриптове (PATH, HOME, USER, LANG, LC_*, TMPDIR, CI, NODE_ENV, NODE_OPTIONS, npm_config_*); махни всичко `BID_*`, `*_TOKEN`, `*_KEY`, `*_SECRET`, `*PASSWORD*`. | `engine/src/checks.mjs:243`, `util.mjs runStream` | Тест: build скрипт, който печата `env`, не вижда `BID_PASSWORD`/`NETLIFY_AUTH_TOKEN`; lint/build на vite fixture минава. |
| B-03 | C1: retention с една заявка (`.lt("at", cutoff)`), heartbeat retention 7 дни, resolved incidents по `resolved_at`; FakeDb да симулира лимит 1000. | `supabase/functions/monitor/handler.ts`, `_shared/fake_supabase.ts`, `monitor_test.ts` | Тест с 1500 проби над cutoff → 0 остават след един `run`; heartbeat > 7 дни изчезва. |
| B-04 | C2+C3: експортът включва трите monitor таблици; `site/privacy.html` описва мониторинга (какво, колко време, IP), поправя retention текста; `docs/CLOUD-SETUP-BG.md` добавя стъпка „публикувай сайта“. | `account/handler.ts`, `account_test.ts`, `site/privacy.html` | Тест: export съдържа `monitorTargets/monitorProbes/monitorIncidents`; ръчен преглед на текста от собственика. |
| B-05 | A1+A2: `LoadState` за overview/setup/monitor/costs с грешка + Retry; `loadAccount` грешка → `accountError` и екран „engine-ът не отговори“ вместо анонимен вход. | `AppModel.swift`, `Stores/AccountStore.swift`, `V7Views.swift`, `MonitoringViews.swift` | Скрийншот с `BID_ENGINE=/bin/false` показва грешка с Retry, не скелет; Swift тест за `LoadState` декодиране. |
| B-06 | D1+C6: едно място на истината за цените — `schema.sql` seed = `PLANS-AND-CREDITS-BG.md`; в `HANDOFF-V10.md` и `ROADMAP.md` старите числа се маркират „заменено на 2026-09-30, виж PLANS-AND-CREDITS-BG“. Deno тест, че `DEFAULT_CATALOG` == seed. | `supabase/schema.sql`, `billing/handler.ts`, docs | `grep -rn "4.99" docs ROADMAP.md` дава само маркирани редове; RLS тестът минава с новия seed. |
| B-07 | D6 минимум: бутон „Изпрати обратна връзка“ в Settings и в палитрата → `bid report` + отваря mailto към `support.email` с прикачен път и версия; ако няма `support.email`, показва къде е zip-ът. | `Sheets.swift SettingsSheet`, `AppModel`, `engine/src/log.mjs` | Работи офлайн; скрийншот. |
| B-08 | Бета документ за тестери: `docs/BETA-TESTERS-BG.md` — как се инсталира unsigned DMG (Control-click → Open), какво да тестват (кратка версия на acceptance §1–§6), как да пратят доклад, какво НЕ е готово (Paddle, Vercel rollback, светла тема). | docs | Собственикът го одобрява. |

### 4.2 P1 — преди публична бета (≈ 4–6 дни агент)

| ID | Задача | Файлове | Критерий |
|---|---|---|---|
| B-10 | E4+E5+E9: override-и само с `BID_TEST_ALLOW_PRIVATE_WEBHOOK=1` (преименувай на `BID_TEST_ENDPOINTS=1`); валидация `*.supabase.co`; `safePath` в `aiUndo`; тайни само през env/stdin (флаговете дават `usage` с обяснение). | providers.mjs, spaceship.mjs, account.mjs, ai/index.mjs, bid.mjs | Тестове за всяко; `docs/errors.md`. |
| B-11 | E6: Netlify root publish винаги през `stagePublicCopy`; манифестът се смята върху staged копието. | netlify.mjs, hosting.mjs, checks.mjs | Тест: `.env` и `package.json` в корена не влизат в качването (фалшив CLI записва dir-а). |
| B-12 | E7+A3: `fetchWithTimeout(url, opts, ms)` в util (AbortController), приложен навсякъде; DMG на поток в `~/Downloads` с лимит 500 MB; AI stream abort при timeout; `gitCommit` timeout 120 s. App: `timeout:` в `Engine.run`, SIGTERM→SIGKILL на process group след 5 s. | util.mjs, всички изброени, Engine.swift | Тест с mock, който не отговаря → `timeout` код за < 10 s; Swift тест за escalation с `sleep` процес. |
| B-13 | E8: promote на non-Netlify заобикаля 30-мин правилото, когато snapshot-ът съвпада (release-ът е доказателството). | release.mjs, netlify.mjs deployGuard | Тест: preview на Vercel fixture, време напред 40 мин → promote минава. |
| B-14 | C4: общ rate limiter `_shared/ratelimit.ts` (таблица `rate_events(user_id, action, at)` или in-memory per isolate + DB fallback) за billing checkout/portal/sync (5/мин), monitor test/register (10/мин), account export (2/час), admin (60/мин). | `_shared`, всички handler-и, `schema.sql` | Deno тестове 429 + RLS за новата таблица. |
| B-15 | C5+E11: retention политика: cloud `ai_usage` 12 м, `admin_audit` 24 м, holds 24 h след settle (в `run` на monitor или отделен cron); engine `ledger.jsonl` 10 000 реда, `chats` 500 реда/проект, `ops` 90 дни, `smoke-*`/`report-*` 30 дни; `listOps` през индекс `ops/index.json`. | monitor/handler.ts, costs.mjs, assistant.mjs, release.mjs | Тестове за подрязване; `docs/BILLING-AND-USAGE.md` §retention. |
| B-16 | A4+A5+A6: JSONSerialization за всеки `--json`; обратна връзка на всеки `try?` по потребителски път (или `show(error)`); assistantStore в observers. | AppModel, ProjectStore, RunController | Swift build; grep `try? await engine.run` без обработка = 0 на потребителски пътища. |
| B-17 | A7: `release-dryrun.yml` изпълнява `bundle-node.sh`; след build стартира `bid version` с `PATH=/usr/bin:/bin` и без `BID_ENGINE`. | workflows | Dry run зелен с тази стъпка; DMG размер отчетен в summary. |
| B-18 | D2+D3+D4+C8: почисти документите (acceptance §1 без светла тема; V11-HANDOFF/AUDIT-V11 с бележка „заменено“; бройки тестове от CI, не на ръка — скрипт `scripts/test-counts.mjs`, който ги пише в `docs/TEST-COUNTS.md`). | docs, scripts | `node scripts/test-counts.mjs --check` в engine.yml. |
| B-19 | `cloudDoctor` + `cloud-check`: проби за тайни на функциите (всяка функция с `{action:'health'}` → `{configured: {anthropic, paddle, cronSecret}}`), последен heartbeat, `billing.catalog` price ids ≠ null, `legal.*` зададени. Setup → Облак показва редовете. | всички handler-и (нов action `health`, без auth), cloud.mjs, setup.mjs, App Setup | Deno тестове; `cloud-check` печата таблица. |
| B-20 | Opt-in телеметрия (D6, решение §9 #9 на собственика): само събития без съдържание (команда, код на грешка, версия, macOS, продължителност), изключена по подразбиране, превключвател в Settings, таблица `telemetry_events` с RLS „само insert от собственика, четене от admin“, 90 дни retention. | account/handler.ts или нова функция, schema.sql, engine log.mjs, App Settings | RLS тест; engine тест, че без съгласие нищо не се праща; текст в privacy. |

### 4.3 P2 — преди 1.0 (≈ 6–8 дни)

| ID | Задача |
|---|---|
| B-30 | E10 pin на `netlify-cli`/`gh-pages` версии (или задължителна инсталация през Setup с проверка на версия). |
| B-31 | E12 `projects.max` в engine-а (`project add` → `plan_limit` код) + UI за upgrade. |
| B-32 | E13 `spaceship connect-domain --confirm DNS`, Netlify IP от `netlify api getSite`. |
| B-33 | C7 подпис на `latest.json` (ed25519, публичен ключ в bundle-а, `update.mjs` проверява). |
| B-34 | A9 достъпност: всеки ред-бутон е `Button` с label; фокус ред; shortcuts за всички екрани; `BIDScreen` покрива всичко; скрийншоти за assistant/usage/admin. |
| B-35 | A10 разбиване на файловете > 700 реда по екран; махни `ProductionSheet`. |
| B-36 | A8+A11 коректен „Node липсва“/„engine липсва“ и в менюто. |
| B-37 | Vercel/Cloudflare rollback (ROADMAP WP12 остатък) — възможно само с реални акаунти на тестерите. |
| B-38 | Тестове за командите без тест (§2.2): `netlify link/create/sites` с фалшивия CLI, `smart --prod`, `account recover`, `local restart`, `setup auto` с фалшив brew/npm. |
| B-39 | Светла тема (ROADMAP WP17, решение §9 #8) — само ако собственикът реши; иначе махни всички споменавания. |
| B-40 | D7+D8: dry run тригер; публикуване на `site/` от CI (Netlify deploy с secret, само ръчен dispatch). |

### 4.4 P3 — по-късно
E14 схема за settings · E15 publish ключ по project key · A12 @AppStorage · A13 Links enum · Lighthouse стъпка (WP11) ·
SFTP (WP16) · DNS здраве (WP15) · engine daemon (WP18) · Mac App Store track · V12 (клиенти/отчети/екипи).

---

## 5. План за бета

### Етап A — собственикът (1–2 дни, паралелно с B-01…B-08)

| # | Стъпка | Как се проверява |
|---|---|---|
| A1 | `SUPABASE_ACCESS_TOKEN` в GitHub → `cloud-deploy` с четирите входа | `cloud-check` показва 200 на таблици и функции |
| A2 | Тайни на функциите (`ANTHROPIC_API_KEY`, `PADDLE_*` sandbox, `MONITOR_CRON_SECRET`) | след B-19: `cloud-check` показва `configured: true`; до тогава: `bid ai fix` през облака връща резултат |
| A3 | `monitor-cron.sql` | `select * from monitor_heartbeat order by at desc limit 1` < 10 мин |
| A4 | Първи admin: `update profiles set role='admin' where email=…` | Admin панел се вижда в приложението |
| A5 | Admin панел → settings: `billing.catalog` price ids (Paddle sandbox), `release.url`, `help.url`, `legal.*`, `support.email` | Плановете не са „Скоро“; линковете се показват при изход |
| A6 | Публикуване на `site/` (privacy/terms/refund след B-04) | URL-ите отговарят 200 |
| A7 | Apple Developer ID + notary profile → `scripts/release.sh` на Mac с `BID_RELEASE_BASE_URL` | `spctl -a -vv` на DMG-то казва „accepted, Notarized Developer ID“; `latest.json` качен |
| A8 | Лично минаване на `docs/OWNER-ACCEPTANCE-TEST-BG.md` §0–§9 на чист Mac; резултатите в §10 | Таблицата §10 е попълнена |

Ако A7 се забави: бета тестерите получават unsigned DMG + инструкция (B-08). Това е приемливо за 3–5 познати
тестери и неприемливо за отворена бета.

### Етап B — агентът (P0, после P1)
Ред: B-01, B-02, B-03 (сигурност и данни) → B-05, B-06, B-07 (потребителят вижда грешки, цените са едни, има
обратна връзка) → B-04, B-08 (текстове) → P1 по ред на номерата. След всяка задача: CI зелено, commit с ID.

### Етап C — тестерите (2 седмици)

- 3–5 души: поне един без Node на машината, поне един на macOS 13, поне един с реален Netlify сайт, поне един
  с Vercel/Cloudflare, един на български и един на английски интерфейс.
- Всеки получава: DMG (подписан или инструкция), `docs/BETA-TESTERS-BG.md`, VIP роля (собствен ключ) или Flash
  план с ръчен грант през Admin → `grant_credits` (без Paddle) — така AI работи и без завършен Paddle.
- Обратна връзка: бутонът от B-07 + един общ канал (Slack/Discord/имейл). Всеки доклад = zip от `bid report`
  + описание. Собственикът/агентът ги превръща в задачи с ID `T-xx` в този документ.
- Критерий за край на бетата: всеки от §1–§6 на acceptance теста е минат от поне двама тестери без P0/P1
  находки; Paddle sandbox цикълът (§7) минат от собственика; нула crash файла в докладите за последната седмица.

### Какво тестерите НЕ трябва да могат да направят (защитата е в кода, проверено)
- Да платят истински пари: Paddle е sandbox (`PADDLE_ENV=sandbox`), а цените са в `settings`, не в приложението.
- Да пуснат чужд сайт в production: `--confirm DEPLOY` + собствен Netlify акаунт.
- Да видят чужди данни: RLS на всяка таблица (8 сценария), admin само по роля.
- Да похарчат неограничено от AI ключа на собственика: месечен грант, session cap 20 %/5 h, 6/мин, holds.

---

## 6. Противоречия в документацията, които трябва да изчезнат (списък за B-06/B-18)

| Тема | Вярно | Невярно/старо |
|---|---|---|
| Цени и кредити | `docs/PLANS-AND-CREDITS-BG.md` (9.99/29.99/99.99; 100k/250k/1M) | `HANDOFF-V10.md §6`, `ROADMAP.md §9 #1, §11.5`, `schema.sql` seed (trial 150k токена) |
| Светла тема | няма; ROADMAP WP17 отворен | `OWNER-ACCEPTANCE-TEST-BG.md §1` („Settings → Appearance“) |
| Сървърен мониторинг | построен, неактивен до cron | `V11-HANDOFF.md:134`, `AUDIT-V11.md §4.1` („не е имплементиран“) |
| Бройки тестове | 101 / 81 / 8 / 47 | RC audit (97/80/8/44), functions README (49), V11-HANDOFF (68) |
| WP10 | пуснат в 11.1 | `AUDIT-V11.md §4.8` |
| Free и вграден AI | Free = само външни бутони; VIP/admin = собствен ключ | `CLOUD-SETUP-BG.md:19-21` (собствен ключ за всеки) |
| 5-часов лимит | има session cap 20 %/5 h (решение 2026-09-30) | RC audit §3 („без измислени 5-часови лимити“) |

---

## 7. Как да се използва този документ с Codex

Примерна първа задача за агента (копирай в промпта):

> Работиш в repo-то Before I Deploy, клон `claude/nifty-edison-1195gi`. Прочети `docs/AUDIT-V11.1-BETA-BG.md`
> изцяло. Изпълни задачите B-01, B-02 и B-03 в този ред. За всяка: направи промяната, добави тестовете от
> колоната „Критерий за приемане“, пусни `node tests/run.mjs > OUT` (engine) или `deno test --allow-env
> --allow-net supabase/functions` (облак), пусни `node scripts/i18n-check.mjs` и `node scripts/error-codes.mjs`,
> commit с заглавие `B-0x: …`, push. Не пипай secrets, не добавяй истински ключове, не създавай PR. Ако
> критерият не може да се изпълни, спри и обясни защо, без да маркираш задачата за готова. В края обнови
> таблицата в §4.1 на документа със статус ✅ и commit hash.

Статус на задачите се води в таблиците на §4 (добави колона „Статус / commit“ при първата промяна). Нови находки
от бетата се добавят като `T-xx` в нова секция §8 със същите колони (прио, къде, ефект, критерий).

---

## 8. Приложение: бройки и команди за проверка

```
node tests/run.mjs > OUT && tail -2 OUT                      # engine: 101 passed (≈5 мин)
deno test --allow-env --allow-net supabase/functions          # 81 passed
cd tests/rls && node rls.mjs                                  # 8/8 (PGlite)
node scripts/i18n-check.mjs && node scripts/error-codes.mjs   # каталози: engine 719 ключа, app 1109
swift test   (само на Mac / CI app.yml)                       # 47 tests
```

Размер на кода: engine 9 100 реда (44 модула), app 12 500 реда (34 файла), cloud 4 200 реда (5 функции + схема),
тестове ≈ 2 000 (run.mjs) + 1 500 (Deno) + RLS. 91 commit-а в клона.

---

## 9. Статус след WP00–WP03 (2026-09-30)

**Базова линия (WP00).** Клон `claude/nifty-edison-1195gi`, начало `9016f35`, чисто работно дърво, без
`CLAUDE.md`/`AGENTS.md`. Среда: Linux контейнер (Node 22, Deno 2 от scratchpad, PGlite); Swift, подписване и
macOS sandbox се доказват само в CI (`app.yml`, `engine-macos.yml`, `release-dryrun.yml` на macos-15).
Проверки при старта: engine 101 ✅, Deno 81 ✅, RLS 8 ✅, Swift 47 ✅ (CI). Всяка находка по-долу е сверена с
кода преди поправката (ред и файл в §3); колоната „Базово“ казва как.

Легенда: **потвърдена** — видяна в кода на `9016f35`; **от прочит** — описана от картата на модулите, не
отворена ред по ред преди поправката; ✅ поправена и доказана с тест; ⚠️ поправена, доказателството е
ограничено (казва как); ⏳ не е правена (в кой пакет е); ⛔ блокирана (от какво).

| ID | Базово | Сега | Commit | Доказателство |
|---|---|---|---|---|
| E1 allowed_dirs `''` / `src/../x` | потвърдена | ✅ | 6d11b46 | `WP01 асистент: файл в корена…` |
| E2 изпълними конфигурации | потвърдена | ✅ | 6d11b46 | `WP01 пътища…` (config → отделно одобрение; secret → никога) |
| E3 пълна среда към скриптове | потвърдена | ✅ | 6d11b46 | `WP01 скриптове…` (Linux: env; macOS CI: sandbox блокира Keychain и папките на engine-а) |
| E4 override на адреси | потвърдена | ✅ | 6d11b46 | `WP01 endpoints…` (+ production маркер) |
| E5 undo без проверка | потвърдена | ✅ | 6d11b46 | `WP01 undo…` |
| E6 root publish без staging | потвърдена | ✅ | 6d11b46 | `WP01 публикуване…`; release тестовете качват staged копие |
| E7 без timeout | от прочит | ✅ | 3f72709 | `WP02 мрежа…`, stall сценарий в асистента |
| E8 30-мин правило при promote | от прочит | ✅ | 3f72709 | `WP02 release…` (guard ниво; реален Vercel/Cloudflare няма) |
| E9 тайни в argv | потвърдена | ✅ | 6d11b46 | `WP01 argv…`, logs тест |
| E10 `npx --yes` | потвърдена | ✅ | 6d11b46 | кодът; тестовете вървят със stub CLI вместо npx |
| E11 неограничен растеж на локални файлове | от прочит | ✅ | (WP08 commit) | `WP02 растеж…` (ledger, chats, ops 50/180 дни, манифести 20, smoke/доклади 30 дни) |
| E12 `projects.max` не се налага | от прочит | ⏳ | — | WP04 (права на сървъра и в engine-а) |
| E13 DNS без typed confirm | от прочит | ⏳ | — | WP09 (DNS diff + възстановима конфигурация) |
| E14 схема за monitor settings | от прочит | ⏳ | — | WP07 |
| E15 споделена staging папка | потвърдена | ✅ | 6d11b46 | `WP01 публикуване…` (отделни папки) |
| C1 retention 1000 реда / heartbeat | потвърдена | ✅ | 062198a | RLS (PGlite, 1500 реда) + Deno `monitor (WP03)…` |
| C2 непълен експорт | потвърдена | ✅ | 062198a | Deno `account (WP03)…` (2501 реда, monitor таблици) |
| C3 поверителност | потвърдена | ⚠️ | 062198a | текстът е обновен; правна проверка — собственикът |
| C4 rate limit само в ai-fix | от прочит | ✅ | 062198a | RLS (атомарност) + Deno (429, липсваща функция, грешка на базата) |
| C5 без retention политика | от прочит | ✅ | 062198a | `bid_prune`; `BILLING-AND-USAGE.md §7a` |
| C6 стар seed на каталога | потвърдена | ✅ | (този commit) | Deno `billing (WP04): the schema seed…` |
| C7 feed без подпис | от прочит | ⏳ | — | WP10 |
| C8 стари бройки тестове | потвърдена | ✅ | 062198a | functions README |
| A1 безкраен скелет | потвърдена (скрийншот) | ⚠️ | 3f72709 | компилира в CI; визуален тест с повреден engine — ръчно на Mac |
| A2 анонимен вход при грешка | от прочит | ⚠️ | 3f72709 | компилира в CI; ръчна проверка |
| A3 без timeout/SIGKILL в Swift | от прочит | ⚠️ | 3f72709 | компилира в CI; няма Swift тест за процеса |
| A4 JSON на ръка | потвърдена | ✅ | 3f72709 | JSONSerialization |
| A5 фалшиво „Запазено“ | от прочит | ✅ | 3f72709 | budget, notify |
| A6 assistantStore observers | от прочит | ✅ | 3f72709 | |
| A7 CI без bundled Node | потвърдена | ✅ | 87d7407 | release dry run: `PATH=/usr/bin:/bin`, runtime, production |
| A8 проба на engine-а | от прочит | ✅ | 3f72709 | |
| A9 клавиатура/VoiceOver | от прочит | ⚠️ | (WP08 commit) | всички редове с клик имат accessibility действие; ⌘5–⌘8 за останалите екрани; ⌘Y/⌘⇧R изключени без проект — VoiceOver минаване на Mac остава ръчно |
| A10 големи файлове / мъртъв код | от прочит | ⚠️ | (WP08 commit) | `ProductionSheet` и 15 неизползвани низа махнати; разделянето на файловете над 700 реда не е правено |
| A11 меню без engine | от прочит | ✅ | 3f72709 | |
| A12 @AppStorage в ObservableObject | от прочит | ⏳ | — | WP08 |
| A13 hard-coded URL-и | от прочит | ⏳ | — | WP08 |
| D1 три версии на цените | потвърдена | ✅ | (този commit) | seed + бележки в HANDOFF-V10 и ROADMAP §9 |
| D2 светла тема в теста | потвърдена | ✅ | (този commit) | acceptance §1 |
| D3 сървърен мониторинг „липсва“ | потвърдена | ✅ | (този commit) | бележки в V11-HANDOFF и AUDIT-V11 |
| D4 бройки тестове / WP10 | потвърдена | ⚠️ | (този commit) | ръчно; автоматичният `test-counts` (B-18) не е направен |
| D5 `ai.usdToEur` поддръжка | от прочит | ⏳ | — | WP04 |
| D6 телеметрия / обратна връзка | потвърдена | ⚠️ | (WP08 commit) | „Изпрати обратна връзка…“: redacted доклад, списък на файловете преди изпращане, имейл, който потребителят праща сам; телеметрия — решение на собственика (изключена по подразбиране) |
| D7 тригер на dry run | от прочит | ⏳ | — | WP10 |
| D8 ръчно публикуване на сайта | от прочит | ⏳ | — | WP10 |

**Бройки на тестовете сега:** engine 111 (Linux + macOS), Deno 87, RLS/SQL 10, Swift 47 (CI).

### 9.1 Какво от плана WP00–WP10 е направено и какво чака

| Пакет | Състояние | Какво остава и защо |
|---|---|---|
| WP00 | ✅ | тази таблица |
| WP01 | ✅ (E1–E6, E9, E10, E15) | изолацията на macOS е sandbox-exec (без мрежова изолация — инсталациите я искат); Linux няма изолация и го казва (`isolation: none`), затова автоматичните проверки не пускат променени скриптове |
| WP02 | ✅ / ⚠️ | Swift промените са доказани само с компилация и тестове на моделите; истинско „изключен engine“ на Mac — ръчно |
| WP03 | ✅ код / ⛔ облак | облакът още не е deploy-нат (§2.1): миграцията, функциите, cron и тайните са стъпки на собственика; тестова среда в Supabase също иска собственика |
| WP04 | ⏳ частично | един каталог (seed = defaults) ✅; сървърни права за сайт лимити, общ бюджет между устройства, renewal/cancel/refund/upgrade сценарии и sandbox checkout — **нужни са решенията за продаваемите планове (раздел 7 на плана не е в документа, който получих) и Paddle sandbox акаунт** |
| WP05 | ⏳ | общ договор за конектори; първият реален сценарий GitHub + Netlify иска тестов repository и сайт на собственика |
| WP06 | ⏳ | зависи от WP04/WP05; оценките на модели изискват реални задачи и ключ |
| WP07 | ⏳ | зависи от WP03 (deploy) и WP04 |
| WP08 | ⚠️ частично | обратна връзка ✅, accessibility действия и клавиши ✅, мъртъв код ✅; остават A12, A13, разделяне на големите файлове, VoiceOver и дълги BG текстове на Mac, телеметрия (решение) |
| WP09 | ⏳ | след WP05 |
| WP10 | ⛔ | Apple Developer ID, notary профил, решение за канал (директно / App Store) |
