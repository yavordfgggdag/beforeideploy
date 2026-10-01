# Codex V12 billing, credits and hosting-sites backend: review

Branch `origin/codex/v12-completion` (HEAD `8d5fbec`). Commits reviewed: `cd57e53` (catalog, usage, subscription changes), `d3c12f2` (atomic V2 accounting, metered AI), `0111e18` (site controls, annual accrual, publishing receipts), `ca8e896` (cloud reports, annual refunds).
This was a read-only review. Tests ran in a detached worktree, which was removed afterwards. The scenario script is saved at `scratchpad/v13/codex-billing-scenarios.mjs`.
Line references are to the branch: `credits-v12.sql` = `supabase/credits-v12.sql`, `handler.ts` = `supabase/functions/billing/handler.ts`.

## 0. Verdict

| Area | Verdict | Why |
|---|---|---|
| Catalog single source + generated copies | **Keep** | One JSON source, sync scripts with `--check`, all copies agree. Some older docs are stale. |
| SQL lot/hold/settle core (grants, allocations, advisory lock, idempotent op ids) | **Keep, fix 4 bugs** | Sound design. Bugs: the downgrade cap wipes prepaid credits, refunds ignore line items, the hold TTL is shorter than a deploy, and migrated sites are billed during grace. |
| Anchored 5h/weekly windows (`usage_windows`, Boost) | **Replace if the linear model is adopted** | They work as designed in D3/D9. The linear model makes them obsolete (see §4). |
| Annual accrual / out-of-order refunds | **Keep** | Thorough and tested. Chargebacks are missing. |
| Paddle flows | **Fix / defer** | Upgrade and downgrade within one interval work. Interval change, in-app cancel, chargebacks, invoices and live mode are missing or blocked. Checkout is a placeholder. |
| Hosting "sites" | **Keep as metering only; defer provisioning** | "Activate" is a billing switch, not hosting. BID-hosted sites, Netlify credits and CodeGuard are hard-gated off. |

## Test results (run on the branch)

| Suite | Command | Result |
|---|---|---|
| Deno Edge Functions | `deno test --allow-env --allow-net --allow-read supabase/functions` | Type-check fails: `npm:@types/node` is not resolvable in this sandbox (environment, not code). With `--no-check`: **112 passed, 0 failed** |
| SQL/RLS on PGlite | `cd tests/rls && node rls.mjs` (pglite 0.5.8 from scratchpad) | **35 passed, 0 failed**. 25 of them are V12 credit tests from `tests/rls/credits-v12.mjs` |
| Catalog sync | `node scripts/catalog-sync.mjs --check` | OK ("copies and schema seed match") |
| Credits sync | `node scripts/credits-sync.mjs --check` | OK (rc 0) |
| My bug scenarios S1–S6 | `codex-billing-scenarios.mjs` on the same schema | 4 bugs confirmed (S1, S2, S4, S6). Details in §2 |

---

## 1. Exact current catalog

**Source of truth:** `supabase/functions/_shared/plans-catalog.json` (version `v12.2`, EUR, tax-inclusive, `mode: sandbox`).
`scripts/catalog-sync.mjs` generates:
- `engine/src/plans-data.json` (byte-identical copy)
- the `-- BEGIN GENERATED V12 CATALOG` seed in `supabase/schema.sql`, plus a version-guarded migration
- `supabase/migrations/202610010001_catalog_v12.sql`, which keeps old Paddle IDs and sets `needsReconciliation` when a price changed

`scripts/site-build.py:9-11` renders `site/index.html` from the same JSON.

| Plan | €/month | €/year | Credits/month | Validity | 5h window (20 %) | Weekly (40 %) | Active sites (max) | Extras |
|---|---|---|---|---|---|---|---|---|
| Flash | 9.99 | 99.90 | 100 000 | 1 month | 20 000 | 40 000 | 1 (1) | — |
| High | 29.99 | 299.90 | 300 000 | 3 months | 60 000 | 120 000 | 3 (3) | — |
| Knight | 99.99 | 999.90 | 1 000 000 | 10 months | 200 000 | 400 000 | 10 (fair-use 25) | domain: true, boost: true, netlifyCredits: false |

**Packs.** Each is valid 12 months and has `paddlePriceId` null.

| Pack | Credits | Price |
|---|---|---|
| `pack-100k` | 100 000 | €4.99 |
| `pack-500k` | 500 000 | €19.99 |
| `pack-1m` | 1 000 000 | €39.99 |

**Trial.** 7 days of High, 50 000 credits, 1 active site. Windows derive from 50k, so 10k per 5h and 20k per week (`credits-v12.sql:237`). There is one claim per e-mail hash (`bid_start_trial`, :741).

**Credit value.** `ai.creditEur = 0.000025` €/credit. It is set once by the migration guard at `credits-v12.sql:103-107`, with the default also in `ai-fix/handler.ts:37`. The rate is `ai.usdToEur = 0.92`. Model prices (USD/M in/out): Haiku 1/5, Sonnet 5.5 2/10, Opus 5.5 4/20 (`ai-fix/handler.ts:46`). Owner AI cost ceilings are therefore Flash €2.50, High €7.50 and Knight €25.

**Action prices** (`credits-v12.sql:101`, also in `pricing-actions.json`; `window` = counts in the 5h/weekly windows):

| Action | Credits | Counts in windows |
|---|---|---|
| `site.day` | 1000 (≈30k per site-month) | no |
| `monitor.fast` | 500/day | no |
| `monitor.path` | 50 per path above 3, per day | no |
| `check.run` (cloud report) | 50 | yes |
| `audit.full` | 400 | yes |
| `deploy.preview` | 150 | yes |
| `deploy.production` | 500 | yes |
| `deploy.rollback` | 0 | — |
| `backup.snapshot` | 100 | yes |
| `ai.*` | actual model cost | yes |

**Accumulation cap** (D2): monthly credits × validity, so Flash 100k, High 900k, Knight 10M (`bid_grant` :210-223).

**Consistency check.**

| Copy | Status |
|---|---|
| `engine/src/plans-data.json` | identical |
| `supabase/schema.sql` seed | generated, `--check` OK |
| `site/index.html:42-44` | €9.99/29.99/99.99, 100k/300k/1M, packs 4.99/19.99/39.99, 12 months: consistent |
| App fixture `App/Tests/.../billing-v12-catalog.json` | identical values |
| App runtime | decodes from engine/cloud; no hard-coded prices |
| `billing/handler.ts:40-41,91` | imports the JSON; derives `window5h`/`weekly` as 0.2/0.4 × `settings.plans.tokens` |
| **Stale docs** | `docs/BILLING-AND-USAGE.md:17` (High 250 000, Flash 2.49 €); `docs/OWNER-ACCEPTANCE-TEST-BG.md:124,139` (High 250 000, packs 3.99/17.99/33.99); `docs/PLANS-AND-CREDITS-BG.md:15,30` (V1 doc, High 250 000); `App/.../AdminView.swift:118` default grant 250000 (cosmetic) |

All D-decisions from §17.2 that touch the catalog are implemented: D2 (validity), D3 (packs inside windows, Boost), D4, D7, D9, D10, D11, and D6/D12 as flags or blocks.

---

## 2. SQL accounting review (`supabase/credits-v12.sql`, 1024 lines, also generated into `schema.sql`)

### Architecture (good)
- **Lots:** `credit_grants` holds `credits`, `left_credits`, `expires_at`, `refund_base`, `payment_ref`, unique `(user, ref, source)`, with a FIFO index on `(expires_at, granted_at, id)`.
- **Reservations:** `credit_holds` (operation-id unique) plus `credit_allocations` pin specific lots. Settlement draws from the pinned lots first, then FIFO. Any shortfall becomes `credit_accounts.debt` (:366-415).
- **Ledger:** `credit_ledger` remains the compatibility balance. Every lot mutation writes a matching ledger row. `usage_drift` / `bid_reconcile_usage` (:690-698) detect divergence between `usage_events` and ledger charges.
- **Locking:** every mutating RPC calls `bid_v12_lock` = `pg_advisory_xact_lock(hashtextextended(user,12))` first, directly or via `bid_v12_refresh` (:110, :119). This gives per-user serialization within the transaction, so concurrent holds cannot both pass the balance or window check.
- **Permissions:** all definer RPCs are revoked from `public/anon/authenticated` and granted only to `service_role` (:1019-1024). RLS gives `own_read` on all 14 new tables (:92-98, :451, :883, :993). This is tested ("V12 security…").
- **Idempotency:**
  - Grants: `(ref, source)` → `duplicate`.
  - Holds: an existing event or hold returns duplicate, or `operation_conflict` when parameters differ (:310-319).
  - Settle: checks for an existing `usage_events` row (:371).
  - Release: only acts while `held` (:355).
  - Site-day: op id `site:<id>:<day>`.
  - Payment: `credit_periods.transaction_ref` PK.
  - Refund: `credit_refunds` PK plus per-lot `grant_refund:<adj>:<lot>` existence check (:465).
- **Expiry:** lazy, under lock, in `bid_v12_refresh`. Credits pinned by a hold do not expire until settled or released (:180-187).
- **Annual:**
  - `credit_periods` rows (one per payment) accrue monthly slices `txn`, `txn:m1`…`txn:m11` while the Mac is closed, through `bid_scheduler_credits` (:968).
  - Each slice has its own validity (`at + validity_months`).
  - Refund share reduces future slices (:937) and writes zero-delta markers so retries don't refund twice (:942).
- **Out-of-order refunds:** an adjustment that arrives before its transaction is persisted in `billing_events`, then replayed by `bid_v12_payment_refunds` (:489) when the payment or upgrade is recorded. Covered by 4 RLS tests.

### Bugs and risks, with concrete scenarios

| # | Severity | Finding | Evidence / scenario |
|---|---|---|---|
| B1 | **High (money/trust)** | **A downgrade or tier change wipes prepaid credits through the accumulation cap.** `bid_grant` caps plan-bucket credits at *new tier* tokens × *new tier* validity and trims FIFO, soonest-expiring first. | `:210-223`. **S1 (run):** Knight user holding 1 000 000 unspent (valid 10 months) downgrades; the first Flash renewal grants 100 000. Result: balance **100 000**. The fresh Flash lot is trimmed to 0 because it expires first, and the Knight lot keeps 100 000. **900 000 paid credits vanish** (`grant_cap` ledger rows). D2's "Knight credits valid 10 months" and §12 "current credits remain" both say this should not happen. **Fix:** compute the cap per tier of each lot (or max(old cap, new cap) until older lots expire), and trim only lots of the same tier or source. Never trim the lot just granted. |
| B2 | Medium | **A refund share is applied to every lot of a transaction, ignoring line items.** If a transaction contains a plan plus a pack and only the pack is refunded, the plan lot also loses credits. | `handler.ts:241-262` computes `share = refund_total / txn_total` and `bid_refund` (:464) matches `ref=txn` and `txn:*`. **S2 (run):** 300k plan + 100k pack in one txn, €4.99 pack-only refund (share 0.1427): plan lot **−42 796**, pack **−14 265**, instead of pack −100 000. Paddle `adjustment.items[]` carries per-item amounts; map item → `price_id` → lot. Today's checkout creates single-item transactions, so the impact is low but real for portal or manual transactions. |
| B3 | Medium | **The hold TTL (15 min) is shorter than a deploy** (CLI timeouts are 20 min in `hosting.mjs:214,238`, `netlify.mjs:294`). An orphaned hold releases its reservation, so a second operation can reserve the same credits. The late settle (allowed for `orphaned`, :374) then creates debt. | **S4 (run):** balance 10 000; deploy A holds 9 000; at +16 min deploy B holds 9 000 (OK because A was orphaned); both settle, giving **debt 8 000, balance −8 000**. **Fix:** a TTL per action (deploy 30–40 min), or a heartbeat/extend RPC. |
| B4 | Medium | **The migration bills sites the user never chose.** The migration marks every `bid_projects` row with an enabled monitor as `active` with a 14-day grace (:700-712). Grace only prevents *pausing*; `bid_site_burn` still charges 1 000 per site per day, even above the plan limit. | **S6 (run):** Flash user (limit 1) with 2 migrated active sites: both charged, 98 000 left after one day. Over 14 days that is 28 000 credits, plus debt up to 3 × 1000 × sites. §14 promises "nothing paused automatically for 14 days" but does not mention charging. **Fix:** do not burn sites above the limit during grace, or start them as paused with a banner. |
| B5 | Medium | **Paid credits are not protected after a chargeback.** Only `adjustment.action = 'refund'` is handled (`handler.ts:241`, SQL :498). `chargeback`, `chargeback_warning`, `chargeback_reverse` and `credit` are ignored. | A chargeback keeps all remaining credits and the paid entitlement. |
| B6 | Medium | **The past_due grace is measured from `period_end`.** Paddle normally moves `current_billing_period` forward when the renewal transaction is created, even if payment fails (verify in sandbox). If so, a past_due user keeps tier, windows and site limits for the whole new period + 3 days without paying. No credits are granted, so the real exposure is site limits and continued spending of old lots. | `enforce` :515-516; `credits.ts:65,93`. The doc §12 says "работят 3 дни, после пауза". Should be measured from the first `past_due` event time. |
| B7 | Low | `payment_refund` and `grant_refund` markers use `on conflict do nothing`, but `credit_ledger_once` (`schema.sql:265`) only covers plan_grant/trial_grant/topup/refund/expiry, so the markers duplicate. | **S5 (run):** 3 replays give 3 `payment_refund` rows (zero delta). Refunds stay correct because of the `exists` check, but the ledger fills with noise and every replay path calls the refund again. Add these reasons to the unique index. |
| B8 | Low | `bid_hold` checks `available` as the full ledger sum (:322), but allocates from lots (:338). Any direct ledger write without a lot (V1 code, manual SQL, admin tooling) makes the hold raise `credit grants and ledger need reconciliation` (:344), which surfaces as a 503 to the user. Today no Edge Function writes the ledger directly (`insertOnce` in `credits.ts:12` is now unused), so this is latent. | Prefer one source of truth: sum of `left_credits − held − debt`. |
| B9 | Low | Performance: every operation runs several full scans per user (ledger sum :322/:413, legacy loops in refresh :146-179, `usage_events` sums in windows :265/:286). This is O(rows per user) per request. | Fine for beta. Later, keep a running `credit_accounts.balance`. |
| B10 | Low | Lock order across users: `bid_site_burn` and `bid_scheduler_credits` take many users' locks inside one transaction, in different orders. If they run concurrently they can deadlock; Postgres aborts one and the whole batch rolls back. | Run them in one scheduler call, or take one user per transaction. |
| B11 | Low | Month arithmetic in `bid_accrue_periods`/`bid_upgrade_grant` uses `extract(year/month from timestamptz)` in the session time zone (:649 uses UTC, :930/:770 do not). This is correct only while the DB time zone is UTC (Supabase default). | Pin `at time zone 'UTC'`. |
| B12 | Info | `knight.activeSitesMax = 25` (fair-use) is stored but never enforced or used. `siteLimit` is always `max_active_sites` (:250). | The admin raises it manually. |
| B13 | Info (by design) | Packs are inside the 5h/weekly windows (D3). A pack-only or free user gets **Flash windows** (20k/5h, 40k/week) and **0 active sites** (:243-247). | **S3 (run):** a free user with a 1M pack is denied a 20 001-credit op with `window_5h`. A 1M pack takes at least 25 weeks to spend at 40k/week. |
| B14 | Info | Metering of user-hosted deploys is advisory. `meteredProviderCall` (`engine/src/meter.mjs:46-52`) skips metering when not logged in, and a modified client can reserve and then release. Only cloud artifacts (reports) are enforced server-side through `bid_v12_report`. | Acceptable while hosting is user-owned (D1). Don't count it as revenue protection. |

**Concurrency.** The single advisory lock per user is correct for Postgres. It cannot be exercised in PGlite (single connection), and none of the 35 tests is a true parallel test. A pgbench or two-connection test against real Postgres is advisable before going live.

**PU audit status (backend part).** Fixed:
- PU-19 (no second subscription; `previewChange`)
- PU-20 (trial "included" = actual grants, :654-655)
- PU-21 (annual monthly slice, :648-652)
- PU-23/36/37 (anchored windows)
- PU-25/43 (D2 lots and validity)
- PU-33/34 (catalog, single `creditEur`)
- PU-38 (sites)
- PU-39 (action prices)
- PU-40 (nudges)
- PU-44 (`v=2` + ETag)
- PU-46 (availability needs the key)

Still open: PU-2 (nothing on sale: all `paddlePriceId` null, checkout token placeholder), PU-41 (no realtime; ETag polling only), PU-42 (Netlify credits gated).

---

## 3. Paddle flows

**Infrastructure:**
- Webhooks are HMAC-verified with a 5-minute tolerance and multiple `h1` values (`handler.ts:69-80`).
- Each event is claimed by `billing_events` PK (event_id) before processing. On error the claim is deleted so Paddle retries (:132-141, :265-267).
- Older `subscription.*` events are ignored by `occurred_at` versus the stored `event_at` (:173).
- Transactions are idempotent by transaction id (`credit_periods` PK, pack ref `txn:price`).
- Adjustments that arrive before their transaction are replayed later.
- **Live is hard-blocked:** `paddle()` and `paddleGet()` throw 503 if the host is `api.paddle.com` (`handler.ts:274`, `:318`). D12 envisaged a `billing.liveApproved` flag instead.
- `site/checkout.html:42-43` has `PADDLE_CLIENT_TOKEN = "REPLACE_WITH_CLIENT_SIDE_TOKEN"` and `PADDLE_ENVIRONMENT = "sandbox"`, so no checkout can open.
- Every `paddlePriceId` is null, so `available: false` everywhere.

| Flow | Status | Evidence / gap |
|---|---|---|
| Purchase (new subscription) | **Code ready, blocked by config** | `checkout` → `POST /transactions` with `custom_data.user_id` → `checkout.url` (:457-463). Needs price IDs, the checkout page token, and the default payment link set in Paddle. |
| Pack purchase | Code ready, blocked | `bid_grant` topup `txn:price`, `qty` respected (:232-236). |
| Renewal (monthly) | OK | `transaction.completed` with origin `subscription_recurring` → `bid_record_payment` → new period → grant + cap (:229). Relies on renewal transactions carrying `custom_data.user_id`; there is no fallback lookup by `subscription_id` (:200). |
| Renewal (annual) | OK | One payment → 12 monthly slices through the scheduler. Imports V1 annual receipts (:893-920). |
| Upgrade (same interval) | OK | `previewChange` → `confirm-change` with fingerprint/stale checks, `prorated_immediately`, `on_payment_failure: prevent_change` (`subscription-change.ts:17-82`). Proportional `upgrade_grant` (:756-800). Portal-initiated upgrades are detected in the webhook (:178-188). |
| Downgrade (same interval) | **OK in Paddle; credits bug B1** | PATCH now with `do_not_bill`. The old tier is kept locally until `effective_at` (`effectiveSubscriptionTier`). At the next renewal the cap trims the prepaid lots. Sites are paused by `bid_enforce_sites` (most recently activated first, :526-533). There is no "choose which sites stay" step 7 days before (§12). |
| Monthly ↔ annual | **Blocked** | `subscription-change.ts:28` returns 409 `billing_interval_change`. |
| Cancel | Portal only | No in-app cancel. `portal` returns the Paddle customer portal URL (:475-483). `cancel_at` comes from `scheduled_change`. After it ends: tier `free`, remaining lots stay spendable (D2 "variant B"), siteLimit 1 if lots remain (:243-246). |
| Reactivate | Portal (undo the scheduled cancel) or new checkout | Edge case: `checkout` treats `expired`/`paused` local subscriptions as "existing" (:450) and routes to `previewChange`. That returns 409 when Paddle says canceled, until the user runs `sync`. `expired` is a local status set by `bid_enforce_sites` when a webhook was missed. |
| Failed or late payment (past_due) | Partial | Status is stored. A 3-day grace after `period_end` (B6). No grant until `transaction.completed`. No dunning UI, no `transaction.payment_failed` handling (not strictly needed). |
| Refund (full/partial) | OK, except line items (B2) | Takes only what remains of the original lots. Never claws back later purchases. Annual: past slices reduced and future slices scaled down. A full refund stops accrual. |
| Chargeback | **Missing** (B5) | — |
| Invoices | Delegated | Paddle e-mails invoices and the portal lists them. There is no in-app invoice list or download, and no transaction history beyond `billing_events`. |
| Sync after a missed webhook | OK | `sync` pulls `/subscriptions/:id`, applies status/period/tier, resolves `applying` changes (:400-431). |
| Ordering/duplicates | Good | Event-id PK, `occurred_at` guard for subscriptions, transaction-id idempotency, adjustment replay. One weakness: a `subscription.*` event without `custom_data.user_id` is stored as "ignored" and never reprocessed. |

**Needed to go live:**
1. Create the sandbox, then live, products and prices: 3 plans × (monthly + annual), plus 3 packs. Set the IDs in Admin.
2. Fill `checkout.html` with the client token and environment, and set the default payment link.
3. Replace the hard live block with the `billing.liveApproved` admin flag (D12).
4. Handle chargebacks and line-item refunds.
5. Fix B1 before downgrades are sold.
6. Add interval change (Paddle supports it as an item swap with `prorated_immediately`; credit_periods must close the monthly period and open an annual one).
7. Add an in-app cancel and resume (`POST /subscriptions/:id/cancel` with `effective_from: next_billing_period`; `PATCH scheduled_change: null`).
8. Run the WP04.6 sandbox scenarios.

---

## 4. Switching to a linear-release model

**Proposal.** `R(t) = floor(B·min(1, max(0,(t−t0)/336h))`: a 14-day linear release of each included plan grant. Rolling caps are 5h ≈ B·5/336 and 7d = B/2. Packs are not subject to R(t) and get separate abuse limits. There is a one-time starter bonus.

**Numbers per plan:**

| Plan | B | Release/hour | Rolling 5h cap | Rolling 7d cap | Today's 5h / week |
|---|---|---|---|---|---|
| Flash | 100 000 | 298 | **1 488** | 50 000 | 20 000 / 40 000 |
| High | 300 000 | 893 | **4 464** | 150 000 | 60 000 / 120 000 |
| Knight | 1 000 000 | 2 976 | **14 881** | 500 000 | 200 000 / 400 000 |

**Blocking issue with the 5h cap as specified.** AI holds reserve the worst case: the full input plus `max_tokens` 8000 (`ai-fix/handler.ts:156-159`).

| Plan / model | Hold size | 5h cap | Result |
|---|---|---|---|
| Flash (Sonnet) | 3 100–4 200 credits | 1 488 | every AI fix is refused |
| High (Opus) | 6 200–8 400 credits | 4 464 | every AI fix is refused |
| Knight | — | 14 881 | barely fits |

Even typical settled costs (≈890 Sonnet, ≈1 760 Opus per fix, V2 §4) allow only 1–2 fixes per 5h on Flash. Pick one of three options:
- (a) Apply the 5h cap to *settled* spend only and let one in-flight op overrun (bounded by R(t)).
- (b) Make the 5h cap a burst multiple, e.g. 6 × B·5/336 ≈ 9% of B.
- (c) Lower `max_tokens` and reserve `min(estimate, remaining cap)` with explicit debt on overrun (the debt mechanics already exist).

The 7d cap of B/2 matches R at day 7, so it is consistent.

**What changes** (estimate: medium, about 3–5 dev days plus sandbox and UI; the lot/allocation/lock architecture fits well):

| Component | Change |
|---|---|
| `credit_grants` | Add `release_start timestamptz`, `release_hours int` (null for topup/bonus/admin). Spendable per lot = `max(0, left_credits − held − (credits − floor(credits·frac(t))))`. Refunds and cap trims still act on `left_credits`. |
| `bid_hold` (:322 balance check, :338-343 allocation), `bid_settle` overflow loop (:386-395) | Use per-lot *spendable* instead of `left − held`. The balance check must stop using the ledger sum: unreleased credits sit in the ledger. Add a `bid_v13_spendable(user,t)` helper. |
| `bid_site_change` (:618), `bid_v12_monitor_extras` (:841), `bid_v12_burn_one` (:550) | Same switch from the ledger sum to spendable. Decide whether `site.day` may draw on unreleased plan credits; recommended yes, so sites never pause on day 1 of a new grant. |
| Window enforcement | Replace the `usage_windows` lookup (`bid_v12_windows` :254-302) with rolling sums over `usage_events.created_at ∈ (t−5h,t]` / `(t−7d,t]` plus open holds. The index `usage_events_period(user_id,created_at)` already exists. |
| Packs out of the windows | In settle, split each event's charge by lot bucket. Add a `usage_events.plan_credits` column computed from the allocations' buckets, and count only `plan_credits` in the windows. Today `counts_in_window` is all-or-nothing per action. Packs need their own abuse limits: a per-hour credit ceiling and the existing `ai.rate` 6/min, 60/h. |
| `usage_windows` table | Becomes a cache or is retired. Its 5h `opened_at/resets_at` semantics disappear; "resets at" becomes "frees N credits at" (oldest event + 5h). Keep the table for history and drop its writes. |
| Boost (Knight) | `boost_until/boost_used_at` live on the week window row. Move them to `credit_accounts` and apply ×1.5 to the rolling caps, with the weekly once-per-anchor rule kept as "once per 7 days". |
| `bid_v12_entitlement`, `bid_usage_summary` | New fields: `released`, `unreleased`, `nextReleaseAt`; rolling `session`/`weekly` `{used, cap, freesAt}`. Bump the `usage` contract to v3. The app's `UsageViews`/`CreditsMeter` decode `resetsAt` and need updates; the fixture is `usage-v12-demo.json`. |
| Starter bonus | `bid_grant` source `starter_bonus` in a non-released bucket (topup-like or a new `bonus` bucket, so the CHECK must change), claimed once per e-mail hash like `trial_claims` (:747-749). Decide whether it replaces the 7-day High trial. |
| `bid_upgrade_grant` | Proportional grant: release over the remaining time to the slice end, or immediately. Decide. |
| Annual accrual | Unchanged. Each monthly slice gets its own release curve. |
| Catalog JSON | `window5h`/`weekly` become derived (B·5/336, B/2), or move to `releaseHours: 336`, `window5hFactor`, `weeklyFactor`. Update the sync scripts, site and docs §3/§7. |
| Tests | Rewrite about 6 RLS tests (windows, Boost, packs-can't-bypass, rolling-deploy windows, economics) and the Deno `fake_credits.ts` windows. |

**Migrating existing customers.** Grandfather existing lots: `release_start = granted_at − 336h`, so they are fully released. Apply the curve only to grants made after cutover. Otherwise a user who received a grant 3 days ago would suddenly see about 79% of it locked. Close any open `usage_windows` at cutover. The rolling sums immediately include the previous 7 days of `usage_events`, which already exist, so there is no reset gift. Packs already bought simply stop counting in the windows. Announce it as a policy change: it alters D3, which the owner decided.

---

## 5. Hosting and sites

| Topic | What exists | Evidence |
|---|---|---|
| "Site activation" | A **billing and entitlement switch only**. `sites` row `state = active`, limited by the plan's `siteLimit` (1/3/10). Activation requires enough credits for one `site.day` and burns today's 1 000 credits at once. A daily scheduler burns 1 000 per active site (`bid_site_burn`, not counted in windows). | `credits-v12.sql:580-625`, `meter.ts:17-20` |
| Pause | User pause (burns today first), plan-limit pause (most recently activated first), or debt pause after 3 days (`paused_reason = no_credits`). Paused means: cloud monitor cannot register or run (`monitor/handler.ts:163`), metered deploys and backups are refused (`bid_hold` `site_paused` :320; `meter.ts:52`), and fast-monitor and extra paths are trimmed when unpaid (:568-570). **The user's site on their own Netlify stays online; BID never touches it.** Rollback is still allowed. | :509-535, :537-578 |
| Debt grace | Overdraft for hosting up to 3 × 1000 × active sites for 3 days, then pause. The next grant repays the debt first (`bid_grant` :204-209). | :551-564 |
| Real hosting provisioning | **None.** `hosting_owner = 'bid'` (Knight-only, D1) requires a pre-existing `sites.netlify_site_id`, but no code path sets it, so activation always returns `hosting_not_ready`. There is no Netlify team or site creation, DNS, or "paused page" for owner-hosted sites. | :612-614 |
| Netlify credits (Knight, 3 000/month) | Gated off. `features.netlifyCredits = false`; Admin refuses to set it true (409 "require written authorization") per D6. Table `netlify_allocations` exists but is unused. Catalog `extras.netlifyCredits: false`. | `admin/handler.ts:191`, `credits-v12.sql:80-84` |
| Knight domain | **Manual review only.** `bid_domain_request` validates the name. Monthly plans wait 7 days after the first paid Knight grant; annual plans are immediate. One per subscription year (unique `year_ref`). Inserts `domain_orders(status='review', registrar default 'spaceship', included, cost_eur ≤ 15 check)`. It never buys or registers anything. Additional domains (D5) are not implemented as a Paddle product. | :804-826 |
| CodeGuard | Honest stub: `engine/src/providers/backup/codeguard.mjs` reports "not connected" (no API, credentials or partnership). `backup.snapshot` is priced at 100 credits, but no engine path meters it. Backups are gated off in practice. | codeguard.mjs:1-12 |
| Publishing receipts | The engine wraps provider CLIs (Netlify, Vercel, Cloudflare, gh-pages, release promote) in `meteredProviderCall`: reserve, invoke, then `operation_report` settle (charged even if the deploy failed, "pay for what was started") or release if the CLI never launched. A local journal in `~/…/meter-operations` recovers receipts. Not logged in, or vip/admin, means no charge. | `engine/src/meter.mjs`, `reports.ts:26-29` |
| Cloud audit | `audit_run` does a server-side probe of the public live URL (netguard: pinned DNS, public IPs only, bounded) and charges 400. `check_report` stores a client-reported check for 50. Reports are stored in `cloud_reports`, private and tied to a settled receipt. | `reports.ts`, :986-1016 |

**Bottom line for hosting.** "Sites" today are a metered slot: 30k credits/month = 30% of a Flash plan. They buy cloud monitoring, BID-metered deploys and cloud reports for a site the user hosts on their own provider. Owner hosting, Netlify credit allowance, domain fulfilment and backups are all deferred, behind flags or manual review. The user-facing wording should say so explicitly. Under the linear model, decide whether `site.day` draws on unreleased credits (recommended: yes).
