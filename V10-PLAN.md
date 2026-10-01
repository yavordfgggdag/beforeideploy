# Before I Deploy V10 — план за надграждане

Дата: 27.09.2026 · За: Claude Code / Codex · Изисква прочитане на `AUDIT.md` преди работа. **Главният план за развитие (V10 → V12), корекциите към този документ и графикът са в `ROADMAP.md`.**

V10 превръща Before I Deploy от личен инструмент в продукт: многоезичен, с акаунти на три нива (Normal / VIP / Admin), абонаменти и кредити, вграден AI, платен от един централен API за обикновените потребители, и готовност за продажба (App Store и/или директно). Планът е разделен на 9 работни пакета (WP), всеки с цел, модел на данните, промени по engine/app/backend, тестове и критерии за готовност. В края има ред на изпълнение, оценка на времето и списък с решения, които собственикът трябва да вземе.

---

## 0. Три неща, които трябва да са ясни преди да започне работа

### 0.1 App Store срещу директна продажба — избери пътя рано

Mac App Store изисква **App Sandbox**. Сегашното приложение стартира външни CLI-та (`netlify`, `vercel`, `wrangler`, `gh`, `git`, `npm`, `codex`, `claude`), пише в `~/Library/Application Support`, чете произволни папки с проекти и ползва `security` за Keychain. Под sandbox всяко от тези е ограничено: достъп до папка само след като потребителят я избере (security-scoped bookmarks), външни бинарни файлове се изпълняват, но наследяват sandbox-а и често се чупят (nvm/volta/homebrew пътища, `~/.netlify` config, `~/.config/gh`), Keychain трябва да мине през Security framework, а не през `security` CLI.

Затова планът е в два коловоза:

| | Коловоз A — директна продажба (първи) | Коловоз B — Mac App Store (втори) |
|---|---|---|
| Подпис | Developer ID + notarization + DMG | App Store подпис, sandbox, entitlements |
| Плащания | Paddle или Lemon Squeezy (merchant of record — те начисляват ДДС по държави, ти получаваш нетна сума; важно за българско ЕООД/самоосигуряващ се) | StoreKit 2 (задължително за дигитални абонаменти в MAS), Apple взима 15% (Small Business Program) |
| Ограничения | Няма — engine-ът работи както сега | Sandbox: всички CLI действия се преместват в engine-а като **bundled** helper или се заменят с директни API извиквания (Netlify API, Vercel API, Cloudflare API, GitHub API) |
| Време | +2 седмици над основата | +5–7 седмици над коловоз A |

Препоръка: **V10.0 излиза по коловоз A**, с абонаментната логика написана зад интерфейс `BillingProvider`, така че коловоз B (StoreKit) да е втора имплементация на същия интерфейс, а не пренаписване. WP8 описва какво точно трябва за App Store.

### 0.2 Кредитите трябва да са истински

Идеята „да си мислят, че имат прекалено много кредити" се реализира честно: **квотите са щедри и реални**, показват се като големи, впечатляващи числа (напр. 1 000 000 токена), и се изразходват действително. Не показваме число, което не отговаря на истинска квота — това е основание за отхвърляне от App Review (guideline 3.1.2 / 5.6) и за потребителски искове по потребителското право в ЕС, а и убива доверието при първия потребител, който брои. Планът по-долу е така изчислен, че щедростта да е реална, но разходът да остане под приходите (WP4, раздел „икономика").

### 0.3 Централният AI ключ никога не е в приложението

Обикновените потребители ползват AI, платен от твоя ключ. Ключът стои **само в backend-а** (Supabase Edge Function). Приложението праща prompt + JWT на потребителя; backend-ът проверява абонамент и квота, извиква модела, брои токените, връща отговора. Всичко друго е пробиваемо за минути с `strings` върху бинарния файл.

---

## 1. Архитектура на V10

```
┌────────────────────────── Mac ──────────────────────────┐        ┌──────────────── Supabase ────────────────┐
│ SwiftUI app (i18n, roles, billing UI, AI panel)          │  JWT   │ Auth (email, GitHub, Apple)               │
│   └─ Engine (Node): checks, deploys, git, hosting, …     │ ─────▶ │ Postgres: profiles, subscriptions,        │
│        └─ aifix: target=cloud → HTTPS → Edge Function    │        │   credit_ledger, ai_usage, projects, …     │
│        └─ aifix: target=own-key (VIP/Admin) → direct API │        │ Edge Functions (Deno):                    │
│   └─ Keychain: session, own API keys (VIP/Admin only)    │        │   ai-fix (proxy + metering)               │
└──────────────────────────────────────────────────────────┘        │   billing-webhook (Paddle / App Store)    │
                                                                    │   admin (role-gated ops)                  │
                        Paddle / StoreKit ─────────────────────────▶│   usage (snapshot за приложението)        │
                                                                    └───────────────────────────────────────────┘
```

Принципи, наследени от V9 (AUDIT.md §4): engine-ът остава самостоятелен CLI с NDJSON; production иска `DEPLOY`; secrets само в Keychain; всички текстове през каталог за преводи (нов инвариант); backend-ът е единствен източник на истина за роли, абонаменти и кредити.

---

## 2. Работни пакети

### WP1 — Интернационализация (i18n) и избор на език

**Цел.** Първият екран за нов потребител е на английски и пита за език. Езикът се записва в профила в облака и локално. Всеки текст в приложението, engine-а, нотификациите и AI prompt-ите се превежда. Твоят акаунт остава на български.

**Езици.** Пълен списък на първи етап (32): en, bg, de, fr, es, it, pt-PT, pt-BR, nl, pl, cs, sk, ro, hu, el, tr, ru, uk, sr, hr, sl, sv, da, nb, fi, et, lv, lt, ja, ko, zh-Hans, zh-Hant. Втори етап: ar, he (RTL), hi, id, vi, th. Качество: en и bg се пишат на ръка; останалите се генерират машинно през скрипт (`scripts/i18n-translate.mjs`, AI превод с glossary) и се маркират `"reviewed": false`, докато носител на езика не ги прегледа. Приложението показва бадж „бета превод" за непрегледаните.

**Механизъм — приложение (Swift).**
- `App/Sources/BeforeIDeploy/Resources/<lang>.lproj/Localizable.strings` + `Package.swift` с `defaultLocalization: "en"` и `resources: [.process("Resources")]`. `.strings` (не `.xcstrings`), защото билдваме само с CLT.
- Всички литерали в изгледите минават през `L("key")` helper (`Localization.swift`): `NSLocalizedString` с `Bundle.module`, plus форматиране с плурали чрез `.stringsdict`.
- Езикът е `@AppStorage("locale")`; при смяна: `Bundle` override (swizzle на `main` bundle или собствен `LocalizedBundle`) и `objectWillChange` на AppModel — без рестарт.
- Числа, дати, валути: `Locale(identifier:)` от избрания език, `Fmt` се преработва да приема locale.
- RTL: `.environment(\.layoutDirection, …)` според езика (втори етап).

**Механизъм — engine (Node).**
- Всички `EngineError` съобщения и `step.summary` стават **ключове**: `throw new EngineError(t('deploy.needsConfirm'), 'usage', 2)`. Каталогът е `engine/i18n/<lang>.json`; `t()` чете `process.env.BID_LANG` (приложението го подава), fallback en.
- Резултатите носят и `code`, така че приложението може да превежда самостоятелно, ако текстът липсва.
- Тестовете пускат engine-а с `BID_LANG=en` и проверяват ключове, не низове.

**Механизъм — onboarding.**
- Нов екран `WelcomeLanguageView` преди AuthView: заглавие на английски, списък с езици с тяхното собствено име (`Locale.localizedString(forIdentifier:)`), предварително избран езикът на системата. Показва се докато няма `locale` в AppStorage.
- При регистрация езикът се праща в `profiles.locale`. При вход на друг Mac се взима от профила.
- Имейлите на Supabase (потвърждение, парола): шаблонът е един, затова се прави двуезичен (en + текст на езика на потребителя чрез `{{ .Data.locale }}` в custom template; Supabase Auth поддържа `data` metadata при signup) — приемливо за V10; пълна локализация на имейлите изисква custom SMTP + собствени шаблони (WP9).

**Модел на данните.** `profiles.locale text default 'en'`.

**Тестове.** Скрипт `scripts/i18n-check.mjs`: всеки ключ от en съществува във всеки език; няма неизползвани ключове; приложението се билдва без hard-coded кирилица извън `bg.lproj` (grep в CI).

**Готово когато:** нов потребител вижда английски + избор на език; смяна на езика от Настройки сменя целия UI и съобщенията от engine-а без рестарт; `bg` за твоя акаунт е идентичен с V9.

---

### WP2 — Профили, роли и Admin панел

**Цел.** Три нива: **normal** (купува абонамент, AI през централния ключ, хостинг акаунтите са негови), **vip** (приятели: безплатно, свързват сами всички API ключове, включително собствен AI ключ), **admin** (ти: всичко от VIP + управление на потребители, роли, кредити, цени).

**Модел на данните (Postgres, `supabase/schema.sql` v10).**
```sql
create type user_role as enum ('normal','vip','admin');
create type plan_tier as enum ('free','flash','high','knight');

create table profiles (
  user_id uuid primary key references auth.users on delete cascade,
  email text not null,
  display_name text,
  locale text not null default 'en',
  role user_role not null default 'normal',
  plan plan_tier not null default 'free',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- trigger: при insert в auth.users → ред в profiles (email, locale от raw_user_meta_data)

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(user_id) on delete cascade,
  provider text not null,              -- 'paddle' | 'apple' | 'manual'
  provider_ref text,                   -- subscription id при доставчика
  tier plan_tier not null,
  status text not null,                -- active | past_due | canceled | expired | trial
  period_start timestamptz, period_end timestamptz,
  cancel_at timestamptz,
  raw jsonb, updated_at timestamptz default now()
);

create table credit_ledger (               -- само за AI токени; хостинг кредитите са на доставчиците
  id bigserial primary key,
  user_id uuid references profiles(user_id) on delete cascade,
  delta bigint not null,                  -- + допълнение, − разход
  reason text not null,                   -- 'plan_grant' | 'topup' | 'ai_fix' | 'admin_grant' | 'refund' | 'expiry'
  ref text,                               -- ai_usage.id / order id
  created_at timestamptz default now()
);
create view credit_balance as select user_id, sum(delta) as balance from credit_ledger group by user_id;

create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(user_id),
  project_key text, step text,
  model text, input_tokens int, output_tokens int, cost_usd numeric(10,6),
  charged_tokens bigint,                  -- input+output × множител на модела
  status text, created_at timestamptz default now()
);

create table admin_audit (id bigserial primary key, admin_id uuid, action text, target uuid, payload jsonb, created_at timestamptz default now());
```
RLS: потребителят чете само своя `profiles`, `subscriptions`, `credit_ledger`, `ai_usage`; **никой не пише директно** в `role`, `plan`, `credit_ledger` през REST — само Edge Functions със service role. Admin четенето на чужди редове минава през `admin` функцията, не през RLS изключения.

**Engine.** `account status` връща `{ role, plan, locale, credits: { balance, monthlyGrant, renewsAt }, features }`. Нов модул `engine/src/features.mjs`: `can(feature)` от `role` + `plan` (напр. `ai.cloud` само за normal с активен план; `ai.ownKey` за vip/admin; `admin.panel` за admin; `projects.max`).

**Приложение.**
- `AccountState` получава `role`, `plan`, `credits`, `features`.
- **AdminView** (виждат го само admin): списък потребители (търсене по имейл), роля, план, баланс, последна активност; действия: смени роля, дай/вземи кредити с причина, спри AI на потребител, виж `ai_usage` на потребител, глобални настройки (цени на плановете, модел по план, дневен лимит). Всяко действие → `admin` Edge Function → `admin_audit`.
- **VIP setup**: в Настройка се появява група „AI ключове" (OpenAI, Anthropic) само за vip/admin; ключовете отиват в Keychain (`secrets.mjs` account `ai-openai`, `ai-anthropic`), проверяват се с една заявка при въвеждане.
- Роля/план се обновяват при всеки старт и на всеки 15 мин (`usage` функция), и веднага след покупка.

**Edge Function `admin`** (Deno): проверява JWT → `profiles.role = 'admin'` → изпълнява действие със service role. Действия: `list_users`, `set_role`, `grant_credits`, `set_plan_manual`, `disable_ai`, `get_usage`, `set_settings`.

**Тестове.** Mock Supabase в `tests/run.mjs` се разширява с `/rest/v1/profiles`, `/functions/v1/admin`; тестове: normal не вижда admin; vip без ключ получава ясна грешка „добави AI ключ"; admin grant → баланс.

**Готово когато:** твоят акаунт е admin (ръчен `update profiles set role='admin'`), приятел с vip вижда полетата за ключове и няма нужда от абонамент, normal вижда планове.

---

### WP3 — Вграден AI Fix (cloud и own-key)

**Цел.** Освен сегашните външни targets (ChatGPT/Claude в браузър, Codex/Claude Code в терминал) се появява **вграден AI панел**: prompt-ът се праща към модел, отговорът се стриймва в приложението, предложените промени се показват като diff и се прилагат **само след потвърждение** („AI мисли и поправя; приложението прави останалото" — потребителят натиска „Приложи").

**Пътища.**
- `target=cloud` (normal с активен план): engine → `POST https://<project>.supabase.co/functions/v1/ai-fix` с Bearer user JWT, body `{ prompt, project: {framework, pm}, step, locale, model_hint }`. Отговорът е SSE stream (`text/event-stream`) с `delta`, `usage`, `done`.
- `target=own-key` (vip/admin): engine извиква директно Anthropic/OpenAI API със собствения ключ от Keychain; същият формат на стрийма към приложението (нормализация в `engine/src/ai/provider-*.mjs`).
- Изборът на модел: Flash → бърз/евтин клас (Haiku-клас), High/Knight → среден клас (Sonnet-клас), Knight има и „Дълбока поправка" с най-силния модел с множител ×5 на таксуваните токени. Own-key потребителите избират сами.

**Engine — нов модул `engine/src/ai/`.**
- `prompt.mjs` — преизползва `aifix.buildPrompt` + системен prompt на езика на потребителя, който изисква отговор във формат: обяснение (кратко) + блокове `--- FILE path` / unified diff. Максимален размер на prompt-а 60k символа; логът се съкращава умно (последните редове + редовете с error).
- `stream.mjs` — общ SSE парсер; емитва NDJSON събития `ai` `{ delta }`, `ai.usage`, `ai.done`.
- `patch.mjs` — парсва diff блоковете, валидира че файловете са в проекта, прави dry-run (`git apply --check` ако е repo; иначе собствен patcher), връща списък `{ file, hunks, additions, deletions }`.
- Команди: `bid ai fix --project P --step S [--model M]` (стрийм), `bid ai apply --project P --patch-file F --yes` (записва и прави auto-commit по избор), `bid ai usage`.
- Redaction остава задължителна преди всяко изпращане, включително own-key.

**Edge Function `ai-fix`** (Deno, TypeScript, `supabase/functions/ai-fix/index.ts`).
1. Верифицира JWT; чете `profiles` (role, plan, ai_disabled).
2. Ако `role=normal`: изисква `subscriptions.status in (active, trial)`; чете `credit_balance`; отказва при `balance <= 0` с код `quota_exhausted` и `renewsAt`.
3. Rate limit: 6 заявки/минута и 60/час на потребител (Postgres `ai_rate` таблица или Upstash Redis); prompt ≤ 60k символа.
4. Извиква модела (Anthropic Messages API със стрийм; ключът е в `Deno.env` — Supabase secrets), пренасочва стрийма към клиента.
5. При край: записва `ai_usage` (реални input/output tokens от API-то, `cost_usd` по таблица с цени в `settings`), `credit_ledger` delta = −charged_tokens. Ако стриймът прекъсне — таксува само реално отчетените токени.
6. Fair-use: дневен таван 15% от месечната квота (защитава от изчерпване на месеца за час и от злоупотреба с споделени акаунти); при достигане — съобщение „днешният лимит е достигнат, утре продължаваш".

**Приложение.**
- **AIPanel** (в RunOverlay, вместо/до AIFixBar): бутон „Оправи с AI" → стрийм на текста с Markdown рендер, след това списък на файловете с diff преглед (side-by-side, `DiffView` на SwiftUI върху текст), чекбокс по файл, „Приложи избраните" → `bid ai apply --yes` → нова проверка автоматично (опция).
- Индикатор за кредити в панела: „Остават 812 340 токена · подновява се на 14.10".
- За normal без план: панелът показва плановете (WP4). За vip без ключ: линк към Настройка → AI ключове.
- Външните targets (ChatGPT/Claude/Codex/Claude Code) остават както в V9 за всички роли — те са безплатни за теб.

**Тестове.** Mock `ai-fix` функция в тестовия сървър (стриймва фиксиран отговор с diff); тест: prompt е редактиран; diff се прилага само с `--yes`; файл извън проекта се отхвърля; quota_exhausted → exit код 8 (нов); own-key без ключ → ясна грешка.

**Готово когато:** normal потребител с план натиска „Оправи с AI", вижда обяснение и diff, прилага го, повторната проверка минава; балансът в облака намалява с реалните токени.

---

### WP4 — Абонаменти, кредити и икономика

**Планове (предложение; собственикът потвърждава цените).**

| План | Цена/мес (с ДДС, ЕС) | AI токени/мес | Модел | Проекти | Cloud sync | Ориентировъчно колко поправки |
|---|---|---|---|---|---|---|
| Free | 0 | 0 (само външни AI бутони) | — | 2 | не | — |
| **Flash** | €4.99 | **250 000** | бърз клас | 5 | да | ~40 |
| **High** | €9.99 | **1 000 000** | среден клас | неограничено | да | ~160 |
| **Knight** | €19.99 | **2 500 000** + „Дълбока поправка" | среден + най-силен (×5) | неограничено | да + приоритетна опашка | ~400 |

Годишен вариант: −20% (2 месеца безплатни). Допълнителни пакети (consumable): 500 000 токена за €4.99, 2 000 000 за €14.99 — валидни 12 месеца, харчат се след месечната квота. Trial: 7 дни High при първа регистрация (кредитна карта се иска при Paddle; при Apple — introductory offer).

**Икономика (провери актуалните цени на API-тата преди пускане; числата са предположения за среден клас модел ≈ $3/M вход и $15/M изход, бърз клас ≈ $1/M вход и $5/M изход, среден микс 70/30 вход/изход).**
- Средна поправка ≈ 6 000 токена (4 500 prompt + 1 500 отговор).
- Flash при 100% изчерпване: 250k × ≈$2.2/M = **$0.55** срещу нетен приход ≈ €3.50 (след Paddle ~5%+€0.50 и ДДС) → марж >80%.
- High при 100%: 1M × ≈$6.6/M = **$6.6** срещу ≈ €7.60 нетно → марж ~15% в най-лошия случай; реалното изчерпване в такива продукти е 10–30%, така че очакван марж >70%.
- Knight при 100%: 2.5M × $6.6/M = **$16.5** срещу ≈ €15.50 нетно → в най-лошия случай леко на загуба, компенсирано от дневния таван (15%/ден прави пълното изчерпване рядко) и от очакваната употреба. Ако се потвърди, че тежките потребители са много, Knight става 2 000 000 или €24.99.
- „Дълбока поправка" (най-силен модел, ≈ $15/M вход, $75/M изход) се таксува ×5 токена — покрива цената.
- Apple вместо Paddle: 15% комисионна при Small Business Program (<$1M/год.), без ДДС грижи — маржовете са сходни.

**Как се показват кредитите.** В цялото приложение „AI кредити" = токени, с големите числа форматирани по locale („1 000 000"). Прогрес пръстен в AccountBadge и в AIPanel; страница „Абонамент" с история на разходите (от `ai_usage`), дата на подновяване, бутон за пакети, управление на абонамента (линк към Paddle customer portal / App Store subscriptions).

**Механизъм на квотите (backend).**
- При активиране/подновяване на абонамент: `credit_ledger` +месечна квота, `reason='plan_grant'`, и `expiry` на неизползваното от предишния месец (месечните не се натрупват; пакетите се натрупват — отделен `bucket` колона: `plan` | `topup`).
- Изразходване: първо `plan`, после `topup`.
- Downgrade/cancel: важи от края на периода; квотата остава до тогава.
- Refund (Paddle webhook / Apple refund notification): −оставащото от гранта.

**`BillingProvider` интерфейс (Swift + engine).**
```
protocol BillingProvider {
  func products() async -> [Plan]                // тиерите с локализирани цени
  func purchase(_ plan: Plan) async throws       // отваря Paddle checkout / StoreKit purchase
  func restore() async throws
  func manage()                                  // portal / App Store settings
}
```
- `PaddleBilling`: отваря hosted checkout в браузър (или overlay WKWebView) с `custom_data: { user_id }`; успехът идва по webhook → `subscriptions`; приложението пулира `usage` 10 сек.
- `StoreKitBilling` (коловоз B): StoreKit 2 `Product.products(for:)`, `purchase()`, `Transaction.currentEntitlements`; JWS транзакцията се праща на `billing-webhook` (`provider=apple`) за сървърна проверка чрез App Store Server API; App Store Server Notifications V2 обновяват `subscriptions`.

**Edge Function `billing-webhook`.** Верифицира подписа (Paddle: HMAC; Apple: JWS с Apple root cert), идемпотентност по event id, ъпдейт на `subscriptions` + `profiles.plan`, `credit_ledger` grant/expiry. Логва всичко в `billing_events`.

**Тестове.** Unit тестове на функцията (Deno test) с фикстури от Paddle и Apple; engine тест с mock `usage`; сценарии: нов абонамент → грант; подновяване → expiry+grant; отказ → без грант след period_end; пакет → topup bucket.

**Готово когато:** тестов Paddle sandbox абонамент активира High в приложението за <30 сек; квотата се вижда и намалява; downgrade работи от края на периода.

---

### WP5 — Onboarding, вход и Sign in with Apple

- Поток: **Език → Добре дошъл (стойност за 3 екрана) → Регистрация/Вход (email, GitHub, Apple) → Избор на план (с „продължи с Free") → Setup wizard (инструментите, само задължителните за ролята) → Добави първи проект.**
- **Sign in with Apple** е задължителен, ако предлагаш GitHub login и отиваш в App Store (guideline 4.8); Supabase поддържа Apple provider. За коловоз A е по избор, но се прави веднага, за да не се пренаписва.
- GitHub OAuth App се създава в GitHub (callback `https://<project>.supabase.co/auth/v1/callback`) и се въвежда в Supabase → бутонът „Продължи с GitHub" заработва.
- Verification email: задължителен за normal (плащане); vip/admin се създават от админ панела с покана (`admin` → `inviteUserByEmail`).
- Изтриване на акаунт от Настройки (задължително за App Store, guideline 5.1.1(v); добра практика и извън него): `admin`-функция `delete_me` → анулира абонамента (Paddle API) → `auth.admin.deleteUser`.

---

### WP6 — Инженерни подобрения от одита (задължителни за продукт)

1. **Разделяне на AppModel** на `ProjectStore`, `AccountStore`, `BillingStore`, `HostingStore`, `RunController`; `AppModel` остава фасада. Без промяна в поведението — направи го първо, за да не расте дългът с новите екрани.
2. **Инкрементален check**: кеш по `git rev-parse HEAD` + hash на working tree (`git diff --stat` + untracked списък) + `package-lock` hash; build/lint/typecheck се пропускат при съвпадение с последен `pass`, освен `--force`.
3. **Версии и self-update**: `VERSION` се чете от един файл (`VERSION`), `install.sh`/`build.sh` го пишат в Info.plist; `bid update check` пита `https://<домейн>/releases/latest.json`; приложението показва банер и отваря DMG (коловоз A) / App Store (коловоз B). Sparkle не се ползва (Objective-C зависимост, нужен е Xcode).
4. **Сираци на Local Preview**: при `start` сканирай 4173–4300 за отговарящ сървър с header `X-BID-Project` (static-server го добавя) и го осинови/спри.
5. **Реални тестове на Vercel / Cloudflare / GitHub Pages** с тестови акаунти (ръчен чеклист в `docs/manual-qa.md`); поправки по изхода на CLI-тата (preview URL парсене).
6. **Crash/грешки**: `os_log` категории в приложението; „Изпрати доклад" бутон, който пакетира последните логове (без secrets) в zip към `support@…` или Edge Function `support`.
7. **Swift тестове** (`swift test` работи с CLT): `EngineOutcome` парсер, `Models` декодиране от фикстури NDJSON, `Localization` fallback, `BillingProvider` mock.

---

### WP7 — Дизайн и UX на новите екрани

Запазва се системата от V9 (тъмна тема, systemBlue, карти). Нови екрани, всички през `L()`:
- **Welcome/Language** — пълноекранен, лого, grid с езици (флагове не се ползват — двусмислени; ползва се името на езика на самия език).
- **Plans** — три карти (Flash/High/Knight) с крупното число токени, „най-популярен" на High, месечно/годишно превключвател, цени в локалната валута (от Paddle/StoreKit), бутон „Продължи с Free".
- **Account** (нова страница в sidebar-а вместо popover-а): профил, език, план, кредити с пръстен, история на AI употребата, абонамент/пакети, ключове (vip/admin), изтриване на акаунт.
- **Admin** — таблица потребители, детайл, глобални настройки, одит лог.
- **AIPanel** — стрийм + diff преглед + Приложи.
- **Setup** — групите се филтрират по роля (normal не вижда „AI ключове").
- Иконография: SF Symbols; „Дълбока поправка" с `brain` символ; кредитите с `bolt.fill`.

---

### WP8 — Пускане: Developer ID (A) и App Store (B)

**Коловоз A (V10.0).**
- Apple Developer Program ($99/год.), Developer ID Application сертификат, `codesign --options runtime` с Hardened Runtime entitlements (`com.apple.security.cs.allow-unsigned-executable-memory` не е нужен; `allow-jit` не; трябва `disable-library-validation` само ако се зареждат чужди dylib — не), `notarytool submit`, `stapler`. `scripts/release.sh` прави DMG (`create-dmg`), подписва, нотаризира, качва `latest.json` + DMG в release bucket (Supabase Storage или R2).
- Сайт: landing (EN + BG), цени, изтегляне, документация, Privacy Policy, Terms, Refund policy (Paddle изисква), контакт.
- Paddle: продукти (3 плана × месечно/годишно + 2 пакета), webhook URL, sandbox тестове, данъчна регистрация (Paddle е merchant of record — фактурира той).

**Коловоз B (V10.x).**
- Entitlements: `app-sandbox`, `network.client`, `files.user-selected.read-write`, `files.bookmarks.app-scope`; **не** `temporary-exception`-и (отхвърлят се).
- Engine под sandbox: Node се **бандълва** в приложението (`Contents/Resources/engine/node` — Node за arm64/x86_64, ~50 MB) — без зависимост от nvm/brew; всички CLI операции се пренаписват към директни REST API извиквания (Netlify Deploy API с zip/file digest, Vercel Deployments API, Cloudflare Pages Direct Upload, GitHub REST/Contents API за Pages) — така `netlify`, `vercel`, `wrangler`, `gh` не са нужни. `git` остава чрез бандълван статичен `git` (или `libgit2` през SwiftGit2 — но изисква Xcode; по-просто: бандълван git binary). `npm run build` се изпълнява с бандълвания Node + `npm` от `node_modules/.bin` на проекта (проектът е в user-selected папка → достъпът е разрешен). Local Preview: бандълван static server (вече е такъв). Codex/Claude Code targets: генерирането на `.command` файл + отваряне в Terminal е позволено (NSWorkspace open).
- Keychain през `Security` framework в Swift (engine-ът получава secrets по stdin, не от `security` CLI).
- StoreKit 2 + `StoreKitBilling`; App Store Connect: продукти, Small Business Program, локализирани описания на 32 езика (генерирани от същия каталог), скрийншоти, App Privacy (данни: email, usage data за AI; не за проследяване), demo акаунт за App Review с High план и тестов проект, Review Notes на английски, обяснение че AI ползва трети страни (Anthropic) и че потребителският код се праща само при натискане на „Оправи с AI".
- Очаквани проблеми при review: изпълнение на потребителски build скриптове (обясни, че е dev инструмент, като Xcode-подобни; има прецеденти), външни линкове за плащане (в MAS версията Paddle бутоните се скриват — guideline 3.1.1).

---

### WP9 — Втори етап (след V10.0)

- Локализирани имейли през custom SMTP (Resend) + шаблони от i18n каталога.
- Екипи: VIP/Knight могат да канят клиент с read-only статус страница (web) — публичен линк с токен.
- Web dashboard (Next.js на Vercel) за абонамент и usage без приложението.
- Windows/Linux клиент за engine-а (Tauri) — engine-ът вече е кросплатформен.
- Ползване на кредити и за други AI функции: обяснение на грешка от build, генериране на commit message, SEO/Lighthouse доклад с препоръки.

---

## 3. Ред на изпълнение и оценка

| Седмица | Пакети | Резултат |
|---|---|---|
| 1 | WP6.1 (разделяне на AppModel), WP1 engine i18n (`t()`, каталог en/bg) | нищо ново за потребителя; кодът е готов за растеж |
| 2 | WP1 app i18n (Localization.swift, `L()`, всички екрани), Welcome/Language екран, машинен превод на 30 езика | многоезично приложение |
| 3 | WP2 схема + `admin` функция + AdminView + VIP ключове | роли работят; ти си admin |
| 4 | WP3 engine `ai/` + `ai-fix` функция + AIPanel (own-key първо, после cloud) | вграден AI с diff |
| 5 | WP4 схема за билинг + Paddle + webhook + Plans/Account екрани | абонаменти в sandbox |
| 6 | WP5 onboarding, Apple/GitHub login, изтриване на акаунт; WP6.2–6.4 | пълен потребителски поток |
| 7 | WP6.5–6.7, WP7 полиране, ръчен QA чеклист на 3 езика, beta с 3–5 VIP приятели | release candidate |
| 8 | WP8-A: Developer ID, notarization, DMG, сайт, Paddle live | **V10.0 публичен** |
| 9–14 | WP8-B: sandbox, бандълван Node/git, API-базирани deploy-и, StoreKit, App Store review | V10.5 в Mac App Store |

Оценката е за един агент/разработчик на пълен ден. Тестовете (`node tests/run.mjs`, `swift test`, Deno тестове на функциите) трябва да са зелени в края на всяка седмица. Всяка седмица завършва с `Install Before I Deploy.command` на твоя Mac и ръчна проверка на чеклиста от AUDIT.md §8.

## 4. Нови инварианти за V10 (добавят се към AUDIT.md §4)

11. Нито един потребителски низ извън i18n каталога (CI grep).
12. Централният AI ключ съществува само в Supabase secrets; приложението и engine-ът никога не го получават.
13. `role`, `plan`, `credit_ledger` се променят само от Edge Functions със service role; RLS забранява запис от клиента.
14. Всяка AI заявка се таксува по реални токени от API отговора; показаният баланс = сумата на `credit_ledger`.
15. Diff от AI се прилага само след явно потвърждение и само върху файлове в папката на проекта.
16. Billing логиката минава през `BillingProvider`; Paddle и StoreKit са взаимозаменяеми имплементации.

## 5. Решения, които собственикът трябва да вземе

1. Цени и квоти на Flash/High/Knight (таблицата в WP4 е предложение).
2. Paddle или Lemon Squeezy за коловоз A (и двата са merchant of record; Paddle има по-добър Mac опит, Lemon Squeezy е по-прост).
3. Кой AI доставчик е централният (Anthropic по подразбиране в плана; OpenAI е замяна на едно място в `ai-fix`).
4. Домейн за сайта, име на фирмата за Terms/Privacy, имейл за поддръжка.
5. Дали Free планът включва cloud sync (в плана: не).
6. Списъкът от 32 езика — потвърди или съкрати за V10.0.

## 6. Първи задачи за Claude Code (в този ред)

```
1. Прочети AUDIT.md и V10-PLAN.md.
2. WP6.1: раздели AppModel на ProjectStore/AccountStore/HostingStore/RunController без промяна в поведението; swift build; ръчен smoke test.
3. WP1 engine: добави engine/i18n/{en,bg}.json и t(); замени всички EngineError/step текстове с ключове; BID_LANG; тестовете зелени.
4. WP1 app: Localization.swift, L(), Resources/en.lproj + bg.lproj; замени всички низове; WelcomeLanguageView; смяна на езика без рестарт.
5. scripts/i18n-translate.mjs + scripts/i18n-check.mjs; генерирай останалите езици.
6. Продължи по седмици 3–8.
```
