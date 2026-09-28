# Changelog

All notable changes, newest first. Versions come from `engine/VERSION`. Each entry has an English and a Bulgarian part; the in-app update banner shows the notes from `latest.json`, which are generated from this file at release time (WP8).

## 10.0.0 (in development)

### English
- Accounts with roles (normal / VIP / admin), plans and AI credits; Admin panel.
- Built-in AI Fix: streamed explanation, proposed file changes with diffs, apply only after confirmation (own Anthropic/OpenAI key for VIP/admin, metered cloud for plans).
- Full localization (English and Bulgarian), language picker on first launch, switch without restart.
- Incremental checks: lint, typecheck and build are reused while nothing changed; "Full check" ⌥⌘R.
- Local Preview adopts servers left behind by a killed app.
- Update banner (release feed), support report with redacted logs, engine log.
- GDPR: export my data, delete account.
- Onboarding: a three-screen tour on first launch; sign-in buttons follow the providers enabled in the cloud (GitHub, Sign in with Apple); first-steps card on the empty screen.
- Errors show their code with copy and a help link; every code is documented (docs/errors.md).
- Plans & credits: Flash / High / Knight via Paddle, token packs, a 7-day High trial, credits ring in the account badge, renewal date in the AI panel, customer portal; plan tokens are spent before packs; refunds take back the unused rest.
- Admin: invite friends by email (VIP by default), per-user AI usage, a global settings editor (prices, catalog, models, limits, release feed, help pages).
- Yearly plans (−20 %) with monthly tokens; an Account page; lint and typecheck run in parallel.
- Correct plural forms for counts; bilingual sign-up, password and invitation emails; beta update channel; crash notes in the support report.
- Keyboard: View menu ⌘1–⌘4, next/previous project ⌘] ⌘[.
- New look: lit surfaces with depth, a backdrop whose light follows the project's state, a colour avatar per project, a progress ring around the check result, sliding tabs, a frosted run window; all motion follows Reduce motion.
- Security and money integrity (V10 audit, docs/AUDIT-V10.md): secrets reach the Keychain through stdin, not argv; AI changes can never touch `.git`, hooks or package-manager config (case-insensitive); Local Preview refuses dotfiles, foreign Host headers and stop requests without a secret token; GitHub Pages / Cloudflare deploys publish a clean copy without dotfiles; updates require HTTPS and a SHA-256; stronger redaction of keys in AI prompts and support reports. In the cloud: AI requests reserve credits before calling the model (no overspending with parallel requests) and stop the model when the app closes the answer; every grant, refund and expiry happens exactly once (unique ledger index, webhook claimed first, out-of-order events ignored); one trial per e-mail address; partial refunds take back their share; token packs work without a plan; an ended trial stops AI everywhere; account deletion refuses to leave a Paddle subscription running; errors no longer leak database details; the "make me admin" SQL works again.
- Ready to ship (V10 audit): the engine is inside the app and installs or updates itself on launch; a "Node.js is needed" screen when Node 18+ is missing; one universal binary for Apple silicon and Intel; updates compare the app's own version, work without an account and a too-old version must update; honest privacy text and a one-time consent before the first AI request; Privacy / Terms / Refund links and "Contact support"; a Paddle checkout page (`site/checkout.html`); `uninstall.sh --all` also removes Keychain items and settings; beforeideploy:// links ask before adding a folder and never deploy; sign-in callbacks only after a sign-in started in the app; closing the window keeps the menu bar icon.
- Engineering: AppModel split into stores, CI (engine tests on Linux, `swift build`/`swift test` on macOS, `deno check` + `deno test`), Swift tests against engine fixtures, Deno tests for the Edge Functions, release scripts (signed DMG, notarization, update feed, Homebrew cask).

### Български
- Акаунти с роли (normal / VIP / admin), планове и AI кредити; Админ панел.
- Вграден AI Fix: обяснение на живо, предложени промени по файлове с diff, прилагане само след потвърждение (собствен Anthropic/OpenAI ключ за VIP/admin, платен облак за плановете).
- Пълна локализация (английски и български), избор на език при първо пускане, смяна без рестарт.
- Инкрементални проверки: lint, typecheck и build се преизползват, докато нищо не е променено; „Пълна проверка“ ⌥⌘R.
- Local Preview поема сървъри, останали след убито приложение.
- Готово за пускане (одит V10): engine-ът е вътре в приложението и се инсталира/обновява сам при старт; екран „Нужен е Node.js“, когато липсва Node 18+; един universal файл за Apple silicon и Intel; обновленията сравняват версията на приложението, работят и без акаунт, а твърде стара версия трябва да се обнови; честен текст за поверителност и еднократно съгласие преди първата AI заявка; линкове към Поверителност / Условия / Възстановяване и „Пиши на поддръжката“; страница за Paddle checkout (`site/checkout.html`); `uninstall.sh --all` трие и ключовете от Keychain и настройките; beforeideploy:// линковете питат преди да добавят папка и никога не deploy-ват; входът приема отговор само след вход, започнат от приложението; затварянето на прозореца оставя иконата горе.
- Сигурност и честно таксуване (одит V10, docs/AUDIT-V10.md): тайните стигат до Keychain през stdin, не през argv; AI промените не могат да пипнат `.git`, hooks или настройки на пакетните мениджъри; Local Preview отказва dotfiles, чужди Host заглавия и спиране без таен ключ; GitHub Pages / Cloudflare публикуват чисто копие без dotfiles; обновленията изискват HTTPS и SHA-256; по-силно скриване на ключове. В облака: AI заявката резервира кредити преди модела (без преразход при паралелни заявки) и спира модела, когато приложението затвори отговора; всеки грант, refund и изтичане стават точно веднъж; един пробен период на имейл; частичен refund взима само своя дял; пакетите работят и без план; изтекъл trial спира AI навсякъде; изтриването на акаунт не оставя активен Paddle абонамент; грешките не показват детайли от базата; SQL командата „направи ме admin“ отново работи.
- Банер за нова версия (release feed), доклад за поддръжка с редактирани логове, лог на engine-а.
- GDPR: експорт на данните, изтриване на акаунта.
- Onboarding: тур от три екрана при първо пускане; бутоните за вход следват включените в облака доставчици (GitHub, Вход с Apple); карта „Първи стъпки“ на празния екран.
- Грешките показват кода си с копиране и линк към помощ; всеки код е документиран (docs/errors.md).
- План и кредити: Flash / High / Knight през Paddle, пакети токени, 7 дни пробен High, пръстен с кредитите в акаунта, дата на подновяване в AI панела, портал за абонамента; първо се харчат токените от плана, после пакетите; при refund се отнема неизползваното.
- Админ: покана по имейл (VIP по подразбиране), AI употреба по потребител, редактор на глобалните настройки (цени, каталог, модели, лимити, release feed, помощни страници).
- Годишни планове (−20 %) с месечни токени; страница „Акаунт“; lint и typecheck вървят паралелно.
- Правилни форми за числата („1 домейн“ / „5 домейна“); двуезични имейли за регистрация, парола и покана; бета канал за обновления; бележки за срив в доклада за поддръжка.
- Клавиатура: меню „Изглед“ ⌘1–⌘4, следващ/предишен проект ⌘] ⌘[.
- Нов облик: осветени повърхности с дълбочина, фон, чиято светлина следва състоянието на проекта, цветен аватар за всеки проект, пръстен с прогреса около резултата от проверката, плъзгащи се табове, матово стъкло зад прозореца на изпълнение; всички анимации спазват „Намалено движение“.
- Езиците с машинен, непрегледан превод имат бадж „БЕТА“.
- Инженерни: AppModel е разделен на stores, CI (engine тестове на Linux, `swift build`/`swift test` на macOS, `deno check` + `deno test`), Swift тестове върху фикстури от engine-а, Deno тестове за Edge функциите, release скриптове (подписан DMG, notarization, feed за обновяване, Homebrew cask).

## 9.0.0

- V9 baseline (see AUDIT.md).
