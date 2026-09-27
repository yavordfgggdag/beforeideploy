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
- Engineering: AppModel split into stores, CI (engine tests on Linux, `swift build`/`swift test` on macOS, `deno check`), Swift tests against engine fixtures.

### Български
- Акаунти с роли (normal / VIP / admin), планове и AI кредити; Админ панел.
- Вграден AI Fix: обяснение на живо, предложени промени по файлове с diff, прилагане само след потвърждение (собствен Anthropic/OpenAI ключ за VIP/admin, платен облак за плановете).
- Пълна локализация (английски и български), избор на език при първо пускане, смяна без рестарт.
- Инкрементални проверки: lint, typecheck и build се преизползват, докато нищо не е променено; „Пълна проверка“ ⌥⌘R.
- Local Preview поема сървъри, останали след убито приложение.
- Банер за нова версия (release feed), доклад за поддръжка с редактирани логове, лог на engine-а.
- GDPR: експорт на данните, изтриване на акаунта.
- Инженерни: AppModel е разделен на stores, CI (engine тестове на Linux, `swift build`/`swift test` на macOS, `deno check`), Swift тестове върху фикстури от engine-а.

## 9.0.0

- V9 baseline (see AUDIT.md).
