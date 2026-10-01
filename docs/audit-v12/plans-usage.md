# Приложение A — Планове, кредити, плащания и използване (PU-1 … PU-48)

# Audit: plans, credits, billing and usage, end to end (read-only)

Repo: `/home/user/beforeideploy`. I read every file below. Swift was not compiled. The live Supabase project (`engine/cloud.json` → `rrnveotqvmsspmzaswlp.supabase.co`) is blocked by the sandbox proxy, so I judged cloud behaviour from the code. I ran the engine locally with a clean HOME: `bid billing catalog` and `bid billing usage` both return `{"ok":false,"code":"not_logged_in"}`. With `BID_NO_BUNDLED_CLOUD=1` they return `code:"not_configured"`.

**Revision note:** PU-35 and the findings affected by the owner's decisions in `docs/PLANS-AND-CREDITS-V2-BG.md` §17.2 (decided 2026-10-01) have been updated. Those findings are PU-12, PU-13, PU-25, PU-33, PU-36, PU-38, PU-39, PU-40, PU-42 and PU-43. Each now names the decided target values:

- **D1:** Flash and High host in the user's own Netlify; owner hosting is Knight only.
- **D2:** grant validity of Flash 1, High 3 and Knight 10 months, spent first-in first-out (FIFO), with an accumulation cap.
- **D3:** packs do not bypass the 5 h or weekly windows; Knight gets a Boost.
- **D4:** packs cost 4.99 / 19.99 / 39.99 € and are valid 12 months.
- **D6:** Netlify credits sit behind `features.netlifyCredits = false`.
- **D7:** Knight includes 10 active sites, with a fair-use cap of 25.
- **D8:** a purely local check costs 0 credits.
- **D9:** the week is anchored to the subscription start.
- **D10:** High = 29.99 € / 300 000 credits.
- **D12:** Paddle stays in sandbox until approved.

## Short answer: why "plans look ugly and plans + usage don't work"

1. **Nothing in the plans area works without the deployed `billing` function and a signed-in session.** That includes the catalog, which is public information. When the function is missing, the Plans sheet shrinks to one grey info line in an empty 560 pt scroll area. The Usage screen shows a red-amber error card containing the owner-only text "Собственик: пусни workflow-а cloud-deploy…". There is no offline catalog, no demo state and no preview data.
2. **No Paddle `paddlePriceId` is set anywhere.** Even with the cloud deployed, every plan and pack button is a disabled "Скоро". Pack prices are never shown at all. The yearly toggle never appears. `site/checkout.html` still has `REPLACE_WITH_CLIENT_SIDE_TOKEN`.
3. **The UI is a mix of two generations and contradicts itself:**
   - The V10 "Plans sheet" has a balance-split bar, hard-coded hex colours and hard-coded bullets.
   - The V11 "Plan & usage" screen is developer-facing: pricing-version hash, requests per minute, raw model IDs, an "as of server time · Europe/Sofia" line, and a "sync with provider" button.
   - "Used of cap" is shown in one card and "remaining of included" in the next.
   - The "Разходи & кредити" screen calls Netlify credits "кредита".
4. **Four sets of prices disagree:**
   - The public website: €4.99 / 9.99 / 19.99 with 250k / 1M / 2.5M tokens.
   - V1 docs, code and seed: €9.99 / 29.99 / 99.99 with 100k / 250k / 1M, packs at 3.99 / 17.99 / 33.99.
   - The approved V2 decisions: High = 300k (D10), packs at 4.99 / 19.99 / 39.99 (D4).
   - App bullets: "unlimited projects" against the V2 active-site limits (Flash 1, High 3, Knight 10 with a fair-use cap of 25).
5. **None of the approved V2 design is built:** site-months, active-site limits, the weekly window, anchored 5 h windows, 75/90/100 % nudges, realtime updates, the action price list, the meter, D2 grant validity, and Knight extras.

---

## A. Commands and JSON shapes in use today

The app runs the engine as `bid <cmd>` and reads NDJSON. The last line is `{"type":"result","ok":true,"data":…}` or `{"type":"result","ok":false,"error":"…","code":"…"}` (`engine/src/util.mjs:126-131`).

| App caller | Engine command | Edge call | Swift model |
|---|---|---|---|
| `BillingStore.load` (BillingStore.swift:35-36) | `billing catalog`, `billing status` | `POST /functions/v1/billing {action}` with user JWT (billing.mjs:25-50) | `BillingCatalog`, `BillingStatus` (Models.swift:1055-1109) |
| `BillingStore.loadUsage` (:112) | `billing usage` | same | `UsageReport` (Models.swift:1374-1426) |
| `checkout` (:45) | `billing checkout --plan P [--yearly]` or `--pack ID` | → Paddle `POST /transactions` | `BillingURL {url}` |
| `startTrial` (:62) | `billing trial` | → inserts `subscriptions`, `trial_claims` | `BillingStatus` |
| `openPortal` (:74) | `billing portal` | → Paddle `/customers/{id}/portal-sessions` | `BillingURL` |
| `sync` (:121) | `billing sync` | → Paddle `GET /subscriptions/{id}` | `BillingSync {synced, status}` |
| `AccountStore.loadAccount` | `account status` | PostgREST `profiles`, `credit_balance`, `settings`, `subscriptions` (account.mjs:144-178) | `AccountState.credits {balance, monthlyGrant, renewsAt, endsAt}` |

**Shapes returned by `supabase/functions/billing/handler.ts`:**

- **catalog** (:407-420)
  ```json
  {"currency":"EUR",
   "plans":[{"id":"flash","price":9.99,"tokens":100000,"available":false,"yearlyPrice":99.9,"yearlyAvailable":false}, …],
   "packs":[{"id":"pack-100k","tokens":100000,"price":3.99,"available":false}, …],
   "trial":{"days":7,"plan":"high","tokens":50000}}
  ```
- **status** (:283-291)
  ```json
  {"plan","subscription":{provider,tier,status,interval,renewsAt,endsAt,manageable}|null,
   "balance":{plan,topup,total},"trialAvailable","usage":[{at,step,model,tokens,project}]}
  ```
- **usage** (:347-368)
  ```json
  {"serverTime","unit":"credits","plan","subscription","trialAvailable",
   "period":{start,end,renewsAt,source},
   "included":{tokens},"used":{tokens,operations},"reserved":{tokens,operations},
   "remaining":{plan,purchased,total,available},
   "purchased":{tokens,"expires":"12 months after purchase"},
   "session":{windowHours,capPercent,cap,used,remaining,resetsAt}|null,
   "byModel":[{model,tokens,operations}],
   "limits":{perMinute,perHour,sessionHours,sessionCapPercent,sessionCap,sessionUsed},
   "pricing":{version,prices,creditEur,usdToEur,spendOrder},
   "reconciled":{releasedHolds},
   "history":{"operations":[…],"ledger":[…]}}
  ```
- **Error codes:** `not_available` (409), `trial_used` (409), `no_subscription` (404), `not_configured` (503), `provider_error` (502), `401 no session`.
- **Engine mapping:**
  - Supabase 404 `{"code":"NOT_FOUND"}` → `cloud_function_missing`.
  - Missing cloud config → `not_configured` (exit 7).
  - No session → `not_logged_in` (exit 5).
  - Everything else → `billing_failed`.

**Behaviour by state:**

| State | Engine | App |
|---|---|---|
| Cloud functions not deployed (today) | `cloud_function_missing` | Plans sheet: a single "billing.notReady" line, no plans. Usage: error card with the owner instruction text. Account: the same note. |
| Not logged in | `not_logged_in` for every billing action, catalog included | Plans sheet: error toast and an empty sheet. Usage: error card (the "sign in" empty state is never reached, see PU-14). |
| Paddle not configured | catalog OK but `available:false` everywhere | Everything shows "Скоро". checkout → 409 `not_available`; portal and sync → 503 `not_configured` toast. |
| Offline or demo | none | none: no fallback catalog, no cached usage, no demo data. |

---

## B. Findings

### B1. Plans/usage dead or empty without the cloud (critical/high)

**PU-1 — critical — The catalog needs a login and the deployed function, and there is no offline catalog**
- **Evidence:**
  - `engine/src/billing.mjs:26-29`: `if (!c) throw … 'not_configured'` and `if (!s) throw … 'not_logged_in'` run before any action, `catalog` included.
  - `handler.ts:391-392`: `if (!who) return json(401…)` runs before the `catalog` case.
  - The defaults exist only server-side as `DEFAULT_CATALOG` (handler.ts:32-48).
- **Impact:** Guests, users before deploy and offline users never see a single plan or price. The onboarding `offerPlansOnce()` (AppModel.swift:1184-1190) opens this empty sheet on first sign-in and then never shows it again.
- **Fix:**
  1. Add `engine/src/plans-catalog.mjs` with `DEFAULT_CATALOG` and `DEFAULT_PLAN_TOKENS` (mirroring handler.ts, with the V2 values from PU-33; extend `billing_test.ts:468` to also compare the engine copy).
  2. In `billingCommand('catalog')`, when there is no config, no session, `cloud_function_missing` or `network`, return `{…DEFAULT_CATALOG mapped like handler.ts:408-419, available:false for all, source:"offline", reason:code}` instead of throwing.
  3. In handler.ts, move `case "catalog"` above the `callerOf` check so it is public.
  4. Add `var source: String?` to `BillingCatalog` and show a quiet "Покупките се отварят скоро" banner while still rendering the cards.
  5. In `offerPlansOnce`, do not set `onboarding.plansShown` while `billingUnavailable != nil`.

**PU-2 — critical — Nothing is on sale: every `paddlePriceId` is null and the checkout page token is a placeholder**
- **Evidence:**
  - `supabase/schema.sql:249-256` sets `"paddlePriceId": null` for all 3 plans × 2 intervals and all 3 packs.
  - `handler.ts:414-418`: `available: !!catalog.plans[id]?.paddlePriceId`.
  - `site/checkout.html:40`: `PADDLE_CLIENT_TOKEN = "REPLACE_WITH_CLIENT_SIDE_TOKEN"`.
- **Impact:** All buttons read "Скоро" and are disabled (BillingViews.swift:265,270,300-302). Even after the owner configures Paddle, the hosted checkout URL (the default payment link → `checkout.html`) cannot open the Paddle overlay.
- **Fix:** This is an owner task, in sandbox only per D12:
  - Create sandbox products and prices: 3 plans × (monthly + yearly), 3 packs at the D4 prices, and optionally the Knight Boost.
  - Write the IDs to `settings.billing.catalog` (Admin → Settings).
  - Set the client token and `sandbox` environment in `site/checkout.html`.
  - Set the secrets `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENV=sandbox`.

  In code:
  - Make `AdminDiagnostics.missingPrices` (already present) visible on the owner's first-run screen.
  - Add a "Paddle client token set?" check to `bid cloud doctor` (fetch `/checkout` and grep for the placeholder).
  - Add the V2 §13 guard: refuse a live key while `billing.liveApproved !== true`.

**PU-3 — high — Pack prices are hidden whenever a pack is not on sale**
- **Evidence:** BillingViews.swift:300: `Button(pack.available ? BillingFormat.money(pack.price…) : L("billing.soon"), …)`. Plan cards always show the price (:242).
- **Impact:** The packs section shows "+100 000 кредита · Еднократно…" with only a "Скоро" button and no price. It looks broken and inconsistent with the plan cards.
- **Fix:** In `PackCard`, always render the price as a label (`Text(money)` at 15 pt semibold) and put a separate "Купи" / "Скоро" button next to it.

**PU-4 — high — The "not ready" state is a single grey line in an otherwise empty 880×560 sheet**
- **Evidence:** BillingViews.swift:17-22 shows only `Label(L("billing.notReady"))` when `billingUnavailable`. The `catalog == nil && !loading` branch (:54) renders nothing at all. The ScrollView has a fixed `.frame(height: 560)` (:64).
- **Impact:** This is the main reason the plans look unprofessional today.
- **Fix:** Replace it with a designed empty state: an illustration or icon, a title, one sentence, the offline catalog (PU-1) in a "preview" style, and a "Провери отново" button. Remove the fixed height (use `.frame(minHeight: 420, maxHeight: 640)`).

**PU-5 — high — The Usage screen shows owner-only and raw engine errors to end users**
- **Evidence:** UsageViews.swift:24-29 displays `Text(e)` where `e = error.localizedDescription`. For a missing function that is `cloud.functionMissing` = "Облачната функция „billing“ още не е качена. Собственик: пусни workflow-а cloud-deploy (docs/CLOUD-SETUP-BG.md) или `supabase functions deploy billing`." (engine/i18n/bg.json:553). `BillingStore.loadUsage` (:108-118) never sets `billingUnavailable`.
- **Impact:** End users see deploy instructions and doc paths in an amber warning card.
- **Fix:** In `loadUsage`, catch `EngineError` with code `cloud_function_missing` or `not_configured` → set `billingUnavailable` and `usageError = nil`. Show the same calm "not open yet" panel as PU-4. Show raw text only behind a "Подробности" disclosure, and only when `account.isAdmin`.

**PU-6 — high — No demo, preview or cached usage state**
- **Evidence:** No fake billing fixture or Snapshot branch exists in App/Sources or engine/src. `UsageReport` is not cached (only `profile.json` is, account.mjs:15). `App/Tests/.../Fixtures/usage-report.json` exists for tests only.
- **Impact:** The owner cannot see or design-review the screens before Paddle and the cloud are live. There are no screenshots of plans or usage in `docs/screenshots/`.
- **Fix:**
  - Add a `bid billing usage --demo` / `catalog --demo` path (or `BID_BILLING_DEMO=1`) that returns a V2-shaped fixture with `source:"demo"`.
  - Add a Snapshot argument (`BIDBillingDemo`) in `Engine.swift:128` that passes it through.
  - Have the engine cache the last good `usage` in `APP_DIR/usage-report.json` and return it with `stale:true` on `network` errors (same pattern as `loadProfile`, account.mjs:170-172).

### B2. Visual and UX problems (app)

**PU-7 — high — Two incompatible designs for the same data**
- **Evidence:**
  - `BalanceCard` (BillingViews.swift:126-170) shows a balance split (plan vs packs) with a 34 pt bold number.
  - `PlanUsageView.planCard` (UsageViews.swift:118-168) shows "remaining of included" with an InfoRow list.
  - `AccountView` (AccountView.swift:39-47) uses BalanceCard or KPITiles.
  - The account ring (V9Views.swift:377-384) shows `credits.balance / monthlyGrant`.
- **Impact:** Four different visualisations of "how many credits do I have", with different numbers: the ring uses `credit_balance` including holds; the cards use `max(0,plan)+max(0,topup)` without subtracting holds.
- **Fix:** Build one `CreditsMeter` component (label, percent, bar, "X от Y", reset line) in a new `App/Sources/BeforeIDeploy/Meters.swift`. Use it in PlansSheet (top), AccountView and PlanUsageView. Feed all of them from `UsageReport.remaining.available` and `included`. Delete `BalanceCard` and `Legend`.

**PU-8 — high — Not comparable to Claude's usage page: no top summary line, no reset countdown, no weekly row, no forecast**
- **Evidence:**
  - The header (UsageViews.swift:39-53) has only a title, "Сървърно време … · показано в Europe/Sofia", Refresh and "Синхронизирай с доставчика".
  - The reset line is `L("usage.sessionResets", Fmt.time($0))` (:72) with no relative "след 3 ч 10 мин".
  - There is no weekly meter.
  - The layout is a session card plus a 300 pt limits card, then a large plan card, models, and history.
- **Impact:** It reads as a debug panel rather than a usage page.
- **Fix:** Rewrite `PlanUsageView` to the V2 §10.6 layout:
  - Header: "План · High · подновяване 31 окт." and [Смени плана].
  - Three stacked full-width meter rows (Сесия 5 ч, Седмица anchored per D9, Период), each with a percent, a bar, and "Нулира се в 14:30 (след 3 ч 10 мин)" from a new `Fmt.countdown(_:)` in Theme.swift.
  - A packs row with expiry dates (D4), then active sites, "по действие", a 30-day chart and a collapsible history.
  - Footer: "Обновено преди 4 s".

**PU-9 — medium — Developer data shown to end users**
- **Evidence:**
  - UsageViews.swift:164 shows `L("usage.pricingVersion", u.pricing.version)`, which renders as "цени p-3fa2…" in monospace.
  - The limits card (:170-183) shows "Заявки в минута 6 / в час 60".
  - The history shows raw model IDs in monospace (:202, :104).
  - The header shows `TimeZone.current.identifier` (:44).
  - `UsageList` shows the raw `u.step` and `u.model` (BillingViews.swift:317-318).
  - The "Синхронизирай с доставчика" button is in the header for every user, including Free (:50-51).
- **Fix:**
  - Move the pricing version, rate limits and sync into a collapsed "Подробности" section (or show them only for admins).
  - Map model IDs to friendly names ("Sonnet 5.5", "Opus 5.5") in `LocalizedKeys.swift` (a new `K.modelName`).
  - Map step IDs through the existing step labels.
  - Show Sync only when `u.subscription?.provider == "paddle"`.

**PU-10 — medium — Inconsistent meter semantics**
- **Evidence:**
  - Session: `L("usage.creditsOf", used, cap)` = "**used** of cap" (UsageViews.swift:67).
  - Plan: `L("usage.creditsOf", remaining.plan, included)` = "**remaining** of included" (:138).
  - The same string key is used for opposite meanings.
  - Legend colours: reserved uses `Theme.warn` (orange, which reads as a warning), and the "remaining" dot is `Theme.hairline`, which is nearly invisible (:143-144).
- **Fix:** Always show "използвани X от Y" with a percent used. Add a separate key `usage.remainingOf`. Use a neutral accent at 50 % opacity for reserved and `Theme.secondary` for the remaining dot. Colour thresholds: neutral below 75 %, warn from 75 %, blocked from 90 % (V2 §10.6).

**PU-11 — medium — Hard-coded colours and an ad-hoc palette in the billing views**
- **Evidence:** `Color(hex: 0xB57BFF)` / `0x7A3FD6` at BillingViews.swift:145,153,204,292,294. PlanUsageView uses `Theme.accent` / `Theme.warn` for the same concepts.
- **Fix:** Add `Theme.credits`, `Theme.creditsTopup` and `Theme.creditsReserved` tokens in Theme.swift and use them everywhere.

**PU-12 — medium — Plan cards are not a real pricing table, and their content contradicts the approved V2 plans**
- **Evidence:**
  - Free is not shown.
  - Bullets are hard-coded per ID (BillingViews.swift:220-226): Flash "До 5 проекта", High and Knight "Неограничен брой проекти", and Knight lacks "sync".
  - Under V2 §3, D7 and D10 the bullets should be:
    - Flash: 100 000 credits / month, 1 active site, Sonnet 5.5, credits valid 1 month.
    - High: 300 000 credits, 3 active sites, Opus 5.5, credits valid 3 months.
    - Knight: 1 000 000 credits, 10 active sites (fair use up to 25), Opus 5.5 + deep fix, credits valid 10 months, 1 domain / year, "Netlify кредити — скоро" (D6 flag), weekly Boost (D3).
  - Card heights are not equalised: `minHeight: 250` inside an `HStack(alignment:.top)` (:272), so the buttons are misaligned when bullets wrap in Bulgarian.
  - The hover lift happens on disabled cards (:278).
  - The recommended badge is "ПРЕПОРЪЧАН" at 9.5 pt heavy.
- **Fix:**
  - Render 4 columns (Free plus 3 paid) from catalog data. Add `credits`, `validityMonths`, `activeSites`, `activeSitesMax`, `window5h`, `weekly`, `model`, `extras {domain, netlifyCredits (flag), boost}` and `features: [String]` (i18n keys) to the catalog JSON (handler.ts:410-417, V2 §9.2 `settings.plans` shape).
  - Equalise heights: `.frame(maxHeight: .infinity)` on the cards plus `.fixedSize(horizontal:false, vertical:true)` on the HStack.
  - Disable the hover effect when the card is not on sale.
  - Add a comparison table ("Сравни плановете", V2 §10.3).

**PU-13 — medium — The yearly toggle never shows, and its label contradicts the saving line**
- **Evidence:**
  - BillingViews.swift:31 shows the toggle only if `yearlyAvailable == true`, which is always false today.
  - bg strings: `"billing.yearly" = "Годишно −20%"`, but the yearly price is 10× monthly (V2 §3: 99.90 / 299.90 / 999.90; 2 months free ≈ −16.7 %), and `"billing.yearlySaving" = "%@ на месец — 2 месеца безплатно"`.
- **Fix:** Always show the toggle when `yearlyPrice != nil`, with on-sale state handled per card. Change the label to "Годишно · 2 месеца безплатно" (and the en equivalent).

**PU-14 — high — The signed-out "sign in" empty state is unreachable**
- **Evidence:** UsageViews.swift:30-31 only reaches `else { EmptyLine(… "usage.signIn") }` when `usage == nil && !loading && usageError == nil`, i.e. only before the first load. When signed out, `loadUsage` sets `usageError = "Не си влязъл в акаунта."` and the error card is shown instead.
- **Fix:** In `PlanUsageView.body`, branch first on `model.account?.loggedIn != true` and show the sign-in empty state with a "Влез" button (`model.offlineMode = false`). In `loadUsage`, guard on login state before calling the engine.

**PU-15 — medium — Bulgarian text overflow in the session card**
- **Evidence:** UsageViews.swift:15-18 puts the session card (`maxWidth:.infinity`) next to a fixed `limitsCard.frame(width: 300)`. Inside the session card:
  - An HStack holds a 28 pt percent, "от тази сесия са използвани", a Spacer and "20 000 от 50 000 кредита" (:62-68).
  - The exhausted banner HStack holds a long text plus "Купи кредити…" plus "Надгради…" (:78-84).
  At the minimum window width the left card is about 300 pt, so the texts truncate or squeeze into a narrow column.
- **Fix:** Stack the cards vertically (or use `ViewThatFits`). Put the meter numbers on their own line. Give the exhausted banner a `VStack` layout with the buttons on a second row. Add `.lineLimit(2).minimumScaleFactor(0.9)` to the legends (UsageViews.swift:141-146) or switch them to a `FlowLayout`.

**PU-16 — low — Grammar and plural errors**
- **Evidence:**
  - `"usage.modelOps" = "%@ операции"` and `"usage.used" = "%@ използвани (%@ операции)"` are formatted with the generic `L(_, Any...)`, giving "1 операции".
  - `"billing.legal"` says "Неизползваните **токени**", while everything else says "кредити", and `billing.subtitle` says "кредитът … не токен".
  - `billing.legal` also states that unused plan credits do not carry over, which contradicts D2 (validity 1 / 3 / 10 months).
- **Fix:**
  - Use `L(key, count:)` (Localization.swift:132) with plural entries.
  - Rewrite `billing.legal` (bg and en) to the D2 and D4 wording: "Кредитите от плана важат 1 / 3 / 10 месеца според плана; пакетите — 12 месеца".
  - Make the same change in `site/terms.html:31-32` and `site/refund.html:22-26`.

**PU-17 — low — Raw role and plan IDs in the account UI**
- **Evidence:**
  - `AccountMenu`: `L("account.rolePlan", role, plan, …)` → "normal · free · 0 кредита" (V9Views.swift:422).
  - `AccountView` chip: `Chip(text: role…)` shows "normal" / "vip" / "admin" (AccountView.swift:100).
- **Fix:** Use `BillingFormat.planName(plan)` and a new `K.role(_:)` with localized strings, and hide the role chip for "normal".

**PU-18 — medium — Cost Center conflates Netlify credits with BID credits**
- **Evidence:**
  - Sidebar "Разходи & кредити" (`common.costs`) with icon `creditcard.fill` (SidebarView.swift:52). The usage plan card also uses `creditcard.fill` (UsageViews.swift:120).
  - The KPI unit label is "кредита" for Netlify credits (V7Views.swift:438,543).
  - Engine prices: `'netlify:production': { unit: 'credits', amount: 15 }` (costs.mjs:80).
- **Impact:** Users see two different "credits" balances in two screens. This gets worse once Knight's Netlify credits (D6) appear next to BID credits.
- **Fix:** Rename the unit to "Netlify кредита" (`common.creditsUnit` → `costs.netlifyCreditsUnit`), rename the nav item to "Разходи при доставчиците", and change the icon to `building.columns`. Keep "кредити" only for BID credits.

### B3. Data flow and logic bugs

**PU-19 — critical — Upgrading or changing plan creates a second Paddle subscription**
- **Evidence:**
  - handler.ts:462-479: checkout always does `POST /transactions` with the new plan's price.
  - PlanCard is disabled only when `current` (BillingViews.swift:270), so a Flash subscriber can buy High.
  - The webhook (:154-195) handles each subscription separately: when the old Flash subscription is later cancelled, `plan = ACTIVE.includes(status) ? tier : "free"` drops the user to Free even though High is active. Only manual subscriptions are checked at :185-190.
- **Impact:** The customer is double-billed and plan flapping is possible.
- **Fix:** In `checkout`, if an active Paddle subscription exists, call `PATCH /subscriptions/{id}` with `items:[{price_id, quantity:1}]`:
  - For an upgrade, use `proration_billing_mode:"prorated_immediately"`.
  - For a downgrade, use `"do_not_bill"` with `effective_from:"next_billing_period"`.

  Return `{changed:true}` instead of a URL. In the webhook's free branch, also keep the plan if another Paddle subscription for the user is still active (same query as `expireDue`'s `stillActive`). Then add the V2 §12 `upgrade_grant`, ref `<sub>:upg:<event_id>`.

**PU-20 — high — The trial shows the full High allowance as "included"**
- **Evidence:**
  - usageOf: `const included = planTokens[status.plan]?.tokens` (handler.ts:316) gives 250 000 today (300 000 after D10) for a High trial that was granted 50 000 (:500).
  - The session cap is 20 % of that, which is the entire trial grant or more.
  - The engine ring uses `monthlyGrant = settings.plans[plan].tokens` (account.mjs:133) → fraction 0.2 right after the trial starts.
- **Impact:** A new trial user sees "50 000 от 250 000" and a ring 80 % empty on day one.
- **Fix:** In usageOf and creditsOf, when the active subscription has `provider === "trial"`, use `catalog.trial.tokens` as `included` and as the base for the window caps. ai-fix handler.ts:175-183 must use the same rule. V2 §3 also limits the trial to 1 active site.

**PU-21 — high — Yearly plans compare a full year of usage against one month's allowance**
- **Evidence:**
  - `period` is the Paddle billing period (handler.ts:308-310), which is 1 year for yearly plans.
  - `usedTokens` sums everything since `period.start` (:312-314).
  - `included` is the monthly grant (:316).
  - The plan bar's total is `max(included, used+reserved+remaining)` (UsageViews.swift:140).
- **Impact:** After month 2 the bar is over 100 % or rescaled nonsensically, and "Текущ период" shows a whole year.
- **Fix:** For `interval === "year"`, compute the current monthly slice: `k = floor((now - period_start)/MONTH_MS)`, start = `period_start + k*MONTH_MS`, end = `+MONTH_MS` (same `MONTH_MS` as `ensureMonthlyGrant`). Use that slice for `period` and `usedTokens`. Under D2, the "period" meter should instead show the sum of unexpired grants (PU-43).

**PU-22 — medium — "Used" mixes plan and pack spending, so the plan meter doesn't add up**
- **Evidence:** `usedTokens` = all `charged_tokens` in the period (handler.ts:314), while the bar shows `remaining.plan` against `included` (UsageViews.swift:138-140). Spending from packs, or a plan change mid-period, makes used + remaining ≠ included.
- **Fix:** Return `used.byBucket {plan, topup}` from the `credit_ledger` rows with `reason='ai_fix'` per bucket in the period. Draw the plan meter from `used.byBucket.plan`, and the packs row separately.

**PU-23 — medium — The 5 h "session" is a rolling sum, but the UI says it fully resets**
- **Evidence:**
  - `resetsAt = oldest + sessionHours` (handler.ts:333); ai-fix handler.ts:177-188 does the same.
  - At that time only the oldest operation drops out of the window, not the whole total.
  - The UI says "Нулира се в %@" (bg :1168).
- **Impact:** Users wait until the stated time and are still capped.
- **Fix:** Implement the V2 §7.1 anchored windows (PU-36/37). In the interim, change the string to "Освобождава се част в %@" or compute the time at which `used` drops below the cap.

**PU-24 — medium — Two different balances**
- **Evidence:**
  - `account status` credits come from the `credit_balance` view (schema.sql:182-186), which sums all buckets including in-flight `hold` rows (account.mjs:151).
  - `billing status` / `usage` use `max(0,plan)+max(0,topup)` with holds excluded (handler.ts:288), and `available` subtracts holds (:346).
- **Impact:** The badge popover and the Plans sheet show different numbers during an AI request.
- **Fix:** Make account.mjs read `credit_bucket_balance` filtered to `bucket in (plan, topup)` and return `{plan, topup, reserved, available}`. Display `available` everywhere.

**PU-25 — high — Validity rules (D2 grants 1 / 3 / 10 months, D4 packs 12 months) are promised but not implemented**
- **Evidence:**
  - Hard-coded `purchased: { … expires: "12 months after purchase" }` (handler.ts:358). That English string is decoded as `Purchased.expires` but never shown.
  - No code expires `topup` rows; `credit_ledger` has no `expires_at`.
  - Plan grants do the opposite of D2: `grantPlanTokens` expires the previous grant's remainder on every new grant (credits.ts:27-32), and `expireDue` expires the whole plan bucket when a subscription ends (credits.ts expiry `expired:<id>`).
- **Impact:**
  - Pack buyers' credits never expire, which is a liability.
  - Plan subscribers lose credits that the approved D2 says remain valid for 3 months (High) or 10 months (Knight). "1 сайт × 3 месеца" is promised but false.
- **Fix:** See PU-43 for the grant model. For packs:
  - Add `expires_at = now()+12 months` on topup inserts (handler.ts:216).
  - Add a per-lot expiry pass with ref `topup-expiry:<id>`.
  - Return `purchased.lots: [{tokens, left, expiresAt}]` and show "изтичат 08.10.2027".

**PU-26 — low — Settings typed as fractional numbers break decoding of the whole usage screen**
- **Evidence:** `limits.sessionHours` and `sessionCapPercent` are sent as `Number(settings[...])` (handler.ts:319-320,361), but Swift declares them `Int?` and `Session.windowHours: Int` (Models.swift:1379-1381). An admin value of 2.5 fails decoding, and the screen shows "Използването не можа да се зареди".
- **Fix:** Use `Double` in Swift (format the number), or `Math.round` server-side and validate in the admin `set_settings`.

**PU-27 — low — The quota error shows a raw ISO date**
- **Evidence:** engine/src/ai/providers.mjs:177: `msg('ai.quotaExhausted', { renewsAt: j.renewsAt || '—' })` passes the raw ISO string. :178 uses `toLocaleTimeString([])` with the Node default locale rather than `BID_LANG`. Every other 403 (`disabled`, `no_profile`) maps to `ai.unavailable.noPlan` (:179).
- **Fix:** Format with `Intl.DateTimeFormat(currentLang(), {dateStyle:'medium'})`. Map `j.code === 'disabled'` to its own message. Add `window_5h`, `window_week` and `site_limit` mappings when V2 ships.

### B4. App state, refresh and race bugs

**PU-28 — high — AI quota and session-cap errors are a dead end**
- **Evidence:**
  - `AIStore.start` stores only `outcome.errorMessage` (Stores/AIStore.swift:81) and discards the error code.
  - AIFixView shows red text with no buttons (AIFixView.swift:85-88).
  - No app code checks `quota_exhausted` or `ai_session_cap`.
- **Impact:** This contradicts the docs' "two exits: Купи кредити / Смени плана".
- **Fix:**
  - Store `outcome.errorCode` in `FixState.errorCode`.
  - In AIFixView, when the code is `quota_exhausted`, `ai_session_cap` or `ai_unavailable`, render an action panel: [Купи кредити] / [Смени плана], both `model.sheet = .plans`, plus the reset time.
  - Per D3, for a window limit show only [Смени плана] / [Добре], because packs do not bypass windows. Knight additionally gets [Boost].
  - Do the same in `AssistantStore`.

**PU-29 — high — Usage, pill and status never refresh after spending or buying**
- **Evidence:**
  - `loadUsage` runs only from the sidebar or pill tap, the `.task` when `usage == nil` (UsageViews.swift:36), Refresh, and `sync`.
  - No caller after an AI fix, assistant turn, `waitForPayment` success (BillingStore.swift:98-101 calls only `onChanged` = `loadAccount`) or `startTrial` (:67-69).
  - There is no timer; the only periodic refresh is a 15-minute `loadAccount` (AppModel.swift:262-268).
- **Impact:** The `UsagePill` in the Assistant (AssistantView.swift:43) shows a stale balance indefinitely, and the Usage screen shows pre-purchase numbers.
- **Fix:**
  - Call `await loadUsage()` inside `onChanged` (AppModel.swift:122), after `startTrial`, and in `AIStore` / `AssistantStore` on completion.
  - Add polling to BillingStore: 10 s while `.usage` is the visible screen, 60 s while the pill is visible (V2 §10.5 stage 1), cancelled in `onDisappear`.

**PU-30 — high — Logout leaves the previous user's billing data on screen**
- **Evidence:** `AccountStore.logout` (Stores/AccountStore.swift:157-163) reloads the account but never clears `billingStore.usage`, `status` or `catalog`.
- **Impact:** UsagePill, AccountView and PlanUsageView keep showing the old user's credits and history. After a different user signs in, the Usage `.task` skips loading because `usage != nil` (UsageViews.swift:36).
- **Fix:** Add `BillingStore.reset()` (nil all state, cancel `pollTask`) and call it from `AppModel.logout` and after `deleteAccount`. Key the Usage `.task(id: model.account?.id)`.

**PU-31 — medium — Portal opening triggers the "waiting for payment" poll**
- **Evidence:** `openPortal` calls `waitForPayment()` (BillingStore.swift:81). The banner text is "Чакам потвърждение на плащането…", but the banner is visible only inside PlansSheet; from AccountView or Usage the poll runs invisibly for 3 minutes.
- **Fix:** Use a separate `waitForSubscriptionChange()` with no payment banner after the portal, or none at all; refresh on app re-activation via `NSApplication.didBecomeActiveNotification` instead.

**PU-32 — medium — The shared `loading` flag and single `busy` slot race**
- **Evidence:**
  - `load()` and `loadUsage()` both set and clear `loading` (BillingStore.swift:32-33, 109-110). The Plans sheet opened from Usage runs both concurrently; one's `defer` clears the flag while the other is still loading, so the spinners disappear early, and the Usage Refresh is disabled by Plans loading (UsageViews.swift:49).
  - `busy` is one String, so clicking a pack while a plan checkout is busy overwrites it.
  - `waitForPayment` with `before == nil` (status never loaded) flashes "Планът ти е обновен" on the first poll (:98).
- **Fix:** Split into `loadingCatalog` / `loadingUsage`. Make `busy` a `Set<String>`. In `waitForPayment`, if `status == nil`, load it before capturing `before`.

### B5. Plan catalog consistency

**PU-33 — high — Price and catalog sources disagree with each other and with the approved V2 decisions**

| Source | Flash | High | Knight | Packs (100k / 500k / 1M) |
|---|---|---|---|---|
| **Target: V2 §3 and §17.2 (D4, D7, D10), approved** | 9.99 € / 100k, 1 active site, valid 1 month | **29.99 € / 300k**, 3 sites, valid 3 months | 99.99 € / 1M, 10 sites (fair use 25), valid 10 months | **4.99 / 19.99 / 39.99**, valid 12 months |
| `handler.ts:32-48` DEFAULT_CATALOG and `schema.sql:244-258` seed (tested equal in `billing_test.ts:468-477`) | 9.99 / 100k | 29.99 / **250k** | 99.99 / 1M | **3.99 / 17.99 / 33.99** |
| `ai-fix/handler.ts:45` `DEFAULTS.plans` | 100k | **250k** | 1M | — |
| `docs/PLANS-AND-CREDITS-BG.md` (V1), `docs/BILLING-AND-USAGE.md:15-18`, `docs/OWNER-ACCEPTANCE-TEST-BG.md:122,137` | V1 values | 250k | | 3.99 / 17.99 / 33.99 |
| `site/index.html:41-46` (public website) | **€4.99 / 250k tokens** | **€9.99 / 1M** | **€19.99 / 2.5M** | **500k €4.99, 2M €14.99** |
| `docs/HANDOFF-V10.md:304-307`, `docs/v10-checklist.md:58`, `docs/execution-plan.md:209` | old V10 values | | | |
| App bullets (BillingViews.swift:220-226) and `features.mjs:18` `PROJECT_LIMITS` | "до 5 проекта" (free 2, flash 5) | "unlimited" | "unlimited" | — |

The yearly prices (99.90 / 299.90 / 999.90) and the trial (7 days High, 50 000 credits) already match V2.

- **Impact:** The public site sells different prices than the app, and the code does not match the owner's approved decisions. This is a legal and consumer-trust risk.
- **Fix:**
  1. Set DEFAULT_CATALOG packs to 4.99 / 19.99 / 39.99. Set `DEFAULT_PLAN_TOKENS.high` and `ai-fix DEFAULTS.plans.high` to 300000. Extend the plans entries to the V2 §9.2 shape `{credits, validityMonths: 1|3|10, activeSites: 1|3|10, activeSitesMax: 1|3|25, window5hPct: 20, weeklyPct: 40, model, monitorMin, extras}`.
  2. Update the schema seed in the same change; the test keeps them aligned.
  3. The seed uses `on conflict do nothing`, so add an explicit migration statement or admin action for existing databases. V2 §14 says High moves to 300k at the next renewal.
  4. Replace `PROJECT_LIMITS` with the cloud value `sites.activeMax`: Free 0 cloud sites, Flash 1, High 3, Knight 10 (25 under fair use).
  5. Regenerate the `site/index.html` pricing from the same JSON (a build step in `scripts/`) and change "tokens" to "credits".
  6. Mark the V1 and V10 docs as superseded by V2.
  7. Extend `billing_test.ts` to assert `ai-fix DEFAULTS.plans` == `DEFAULT_PLAN_TOKENS` and that the site prices match.

**PU-34 — medium — The credit rate is per plan in code but a single rate in V2**
- **Evidence:** ai-fix handler.ts:36 has `"ai.creditEur": { flash: 0.0000249, high: 0.00003, knight: 0.00003 }`. V2 §4 and §14 specify a single rate of 0.000025.
- **Fix:** Change the default to a number. Make `creditsFor` (ai-fix handler.ts:77-81) accept either a number or an object for backward compatibility. Set `pricing.version` to `2026-10`.

### B6. Gaps against the approved V2 (`docs/PLANS-AND-CREDITS-V2-BG.md`)

**PU-35 — resolved (info) — The design decisions are now made**
- **Status:** §17.2 records the owner's decisions of 2026-10-01: D2 decided by the owner; D1 and D3–D12 delegated and taken per the recommendations. They are binding for implementation.
- **Remaining note:** When this report was first written, the referenced `docs/AUDIT-V12-UI-BILLING-BG.md` was missing. It now exists in the working tree as an untracked file, created during this session. Nothing remains open beyond committing it and keeping it aligned with the decided values. The decision-dependent findings below (PU-12, 13, 25, 33, 36, 38, 39, 40, 42, 43) use the decided values.

**PU-36 — high — No weekly window anywhere (D3, D9)**
- **Evidence:** A grep for weekly or week finds nothing in schema.sql, handler.ts, ai-fix or the Swift sources.
- **Fix:**
  - **DB:** `usage_windows(id, user_id, kind '5h'|'week', opened_at, resets_at, cap, used, week_anchor, boost_until)` plus RLS select-own.
    - The week is anchored to the subscription start (D9).
    - The 5 h window is 20 % of monthly credits; the week is 40 % (V2 §3).
    - Packs do not bypass either window (D3).
    - Knight Boost: `boost_until` = +50 % for 24 h, once a week, free (D3).
  - **ai-fix:** check both windows; codes `window_5h` and `window_week` with `resetsAt`. Keep `session_cap` as an alias for one release.
  - **billing usage:** return `windows.session` and `windows.week` (§10.4). Add a `boost` action for Knight.
  - **Engine:** providers.mjs maps the new codes.
  - **App:** add a `Week` meter row and a Boost button on Knight, and decode `UsageReport.windows`.

**PU-37 — high — No anchored 5 h window or `bid_charge` gate**
- **Evidence:** Charging is spread over several PostgREST calls in ai-fix (holds at handler.ts:159, settle at :243-253). There is no SQL function.
- **Fix:** Implement the `bid_charge`, `bid_hold`, `bid_settle` and `bid_release` SQL functions (V2 §9.3):
  - `security definer`, with an advisory lock, granted to `service_role` only like `bid_rate_hit` (schema.sql:406-419).
  - FIFO spending across unexpired grants (D2), then packs.
  - Move ai-fix onto them.
  - Add PGlite tests in `tests/rls/rls.mjs`: 100 parallel charges with no double charge and no negative balance.

**PU-38 — high — No site-months, `sites` table or active-site limits (D1, D7)**
- **Evidence:**
  - `projects.max` is computed locally only (features.mjs:18,43) with values free 2 / flash 5 / unlimited. It is not enforced server-side (audit E12).
  - It is not tied to `monitor_targets` (schema.sql:295-312).
- **Decided target:**
  - Flash 1, High 3, Knight 10 included with a fair-use cap of 25 that an admin can raise (D7).
  - Flash and High host in the user's Netlify; BID charges the slot. Owner hosting is Knight only (D1, `sites.hosting_owner = 'user'|'bid'`).
- **Fix:**
  - **DB:** `sites` table (V2 §9.1 plus `hosting_owner`), `monitor_targets.site_id`, `bid_site_burn` (`site.day` = 1 000 credits/day), and `bid_enforce_sites`.
  - **Settings:** `plans.max_active_sites` and `plans.fair_use_sites`.
  - **billing:** actions `sites`, `site_activate`, `site_pause`.
  - **Engine:** `BILLING_ACTIONS += sites, activate, pause, estimate` (billing.mjs:15) and a new `meter.mjs`.
  - **features.mjs:** `sites.activeMax` from the cloud.
  - **App:** new `SitesView`, with "Активни сайтове 3/3" on Usage and the §8.4 limit sheets.
  - **Schedule:** call `bid_site_burn` from `supabase/monitor-cron.sql`.
  - **Migration:** 14 days with no automatic pause (V2 §14).

**PU-39 — high — No action price list or metering of non-AI actions (D8)**
- **Evidence:** No `pricing.actions` setting, `usage_events`, `usage_daily` or `meter` function exists. Only AI is charged.
- **Fix:**
  - Seed `settings.pricing.actions` per V2 §5. Per D8, a purely local check costs 0 credits and `check.run` costs 50 only when the report goes to the cloud.
  - Add `usage_events` and `usage_daily` tables.
  - Add a `meter` edge function, or `billing {action:"charge"}`.
  - In the engine, call `meter.charge` before cloud check, audit and deploy (check.mjs, release.mjs, netlify deploy paths).
  - Return `byAction` and `daily` in `usage` and draw a 30-day bar chart with Swift Charts in PlanUsageView.

**PU-40 — high — No 75 % / 90 % / 100 % nudges**
- **Evidence:** The only thresholds are session-percent colours at 80 and 100 (UsageViews.swift:63) and the ring turning to warn below 10 % (AccountView.swift:90). There is no `usage_nudges` table, no banner and no email.
- **Decided target (§17.2 "Прагове"):**
  - At 75 % used: Flash and High get "Надградете плана"; Knight gets "Купете кредити".
  - At 90 %: a banner.
  - At 100 %: a soft stop with the reset time and both buttons. Sites are never deleted.
- **Fix:**
  - **DB:** `usage_nudges` (pk user, period_ref, threshold).
  - **billing usage:** compute `nudge {threshold, kind, target}` per plan; add a `nudge_ack` action.
  - **App:** a global banner in RootView with the §8.2 and §8.3 texts in `App/Resources/{bg,en}.lproj/Localizable.strings` and the engine i18n. Knight's 90 % banner preselects the 500k pack at 19.99 € (D4 price, not the 17.99 € shown in the §8.2/8.3 sample texts; update those texts too).
  - Email and push through the monitor or notify function.

**PU-41 — medium — No realtime updates**
- **Evidence:** No Supabase Realtime channel or publication exists, `bid billing usage --watch` does not exist, and the app does not poll (PU-29).
- **Fix:**
  - Stage 1: polling plus `If-None-Match` hashing in billing.mjs.
  - Stage 2: a private channel `usage:<user_id>` with Realtime Authorization, `realtime.send` from `bid_charge`, and `bid billing usage --watch` streaming NDJSON lines that `BillingStore` consumes through `engine.run(…){ev in …}`.

**PU-42 — medium — No Knight extras (D5, D6)**
- **Evidence:** No `domain_orders` or `netlify_allocations` table, no `features.netlifyCredits` flag, and no UI.
- **Decided target:**
  - Knight launches with 1 included domain per subscription year.
  - The 3 000 Netlify credits / month stay behind `features.netlifyCredits` (default `false`) until Netlify confirms in writing. Until then the UI shows "Netlify кредити — скоро".
  - Additional domains are paid through Paddle, not with credits (D5).
- **Fix:**
  - Add the `domain_orders` and `netlify_allocations` tables (V2 §9.1) and the settings flag `features.netlifyCredits=false`.
  - The catalog exposes `extras {domain:true, netlifyCredits:<flag>}`.
  - The Knight card shows "1 домейн / година" and a "Netlify кредити — скоро" chip while the flag is false.
  - The domain flow goes through Spaceship reseller code in a new `engine/src/spaceship-reseller.mjs`, with the V2 §11.2 rules: 7-day hold on monthly plans, never during a trial, TLD price ≤ 15 €/year.
  - Add a separate Paddle product for extra domains (WP04.8).

**PU-43 — high — Grant validity (D2 option B) is not implemented; the code does the opposite**
- **Evidence:**
  - `grantPlanTokens` expires the previous plan bucket on every new grant (credits.ts:27-32), which is option A.
  - `expireDue` zeroes the plan bucket when a subscription ends.
  - There is no `credit_grants` table, no `expires_at`, no FIFO spending, no accumulation cap, no `upgrade_grant`, no `forecastDaysLeft`, `debt` or `hosting_grace`.
- **Decided target (D2):**
  - Credits from each payment are valid for Flash 1, High 3 or Knight 10 months and are spent oldest-first.
  - Accumulation cap = monthly credits × validity (High ≤ 900 000, Knight ≤ 10 000 000).
  - After cancellation, unexpired credits stay valid and 1 active site remains ("остатъчен режим").
- **Fix:**
  - **DB:** `credit_grants(id, user_id, source, credits, left, granted_at, expires_at)` or `credit_ledger.expires_at`.
  - **`grantPlanTokens`:** stop expiring the previous remainder; write `expires_at = granted_at + validityMonths`; enforce the cap.
  - **`expireDue`:** drop the plan bucket zeroing; keep 1 active site via `bid_enforce_sites`.
  - **Spending:** FIFO inside `bid_charge`.
  - **Expiry:** a per-grant job.
  - **Upgrades:** `upgrade_grant` in the webhook for proration.
  - **Summary:** `forecastDaysLeft` from 7-day burn in `bid_usage_summary`.
  - **App:** show "кредити изтичат: 120 000 на 31.12" lots on the Usage screen.

**PU-44 — medium — There is no `v=1` / `v=2` contract versioning for `usage`**
- **Evidence:** V2 §16 requires old clients to read the old format via `?v=1`. Today `usage` has a single shape, and `UsageReport` requires many non-optional fields (`limits.perMinute`, `pricing.version`, `history`).
- **Fix:** Add `body.v` in handler.ts. Make the new V2 fields optional in Swift (`windows`, `sites`, `byAction`, `daily`, `nudge`, `grants`) so the app works against both versions.

### B7. Smaller issues

**PU-45 — low — Pack checkout ignores quantity and the yearly toggle**
- **Evidence:** `checkout(pack:)` always uses `quantity:1` (fine), but `yearly` persists across sheets via `@Local` (BillingViews.swift:8) while the toggle is hidden (PU-13). If the toggle disappears with `yearly == true`, a plan checkout sends `--yearly` for a price that is not on sale, giving a 409 toast.
- **Fix:** Reset `yearly = false` when `!c.plans.contains { $0.yearlyAvailable == true }`.

**PU-46 — low — "Sale" status ignores whether the Paddle key exists**
- **Evidence:** `available` checks only `paddlePriceId` (handler.ts:414). If IDs are set but `PADDLE_API_KEY` is missing, the buttons are enabled and then fail with "Плащанията още не са настроени" (503 at :257).
- **Fix:** `available: !!priceId && !!deps.paddleApiKey`.

**PU-47 — low — Duplicate `ForEach` IDs in the recent usage list**
- **Evidence:** `BillingStatus.Usage.id = at + step` (Models.swift:1104). Two operations with the same step in the same millisecond, or retries, collide.
- **Fix:** Return `id` from `statusOf` (handler.ts:290 should select `id`) and decode it.

**PU-48 — low — Unknown operation statuses are shown raw**
- **Evidence:** ai-fix writes `status = "cancelled"` (handler.ts:323), but `K.usageStatus` has no case for it (LocalizedKeys.swift:144-153), so "cancelled" appears in English. The history icon marks `truncated` and `cancelled` with a red exclamation even though they were charged normally (UsageViews.swift:197-198).
- **Fix:** Add `usage.op.cancelled` (bg "прекратена"). Use a neutral icon for truncated and cancelled.

---

## C. Suggested order of work

1. **Make it visible without the cloud:** PU-1, PU-4, PU-5, PU-6 and PU-14 (offline catalog with the V2 values, calm empty states, demo data).
2. **Data correctness:** PU-19 (double subscriptions), PU-20, PU-21, PU-22, PU-24, PU-30 and PU-29 (refresh), PU-28 (quota exits).
3. **Unify the catalog to the approved V2:** PU-33 (High 300k, packs 4.99 / 19.99 / 39.99, active sites 1/3/10+25, validity 1/3/10 months) and PU-34, then fix the website and legal texts (PU-16).
4. **Redesign:** PU-7 to PU-13, PU-15 and PU-18 (one `CreditsMeter`, a Claude-style usage layout, a 4-column plan table with V2 content).
5. **V2 phases WP04.1–.9:**
   - WP04.1: catalog (PU-33/34).
   - WP04.2: charging core and D2 grants (PU-37, PU-39, PU-43, PU-25).
   - WP04.3: windows (PU-36, PU-23).
   - WP04.4: sites (PU-38).
   - WP04.5: screen and nudges (PU-8, PU-40, PU-44).
   - WP04.6: plan changes (PU-19 upgrade grant).
   - WP04.7: realtime (PU-41).
   - WP04.8: Knight extras behind the flag (PU-42).
   - WP04.9: reconciliation.
6. **Owner tasks** (not code): Paddle sandbox prices and keys (D12, live only after written approval), the checkout client token, deploying the `billing` function (`.github/workflows/cloud-deploy.yml:78` already deploys it with `--no-verify-jwt`), and a written Netlify confirmation before enabling `features.netlifyCredits` (D6).

## Key files

- **Engine:**
  - `engine/src/billing.mjs`
  - `engine/src/account.mjs`
  - `engine/src/costs.mjs`
  - `engine/src/features.mjs`
  - `engine/src/ai/providers.mjs`
- **Supabase:**
  - `supabase/functions/billing/handler.ts`
  - `supabase/functions/_shared/credits.ts`
  - `supabase/functions/ai-fix/handler.ts`
  - `supabase/schema.sql`
- **App:**
  - `App/Sources/BeforeIDeploy/BillingViews.swift`
  - `App/Sources/BeforeIDeploy/UsageViews.swift`
  - `App/Sources/BeforeIDeploy/AccountView.swift`
  - `App/Sources/BeforeIDeploy/Stores/BillingStore.swift`
  - `App/Sources/BeforeIDeploy/Stores/AccountStore.swift`
  - `App/Sources/BeforeIDeploy/Stores/AIStore.swift`
  - `App/Sources/BeforeIDeploy/Models.swift` (lines 890-960, 1055-1113, 1374-1431)
  - `App/Sources/BeforeIDeploy/V9Views.swift` (lines 365-440)
  - `App/Sources/BeforeIDeploy/V7Views.swift` (CostsView)
  - `App/Resources/bg.lproj/Localizable.strings` (lines 295-339, 1107-1186)
- **Docs and site:**
  - `docs/PLANS-AND-CREDITS-BG.md`
  - `docs/PLANS-AND-CREDITS-V2-BG.md`
  - `site/index.html`
  - `site/checkout.html`
