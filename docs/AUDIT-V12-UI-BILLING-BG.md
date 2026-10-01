# Одит V12 — дизайн, AI асистент, автоматична настройка, планове и използване

**Дата:** 2026-10-01 · **База:** `claude/nifty-edison-1195gi` @ след `c15a3a4` · **Тип:** само четене (нищо не е поправено)
**За кого:** изпълнител (Codex) + собственик. Промптът за изпълнение е в `docs/CODEX-PROMPT-V12.md`.

Подробните находки (с файл:ред, доказателство и точна поправка) са в четири приложения:

| Приложение | Тема | Находки |
|---|---|---|
| [`docs/audit-v12/plans-usage.md`](audit-v12/plans-usage.md) | Планове, кредити, плащания, използване (app + engine + Supabase) | PU-1 … PU-48 |
| [`docs/audit-v12/assistant.md`](audit-v12/assistant.md) | Вграденият AI асистент — вид и поведение + целеви дизайн | AI-1 … |
| [`docs/audit-v12/setup.md`](audit-v12/setup.md) | Автоматичната настройка, PATH, инсталации, auto-check + целеви поток | SU-1 … SU-37 |
| [`docs/audit-v12/design.md`](audit-v12/design.md) | Цялостен дизайн, консистентност, достъпност, превод + Design System v2 | UI-1 … UI-48 |

Решенията за кредитите са в `docs/PLANS-AND-CREDITS-V2-BG.md` §17.2 (одобрени) — те са задължителни.

---

## 1. Резюме — защо „не изглежда и не работи като хората“

### 1.1 Автоматичната настройка не работи — коренна причина
Приложението от DMG пуска engine-а с вградения `node` и с PATH-а на Finder (`/usr/bin:/bin:/usr/sbin:/sbin`).
Затова **нищо, което настройката открива или инсталира, не може да бъде намерено**:
- „Node.js“ винаги е червено, макар engine-ът да върви на Node (SU-1, SU-2);
- вграденият runtime няма `npm` → „Инсталирай Netlify CLI“ гърми с `spawn npm ENOENT` / „Грешка (код -2)“ (SU-3);
- `npm -g` иска sudo (EACCES) или пише там, откъдето обновяването на приложението го трие (SU-4);
- `/usr/bin/git` шимът се брои за „инсталиран Git“ и отваря прозореца за Xcode при всяко обновяване (SU-6);
- **`setup auto` връща `ok:true` дори когато всички стъпки са паднали — приложението показва зелено и конфети** (SU-8),
  а незатворени стъпки стават зелени в края (SU-9).
Възпроизведено: `env -i PATH=/usr/bin:/bin bid setup auto --yes` → `ok:true, failed:[netlify-cli, gh-auth, git-identity, netlify-login], installed:[]`.

### 1.2 Плановете и използването „не са настроени“
- Без качената облачна функция `billing` и без вход **нищо не се показва** — дори публичният каталог (PU-1); облакът днес връща 404.
- Нито един `paddlePriceId` не е зададен, `checkout.html` има `REPLACE_WITH_CLIENT_SIDE_TOKEN` → всички бутони са „Скоро“ (PU-2).
- Празно състояние = един сив ред в празен прозорец 880×560 (PU-4); екранът „Използване“ показва на клиента инструкции за собственика (PU-5).
- **Четири различни ценоразписа** (сайтът, кодът, V1, V2) — правен риск (PU-33).
- Четири различни визуализации на „колко кредита имам“ с **различни числа** (PU-7, PU-24).
- Ъпгрейд създава **втори абонамент в Paddle** → двойно таксуване (PU-19, критично).
- Нищо от V2 (сайт-месеци, активни сайтове, седмичен прозорец, прагове 75/90/100 %, реално време) не е изградено (PU-36…PU-44).

### 1.3 AI асистентът е „много грозен“
Асистентът няма собствен чат интерфейс — това е **дебъг конзола**:
- поточният отговор е **суров JSON в моноширинен шрифт** (AI-1), отговорите са списък ключ/стойност;
- няма markdown, няма code blocks, няма избор на модел, няма вграден вход за ключ;
- полето за писане е едноредово системно поле с шест бутона под него;
- запазените разговори се зареждат като празни карти.
Пълен целеви дизайн (размери, компоненти, състояния, движение) — `audit-v12/assistant.md` §5.

### 1.4 Общ дизайн
610 ръчни размера на шрифт в 33 размера, 0 семантични шрифта, 30 `Color(hex:)`, 12 различни радиуса, 15 вида „значки“,
9 вида прогрес ленти, 8 вида заглавия, няма светъл режим, контраст под WCAG AA на основните бутони,
19 бутона само с икона без име за VoiceOver, 5 безкрайни анимации на всеки екран (батерия), английски в българския
интерфейс („Smart Deploy | Production“), „Пускане“ означава две различни неща (UI-1…UI-48).

---

## 2. Решения (задължителни за изпълнителя)

| Тема | Решение |
|---|---|
| Валидност на кредитите (D2) | Абонаментът стига за обещаното при пълноценно ползване: кредитите от едно плащане важат **Flash 1 мес., High 3 мес., Knight 10 мес.**, харчат се FIFO. 1 сайт-месец = 100 000 кредита. |
| Планове | Flash 9,99 € / 100 000 · High 29,99 € / 300 000 · Knight 99,99 € / 1 000 000 (+ домейн; 3 000 Netlify кредита зад флаг до потвърждение от Netlify). Активни сайтове: 1 / 3 / 10 (fair use 25). Цени с ДДС. |
| Пакети | 4,99 / 19,99 / 39,99 € за 100k / 500k / 1M, важат 12 месеца, **не** заобикалят 5ч/седмичния прозорец. |
| Прозорци | 5-часов (20 % от месечните кредити) и седмичен (40 %), котва — началото на абонамента; Knight „Boost“ +50 % за 24 ч веднъж седмично. |
| Подкани | 75 % изразходвани → Flash/High „Надградете“, Knight „Купете кредити“; 90 % банер; 100 % меко спиране с час на нулиране. Сайтове никога не се трият. |
| Единица | Навсякъде „кредити“, никога „токени“. Netlify кредитите се наричат „Netlify кредити“. |
| Терминология (bg) | deploy → „публикуване/публикувай“, production → „на живо“, preview → „преглед“, Launch checklist → „Път до публикуване“, Release → „Публикуване на живо“, Smart Deploy → „Умно публикуване“, Mission Control → „Контролен център“. |
| Плащания | Paddle **само sandbox**. Никакви реални покупки, никакви истински ключове в repo-то. |
| Външен вид | Светъл + тъмен режим (по системата, с избор в Настройки). Design System v2 от `audit-v12/design.md`. |
| Настройка | Без sudo никога; инструментите — в `~/Library/Application Support/BeforeIDeploy/tools`; PATH се смята в launcher-а; вграденият runtime носи npm/npx. |

---

## 3. План за изпълнение (фази, ред и критерии за приемане)

Всяка фаза = отделен commit (или няколко), зелен CI, обновен CHANGELOG (en + bg).

### Фаза 1 — Настройката да работи (SU-1…SU-13, SU-22, SU-31)
1. `engine/bid`: PATH преди exec на вградения node (tools/bin → env.zsh → стандартни папки → системни → runtime/bin последен); `/bin/zsh -f`.
2. `bundle-node.sh`: npm + npx във вградения runtime. `setup.mjs`: npm резолвер, `--prefix tools/`, без `-g`, staging + атомарно преименуване, lock.
3. Редът „Node.js“ е OK при вграден runtime; git проверка без шима; облачните редове — само за admin, никога required.
4. Честен резултат: `ok:false` + `code:'setup_incomplete'`; всяка стъпка завършва с pass/fail/skipped/blocked; без конфети при частичен успех; правилни step id-та; лог на всяка стъпка; „Опитай пак неуспешните“.
5. Preflight (мрежа, диск), офлайн за ≤15 s, heartbeat всеки 5 s, таймаути по спецификацията, четецът на stdout се затваря 2 s след изхода.
**Приемане:** матрицата в `audit-v12/setup.md` §9 (8 сценария) + нов тест в `tests/run.mjs` с `env -i PATH=/usr/bin:/bin`, който доказва: `setup status` вижда вградения Node, `setup auto` при липсващ npm връща `ok:false`.

### Фаза 2 — Design System v2, основа (UI-1…UI-14, UI-33…UI-40)
1. Токени: `Tone`, `Typo`, `Space`, `Radius`, `Elevation`, динамични цветове (светли + тъмни стойности); премахване на принудителния тъмен режим; Настройки → Външен вид.
2. Компоненти: `Card`, `Badge`, `Meter`, `BIDButtonStyle` (с focus ring), `IconButton`, `BIDField`, `Segmented`, `SelectableRow`, `EmptyState/LoadingState/ErrorState`, `ToastCenter`, `ScreenScaffold/PageHeader/SectionHeader`, `SheetScaffold` (размери s/m/l/xl, скрол), `ModalShell`.
3. Достъпност и контраст: fill токени ≥4,5:1, имена на бутоните с икони, `isModal` на overlay-ите, тостове, които не изчезват при грешка.
4. „Диета“ на анимациите: статичен/ограничен Aurora, най-много един glow, без декоративно „дишане“, конфети само при преход към „готов“.
**Приемане:** 0 `Color(hex:` и 0 `.system(size:` извън `DesignSystem/` (SwiftLint правило или grep тест в CI); screenshot CI с Light + Dark + 1080×700 + дълго име.

### Фаза 3 — Нов AI асистент (AI-*)
Пълното пренаписване по `audit-v12/assistant.md` §5: истински чат (балончета, markdown, code blocks с копиране, diff преглед),
многоредов композер (⌘↩ изпраща), поток на текст (не JSON — engine-ът да стриймва само `answer` полето), карти за предложени действия
с ясно „Приложи / Отмени“, история на разговорите, която се зарежда, бутон „Спри“, празно състояние с предложения,
показване на кредитите/бюджета със `Meter`, вход за ключ и избор на модел в самия асистент, грешки за квота с изходи „Купи кредити / Смени плана“.
**Приемане:** нов engine тест за стрийма (само текст към UI), Swift тестове за декодиране, скрийншот на асистента в CI (празен, с разговор, с diff).

### Фаза 4 — Планове и използване, видими и верни (PU-1…PU-35, PU-45…PU-48)
1. Офлайн/публичен каталог в engine (`plans-catalog.mjs`) + `catalog` без вход в Edge Function; демо режим `BID_BILLING_DEMO=1` за преглед и скрийншоти.
2. Един източник на цени (V2): DEFAULT_CATALOG, seed (с миграция), ai-fix DEFAULTS, `site/index.html` (генериран от същия JSON) + тест, който ги сравнява.
3. Нов екран „План и използване“ по модела на Claude (V2 §10.6): горен ред с плана и „Смени плана“, три метъра (5 часа · седмица · период) с „Нулира се в 14:30 (след 3 ч 10 мин)“, пакети, разбивка по действие/модел, свиваема история, „Обновено преди 4 s“; полинг 10 s на екрана / 60 s за пилюлата.
4. Нов прозорец „Планове“: 4 колони (Free + 3), еднаква височина, цена винаги видима, годишно „2 месеца безплатно“, таблица за сравнение, текущ план, честни булети (активни сайтове 1/3/10, валидност 1/3/10 месеца).
5. Корекции на данни: ъпгрейд през `PATCH /subscriptions` (без втори абонамент), trial база, годишни планове по месечни отрязъци, един баланс (`available`) навсякъде, reset при изход, изходи при `quota_exhausted`.
**Приемане:** Deno тестове за каталог без вход, ъпгрейд (PATCH, не втори абонамент), годишен отрязък; engine тест за офлайн каталог и демо; Swift тестове за новите полета (опционални → съвместимост v1/v2).

### Фаза 5 — Кредити V2 (PU-36…PU-44, `PLANS-AND-CREDITS-V2-BG.md` §9–§16, WP04.1–.9)
`credit_grants` с валидност 1/3/10 месеца и FIFO; `bid_charge/hold/settle/release` (security definer, advisory lock);
`usage_windows` (5 ч + седмица, котва, boost); `sites` + лимит на активни сайтове на сървъра; ценоразпис по действие
(`settings.pricing.actions`), `usage_events/usage_daily`; `usage_nudges` + банер 75/90/100 %; `usage` v2 договор (`?v=2`, стари клиенти работят);
Knight екстри зад флагове; реално време (етап 1 полинг, етап 2 Realtime канал).
**Приемане:** PGlite тестове за всяка SQL функция и RLS; Deno тестове за прозорците, FIFO изтичането, праговете; доказателство в тест, че
профилът „1 сайт × 30 дни“ струва ≤100 000 кредита и че High стига за 1 сайт × 3 месеца без доплащане.

### Фаза 6 — Цялостен UI pass и превод (UI-15…UI-32, UI-41…UI-48)
NavigationSplitView със свиваем страничен панел, ⌘N по реда на панела, мин. прозорец 900×640, адаптивни решетки,
Settings като отделен прозорец с табове, речник на термините и пълен bg превод (проверка bg==en в `i18n-check`, забрана на
твърдо кодиран латински текст във views), `K.role/plan/step/provider` вместо сурови id-та.
**Приемане:** `node scripts/i18n-check.mjs` с новите правила е зелен; screenshot CI с всички нови пасове.

---

## 4. Какво остава за собственика (не е код)
1. Supabase: пусни workflow-а `cloud-deploy` (схема + функции) — без него плановете и използването са само в демо/офлайн режим.
2. Paddle **sandbox**: продукти и цени по V2 → ID-тата в Admin → Настройки; `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENV=sandbox` като secrets; client token в `site/checkout.html`.
3. Netlify: писмено потвърждение за препродажба на кредити, преди да се включи флагът `features.netlifyCredits`.
4. Apple Developer ID (подпис/нотаризация), за да изчезне „Open Anyway“.

---

## 5. Как да се провери след всяка фаза
```bash
node tests/run.mjs                                  # engine (~5 мин)
cd tests/rls && node rls.mjs                        # RLS/SQL на PGlite
deno test --allow-env --allow-net --allow-read supabase/functions
node scripts/i18n-check.mjs && node scripts/error-codes.mjs
# Swift: само в CI (app.yml, screenshots.yml); DMG: release-dryrun.yml (workflow_dispatch)
```


## Изпълнение — 2026-10-01, setup foundation

Работно копие: `codex/v12-completion`, база `a9376bd`. Това е междинен checkpoint, не обявяване на завършена V12.

| Находки | Статус | Доказателство / оставаща проверка |
|---|---|---|
| SU-1–5, SU-7 | implemented | PATH преди bundled exec; npm/npx в двата runtime пакета; managed prefix и проверка преди атомарен symlink switch; `tests/setup-v12.mjs` |
| SU-6 | implemented | `gitAvailable` пази setup, doctor, status и git панела от CLT shim; реален Mac без CLT предстои |
| SU-8–12 | implemented | false result + nonzero exit, terminal step states, стабилни IDs, failed-before-start UI, refresh след грешка |
| SU-13–14 | implemented | 40 min setup deadline, stdout приключва до 2 s след exit, 5 s heartbeat, npm fetch logs |
| Required set / cloud rows | implemented | providers определят задължителните редове; cloud rows са незадължителни и само за admin/custom cloud |
| Browser login / recovery | partial | device code/URL, timeout, retry, in-app Git identity; реалните Netlify/GitHub login сценарии и cancel/reinstall walkthrough предстоят |
| Auto-check trust | implemented | `scripts_untrusted`, `scripts_changed`, видима причина и ръчна проверка за продължаване |
| Setup log rotation / report inclusion | implemented | последни 5 лог файла за стъпка; съществуващият report collector включва setup/ с redaction |
| UI-1–4, 33–37, 40 | implemented foundation | динамични цветове, избор на изглед, type/radius/elevation tokens, спокойни фонове, модални панели, опашка за известия; визуално приемане предстои |
| UI-5, 7–14, 28–29 | in progress | общи Badge/Meter/Field/SheetScaffold/ModalShell; съвместими wrappers, последваща миграция на специализираните екрани |
| UI-48 | implemented CI coverage | light/dark 1080×700 + дълго име; чака визуален преглед на резултатите |
| AI chat foundation | implemented / validation in progress | decoded stream, Markdown/code, proposal selection and guarded Undo, batched rendering, per-project sessions, durable history/retry; screenshot and Swift CI pending |
| AI-22 | partial | selected issue chip; selection remains a native Picker |
| AI quota / balance | partial | error-specific actions; v2 balance, windows and packs follow in phases 4-5 |
| Phases 4-6 | pending | separate changes |

Проверки: engine 112/112 (включва 7 setup regression scenarios); Deno 87/87; SQL/RLS 10/10; локален `swift build` успешен. `swift test` е блокиран локално от липсващ XCTest в CLT; нужен е macOS CI. Fresh-Mac acceptance и real-provider login не са изпълнени. Числата са за този checkpoint и се обновяват при следващите промени.
