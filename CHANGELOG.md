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
- Keyboard: View menu ⌘1–⌘4, next/previous project ⌘] ⌘[.
- New look: lit surfaces with depth, a backdrop whose light follows the project's state, a colour avatar per project, a progress ring around the check result, sliding tabs, a frosted run window; all motion follows Reduce motion.
- Engineering: AppModel split into stores, CI (engine tests on Linux, `swift build`/`swift test` on macOS, `deno check` + `deno test`), Swift tests against engine fixtures, Deno tests for the Edge Functions, release scripts (signed DMG, notarization, update feed, Homebrew cask).

### Български
- Акаунти с роли (normal / VIP / admin), планове и AI кредити; Админ панел.
- Вграден AI Fix: обяснение на живо, предложени промени по файлове с diff, прилагане само след потвърждение (собствен Anthropic/OpenAI ключ за VIP/admin, платен облак за плановете).
- Пълна локализация (английски и български), избор на език при първо пускане, смяна без рестарт.
- Инкрементални проверки: lint, typecheck и build се преизползват, докато нищо не е променено; „Пълна проверка“ ⌥⌘R.
- Local Preview поема сървъри, останали след убито приложение.
- Банер за нова версия (release feed), доклад за поддръжка с редактирани логове, лог на engine-а.
- GDPR: експорт на данните, изтриване на акаунта.
- Onboarding: тур от три екрана при първо пускане; бутоните за вход следват включените в облака доставчици (GitHub, Вход с Apple); карта „Първи стъпки“ на празния екран.
- Грешките показват кода си с копиране и линк към помощ; всеки код е документиран (docs/errors.md).
- Клавиатура: меню „Изглед“ ⌘1–⌘4, следващ/предишен проект ⌘] ⌘[.
- Нов облик: осветени повърхности с дълбочина, фон, чиято светлина следва състоянието на проекта, цветен аватар за всеки проект, пръстен с прогреса около резултата от проверката, плъзгащи се табове, матово стъкло зад прозореца на изпълнение; всички анимации спазват „Намалено движение“.
- Езиците с машинен, непрегледан превод имат бадж „БЕТА“.
- Инженерни: AppModel е разделен на stores, CI (engine тестове на Linux, `swift build`/`swift test` на macOS, `deno check` + `deno test`), Swift тестове върху фикстури от engine-а, Deno тестове за Edge функциите, release скриптове (подписан DMG, notarization, feed за обновяване, Homebrew cask).

## 9.0.0

- V9 baseline (see AUDIT.md).
