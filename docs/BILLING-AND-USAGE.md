> V12: плановете, кредитите и цените от V1 в този документ са заменени от [одобрения модел V2](PLANS-AND-CREDITS-V2-BG.md), §17.2. Актуалният каталог е `supabase/functions/_shared/plans-catalog.json`.

# Billing and usage — ledger, tariffs, periods, entitlements, retries, reconciliation (V11 RC)

One source of truth for AI credits: `public.credit_ledger` in the cloud. The app shows what the cloud returns
(`billing usage`), never a client-side estimate; the engine keeps a local cost journal only for the owner's own
providers (Netlify, own AI keys) and marks it as such.

## 1. Units (revised 2026-09-30 — docs/PLANS-AND-CREDITS-BG.md)

| Unit | Where it appears | Never mixed with |
|---|---|---|
| **credits** | plan grants, packs, holds, charges; every number on "Plan & usage" (the ledger column is still named `tokens` / `charged_tokens` for compatibility) | money, model tokens |
| **money** (EUR in the catalog) | plan and pack prices in the catalog / checkout; proration and tax from Paddle's checkout; the owner's cost per credit (`ai.creditEur`) | credits |
| **model tokens** (input / output) | `ai_usage.input_tokens / output_tokens`; the charge is `ceil(model cost in EUR / credit value of the plan)` (`creditsFor` in `ai-fix`) | — |

A credit is a money-backed unit: Flash 100 000 credits = 2.49 € of model cost, High 250 000 = 7.50 €, Knight
1 000 000 = 30 €. Because the charge follows the model's real price, the plan's credits can never cost the
owner more than that cap, whatever model or answer length. Plans: Flash 9.99 €, High 29.99 €, Knight 99.99 €
a month (yearly = 10 months); packs 100k / 500k / 1M credits at 3.99 / 17.99 / 33.99 €; trial 7 days of High
with 50 000 credits. The rolling **session** (5 h, 20 % of the monthly credits, code `session_cap`) replaces
the daily cap.

## 2. Ledger (`credit_ledger`)

`id, user_id, delta (bigint, + grant / − charge), bucket (plan | topup | hold), reason, ref, pricing_version, created_at`.
Rows are immutable: corrections are compensating rows (`refund`, `expiry`, `admin_grant`), never updates or
deletes — with two deliberate exceptions: a **hold** row is deleted when the request it belongs to settles or is
released (it is a reservation, not a fact), and account deletion cascades.

| reason | bucket | ref | once per (user, ref, reason)? |
|---|---|---|---|
| `plan_grant` | plan | `<subscription>:m<k>` (month k of a yearly plan, m0 = payment) | yes (`credit_ledger_once`) |
| `trial_grant` | plan | `trial:<subscription id>` | yes |
| `topup` | topup | `<transaction>` or `<transaction>:<price id>` | yes |
| `hold` | hold | `<ai_usage.id>` | one live hold per request |
| `ai_fix` | plan / topup | `<ai_usage.id>` | one settle per request (settle is idempotent in code) |
| `refund` | topup / plan | `<adjustment id>` | yes |
| `expiry` | plan | `<ref of the grant that replaced it>` / `expired:<subscription>` | yes |
| `admin_grant` | topup | admin audit id | — |

Balances are computed in Postgres (`credit_balance`, `credit_bucket_balance` views, RLS-filtered), never by
paging rows in a function (audit C8).

**Spend order**: plan tokens first, then packs (`ai-fix` settle). **Expiry**: plan tokens expire when the next
period's grant arrives or the subscription ends (`grantPlanTokens`, `expireDue`); packs last 12 months
(policy in the catalog text; enforcement of the 12-month expiry is a scheduled job that is NOT built yet —
see §8). **Upgrade**: the new plan's grant replaces the remainder of the old period's plan tokens (the
`expiry` row), packs are untouched.

## 3. Reserve → execute → settle / release (`ai-fix`)

1. `reconcileHolds`: holds of requests older than 15 min that never settled are deleted and their usage row
   marked `orphaned` (crashed function, lost client). Runs at the start of every request and of every usage
   read, so an abandoned request cannot block credits.
2. `operationId` (client-generated, `[A-Za-z0-9_-]{8,64}`): an existing completed row → `409 duplicate_operation`
   with the recorded outcome; a pending row → `409 operation_in_progress`. One logical operation bills once.
3. Insert `ai_usage` (`status: pending`, `operation_id`, `pricing_version`) and the **hold** (`−estimate`), then
   check rate limits, the daily cap and the balance including other holds (reserve first, check after — audit
   C1). A refused request removes its hold and its usage row.
4. Stream the model. On the final token count (or an estimate from the text received when the stream broke),
   **settle**: delete the hold, update `ai_usage` (real tokens, cost, `status ok | truncated | refused | error`),
   insert the charge rows (`ai_fix`, plan then topup, with `pricing_version`). Settle is idempotent
   (`settled ??=`).
5. A cancelled stream still settles what was received (`status: truncated`) — the product policy is
   "you pay for what the model produced", shown as such in the history.
6. Crash between 3 and 4 → the hold stays until step 1 of the next request releases it (≤ 15 min).

Concurrency: two parallel requests each insert a hold before checking the balance, so the second one sees the
first's reservation (test "parallel requests see each other's reservations"). Negative balances are prevented
at reservation time; a race that slips through settles to a negative balance, which the next request refuses
(`quota_exhausted`) — the ledger never hides it.

## 4. Pricing version

`settings.pricing.version` (explicit, e.g. `2026-10`) or, when unset, `p-<sha256 prefix>` of
`{ai.prices, ai.multipliers, plans}`. Written on every `ai_usage` row and charge row; shown on Plan & usage.
Changing prices in the Admin panel therefore never rewrites history.

## 5. Periods and entitlements

| Plan | Period | Renewal | Included tokens |
|---|---|---|---|
| Paddle monthly | `subscriptions.period_start/end` from the webhook | `period_end` | `settings.plans[tier].tokens` at each `subscription.*` renewal event |
| Paddle yearly | payment month + 11 lazy monthly grants (`ensureMonthlyGrant`, ref `<sub>:m<k>`) | monthly, from `period_start` | same |
| Trial | 7 days (`trial_claims`, once per e-mail hash) | — | catalog `trial.tokens` |
| Free | calendar month (UTC), nothing renews | — | 0; bought packs still work (audit C9) |

`billing usage` returns `period {start, end, renewsAt, source: subscription | calendar}`; the app formats it in
the user's time zone. Entitlements (`features`) come from the profile's plan after `expireDue` — an ended trial
or subscription stops AI everywhere on the next call, not only on the billing screen.

Exhausted AI credits never block the project, its history, backups or recovery actions: they only return
`quota_exhausted` for AI calls.

## 6. Purchases and subscriptions (Paddle, hosted)

- **Checkout**: `billing checkout` → Paddle transaction with `custom_data.user_id` → hosted checkout URL. The
  client never states a price or a token amount; the backend maps `price_id` → plan / pack from the catalog.
- **A success redirect is not a payment.** Credits and entitlements change only on a verified webhook
  (`Paddle-Signature` HMAC over `ts:body`, 5-minute tolerance) or on `billing sync`, which reads the
  subscription back from Paddle (recovery after a missed webhook).
- **Webhooks** (`billing_events`): duplicate deliveries are claimed by `event_id` (primary key) and ignored;
  out-of-order events are ignored when older than the stored `event_at` (audit C5); a failed handler removes
  the claim so Paddle's retry runs it again. Covered: `subscription.created/updated/activated/past_due/
  canceled/paused/resumed`, `transaction.completed` (plan grant or pack), `adjustment.created/updated`
  (refund / chargeback → `refund` rows, once per adjustment).
- **Declined card / cancelled checkout**: no event → nothing changes; the app's "waiting for payment" poll
  ends after 3 minutes without a change.
- **Past due**: status carried, plan kept for the 3-day grace (`expireDue`), then expired → Free.
- **Upgrade / downgrade**: the app opens the customer portal (Paddle quotes proration and tax); the resulting
  `subscription.updated` carries the new price id → tier; the plan grant follows the next renewal event.
- **Manual plans** (`provider: manual`, granted by an admin) outlive Paddle events (audit C15).

`billing sync` is the explicit recovery path: for each Paddle subscription it fetches the current state and
writes status, period, cancellation, tier (from the item's price id) and the profile plan.

## 7. What the app shows (Plan & usage)

From `billing usage` only: plan + billing status; period + renewal (local time zone); included / used /
reserved / remaining plan tokens (bar + legend); purchased packs as a separate balance; available =
plan + packs − reserved; rate limits (per minute / hour, daily cap and today's spend); pricing version; the
last 50 operations (with status: done / in flight / abandoned / truncated / refused / error) and the last 50
ledger rows; buttons: Buy credits, Upgrade, Manage subscription (portal), Sync with provider, Refresh. The
assistant shows the estimate before a request and the real cost after; a compact pill shows available tokens.

## 7a. Retention and rate limits (WP03)

Retention runs inside the database: `bid_prune(p_batch)` (schema.sql) deletes at most `p_batch` rows per
table per call and is called by every scheduler run (`monitor` → `run`), so a backlog drains over a few
runs without a long lock; `tests/rls` proves it on real Postgres with 1500 rows.

| Data | Kept | Why |
|---|---|---|
| `monitor_probes` | 90 days | evidence behind incidents |
| `monitor_incidents` (resolved) | 90 days after resolution; open ones always | history in the app |
| `monitor_heartbeat` | 7 days | only "is the scheduler alive" is read |
| `rate_events` | 2 days | limits look back at most one hour |
| `ai_usage` | 13 months | the usage page shows the period; a year back for disputes |
| `admin_audit` | 24 months | who changed an account |
| `credit_ledger`, `subscriptions`, `billing_events` | while the account exists | money; deleted with the account (cascade / explicit) — Paddle as Merchant of Record keeps the tax records |
| `trial_claims` | always (hash only) | one trial per address |

Rate limits: `bid_rate_hit(user, action, limit, window)` counts and records under an advisory lock, so every
Edge Function instance shares the same numbers (`_shared/ratelimit.ts`): billing checkout / portal / sync 5
per minute, monitor test 10 per minute and register 120 per hour, account export 3 per hour, admin writes
60 per minute. A database without the function lets calls through and logs it; any other database error
refuses the call (`rate_limit_unavailable`). `ai-fix` keeps its per-plan limits (`settings.ai.rate`).

## 8. Not built (honest list)

- Pack expiry after 12 months is stated policy without an enforcing job (`expiry` rows for packs are never
  written automatically). Owner decision: keep as is, or add a scheduled function.
- No live Paddle sandbox run from this environment (no network to Paddle): the flows are covered by 80 Deno
  tests against a fake Paddle; the owner acceptance test walks the sandbox checkout end to end.
- Multi-currency: the catalog has one currency.
