# Research: Netlify (credit pricing, teams, transfer, API) + Spaceship domains + alternatives

Research date: 2026-10-01.

## Method and how much to trust it (read first)

- Direct page fetches were **blocked by the egress proxy** for netlify.com, docs.netlify.com, vercel.com, cloudflare.com, spaceship.com, docs.spaceship.dev and tld-list.com. All `WebFetch` and `curl` attempts returned EGRESS_BLOCKED or 000.
- Most facts below therefore come from **web-search result extracts of the official pages**. The search tool returns a summary of the page, not the page itself, so I could not see page "last updated" stamps. Where a page carries a date in its URL or title (changelog entries), I give that date. Everything else is marked "(search extract, seen 2026-10-01)".
- These were verified from **primary source files**:
  - Netlify's public OpenAPI spec (`raw.githubusercontent.com/netlify/open-api/master/swagger.yml`, `info.version: 2.60.0`; npm `@netlify/open-api` latest 2.60.0, published 2026-09-25).
  - A community Spaceship API client's source code (`github.com/bartwaardenburg/spaceship-mcp`, last commit 2026-03-06).
- Anything marked **UNVERIFIED** could not be confirmed from an official source. Before you rely on a number for billing, re-check it by hand on the live pricing page.

---

## 1. Netlify plans (credit-based)

### 1.1 Plan table

| Plan | Price | Credits / month | Members | When credits run out | Monthly credits roll over? | Extra credits |
|---|---|---|---|---|---|---|
| **Free** | $0 | 300 (hard limit) | 1 (Owner only) | **All projects pause** ("Site not available") until the next cycle. You cannot buy credits or use auto-recharge; the only fix is to upgrade. | No | None |
| **Personal** | $9/mo | 1,000 | 1 (Owner only; you cannot add seats) | Projects pause, unless auto-recharge is on or you buy a pack | No | Pack / auto-recharge: **500 credits for $5** |
| **Pro** (base) | $20/mo flat, **unlimited members** (since 2026-04-14) | 3,000 | Unlimited Owners, Developers, Git Contributors, Reviewers and Billing Admins | Same as Personal | **No** on the 3,000 tier | Pack / auto-recharge: **1,500 credits for $10** |
| Pro 5k tier | $33/mo | 5,000 | unlimited | same | Yes, for 1 extra billing cycle | same |
| Pro 10k tier | $63/mo | 10,000 | unlimited | same | Yes, for 1 extra cycle | same |
| Pro 15k tier | $95/mo | 15,000 | unlimited | same | Yes, for 1 extra cycle | same |
| Pro 20k tier | $126/mo | 20,000 | unlimited | same | Yes, for 1 extra cycle | same |
| **Enterprise** | Custom (contract) | Custom | Custom | Contract-defined; there is a separate doc "How credits work for enterprise plans" | — | — |

Sources:
- Free / Personal / Pro prices and credits, Free pauses, Free cannot buy credits or auto-recharge:
  - https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/ (search extract)
  - https://docs.netlify.com/manage/accounts-and-billing/billing/resume-paused-projects/ (search extract)
  - https://www.netlify.com/pricing/personal-vs-free/ (search extract)
- Pro flat $20 with unlimited seats:
  - **Changelog 2026-04-14** https://www.netlify.com/changelog/2026-04-14-pricing-updates-april-2026/
  - https://www.netlify.com/blog/pricing-netlify-for-3-billion-builders/
- Pro credit tiers and rollover (rolled-over credits last one extra billing cycle; the 3,000 tier has no rollover; upgrading takes effect immediately and resets the cycle; downgrading takes effect at the end of the cycle):
  - **Changelog 2026-07-14** https://www.netlify.com/changelog/2026-07-14-pro-plan-credit-tiers/
  - https://www.netlify.com/blog/new-pro-plan-tiers/
- Pack prices (500/$5 and 1,500/$10), effective **2025-10-01**. Before that they were 200/$5 and 1,000/$20, and the Pro base allotment was 5,000 before it dropped to 3,000:
  - https://www.netlify.com/changelog/updates-credit-based-personal-and-pro-plans/
- Free and Personal have one member only:
  - https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/ (search extract)
- Enterprise:
  - https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work-for-enterprise-plans/ (exists; contents UNVERIFIED)

### 1.2 Credit packs and auto-recharge

- **Purchased credits** (packs or auto-recharge) **have no set expiry and roll over** from month to month. Monthly plan credits do not roll over, except on Pro tiers of 5,000 credits or more. Sources:
  - https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/buy-credit-packs/
  - https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ (search extracts)
- **Auto-recharge**:
  - It is off by default.
  - Only a Team Owner can turn it on, and it applies to **all projects on the team**. You cannot set it per project.
  - When the balance hits 0 it buys small increments: 500/$5 on Personal, 1,500/$10 on Pro.
  - It is only available on Personal and Pro, not Free.
  - Setting: Usage & billing > Credit balance > Configure auto recharge.
  - Source: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/configure-auto-recharge/ (search extract)
- **Can auto-recharge be capped?** Netlify's docs say the spend control is the on/off switch: "Auto recharge is turned off by default so you just need to keep it off" (https://www.netlify.com/pricing/faq/, search extract). I found **no documented monthly dollar or credit cap for auto-recharge**, so a cap is UNVERIFIED and probably does not exist.
- **Usage alerts**: email and in-app alerts at 50%, 75%, 90% and 100% of the monthly allotment. Source: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/monitor-usage-for-credit-based-plans/ (search extract)
- **2026 changes affecting Free**:
  - Since **2026-08-19**, new public projects on Free show a **"Powered by Netlify" badge** by default. Visitors can hide it, and per the docs the owner can toggle it under Project configuration > General.
  - Private projects and agent runs require a Credit plan.
  - Sources:
    - https://www.netlify.com/changelog/2026-08-19-pre-launch-toolbar-and-powered-by-netlify-badge/
    - https://docs.netlify.com/manage/projects/powered-by-netlify-badge/
  - UNVERIFIED: whether the toggle is actually allowed for Free-plan projects or only on paid plans. The docs extract says it is "on by default" for Free and "off by default" on paid plans.
- **Known reliability issue (forum reports, 2026)**: several Free-plan teams stayed paused, or had production deploys blocked by a stale "credit usage exceeded" flag, after their credits reset. Examples:
  - https://answers.netlify.com/t/free-plan-credits-reset-but-team-is-still-paused/170332
  - https://answers.netlify.com/t/free-plan-production-deploys-blocked-by-stale-credit-usage-exceeded-flag-credits-show-300-300-unused/170026

## 2. Credit consumption rates (current since 2026-04-14)

| Meter | Rate | Note |
|---|---|---|
| Production deploy | **15 credits / successful deploy** | |
| Deploy Preview / branch deploy | **0 (free)** | |
| Bandwidth | **20 credits / GB** | Was 10 before 2026-04-14 |
| Web requests | **2 credits / 10,000 requests** | Was 3. Counts **all** requests, including static HTML, CSS, JS and images. Edge Functions are billed through this meter. |
| Compute (serverless, background, scheduled functions) | **10 credits / GB-hour** | Was 5. Edge functions do not count here. |
| Form submissions | **0 (free, unlimited)** | Was 1 credit each |
| AI inference (AI Gateway, Agent Runners) | **180 credits / USD of model usage** | |

Sources:
- Changelog **2026-04-14**: https://www.netlify.com/changelog/2026-04-14-pricing-updates-april-2026/
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ (search extract)

Not covered: separate meters for Blobs, Image CDN and Netlify DB. They were not visible in the extracts (Netlify DB has its own billing page: https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/). UNVERIFIED.

### 2.1 Worked example: small static business site (no functions)

My assumptions, not Netlify's figures:
- each visit makes about 25–30 requests and transfers about 1–1.5 MB;
- no CDN or browser cache savings;
- no functions;
- deploys count only if they go to production.

| Scenario | Bandwidth | Requests | Prod deploys | Credits total | Fits plan |
|---|---|---|---|---|---|
| Low: 2k visits, 1 MB, 25 req, 10 deploys | 2 GB → 40 | 50k → 10 | 10 → 150 | **~200** | Free (300) |
| Mid: 5k visits, 1.5 MB, 30 req, 20 deploys | 7.5 GB → 150 | 150k → 30 | 20 → 300 | **~480** | Over Free → Personal (1,000) |
| High: 20k visits, 1.5 MB, 30 req, 30 deploys | 30 GB → 600 | 600k → 120 | 30 → 450 | **~1,170** | Personal + 1 pack ($9 + $5 = $14), or Pro $20 (3,000) |

What this shows:
- **Production deploys are the biggest cost for small sites**: 15 credits each, so 20 deploys use the whole Free allowance.
- Bandwidth is second. Image weight drives it most.
- Ways to cut cost:
  - batch your changes into fewer production deploys;
  - review in Deploy Previews, which are free;
  - compress images.

## 3. Teams

- **A user can own multiple teams, but only one Free team.**
  - Netlify on Bluesky: "Your user can own multiple teams… You may only have one team on the Free OR Starter plan": https://bsky.app/profile/netlify.com/post/3latlashnk324
  - Forum: https://answers.netlify.com/t/free-tier-users-cant-make-more-than-1-team/70372
  - Both predate credit plans. Whether "one Free team per user" still applies under credit plans, and whether Personal is limited the same way, is **UNVERIFIED** (likely yes for Free).
- **Billing is per team.** The credit balance lives at the team level: team dashboard > Usage & billing > Credit balance. Source: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
- **Credits are shared by every project in a team.** "All your projects share the same monthly credit allotment on a Netlify team." Auto-recharge is team-wide and cannot be set per project. **Confirmed: a separate project in a shared team does NOT get a separate balance.** If one project exhausts the credits, every project on that team pauses. Sources: the how-credits-work and configure-auto-recharge docs above (search extract).
- Free and Personal teams have 1 member only. Pro has unlimited members at no extra cost (since 2026-04-14).

## 4. Third-party payment, agencies, resale

- **Paying for or sponsoring another user's team credits.** There is no documented "sponsor" or "gift credits" feature. The supported routes are:
  - (a) the agency is an Owner or Billing Admin of the client's team and pays with its own card on that team, or
  - (b) the agency owns the team and transfers the projects to the client later.
  - Netlify's agency guide recommends that **clients own billing** to avoid surprises and simplify handoff: https://www.netlify.com/blog/2021/07/19/the-agency-partners-guide-to-managing-client-projects-with-netlify/ (2021)
  - Billing details are set per team, not per site: https://answers.netlify.com/t/can-you-specify-billing-information-on-a-site-by-site-basis/24610
  - No API for buying credits: UNVERIFIED. There is none in the OpenAPI v2.60.0 spec, which only has `/billing/payment_methods`.
- **Partner program** (https://www.netlify.com/partners/, search extract):
  - Ecosystem Partners get 20% revenue share for up to 12 months on eligible self-serve new business.
  - Certified Partners get 20% for up to 24 months on self-serve and eligible enterprise revenue. Requirements: 3+ new Pro customers or 1+ Enterprise customer per year, plus training.
  - Partner Program Agreement: https://www.netlify.com/partners/program-agreement/
  - Reselling "on Partner's own paper" requires a separate **Reseller Addendum**, approved at Netlify's sole discretion.
  - There is an agency directory: https://www.netlify.com/agency-directory/
  - No white-label offering was found (UNVERIFIED that none exists).
- **Terms of service**:
  - Self-Serve Subscription Agreement (Oct 2025 PDF: https://www.netlify.com/pdf/self-serve-subscription-agreement.pdf/; page: https://www.netlify.com/legal/self-serve-subscription-agreement/): "except as otherwise agreed by Netlify in a separate written agreement, Customer will not resell or license the Services to third parties". Access is "non-transferable and non-sublicensable".
  - Acceptable Use Policy (https://www.netlify.com/legal/acceptable-use-policy/): you may not "misrepresent authorization to act on behalf of others".
  - Netlify staff on the forum: you may charge clients for building and maintaining sites, but not resell the hosting itself on Free (https://answers.netlify.com/t/can-we-use-netlify-free-plan-for-commercial-purposes/41545). The "$45/mo" figure in that thread is from the legacy plan era and is outdated.
  - Commercial use **is allowed on Free** (https://www.netlify.com/blog/introducing-netlify-free-plan/, search extract).
- **OAuth apps acting for users**:
  - The API uses OAuth2. There is an `/oauth/tickets` flow for apps to get a user token. Source: OpenAPI v2.60.0 swagger.yml, `securityDefinitions: oauth2` and `/oauth/tickets`.
  - Guide: https://developers.netlify.com/guides/generating-personal-access-tokens-with-netlify-oauth/
  - An app with a user's token can manage that user's sites, members (`/{account_slug}/members`), env vars and DNS zones.

## 5. Transferring a project (site) between teams

Source: https://docs.netlify.com/manage/projects/transfer-project/ (search extract).

**Who can transfer**
- A Team Owner can transfer if team transfers are allowed and they are also an Owner or Developer on the destination team.
- If no person has those roles on both teams, contact support.
- Teams can block outgoing transfers.

**How**
- Project configuration > General > Project information > Transfer project.

**Consequences**
- Project members who are not on the destination team lose dashboard access.
- If the destination plan is lower, settings for features that plan lacks are lost.
- Sites linked to GitHub Enterprise Server or GitLab self-managed need support, as do legacy "Global" CDN sites.

**DNS zones and Netlify-registered domains do not move automatically.** They are transferred separately from the team DNS page (Collaboration > Transfer ownership) to a team where you are Owner or Developer. Sources:
- https://docs.netlify.com/manage/domains/manage-domains/transfer-a-domain/
- API: `PUT /dns_zones/{zone_id}/transfer` with `account_id`, `transfer_account_id` and `transfer_user_id` (OpenAPI v2.60.0)

**What moves with the project**

| Item | Moves with project? | Evidence |
|---|---|---|
| Deploy history and site settings | Yes, probably: the project object itself moves | UNVERIFIED in an official doc (search summary only) |
| Site-scoped env vars | Probably yes | UNVERIFIED. **Team-level shared env vars** (`/accounts/{id}/env`) belong to the old team and will not follow. |
| Forms and submissions | Probably yes | UNVERIFIED |
| Functions code / config | Yes: deployed with the project | UNVERIFIED |
| Build hooks | Probably yes, since they are site-scoped (`/sites/{id}/build_hooks`) | UNVERIFIED |
| Custom domain on the site | Stays attached to the site | UNVERIFIED |
| Netlify DNS zone | **Separate transfer** | transfer-a-domain doc and the API |
| Netlify-registered domain | Separate transfer, together with the DNS zone | same |
| GitHub repo link | Usually kept. The Netlify GitHub App must have access to the repo in the new owner's context. GHE/GitLab self-managed need support. | transfer doc (search extract); GitHub App detail UNVERIFIED |

Recommendation: test-transfer a throwaway site first.

## 6. Usage data via API

- **The public OpenAPI (v2.60.0, published 2026-09-25) has no documented credits or usage endpoint.**
  - There is no `/usage`, no credit balance and no per-site credit breakdown.
  - The only usage-like object is `accountMembership.capabilities.{sites,collaborators}` = `{included, used}`, returned by `GET /accounts` and `GET /accounts/{account_id}`.
  - `PUT /sites/{id}/enable` notes that sites "disabled for usage exceeded" cannot be re-enabled through the API.
- Forum posts show an undocumented UI endpoint returning `balance` (sometimes `null`) and mention `capabilities.credits` on the account object: https://answers.netlify.com/t/billing-page-stuck-on-loading-for-plan-credit-balance-api-returns-balance-null-team-sjsinghneuro/170239. This is **UNVERIFIED, undocumented and may change**. Netlify staff have historically suggested copying the UI's API calls from browser devtools: https://answers.netlify.com/t/support-guide-understanding-and-using-netlifys-api/160
- **In the UI**, Usage & billing > Account usage insights shows a daily breakdown chart: project counts, bandwidth, web requests, members, AI inference and credits. Source: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/monitor-usage-for-credit-based-plans/
  - Per-project breakdown in the UI: UNVERIFIED.
  - Data freshness and latency: **UNVERIFIED**. Granularity appears to be daily.
- **Billing or usage webhooks**: none documented. Outgoing hooks (`/hooks`, `/hooks/types`) cover deploy, form and similar events, not credits.
  - Usage notifications go by email and in-app at 50/75/90/100%.
  - Pro teams can get usage notifications in Slack (https://docs.netlify.com/extend/install-and-use/setup-guides/netlify-app-for-slack/), though the extract describes the legacy meters.
  - A credit-threshold webhook is UNVERIFIED and probably does not exist.

## 7. Domains in Netlify

- Netlify sells domains but **is not a registrar**: it resells through **name.com**. Source: https://docs.netlify.com/manage/domains/configure-domains/register-and-buy-a-domain/ (search extract).
- Registrations last one year and auto-renew on the team's card by default; you can turn that off. Renewal can cost much more than the first year.
- Price examples are only forum reports: .com $10.99 for the first year and $14.99 for the second (https://answers.netlify.com/t/new-com-domain-on-netlify/21213, 2020-era). Staff have said Netlify adds a ~$2 markup over name.com. Current prices are **UNVERIFIED**.
- **You can transfer out** to another registrar after the 60-day lock, but **you cannot transfer a domain in to Netlify**. Getting the EPP/auth code has often required contacting support:
  - https://answers.netlify.com/t/support-guide-how-do-i-transfer-my-domain-name-to-or-away-from-netlify/186
  - https://answers.netlify.com/t/how-do-i-change-nameservers-or-get-an-epp-transfer-code-for-a-domain-registered-through-netlify/163007
- TLD support was expanded on 2025-11-13 (.be, .pl, .dk, .co.uk, .place): https://www.netlify.com/changelog/2025-11-13-expanded-domain-tld-support/
  - **.eu is reported unsupported** for registration and Netlify DNS (search extract).
  - .bg: UNVERIFIED, but likely unsupported.
  - You can still point external .eu/.bg domains at Netlify sites with your own DNS.

## 8. Alternatives for small static sites (brief)

| | Cloudflare Pages | Vercel Hobby |
|---|---|---|
| Price | Free | Free |
| Bandwidth / static requests | **Unmetered** static bandwidth and requests | 100 GB Fast Data Transfer, 10 GB Fast Origin Transfer per month |
| Builds | 500 builds/month per account, 1 concurrent | (limits page) |
| Projects | Soft limit (forum: 20; extra new projects throttled in the first 48h) | — |
| Files | 20,000 files/site, 25 MiB max per file | — |
| Custom domains | 100 per project (Free) | yes |
| Functions | Share the Workers Free quota: 100k requests/day, 10 ms CPU | — |
| Over limit | Static keeps serving | **Paused**, or you wait 30 days |
| Commercial use | Yes. No non-commercial clause found (UNVERIFIED wording). | **No: Hobby is "non-commercial, personal use only"** |
| Note | Cloudflare now positions **Workers Static Assets** as the successor to Pages for new projects (third-party 2026 articles) | Pro is needed for any business site |

Sources:
- Cloudflare limits: https://developers.cloudflare.com/pages/platform/limits/ (search extract)
- Cloudflare community thread: https://community.cloudflare.com/t/cloudflare-pages-limits-free-plan/431961
- Workers static assets, third-party only: https://temps.sh/blog/cloudflare-pages-free-tier-limits-2026
- Vercel: https://vercel.com/docs/plans/hobby and https://vercel.com/docs/limits/fair-use-guidelines (search extract)

---

## 9. Spaceship (spaceship.com, a Namecheap company)

### 9.1 API

- **Base URL**: `https://spaceship.dev/api/v1/`, authenticated with an API key and secret.
- **Docs**: https://docs.spaceship.dev/ (OpenAPI 3.0; roughly 40 operations per apis.io: https://apis.io/providers/spaceship/).
- **Endpoints** (verified in the community client source: `spaceship-mcp/src/spaceship-client.ts`, commit 2026-03-06):

| Area | Endpoints |
|---|---|
| Domains | `GET /domains`; `GET/POST /domains/{domain}` (POST = **register**: async 202 with `spaceship-async-operationid` header); `POST /domains/{d}/renew`; `POST /domains/{d}/restore`; `POST/GET /domains/{d}/transfer` (transfer-in / status) |
| Availability | `GET /domains/{d}/available`; `POST /domains/available` (bulk) |
| Transfer-out | `PUT /domains/{d}/transfer/lock`; `GET /domains/{d}/transfer/auth-code` |
| Settings | `/domains/{d}/nameservers`, `/autorenew`, `/privacy/preference`, `/privacy/email-protection-preference`, `/contacts` |
| Contacts | `/contacts`, `/contacts/attributes` |
| Other | `/dns/records/{d}`, `/async-operations/{id}`, `/sellerhub/*` |

- **Registration body**:
  - `years` (1–10)
  - `autoRenew`
  - `privacyProtection: {level: "high"|"public", userConsent: true}`
  - `contacts` (registrant, admin, tech and billing contact IDs created with `/contacts`)
- **API key scopes**: `domains:read`, `domains:write`, `domains:billing` (needed to register, renew or transfer, which charges the account balance or card), `domains:transfer`, `contacts:*`, `dnsrecords:*`, `asyncoperations:read`.
- **Rate limit for registration**: 30 requests per user per 30 s (docs.spaceship.dev, search extract).
- **Premium detection**: the availability response includes `result: "available"|"taken"`, plus an `isPremium` flag and a `premiumPricing[]` array of `{operation/duration, price/registerPrice, renewPrice, currency}`. Sources: docs.spaceship.dev sample in a search extract; `spaceship-mcp/src/types.ts`. **You can detect premium domains through the API.**
  - **Standard (non-premium) TLD price list endpoint: none found (UNVERIFIED).** A WHMCS module claims "TLD pricing sync" (https://github.com/bigbang-its/whmcs-spaceship-registrar), but its source endpoint is UNVERIFIED.
- Official integrations also exist: a Spaceship MCP (https://www.spaceship.com/knowledgebase/spaceship-mcp/) and a Terraform provider `namecheap/spaceship` (https://registry.terraform.io/providers/namecheap/spaceship/latest/docs).

### 9.2 Pricing (USD, third-party aggregators, Oct 2026; spaceship.com itself not fetchable)

| TLD | Register | Renew | Source |
|---|---|---|---|
| .com | $9.08 standard (promo codes ~$2.90–3.80, first year, one per customer) | **$10.18** (another site says $9.98) | domainoffer.net/tld/com/spaceship (Oct 2026); digitalhosting.com/providers/spaceship |
| .net | $11.40 | $11.40 | tld-list.com/registrars/spaceship (Oct 2026) via search |
| .org | $6.85 | $11.59 | same |
| .eu | $5.68 | $5.68 | same |
| .bg | **UNVERIFIED: no evidence Spaceship offers .bg.** No search hit; .bg has local-presence rules (EU entities or a Bulgarian branch) per Register.BG and resellers (https://www.icdsoft.com/en/reseller-docs/bg-domains). Assume **not supported** and use a .bg-accredited registrar (e.g. ICDSoft, SuperHosting.BG, EuroDNS, Netim). | | |

- Prices add the ICANN fee of $0.20 per year for gTLDs (domainoffer.net).
- Verify on https://www.spaceship.com/domains/ before quoting.

### 9.3 WHOIS privacy, transfer-out, registrant

- **WHOIS privacy**: free for life on eligible TLDs, provided by "Withheld for Privacy". It can be set through the API (`privacyLevel high|public`). Not all ccTLDs are eligible. Sources:
  - https://www.spaceship.com/legal/whois-privacy-service-agreement/
  - domainoffer.net
- **Transfer-out**:
  - Unlock the domain and get the EPP auth code in the dashboard or with `GET /transfer/auth-code`.
  - **No transfer to another registrar for 60 days** after initial registration or a transfer-in, per the Domain Registration Agreement: https://www.spaceship.com/legal/domain-registration-agreement/
  - ICANN Transfer Policy applies.
  - Spaceship also supports **account-to-account (internal) transfers** in the Domain Manager, with no auth code: https://www.spaceship.com/blog/domain-updates/ and https://www.namepros.com/threads/can-you-push-domains-at-spaceship.1315542/. An API endpoint for internal pushes is UNVERIFIED.
- **Registering in the customer's name** (Domain Registration Agreement, search extract): when you register "on behalf of a third party", you represent that:
  - you are authorized to act as their agent,
  - you have given them notice, and
  - you have their express consent to the disclosure and use of their data.
  - Separately, if you license a domain registered to you to a third party, **you remain the registrant of record** and stay responsible.
  - **So: register with the customer as the registrant contact** (their name and email through `/contacts`), with documented consent. The account holder (payer) can be you. This matches ICANN's rules on accurate registrant data and the transfer-policy concept of the "Registered Name Holder". The ICANN Registration Data Policy text was not fetched (UNVERIFIED wording).
- **Reseller program**:
  - **No formal Spaceship reseller program found (UNVERIFIED).**
  - Third-party WHMCS registrar modules use the normal customer API:
    - https://marketplace.whmcs.com/product/8259-spaceship-whmcs-registrar-module
    - https://github.com/bigbang-its/whmcs-spaceship-registrar
  - Namecheap (Spaceship's parent) has its own reseller API, which is a separate product.
  - Using a single Spaceship account to register client domains is technically possible through the API. You must list the client as registrant, and all domains then sit in your account until you push them to the client's account.
