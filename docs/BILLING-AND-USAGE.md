# Billing and usage — credit model V3 (catalog v13)

Binding spec: [PLAN-UNIFIED-BG.md §9.2–§9.10 and §11.9](PLAN-UNIFIED-BG.md). Reference math with tests:
`web/src/lib/credits.ts` (+ `credits.test.ts`); the database enforces the same rules in
`supabase/credits-v13.sql` (tests: `tests/rls/credits-v13.mjs`). Canonical sources — never edit the generated copies:

| Source | Generated copies (sync script, `--check` in CI) |
|---|---|
| `supabase/functions/_shared/plans-catalog.json` | `engine/src/plans-data.json`, the catalog seed + migration block in `supabase/schema.sql`, `supabase/migrations/202610010002_catalog_v13.sql` (`scripts/catalog-sync.mjs`) |
| `supabase/credits-v12.sql`, `supabase/credits-v13.sql` | the `V12 CREDITS` and `V13 CREDITS` blocks of `supabase/schema.sql`, `engine/src/pricing-actions.json` (`scripts/credits-sync.mjs`) |
| `supabase/functions/_shared/pricing-actions.json` | must equal the seed in `credits-v12.sql` |

The app shows what the cloud returns (`billing usage`), never a client-side estimate; `web/src/lib/credits.ts` is used
only to explain availability ("ready at 14:30").

## 1. Units

| Unit | Where it appears | Never mixed with |
|---|---|---|
| **AI credits** | plan budgets, bonus, packs, holds, charges; every number on "Plan & usage" (ledger columns are still named `tokens`) | money, model tokens, site entitlements |
| **entitlements** | active sites, monitoring, backups, cloud minutes — part of the plan, never paid with credits | credits |
| **money** (EUR) | plan and pack prices; tax and proration from Paddle | credits |
| **model tokens** | `ai_usage.input_tokens / output_tokens`; charge = `ceil(model cost in EUR / ai.creditEur)` | — |

One credit = 0.000025 € of model cost (`ai.creditEur`) on every plan: Free 10 000 = 0.25 €, Flash 40 000 = 1 €,
High 100 000 = 2.50 €, Knight 800 000 = 20 € a month at most.

## 2. Catalog v13

| Plan | Connected hosting (sold now) | Hosting included (flag) | AI credits / month (B) | Active sites | Cloud minutes | Netlify tier | Carried validity |
|---|---|---|---:|---:|---:|---|---:|
| Free | 0 € | — | 10 000 | 1 | 0 | Free 300 (client's own) | 1 month |
| Flash | 9.99 € / 99.90 € a year | 14.99 € / 183.90 € | 40 000 | 1 | 300 | Personal 1 000 | 1 month |
| High | 29.99 € / 299.90 € | 29.99 € / 358.90 € | 100 000 | 3 | 1 000 | Pro 3 000 | 3 months |
| Knight | 99.99 € / 999.90 € | 99.99 € / 1 089.90 € | 800 000 | 10 (fair use 25) | 4 000 | Pro 5 000 | 10 months |

Packs: 100 000 / 500 000 / 1 000 000 credits for 4.99 / 19.99 / 39.99 €, valid 12 months. Starter bonus: 60 000
credits once per customer, 30 days, only for creating a site / large fixes (`starterBonus.actions`: `ai.fix`,
`ai.fix.deep`). Trial: 7 days of High with 50 000 credits (unchanged).

**Hosting mode.** Each paid plan carries both price sets: the top-level `price`/`yearly` is "connected hosting"
(the customer owns the Netlify team and pays Netlify; our price is without hosting) and `hostingIncluded` holds the
V3 prices with the Netlify tier and, for yearly plans, a domain included. `features.hostingIncluded` (catalog,
overridable by the `settings` row of the same name in Admin) decides which set is sold, shown in the app and on the
website (`scripts/site-build.py`). Webhooks, plan-change previews and upgrade-payment matching recognise both sets,
so a subscriber keeps working when the flag changes. Default: `false` (until the Netlify agreement, §11.9).

## 3. The credit model (V3)

Kinds of credits and the **spend order** (`bid_v13_lots`):

| # | Kind | Source | Released | Valid |
|---|---|---|---|---|
| 1 | bonus | starter bonus (`bonus_grant`) | at once | 30 days; only `starterBonus.actions` |
| 2 | carried | plan lots of earlier periods (oldest expiry first), trial gifts, lots from before V3 | at once | validity months from the grant; accumulation cap = B × validity |
| 3 | included | the current period's plan / Free / upgrade lots | `R(t)` | until the period ends, then carried |
| 4 | packs | purchases (`topup`), admin restorations (`admin_grant`) | at once, rate-limited | 12 months |

**Release.** A period starts at `t₀` = the grant time of a plan payment (a yearly plan: 12 monthly periods, each with
its own `t₀`; Free: monthly from sign-up). Released included credits:
`R(t) = floor(B · min(1, max(0, (t − t₀) / 336 h)))`. Spendable included = `min(R − spent − held, unreserved left)`.
Because `spent + held ≤ R(t) < B` for `t < 336 h`, the included budget cannot be exhausted in the first 14 days.

**Guards** (on SETTLED included spend, `credit_spends`, rolling windows): 24 h ≤ 25 % of B, 7 days ≤ 50 % of B.
They decide whether a **new** task may start on included credits, never how large it may be: one task larger than
25 % of B runs when the window is clear. Bonus, carried credits and packs are not guarded.

**Packs** are outside `R(t)` and the guards, under a technical limit of 200 000 credits per rolling hour (held +
settled) against a stolen session (`release.packCreditsPerHour`).

**Upgrade** joins the running period: `t₀` is unchanged and B becomes the new tier's; Paddle prorates the payment
and only the proportional difference is granted (`bid_upgrade_grant`), so the lot total caps what `R(t)` can unlock.
**Downgrade** applies at the next period; paid lots stay until their own expiry (carried).

**Migration.** Lots that existed before V3 have no period and count as fully released (carried). `usage_windows`
remains for history only; the 5 h session, the anchored week and Boost are no longer enforced (`bid_boost` answers
`boost_unavailable`).

**Sites are entitlements.** `site.day` costs 0 credits; the daily pass (`bid_site_burn`) only renews paid monitoring
extras. Activating a site needs a free slot of the plan (`site_limit`), not credits.

Parameters (catalog `release`): `hours` 336, `guard24hShare` 0.25, `guard7dShare` 0.5, `packCreditsPerHour` 200 000.

## 4. Reserve → execute → settle / release

1. `bid_hold(user, action, credits, operation_id, …)`: idempotent by `operation_id`; checks suspension, site,
   ledger balance, then the V3 availability for this action and pins the reservation to lots in spend order
   (`credit_allocations`). Refusals:

   | code | reason | meaning |
   |---|---|---|
   | `quota_exhausted` | `exhausted` | not enough credits at all |
   | `credits_release` | `release` | included credits are not released yet |
   | `guard_24h` / `guard_7d` | `guard24h` / `guard7d` | a guard blocks a new task on included credits |
   | `pack_rate` | `packRate` | more than 200 000 pack credits within an hour |

   Every refusal carries `readyAt` (also as `resetsAt` for older clients) and the full availability (`credits`).
   Technical actions with `p_counts_window = false` (rollback, monitoring extras) follow the spend order but not the
   release curve, guards or pack rate.
2. The task runs. `bid_settle` consumes the pinned lots first, then (an underestimate) the rest in spend order without
   the release limits — started work is always recorded; a shortfall becomes debt. Each take writes `credit_spends`
   (kind at that moment), which feeds the guards.
3. `bid_release` returns an unused reservation; abandoned holds expire after their TTL (`credits.holdTtlMinutes`:
   AI and checks 15 min, deploys and backups 25 min).

Rounding: release down (`floor`), charges up (`ceil`) per operation; amounts are whole credits.

## 5. `billing usage` — contract v3

Request `{action: "usage", v: 3}` (the engine does). `v: 2` returns the same report labelled v2; no `v` → v1 shape.
v3 is a superset of v2, so older decoders keep working.

| Field | Meaning |
|---|---|
| `included` | `{tokens (= B, v2 field), budget, released, spent, held, left, free, availableNow, periodStart, periodEnd, releaseEndsAt}` |
| `guards` | `{last24h, cap24h, last7d, cap7d, clears24hAt, clears7dAt}` |
| `reason` | `ok` · `release` · `guard24h` · `guard7d` · `exhausted` (for the included budget) |
| `available` | `{now, total}` — spendable now (all kinds, after release, guards and pack rate) / in lots |
| `carried` | lots with `remaining`, `available`, `grantedAt`, `expiresAt` |
| `bonus` | `{credits, remaining, expiresAt, claimed, appliesTo}` |
| `packs` | pack lots with `remaining`, `expiresAt`; `packRate {lastHour, capPerHour}` |
| `cloudMinutes` | `{included, used: null, tracked: false}` — the entitlement; runner minutes are not metered yet |
| `sites` | `{active, paused, limit, max, fairUse, items}` |
| `session` / `weekly` | v2 compatibility: the 24 h and 7-day guard meters (`windowHours` 24 / 168) |
| `period`, `used`, `reserved`, `remaining`, `purchased`, `grants`, `byAction`, `daily`, `byModel`, `nudge`, `limits`, `pricing`, `history` | as in v2; `pricing.spendOrder` = `bonus, carried, included, packs` |

**When can a task start?** `{action: "estimate", credits: N, usageAction?}` → `bid_v13_ready_at` →
`{need, availableNow, readyAt, reason, nextPeriodAt?}`; `readyAt` is null when the current period cannot cover it
(`exhausted`, next period at `nextPeriodAt`). An action quote (`{action: "estimate", usageAction}`) also carries
`readyAt`. CLI: `bid billing estimate --credits 37000 --usage-action ai.fix`.

**Starter bonus.** `{action: "bonus"}` → `bid_v13_claim_bonus` (e-mail hash, account, Paddle customer; the claim
survives account deletion like `trial_claims`) → `bonus_used` when already claimed. CLI: `bid billing bonus`.

## 6. Ledger and lots

`credit_ledger` stays the compatibility balance (`delta`, `bucket plan | topup | hold`, `reason`, `ref`); every lot is a
`credit_grants` row (`credits`, `left_credits`, `removed_credits`, `expires_at`, and for V3 periods `period_start`,
`period_end`, `budget`). Grant sources: `plan_grant`, `upgrade_grant`, `trial_grant`, `free_grant`, `bonus_grant`,
`topup`, `admin_grant`. Idempotency: one lot per `(user, ref, source)`; one settlement per `operation_id`.
Refunds take back what is left of the refunded line's lots (spent → debt), chargebacks suspend entitlements — both
unchanged from V12 (`bid_refund`, `bid_v12_apply_adjustment`).

## 7. Periods and entitlements

| Plan | Period / `t₀` | Included B |
|---|---|---|
| Paddle monthly | each payment (`bid_record_payment` → `bid_accrue_periods`) | `settings.plans[tier].tokens` |
| Paddle yearly | 12 monthly slices from `period_start`, granted even while the Mac is closed (`bid_scheduler_credits`) | same, per slice |
| Upgrade | joins the running period, B = new tier | proportional difference granted |
| Trial | 7 days | catalog `trial.tokens`, released at once |
| Free | monthly from sign-up, granted lazily while there is no paid/trial entitlement (`bid_v13_accrue_free`) | `settings.plans.free.tokens` (10 000) |

Cancellation keeps the plan until the end of the paid period; credits stay until expiry; sites and data are never
deleted. Past due: 7 days from the first failed payment, then Free.

## 8. Retention and rate limits

Unchanged from V12: `bid_prune` retention, `bid_rate_hit` per-user limits (`_shared/ratelimit.ts`; `billing.bonus`
5 per minute, like checkout). `credit_spends` is kept while the account exists (money).

## 9. Not built (honest list)

- Cloud minutes are an entitlement in the catalog and the usage report; the runner does not meter minutes yet.
- Netlify tiers are shown as the recommended / included tier; provisioning or paying Netlify for customers needs the
  Netlify agreement (§11.2, §11.8) — `features.hostingIncluded` stays off until then.
- The domain included with yearly hosting-included plans is a catalog flag (`yearly.domain`); the domain workflow
  still follows `features.knightDomain` (Knight).
- Pack expiry after 12 months is enforced lazily (lots expire on the next read), not by a separate job.
- No live Paddle sandbox run from this environment; flows are covered by Deno tests against a fake Paddle and by the
  SQL tests on PGlite.
