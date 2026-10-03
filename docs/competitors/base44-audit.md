# Одит на Base44: функции и възможности

**Състояние:** предварителен, събран на 3 октомври 2026. Всички 316 функции са със статус **непотвърдено**: събрани са от публични източници (документация, блогове, форуми), но не са проверени една по една в самия продукт. Проверките бяха спрени заради разхода на кредити. Сайтовете на Base44 не бяха достъпни директно от нашата среда.

**Съдържание:** 135 области, 316 функции, 363 източника.

| Област | Функции |
|---|---|
| Integrations | 19 |
| Dashboard > Data | 14 |
| Security | 13 |
| Models | 12 |
| Credits | 11 |
| Preview and editing | 9 |
| Dashboard > Overview | 9 |
| Plans and pricing | 8 |
| Weaknesses (reviews) | 8 |
| Edit mode | 7 |
| Dashboard > App Users | 6 |
| Dashboard > Analytics | 6 |
| Chat composer | 5 |
| Dashboard > Settings > Authentication | 5 |
| Agents | 5 |
| Model picker | 4 |
| Chat messages | 4 |
| AI Controls | 4 |
| Code / CLI | 4 |
| Entities / database | 4 |
| Local development | 4 |
| Builder+ gating | 4 |
| Discounts and promos | 4 |
| Image generation | 3 |
| Chat modes | 3 |
| History and rollback | 3 |
| Comments | 3 |
| Workflows | 3 |
| Auth | 3 |
| Usage view | 3 |
| Earn credits | 3 |
| Auto routing | 2 |
| Agents models | 2 |
| SDK / runtime AI | 2 |
| Chat messages / history | 2 |
| Branches | 2 |
| Keyboard shortcuts | 2 |
| Domains | 2 |
| Code | 2 |
| Logs | 2 |
| API | 2 |
| Publish flow | 2 |
| Surfaces / mobile | 2 |
| Templates / use-case library | 2 |
| Publishing / code surfaces | 2 |
| Permissions / security | 2 |
| SDK | 2 |
| Developer platform | 2 |
| Billing | 2 |
| Changelog | 2 |
| Compare | 1 |
| Plan gating | 1 |
| History / routing policy | 1 |
| Chat composer / visual editing | 1 |
| Chat composer / models | 1 |
| Chat attachments / media | 1 |
| Chat history / versions | 1 |
| Chat messages / quality | 1 |
| Chat / troubleshooting | 1 |
| Preview errors / chat | 1 |
| Chat history / quality | 1 |
| Prompting help | 1 |
| Chat history / branches | 1 |
| Chat approvals | 1 |
| Testing / chat | 1 |
| Editor navigation | 1 |
| Mobile | 1 |
| Chat | 1 |
| Onboarding / chat | 1 |
| Chat messages / approvals | 1 |
| AI Controls / skills | 1 |
| Screenshots to chat | 1 |
| App Users | 1 |
| Dashboard > Overview / Settings | 1 |
| Dashboard > App Users / Security | 1 |
| Data / Chat | 1 |
| Dashboard > Analytics / API | 1 |
| Workspace / Dashboard | 1 |
| Marketing | 1 |
| Code / export | 1 |
| Code / version history | 1 |
| Code / branches | 1 |
| Code / deploy | 1 |
| Code / GitHub | 1 |
| Agents / channels | 1 |
| Agents / AI | 1 |
| Agents / Users | 1 |
| Agents (separate product surface) | 1 |
| Workflows / testing | 1 |
| Logs / Analytics | 1 |
| API / keys | 1 |
| API / Enterprise | 1 |
| API / Settings | 1 |
| Settings / workspace | 1 |
| Settings / Security | 1 |
| Settings | 1 |
| MCP | 1 |
| MCP / Integrations | 1 |
| MCP / developer tooling | 1 |
| Settings / deploy | 1 |
| Surfaces / hosting | 1 |
| Custom domains | 1 |
| Environments | 1 |
| Versions | 1 |
| Environments / versions | 1 |
| Versions / hosting | 1 |
| Publish flow / distribution | 1 |
| Mobile companion app | 1 |
| Onboarding | 1 |
| Templates | 1 |
| Surfaces / developer | 1 |
| Education / developer enablement | 1 |
| Education / support | 1 |
| Community / support | 1 |
| Education | 1 |
| Wix acquisition | 1 |
| Surfaces | 1 |
| Publish flow / automation | 1 |
| Backend functions | 1 |
| Backend / realtime | 1 |
| File storage | 1 |
| Email sending | 1 |
| Backend / AI integrations | 1 |
| Backend / AI | 1 |
| External connections | 1 |
| Auth / users | 1 |
| Scheduled tasks / automations | 1 |
| Backend / agents | 1 |
| Local development / developer platform | 1 |
| Logs / observability | 1 |
| Developer platform / analytics | 1 |
| External app connections / developer platform | 1 |
| External app connections | 1 |
| Developer changelog | 1 |
| Support | 1 |

## Integrations (19)

### Built-in integrations (integrations.Core)

Base44 ships a 'Core' package of pre-built server-side functions every app can call without configuration: InvokeLLM, GenerateImage, SendEmail, UploadFile, UploadPrivateFile, CreateFileSignedUrl, ExtractDataFromUploadedFile. Calls run on Base44's backend ('integrations provide pre-built functions that Base44 executes on your behalf'); if any parameter is a File the request is sent as multipart/form-data, otherwise JSON. Available from the frontend, from backend functions, and with elevated permissions via base44.asServiceRole.integrations.

- **Как се ползва:** In generated code the AI inserts calls such as `await base44.integrations.Core.InvokeLLM({...})`; in the builder chat you just ask for the capability (e.g. 'send a confirmation email'). External apps import `@base44/sdk` and call `base44.integrations.Core.<FunctionName>(params)`.
- **Ограничения / план:** 'Core integrations: Available on all plans'. Metered against the app's shared credit quota (AI calls) or per-email credits.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/javascript-sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/integrations.md

### InvokeLLM (LLM calls)

Single-shot text or structured-JSON generation. Parameters: `prompt` (required); `model` to override the app-level model for one call — allowed ids in SDK 0.8.52: gpt_5_mini, gemini_3_flash, gpt_5_4, gpt_5_6_sol, gpt_5_6_luna, gemini_3_1_pro, claude_sonnet_4_6, claude_opus_4_6, claude_opus_4_7, claude_opus_4_8, claude-sonnet-5; `add_context_from_internet` (uses Google Search, Maps and News for real-time context; default false); `response_json_schema` (returns an object instead of a string); `file_urls` (attach files previously uploaded with UploadFile; not to be combined with add_context_from_internet). Returns string | object. Docs stress it is 'a single call with no tools' — agent loops should use the AI Gateway instead.

- **Как се ползва:** `const r = await base44.integrations.Core.InvokeLLM({ prompt, response_json_schema: {...} })`. Ask the builder for 'AI summarisation / classification / extraction' and it wires this call.
- **Ограничения / план:** Billed to the app's credit quota; 'non-default models use more credits'. No tool calling, no streaming.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/integrations.md

### GenerateImage (image generation)

Creates PNG images from a text prompt, 'approximately 1024px on the shorter side'; `existing_image_urls` lets you edit an existing image or supply style references (unreadable images are skipped; if none can be read the request fails). Returns `{ url }`. Prompts violating the AI provider's content policy are refused. For model, aspect ratio, resolution or quality control the docs point to the AI Gateway image endpoints instead.

- **Как се ползва:** `const { url } = await base44.integrations.Core.GenerateImage({ prompt, existing_image_urls: [photoUrl] })`.
- **Ограничения / план:** Credits from the app quota; fixed ~1024px PNG output in the Core version.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/integrations.md

### SendEmail (email sending)

Sends an email with `to`, `subject`, `body` (plain text or HTML) and optional `from_name` (defaults to the app name). Official SDK doc: 'Send emails to registered users of your app' — the skills reference repeats 'Recipients must be registered users' and 'Every app gets this integration (no plan upgrade required)'.

- **Как се ползва:** `await base44.integrations.Core.SendEmail({ to, subject, body, from_name })`, typically from a backend function or an automation; ask the builder to 'email me every inquiry'.
- **Ограничения / план:** '1 credit per email (2 credits with custom domain)'. Recipients limited to registered app users. Sending from your own domain is implied by the 2-credit rule but the setup UI is not documented in reachable sources.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/integrations.md

### UploadFile (public file storage)

Uploads a File object to public storage and returns `{ file_url }`; the URL is accessible to anyone. Used as the first step before InvokeLLM file context or ExtractDataFromUploadedFile.

- **Как се ползва:** `const { file_url } = await base44.integrations.Core.UploadFile({ file })` from an `<input type=file>` handler.
- **Ограничения / план:** Public URL — no access control.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/integrations.md

### UploadPrivateFile + CreateFileSignedUrl (private files)

UploadPrivateFile stores a file in private storage and returns a `file_uri`; CreateFileSignedUrl turns that URI into a temporary `signed_url` valid for `expires_in` seconds (default 300 = 5 minutes).

- **Как се ползва:** `const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file }); const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri, expires_in: 3600 })`.
- **Ограничения / план:** Signed URL default lifetime 300 s.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/integrations.md

### ExtractDataFromUploadedFile (file extraction)

AI extraction of structured data from an uploaded file (PDF, image, etc.) according to a JSON schema; takes `file_url` (from UploadFile) and `json_schema`, returns the extracted object (e.g. invoice_number, total_amount).

- **Как се ползва:** Upload with UploadFile, then `await base44.integrations.Core.ExtractDataFromUploadedFile({ file_url, json_schema })`.
- **Ограничения / план:** Credits from the app quota.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/integrations.md

### AI Gateway (OpenAI-compatible endpoint, image generations/edits)

`base44.aiGateway.connection()` returns `{ baseURL, token, headers }` so any OpenAI-compatible client (openai SDK, Vercel AI SDK, Mastra) or `{ provider: 'typesafe' }` for TypeSafe AI can call Base44's managed models with no provider account or API key. Chat models: 'automatic' or any InvokeLLM model id (docs also cite gpt_5_5). Also serves OpenAI's `/images/generations` and `/images/edits` with image models 'automatic', 'gemini_3_1_flash_image', 'gpt_image_2' and provider options such as aspect_ratio. Intended for 'code agents' (tool loops) inside backend functions; headers carry the signed `Base44-State` required by a workspace IP allowlist.

- **Как се ползва:** In a backend function: `const base44 = createClientFromRequest(req); const { baseURL, token, headers } = base44.aiGateway.connection(); const openai = new OpenAI({ baseURL, apiKey: token, defaultHeaders: headers })`.
- **Ограничения / план:** 'Requests are billed to your app's credit quota, which is the same shared quota your app's built-in AI features use, and isn't split per user. If the app runs out of credits, the gateway stops working for every user'. No streaming per skills doc. Backend-only recommended.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/ai-gateway.md · https://docs.base44.com/developers/references/sdk/getting-started/ai-gateway-images

### Custom workspace integrations (OpenAPI import)

A workspace administrator imports an OpenAPI specification to register any external API under a slug; apps then call `base44.integrations.custom.call(slug, 'method:/path', { payload, pathParams, queryParams })`. Calls are proxied through Base44's backend 'so credentials are never exposed to the frontend'. Response `{ success, status_code, data }`; errors 404 (integration/operation not found), 502 (external API failed), 504 (timeout).

- **Как се ползва:** Admin: Workspace settings → integrations → import OpenAPI spec (docs page 'managing-workspace-integrations'). Builder/code: `await base44.integrations.custom.call('my-crm', 'get:/contacts', { queryParams: { limit: 10 } })`.
- **Ограничения / план:** 'Catalog/Custom integrations: Require Builder plan or higher'. Requires workspace admin to configure.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/integrations.md · https://docs.base44.com/documentation/integrations/managing-workspace-integrations

### Connectors catalog (shared OAuth connectors)

Platform connectors give backend code a raw OAuth token for an external service, connected once by the app builder and shared by all app users. SDK 0.8.52 lists 46 type identifiers: airtable, bamboohr, box, calendly, clickup, contentful, databricks, discord, dropbox, github, gitlab, gmail, googleads, google_analytics, googlebigquery, googlecalendar, google_classroom, googledocs, googledrive, googlemeet, google_search_console, googlesheets, googleslides, googletasks, hubspot, hugging_face, instagram, linear, linkedin, microsoft_teams, one_drive, notion, outlook, quickbooks, salesforce, share_point, slack (Slack User), slackbot (Slack Bot), snowflake, splitwise, square, supabase, tiktok, typeform, wix, wrike (plus 'x' used in the callApi example and 'stripe'). Some return a `connectionConfig` (e.g. SharePoint subdomain). Base44 refreshes tokens automatically; statuses active / disconnected / expired.

- **Как се ползва:** Dashboard → Integrations → pick the connector and complete the OAuth consent (or `npx base44 connectors initiate --integration-type googlecalendar --scopes ...`). Then in a backend function: `const { accessToken, connectionConfig } = await base44.asServiceRole.connectors.getConnection('googlecalendar')` and call the provider API with the bearer token. `npx base44 connectors list-available` prints the live catalog with descriptions and required config fields.
- **Ограничения / план:** 'Builder plan or higher' to configure connectors; backend functions required; one connector per type per app; 'Connecting a connector replaces its scope set with exactly the scopes you pass'; a connector already authorised by another user errors with `different_user`.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/connectors.md · https://github.com/base44/skills/blob/main/skills/base44-cli/references/connectors-create.md

### App user connectors (per-user OAuth)

Each signed-in app user connects their own account (e.g. their Gmail or LinkedIn). Workflow: register OAuth credentials for the service in Workspace Settings to get a connector ID (workspace admin), frontend calls `base44.connectors.connectAppUser(connectorId)` to get a redirect URL, user consents, then a backend function calls `base44.asServiceRole.connectors.getCurrentAppUserConnection(connectorId)` to obtain that user's token. `disconnectAppUser(connectorId)` removes the stored credentials.

- **Как се ползва:** Workspace Settings → connectors → register OAuth app → copy connector ID; the AI builder inserts the ID into generated code; frontend redirects to the URL from connectAppUser.
- **Ограничения / план:** Requires workspace admin access to register; provider invoices you directly (not metered by Base44).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk

### Workspace-registered connectors (bring your own OAuth app)

Connectors backed by your own OAuth application, registered once in Workspace Settings and consented to by the app builder; identified by connector ID rather than integration type and read with `getWorkspaceConnection(connectorId)`. Used for services whose OAuth app is account-specific such as Databricks and Snowflake.

- **Как се ползва:** Workspace Settings → register connector with your client ID/secret → builder consents once → backend calls `base44.asServiceRole.connectors.getWorkspaceConnection('abc123def')`.
- **Ограничения / план:** Workspace admin needed; token shared by all app users.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk

### Metered connectors (callApi, integration credits)

Some platform connectors are backed by paid third-party APIs (example: X/Twitter). Their OAuth token is not exposed (getConnection rejects with 403); instead `base44.asServiceRole.connectors.callApi('x', { method, path, query, headers, body, host })` proxies the request, attaches the credential server-side and bills 'your workspace's integration credits'. Response includes success, phase (not_sent / responded / timed_out / sent_unconfirmed), status, data or dataBase64, headers (rate-limit counters) and `creditsCharged`.

- **Как се ползва:** From a backend function: `const res = await base44.asServiceRole.connectors.callApi('x', { method: 'POST', path: '/2/tweets', body: { text: 'Shipped!' } })`.
- **Ограничения / план:** 'Cost varies by endpoint, sometimes sharply' (two orders of magnitude between endpoints); only `phase: 'not_sent'` guarantees the provider did not execute; only forwarded headers the connector allows.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk

### Stripe connector (payments)

Stripe is a connector type that 'is provisioned automatically on the server side with no OAuth browser flow': Base44 creates a Stripe sandbox account for the app and may return a claim URL ('Claim your Stripe sandbox: https://dashboard.stripe.com/...') to link it to your own Stripe account; status reports `stripeMode` sandbox or live. CLI endpoints: POST payments/stripe/install, GET payments/stripe/status, DELETE payments/stripe. Workflows have an `app_payment` trigger type. Stripe webhooks in backend functions must use `await stripe.webhooks.constructEventAsync(...)` (async Web Crypto).

- **Как се ползва:** Dashboard → Integrations → Stripe (or add `base44/connectors/stripe.jsonc` with `{"type":"stripe"}` and run `npx base44 connectors push`); open the claim URL to attach your Stripe account; store your own keys as secrets (`secrets.get('STRIPE_API_KEY')`) when calling the Stripe API directly.
- **Ограничения / план:** Added in CLI 0.0.42 (2026-03-11). Not returned by `connectors list-available` in some versions. Connector plan gating (Builder+) presumably applies.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/cli/blob/main/CHANGELOG.md · https://github.com/base44/cli/blob/main/packages/cli/src/core/resources/connector/stripe.ts · https://github.com/base44/skills/blob/main/skills/base44-cli/references/connectors-create.md

### Connector management from CLI and MCP

Connectors can be managed outside the dashboard: CLI `base44 connectors list-available | initiate | push | pull` (projectless with --app-id) and MCP tools `list_connectors` ({appId, integrationTypes?} → catalog with connection status and granted scopes; needs apps:read) and `initiate_connector_connection` ({appId, integrationType, scopes, connectionConfig?} → `already_authorized: true` or a `redirect_url`; needs apps:write) on the Base44 MCP server https://app.base44.com/mcp. `connectors push` overwrites the app's connectors with the local set and removes unlisted ones; OAuth links look like https://auth.base44.io/oauth/...; `workspace move --disconnect-integrations` disconnects OAuth integrations when moving an app between workspaces.

- **Как се ползва:** `npx base44 connectors initiate --integration-type slack --scopes chat:write` opens the browser, polls until consent completes, then `npx base44 connectors pull`.
- **Ограничения / план:** CLI and backend service 'currently in beta'. Non-interactive runs skip OAuth.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/cli/blob/main/README.md · https://github.com/base44/skills/blob/main/skills/base44-sandbox/SKILL.md · https://github.com/base44/skills/blob/main/skills/base44-remote-dev/SKILL.md

### Private data sources (external databases from backend functions)

The open-source functions compiler bundles adapters for 'private data sources' reachable from backend functions over Cloudflare VPC services or a customer network tunnel: Postgres (Hyperdrive), MySQL/MariaDB, SQL Server (tedious), Oracle, MongoDB, Redis, Elasticsearch, generic TCP and HTTP URL sources. 'For a fixed VPC service Cloudflare pins the single target, and for a network binding the reachable set is the customer's tunnel scope'.

- **Как се ползва:** Configured on the platform side (not documented in reachable sources); functions then connect through the runtime manifest.
- **Ограничения / план:** Likely enterprise/workspace feature; UI and plan not visible in reachable sources.
- **Увереност:** low · статус: непотвърдено
- **Източници:** https://github.com/base44/cli/tree/main/packages/functions-compiler/src/private-data-sources

### Workflows triggers for integrations (webhook, connector, payment, schedule)

The dashboard's Workflows (marked 'New') run automations with trigger types `cron` (scheduled), `entity`, `connector`, `in_app_agent`, `app_user_auth`, `app_publish`, `app_payment`, `webhook`, `goal_file`, plus manual 'run now' (dashboard test button). Runs have statuses running/completed/failed/cancelled and a `statusReason` such as `insufficient_credits`. The `webhook` trigger is the generic way to receive events from tools like Zapier or Make; no native Zapier/Make connector appears in the SDK catalog.

- **Как се ползва:** Dashboard → Workflows → create workflow and choose a trigger; inspect from CLI with `npx base44 workflows list` and `npx base44 workflows runs --status failed`.
- **Ограничения / план:** Apps that predate Workflows (legacy automations) cannot be read by the CLI; CLI listing caps at 200. Runs fail with insufficient_credits when the app is out of credits.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-cli/references/workflows-runs.md · https://github.com/base44/skills/blob/main/skills/base44-cli/references/workflows-list.md

### Analytics / app logs integration

`base44.analytics.track()` records custom events and `base44.appLogs.logUserInApp(page)` records page visits; 'Logs appear in the Analytics page of your app dashboard'. Analytics can be disabled per client (`analytics: { enabled: false }`) so no session id, heartbeat or requests are sent. The Vite plugin injects the analytics tracker into production builds.

- **Как се ползва:** `await base44.analytics.track({ eventName: 'checkout', properties: {...} })`; view in Dashboard → Analytics.
- **Ограничения / план:** None documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/app-logs.md · https://www.npmjs.com/package/@base44/vite-plugin

### Agents with WhatsApp greeting and tool access

In-app AI agents (`base44/agents/<name>.jsonc`) have `tool_configs` granting entity operations and backend-function tools, `memory_config`, optional agent skills and a `whatsapp_greeting` field, indicating a WhatsApp channel for agents.

- **Как се ползва:** Dashboard → Agents or `npx base44 agents push`.
- **Ограничения / план:** WhatsApp channel setup not documented in reachable sources.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-cli/SKILL.md · https://github.com/base44/skills/blob/main/skills/base44-sandbox/SKILL.md

## Dashboard > Data (14)

### Data page (entity/table cards)

Every entity (table) appears as a card; open one to browse records. From here you add/edit records inline, export CSV, inspect the schema, test permissions and restore deleted records. A Data page also exists inside the app editor to view/edit records and spot row-level-security warnings without leaving the editor.

- **Как се ползва:** Dashboard > Data > click a table card.
- **Ограничения / план:** Dashboard data table shows at most 5,000 items even if the collection is larger (records are still stored).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data · https://docs.base44.com/changelog/product

### Table card More actions menu

Quick options on each table card: Test Permissions in preview, View Data, Export, Schema, Backup & Restore (Production only), Recently deleted, Clear table records, Delete this table.

- **Как се ползва:** Dashboard > Data > More actions icon on a card.
- **Ограничения / план:** Backup & Restore shown in Production only (Enterprise feature).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data · https://docs.base44.com/Enterprise/backup-and-restore

### Add Item (create record)

Form to add a new record to a table.

- **Как се ползва:** Open table > Add Item > enter data > Submit.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data

### Edit record (record drawer / inline edit)

Click a row to open the record and edit fields, then Save changes. Docs describe this as adding and editing records 'inline'.

- **Как се ползва:** Open table > click the row > edit > Save changes.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data

### Delete record

Delete a single record from a row; deleted records go to Recently deleted.

- **Как се ползва:** Click the Delete icon on the row.
- **Ограничения / план:** Recoverable for 30 days.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data

### Recently deleted (restore records)

Deleted records are retained 30 days and can be restored; after 30 days they are permanently removed.

- **Как се ползва:** Table > More actions > Recently deleted > restore.
- **Ограничения / план:** 30-day retention.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data

### Search, Filters and Columns in data table

Search bar looks through all text fields; Filters build focused views on dates, numbers and choice fields; the Columns control shows, hides or reorders columns.

- **Как се ползва:** Open table > use search box, Filters, Columns.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data

### Export (CSV)

Downloads the table as a CSV for backup, analysis or other tools. CSV contains only the fields Base44 exposes; the User CSV does not include the private auth record or passwords.

- **Как се ползва:** Dashboard > Data > table > More actions > Export.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data · https://www.base44guide.io/articles/can-you-export-data-from-base44 · https://escapebase44.com/base44-export-code

### Import (CSV, dashboard)

Import rows from a CSV that already matches the table structure. Adds new rows only, never updates or overwrites. NULL/None/N/A/#N/A/NaN become empty in non-text columns; list fields accept a JSON array or comma-separated string.

- **Как се ползва:** Dashboard > Data > select table > More actions > Import > choose .csv > Open.
- **Ограничения / план:** CSV only; append-only.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data

### Schema (schema inspector)

View a table's structure (fields, types, validation) which is stored as JSON Schema.

- **Как се ползва:** Table card > More actions > Schema.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data · https://docs.base44.com/developers/backend/resources/entities/entity-schemas

### Test Permissions in preview

Opens the app preview on a page that reads the table with a list of people to impersonate, so you can verify row-level security rules.

- **Как се ползва:** Table card > More actions > Test Permissions in preview.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data · https://docs.base44.com/Setting-up-your-app/Managing-security-settings

### Clear table records / Delete this table

Bulk-remove all records from a table, or delete the entity entirely.

- **Как се ползва:** Table card > More actions > Clear table records or Delete this table.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data

### Backup & Restore and Data version history

Production-only option to back up and restore table data; separate data version history documentation under Enterprise.

- **Как се ползва:** Table card > More actions > Backup & Restore (Production).
- **Ограничения / план:** Enterprise.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Enterprise/backup-and-restore · https://docs.base44.com/Enterprise/data-version-history

### Test data vs production data

Apps can be tested with test data separate from production records.

- **Как се ползва:** See 'Testing your app with test data'.
- **Увереност:** low · статус: непотвърдено
- **Източници:** https://docs.base44.com/documentation/managing-app-data/testing-your-data

## Security (13)

### Row Level Security (RLS) rules

Per-entity access rules stored in the entity schema under `rls` with keys create / read / update / delete. Each rule is `true`, `false`, a condition object or an operator object. Supported: templates `{{user.email}}`, `{{user.id}}`, `{{user.data.<field>}}`; `created_by` matching; `user_condition` (equality only, e.g. `{ "role": "admin" }`); `data.<field>` filters with `$in`, `$nin`, `$ne`, `$all`; logical `$or`, `$and`, `$nor`. Not supported: `$gt/$lt/$gte/$lte`, `$regex`, operators inside user_condition, cross-entity checks. Anonymous users can only reach public entities. Service role bypasses entity access rules and field-level security (one skills page contradicts this — see open questions).

- **Как се ползва:** Dashboard → Data → entity → security/access rules ('The dashboard allows adding multiple rules per operation with OR logic'), or edit the entity .jsonc `rls` block and `npx base44 entities push`. Common presets: owner-only, public create + admin-only read (contact forms), logged-in users only.
- **Ограничения / план:** No comparison operators or regex; complex logic must move to backend functions.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-cli/references/rls-examples.md · https://github.com/base44/skills/blob/main/skills/base44-cli/references/entities-create.md · https://www.npmjs.com/package/@base44/sdk

### Field Level Security (FLS)

Access control for individual fields: an `rls` block inside a property definition with operations create / read / update / delete and `write` (shorthand for create+update+delete), e.g. a `salary` field readable only when `user_condition.role == 'hr'`.

- **Как се ползва:** Add `"rls": { "read": { "user_condition": { "role": "hr" } } }` to the field in the entity schema (dashboard Data page or .jsonc).
- **Ограничения / план:** Same operator limits as RLS; bypassed by service role.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-cli/references/entities-create.md · https://github.com/base44/skills/blob/main/skills/base44-cli/references/rls-examples.md

### User entity and roles

Every app has a built-in `User` entity with 'special security rules that can't be changed': regular users read/update only their own record; users cannot be created through entities (use auth invite/register); service role can read, update and delete any user. Users carry `role` (configured in app settings) and internal `_app_role`; 'Updating `role` requires editor access on the app'. `npx base44 exec --privileged` runs scripts bypassing RLS and requires app owner/editor role.

- **Как се ползва:** Dashboard → App Users to invite users and set roles; in RLS reference roles via `user_condition: { role: 'admin' }`.
- **Ограничения / план:** Role changes need editor access; privileged exec needs owner/editor.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/entities.md · https://github.com/base44/skills/blob/main/skills/base44-cli/references/exec.md

### Service role (asServiceRole) in backend functions

`createClientFromRequest(req)` in a Base44-hosted backend function builds a client carrying the caller's JWT plus a per-request service credential; `base44.asServiceRole.*` then 'bypasses entity access rules and field-level security entirely'. External backends cannot use the service role. `fetchWithAuth()` forwards the credential headers (Base44-App-Id, Base44-Api-Url, Base44-Functions-Version, signed Base44-State, X-Data-Env) only to the app's own origin.

- **Как се ползва:** `import { createClientFromRequest } from 'npm:@base44/sdk'; export default async (req) => { const base44 = createClientFromRequest(req); const user = await base44.auth.me(); if (!user) return Response.json({error:'Unauthorized'},{status:401}); const all = await base44.asServiceRole.entities.Orders.list(); }`.
- **Ограничения / план:** Backend functions only ('Only available in Base44-hosted backend functions').
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/functions.md

### Secrets (environment variables)

Encrypted key/value secrets for backend functions, configured in 'app settings → environment variables' in the dashboard or via CLI `base44 secrets list | set KEY=VALUE | set --env-file .env | delete <key>`. Read in functions with `import { secrets } from 'base44:runtime'; secrets.get('KEY')` (older docs: `Deno.env.get`). `BASE44_APP_ID` is pre-populated. Only names are ever listed, values are never displayed. Custom Google OAuth client secrets are saved to the same store. 'Secrets are not provided to actor code' and are unavailable to the frontend; the sandbox's `.agents/.env` is a protected path.

- **Как се ползва:** Dashboard → Settings/Security → environment variables → add key; or `npx base44 secrets set STRIPE_API_KEY=sk_...`; then `secrets.get('STRIPE_API_KEY')` in a function.
- **Ограничения / план:** Backend functions only; CLI secrets commands were hidden from --help in some versions.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-cli/references/secrets-set.md · https://github.com/base44/skills/blob/main/skills/base44-cli/references/secrets-list.md · https://github.com/base44/skills/blob/main/skills/base44-cli/references/functions-create.md

### Backend functions (Deno-style serverless on Cloudflare Workers)

Serverless HTTP handlers in `base44/functions/<name>/entry.ts` that `export default async (req: Request) => Response`. Written against Deno APIs with `npm:`/`jsr:` imports (pinned versions), compiled by the public `@base44/functions-compiler` into Cloudflare Workers modules sharded under Cloudflare size ceilings; `waitUntil()` for post-response work; multi-file functions and shared code in `base44/shared/`; invoked from the frontend with `base44.functions.invoke(name, data)` (axios-shaped response, throws on non-2xx) or `base44.functions.fetch(path, init)` for streaming/SSE, custom methods and binary; also callable by REST `POST https://<app-domain>/functions/<name>`. Zero-config discovery, `function.jsonc` optional with `automations`. 'Enable Backend Functions in app settings (requires appropriate plan)'.

- **Как се ползва:** Ask the builder for server-side logic, or create the folder and run `npx base44 functions deploy`; in the cloud sandbox writing the file auto-deploys (~5 s). Invoke with `await base44.functions.invoke('processOrder', { orderId })`.
- **Ограничения / план:** Plan-gated ('requires appropriate plan'); Web Crypto is async only; imports outside `base44/` blocked at deploy.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-cli/references/functions-create.md · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/functions.md · https://www.npmjs.com/package/@base44/sdk

### Dependency and network policy for backend functions

The compiler installs a fetch guard: dependency downloads are allowed only from npmjs.org, jsr.io, esm.sh and deno.land ('Every other host is blocked, so user code can't pull from arbitrary origins'), with a 30 MB per-response cap; a static-egress layer routes runtime fetches, excluding `.base44.app` hosts. Each compiled shard begins with a `//!b44:1 {...}` manifest listing its functions and compiler version, and version identity is the hash of compiled artifacts.

- **Как се ползва:** Automatic on every deploy; import packages as `npm:pkg@x.y.z`.
- **Ограничения / план:** No arbitrary-host imports; 30 MB tarball cap.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://github.com/base44/cli/blob/main/packages/functions-compiler/src/fetch-guard.ts · https://www.npmjs.com/package/@base44/functions-compiler

### Backend function logs

Function console output is indexed and viewable in the dashboard Logs page and from the CLI: `npx base44 logs [--function <name>] [--level error] [--since/--until] [--follow] [--limit]`. Index lags execution by ~20-30 s; `--follow` streams near-real-time; `--limit` is clamped at 500 rows. Workflow runs are inspected separately with `workflows runs`.

- **Как се ползва:** Dashboard → Logs, or `npx base44 logs --function send-reminder --level error`.
- **Ограничения / план:** 500-row cap; legacy per-function deployments may emit unstamped rows.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-troubleshooter/SKILL.md

### App Visibility (public / private / workspace)

Controls who can open the app: Public (no login for basic access, authenticated users get more), Private (login required, unauthenticated users redirected to login), Workspace (members of the workspace only). `app.getPublicSettings()` returns the policy and a 403 with `reason: 'auth_required'` for protected apps. Shown on the dashboard Overview as 'App Visibility' (owner screenshot: Public).

- **Как се ползва:** Dashboard → Overview → App Visibility; or `npx base44 visibility public|private|workspace` / `visibility` in base44/config.jsonc.
- **Ограничения / план:** Takes effect immediately.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-cli/references/visibility.md · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/auth.md · https://www.npmjs.com/package/@base44/sdk

### Authentication providers and SSO

Email/password (OTP verification, password reset, change password), Google (enabled by default, optional custom OAuth client), Microsoft, Facebook and Apple social login (enable in app authentication settings), and enterprise SSO via `loginWithProvider('sso')` with Google, Microsoft (tenant id), GitHub, Okta (okta domain) or custom OIDC (auth/token/userinfo endpoints, JWKS URI). 'SSO and social login are mutually exclusive'. Hosted login page via `redirectToLogin()`; `base44.asServiceRole.sso` mints SSO tokens.

- **Как се ползва:** Dashboard → Settings → Authentication (or `npx base44 auth social-login google enable`, `npx base44 auth sso enable --provider okta ...`, then `auth push`); code: `base44.auth.loginWithProvider('google', '/dashboard')`.
- **Ограничения / план:** SSO providers listed as 'Elite Plan'; disabling the last login method warns users will be locked out.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-sdk/references/auth.md · https://github.com/base44/skills/blob/main/skills/base44-cli/references/auth-social-login.md · https://github.com/base44/skills/blob/main/skills/base44-cli/references/auth-sso.md

### Abuse protection: rate limiting and Turnstile

OTP and password-reset requests are rate-limited (HTTP 429), 'Login attempts may be rate-limited with Turnstile protection'; sandbox/MCP API has per-app limits (~120 reads/min, ~60 mutations/min). Password complexity is enforced server-side.

- **Как се ползва:** Automatic; handle 429 in custom auth UI.
- **Ограничения / план:** Limits not configurable by the builder in reachable docs.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-sdk/references/auth.md · https://github.com/base44/skills/blob/main/skills/base44-remote-dev/SKILL.md

### Workspace IP allowlist

The SDK notes that a client created with `createClientFromRequest()` carries the signed `Base44-State` header 'which a workspace IP allowlist requires', i.e. workspaces can restrict API access by IP and platform-signed requests pass through.

- **Как се ползва:** Configured at workspace level (UI not visible in reachable sources).
- **Ограничения / план:** Workspace/enterprise setting.
- **Увереност:** low · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/sdk

### Security dashboard page

The app dashboard sidebar has a 'Security' entry (owner screenshot, 3 Oct 2026). The task brief describes it as a security center covering RLS, secrets, backend functions, dependencies and headers; reachable sources confirm the underlying primitives (RLS/FLS, secrets store, backend functions, dependency host allowlist) but not the page's own scan/score UI.

- **Как се ползва:** Dashboard → Security.
- **Ограничения / план:** Unknown.
- **Увереност:** low · статус: непотвърдено
- **Източници:** owner screenshot of app.base44.com dashboard sidebar (3 Oct 2026)

## Models (12)

### Base 1 (Base44 in-house model)

'Base44's first in-house model, trained on real building patterns from across the platform, a well-rounded, general-purpose choice for both everyday building and conversation.' Announced 29 June 2026 (TechCrunch/The New Stack). CEO Maor Shlomo: a fine-tune of an existing open-source base, trained with reinforcement learning on a dataset generated from tens of millions of real user interactions, ~6 months of training, leveraging Wix's design assets; stated goal is to avoid the generic 'AI slop' look of frontier models, so descriptive style prompts carry more weight. Launched in a staged rollout. A Business Insider/Yahoo test found Base 1 faster and using fewer credits than Opus 4.8 on the same website.

- **Как се ползва:** Select 'Base 1' in the Select model menu (chat composer or homepage Model button), then send your message.
- **Ограничения / план:** Builder+ to select manually. Staged/gradual rollout, may not be available on all accounts. No 'Uses more credits' label.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://base44.com/blog/maor-shlomo-building-the-model-behind-base · https://docs.base44.com/Building-your-app/AI-chat-modes · https://techcrunch.com/2026/06/29/vibe-coding-platform-base44-launches-own-model-as-ai-startups-seek-defensibility/

### Sonnet 5.5 (Claude)

The Sonnet option in both the AI chat and the agent editor. Docs describe Sonnet as 'a well-balanced choice for day-to-day building, writing, refactoring, and troubleshooting, with a strong mix of quality and speed'. September 2026 changelog: Sonnet 5.5 replaced Sonnet 5 'at the same credit rate as before. If you had Sonnet 5 saved, your pick moves across automatically.' Sonnet (5) is also the model Auto mode runs for ongoing work, planning and image turns.

- **Как се ползва:** Select 'Sonnet 5.5' in the Select model menu; or pick Claude Sonnet in an in-app agent's model dropdown.
- **Ограничения / план:** Builder+ in chat. For in-app agents it costs 'several times' the Automatic model's ~3 integration credits per message.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/changelog/product · https://docs.base44.com/Building-your-app/AI-agents-for-apps

### Opus 5.5 (Claude)

Opus is 'the most advanced reasoning model, built for the hardest problems. Use it for complex multi-step logic, intricate architecture decisions, and edge cases where you need the highest level of accuracy.' Opus 5 became 'an option in both AI chat and the model picker ... available on the Builder plan and above' in August 2026; Claude Opus 5.5 was added for in-app agents, InvokeLLM calls and AI-gateway calls in September 2026 with saved picks migrated automatically. Opus 5 is what Auto mode runs for the first message on plans that do not use cost-saving models.

- **Как се ползва:** Select 'Opus 5.5' in the Select model menu before sending.
- **Ограничения / план:** Builder+. For agents/InvokeLLM Opus 5.5 'costs many times more than the Automatic model'. Not labelled 'Uses more credits' in the chat picker in the owner's screenshot, but manual models may use more credits than Auto.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/changelog/product · https://docs.base44.com/Building-your-app/AI-agents-for-apps

### Fable 5.1 (Claude) — 'Uses more credits'

'Great for complex, multi-step builds and detailed debugging when you want thorough, high-quality results, and uses more credits for each request.' Fable 5.1 took the place of Fable 5 in the AI chat (Sept 2026). For in-app agents 'GPT-6 Astra and Claude Fable 5.1 cost the most' of any option.

- **Как се ползва:** Select 'Fable 5.1' in the Select model menu.
- **Ограничения / план:** Builder+; marked 'Uses more credits'. Highest credit tier for agents/InvokeLLM.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/changelog/product · https://docs.base44.com/Building-your-app/AI-agents-for-apps

### Gemini 3.8 Flash (Google)

Google model that 'suits fast responses on everyday tasks'; placed directly under Fable 5.1 in the model picker. September 2026 changelog: 'Gemini 3.8 Flash integration calls now use twice as many integration credits as before, following a price rise from the model provider.' Earlier Gemini generations on Base44: Gemini 2.5 Pro, Gemini 3 Pro (user feedback 'Gemini 3 Pro - A Game Changer!'), Gemini 3.1 Pro (live 19 Feb 2026, 'especially strong for gaming apps, design workflows').

- **Как се ползва:** Select 'Gemini 3.8 Flash' in the Select model menu, or choose it as an in-app agent / InvokeLLM model.
- **Ограничения / план:** Builder+ in chat. Agents: 'several times' Automatic; integration-credit cost doubled in Sept 2026.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product · https://base44.com/changelog · https://docs.base44.com/Building-your-app/AI-agents-for-apps

### GPT-5.6 Terra (OpenAI)

'A cost-efficient GPT-5.6 option for complex reasoning and multi-step planning, at a lower credit cost.' Added to the AI chat in July 2026 together with GPT-5.6 Sol.

- **Как се ползва:** Select 'GPT-5.6 Terra' in the Select model menu.
- **Ограничения / план:** Builder+. Positioned as the lower-credit GPT option.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/Getting-started/changelog · https://docs.base44.com/changelog/product

### GPT-6.1 Sol / GPT-5.6 Sol (OpenAI)

Sol is 'the most capable GPT-5.6 option, for the hardest reasoning and large, evolving projects' and 'uses more credits'. In July 2026 GPT-5.6 Sol replaced GPT-5.5 as the Superagent's GPT option ('if your agent was set to GPT-5.5, it now uses Sol automatically at the same credit cost'). The agents docs refer to 'GPT-6.1 Sol' / 'GPT-6 Sol' costing 'many times' the Automatic model; the owner's screenshot shows 'GPT-6.1 Sol' in the chat picker.

- **Как се ползва:** Select 'GPT-6.1 Sol' in the Select model menu or in an agent's model dropdown.
- **Ограничения / план:** Builder+ in chat. Agents/InvokeLLM: many times the Automatic cost. Naming varies across docs (5.6 Sol, 6 Sol, 6.1 Sol).
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/changelog/product · https://docs.base44.com/Building-your-app/AI-agents-for-apps

### GPT 6 Astra (OpenAI) — 'Uses more credits'

'The newest and most capable GPT model, for the hardest reasoning and the most demanding builds. Uses more credits for each request.' OpenAI released GPT-6 Astra on 3 Sept 2026; Base44 added it to the chat picker and the unified lineup in September 2026. For agents 'GPT-6 Astra and Claude Fable 5.1 cost the most'.

- **Как се ползва:** Select 'GPT 6 Astra' in the Select model menu.
- **Ограничения / план:** Builder+; marked 'Uses more credits'; highest credit tier for agents/InvokeLLM.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/changelog/product · https://docs.base44.com/Building-your-app/AI-agents-for-apps

### Automatic model migration when a model is replaced

When Base44 swaps a model generation, saved picks move automatically to the new equivalent: Sonnet 5 → Sonnet 5.5 ('your pick moves across automatically', same credit rate); GPT-5.5 → GPT-5.6 Sol in the Superagent ('now uses Sol automatically at the same credit cost'); Opus 5.5 / GPT 6 Sol / GPT 6 Luna replacing earlier models in agents, InvokeLLM and AI gateway ('your choice moves across to the new equivalent automatically'); Fable 5.1 took the place of Fable 5.

- **Как се ползва:** No action needed; verify the current model name in the picker after a changelog update.
- **Ограничения / план:** Credit rate stated as unchanged for Sonnet 5.5 and Sol migrations.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product · https://base44.com/changelog

### One model lineup for everything your app runs (unified lineup, Sept 2026)

'InvokeLLM, in-app agents, and image and text generation now share a single lineup: Gemini 3.8 Flash, GPT 5.6 Luna, Terra and Sol, Sonnet 5, Opus 5, Fable 5.1, GPT 6 Astra, and GLM 5.2. Every model is available on every plan, with credits as the cost control.'

- **Как се ползва:** Pick any of these models in the agent editor, in InvokeLLM (via the AI chat or the SDK 'model' parameter) or via the AI gateway.
- **Ограничения / план:** No plan gating for runtime models (unlike the builder chat picker); per-model credit cost applies.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product · https://docs.base44.com/changelog/developers

### GPT 6 Luna / GPT-5.6 Luna (default automation model)

Low-cost GPT model used for runtime, not shown in the owner's chat picker. July 2026: 'scheduled automations now run on GPT-5.6 Luna, and you can select it from the Superagent model picker while automation credit costs stay the same.' Later: 'A Superagent automation left on the default model now runs on GPT 6 Luna at low reasoning, which is quicker and costs fewer credits per run.' For agents 'GPT-6 Luna costs about the same as Automatic.'

- **Как се ползва:** Superagent → settings → automation model picker → GPT 6 Luna (or leave default).
- **Ограничения / план:** Available on every plan for agents/automations; about the Automatic rate.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product · https://docs.base44.com/Building-your-app/AI-agents-for-apps · https://docs.base44.com/superagents/customizing-your-superagent

### GLM 5.2 (Zhipu) — default agent model

Part of the unified runtime lineup. Changelog: 'GLM 5.2 is now the default model for agents using the default model instead of Sonnet 4.6.' For agents GLM 5.2 'costs several times' the Automatic model.

- **Как се ползва:** Leave an in-app agent on the default model, or pick 'GLM 5.2' explicitly in the agent/InvokeLLM model list.
- **Ограничения / план:** Every plan; several times Automatic cost. Not offered in the builder chat picker (per owner's screenshot).
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product · https://docs.base44.com/Building-your-app/AI-agents-for-apps

## Credits (11)

### 'Uses more credits' label

A sub-label shown in the Select model menu on the most expensive models (Fable 5.1 and GPT 6 Astra in the owner's screenshot; docs use the same phrase for both). Base44 states: 'When you choose a model manually, credit usage varies by model and may use more credits than Auto mode.'

- **Как се ползва:** Read the label under a model's name before selecting it; check actual cost afterwards under 'Credits Used' in the message's More actions menu.
- **Ограничения / план:** Base44 does not publish numeric multipliers for the chat picker; only relative language.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/Account-and-billing/Credits

### Dynamic credits per message and 'Credits Used' indicator

Since the Dec 2025 'automatic optimization' update, 'credit usage now adjusts to the size and complexity of your request'; many messages come in under 1 credit (examples: ~0.5 credits for a small UI tweak, ~1.5 credits for full app logic). 'There is no set credit amount used per message.' The exact cost is shown after each run: 'Click the More actions icon under your prompt to open the menu, then look under Credits Used'. Each Discuss-mode message costs 0.3 credits and 'Discuss mode uses its own AI model regardless of the model selected in your app, which is what keeps its cost low.'

- **Как се ползва:** After a message completes, hover the prompt → More actions (…) → 'Credits Used'. Use Discuss mode for planning to pay 0.3 credits regardless of model.
- **Ограничения / план:** Manual models and Compare (2×) increase cost; plan quotas as above.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits · https://docs.base44.com/Building-your-app/AI-chat-modes · https://base44.com/blog/update-smarter-building-with-automatic-optimization

### Credit multipliers per model for in-app agents (Automatic vs manual)

For in-app agents the 'Automatic' model 'is optimized for general-purpose tasks and interactive workflows, and starts at about 3 integration credits a message, rising with the length of the answer.' Relative costs: 'GPT-6 Luna costs about the same as Automatic; Gemini 3.8 Flash, GLM 5.2, and Claude Sonnet 5 cost several times more; Claude Opus 5.5 and GPT-6 Sol cost many times more'; 'GPT-6 Astra and Claude Fable 5.1 cost the most'. 'What a message costs depends on the model the agent uses and on how long the answer is.'

- **Как се ползва:** Dashboard → Agents → open an agent → model dropdown → pick Automatic or a named model. Check 'Credits Used' per message to see actual cost.
- **Ограничения / план:** Every model available on every plan; integration credits are the cost control. Costs are estimates, calculated after the action runs.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-agents-for-apps · https://docs.base44.com/Account-and-billing/Credits

### Plan credit allotments that bound model usage

Five public plans: Free $0 (25 message credits, 100 integration credits/month, up to 5 apps); Starter $16/mo annual or $20 monthly (100 / 2,000, unlimited apps, in-app code edits); Builder $40/$50 (250 / 10,000; model selection, custom domain, backend functions, GitHub); Pro $80/$100 (500 / 20,000); Elite $160/$200 (1,200 / 50,000). Annual billing is ~20% off. Message credits pay for builder-chat prompts; integration credits pay for runtime AI (InvokeLLM, agents, GenerateImage).

- **Как се ползва:** Workspace → Settings → Plan and billing to view/upgrade; 'View usage' on the Dashboard Overview shows balances.
- **Ограничения / план:** Builder+ for manual model choice and Compare.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://base44.com/pricing · https://docs.base44.com/Account-and-billing/Billing-and-plans · https://www.jetadmin.io/blog/base44-pricing-2026-guide-to-plans-credits-and-real-total-cost/

### Message credits and per-message cost rules

Two credit types: message credits (prompts that plan, update or fix the app) and integration credits (emails, image generation, LLM calls, in-app agents at runtime). There is no fixed credit amount per message; Base44's tooltip says usage 'varies based on the action and the selected AI model'. Documented/observed costs: Discuss 0.3 credits per message; Plan mode 'a fraction of a credit'; Builder (clarifying) questions free; Compare 2x; manual visual edits free; third-party estimates: first build ~1 credit, simple visual change ~0.5, small feature ~1, complex module ~2, app-wide change 3-4. No refunds or credit reversals for AI actions. Remaining credits are visible by clicking the Base44 logo top-left in the editor; detailed usage under workspace Settings → General → Credit usage; the App usage page breaks down message vs integration spend per billing cycle.

- **Как се ползва:** Check cost per prompt via 'More actions' → 'Credits Used'; check balance via the Base44 logo; manage usage in Settings → Credit usage.
- **Ограничения / план:** Plan allowances (Oct 2026): Free 25 message credits/mo capped at 5/day; Starter 100/mo; Builder 250/mo; Pro 500/mo; Elite 1,200/mo (annual billing 20% off). Unused credits do not roll over.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits · https://base44.com/pricing · https://base44.com/blog/how-much-does-base44-cost

### Message credits

Credits consumed when you prompt the builder AI to plan, update or fix the app. No fixed cost per message; usage scales with work done: simple visual/text change ~0.5, small feature ~1, complex module ~2, app-wide change ~3-4 credits (estimates). Discuss mode costs a flat 0.3 credits per message. Manual Edit-mode changes cost 0; AI 'Edit Element' costs credits. On paid plans automatic AI fixes are free; on Free they consume credits. Credits are charged after the action runs and are non-refundable for AI mistakes.

- **Как се ползва:** Type in the chat composer; see cost per prompt via More Actions (…) under the prompt > Credits Used.
- **Ограничения / план:** Per-plan monthly allowances; Free capped at 5/day.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits · https://docs.base44.com/Building-your-app/AI-chat-modes · https://github.com/Amal-David/docingest/blob/main/server/storage/docs/docs.base44.com/documentation_2026-07-07T03:54:54.947Z.md

### Integration credits

Credits consumed when the live app uses Base44 built-in services: SendEmail 1 (2 with custom domain), UploadFile 1, ExtractDataFromUploadedFile 1, GenerateImage 1, GenerateVideo 5 per second, GenerateSpeech 1 per 50 chars (max 100), invokeLLM ~3 (Automatic), ~5 (Gemini 3 Flash), ~15 (GPT-5); in-app agent messages ~3/~5/~15 by model; each automation run 1 credit plus any integrations it calls; workflows billed per step (fraction of a credit per backend-function step, run cancelled if credits run out); social content plan 10, improve/regenerate 1. Database reads/writes and calls through your own API keys/backend functions cost 0. Changelog 21-22 Sep 2026: Gemini 3.8 Flash now costs double credits.

- **Как се ползва:** Happens automatically when end users trigger features; estimate cost by running the action once and reading execution logs (no cost preview exists).
- **Ограничения / план:** Per-plan monthly allowances (100 / 2,000 / 10,000 / 20,000 / 50,000). When exhausted Base44 emails you, your actions fail with a credits error and end users see a generic error.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits · https://docs.base44.com/Building-your-app/Creating-workflows · https://raw.githubusercontent.com/PlayFundWin/daily-build-feed/master/archive/covered.md

### Credit resets and no rollover

Free: up to 5 credits/day, 25/month. Paid: message and integration credits reset monthly on the subscription day (UTC time of purchase). Unused credits expire and do not carry over. If you hit the limit, credit-consuming actions pause until reset; the only documented remedy is upgrading (you cannot re-buy the same plan mid-cycle, cannot pause a subscription).

- **Как се ползва:** Check the renewal date at the top of Settings > Credit usage or Dashboard > Overview > App usage; upgrade from app.base44.com/billing.
- **Ограничения / план:** No official credit top-up documented; a third-party listing claims 'Top up credits any time before the cycle resets' and Reddit users ask how to top up (unresolved).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits · https://docs.base44.com/Account-and-billing/Billing-and-plans · https://www.reddit.com/r/Base44/comments/1n5ee3e/how_to_topup_credits/

### Shared workspace credits and member credit limits

Everyone invited to a workspace draws from the workspace's shared message and integration credit pool and needs no own paid plan; Members page shows 'Monthly credits used' per member and 'Top builders'. Enterprise workspaces can set a default monthly credit cap and per-member overrides (Admins/Editors only; Viewers consume no credits), also via SCIM.

- **Как се ползва:** Settings > Members; Enterprise: More Actions > Set default credit limit, or per member > Set credit limit.
- **Ограничения / план:** Credit limits are Enterprise-only.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/documentation/using-your-workspaces/managing-workspace-members · https://docs.base44.com/Enterprise/managing-enterprise-members · https://docs.base44.com/Account-and-billing/Credits

### Partner Program credit delegation

Partners (builder level Maker/Level 2+) can manage client apps across workspaces, transfer apps to client workspaces, and use their own Base44 credits while working in a client workspace ('Credit delegation'); Specialist (Level 3) unlocks Partner Directory and Verified Partner badge. Payments between partner and client are not handled by Base44.

- **Как се ползва:** app.base44.com/partners > Join as a Partner > set up profile; choose credit consumption settings per client workspace.
- **Ограничения / план:** Requires Maker (Level 2) builder level.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Community-and-support/partner-program · https://github.com/Amal-David/docingest/blob/main/server/storage/docs/docs.base44.com/documentation_2026-07-07T03:54:54.947Z.md

### Credit-saving guidance (Discuss mode, Edit mode, Revert, Automatic model)

Official tips to cut credit burn: plan prompts first, keep the model on Automatic, keep prompts focused, use Discuss mode (0.3 credits) to explore, use Edit mode for UI tweaks (manual edits free), click Revert instead of extra debugging prompts, avoid repeated auto-fixes, build in small steps, track usage. Troubleshooting page pairs Visual Edit + Discuss to point the AI at the exact element.

- **Как се ползва:** Toggle Discuss/Edit in the chat; Revert link on each message; Version History (clock icon).
- **Ограничения / план:** Discuss costs 0.3 credits even though it changes nothing.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits · https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/Community-and-support/Troubleshooting

## Preview and editing (9)

### App editor layout: AI chat / Preview / Dashboard

The app editor has three working areas: the AI chat (left), the live preview (right) and the app's Dashboard. A top bar sits above them with Preview, Dashboard, Edit, Canvas and Publish controls. The preview updates in real time and can be interacted with exactly as end users would.

- **Как се ползва:** Open an app from the workspace. Use the Preview / Dashboard toggle in the top bar to switch between the live app preview and the management dashboard (Overview, App Users, Data, Analytics, etc.).
- **Ограничения / план:** None documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Getting-Started/Quick-start-guide · https://docs.base44.com/Getting-Started/Glossary

### Edit mode (Edit button)

Visual editing mode: click an element in the preview and either style it manually with the Edit toolbar or ask the AI to change it. Clicking an element that repeats elsewhere on the page highlights every repeat and the change applies to all of them. Since Aug 2026, the selected element appears as a chip in the AI chat input so you can confirm what the request applies to; Edit mode covers list items, table cells, buttons and blockquotes, and if an edit cannot be applied a message explains why. Edits save to the branch you are on.

- **Как се ползва:** Click Edit at the top of the editor, then click an element in the preview. Use the Edit toolbar icons, or type a request in the chat with the element chip attached.
- **Ограничения / план:** Desktop only (not available on mobile web / mobile app).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Design · https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/changelog/product

### Pages drop-down

Each page has its own URL path (/, /Home, /Products) and appears in the page drop-down above the preview; use it to move between pages. New pages are added by describing them in AI chat. The default landing page is set in Dashboard > Settings > App Settings > Main Page.

- **Как се ползва:** Click the page drop-down at the top of the preview and pick a page.
- **Ограничения / план:** None documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/managing-your-pages

### Device preview (Screen icon / device menu)

Switch the preview between desktop and mobile (tablet also shown as frame size on Canvas) to check layout on different screen sizes. Since 2026 the AI chat knows how wide the preview is rendering, so a narrow panel is treated as tablet-sized automatically. Mobile preview mode was a changelog feature.

- **Как се ползва:** Click the Screen icon at the top of the editor and select Mobile (or Desktop).
- **Ограничения / план:** None documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Design-foundations-and-layout · https://base44.com/changelog/feature/mobile-preview-mode · https://docs.base44.com/changelog/product

### Hide chat panel (full-screen preview)

Collapses the chat panel so the app displays exactly as visitors see it; used for testing user flows as a real user.

- **Как се ползва:** Click the Hide chat panel icon at the top left of the editor, next to the app name.
- **Ограничения / план:** None documented.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://base44.com/blog/base44-ai-app-builder

### Canvas

Infinite board showing every page as a live-preview frame at desktop, tablet or phone size; add sticky notes (with To do / In progress / Done status), freehand drawings (stroke weight and color), reference images; lock elements; real-time multiplayer with named cursors and colored selections; send notes/images straight to the AI chat as instructions; double-click a page frame to enter Edit mode. Canvas keeps up to 50 steps of personal undo/redo history (create, move, resize, edit, delete, lock, connect).

- **Как се ползва:** Click Canvas in the top bar; use the right-side toolbar (Select, Hand, Draw, Sticky note, Image).
- **Ограничения / план:** Undo history is personal (does not affect collaborators).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Canvas · https://docs.base44.com/changelog/product

### Code tab with split screen preview

Edit code with the app preview visible beside it so edits are seen without switching to a separate Preview mode.

- **Как се ползва:** Dashboard > Code (or Code tab) > enable split screen.
- **Ограничения / план:** Editing code is desktop-only.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/developers/app-code/editor/code-tab · https://docs.base44.com/Building-your-app/Mobile-experience

### Store button beside Edit and Canvas

Opens the app's store directly from Preview or Dashboard, on desktop and mobile web.

- **Как се ползва:** Click Store in the top bar.
- **Ограничения / план:** Only for apps with a store.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product

### Mobile editing (Base44 iOS/Android app and mobile web)

Build, edit and manage apps from the mobile app or mobile browser. Edit mode, security/data permissions, code editing, APIs and templates are desktop-only.

- **Как се ползва:** Install the Base44 app from the App Store / Google Play, or open app.base44.com in a mobile browser.
- **Ограничения / план:** Edit mode not available on mobile.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Mobile-experience · https://base44.com/changelog/feature/base44-mobile-app-

## Dashboard > Overview (9)

### Overview page

Landing page of the app Dashboard. Shows the app name, description and logo, plus cards for Earn credits, View usage, App Visibility, Invite Users (Copy Link / Send Invites), Platform Badge and a 'Manage your app on the go with the mobile app' promo. Branding changes made here propagate to the app's manifest.json.

- **Как се ползва:** In the app editor toggle to Dashboard, then click Overview in the left sidebar.
- **Ограничения / план:** None known.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Getting-Started/Quick-start-guide · https://docs.base44.com/documentation/building-your-app/uploading-to-app-stores · https://docs.base44.com/Setting-up-your-app/Managing-access

### Edit App Logo (Upload Logo / Generate Logo)

Clicking the app logo opens the 'Edit App Logo' window with two tabs: 'Upload Logo' (drag and drop or Upload a PNG/JPG, crop view with drag to reposition and zoom slider, then Apply and Save) and 'Generate Logo' (describe the logo, click Generate — AI generated).

- **Как се ползва:** Dashboard > Overview > click the app logo > choose Upload Logo or Generate Logo > Apply > Save.
- **Ограничения / план:** Upload: PNG or JPG up to 5 MB.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/documentation/building-your-app/uploading-to-app-stores · https://docs.base44.com/api-reference/generate-app-logo

### App name and description editing

App name and description can be updated from the Overview section. Renaming the app also changes its default URL (<app>.base44.app), so the old link stops working. Rename is also available from the workspace Apps page via the app card's More actions > Rename.

- **Как се ползва:** Dashboard > Overview > edit the name/description fields; or Apps page > app card More actions > Rename > enter name > Save.
- **Ограничения / план:** Renaming updates the app URL; share the new link.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/documentation/using-your-workspaces/managing-your-workspace-apps · https://docs.base44.com/documentation/building-your-app/uploading-to-app-stores

### App Visibility

Drop-down that decides who can open the app and whether sign-in is required. Options: Public (anyone, no sign-in required), Private (only invited people, sign-in required), Workspace (everyone in your Base44 workspace, sign-in required). Apps that act like public sites (landing pages, portfolios) are set to Public automatically. For Private apps you must invite people unless auto-admit is on. Private apps do not display the platform badge.

- **Как се ползва:** Dashboard > Overview > App Visibility drop-down > select a level.
- **Ограничения / план:** Workspace visibility requires a workspace. Owner's screenshots show 'Public' for the test app. The owner's brief says 'invite-only'; docs name this level 'Private'.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-access · https://docs.base44.com/Enterprise/Enterprise-SSO-and-app-visibility · https://docs.base44.com/developers/skills/base44-cli/references/visibility

### Invite Users — Send Invites

Sends email invitations to specific people. You enter one email per person, choose an Access level (role: Admin or User) and click Send Invitation. Invitations control what the invitee can do in the live app, not in the editor/dashboard (that requires being a collaborator).

- **Как се ползва:** Dashboard > Overview > Invite Users > Send Invites > enter emails > Access level drop-down > choose role > Send Invitation. Also available via top bar Publish > Share your app.
- **Ограничения / план:** For private apps only admins can invite and pick roles; for public apps users with the User role can invite other users.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-access · https://docs.base44.com/Getting-Started/Quick-start-guide

### Invite Users — Copy Link

Copies the app's live URL so you can share it anywhere. From Publish > Share your app you can also post directly to Facebook, LinkedIn, X, WhatsApp or Reddit.

- **Как се ползва:** Dashboard > Overview > Invite Users > Copy Link; or Publish > Share your app > Copy link / social buttons.
- **Ограничения / план:** For Private apps, link recipients without access see a 'request access' pop-up.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-access

### Earn credits (Referral program)

Shortcut to the referral program. Share a referral link: your friend gets 30 credits at signup, you earn 30 when they publish an app and 100 if they upgrade to a paid plan. Referral credits are one-time bonuses that expire 40 days after they are earned and do not raise the monthly allowance. Also reachable via the Gift icon at the top right of the workspace.

- **Как се ползва:** Dashboard > Overview > Earn credits; or Gift icon > Copy referral link.
- **Ограничения / план:** No cap on number of referrals; credits expire after 40 days.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Community-and-support/Referral-program · https://docs.base44.com/Getting-Started/Referral-program · https://base44.com/changelog/feature/referral-

### View usage (Credit usage)

Link to the workspace Credit usage page. Shows Message credits used and Integration credits used, plus distribution of each credit type by app for the current billing cycle. Per-prompt credits are also visible under the prompt's More actions > Credits Used.

- **Как се ползва:** Dashboard > Overview > View usage; or workspace name (bottom left) > Settings > General > Credit usage.
- **Ограничения / план:** Credit allowance depends on plan.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits · https://docs.base44.com/documentation/account-and-billing/new-plans-and-workspaces · https://feedback.base44.com/p/need-update-to-documentation-on-finding-out-how-many-credits

### Base44 mobile app (iOS / Android)

Overview promo 'Manage your app on the go with the mobile app'. Native Base44 apps on the App Store and Google Play let you build, edit and manage apps from a phone; Superagents also available. Localized in English, German, Spanish, French, Japanese, Portuguese. Connecting a domain and managing security are desktop-only.

- **Как се ползва:** Install Base44 from App Store / Google Play and sign in with the same account.
- **Ограничения / план:** Domain and security settings not available on mobile.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Mobile-experience · https://base44.com/changelog/feature/base44-mobile-app-

## Plans and pricing (8)

### Free plan

$0 plan with 25 message credits/month (capped at 5 credits per day), 100 integration credits/month, up to 5 apps, core features (authentication, database, analytics). Since 6 Feb 2026 new private apps cannot be created on Free (Starter or above required). Automatic AI fixes and 'Resolve with AI' consume message credits on Free (free on paid plans).

- **Как се ползва:** Sign up at app.base44.com; plan shows in Settings > Plan and billing. Daily cap: once 5 credits are used, credit-consuming actions pause until the daily balance resets while monthly credits remain.
- **Ограничения / план:** 25 msg credits/mo, 5/day; 100 integration credits/mo; max 5 apps; no new private apps; no backend functions, no custom domain, no GitHub, no model selection, no in-app code edits.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans · https://docs.base44.com/Account-and-billing/Credits · https://github.com/Amal-David/docingest/blob/main/server/storage/docs/docs.base44.com/documentation_2026-07-07T03:54:54.947Z.md

### Starter plan

Entry paid plan: $20/month billed monthly or $16/month billed yearly; 100 message credits and 2,000 integration credits per month; unlimited apps; in-app code edits; can create private apps. Does not include backend functions, GitHub integration, model selection or custom domain (custom domain listed for Starter only by one third-party source).

- **Как се ползва:** Settings > Plan and billing > Upgrade Plan > choose Starter > choose Yearly or Monthly > Continue to Checkout.
- **Ограничения / план:** 100 msg / 2,000 integration credits per month; no Builder+ features.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans · https://raw.githubusercontent.com/benjamincanac/whichcodingtools/main/content/tools/base44.yml · https://raw.githubusercontent.com/edgarstool/edgars-mcp/main/docs/BASE44-HONGDOULANG-DEEP-RESEARCH.md

### Builder plan (the 'Builder+' tier)

$50/month monthly or $40/month yearly; 250 message credits and 10,000 integration credits per month. First tier with Backend functions, Connect a domain, GitHub integration, Model selection, in-app code edits, unlimited apps; yearly plan adds a free domain for 1 year and 25 credits to share with a friend. 'Builder+' in the product UI means Builder plan or higher.

- **Как се ползва:** Settings > Plan and billing > Upgrade Plan > Builder. Features marked 'Builder+' in the editor (e.g. the Select model menu) unlock immediately after payment.
- **Ограничения / план:** 250 msg / 10,000 integration credits; code export button only visible on Builder, Pro or Elite (community report).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans · https://raw.githubusercontent.com/benjamincanac/whichcodingtools/main/content/tools/base44.yml · https://raw.githubusercontent.com/edgarstool/edgars-mcp/main/docs/BASE44-HONGDOULANG-DEEP-RESEARCH.md

### Pro plan

$100/month monthly or $80/month yearly; 500 message credits and 20,000 integration credits per month. All Builder features plus Early access to beta features; yearly plan includes free 1-year domain and 25 credits to share with a friend.

- **Как се ползва:** Settings > Plan and billing > Upgrade Plan > Pro.
- **Ограничения / план:** 500 msg / 20,000 integration credits per month.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans · https://raw.githubusercontent.com/benjamincanac/whichcodingtools/main/content/tools/base44.yml · https://raw.githubusercontent.com/edgarstool/edgars-mcp/main/docs/BASE44-HONGDOULANG-DEEP-RESEARCH.md

### Elite plan

$200/month monthly or $160/month yearly for the base tier; 1,200 message credits and 50,000 integration credits per month. On the Plans page a drop-down lets you choose a higher amount of message and integration credits. Adds Premium support on top of Pro features. Highest plan purchasable directly; cannot be upgraded further (contact the Base44 team for enterprise).

- **Как се ползва:** Settings > Plan and billing > Upgrade Plan > Elite > use the drop-down to pick a credit amount > checkout.
- **Ограничения / план:** Base 1,200 msg / 50,000 integration credits; larger bundles via drop-down (amounts not documented publicly).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans · https://raw.githubusercontent.com/benjamincanac/whichcodingtools/main/content/tools/base44.yml · https://raw.githubusercontent.com/edgarstool/edgars-mcp/main/docs/BASE44-HONGDOULANG-DEEP-RESEARCH.md

### Enterprise plan

Contact-sales plan with custom credits, dedicated architect/account manager, priority support with guaranteed response times, SSO (workspace and app-level), SCIM provisioning, IP allowlist, workspace domain, data residency (US/EU/UK), member credit limits (default + per-member overrides), connector management, Superagent controls, publishing permissions, workspace secrets and Monitoring/Audit Logs APIs, tailored onboarding, private hosting.

- **Как се ползва:** base44.com/enterprise > Contact sales. Admins then configure features under Settings (Members, Auth and security, etc.).
- **Ограничения / план:** Custom pricing; member Credit limit column only on Enterprise workspaces; Admin role reverts to Editor if the workspace downgrades.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Enterprise/enterprise-overview · https://docs.base44.com/Enterprise/managing-enterprise-members · https://github.com/Amal-David/docingest/blob/main/server/storage/docs/docs.base44.com/documentation_2026-07-07T03:54:54.947Z.md

### Yearly billing discount and yearly-only perks

Yearly billing is 20% cheaper (the per-month yearly price is shown by default on the pricing page). Yearly Builder/Pro/Elite plans also include a free domain for 1 year (claimed via Dashboard > Domains > Buy Domain) and 25 credits to share with a friend. Yearly fees are non-cancelable and non-refundable; switching yearly->monthly is not self-service.

- **Как се ползва:** Choose 'Yearly' in the billing-cycle step at checkout, or Manage Subscription > Upgrade to Yearly (prorated, no double charge).
- **Ограничения / план:** Free domain excludes most ccTLDs and depends on region; switching to yearly does not reset mid-month credits.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans · https://raw.githubusercontent.com/benjamincanac/whichcodingtools/main/content/tools/base44.yml

### Backend service (CLI/backend-only) pricing

The developer backend service (CLI-defined entities, functions, connectors, auth, sites) is in beta and free; it has no separate subscription and consumes the workspace's integration credits.

- **Как се ползва:** Install the base44 CLI (npm 'base44'), run base44 create/deploy; usage appears under integration credits.
- **Ограничения / план:** Beta; CLI projects are not integrated into the app editor.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/developers/backend/overview/pricing · https://docs.base44.com/developers/references/cli/get-started/overview · https://www.npmjs.com/package/base44

## Weaknesses (reviews) (8)

### Complaint: credit burn in debugging loops

The most frequent complaint. Reddit: '50+ credits trying to fix something that should have been fixed in a couple of prompts', 'most credits going to debugging', 'burned a lot of credits ... damaging rollbacks'; '50+ AI message credits' on a login flow; Trustpilot reviewer: 'redoes issues 50 times and is still not fixed'; HN: 'they charge by the token so if you hit a wall ... you run up a huge bill'. Docs confirm credits are non-refundable for AI mistakes and that usage is calculated after the fact with no preview. Users also report end-user actions in live apps silently consuming integration credits.

- **Как се ползва:** n/a
- **Ограничения / план:** Base44's partial mitigations: Discuss mode 0.3 credits, free auto-fixes on paid plans, 'no-charge policy on app bugs' changelog feature.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.reddit.com/r/Base44/comments/1mxo0bj/has_base44_become_more_broken_over_time/ · https://www.reddit.com/r/Base44/comments/1luld15/does_base44_actually_work/ · https://www.reddit.com/r/Base44/comments/1md2jmc/subject_urgent_unacceptable_delay_and_credit/

### Complaint: lock-in and limited export ('you own your apps... but do you really?')

Users say ownership marketing is misleading: no standalone executable, backend (database, auth, storage, functions runtime) cannot be exported or self-hosted; export is frontend + function code + CSVs and requires @base44/sdk; GitHub sync was described as 'a one way trip' in 2025 (two-way sync later added); export only on Builder+. Evaluations rate exported apps as unable to run with standard npm commands without Base44 infrastructure. A counter-view: generated React code is 'fairly portable', migration difficulty 3/10 with Deno->Node rewrite of functions. Third-party 'escape Base44' migration tools exist (base44-to-supabase SDK, Independence Engine).

- **Как се ползва:** n/a
- **Ограничения / план:** Export/GitHub require Builder+; CLI 'eject' clones into a new app ID (still Base44 backend).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.reddit.com/r/Base44/comments/1n4esrs/base44_says_you_own_your_apps_but_do_you_really/ · https://www.reddit.com/r/Base44/comments/1lron1x/migrating_away_from_base44/ · https://www.reddit.com/r/Base44/comments/1mkf0fu/base44_to_real_saas_app/

### Complaint: exported code quality

A user who pulled a project off Base44 reported 'half their fake folders and magic components were never actually real... Imports were a disaster, pathing all over the place', undefined values and WebSocket drops, plus the default client setup causing redirect loops; another 2025 user noted you could not edit index.jsx or other 'system' files or create new files. Independent analysis counters that the React frontend is standard, while backend functions need Deno->Node conversion.

- **Как се ползва:** n/a
- **Ограничения / план:** n/a
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://www.reddit.com/r/Base44/comments/1n48ujr/escaping_base44_my_little_adventure/ · https://www.reddit.com/r/Base44/comments/1lron1x/migrating_away_from_base44/ · https://raw.githubusercontent.com/debraj-m/reddit_analyser/main/knowledge/blog/vendor-lock-in-ai-platforms.md

### Complaint: bugs, regressions and production breakage

Recurring reports that AI edits change unrelated pages/designs ('asks to fix function stuff on one page, changes designs on other pages'), 'one step forward 10 steps back'; platform changes breaking live apps (signup, Stripe, connectors), deployments stuck on an old bundle after GitHub sync, Google OAuth redirecting to app.base44.com instead of the custom domain, white screens, stuck 'Thinking...'. Users mitigate with Freeze Files (file locking) and Discuss mode. The Troubleshooting doc itself lists many of these failure modes.

- **Как се ползва:** n/a
- **Ограничения / план:** Mitigations: Freeze Files, Custom Instructions, Revert/Version History, Auto approve toggle for low-risk actions.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.reddit.com/r/Base44/comments/1mxo0bj/has_base44_become_more_broken_over_time/ · https://www.reddit.com/r/Base44/comments/1q5plx3/base44_is_breaking_apps_in_production_existing/ · https://www.reddit.com/r/Base44/comments/1tnip39/base44_deployment_stuck_on_old_bundle_github/

### Complaint: data loss, outages and security incident

Aug 19-20 2025: entity data appeared to 'vanish' for many apps ('complete meltdown of the base44 management of databases'); Base44 asked users on Discord not to spend credits trying to fix it and restored from backup. A 2026 thread reports 'erasing user data'. July 2025: Wiz disclosed a critical auth-bypass flaw (anyone with an app_id could register as collaborator on private apps), fixed within 24 hours. A 'Burnt out on Base44' founder cites 'data loss... terrible support... security issues'.

- **Как се ползва:** n/a
- **Ограничения / план:** Docs note app data is not end-to-end encrypted; status page exists.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://www.reddit.com/r/Base44/comments/1mvb7sc/base44_critical_outage/ · https://www.reddit.com/r/Base44/comments/1muwpmo/according_to_the_base44_discord_there_is_a_backup/ · https://www.reddit.com/r/Base44/comments/1t4mv21/great_potential_but_erasing_user_data_and_60/

### Complaint: slow or unresponsive support

Paying users report tickets unanswered for 11 days ($50/mo), over a week ($200/mo Elite), 4 days, and 'generic info' replies; Trustpilot: 'My account was completely blocked without any warning... Apps gone'. Base44's own support page says response times vary and that support does not debug app code. Trustpilot score reported at 2.8/5 (2026). An r/SaaS thread alleges subreddit reviews look fake.

- **Как се ползва:** n/a
- **Ограничения / план:** Premium/priority support only on Elite/Enterprise.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://www.reddit.com/r/Base44/comments/1luld15/does_base44_actually_work/ · https://www.reddit.com/r/Base44/comments/1mto3qs/base44_customer_service_suck/ · https://www.reddit.com/r/Base44/comments/1m2fsgp/deployment_of_app_built_with_base44_to_apple_and/

### Complaint: design quality and branding limits

Fewer complaints than credits/lock-in. A 2026 review notes 'branding on login screens is limited on lower-tier plans' and that complex logic needs many corrective prompts; a designer reported difficulty getting the AI to match a pre-designed brand/UX; users report layouts 'constantly changing' and the AI redesigning untouched pages; the 'Platform Badge - Hide Badge' control exists on the Dashboard Overview (owner screenshot) and the preview URL carries hide_badge=true. Base44's homepage marketing emphasizes function over design; the mobile output is a web view without push notifications.

- **Как се ползва:** Dashboard > Overview > Platform Badge > Hide Badge; Edit mode for manual styling.
- **Ограничения / план:** Badge-hiding plan gating not confirmed in docs.
- **Увереност:** low · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/baeseokjae/baeseokjae.github.io/main/content/posts/base44-review-2026.md · https://www.reddit.com/r/nocode/comments/1mtc3zw/best_tool_for_designers_that_want_to_build_an_app/ · https://www.reddit.com/r/Base44/comments/1mto3qs/base44_customer_service_suck/

### Complaint: domain connection and mobile/app-store friction

Users report custom-domain verification stuck on 'Pending' with non-working Validate/Check Status buttons, slow GoDaddy transfers; iOS/Android store submission confusion and native-feature gaps (web view, no push, no offline), with store wrapping handled outside Base44.

- **Как се ползва:** n/a
- **Ограничения / план:** Domain connection Builder+; app-store path documented but uses wrappers (Capacitor/PWABuilder/TWA).
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://www.reddit.com/r/Base44/comments/1mnvjfu/imho_ive_not_had_a_positive_experience_with_this/ · https://www.reddit.com/r/Base44/comments/1n5eduf/how_long_did_domain_transfer_take_from_godaddy/ · https://www.reddit.com/r/Base44/comments/1s72dx7/ios_mobile_app/

## Edit mode (7)

### Edit toolbar: Colors

Change background or text color of a selected element, picking from the color roles defined in the app theme (background, foreground, card, primary, etc.).

- **Как се ползва:** In Edit mode select an element, click the Colors icon in the Edit toolbar, choose the part (background/text) and pick a color role.
- **Ограничения / план:** For image elements the toolbar shows Replace instead of Colors.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Design

### Edit toolbar: Typography

Controls for font family and size, alignment (left/center/right/justify), case (none/uppercase/lowercase/capitalize) and decoration (none/underline/strikethrough/italic) on text elements.

- **Как се ползва:** Select a text element in Edit mode; typography controls appear in the Edit toolbar.
- **Ограничения / план:** Text elements only.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Design

### Edit toolbar: Text Content (T icon)

Edit the literal text of an element in a Text Content field. Dynamically generated text cannot be edited directly; the panel says so and points to AI chat.

- **Как се ползва:** Edit > select text element > click the T icon > type in the Text Content field.
- **Ограничения / план:** Not available for dynamic text.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Design · https://feedback.base44.com/p/visual-edits-change-text

### Edit toolbar: Spacing, Corner radius, Opacity

Set margin and padding per side in px; round corners by entering a px value; set opacity via slider or value 0-100.

- **Как се ползва:** Select an element in Edit mode and use the respective toolbar icons.
- **Ограничения / план:** None documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Design

### Edit toolbar: Tailwind classes

Enter any Tailwind CSS class directly on the selected element (e.g. shadow-lg, border border-gray-200) for styling not covered by other controls.

- **Как се ползва:** Select an element in Edit mode, open the Tailwind classes control and type classes.
- **Ограничения / план:** None documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Design

### Edit toolbar: Replace image

For standalone image elements the toolbar shows a Replace button to swap the image. Does not work for images inside components (e.g. gallery), where AI chat or Data in the dashboard must be used.

- **Как се ползва:** Edit > click an image > Replace > choose a new image.
- **Ограничения / план:** Standalone images only.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Design · https://docs.base44.com/Building-your-app/Using-media

### Visual edit auto-save and undo/redo (50 steps)

Rebuilt in March 2026: visual edits save automatically; undo and redo up to 50 steps within the same visual edit session using the undo/redo buttons at the top of the editor; edits persist through preview reloads; a browser warning appears if you leave with unsaved changes. Manual edits also appear in Version History so a previous set can be restored.

- **Как се ползва:** Use the undo/redo arrows in the top bar while in Edit mode, or Cmd/Ctrl+Z and Shift+Cmd+Z / Ctrl+Y.
- **Ограничения / план:** 50 steps per session.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product · https://docs.base44.com/Building-your-app/Design · https://base44.com/changelog/feature/visual-edits

## Dashboard > App Users (6)

### App Users page (Users list)

Table of the people registered in or invited to the live app with their email, name, role and profile details. Users can arrive via invitation or the public signup page. The built-in Users list is locked down so only collaborators and the app owner can read it. You can change roles or remove users directly from the table.

- **Как се ползва:** Dashboard > App Users (docs call it 'Users').
- **Ограничения / план:** Being an Admin or User in the app does not grant editor/dashboard access.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-access · https://docs.base44.com/Setting-up-your-app/Managing-security-settings · https://docs.base44.com/developers/backend/resources/entities/user-schema

### Roles: Admin and User

Every app ships with two roles. Admin: manages areas of the live app restricted to admins. User: views and uses the app with no special permissions. Role is stored in the built-in 'role' field of the User entity (values admin or user).

- **Как се ползва:** Set at invite time (Access level) or later: Users > select user > Role drop-down > Admin or User > Submit.
- **Ограничения / план:** Only two built-in roles.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-access · https://docs.base44.com/developers/backend/resources/entities/user-schema

### Change user role

Switch an existing user between Admin and User.

- **Как се ползва:** Dashboard > Users > select the user > Role drop-down > Admin or User > Submit.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-access

### Remove user

Delete a user's access to the live app from the Users list.

- **Как се ползва:** Dashboard > Users > Delete icon next to the person.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-access · https://docs.base44.com/Community-and-support/Deleting-user-data

### Access requests and approval

When someone opens a Private app without permission they see a pop-up to request access. Base44 emails them a verification code; after they verify, the owner gets a notification, reviews the request and approves or denies it; approval is sent by email.

- **Как се ползва:** Owner receives notification > review request > approve/deny.
- **Ограничения / план:** Only for Private apps.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-access

### Groups tab (share app with workspace groups)

Give a whole workspace or IdP group access to the app at once with a chosen role; membership stays in sync as people join/leave. The Groups tab lists each group with type, member count and role; you can change the role or remove access.

- **Как се ползва:** Dashboard > Users > Groups tab > add group > choose role.
- **Ограничения / план:** Enterprise feature; IdP groups need workspace SSO.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-access · https://docs.base44.com/Enterprise/managing-enterprise-members

## Dashboard > Analytics (6)

### Analytics — Traffic Overview tab

Top metrics: Total visits, Unique visitors, Visit duration (average), Live visitors (real time). Cards break data down by pages visited, visitor location (country), referral source, OS and device, plus custom events/properties. Advanced filtering slices the data.

- **Как се ползва:** Dashboard > Analytics > Traffic Overview.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/documentation/performance-and-seo/app-analytics · https://base44.com/changelog/feature/upgraded-analytics

### Analytics date range picker

Calendar icon with presets or custom dates to change the period in Traffic Overview.

- **Как се ползва:** Analytics > Calendar icon > preset or custom range.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/documentation/performance-and-seo/app-analytics

### Custom events

Track specific actions (button clicks, sign-ups, form submissions, purchases, feature usage) via the SDK analytics module; they appear as custom event cards in Traffic Overview only.

- **Как се ползва:** Ask the AI or call base44.analytics track; view cards in Analytics.
- **Ограничения / план:** Not shown in Sales Overview.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/documentation/performance-and-seo/app-analytics · https://docs.base44.com/developers/references/sdk/docs/interfaces/analytics

### Analytics — Sales Overview tab

Payment metrics for Stripe: Total payments, Transactions, Customers, Refunds; charts for Payments by day of week (avg), Top customers, Recent transactions; per-currency drop-down.

- **Как се ползва:** Dashboard > Analytics > Sales Overview.
- **Ограничения / план:** Stripe only for now (Wix Payments planned).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/documentation/performance-and-seo/app-analytics · https://docs.base44.com/Setting-up-your-app/tracking-payments

### Session recordings tab

Replay real visitor sessions; flags rage clicks, dead clicks and errors; AI summaries of sessions.

- **Как се ползва:** Turn on in app settings, then Analytics > Session recordings.
- **Ограничения / план:** Builder plan and above; up to 500 sessions per 30 days; recordings stored 30 days; up to 50 AI summaries per month.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/documentation/performance-and-seo/session-recordings · https://base44.com/pricing

### Turn analytics off

You can ask the AI chat to switch analytics off for a web app or browser game.

- **Как се ползва:** Ask the chat to disable analytics.
- **Ограничения / план:** Requires SDK 0.8.46 or newer.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product

## Chat composer (5)

### Mode switch keyboard shortcut (Cmd+. / Ctrl+.)

Keyboard shortcut to cycle chat modes (Build / Discuss / Plan) without leaving the prompt box, even while a prompt is being typed.

- **Как се ползва:** Press Cmd+. on macOS or Ctrl+. on Windows and Linux while the composer is focused.
- **Ограничения / план:** None documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes

### Suggestions (next-step chips)

The AI chat suggests useful next steps as you build; suggestion chips appear below the chat / above the composer, tailored to the current app and workflow (owner's screenshots: 'Добави форма запитване', 'Синхронизирай със срещи', 'Създай списък…'). Intended to help discover features and plan next steps.

- **Как се ползва:** After a build completes, click a suggestion chip to send it as the next prompt, or ignore them and type your own.
- **Ограничения / план:** Clicking a suggestion sends a normal Build prompt and uses message credits.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://base44.com/blog/base44-ai-app-builder

### Dictation (microphone speech-to-text)

Voice input for the builder chat: click the microphone icon in the chat box to turn on speech-to-text, speak your request, and the AI transcribes it and responds as usual.

- **Как се ползва:** Click the microphone icon in the composer, speak, then review/send the transcribed text.
- **Ограничения / план:** Supported languages not documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes

### Attach files ('+' menu) incl. screenshots and Google Drive

Attach images, PDFs, documents, spreadsheets and other files to a prompt so Base44 builds from your content, data or reference material. Documented uses: upload a screenshot of a website you like ('Use this header style for my homepage'), upload a color-palette image and ask the AI to apply the colors, upload data files to seed entities.

- **Как се ползва:** Click the '+' menu in the prompt box → 'Attach files' → upload from your computer or from Google Drive, then write the prompt.
- **Ограничения / план:** Images during building: PNG, JPG, JPEG, GIF, WEBP, SVG; max 40 MB (SVG 5 MB); max 1024x1024 px (larger images resized automatically).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Using-media · https://docs.base44.com/Getting-Started/starting-from-your-first-prompt · https://docs.base44.com/Building-your-app/Design

### Stop button

A Stop control replaces the send button while the AI works. Troubleshooting docs say to click Stop when the chat is stuck in a state such as 'thinking', 'applying changes' or 'undoing'.

- **Как се ползва:** Click the stop (square) button in the composer while a turn is running.
- **Ограничения / план:** Credits for the interrupted turn are not documented as refunded.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Community-and-support/Troubleshooting · https://www.appstuck.com/blog/base44-stuck-thinking-fix-2026

## Dashboard > Settings > Authentication (5)

### Authentication settings: Email & password

Built-in email/password sign-in with ready-made login, register, forgot-password and reset-password pages that can be customized. Registration sends an OTP to the email which must be verified. Passwords handled by Base44. Login methods can be toggled on/off (also via CLI auth config pull/push).

- **Как се ползва:** Dashboard > Settings > Authentication > toggle login methods.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-login-and-registration · https://docs.base44.com/developers/skills/base44-sdk/references/auth

### Google login (default vs custom OAuth)

Two ways: Default Google login uses Base44's credentials (the Google window shows 'Sign in with Google' branded base44.com); Custom Google OAuth connects your own Google Cloud client ID and secret so the consent screen shows your brand. Google verification of a custom OAuth app can take up to 5 days.

- **Как се ползва:** Dashboard > Settings > Authentication > Google > choose default or enter client ID/secret.
- **Ограничения / план:** Custom OAuth requires Google Cloud project and Google approval (up to 5 days).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-login-and-registration

### Social logins: Microsoft, Apple, Facebook

In addition to Google, apps can offer Microsoft, Apple ID and Facebook sign-in.

- **Как се ползва:** Enable the provider in Authentication settings (CLI: auth social-login).
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-login-and-registration · https://docs.base44.com/developers/references/cli/commands/auth-social-login · https://docs.base44.com/developers/backend/resources/auth

### Single sign-on (SSO) for your app

Let app users log in via Google, Microsoft, GitHub, Okta, Apple or any OIDC provider (Advanced / Manual configuration, e.g. Kakao or your own IdP). Enterprise workspaces configure SSO at workspace level instead.

- **Как се ползва:** Dashboard > Settings > Authentication > Set Up next to Single sign-on (SSO) > pick provider > enter client ID/secret/subdomain.
- **Ограничения / план:** Elite plan or higher.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Guides/Setting-up-SSO · https://docs.base44.com/Enterprise/Set-up-SSO

### Auto-admit SSO users

Toggle that automatically adds anyone who signs in through SSO to a Private app without individual invites or approvals. Per-app setting overriding the workspace default; off by default. Enterprise admins can set a workspace-wide default.

- **Как се ползва:** Authentication settings > 'Auto-admit SSO users' toggle.
- **Ограничения / план:** Works only when the app is Private, SSO is the only sign-in method and the user signs in via SSO.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-login-and-registration · https://docs.base44.com/Enterprise/Enterprise-SSO-and-app-visibility

## Agents (5)

### Agents (in-app AI agents)

Conversational AI agents that 'interact with users, access your app's entities, and call backend functions'. Config fields: `name` (lowercase alphanumeric + underscores, 1–100 chars), `description`, `instructions` (required); optional `tool_configs`, `memory_config`, `whatsapp_greeting`, `selected_skill_names`. Stored as `base44/agents/{agent_name}.jsonc`; synced with `base44 agents pull/push` (full replace of all agents) or auto-synced when written in the sandbox. Dashboard sidebar has an 'Agents' page (owner screenshot); the CLI dashboard doc says the dashboard manages 'entities, functions, agents, users, and settings'.

- **Как се ползва:** Ask the builder to create an agent, or write `base44/agents/support_agent.jsonc` and run `npx base44 agents push`; manage in Dashboard -> Agents.
- **Ограничения / план:** Push/pull 'replaces all agents, not individual ones'.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/agents-push.md · https://raw.githubusercontent.com/base44/cli/main/docs/resources.md

### Agent tools (entity tools and function tools)

`tool_configs` gives an agent access to entities (`entity_name` + `allowed_operations` array of read/create/update/delete) and backend functions (`function_name` + `description`).

- **Как се ползва:** Add entries to `tool_configs` in the agent .jsonc, or configure in the builder.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/agents-push.md

### Agent memory (memory_config)

Lets agents 'remember facts across conversations'. Fields: `enabled` (default true), `scope` ('global' | 'user' | 'both'), `include_other_conversation_context` (default false), `instructions` (string or null).

- **Как се ползва:** Set `memory_config` in the agent config.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/agents-push.md

### Agent Skills

'Agent skills are reusable instructions that extend what your app's AI agents know how to do.' Markdown files in `base44/agent-skills/{skill-name}.md` with frontmatter `description`; agents reference them by name via `selected_skill_names`. CLI: `base44 agent-skills pull/push`.

- **Как се ползва:** Create `base44/agent-skills/pdf-export.md`, run `npx base44 agent-skills push`, add the name to the agent's `selected_skill_names`.
- **Ограничения / план:** Name 1–64 chars matching /^[a-z0-9]+(-[a-z0-9]+)*$/; description 1–1,024 chars; body 1–15,000 chars.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/agent-skills-push.md · https://raw.githubusercontent.com/base44/cli/main/docs/resources.md

### Agent conversations SDK (in-app chat with realtime updates)

`base44.agents` methods: `createConversation({agent_name, metadata})`, `getConversations()`, `getConversation(id)` (full tool-call results), `listConversations(filter)` (filter/sort/paginate), `subscribeToConversation(id, onUpdate)` (WebSocket realtime, tool data truncated), `addMessage(conversation, message)`. Messages carry role, content, reasoning, tool_calls, file URLs and token usage. 'This module is for in-app agents — managed and conversational: app users talk to the agent and the platform runs the loop.' Also available as `base44.asServiceRole.agents` in backend functions.

- **Как се ползва:** Logged-in user: `const c = await base44.agents.createConversation({ agent_name: 'SupportBot' }); await base44.agents.addMessage(c, {role:'user', content:'Hi'}); base44.agents.subscribeToConversation(c.id, cb)`.
- **Ограничения / план:** 'Requires logged-in user'.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/base44-agents.md · https://www.npmjs.com/package/@base44/sdk

## Model picker (4)

### Select model menu (model picker in the chat composer)

A dropdown in the AI chat composer (labelled with the current model, default 'Auto') that opens the 'Select model' list: Auto mode, Base 1, Sonnet 5.5, Opus 5.5, Fable 5.1, Gemini 3.8 Flash, GPT-5.6 Terra, GPT-6.1 Sol, GPT 6 Astra and a 'Compare' entry. Since September 2026 both model pickers (AI chat and Superagent) group models by the company that makes them; Gemini 3.8 Flash sits directly under Fable 5.1. Docs: 'click the current model at the bottom of the panel to select the model you want to use, or keep Auto mode to let Base44 pick the best model for each request'.

- **Как се ползва:** In an app, open the AI chat, click the model name/'Auto' at the bottom of the chat panel, then click a model (or 'Compare'). The choice is applied to the next message.
- **Ограничения / план:** Choosing a model manually requires the Builder plan or higher ('Builder+' badge on every entry). Docs note 'Some models are rolling out gradually and may not be available to all accounts yet.' The picker is a paid feature that stops working if the workspace moves to the Free plan.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/changelog/product · https://docs.base44.com/Account-and-billing/Billing-and-plans

### Model button on the homepage prompt box (set model before first prompt)

On the Base44 homepage, below the prompt box, a 'Model' button lets you select the model (or keep Auto mode) before you send your very first prompt, so the first build uses the model you want. Announced on X on 19 Feb 2026 together with Gemini 3.1 Pro: 'you can now choose your preferred AI model from your very first prompt'. Since September 2026 you can also 'Compare' 2 models from the homepage prompt box and during onboarding.

- **Как се ползва:** Go to base44.com, type the first prompt, click 'Model' under the prompt box, pick a model or Auto mode (or Compare → two models), then send.
- **Ограничения / план:** Builder plan or higher to choose a model; Compare also Builder+.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Getting-Started/starting-from-your-first-prompt · https://x.com/Base44/status/2024520505018011874 · https://docs.base44.com/changelog/product

### Your model choice follows you (per-user model memory)

September 2026 changelog: 'The model you pick in the AI chat is now remembered for you rather than for the app, so your choice carries across your apps, main, and every branch. It does not change the model anyone else is working with.'

- **Как се ползва:** Pick a model once in any app's chat; it is pre-selected in your other apps and branches. Collaborators keep their own selection.
- **Ограничения / план:** Builder+ (needs manual selection).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product

### Gradual model rollout notice

AI chat docs state: 'Some models are rolling out gradually and may not be available to all accounts yet.' Base 1 in particular launched as a 'staged rollout' (June 2026).

- **Как се ползва:** If a model is missing from your Select model menu, it may not have reached your account yet.
- **Ограничения / план:** Per-account availability.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://techcrunch.com/2026/06/29/vibe-coding-platform-base44-launches-own-model-as-ai-startups-seek-defensibility/

## Chat messages (4)

### Thinking panel ('Thought for Ns')

Collapsible reasoning indicator on assistant turns showing how long the model thought (e.g. 'Thought for 2s' in owner's screenshots). Since August 2026 the thinking panel shows written reasoning summaries for GPT-5.6 Terra and Sol turns.

- **Как се ползва:** Send a prompt; the assistant message shows the thinking header which can be expanded to read the reasoning summary (for supported models).
- **Ограничения / план:** Written reasoning summaries documented only for GPT-5.6 Terra and GPT-6.1 Sol turns.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product · https://docs.base44.com/Building-your-app/AI-chat-modes

### Builder questions (clarifying questions with answer options)

When a prompt is short or ambiguous the AI can ask a few follow-up questions before building (e.g. 'What do you want to create?', 'What kind of business?'), offering clickable answer options; you pick one or switch to writing a custom answer. The changelog says Builder questions are available to everyone in the AI chat and these questions do not use message credits. The same question-with-options pattern was added to Superagents in July 2026. Owner's screenshots show an 'Asking for clarification…' status while this happens.

- **Как се ползва:** Send a brief prompt; answer the question chips or type your own answer; the build continues once the AI has what it needs. You can also send a message while a question is on screen.
- **Ограничения / план:** Clarifying questions do not consume message credits.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product · https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/Getting-Started/starting-from-your-first-prompt

### More actions menu under a prompt (Credits Used)

Each prompt has a 'More actions' icon that opens a per-message menu; under 'Credits Used' you see how many credits that specific message consumed. Owner's screenshots also show copy, branch and edit icons per message.

- **Как се ползва:** Hover a message, click the 'More actions' icon under it, read 'Credits Used'.
- **Ограничения / план:** None.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits · https://feedback.base44.com/p/need-update-to-documentation-on-finding-out-how-many-credits

### Progress statuses in chat ('Read N files', 'Planning…', 'Updated X, Y and N more')

While working, the assistant message streams status lines such as 'Read 5 files', 'Planning…', 'Asking for clarification…' and a summary like 'Updated the Inquiry, Header, and 4 more' (owner's screenshots). Docs confirm the AI reads project files before editing and that Plan mode tracks progress beside the conversation.

- **Как се ползва:** Observe the status lines under the current assistant turn; click a file/summary to inspect changes.
- **Ограничения / план:** None.
- **Увереност:** low · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/changelog/product

## AI Controls (4)

### Auto approve

Toggle described as 'Automatically approve low-risk actions'. With it on, most steps that would normally pause for your approval run on their own, while steps that need something from you still ask. It is an app-wide setting (everyone building in the app gets the same behavior) and your choice persists even if the default changes later. Anything that ran without asking is labeled 'auto-approved' in the chat; clicking the label opens the setting. Turning it off restores step-by-step review.

- **Как се ползва:** In the chat composer open the '…' menu (or click the current model at the bottom of the chat, then 'AI Controls' under Preferences) and switch 'Auto approve' on or off; the change applies immediately, nothing to save.
- **Ограничения / план:** Rolling out gradually; may not be available in every app editor yet.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes

### Freeze Files

Lock files so the AI does not modify them, protecting finished work. Files are grouped by type (pages, components, functions, entities, agents, workflows). Options: check individual files, 'Freeze folder' to lock everything in a folder, or 'Select all files' to lock the whole app. Locked items are listed under 'Frozen folders & patterns' with a 'Remove' action to unlock.

- **Как се ползва:** Click the current model at the bottom of the AI chat → 'AI Controls' under Preferences → 'Freeze Files' → tick files/folders → they appear under 'Frozen folders & patterns'; click 'Remove' to unlock.
- **Ограничения / план:** None documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://github.com/danarandall/ai-a11y-toolkit/blob/main/START-HERE.md

### Custom Instructions

Guidance the AI follows on every prompt in the app, such as tone, design standards or preferred behavior. Written once, applied to every interaction in that app. Also used to tell the AI which workspace skills to apply. For white-label/API customers, custom instructions are set per app in the Create app call.

- **Как се ползва:** Click the current model at the bottom of the AI chat → 'AI Controls' under Preferences → 'Custom Instructions' → enter instructions (one per line) → 'Save changes'.
- **Ограничения / план:** Per app, not per workspace.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/developers/white-label/skills-and-mcp · https://github.com/danarandall/ai-a11y-toolkit/blob/main/START-HERE.md

### AI Controls panel (Preferences)

Settings hub reached from the chat composer that groups: the model powering the chat, how often it stops to ask permission (Auto approve), which files it must not touch (Freeze Files) and rules it follows on every prompt (Custom Instructions). Positioned as the way to keep changes inside the areas you name.

- **Как се ползва:** Click the current model at the bottom of the AI chat, then 'AI Controls' under 'Preferences'.
- **Ограничения / план:** Model choice inside it requires Builder plan or higher.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://base44.com/blog/vibe-coding

## Code / CLI (4)

### link / create / scaffold (connect local code to a Base44 app)

`base44 link` links a local project to an existing Base44 project (`link --create` makes one); `base44 create` creates a new project from a template (templates include backend-only and `backend-and-client`); `project scaffold` reuses an existing app id. Config lives in `base44/.app.jsonc` and `base44/config.jsonc`. Node.js >= 20.19.0.

- **Как се ползва:** `npm install -g base44` or `npx base44 create my-app -p ./my-app -t backend-and-client`; `npx base44 link`.
- **Ограничения / план:** CLI and backend service 'currently in beta'.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/cli · https://github.com/base44/openclaw-onboarding · https://raw.githubusercontent.com/base44/cli/main/docs/commands.md

### dev (local backend) and exec (server-side scripts)

`base44 dev` 'always starts the Base44 backend locally' (default port 4400), watches local resources and reloads them, optionally runs the frontend (`site.serveCommand`) injecting VITE_BASE44_APP_ID / VITE_BASE44_APP_BASE_URL; `--remote` serves only the frontend against the production backend. `base44 exec` 'reads a script from stdin and runs it server-side with the Base44 SDK pre-authenticated as the currently logged-in user'; `--local` targets a dev server; `--privileged` bypasses RLS.

- **Как се ползва:** `npx base44 dev` / `npx base44 dev --remote`; `echo 'console.log(await base44.entities.Task.list())' | npx base44 exec`.
- **Ограничения / план:** Requires linked project (`base44/.app.jsonc`).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/dev.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/exec.md

### types generate (TypeScript types from app resources)

'Generate TypeScript types from project resources' — fills registries such as AgentNameRegistry so `base44.agents.createConversation({ agent_name })` autocompletes.

- **Как се ползва:** `npx base44 types generate`.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/cli · https://www.npmjs.com/package/@base44/sdk

### CLI --json machine-readable mode

'Every command accepts' `--json`: stdout is a single JSON document, prompts/spinners suppressed, diagnostics to stderr, errors as `{ "error", "code", "hints" }`.

- **Как се ползва:** `base44 sandbox ls src --app-id app_123 --json | jq '.entries'`.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/cli

## Entities / database (4)

### Entities (database)

Base44's data layer. Each entity is a JSON-Schema-like definition (name, type: object, properties, required) stored as base44/entities/<kebab-case>.jsonc in CLI/sandbox projects or created via the builder chat and shown in the Dashboard 'Data' page. Field types: string, number, integer, boolean, array, object, binary; string formats: date, date-time, time, email, uri, uuid, file, richtext; validators: enum/enumNames, minLength/maxLength/pattern, minimum/maximum, items, $ref, default. Every record gets server-injected fields id, created_date, updated_date, created_by (email), created_by_id, is_sample. Untyped properties ({}) are accepted by the platform as 'any' (CLI validation currently rejects them, issue #636).

- **Как се ползва:** In the builder: ask the chat to create data models, then open Dashboard → Data to view/edit rows. In code: add base44/entities/task.jsonc and run `npx base44 entities push -y` (full, destructive sync) or write the file in the cloud sandbox (auto-deploys in ~5 s). Access via base44.entities.Task.*
- **Ограничения / план:** Entity names PascalCase alphanumeric only; file names kebab-case; field names snake_case. entities push replaces ALL remote entities.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/entities-create.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sandbox/SKILL.md

### Entity CRUD and query API (SDK entities module)

base44.entities.<Entity> exposes list(sort, limit, skip, fields | options), filter(query, sort, limit, skip, fields | options), get(id), count(query), create, bulkCreate, update, bulkUpdate, updateMany(query, data) with MongoDB operators ($set, $inc…), upsert(records, {key}), delete, deleteMany(query), aggregate(spec with groupBy 1–4 fields, dateBucket, count/sum/avg/min/max/countDistinct, having, sort, limit), importEntities(file) (CSV/Excel import), subscribe(callback). Query operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $and, $or, $nor, $exists, $regex, $not, $all, $size. Sort is a field name with optional '-' prefix. Cursor pagination via GET /v2/list returns {items, next_cursor, has_more}. REST base: /apps/{appId}/entities/{Entity}.

- **Как се ползва:** `const rows = await base44.entities.Task.filter({status:'todo'}, '-created_date', 50)`; `await base44.entities.Task.list({limit:100, cursor})`.
- **Ограничения / план:** list/filter max 5,000 items per request (default page 100); bulkCreate/bulkUpdate/upsert 500 records per request; aggregate up to 1,000 rows; distinct values 1,000 per page.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/entities.ts · https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/entities.types.ts · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/entities.md

### Realtime entity subscriptions

EntityName.subscribe(callback) streams create/update/delete events over a socket.io WebSocket (mount path ws-user-apps/socket.io/). Event shape: {type: 'create'|'update'|'delete', data, id, timestamp}. Returns an unsubscribe function.

- **Как се ползва:** `const unsub = base44.entities.Task.subscribe(evt => ...); unsub();`
- **Ограничения / план:** Not stated.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/entities.md · https://raw.githubusercontent.com/base44/javascript-sdk/main/src/client.ts

### Data environments (dev / prod) and preview env

The SDK/CLI expose an X-Data-Env header ('dev' or 'prod'), `exec --data-env`, and `logs --env prod|preview`, indicating separate preview/dev data from production. Users have requested full multi-environment (dev/staging/prod) isolation (discussion #158, unanswered).

- **Как се ползва:** `npx base44 exec --data-env dev < script.ts`; `npx base44 logs --env preview`.
- **Ограничения / план:** No official multi-environment/staging feature; branches exist in the builder ('Main' branch in owner screenshot).
- **Увереност:** low · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/javascript-sdk/main/src/client.ts · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/exec.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-troubleshooter/SKILL.md

## Local development (4)

### Base44 CLI (npm 'base44')

Beta CLI (`npm i -g base44` or `npx base44`, Homebrew `brew install base44/tap/base44`; Node ≥20.19.0; latest GitHub release v0.1.25, 1 Oct 2026). Commands: login (device-code)/logout/whoami; create (templates backend-and-client = Vite+React+Tailwind, backend-only), scaffold, link [--create --name --app-id --workspace], eject, deploy [--build|--no-build] [-y], build, site deploy/open, entities push, functions deploy/list/pull/delete, actors deploy/delete, agents push/pull, agent-skills push/pull, connectors list-available/initiate/push/pull, auth password-login/social-login/sso/push/pull, secrets list/set/delete, exec, logs, workflows list/runs, types generate, visibility, workspace list/get/move, dashboard open, sandbox ls/read/write/edit/grep/run/checkpoint. Global flags --app-id, --json, -y. Env vars BASE44_APP_ID, BASE44_API_KEY (workspace API key prefix b44k_), BASE44_ACCESS_TOKEN/REFRESH_TOKEN, VITE_BASE44_APP_ID; BASE44_PROJECTS_* (Stripe Projects / projects.dev provisioning) auto-normalized. Installs base44/skills agent skills on create.

- **Как се ползва:** `npx base44 login && npx base44 create my-app -p ./my-app -t backend-and-client`, then `npx base44 deploy --build -y`.
- **Ограничения / план:** Beta; SPA hosting only (all routes from index.html); deploy order visibility→entities→functions→actors→skills→agents→auth→connectors→site.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/cli · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/create.md

### base44 dev (local backend emulator) and dev --remote

`npx base44 dev` starts a local Base44 backend (entities database, functions runtime, auth routes) on port 4400 (-p to change), watches base44/ resources and hot-reloads, and launches the frontend via site.serveCommand; local data is throwaway. `npx base44 dev --remote` runs only the frontend against the production backend (every write hits live data). `base44 exec < script.ts [--local --port --privileged --data-env dev|prod]` runs one-off server-side scripts with a pre-authenticated base44 global.

- **Как се ползва:** From a linked project (base44/.app.jsonc present): `npx base44 dev`.
- **Ограничения / план:** Requires linked project (not --app-id); shuts down when frontend exits. Open security issue #633: local dev server decodes JWTs without verifying signatures (local only).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/dev.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/exec.md · https://github.com/base44/cli/issues/633

### Eject (download managed app code)

`npx base44 eject` downloads the source of a builder-managed app (isManagedSourceCode !== false) into a local folder and links it to a newly created copy of the project in Base44, converting it to CLI-managed development. Dashboard 'Code' page shows the generated code in the builder.

- **Как се ползва:** `npx base44 eject` in an empty folder after `base44 login`.
- **Ограничения / план:** Only for managed (builder) apps; creates a copy; plan gating not documented.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/eject.md · https://github.com/base44/cli

### TypeScript type generation (base44 types generate)

`npx base44 types generate` reads base44/entities, functions, actors, agents, connectors and writes base44/.types/types.d.ts augmenting @base44/sdk with EntityTypeRegistry, FunctionNameRegistry, AgentNameRegistry, ConnectorTypeRegistry, ActorNameRegistry; auto-adds the path to tsconfig include.

- **Как се ползва:** Run after changing resources or as a pre-build step.
- **Ограничения / план:** Actor message types not generated (hand-author ActorRegistry); runs offline.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/types-generate.md

## Builder+ gating (4)

### Model selection (Select model menu, 'Builder+')

Builder plan and above can pick the AI model for the builder chat instead of 'Auto mode' (automatic routing). Owner's screenshot (3 Oct 2026) lists Auto mode, Base 1, Sonnet 5.5, Opus 5.5, Fable 5.1 ('Uses more credits'), Gemini 3.8 Flash, GPT-5.6 Terra, GPT-6.1 Sol, GPT 6 Astra ('Uses more credits') and 'Compare' (choose two models to compare), all tagged 'Builder+'. Docs recommend keeping Automatic because manually chosen models 'can use more credits'. Discuss mode always uses its own model at 0.3 credits regardless of selection. Base 1 is Base44's in-house model launched June 2026.

- **Как се ползва:** In the composer click the 'Auto' model button > Select model; pick a model or Compare.
- **Ограничения / план:** Builder plan or higher; premium models flagged 'Uses more credits'.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans · https://docs.base44.com/Account-and-billing/Credits · https://raw.githubusercontent.com/benjamincanac/whichcodingtools/main/content/tools/base44.yml

### Backend functions, custom connectors and workflows gated to Builder+

Backend functions (Deno serverless functions) are available on Builder and above and follow the plan of the app owner's workspace; on lower plans calls return 402 Payment Required. Catalog/custom (OAuth) connectors require Builder or higher. Base44's own SDK skill docs and community code confirm the 402 behaviour.

- **Как се ползва:** Upgrade to Builder; enable Backend Functions in app settings; ask the AI to create functions or use the CLI.
- **Ограничения / план:** Builder+; backend service (CLI/backend-only) itself is free beta and bills integration credits.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/connectors.md · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/integrations.md

### GitHub integration and code export gated to Builder+

GitHub two-way sync and ZIP code export are Builder-plan-and-above features; export button does not appear on Free or Starter. Only the app owner can connect GitHub; branch must be 'main'. Exports include frontend code, backend function code and per-table CSVs but not the managed auth/database runtime.

- **Как се ползва:** Dashboard > Code / GitHub; connect repo (owner only).
- **Ограничения / план:** Builder, Pro, Elite only.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans · https://docs.base44.com/developers/app-code/local-development/github · https://www.reddit.com/r/Base44/comments/1n5pus3/how_to_export_code_from_base44_for_all_the_newbies/

### Custom domain connection gated to Builder+; private apps gated to Starter+

'Connect a domain' is a Builder/Pro/Elite highlight (Buy Domain also available in-app). Since 6 Feb 2026 creating new private apps requires Starter or above; pre-existing Free private apps keep working but cannot toggle visibility without upgrading.

- **Как се ползва:** Dashboard > Domains > Add domain / Buy Domain; Dashboard > Overview > App Visibility.
- **Ограничения / план:** Domain: Builder+; Private apps: Starter+ (from 2026-02-06).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans · https://github.com/Amal-David/docingest/blob/main/server/storage/docs/docs.base44.com/documentation_2026-07-07T03:54:54.947Z.md · https://raw.githubusercontent.com/edgarstool/edgars-mcp/main/docs/BASE44-HONGDOULANG-DEEP-RESEARCH.md

## Discounts and promos (4)

### Promo codes, coupons and promotional credits

Promo codes must be applied before purchase/upgrade (checkout > 'Add promotion code'); coupon codes that add credits are redeemed in Settings > Credit usage > 'Redeem a coupon or gift card'. Base44 issues extra one-time credits for sign-ups and campaigns (e.g. hackathon codes such as BOSTON50 in 2026 and sponsor codes giving +10 credits). The owner's screenshot shows a '30% off' promo chip in the editor top bar (Oct 2026); its terms are not documented publicly. Promo codes cannot be combined with the student discount or applied to App Store purchases.

- **Как се ползва:** Settings > Plan and billing (apply before checkout) or Settings > Credit usage > Redeem a coupon or gift card > Apply.
- **Ограничения / план:** One-time/limited; not stackable with student discount.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans · https://docs.base44.com/Account-and-billing/Credits · https://raw.githubusercontent.com/DanielWLiu07/pomme/main/docs/BASE44.md

### Student and educator discount

Verified students/educators get 30% off for up to 12 months on monthly billing or 50% off the first year on annual billing, on Starter or Builder only, one time per verified academic email (.edu, .ac.uk, .ac.jp etc.), applied after a 6-digit email code and a short survey. Lost on cancellation; not combinable with promo codes; not available on App Store purchases. Higher-ed offering at base44.com/highered.

- **Как се ползва:** Click the discount banner on the Plans page (app.base44.com/billing) > verify university email > enter code > complete survey > subscribe to Starter or Builder.
- **Ограничения / план:** Starter/Builder only; first paid subscription only; 12 months (monthly) or 1 year (annual).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Student-discount · https://github.com/Amal-David/docingest/blob/main/server/storage/docs/docs.base44.com/documentation_2026-07-07T03:54:54.947Z.md

### Gift cards

Buy a Base44 gift card (preset or custom amount, emailed to recipient or printable) that the recipient redeems as a discount toward a subscription; applied at checkout or to the next invoice. Non-transferable, non-refundable; a credit card is still required at checkout.

- **Как се ползва:** Profile icon > Send a gift card > pick design/amount/delivery > checkout. Redeem: Settings > Credit usage > Redeem a coupon or gift card.
- **Ограничения / план:** Not available to all users yet.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans

### Affiliate Program

Earn commission for new subscribers via a unique referral link.

- **Как се ползва:** Sign up at base44.com/affiliates.
- **Ограничения / план:** Separate from the in-product referral credits.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Community-and-support/community · https://base44.com/affiliates

## Image generation (3)

### GenerateImage integration (AI image generation and editing)

Built-in Core integration that 'creates images using AI from text prompts or from flows in your app', for covers, thumbnails, illustrations or avatars. Images are PNG at approximately 1024px on the shorter side (dimensions vary by aspect ratio). You can pass `existing_image_urls` 'to edit one of them, match the style of a reference, or give the AI visual context'. Cost: '~1 credit per image' (integration credits). 'To choose the model, aspect ratio, resolution, or quality, use the AI Gateway image endpoints instead.' Community feedback requests seed support and higher resolution; one post reports output changed to 1024x1024 on 10 March.

- **Как се ползва:** Ask the AI chat to 'generate an image when…' or call `base44.integrations.Core.GenerateImage({ prompt, existing_image_urls })` in code; the result URL is stored/used by the app.
- **Ограничения / план:** ~1 integration credit per image (estimate, calculated after the run); Free plan has only 100 integration credits/month. Model/size control only via AI Gateway.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Integrations/built-in-integrations · https://docs.base44.com/Account-and-billing/Credits · https://docs.base44.com/developers/references/sdk/docs/type-aliases/integrations

### Image generation models: BytePlus Seedream 5.0 Lite and Pro

September 2026 changelog: 'BytePlus Seedream 5.0 Lite and Pro join image generation and editing. You can pick either by name, pass reference images, and get PNG or JPEG output.' Image and text generation share the unified model lineup. The default underlying image model is not named in the docs.

- **Как се ползва:** Via the AI Gateway image endpoints (or by asking the AI chat), specify 'Seedream 5.0 Lite' or 'Seedream 5.0 Pro' by name, optionally with reference images; choose PNG or JPEG.
- **Ограничения / план:** Integration credits per image vary by model ('exact usage varies based on the action and the selected AI model').
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://base44.com/changelog · https://docs.base44.com/changelog/product · https://docs.base44.com/Account-and-billing/Credits

### Images shown inline in Superagent chat

Changelog: 'When your Superagent sends an image, or links to one directly, chat now shows the picture itself instead of a link.'

- **Как се ползва:** Have the Superagent generate or link an image; it renders inline in the chat.
- **Ограничения / план:** Superagent feature; image generation costs integration credits.
- **Увереност:** low · статус: непотвърдено
- **Източници:** https://base44.com/changelog

## Chat modes (3)

### Build mode

Default chat mode. You type what you need and the AI acts right away on the app (edits code, adds features). Described as best for quick edits and feature requests. Build is selected by default in the prompt box and on the homepage 'Mode' dropdown.

- **Как се ползва:** Open the app editor; the mode menu in the composer shows 'Build' by default. Type a prompt and send. Switch modes with the mode dropdown or press Cmd+. (macOS) / Ctrl+. (Windows/Linux), even while typing.
- **Ограничения / план:** Uses message credits; no fixed cost per message (varies by action and selected model).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/Getting-Started/starting-from-your-first-prompt · https://www.websitebuilderexpert.com/vibe-coding/base44-review/

### Discuss mode

Brainstorm, clarify or explore ideas without changing the app. Depending on the question the AI answers directly or proposes a change for you to review; nothing is built until you approve it. Marketed as a context-rich mode for discussing, planning and analyzing with low credit usage.

- **Как се ползва:** Click the mode menu ('Build') in the composer and choose 'Discuss' (or Cmd+. / Ctrl+.). Ask questions or describe a change; if the AI proposes a change, approve it to have it built.
- **Ограничения / план:** Each Discuss message uses 0.3 message credits.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://base44.com/changelog/feature/discussion-mode · https://www.websitebuilderexpert.com/vibe-coding/base44-review/

### Plan mode

Turns a short conversation into a structured plan before anything is built. The AI asks about who the app is for, what it should do and what to include; it reacts to what you say, asks only about what is missing and suggests things you have not thought of. Most questions arrive as plain text (you can answer partly, skip or redirect); some arrive as a card of options when the answer is a concrete choice. A 'plan progress' panel beside the conversation tracks 4 sections and checks them off: intent and goal, audience and roles, core flows, design. You can send a message while a question is on screen and the AI takes it into account. Replaced the earlier fixed set of question cards (September 2026 changelog).

- **Как се ползва:** On the Base44 homepage prompt box (or in the editor before the first build) open the Mode dropdown (shows 'Build') and choose 'Plan'. Answer the AI's questions, adjust the plan, then let Base44 build it.
- **Ограничения / план:** Documented as 'turn on Plan mode before your first build'. Costs 'a fraction of a credit per message'.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Getting-Started/starting-from-your-first-prompt · https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/changelog/product

## History and rollback (3)

### Revert (per chat message)

Rolls the app back to the state just before a given AI change; all later changes are undone too.

- **Как се ползва:** Hover a message in chat history and click the Revert icon/link under it.
- **Ограничения / план:** None documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/Community-and-support/Troubleshooting

### Version History

Lists every saved version (per branch). For each version you can preview it, publish it to the live app without changing the current draft, revert the editor to it (replacing the draft), view its code, or jump to the chat message that created it. Since Sept 2026 each entry has 'Code changes' showing what changed, and you can compare current code against main or against the live published app; a branch can be compared from its row in the branch picker. Revert on a branch creates a new commit on that branch, leaving main untouched.

- **Как се ползва:** Click the Version History (history) icon at the top of the chat; on a version click the More Actions icon and choose Publish, Revert, View code or Code changes.
- **Ограничения / план:** Branch versions require Builder plan or higher (branches gating).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://base44.com/changelog/feature/improved-versioning-&-project-history · https://docs.base44.com/changelog/product

### Data version history (Backup & Restore)

Automatic snapshots of app data; review, download and restore earlier versions of an entity's records.

- **Как се ползва:** Dashboard > Data > version history / restore.
- **Ограничения / план:** Elite (7 days of history) and Enterprise (30 days) only.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Enterprise/data-version-history · https://docs.base44.com/Enterprise/backup-and-restore

## Comments (3)

### Comments (pinned to preview elements)

Introduced Aug 2026. Pin a comment to any element on the app preview; it starts a thread where collaborators reply, react (Add reaction icon), @mention people with app access, and resolve (More actions > Resolve). Everyone who can edit the app sees the same comments in real time; comments stay anchored to their element as the app changes.

- **Как се ползва:** Click the comments icon in the top bar, click an element in the preview, type a comment. Hover for reactions, More actions for Resolve.
- **Ограничения / план:** Mentions only list people with access to the app; invite others first. Plan gating not documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Commenting-on-your-app · https://docs.base44.com/changelog/product

### Send comment to chat

Hand a comment thread to the AI: Base44 reads the comment, looks at its screenshot and acts on it. Threads can be sent individually or up to 20 at once as a single request, processed one by one.

- **Как се ползва:** Open a thread and click the Send to chat icon; or multi-select threads and send up to 20.
- **Ограничения / план:** Max 20 threads per request.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Commenting-on-your-app

### Collaborator access modes for shared editing/comments

'Workspace members' lets anyone in the workspace become a collaborator on opening the app; 'Invited only' restricts to invited people. Base Code apps default to Workspace members, others to Invited only. Collaborators can use the editor and dashboard.

- **Как се ползва:** Dashboard > Settings / access settings > choose Workspace members or Invited only; or use the invite avatars in the top bar.
- **Ограничения / план:** None documented.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-access · https://docs.base44.com/Account-and-billing/Managing-your-workspaces

## Workflows (3)

### Workflows (multi-step automations)

'Workflows are the automation system' with triggers: cron schedules, entity triggers, connector events, in-app agent actions. Run records expose trigger types `scheduled`, `entity`, `connector`, `in_app_agent`, `app_user_auth`, `app_publish`, `app_payment`, `webhook`, `goal_file`, plus `manual`. Workflows are 'authored in the builder, not pulled/pushed from local files' (CLI is read-only). Each workflow has status `[active]`/`[paused]`, `totalRuns`, `consecutiveFailures`, `lastRunAt`, `lastRunStatus`, `statusReason`. Sidebar shows 'Workflows (New)' in the owner's screenshot. The Superagent bundle also has 'CreateWorkflowWidget' / 'Saving workflow...'.

- **Как се ползва:** Ask the builder chat to create a workflow or open Dashboard -> Workflows; inspect with `npx base44 workflows list`.
- **Ограничения / план:** 'Apps that predate Workflows (legacy automations) are not readable via this command'; `--limit` tops out at 200 with no paging. Visual editor details (conditions, branching UI) not verified.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/workflows-runs.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/workflows-list.md

### Workflow run history and failure details

`base44 workflows runs` lists runs with `runId, workflowId, workflowName, triggerType, status, startedAt, completedAt, durationMs, stepsCount, errorMessage, isTestRun, statusReason`. Statuses: running, completed, failed, cancelled. 'Failed runs display the task name and underlying error'; when a backend function failed the output includes the function's HTTP failure and the doc points to `base44 logs --function <name>`. List output shows e.g. 'last run failed at 2026-08-05T03:00:00Z (3 consecutive failures)'.

- **Как се ползва:** `npx base44 workflows runs --status failed --since 2d -n 50 --json`.
- **Ограничения / план:** Limit 1–200 ('Invalid limit ... Must be a number between 1 and 200'); default 30; no retry mechanism documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/workflows-runs.md · https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/workflows/runs.ts · https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/workflows/limit.ts

### Legacy automations (pre-Workflows apps)

Apps created before the Workflows system keep 'legacy automations'. CLI message: 'Workflows are not enabled for this app — it predates the Workflows system, so its automation runs are not readable via this command.'

- **Как се ползва:** n/a (older apps).
- **Ограничения / план:** Not readable by `workflows list/runs`.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/workflows/legacy-app.ts · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/workflows-list.md

## Auth (3)

### Email/password authentication with OTP verification

Built-in user auth. SDK auth module: loginViaEmailPassword(email, password, turnstileToken?), register({email, password, turnstileToken?, referralCode?}) → requires OTP email verification (verifyOtp({email, otpCode}), resendOtp(email)); login before verification returns 403. resetPasswordRequest(email), resetPassword({resetToken, newPassword}), changePassword({userId, currentPassword, newPassword}), me(), updateMe(data), isAuthenticated(), hasToken(), setToken(token, saveToStorage), logout(redirectUrl) (clears localStorage keys base44_access_token/token and HTTP-only cookie via /api/apps/auth/logout), redirectToLogin(nextUrl) to Base44's hosted login/signup page. Optional Cloudflare Turnstile bot protection. User entity fields: id, email, full_name, role, is_verified, disabled, is_service, app_id, custom data.

- **Как се ползва:** Builder: Dashboard → App Users / Security to toggle login. CLI: `npx base44 auth password-login enable|disable` then `auth push`.
- **Ограничения / план:** Rate limiting on OTP, password reset and login (429). Disabling the last method triggers a lockout warning.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/auth.ts · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/auth.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/auth-password-login.md

### Social login (Google, Microsoft, Facebook, Apple)

OAuth social providers toggled per app. SDK loginWithProvider('google'|'microsoft'|'facebook'|…, fromUrl) uses a popup flow inside iframes. Google supports custom OAuth credentials (--client-id, --client-secret / --client-secret-stdin / --env-file key google_oauth_client_secret); the secret goes to the secrets store, the client id to the local auth config.

- **Как се ползва:** `npx base44 auth social-login google enable [--client-id … --client-secret …]` then `npx base44 auth push`; or toggle in Dashboard → App Users/Security.
- **Ограничения / план:** SSO and social login are mutually exclusive.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/auth-social-login.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/auth.md

### SSO (Google, Microsoft, GitHub, Okta, custom OIDC)

Enterprise single sign-on for app users. Providers: google, microsoft (tenant id required), github, okta (domain required), custom OIDC (authorization, token, userinfo, JWKS endpoints + display name; optional discovery URL and scopes). Client secret stored in the secrets system. SDK: loginWithProvider('sso') → /apps/{appId}/auth/sso/login. Backend: asServiceRole.sso.getAccessToken(userId) and getIdToken(userId) return the IdP tokens for the user (on-behalf-of).

- **Как се ползва:** `npx base44 auth sso enable --provider okta --client-id … --client-secret … [--file config.json]`, then `auth push`; or Dashboard Security toggle.
- **Ограничения / план:** Shown as 'Elite' tier in the dashboard (user report on Builder plan, discussion #241); SDK docs say Okta/Azure AD/GitHub SSO available on Elite plans. Mutually exclusive with social login; disable deletes stored credentials.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/auth-sso.md · https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/sso.ts · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/sso.md

## Usage view (3)

### Credit usage page ('View usage')

Workspace-level usage dashboard: available Message credits and Integration credits for the current cycle, 'Message/Integration credit usage distribution by app' (ranked bar chart), 'Daily usage' chart with Message/Integration tabs, renewal date, and a 'Redeem a coupon or gift card' field. Remaining credits are also visible by clicking the Base44 logo at the top left of the editor.

- **Как се ползва:** Click workspace name (top left) > Settings > Credit usage (under Workspace). Members page summary cards also show 'Credits usage' and 'Top builders'.
- **Ограничения / план:** All plans; per-member 'Credit limit' column only on Enterprise.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits · https://docs.base44.com/documentation/using-your-workspaces/managing-workspace-members · https://github.com/Amal-David/docingest/blob/main/server/storage/docs/docs.base44.com/documentation_2026-07-07T03:54:54.947Z.md

### App usage page (per-app credit breakdown)

Per-app view of message and integration credit spend for the current cycle: 'This app', 'Other apps', 'Remaining', plus an Integration credits 'By source' breakdown (automations, AI, tools) with 'Show details' ranked list. This is the 'View usage' link on the Dashboard Overview seen in the owner's screenshots.

- **Как се ползва:** In the app editor click Dashboard > Overview > App usage (or 'View usage').
- **Ограничения / план:** All plans; credits are shared across all apps in the workspace.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits · https://github.com/Amal-David/docingest/blob/main/server/storage/docs/docs.base44.com/documentation_2026-07-07T03:54:54.947Z.md

### Credits Used per message

Each prompt in the chat exposes how many credits it consumed.

- **Как се ползва:** Click the More Actions icon under your prompt in the chat and read 'Credits Used'.
- **Ограничения / план:** All plans.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits

## Earn credits (3)

### Referral Program (Gift icon / 'Earn credits')

Share a referral link: the friend gets 10 bonus credits on sign-up, you get 10 credits once they publish their first app; max 5 friends. Referral credits do not renew and are wiped at the monthly reset (balance returns to plan amount). Links cannot be reset or corrected.

- **Как се ползва:** Click the Gift icon at the top right of the workspace > Copy referral link > share. (The Dashboard Overview also shows an 'Earn credits' entry per the owner's screenshot.)
- **Ограничения / план:** Only new accounts qualify; 5 referrals max; one-time credits.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Community-and-support/Referral-program · https://github.com/Amal-David/docingest/blob/main/server/storage/docs/docs.base44.com/documentation_2026-07-07T03:54:54.947Z.md

### Win Free Credits by sharing on LinkedIn or X

Earn 20 credits once per account by posting about your Base44 app on LinkedIn or X (account must have more than 100 followers). Credits are granted manually through a support ticket after approval.

- **Как се ползва:** Click the Base44 icon (top left of editor) > Win Free Credits > read Sharing Guidelines > post > copy post link > click 'support system' in the popup > submit ticket with the link.
- **Ограничения / план:** Once per account; >100 followers; manual approval via support escalation.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Credits

### Launchpad community showcase (win credits)

Community page where you submit a public, published app, browse and vote for apps; submissions can win credits and get featured.

- **Как се ползва:** Sidebar > Community > Launchpad > submit app (sign-in required to vote).
- **Ограничения / план:** App must be public and published.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Community-and-support/community · https://docs.base44.com/promoting-your-app/submitting-to-launchpad

## Auto routing (2)

### Auto mode ('Matched with the best AI model for each request')

Default model setting. Base44 'uses automatic model selection to match each request with the engine best suited for the job'. For small visual or copy tweaks it chooses fast, efficient models; for larger architectural changes or data flows it uses deeper reasoning models that can plan across files, entities and logic. Changelog detail: 'In automatic mode, Sonnet 5 runs for ongoing work, planning, and turns that involve images, and Opus 5 for your first message on plans that do not use cost-saving models.' The Dec 2025 blog describes the router as analysing task complexity and routing to the model 'best equipped to deliver the strongest results', with benefits 'Optimized performance' and 'Higher-fidelity code'. Base44 recommends keeping Auto unless you have a specific need, because credit usage stays efficient.

- **Как се ползва:** Leave the composer model on 'Auto' (default); nothing else to configure. Switch back by selecting 'Auto mode' in the Select model menu.
- **Ограничения / план:** Available on all plans (it is the only option on Free/Starter). Manual models 'may use more credits than Auto mode'. Whether Base 1 participates in Auto routing is not documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/changelog/product · https://base44.com/blog/update-smarter-building-with-automatic-optimization

### 'Cost-saving models' on lower plans (Auto routing variant)

The changelog's Auto-mode description says Opus 5 is used 'for your first message on plans that do not use cost-saving models', implying some plans route Auto mode to cheaper models. The docs do not say which plans these are.

- **Как се ползва:** N/A; implicit in Auto mode by plan.
- **Ограничения / план:** Undocumented which plans use cost-saving models (likely Free/Starter).
- **Увереност:** low · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product

## Agents models (2)

### Superagent model pickers (chat model and automation model)

For a Superagent 'you can choose the model your Superagent uses when it responds in chat, and separately choose the model it uses when it runs automations.' Opus 5 was added to the Superagent model picker (Aug 2026); GPT-5.6 Sol replaced GPT-5.5 as its GPT option (July 2026); picker groups models by company (Sept 2026).

- **Как се ползва:** Open the Superagent → customization/settings → set 'chat model' and 'automation model' separately.
- **Ограничения / план:** 'The available AI models depend on your plan' (Superagent docs); credit costs vary by model.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/superagents/customizing-your-superagent · https://docs.base44.com/changelog/product · https://docs.base44.com/Getting-Started/superagent

### Model picker in the in-app agent editor

Each in-app agent (Dashboard → Agents) has a model dropdown. 'For most agents you can use the Automatic option'; otherwise choose GPT-6 Luna, Gemini 3.8 Flash, GLM 5.2, Claude Sonnet 5.5, Claude Opus 5.5, GPT-6.1 Sol, GPT-6 Astra or Claude Fable 5.1. Sonnet 5.5 is 'the Sonnet option in both the AI chat and the agent editor'.

- **Как се ползва:** Dashboard → Agents → select agent → Model → pick → save. Costs show as integration credits per message.
- **Ограничения / план:** No plan gating; cost ~3 integration credits/message for Automatic, more for named models.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-agents-for-apps · https://docs.base44.com/changelog/product

## SDK / runtime AI (2)

### InvokeLLM model override (Core integration)

'By default, invokeLLM uses a standard model that balances quality and cost, but you can tell the AI chat inside Base44 to use a different supported model.' The SDK's `base44.integrations.Core.InvokeLLM({ prompt, model })` accepts an optional `model` that overrides the app-level model setting for that call; documented values have included gpt_5, gpt_5_mini, gpt_5_4, gpt_5_6_sol, gpt_5_6_luna, gemini_3_pro, gemini_3_flash, gemini_3_1_pro, claude_sonnet_4_6, claude_opus_4_6, claude_opus_4_7, claude_opus_4_8, and (Sept 2026) Claude Opus 5.5 / GPT 6 Sol / GPT 6 Luna. 'A more capable model uses more integration credits for each call.'

- **Как се ползва:** Ask the AI chat 'use Opus for the InvokeLLM call in X', or in code pass `model: '<id>'` to InvokeLLM.
- **Ограничения / план:** 'Every model invokeLLM offers is available on every plan, and your plan does not limit which one you pick, with cost controlled by credits instead.'
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Integrations/AI-integrations · https://docs.base44.com/developers/references/sdk/docs/type-aliases/integrations · https://docs.base44.com/changelog/developers

### AI Gateway (OpenAI-compatible access to Base44's managed models)

`base44.aiGateway.connection()` in backend functions 'returns a baseURL and token you can pass to any OpenAI-compatible client (like the openai SDK or the Vercel AI SDK) to call Base44's managed AI models.' Supported model ids include gpt_5_mini, gemini_3_flash, gpt_5_4, gpt_5_6_sol, gpt_5_6_luna, gemini_3_1_pro, claude_sonnet_4_6, claude_opus_4_6/4_7/4_8, plus Claude Opus 5.5, GPT 6 Sol and GPT 6 Luna (Sept 2026). The gateway also exposes image endpoints where you 'choose the model, aspect ratio, resolution, or quality'.

- **Как се ползва:** In a backend function call `base44.aiGateway.connection()`, pass baseURL/token to an OpenAI client, set the model id; use the image endpoints for image model/size control.
- **Ограничения / план:** Charged in integration credits per model; every plan.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/pt-BR/developers/references/sdk/docs/interfaces/ai-gateway · https://docs.base44.com/changelog/developers · https://docs.base44.com/Integrations/built-in-integrations

## Chat messages / history (2)

### Revert (per message)

Every prompt in the chat history has a Revert control. Clicking it rolls the app back to the state just before that change; any changes made after that point are undone too. Recommended over spending extra prompts to debug or undo.

- **Как се ползва:** Hover over a message in the chat history and click the 'Revert' icon/link under it.
- **Ограничения / план:** Credits already spent are not refunded (Base44 does not offer refunds or credit reversals for AI actions).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/Community-and-support/Troubleshooting · https://docs.base44.com/Account-and-billing/Credits

### Edit this message and resend

Change what you asked instead of only undoing it. Opens an 'Edit this message and resend' panel; on resend Base44 reverts any changes made after that message and then applies the updated request.

- **Как се ползва:** Click the 'Edit' icon on an earlier message, modify the text, and resend.
- **Ограничения / план:** The resend is a new build and uses message credits.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes

## Branches (2)

### Branches (Main branch picker)

Git-like branches inside the builder: a branch starts from the current state of main with its own chat, live preview, version history, copy of design/pages, code changes and supported entity/backend-function changes. Work on several in parallel and merge when ready. Data records stay shared (changes happen on main). Switch between main and branches via the branch name at the top of the chat panel ('Main chat' returns to main). CLI: base44 branches list.

- **Как се ползва:** Click the branch name ('Main') at the top of the chat panel > create a branch or pick an existing one; build on it; click Merge when ready.
- **Ограничения / план:** Builder plan and higher. Credits are drawn from the same balance as main. Docs say no limit on open branches; a third-party review says up to five parallel builds.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/working-with-branches · https://base44.com/blog/introducing-branches · https://docs.base44.com/developers/references/cli/commands/branches-list

### Branch merge with AI conflict resolution / Update from main

If main changed while a branch is in progress, a banner asks you to update the branch first; the AI combines main's changes with the branch, resolves overlapping changes automatically and asks a question in chat when they genuinely conflict. Then merge again.

- **Как се ползва:** On a branch, click Update (from main) when prompted, answer any conflict question in chat, then Merge.
- **Ограничения / план:** Builder plan and higher.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/working-with-branches · https://base44.com/blog/introducing-branches

## Keyboard shortcuts (2)

### Canvas and editing keyboard shortcuts

Canvas tools: V Select, H Hand, D Draw, N Sticky note, I Image. Editing: Cmd+X/C/V, Shift+Cmd+R paste to replace, Cmd+D duplicate, Delete/Backspace, ] bring to front, [ send to back, Shift+H / Shift+V flip, Shift+Cmd+L lock/unlock. Undo Cmd+Z / Ctrl+Z, Redo Shift+Cmd+Z / Ctrl+Shift+Z / Ctrl+Y. Zoom: Cmd+1 fit, Cmd+- out, Cmd+= in, Cmd+0 reset 100%.

- **Как се ползва:** Use the shortcuts while the Canvas view is focused.
- **Ограничения / план:** Canvas context.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Canvas

### Chat Settings: Send message / Insert new line shortcuts

Customize how messages are sent (Enter or Shift+Enter) and how new lines are inserted; also controls chat sound notifications.

- **Как се ползва:** Workspace name (bottom left) > Settings > Preferences > Chat Settings > Send message shortcut / Insert new line shortcut.
- **Ограничения / план:** None documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/documentation/account-and-billing/managing-your-account

## Domains (2)

### Default hosting URL and Connect domain

Every published app is served at `https://<app>.base44.app` (SDK default serverUrl is https://base44.app; CLI prints 'Visit your site at: https://my-app.base44.app'). The editor shows a banner with that URL and a 'Connect domain' button (owner screenshot). Custom domains exist: the email integration charges '2 credits with custom domain'. Hosting serves SPAs from a single index.html and keeps previous deployments versioned.

- **Как се ползва:** Click 'Connect domain' in the editor banner or open Dashboard → Domains; the CLI opens the live site with `npx base44 site open`.
- **Ограничения / план:** Domain purchase, SSL provisioning, subdomain rules and plan gating were not confirmable from reachable sources.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** owner screenshot of app.base44.com (3 Oct 2026) · https://github.com/base44/skills/blob/main/skills/base44-cli/references/site-deploy.md · https://www.npmjs.com/package/@base44/sdk

### Domains dashboard page

Sidebar entry 'Domains' (owner screenshot). The brief lists buy-and-connect, SSL and subdomains; none of these specifics were verifiable because docs.base44.com and base44.com are blocked and the web-search budget was exhausted.

- **Как се ползва:** Dashboard → Domains.
- **Ограничения / план:** Unknown.
- **Увереност:** low · статус: непотвърдено
- **Източници:** owner screenshot of app.base44.com dashboard sidebar (3 Oct 2026)

## Code (2)

### Code (dashboard page)

Dashboard sidebar page named 'Code' (between Security and Agents) in the owner's 3 Oct 2026 screenshots. The platform's code surface is backed by a server-side per-app sandbox whose files are readable/editable through the CLI and MCP (see 'Remote sandbox editing'). The builder keeps a version history with Restore/Revert and a 'Main' branch (top bar in owner screenshot).

- **Как се ползва:** Open app -> Dashboard toggle -> Code in the sidebar.
- **Ограничения / план:** Page contents (in-browser editor, GitHub sync button, export/download button) could not be verified from official docs in this run — see open questions.
- **Увереност:** low · статус: непотвърдено
- **Източници:** Owner screenshots of app.base44.com, 3 Oct 2026 · https://github.com/base44/cli · https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/sandbox/shared.ts

### Remote sandbox editing (sandbox ls / read / write / edit / grep / run)

Each app has a server-side sandbox: 'Develop an app remotely via its server-side sandbox'. CLI subcommands list directories, read files, create/overwrite files, apply exact old->new string edits, grep, and run shell commands in the app's remote sandbox. In the sandbox model 'writing a file IS the deploy': resource files are auto-committed (~5 s debounce) and shipped live; frontend edits reflect in preview via HMR. Same operations are exposed as MCP tools (list_directory, read_file, write_file, edit_file with dry_run, grep, run_command).

- **Как се ползва:** `base44 sandbox ls src --app-id app_123 --json`, `base44 sandbox read <path>`, `base44 sandbox write`, `base44 sandbox edit`, `base44 sandbox run "npm test"`; or via the MCP server from Claude Code/Cursor.
- **Ограничения / план:** MCP rate limits per app: reads ~120/min, mutations ~60/min, commands ~30/min. Mutations require the `sandbox:write` OAuth scope.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/cli · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sandbox/SKILL.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-remote-dev/SKILL.md

## Logs (2)

### Function runtime logs (base44 logs)

`base44 logs` 'command for fetching function runtime logs' (CLI 0.0.34, 2026-02-23). Flags: `--follow` streams in realtime ('under 1 second delivery', with polling fallback), `--level error`, `--function <name>`, `--since` / `--until`, `--limit` (max 500), `--app-id`. One-shot fetches lag ~20–30 s ('That is ingestion time, not a filter problem').

- **Как се ползва:** `npx base44 logs --follow` or `npx base44 logs --level error --function send-invoice --since 1h`.
- **Ограничения / план:** --limit capped at 500; `--function` filter reliable only for apps with current deployments ('legacy deployments may show unstamped rows').
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-troubleshooter/SKILL.md · https://raw.githubusercontent.com/base44/cli/main/CHANGELOG.md · https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/program.ts

### Logs (dashboard page)

Dashboard sidebar page 'Logs' (owner screenshot). The product bundle has an `AUDIT_LOGS` feature flag and 'Read logs' / 'Show raw logs (debug)' / 'No logs found.' strings. The CLI surfaces function logs (`base44 logs`) and workflow runs; the dashboard explorer's filters were not verifiable in this run.

- **Как се ползва:** Dashboard -> Logs.
- **Ограничения / план:** Audit-log availability/plan gating unverified.
- **Увереност:** low · статус: непотвърдено
- **Източници:** Owner screenshots of app.base44.com, 3 Oct 2026 · https://www.npmjs.com/package/@base44/superagent-native · https://raw.githubusercontent.com/base44/skills/main/skills/base44-troubleshooter/SKILL.md

## API (2)

### REST API (auto endpoints per app)

The SDK is a thin layer over REST: 'REST endpoints follow patterns like /api/apps/{appId}/entities/{Entity}'. Other paths in the SDK dist: `/api/apps/{appId}/agents/{agent}`, `/api/apps/{appId}/ai/{providerPath}/v1`, `/api/apps/{appId}/analytics/track/batch`, `/api/apps/auth/logout`; default server `https://base44.app`. External apps use `createClient({ appId, token })`; `appId` is found 'in the Base44 editor URL'.

- **Как се ползва:** `npm install @base44/sdk`; `createClient({ appId })`; or call the REST paths with a user token.
- **Ограничения / план:** 'Maximum 5,000 records per request for list/filter operations'; service role ('asServiceRole') only inside Base44-hosted backend functions ('External backends can't use service role permissions'). Dashboard 'API' page contents (API keys UI, generated docs) not verified.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://github.com/base44/javascript-sdk · https://www.npmjs.com/package/@base44/sdk · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/QUICK_REFERENCE.md

### REST API and API keys (Dashboard 'API' page)

Every SDK call maps to a REST endpoint under https://base44.app/api (e.g. GET/POST /apps/{appId}/entities/{Entity}, POST /apps/{appId}/functions/{name}, /apps/{appId}/integration-endpoints/Core/{Name}, /apps/{appId}/auth/*, /app-logs/{appId}). Workspace API keys (prefix b44k_) authenticate the CLI via BASE44_API_KEY; the platform starter uses scoped API keys (user_tokens:mint, service_users:provision) and a 'Base44-Service-Authorization' header for service tokens. The dashboard has an 'API' sidebar page (owner screenshot).

- **Как се ползва:** Dashboard → API to obtain keys/docs; call endpoints with Bearer token and Base44-App-Id header or via the SDK.
- **Ограничения / план:** Public REST documentation not reachable in this audit; rate limits unpublished except MCP sandbox limits and auth throttling (429).
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/javascript-sdk/main/src/client.ts · https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/entities.ts · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md

## Publish flow (2)

### Publish

Top-bar 'Publish' button that pushes the current draft (preview) of the app live to its public URL. Publishing is a separate explicit step: changes synced from GitHub, made by an external agent in the sandbox, or built in chat are not live until the owner clicks Publish. Third-party guide: 'Publishing a Base44 change makes it live; it does not prove the deployed experience matches preview.' Workflows can also be triggered by the 'app_publish' event.

- **Как се ползва:** In the editor (app.base44.com) click 'Publish' in the top-right of the top bar; afterwards test the live URL in a private window. After GitHub sync merges to main, still click Publish.
- **Ограничения / план:** Available on all plans (Free plan publishes to a base44.app subdomain). Preview and published app are distinct deployments (CLI logs use --env preview | prod).
- **Увереност:** high · статус: непотвърдено
- **Източници:** Owner screenshots of app.base44.com (3 Oct 2026) · https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/06-launch-checklist.md · https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/07-developer-path.md

### Live-site checks after publish (security scan, SEO/GEO, performance)

Docs provide post-publish quality pages: 'Run a security scan', 'Checking your SEO and GEO', 'App performance', 'SEO and search visibility', 'App analytics'.

- **Как се ползва:** Dashboard > Security (scan), Dashboard > Analytics; docs Performance-and-SEO pages.
- **Ограничения / план:** None known.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/running-a-security-scan · https://docs.base44.com/Performance-and-SEO/checking-your-seo-and-geo · https://docs.base44.com/Performance-and-SEO/App-performance

## Surfaces / mobile (2)

### Native mobile apps and app-store submission

Base44 documents a path for 'Submitting to app stores' (docs page 'uploading-to-app-stores'). Base44 also ships a preview Metro/Expo plugin (@base44-preview/metro-plugin, Jul 2026) 'for Base44 native-mobile applications running in sandboxed preview iframes', signalling in-editor native (Expo) app building. Third-party route: Despia wraps a Base44 web app into native iOS/Android apps with push notifications; the base44-revenuecat package adds App Store / Google Play subscriptions to such apps.

- **Как се ползва:** Follow docs 'Submitting to app stores'; or use Despia (Despia > Your App > Settings > Integrations) for a native wrapper.
- **Ограничения / план:** Metro plugin is a 'scaffold'/no-op preview; store developer accounts and review requirements apply.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/documentation/building-your-app/uploading-to-app-stores · https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/faq.md · https://registry.npmjs.org/@base44-preview%2fmetro-plugin

### Mobile experience / device toggle in editor

The editor has a device toggle to preview the app at phone/tablet/desktop widths; apps are generated responsive. Docs page 'Mobile experience'.

- **Как се ползва:** Click the device toggle in the top bar of the editor to switch preview width.
- **Ограничения / план:** None.
- **Увереност:** high · статус: непотвърдено
- **Източници:** Owner screenshots (device toggle) · https://docs.base44.com/Building-your-app/Mobile-experience · https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/faq.md

## Templates / use-case library (2)

### Prompt library (docs)

Official docs include a 'Prompt library' page of ready prompts for starting and extending apps (Getting-Started/Prompt-library), alongside the 'Quick-start guide' and 'Prompt guide'.

- **Как се ползва:** Open docs.base44.com > Getting Started > Prompt library; copy a prompt into the composer.
- **Ограничения / план:** None.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Getting-Started/Prompt-library · https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/resources.md

### Use-case landing pages (Build an app / Build a website / Create an AI agent)

base44.com has use-case entry pages: 'ai-app-builder' (Build an app), 'website-builder' (Build a website), 'ai-agent-builder' (Create an AI agent), plus 'superagents', 'integrations', 'developers', 'enterprise', 'security', 'pricing'.

- **Как се ползва:** Pick a use case on base44.com, then click Start building (app.base44.com/register).
- **Ограничения / план:** None.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/grok-cli/awesome-base-44/main/README.md · https://base44.com/website-builder · https://base44.com/ai-app-builder

## Publishing / code surfaces (2)

### GitHub two-way sync (editor)

Connect an editor app to a GitHub repo; Base44 auto-syncs app changes to the repo and pulls local changes merged to the 'main' branch (other default branch names not supported). Publishing is still done in Base44.

- **Как се ползва:** Dashboard > Code (or Settings) > connect GitHub (only the app owner can make the initial connection); clone, edit, merge to main, then click Publish.
- **Ограничения / план:** Builder plan or higher; owner-only connection; version-history/reconnection limitations on disconnect.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/developers/app-code/local-development/github · https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/07-developer-path.md · Owner screenshots (Dashboard sidebar 'Code')

### Export code (ZIP) and Eject

Docs describe ZIP export of app code from the editor (eligible plan). The CLI `base44 eject` downloads a managed project's code, creates a new copy app ('{Name} Copy'), links the code to it and can install/build/deploy.

- **Как се ползва:** Editor export (Dashboard > Code) or `npx base44 eject --app-id <id> -p ./dir -y`.
- **Ограничения / план:** Export requires an eligible plan (Starter adds 'in-app code edits'; export/GitHub documented for paid tiers). Eject only for projects with managed source code.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/faq.md · https://github.com/base44/skills/blob/main/skills/base44-cli/references/eject.md

## Permissions / security (2)

### Row-Level Security (RLS) and Field-Level Security (FLS)

Per-entity 'rls' object with operation keys create, read, update, delete (or write = all three). Values: true (all users), false (nobody), or a condition object. Conditions compare record fields to user template variables {{user.id}}, {{user.email}}, {{user.role}}, {{user.data.<field>}}; 'user_condition' checks user properties by simple equality (e.g. {role:'admin'}); entity-field conditions use the 'data.' prefix. Operators: $in, $nin, $ne, $all, $or, $and, $nor. $gt/$lt/$regex are NOT supported in RLS (use backend functions). FLS puts an 'rls' block on an individual property (e.g. salary readable only by role hr); fields without FLS inherit entity RLS. No default allow when rules are missing. Dashboard UI (Security page) can configure additional access.

- **Как се ползва:** Add "rls": {"read": {"created_by": "{{user.email}}"}, "write": {"user_condition": {"role": "admin"}}} to the entity .jsonc and push; or configure in Dashboard → Security / Data.
- **Ограничения / план:** Equality-only user_condition; no comparison/regex operators; no cross-entity logic.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/rls-examples.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/entities-create.md

### Service role (asServiceRole)

Elevated access that bypasses entity- and field-level security. Available only in Base44-hosted backend functions (and actors) via createClientFromRequest(req).asServiceRole, exposing entities, functions, integrations, agents, appLogs, connectors and sso modules. Service-role requests carry an 'on-behalf-of' header with the caller's token. Kotlin/Swift SDKs accept a serviceToken for the same purpose. Throws if no service token.

- **Как се ползва:** `const base44 = createClientFromRequest(req); const all = await base44.asServiceRole.entities.Orders.list();`
- **Ограничения / план:** Backend only; never expose to the frontend.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/javascript-sdk · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/client.md · https://raw.githubusercontent.com/base44/javascript-sdk/main/src/client.ts

## SDK (2)

### Base44 JavaScript SDK (@base44/sdk)

npm package @base44/sdk (latest 0.8.52; MIT; deps axios, socket.io-client). Pre-configured in builder apps (src/api/base44Client.js); external apps use createClient({appId, token?, serviceToken?, serverUrl (default https://base44.app), requiresAuth, functionsVersion, appBaseUrl, analytics, headers, options.onError}). Modules: entities, auth, agents, functions, actors, integrations (Core + custom), aiGateway, analytics, appLogs, users, app.getPublicSettings(), asServiceRole.{connectors, sso, …}. Backend: createClientFromRequest(req) reads Authorization, Base44-Service-Authorization, Base44-App-Id, Base44-Api-Url, Base44-Functions-Version, Base44-State, X-Data-Env (dev|prod) headers.

- **Как се ползва:** `npm install @base44/sdk` (no pinned version), `import { createClient } from '@base44/sdk'`.
- **Ограничения / план:** Always pass appId; service role only in hosted functions.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/javascript-sdk · https://registry.npmjs.org/@base44/sdk · https://raw.githubusercontent.com/base44/javascript-sdk/main/src/client.ts

### Kotlin SDK and Swift SDK

Official mobile/multiplatform SDKs: com.base44:sdk 0.1.0 (Kotlin Multiplatform via ktor; JVM/Android/iOS/macOS/Linux) and swift-sdk 0.1.0 (SPM; iOS 15+/macOS 12+). Both cover entities (CRUD, bulk, CSV/Excel import), auth (email/password, OTP, register, reset, token), functions.invoke, integrations (LLM, image, upload, email), agents, app logs, users, service role via serviceToken. Swift stores JWT in memory.

- **Как се ползва:** Gradle `implementation("com.base44:sdk:0.1.0")` / SPM `.package(url: "https://github.com/base44/swift-sdk.git", from: "0.1.0")`; createClient(CreateClientConfig(appId)).
- **Ограничения / план:** Kotlin Maven Central publishing 'in progress' (clone locally).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/kotlin-sdk · https://github.com/base44/swift-sdk

## Developer platform (2)

### Workspaces and app visibility

Apps belong to personal or organization workspaces; `base44 workspace list/get/move`, `create --workspace <id>`, `link --create --workspace`. Visibility public/private/workspace set in config.jsonc or `base44 visibility` (immediate). Dashboard Overview shows 'App Visibility (Public)'.

- **Как се ползва:** `npx base44 workspace move <id>`; Dashboard → Overview → App Visibility.
- **Ограничения / план:** Workspace API keys (b44k_) scoped per workspace.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/visibility.md

### Agent skills for coding assistants (base44/skills)

Official MIT repo of skills for Cursor, Claude Code, Codex CLI, OpenCode: base44-cli, base44-sdk, base44-troubleshooter, base44-remote-dev, base44-sandbox, installable via Claude plugin marketplace or `npx skills add base44/skills --all`; auto-installed by `base44 create` (skip with --no-skills). 'openclaw-onboarding' repo is a guide for bots building on Base44.

- **Как се ползва:** `npm i -g skills && npx skills add base44/skills --all`; `npx skills check` for updates.
- **Ограничения / план:** Beta.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills · https://github.com/base44/openclaw-onboarding

## Billing (2)

### Plan and billing management (upgrade, downgrade, cancel, invoices)

Upgrades apply immediately with prorated charges shown before confirming; downgrades take effect at period end; cancel anytime (access until period end, then Free with 5-app cap, apps stay live); no pausing; cannot repurchase the same plan during the cancelled cycle; yearly fees non-refundable (case-by-case exceptions via support, prorated minus fees); all services non-refundable per ToS. Invoices downloadable (owners only); billing info/tax ID editable. Payment: major credit/debit cards only, in USD; no PayPal, bank/wire transfer, virtual cards or crypto.

- **Как се ползва:** Workspace name > Settings > Plan and billing > Upgrade Plan / Manage Plan / Downgrade / Cancel Plan / Billing History.
- **Ограничения / план:** Owner-only for invoices; refunds discretionary.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans

### iOS app subscriptions via Apple App Store

The official 'Base44: Build with AI' iOS app sells plans as in-app purchases (Apple sets regional pricing, e.g. TWD 690-6,990). You can hold a paid plan on only one platform at a time; Apple handles cancellation/refunds; website discounts (student, promo) do not apply; the Dashboard Overview advertises 'Manage your app on the go with the mobile app'.

- **Как се ползва:** Install the iOS app and subscribe; manage via iPhone Settings > Subscriptions. To move to web billing, cancel in Apple, wait for Free, then buy on the site.
- **Ограничения / план:** One active platform at a time; Apple pricing may differ from web.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/Billing-and-plans · https://raw.githubusercontent.com/edgarstool/edgars-mcp/main/docs/BASE44-HONGDOULANG-DEEP-RESEARCH.md

## Changelog (2)

### Product changelog (docs.base44.com/changelog/product) - last 12 months

Base44 publishes a dated product changelog (docs.base44.com/changelog/product) plus a developer changelog (docs.base44.com/developers/changelog) and feature pages at base44.com/changelog/feature/*. Dated items found: Aug 20 2025 in-app Agents launch; Aug 25 2025 founder update (reasoning in every message, agent-building alpha); Oct 2025 screenshots of next-step 'Suggestions' chips; Jan 14 2026 CLI 0.0.2 first release, Jan-Apr 2026 CLI releases through 0.0.51 (Apr 28 2026: local-dev auth/registration, social login, connector automation); Feb 6 2026 private apps become paid; Feb 2026 App Store/Play publishing, Plan Mode, Gmail integration (third-party summary); Jun 2026 Base 1 proprietary model; Jun 21 2026 new Terms of Service (AI-credits section, cancellation rights); Jul 2026 docs list Workflows, Superagents, Figma import, canvas, skills, MCP; Sep 2026 AI phone calls (Superagent calls); Sep 15 2026 branch-level code saving + GitHub reconnection fix; Sep 17 backup-feature rename; Sep 21-22 AI Visibility tab in SEO/GEO settings and Gemini 3.8 Flash at double credits; Sep 27 entry; Oct 1 2026 workspace members auto-become collaborators on opening an app + iframe embedding control (anyone/listed sites/none) with Enterprise governance. Feature-page slugs include debug-mode, safe-testing, upgraded-analytics, github-2-way-sync, custom-email-domains, npm-packages, act-as, app-template-marketplace, one-click-connector-tools, workspace-level-sso, new-agent-builder, claude-sonnet-4.5, whatsapp-integration-for-agents, agentic-apps, hire-a-partner, referral, annual-plans, no-charge-policy-on-app-bugs, discussion-mode, base44-mobile-app.

- **Как се ползва:** Open docs.base44.com/changelog/product (also linked from the support page as 'Check recent changes').
- **Ограничения / план:** Changelog itself blocked from direct fetch in this audit; dates for pre-Sept 2026 items come from third-party mirrors and news.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product · https://raw.githubusercontent.com/PlayFundWin/daily-build-feed/master/archive/covered.md · https://github.com/PlayFundWin/daily-build-feed/blob/master/transcripts/ep041.txt

### Terms of Service update (June 21, 2026)

New ToS adds a dedicated AI-credits section, right to cancel auto-renewal anytime, removes late-payment interest, covers selling through your apps and tax responsibility, EU AI Act prohibited uses, Israeli-customer cancellation/refund addendum, states premium services are intended for businesses, allows Base44 to use content for AI training and promotion, disclaims AI-output warranties, and makes you responsible for exporting data before a subscription ends.

- **Как се ползва:** Read at base44.com/terms-of-service; continued use after the date is acceptance.
- **Ограничения / план:** Applies to all users from 2026-06-21.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Account-and-billing/tos-update-june-2026 · https://github.com/Amal-David/docingest/blob/main/server/storage/docs/docs.base44.com/documentation_2026-07-07T03:54:54.947Z.md

## Compare (1)

### Compare (two models side by side)

'The Compare models feature runs your next message on two models at once, so you can preview both results and keep the one you prefer.' Base44 builds the message twice, once per model. While building, the chat shows a 'Comparing two versions' card with each version's status; when both are ready it asks 'Which option do you prefer?' and lists 'Option A' and 'Option B'. You can click 'Open' on an option to preview it, use the model tabs at the top of the preview to switch between versions, and keep chatting in a version to refine it before deciding. Since Sept 2026 ('Compare models before you build') it also works from the homepage prompt box and during onboarding.

- **Как се ползва:** Click the model picker in the chat input → click 'Compare' ('Choose two models to compare') → choose Model A and Model B → send your message → preview Option A / Option B → keep the one you prefer.
- **Ограничения / план:** Requires Builder plan or higher. 'Comparing builds your message twice, so it uses 2× credits.' Messages with attachments are not supported yet (comparison is removed and the message is sent normally).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/changelog/product

## Plan gating (1)

### Builder+ gating of manual model selection

Every entry in the Select model menu carries a 'Builder+' badge: 'You need a Builder plan or higher to choose an AI model' and 'Comparing requires a Builder plan or higher, the same as choosing a model manually.' The Builder plan ($40/mo billed annually, ~$50 monthly) includes 250 message credits and 10,000 integration credits per month plus custom domain, backend functions, GitHub integration and 'AI model selection'. If a workspace moves to Free, paid features including the model picker stop working. Contrast: for in-app agents/InvokeLLM 'every model is available on every plan, with credits as the cost control'.

- **Как се ползва:** Upgrade: click your workspace name (bottom left) → Settings → Plan and billing → Upgrade Plan → choose Builder, Pro or Elite. Then the Select model menu becomes selectable.
- **Ограничения / план:** Free (25 message / 100 integration credits) and Starter ($16 annual / $20 monthly; 100 / 2,000) plans are limited to Auto mode. Pro: $80/$100, 500 / 20,000; Elite: $160/$200, 1,200 / 50,000.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/Account-and-billing/Billing-and-plans · https://base44.com/pricing

## History / routing policy (1)

### History: removal of manual model selection (11 Dec 2025) and reinstatement (Feb 2026)

On 11 Dec 2025 Base44 published 'Smarter building with automatic optimization': 'the agent automatically routes your prompt to the model best equipped… As part of this shift, we're removing the option to manually select a model'. It also introduced the dynamic credits system. Community backlash followed on feedback.base44.com ('No more AI Model Selection', 'Removal of Model Selection… Is Blocking Real Workflows', 'Auto Mode Only Is Disrupting Professional System Design', 'Base44's Quality Just Went Down', 'Auto Model Selection is bad'). Before removal users could choose Sonnet, Opus, Gemini, ChatGPT. On 19 Feb 2026 Base44 announced Gemini 3.1 Pro and 'you can now choose your preferred AI model from your very first prompt'; the March 2026 changelog records 'automatic model selection that picks the best AI model for each task'; by Aug 2026 'Choosing a model by hand is available on the Builder plan and above.' Earlier 2026 lineups cited by reviewers: Claude Opus 4.5, Claude Sonnet 4.5, Gemini 2.5 Pro, Gemini 3 Pro, GPT-5 (Builder+), default Claude Sonnet 4.

- **Как се ползва:** N/A (context). Today: Auto by default, manual picker on Builder+.
- **Ограничения / план:** Manual selection remains Builder+; Free/Starter are Auto-only.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://base44.com/blog/update-smarter-building-with-automatic-optimization · https://feedback.base44.com/p/no-more-ai-model-selection · https://feedback.base44.com/p/removal-of-model-selection-in-base44-is-blocking-real-workflows

## Chat composer / visual editing (1)

### Edit mode (select element) with chip in chat input

Click elements in the live preview to adjust visuals directly or to scope a chat request. Since August 2026 the element you pick in Edit mode appears as a chip in the AI chat input so you can check what your request applies to before sending; removing the chip drops the selection and the chip stays on the message after it is sent. Third-party reviews describe Edit as the third chat mode alongside Build and Discuss.

- **Как се ползва:** Click the 'Edit' button in the editor top bar, click an element in the preview, then either adjust it in the design panel or type a request in the chat; the selected element shows as a chip in the composer.
- **Ограничения / план:** Manual visual edits (dragging, layout, direct text edits) do not use credits; a chat request still uses message credits.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product · https://docs.base44.com/Building-your-app/Design · https://docs.base44.com/Account-and-billing/Credits

## Chat composer / models (1)

### Select model (model picker) and 'Auto mode'

A model menu in the chat composer (and a 'Model' button below the homepage prompt box) lets you pick the AI model that powers the builder chat or keep 'Auto mode' ('Matched with the best AI model for each request'). Auto routes design tweaks, layout changes and deep logic updates to different engines in the background. Models documented/observed in the picker: Base 1 (Base44's in-house model trained on real building patterns, general-purpose), Sonnet 5.5 (replaced Sonnet 5 at the same credit rate; balanced day-to-day building), Opus 5.5 (most advanced reasoning for hard problems), Fable 5.1 (complex multi-step builds and detailed debugging; 'Uses more credits'), Gemini 3.8 Flash, GPT-5.6 Terra (cost-efficient complex reasoning), GPT-6.1 Sol, GPT 6 Astra (newest, most capable GPT; 'Uses more credits'). Owner's screenshots show every model tagged 'Builder+'. History: in late 2025 Base44 temporarily removed manual model selection (auto only), prompting feedback-board complaints; selection is back as a paid-plan feature.

- **Как се ползва:** In the editor click the model name (e.g. 'Auto') at the bottom of the chat composer and pick a model; on the homepage click 'Model' under the prompt box before sending the first prompt so the first build uses it.
- **Ограничения / план:** Choosing a model requires the Builder plan or higher (free/Starter stay on Auto). More capable models (Fable 5.1, GPT 6 Astra, Opus) use more credits per request; exact multipliers for the builder chat are not published.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/Getting-Started/starting-from-your-first-prompt · https://docs.base44.com/changelog/product

## Chat attachments / media (1)

### File library

Each app has its own file library where Base44 stores files you upload or generate while building, giving one place to organize and reuse media and reference files across the app.

- **Как се ползва:** Upload via the chat '+' menu or media tools; browse and reuse from the app's file library.
- **Ограничения / план:** None documented beyond per-file size limits.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Using-media

## Chat history / versions (1)

### Version History (clock icon)

Version list opened from the top of the chat. For each version you can preview it, 'Publish this version' (publish to the live app while keeping your current draft open), 'Revert to this version' (replace the current draft in the editor), 'View code', or jump back to the chat message that created it. Improved versioning and project history was shipped as a changelog feature.

- **Как се ползва:** Click the Version History (clock) icon at the top of the chat → pick a version → 'More Actions' → choose Publish this version / Revert to this version / View code.
- **Ограничения / план:** None documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Community-and-support/Troubleshooting · https://docs.base44.com/Building-your-app/AI-chat-modes · https://base44.com/changelog/feature/improved-versioning-&-project-history

## Chat messages / quality (1)

### Automatic verification after changes ('Verified the app')

After the AI applies changes it automatically checks the output in the background and fixes errors it finds without interrupting you (owner's screenshots show a 'Verified the app' step with a summary). When the AI tests the app, the screenshots it takes appear in the AI chat as a gallery; click any to see it full size, including for tests that did not pass.

- **Как се ползва:** Nothing to do; the check runs after each build. Click screenshots in the chat gallery to inspect test results.
- **Ограничения / план:** Not documented whether the check consumes credits.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://base44.com/blog/update-smarter-building-with-automatic-optimization · https://docs.base44.com/Building-your-app/AI-chat-modes · https://docs.base44.com/changelog/product

## Chat / troubleshooting (1)

### 'Something is wrong' diagnostic prompt

If you see no clear error, typing 'Something is wrong' in the AI chat makes Base44 analyze the app and suggest fixes in context. Docs also recommend asking the chat to test flows ('Test as a guest', 'See what an admin can do').

- **Как се ползва:** Type 'Something is wrong' (or a test request) in the chat and send.
- **Ограничения / план:** Uses message credits like any Build prompt.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Community-and-support/Troubleshooting

## Preview errors / chat (1)

### Issues Found → Resolve with AI

When Base44 detects a JavaScript error in the preview, an 'Issues Found' notification appears with the error description and location; the preview stays alive and shows the error inline with a 'Resolve with AI' option that sends the error details to the AI chat, which reviews and applies a fix.

- **Как се ползва:** Click 'Resolve with AI' on the inline error / Issues Found notification.
- **Ограничения / план:** The fix is a chat turn and uses message credits.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Community-and-support/Troubleshooting · https://docs.base44.com/changelog/product

## Chat history / quality (1)

### Fix All / single-issue fixes recorded in chat with checkpoint

When you apply a fix from a scan (Fix All or a single issue), Base44 records it as a message in the app's AI chat and creates a checkpoint before making the change, so it can be reverted like any other message.

- **Как се ползва:** Run a scan (security/health), click 'Fix All' or fix one issue; the resulting message appears in the chat.
- **Ограничения / план:** Not documented.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product

## Prompting help (1)

### Prompt tips (Prompt guide, Prompt library, blog)

Official guidance on writing prompts: 'paint the screen, not just the idea', explain the why, describe what/layout/mood together, reference known apps for look-and-feel, avoid vague 'make it better'/'fix it', build the core first then add features step by step, refinement patterns ('Make it more/less', 'Add/Remove', 'Only show…when…'). A Prompt library page offers ready prompts; blog posts cover vibe-coding best practices.

- **Как се ползва:** Read docs.base44.com Prompt guide / Prompt library and apply the patterns in the chat.
- **Ограничения / план:** None.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Getting-Started/Prompt-guide · https://docs.base44.com/Getting-Started/Prompt-library · https://base44.com/blog/how-to-write-ai-prompts

## Chat history / branches (1)

### Branches (per-branch chat, preview and version history)

A branch starts a separate line of work from the current state of main, with its own chat, live preview, copy of design/pages and version history; several branches can build in parallel. Names are auto-generated (3 words or fewer, always English regardless of the language you write in) and cannot be renamed. 'Merge to main' brings the branch into main; a summary of the branch's changes appears in main's chat; the merged branch stays listed as read-only with its chat still readable. Branch statuses: Active, Working, Merging, Merged. On a protected main branch the chat still answers questions, but when asked to change the app it offers to create a branch and carries the request into it.

- **Как се ползва:** Click the app logo/name at the top of the chat panel → 'Create new branch' → pick a suggestion or type what to build → send. Switch branches via the same menu (top bar shows 'Main'). On the branch click 'Merge to main' and confirm.
- **Ограничения / план:** Changes reach users only when you publish from main.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/working-with-branches · https://base44.com/blog/introducing-branches · https://docs.base44.com/changelog/product

## Chat approvals (1)

### Approval before writing to a connected GitHub repo

If the app is connected to a GitHub repository, the AI chat asks for your approval before writing files to the repository. Commits from the repo are tried in a separate sandbox before landing on main; if the check fails, main is untouched and a repair branch is offered.

- **Как се ползва:** Connect GitHub in Dashboard → Integrations/Code; approve the write prompt in the chat when asked.
- **Ограничения / план:** GitHub integration requires Builder plan or higher.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/developers/app-code/local-development/github · https://docs.base44.com/changelog/product · https://base44.com/pricing

## Testing / chat (1)

### Act as a user (test flows from the editor)

'More actions' in the top bar offers 'Act as a user' to preview and interact with the app as a specific user or role ('You're acting as' dropdown). Docs pair this with asking the AI chat to test key flows and edge cases.

- **Как се ползва:** Click the 'More actions' icon at the top → 'Act as a user' → choose the user next to 'You're acting as'.
- **Ограничения / план:** None documented.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-access · https://docs.base44.com/Community-and-support/Troubleshooting

## Editor navigation (1)

### Command palette (Cmd+K / Ctrl+K)

Opens a command palette to navigate between views, switch pages, open files, jump to entities, trigger quick actions like publishing or inviting collaborators, and search Base44 documentation.

- **Как се ползва:** Press Cmd+K (Mac) or Ctrl+K (Windows) in the editor.
- **Ограничения / план:** None documented.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Getting-Started/Quick-start-guide · https://docs.base44.com/Building-your-app/AI-chat-modes

## Mobile (1)

### Mobile app 'Chat to Edit'

Base44 iOS and Android apps let you build, edit and manage apps on the go; tap 'Chat to Edit' to make changes with the AI chat. The Overview dashboard advertises 'Manage your app on the go with the mobile app'. App UI available in English, German, Spanish, French, Japanese and Portuguese.

- **Как се ползва:** Install from the App Store / Google Play, open your app, tap 'Chat to Edit'.
- **Ограничения / план:** Same credits as desktop.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Mobile-experience · https://base44.com/changelog/feature/base44-mobile-app-

## Chat (1)

### Multilingual chat

You can write to the builder in any language and the AI replies in it (owner's screenshots show Bulgarian prompts, answers, suggestions and verification summaries). Docs note branch names are always English 'whatever language you write in', confirming non-English prompting is expected.

- **Как се ползва:** Type in your language; the AI answers in the same language.
- **Ограничения / план:** Dictation language support not documented.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/working-with-branches · https://docs.base44.com/Building-your-app/AI-chat-modes

## Onboarding / chat (1)

### Homepage first prompt (Mode and Model selectors)

Every app or website starts from a prompt on the Base44 homepage. Below the prompt box you can set the Mode (Build default or Plan) and the Model (Auto or a specific model) before the first build; you can also attach files there.

- **Как се ползва:** Go to base44.com, describe what you want, optionally open 'Mode' → 'Plan' and 'Model', then send.
- **Ограничения / план:** Model choice needs Builder plan or higher.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Getting-Started/starting-from-your-first-prompt · https://docs.base44.com/Getting-Started/Quick-start-guide

## Chat messages / approvals (1)

### 'auto-approved' labels in chat

Steps that ran without asking because Auto approve is on are labeled 'auto-approved' in the chat for transparency; clicking the label opens the Auto approve setting.

- **Как се ползва:** Look for the 'auto-approved' tag on steps; click it to manage the setting.
- **Ограничения / план:** Only when Auto approve is on (gradual rollout).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/AI-chat-modes

## AI Controls / skills (1)

### Workspace skills referenced from chat

Workspaces can hold skills; the custom instructions (injected into every interaction) are where you tell the agent which skills to apply, so skills influence builder-chat behavior.

- **Как се ползва:** Add skills in the workspace (Managing workspace skills), then name them in the app's Custom Instructions.
- **Ограничения / план:** Details documented mainly for white-label/API customers.
- **Увереност:** low · статус: непотвърдено
- **Източници:** https://docs.base44.com/documentation/using-your-workspaces/adding-workspace-skills · https://docs.base44.com/developers/white-label/skills-and-mcp

## Screenshots to chat (1)

### Attach files/screenshots to chat (+ / Add icon)

Upload images, PDFs, documents or spreadsheets from the computer or choose from the app's file library; the file is stored in the library and used as AI context (e.g. upload a screenshot of a color palette and ask to apply it).

- **Как се ползва:** Click the Add (+) icon in the AI chat > Upload from computer or Choose from library > select > type what to do with it > send.
- **Ограничения / план:** Images: PNG, JPG, JPEG, GIF, WEBP, SVG; max 40MB (SVG 5MB); max 1024x1024 px (larger images are resized automatically).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Using-media · https://docs.base44.com/Getting-Started/starting-from-your-first-prompt

## App Users (1)

### In-app invites (AI-generated)

You can ask the AI chat to add an invite option inside the live app so admins/users enter an email and (optionally) pick a role. Backed by the SDK users.inviteUser(email, role) method with role 'user' or 'admin'.

- **Как се ползва:** In the chat, ask to 'set up in-app invites'; then use the invite control the AI adds in the app.
- **Ограничения / план:** Roles limited to user/admin via inviteUser.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-access · https://docs.base44.com/developers/skills/base44-sdk/references/users

## Dashboard > Overview / Settings (1)

### Platform Badge (Hide Badge)

Badge at the bottom-right of the live app reading 'Edit with Base44'; lets visitors clone the app into their own account. The Overview card offers 'Hide Badge'; the same toggle 'Platform Badge' is in Dashboard > Settings. Not shown on Private apps. If you self-host the code the badge reads 'Made with Base44' and does not offer cloning.

- **Как се ползва:** Dashboard > Overview > Platform Badge > Hide Badge; or Dashboard > Settings > Platform Badge toggle.
- **Ограничения / план:** Removing the badge requires Starter plan or above.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Getting-Started/Quick-start-guide · https://docs.base44.com/documentation/account-and-billing/managing-your-account · https://feedback.base44.com/p/your-badge-position-is-blocking-my-app

## Dashboard > App Users / Security (1)

### Custom roles via User fields + User Property Check rules

For finer control you add a custom field to the User table (e.g. department, access_level with values like manager/viewer) and write 'User Property Check' permission rules on that field. Built-in fields (id, full_name, email, role, disabled, is_verified, created_date, updated_date, app_id, is_service) cannot be redefined.

- **Как се ползва:** Ask the AI or edit the User schema to add fields; then configure rules under Security / data permissions.
- **Ограничения / план:** Redefining built-in fields causes a validation error.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/Managing-security-settings · https://docs.base44.com/developers/backend/resources/entities/user-schema

## Data / Chat (1)

### Import data via AI chat (CSV/XLSX/JSON, Google Drive)

Upload a CSV, Excel or JSON file in the chat and the AI maps columns to entity fields, creating or updating entities/fields as needed; multi-sheet Excel can import one or all sheets. Files can come from the file library, computer or Google Drive.

- **Как се ползва:** Chat composer '+' > attach file > ask the AI to import.
- **Ограничения / план:** CSV/JSON max 10 MB; XLS/XLSX max 15 MB.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Building-your-app/Managing-your-app-data · https://docs.base44.com/Building-your-app/Using-media

## Dashboard > Analytics / API (1)

### User stats (active / live / inactive)

At-a-glance counts of active, live and inactive users; API exposes views in last 7/30 days and users who viewed in last 7 days.

- **Как се ползва:** Visible in dashboard; also via Get analytics user stats API.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/api-reference/get-analytics-user-stats · https://docs.base44.com/api-reference/apps/get-app-analytics

## Workspace / Dashboard (1)

### App card stats (All Apps page)

Each app card in the All Apps page shows publish date, number of users and collaborators.

- **Как се ползва:** Workspace > Apps.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/changelog/product · https://docs.base44.com/documentation/using-your-workspaces/managing-your-workspace-apps

## Marketing (1)

### Marketing dashboard page (SEO & GEO scan, Social content generator)

Sidebar entry 'Marketing' (owner screenshot). The brief describes an SEO & GEO scan with a score and fixes and a social content generator. No reachable official or third-party source describes these; the only related primitives found are the `google_search_console`, `google_analytics`, `googleads`, `linkedin`, `instagram`, `tiktok` and metered `x` connectors and the analytics module.

- **Как се ползва:** Dashboard → Marketing.
- **Ограничения / план:** Unknown.
- **Увереност:** low · статус: непотвърдено
- **Източници:** owner screenshot of app.base44.com dashboard sidebar (3 Oct 2026) · https://www.npmjs.com/package/@base44/sdk

## Code / export (1)

### eject (download project code)

`base44 eject` downloads the source code of a Base44 project 'that was created or managed through the platform' to a local directory. It also creates a new project as a copy named '{Original Name} Copy' and writes `.env.local` with the new project ID; optional steps install dependencies, build and deploy. Added in CLI 0.0.31 (2026-02-10).

- **Как се ползва:** `npx base44 login` then `npx base44 eject -p ./my-app --app-id <app_id> -y` (interactive picker if flags omitted).
- **Ограничения / план:** Requires authentication; only projects with `isManagedSourceCode !== false` are ejectable ('The project must be ejectable (have managed source code)'); non-interactive mode needs both --app-id and --path; exits with 'No projects available to eject.' when none qualify. CLI is in beta.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/eject.md · https://raw.githubusercontent.com/base44/cli/main/CHANGELOG.md · https://github.com/base44/cli

## Code / version history (1)

### Checkpoints and builder version history (Restore / Revert)

'Sandbox writes are committed but not checkpointed. Only checkpoints appear in the builder's version history, and a Restore or Revert there rolls the app back to the last checkpoint and discards everything written after it.' `base44 sandbox checkpoint` / MCP `create_checkpoint` saves a restore point with an optional title; pending changes are flushed first. Owner screenshots show a per-message 'Revert' link and a history icon in the top bar.

- **Как се ползва:** `base44 sandbox checkpoint --name "short summary"` after each unit of work, or call `create_checkpoint` via MCP; in the builder use the history icon or 'Revert' on a chat message.
- **Ограничения / план:** Checkpoint title defaults to an auto-generated one.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/sandbox/checkpoint.ts · https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/sandbox/shared.ts · Owner screenshots of app.base44.com, 3 Oct 2026

## Code / branches (1)

### Branches (main + active branches, --branch flag)

Apps have branches: `base44 branches list` 'List main and active branch names for use with --branch'; output is `{name} ({status})`, 'main' is always listed as active. A global `--branch <name>` flag 'targets sandbox commands at a specific app branch'. Owner screenshot shows branch 'Main' in the builder top bar.

- **Как се ползва:** `base44 branches list --app-id <app-id> --json`, then `base44 sandbox read src/App.jsx --branch <name>`.
- **Ограничения / план:** Per CLI docs, `functions pull/list` and `entities push` reject branch targeting; `--branch` is listed under [Unreleased] in the changelog as of the fetch.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/branches/index.ts · https://raw.githubusercontent.com/base44/cli/main/CHANGELOG.md · https://raw.githubusercontent.com/base44/cli/main/docs/commands.md

## Code / deploy (1)

### publish / versions (record and serve app versions, rollback)

`base44 publish` — 'Build the app, record it as a version, and serve that version' (option --no-build, plus --output-dir, --target, --git-hash, --concurrency). `base44 versions create` — 'Record the built output as a version, without deploying it'; `base44 versions deploy` — 'Point an environment at an already-recorded version (also the rollback)'. Deployments are addressed by the commit that produced them ('one commit means one deployment and re-deploying a commit is idempotent').

- **Как се ползва:** `npx base44 publish` or `npx base44 versions create --git-hash <sha>` then `npx base44 versions deploy --target <env>`.
- **Ограничения / план:** 'What production serves is decided by the platform publish flow, not by this CLI — there is no --prod, no promote/rollback, and no deployment list/logs surface' (deployments doc). Multiple environments (dev/staging/prod) requested in Discussion #158 with no team reply.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/publish.ts · https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/versions/create.ts · https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/versions/deploy.ts

## Code / GitHub (1)

### GitHub integration (flag in product code; details unverified)

The `@base44/superagent-native` bundle contains feature constants `GITHUB_INTEGRATION` / `github_integration` alongside `MCP_CONNECTIONS` and `AUDIT_LOGS`, indicating a GitHub integration feature flag exists in the product. The CLI accepts `--git-hash` when recording a version. No official page describing two-way GitHub sync could be fetched in this run.

- **Как се ползва:** Unverified; expected under Dashboard -> Code.
- **Ограничения / план:** Unknown (plan gating not verified).
- **Увереност:** low · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/superagent-native · https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/publish.ts

## Agents / channels (1)

### WhatsApp channel for agents

Agents can be reached through WhatsApp: the agent config has `whatsapp_greeting` ('WhatsApp channel greeting message') and the SDK's `base44.agents.getWhatsAppConnectURL(agentName)` 'Generates a URL that users can use to connect with the agent through WhatsApp. The URL includes authentication if a token is available.'

- **Как се ползва:** Set `whatsapp_greeting`; in app code call `getWhatsAppConnectURL('support-agent')` and show the link.
- **Ограничения / план:** Email and web-widget channels are not documented in the fetched sources (open question).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/base44-agents.md · https://www.npmjs.com/package/@base44/sdk · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/agents-push.md

## Agents / AI (1)

### AI Gateway (code agents, OpenAI-compatible)

`base44.aiGateway.connection()` 'returns the baseURL and bearer token to hand to any OpenAI-compatible client' (Vercel AI SDK, Mastra, OpenAI SDK). Endpoint pattern `/api/apps/{appId}/ai/{providerPath}/v1`. Default model 'automatic' (cheapest); example named model `claude_sonnet_4_6`. 'Non-default models cost more credits.'

- **Как се ползва:** In a backend function: `const { baseURL, token, headers } = await base44.aiGateway.connection(); new OpenAI({ baseURL, apiKey: token, defaultHeaders: headers })`.
- **Ограничения / план:** Backend-function only; no streaming; metered against the app's credit quota 'exactly like integrations.Core.InvokeLLM'.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/ai-gateway.md · https://www.npmjs.com/package/@base44/sdk

## Agents / Users (1)

### Invite users / roles (users module)

`base44.users.inviteUser(email, role)` (also `base44.auth.inviteUser`) sends an email invitation with a join link; roles are exactly 'user' or 'admin' ('An error will be thrown if you pass any other value'); re-inviting an existing user resends. Dashboard Overview shows 'Invite Users' (Copy Link, Send Invites) and the sidebar has 'App Users'.

- **Как се ползва:** Dashboard -> Overview -> Invite Users, or `await base44.users.inviteUser('x@y.com','user')`.
- **Ограничения / план:** A dedicated 'Users' tab inside the Agents page (agent-specific users) is not verified.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/users.md · Owner screenshots of app.base44.com, 3 Oct 2026

## Agents (separate product surface) (1)

### Superagent (Base44 personal agent: WhatsApp / Telegram / Slack channels, Automations, MCP connections)

The npm package `@base44/superagent-native` ('React Native entrypoint for the Superagent mobile experience') runs 'agents, channels, connectors, automations, secrets, files'. UI strings include 'Connect Telegram' ('Create a Telegram bot for your agent with one click'), 'Connect Slack' / 'Add to Slack' ('Mention the "Superagents by Base44" bot in your channel'), 'Open WhatsApp' ('Open WhatsApp with the generated activation message for this Superagent'), 'Automations' ('runs when triggered', 'Automation model'), 'Connector Guards', 'Read logs' / 'Show raw logs (debug)', feature flags MCP_CONNECTIONS, GITHUB_INTEGRATION, AUDIT_LOGS, and credit messages ('Consumes message credits', 'All collaborators consume credits from the workspace', 'Upgrade to a Premium plan to unlock instant credits').

- **Как се ползва:** Via the Superagent app/mobile experience; not the per-app Agents dashboard page.
- **Ограничения / план:** Message credits; 'Premium plan' upsell when out of credits. Relationship to the app-level 'Agents' page is unverified.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://www.npmjs.com/package/@base44/superagent-native

## Workflows / testing (1)

### Workflow test runs

Workflows can be test-run: runs carry `isTestRun: true` and a 'test' tag appended to the trigger type, e.g. '(scheduled, test)'.

- **Как се ползва:** Trigger a test from the builder's workflow UI; filter in `workflows runs --json` on isTestRun.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/workflows-runs.md · https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/workflows/runs.ts

## Logs / Analytics (1)

### App Logs (user activity logs, appLogs module)

`base44.appLogs.logUserInApp(pageName)` records page-level and feature-level activity (any string, e.g. 'button-click'); `fetchLogs({limit, page})` and `getStats({from, to})` query them. 'Logs appear in the Analytics page of your app dashboard.' Distinct from `base44.analytics.track()` (events with properties, batched to `/api/apps/{appId}/analytics/track/batch`).

- **Как се ползва:** Call `base44.appLogs.logUserInApp('home')` in page components; view in Dashboard -> Analytics.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/app-logs.md · https://www.npmjs.com/package/@base44/sdk

## API / keys (1)

### Workspace API keys (b44k_ / BASE44_API_KEY)

'If the BASE44_API_KEY environment variable is set to a workspace API key (prefixed b44k_), the CLI authenticates with it directly — npx base44 whoami and other commands succeed without an interactive login.' Enables CI/agent automation.

- **Как се ползва:** Create a workspace API key (dashboard location unverified), then `export BASE44_API_KEY=b44k_...` before running `npx base44 ...`.
- **Ограничения / план:** Workspace-scoped.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md

## API / Enterprise (1)

### Platform API and scoped API keys (Enterprise)

The platform starter shows embedding Base44's builder in another product: requires 'Enterprise workspace with platform capability', a Workspace ID sent as `X-Active-Workspace-Id`, and API keys with scopes `user_tokens:mint` and `service_users:provision` (REST pins `apps:read apps:write offline`). Service principals are 'a workspace-owned robot identity, one per end user, that can never log in' (default role editor). Endpoints: GET/POST `/api/apps`, GET `/api/apps/{appId}`, GET `/api/apps/{appId}/chat/full-conversation`, POST `/api/apps/{appId}/chat/message`, POST `/api/apps/{appId}/chat/submit-tool-call-input`, GET `/api/apps/{appId}/sandbox/preview-url` (token expires in 300 s), POST `/api/apps/{appId}/deploy`, PUT `/api/apps/{id}`, POST `/api/app-folders/{folderId}/items`. Webhooks deliver signed (Ed25519) app-lifecycle events.

- **Как се ползва:** Enterprise workspace -> obtain workspace ID, API keys and app folder ID -> set BASE44_ORG_ID, BASE44_SVC_KEY, BASE44_PROVISION_KEY, BASE44_PLATFORM_HOST, BASE44_APPS_FOLDER_ID server-side.
- **Ограничения / план:** Enterprise capability plus a launch allowlist (provision endpoint returns 403 otherwise); minted tokens ~1 h TTL; 120 s timeout for sendMessage/createApp/deploy.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/base44-platform-starter · https://raw.githubusercontent.com/base44/base44-platform-starter/main/docs/base44-platform-api.md · https://raw.githubusercontent.com/base44/base44-platform-starter/main/docs/base44-identity.md

## API / Settings (1)

### Secrets (project secrets store)

`base44 secrets list` ('List project secret names'), `secrets set` ('Set one or more project secrets'), `secrets delete`. SSO client secrets are 'stored in Base44's secrets store, not in the local auth config file'.

- **Как се ползва:** `npx base44 secrets set STRIPE_KEY=sk_...`; read in backend functions via Deno.env.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/cli · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/auth-sso.md

## Settings / workspace (1)

### Workspaces (list / get / move)

`base44 workspace list`, `workspace get <id>`, `workspace move [workspace-id]` ('Relocate current app'); `-w, --workspace <id>` on `create`/`link --create` targets a non-personal workspace. Users had requested workspace switching (Discussion #155, Mar 2026).

- **Как се ползва:** `npx base44 workspace list` then `npx base44 workspace move <id>`.
- **Ограничения / план:** Default target is the personal workspace.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md · https://github.com/orgs/base44/discussions/155

## Settings / Security (1)

### SSO and social login configuration (auth sso / social-login / password-login)

`base44 auth sso enable|disable` supports 'Google, Microsoft, GitHub, Okta, and custom OIDC providers' (client ID required; Microsoft tenant ID; Okta domain; custom OIDC needs authorization/token/userinfo endpoints, JWKS URI, display name). 'SSO and social login are mutually exclusive.' Changes go to `base44/auth/` then `base44 auth push` or `deploy`. Added in CLI 0.0.51 (2026-04-28, 'Social login and custom Google OAuth commands').

- **Как се ползва:** `npx base44 auth sso enable --provider okta --client-id ... --okta-domain ...` then `npx base44 auth push`.
- **Ограничения / план:** 'Disabling SSO when no other login method is active will warn that users will be locked out.'
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/auth-sso.md · https://raw.githubusercontent.com/base44/cli/main/CHANGELOG.md

## Settings (1)

### Settings (dashboard page) and dashboard open

Dashboard sidebar ends with 'Settings' and 'MCP' (owner screenshot). `base44 dashboard open` 'Open the app dashboard in your browser'; skills doc describes the dashboard as 'a web interface to manage your app's entities, functions, agents, users, and settings' with URL pattern `https://base44.cloud/apps/<app-id>` (owner screenshots show app.base44.com).

- **Как се ползва:** `npx base44 dashboard open` or the Dashboard toggle in the builder.
- **Ограничения / план:** Settings page contents (rename, delete, transfer, badge, etc.) not verified; Overview already carries 'Platform Badge (Hide Badge)'.
- **Увереност:** low · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/dashboard.md · Owner screenshots of app.base44.com, 3 Oct 2026

## MCP (1)

### Base44 MCP server (https://app.base44.com/mcp)

Remote MCP server at `https://app.base44.com/mcp` (HTTP transport). Auth via OAuth in the browser (Claude Code: `/mcp` -> base44 -> Authenticate) or device flow (`/oauth/device/code`) for headless clients. Scopes: `apps:read` (default) for read_file, grep, list_directory, get_app_preview_url, get_app_status, list_user_apps; `sandbox:write` (explicit grant) for write_file, edit_file, run_command, create_checkpoint. All tools take `appId`; `edit_file` supports `dry_run: true`. Dashboard sidebar has an 'MCP' page (owner screenshot).

- **Как се ползва:** `claude mcp add --transport http base44 https://app.base44.com/mcp` (add `--scope user`), then `/mcp` -> Authenticate; call `list_user_apps` to find appId.
- **Ограничения / план:** Rate limits per app: reads ~120/min, mutations ~60/min, commands ~30/min. Official config snippets for Cursor, ChatGPT and Claude Desktop not found in fetched sources.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-remote-dev/SKILL.md · Owner screenshots of app.base44.com, 3 Oct 2026

## MCP / Integrations (1)

### MCP connector management (list_connectors, initiate_connector_connection)

MCP tools `list_connectors` and `initiate_connector_connection` start OAuth flows for integrations such as Google Calendar, Gmail, Slack. CLI equivalents: `connectors list-available` ('Found 14 available integrations', e.g. Google Calendar, Slack, Stripe), `connectors initiate`, `connectors pull/push`.

- **Как се ползва:** From an MCP client: call `list_connectors` then `initiate_connector_connection` and complete OAuth in the browser; or `npx base44 connectors initiate <slug>`.
- **Ограничения / план:** Connectors are set up via OAuth, 'not by writing files'.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-remote-dev/SKILL.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/connectors-list-available.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sandbox/SKILL.md

## MCP / developer tooling (1)

### Base44 agent skills plugin for Claude Code / Cursor / Codex / OpenCode

Repo `base44/skills` ('AI agent skills for Cursor and Claude Code', 91 stars) ships skills base44-cli, base44-sdk, base44-troubleshooter, base44-remote-dev, base44-sandbox; auto-installed by `base44 create`. A 'sandbox flavor' plugin (`base44-sandbox@base44-skills`) excludes the deploy-oriented CLI skill.

- **Как се ползва:** Claude Code: `/plugin marketplace add base44/skills` then `/plugin install base44@base44-skills`; Codex: `codex plugin marketplace add base44/skills`; others: `npx skills add base44/skills`.
- **Ограничения / план:** MIT licensed.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills · https://github.com/base44/skills/blob/main/README.md · https://github.com/base44

## Settings / deploy (1)

### Multiple environments (not available; feature request)

Discussion #158 (3 Apr 2026) requests dev/staging/prod environments with isolated databases; current workaround is 'creating separate Base44 projects per environment'. No Base44 team reply as of the fetch. `versions deploy` does accept a `--target` environment.

- **Как се ползва:** Create separate apps per environment.
- **Ограничения / план:** Not supported natively per the discussion.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://github.com/orgs/base44/discussions/158 · https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/versions/deploy.ts

## Surfaces / hosting (1)

### base44.app subdomain (default app URL)

Every published app gets a free hosted URL of the form https://<app-name>.base44.app. The CLI prints e.g. 'Visit your site at: https://my-app.base44.app' after deploy, and exported apps use VITE_BASE44_APP_BASE_URL=https://your-base44-app.base44.app. Hosting is SPA-only (single index.html entry; all routes served client-side).

- **Как се ползва:** Publish from the editor; the URL is shown in the banner above the preview ('https://<app>.base44.app'). From the CLI: `npx base44 site deploy` then `npx base44 site open`.
- **Ограничения / план:** Free on all plans. Base44 hosting supports Single Page Applications only (one index.html entry point).
- **Увереност:** high · статус: непотвърдено
- **Източници:** Owner screenshots (banner 'https://<app>.base44.app') · https://github.com/base44/skills/blob/main/skills/base44-cli/references/site-deploy.md · https://github.com/base44/skills/blob/main/skills/base44-cli/references/site-open.md

## Custom domains (1)

### Connect domain / Custom domains (Dashboard > Domains)

Connect your own domain to a published app instead of the base44.app URL. The editor banner has a 'Connect domain' link and the Dashboard sidebar has a 'Domains' page. Docs page: 'Setting up your custom domain'. Third-party FAQ (verified Jul 2026): you can connect an existing external domain and 'some annual paid plans may include a domain benefit'; HTTPS is provided (launch checklist: 'Custom domain and HTTPS, if used').

- **Как се ползва:** Click 'Connect domain' in the URL banner, or open Dashboard > Domains; follow the DNS instructions from the docs page; verify HTTPS on the live URL afterwards.
- **Ограничения / план:** Requires a paid plan: Builder is 'the first listed plan with ... custom domains' (course, Jul 27 2026). Free domain benefit on some annual plans (unverified detail).
- **Увереност:** medium · статус: непотвърдено
- **Източници:** Owner screenshots ('Connect domain', Dashboard 'Domains') · https://docs.base44.com/Setting-up-your-app/Setting-up-your-custom-domain · https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/faq.md

## Environments (1)

### Preview vs production deployments (draft and published environments)

Each app has two deployments: 'preview' (current draft shown in the editor) and 'prod' (what was last published). Backend-function logs can be read per deployment (`base44 logs --env preview|prod`; 'If prod returns no logs, the app may not have been published yet'). The sandbox runtime distinguishes 'local' | 'preview' | 'production'. `base44 dev --remote` runs the frontend against the app's own published backend URL.

- **Как се ползва:** Toggle Preview in the editor to see the draft; publish to update prod. Developers: `npx base44 logs --env prod`.
- **Ограничения / план:** Only two built-in states (draft/published). A separate 'Staging' environment is described by a third-party glossary as 'available under some current plan models' — unverified.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-troubleshooter/references/project-logs.md · https://raw.githubusercontent.com/base44/cli/main/CHANGELOG.md · https://registry.npmjs.org/@base44%2fsuperagent-native

## Versions (1)

### Version History / Restore

The builder keeps a version history of checkpoints (one per AI build message, or created explicitly by external agents). Clicking 'Restore' on an earlier version rolls the app's code back to that checkpoint's commit; everything written after the last checkpoint is discarded. Accessible from the history icon in the top bar.

- **Как се ползва:** Click the history (clock) icon in the top bar, pick a version, click 'Restore'. External agents: `base44 sandbox checkpoint --name "..."` to add a restore point.
- **Ограничения / план:** Restoring discards uncheckpointed work (auto-commits from external agents are not checkpoints). Connecting/disconnecting GitHub has 'important version-history/reconnection limitations' per docs.
- **Увереност:** high · статус: непотвърдено
- **Източници:** Owner screenshots (history icon) · https://github.com/base44/skills/blob/main/skills/base44-remote-dev/SKILL.md · https://raw.githubusercontent.com/base44/cli/main/CHANGELOG.md

## Environments / versions (1)

### Branches ('Main' branch selector)

Apps have a main branch and optional additional branches shown in the top-bar branch selector ('Main'). The CLI exposes `base44 branches list --app-id <id> --json` ('lists main and active branch names for agents working outside Builder') and a global `--branch <name>` flag that targets sandbox commands at a specific app branch ('omitting it or using --branch main targets main'). Chat messages carry a 'branch' icon to branch from a message.

- **Как се ползва:** Click the branch name ('Main') in the top bar to switch or create a branch; or click the branch icon on a chat message.
- **Ограничения / план:** Branch names must be unique ('ambiguous' names fail). Plan gating not documented in the sources found.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** Owner screenshots (branch 'Main', branch icon on messages) · https://raw.githubusercontent.com/base44/cli/main/CHANGELOG.md · Local copy of the base44 npm CLI package (dist contains branches command)

## Versions / hosting (1)

### Versioned site deployments (CLI)

'Previous deployments are preserved (versioned) in Base44' when deploying site files; 'Deployment is immediate and updates your live site'.

- **Как се ползва:** `npm run build && npx base44 site deploy -y` (or `npx base44 deploy -y` to deploy entities, functions, actors, agents, connectors, auth, visibility and site together).
- **Ограничения / план:** CLI/backend path is beta; CLI-created projects are not integrated with the app editor (docs CLI overview per third-party FAQ).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-cli/references/site-deploy.md · https://github.com/base44/skills/blob/main/skills/base44-cli/references/deploy.md · https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/faq.md

## Publish flow / distribution (1)

### Invite Users (Copy Link / Send Invites)

Dashboard > Overview card 'Invite Users' with 'Copy Link' and 'Send Invites' to share the published app with end users; the editor top bar also shows collaborator avatars plus an invite button for co-builders.

- **Как се ползва:** Dashboard > Overview > Invite Users > Copy Link or Send Invites; or top-bar avatars > invite.
- **Ограничения / план:** Not documented in reachable sources.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** Owner screenshots (Overview 'Invite Users', top-bar avatars + invite)

## Mobile companion app (1)

### Mobile companion app ('Manage your app on the go with the mobile app')

Dashboard > Overview promotes a Base44 mobile app for managing your app on the go. Official npm package @base44/superagent-native (created 2026-06-07, 86 versions through 2026-09-16, repo base44-dev/apper) is the 'React Native entrypoint for the Base44 Superagent experience': a self-contained screen running agents, channels, connectors, automations, secrets, files, REST + realtime clients, with file/photo/camera attachments, live voice audio, deep links, share, and an 'onViewPlans' hook that opens a billing modal — i.e. the mobile app is a native shell around the Superagent/chat experience.

- **Как се ползва:** Click 'Manage your app on the go with the mobile app' on Dashboard > Overview to get the store link (store names not confirmed in reachable sources).
- **Ограничения / план:** Store availability and feature parity unverified. Plans/billing visible from the app ('onViewPlans').
- **Увереност:** medium · статус: непотвърдено
- **Източници:** Owner screenshots (Overview card) · https://registry.npmjs.org/@base44%2fsuperagent-native · Local README of @base44/superagent-native (scratchpad b44/base44__superagent-native.README.md)

## Onboarding (1)

### Onboarding from one message (clarifying questions + option chips)

A new app starts from a single prompt. The assistant replies with clarifying questions and clickable option chips before building, e.g. 'What do you want to create?' and 'What kind of business?'; the chat shows states like 'Asking for clarification…', 'Planning…', 'Thought for 2s', 'Read 5 files', and 'Verified the app — …'. Docs pages: 'Starting from your first prompt' and 'Writing effective prompts'. In Plan mode Base44 'asks about the problem, users, flows, and design, then produces a structured plan you can approve' and a 'Start building' button launches the first build.

- **Как се ползва:** Type one sentence in the first-prompt box (optionally choose 'Plan' from the mode menu), answer the chips/questions, review the plan, click 'Start building'.
- **Ограничения / план:** Plan mode before the first build 'currently does not use credits' (course, Jul 2026); building uses message credits (Free: ~25 monthly message credits with a daily cap).
- **Увереност:** high · статус: непотвърдено
- **Източници:** Owner screenshots (clarifying questions, option chips, 'Asking for clarification…', 'Planning…') · https://docs.base44.com/Getting-Started/starting-from-your-first-prompt · https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/00-start-here.md

## Templates (1)

### CLI project templates (backend-and-client, backend-only)

`npx base44 create <name> -p <path> -t <template>` scaffolds from templates: 'backend-and-client' (Vite + React + Tailwind full-stack, now using @base44/vite-plugin and same-origin /api like editor apps) and 'backend-only' (adds Base44 config to an existing project/framework). `--deploy` builds and deploys immediately; `--no-skills` skips installing agent skills; `-w` picks a workspace.

- **Как се ползва:** `npm i -g base44 && base44 login && npx base44 create my-app -p ./my-app -t backend-and-client --deploy`.
- **Ограничения / план:** Requires Node 20.19+; CLI is beta; CLI projects are not integrated with the editor (though `base44 link` now lists editor-created apps).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-cli/references/create.md · https://raw.githubusercontent.com/base44/cli/main/CHANGELOG.md · https://registry.npmjs.org/base44

## Surfaces / developer (1)

### Send to Coding Agent / Open Claude (bring your own agent)

In the app editor a 'Send to Coding Agent' button gives a ready-to-paste prompt for a local agent (Claude Code etc., via MCP endpoint https://app.base44.com/mcp or `base44 sandbox` CLI) or for claude.ai with the Base44 MCP connector, plus an 'Open Claude' button. While an external agent works, the builder chat is blocked ('An external agent is currently working on this app').

- **Как се ползва:** Editor > Send to Coding Agent > copy prompt (local) or click Open Claude (web); authenticate via OAuth; grant 'sandbox:write' for edits.
- **Ограничения / план:** Rate limits per app: reads ~120/min, mutations ~60/min, commands ~30/min; one external agent per app; sandbox:write scope not granted by default.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-remote-dev/SKILL.md · https://github.com/base44/skills/blob/main/README.md

## Education / developer enablement (1)

### Agent Skills and Claude Code / Codex plugin marketplace (base44/skills)

Official 'Agent Skills for Base44' repo (Beta): base44-cli, base44-sdk, base44-troubleshooter, base44-remote-dev, base44-sandbox; installable via `claude plugin install base44@base44-skills`, Codex `/plugins`, or `npx skills add base44/skills`. Feedback goes to GitHub Discussions.

- **Как се ползва:** `/plugin marketplace add base44/skills` then `/plugin install base44@base44-skills` in Claude Code.
- **Ограничения / план:** Beta.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/README.md · https://github.com/orgs/base44/discussions

## Education / support (1)

### Official documentation site and llms.txt

docs.base44.com with sections Getting Started, Building Your App, Setting Up Your App, Integrations, Performance & SEO, Account & Billing, Developers, Enterprise, Community & Support (100+ pages), exposing an llms.txt index (https://docs.base44.com/llms.txt). Base44 also offers an official MCP for docs/dev, which superseded a community docs tool.

- **Как се ползва:** Browse docs.base44.com; agents can read llms.txt or use the Base44 MCP.
- **Ограничения / план:** None.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/Uricorn/base44-docs-tool/main/README.md · https://docs.base44.com/ · https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/resources.md

## Community / support (1)

### Community & Support: Troubleshooting docs and GitHub Discussions

Docs have a 'Community and support' section including a Troubleshooting page. Developer community/feedback runs on GitHub Discussions (orgs/base44/discussions) and issues on github.com/base44/cli. Enterprise has its own page (base44.com/enterprise). Trustpilot profile exists for public reviews.

- **Как се ползва:** docs.base44.com > Community and support > Troubleshooting; post at github.com/orgs/base44/discussions; enterprise contact via base44.com/enterprise.
- **Ограничения / план:** Discord server and support-ticket/email channels could not be verified this session (see open questions).
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://docs.base44.com/Community-and-support/Troubleshooting · https://github.com/orgs/base44/discussions · https://github.com/base44/cli/issues

## Education (1)

### Third-party education (free course, starter kits, SEO guide)

Community-made learning material: 'Vibe Coding with Base44' course (7 lessons, 20+ prompts, 3 starter kits, glossary, FAQ, last verified Jul 27 2026); 'VibeCodingSEO' guide; curated 'awesome-base-44' link list.

- **Как се ползва:** Open the GitHub repos.
- **Ограничения / план:** Unofficial; contains affiliate links.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://github.com/cporter202/vibe-coding-with-base44 · https://github.com/grok-cli/awesome-base-44 · https://github.com/markfulton/VibeCodingSEO

## Wix acquisition (1)

### Base44 Payments powered by Wix (post-acquisition change)

After the Wix acquisition, Base44 added 'Base44 Payments' documented on a page literally named 'setting-up-wix-payments' ('Base44 Payments powered by Wix' alongside Stripe), a 'Wix' connector in the connectors list, and Base44 is now part of Wix (the course FAQ cites 'Base44 Payments in supported regions'). The acquisition itself (Wix acquired Base44 in June 2025 for ~US$80M cash) is widely reported but could not be fetched this session.

- **Как се ползва:** Dashboard > Integrations or ask the chat to add payments; docs 'Setting up Base44 Payments'.
- **Ограничения / план:** Payments available in supported regions only; fees/plan requirements per docs.
- **Увереност:** low · статус: непотвърдено
- **Източници:** https://docs.base44.com/Setting-up-your-app/setting-up-wix-payments · https://github.com/base44/skills/blob/main/skills/base44-sdk/references/connectors.md · https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/04-integrations-workflows.md

## Surfaces (1)

### Dashboard > Overview (Earn credits, View usage, promo)

The Dashboard Overview shows app name/description/logo, 'Earn credits' (referral), 'View usage', App Visibility, Invite Users, Platform Badge and the mobile-app card; the editor top bar carries a '30% off' promo button.

- **Как се ползва:** Toggle 'Dashboard' in the editor top bar.
- **Ограничения / план:** Not documented beyond screenshots.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** Owner screenshots of Dashboard Overview

## Publish flow / automation (1)

### Workflow trigger on publish (app_publish)

Workflows (Dashboard > Workflows, 'New') support trigger types including 'app_publish' (also scheduled, entity, connector, in_app_agent, app_user_auth, app_payment, webhook, goal_file, manual).

- **Как се ползва:** Dashboard > Workflows > new workflow > trigger 'app publish'. Runs are listed with `base44 workflows runs`.
- **Ограничения / план:** Apps that predate Workflows (legacy automations) are not readable via the CLI command.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://github.com/base44/skills/blob/main/skills/base44-cli/references/workflows-runs.md · Owner screenshots (Dashboard 'Workflows (New)')

## Backend functions (1)

### Backend functions (Deno runtime)

Serverless functions written as `export default async function (req: Request): Promise<Response>` in base44/functions/<name>/entry.ts (or entry.js). Use Web APIs (req.json(), Response.json(body,{status})). Imports: `npm:` (e.g. npm:@base44/sdk), `jsr:`, relative files in the same folder, and base44/shared/ for shared code; files outside base44/ cannot be imported. `base44:runtime` provides `secrets` and `waitUntil()` (post-response work). createClientFromRequest(req) inherits caller auth; BASE44_APP_ID is pre-populated. Deployed functions are reachable at POST https://<app-domain>/functions/<name> (nested folders map to nested paths like orders/process). SDK: base44.functions.invoke(name, data) returns an axios response (result in .data; throws on non-2xx with err.response.data); functions.fetch(path, init) for streaming/custom verbs; File objects auto-switch to multipart.

- **Как се ползва:** Builder: ask the chat to add a backend function (appears under Dashboard → Code). CLI: create base44/functions/process-order/entry.ts, `npx base44 functions deploy [names] [--force]`, `functions list`, `functions pull`, `functions delete`. Sandbox: write the file; auto-deploys.
- **Ограничения / план:** Function folder names kebab-case/alphanumeric; crypto must use async Web Crypto (Stripe constructEventAsync). Timeouts/memory not published. Multi-file shared-module bundling was a CLI gap (issue #562, closed).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/functions-create.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/functions.md · https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/functions.ts

## Backend / realtime (1)

### Realtime Actors (WebSocket rooms)

Stateful WebSocket server rooms (one instance per room id) for multiplayer, presence, chat, timers. Server: class extending Actor from base44:runtime/actors in base44/actors/<PascalName>/entry.ts with handleStart, handleConnect(conn), handleMessage(conn,msg), handleClose(conn), handleTick (managed ticker via shouldTick(), default 100 ms), this.broadcast(), conn.send(), this.getConnections(), this.storage.get/put (survives hibernation), conn.identity ({type:'authenticated', userId} | {type:'anonymous', anonymousId}), this.client / this.client.asServiceRole. Client: base44.actors.RoomName(id).connect({id}) → subscribe(cb) (returns {unsubscribe()}), send(data), close().

- **Как се ползва:** CLI: `npx base44 actors deploy [names]`, `actors delete`; sandbox: write entry.ts. Frontend: connect in a React effect and store the ref.
- **Ограничения / план:** Room ids 1–256 printable ASCII, no '/'; message type names starting with '__' reserved; two live connections cannot share an id; actors cannot read secrets; no scheduled automations from actors; actor upload excludes base44/shared/.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/actors.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sandbox/SKILL.md

## File storage (1)

### File storage: UploadFile, UploadPrivateFile, CreateFileSignedUrl, ExtractDataFromUploadedFile

Core integrations for files. UploadFile({file}) → {file_url} public URL. UploadPrivateFile({file}) → {file_uri} requiring a signed URL. CreateFileSignedUrl({file_uri, expires_in}) → {signed_url}; expires_in default 300 s, range 60–3600 s. ExtractDataFromUploadedFile({file_url, json_schema}) uses AI to return structured data from an uploaded file. Entity fields can be typed format 'file' or type 'binary'.

- **Как се ползва:** `const {file_url} = await base44.integrations.Core.UploadFile({file})` from a file input; store file_url in an entity.
- **Ограничения / план:** Signed URL max 1 hour; file size limits not published. Core integrations available on all plans.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/integrations.types.ts · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/integrations.md

## Email sending (1)

### SendEmail (Core integration)

base44.integrations.Core.SendEmail({to, subject, body, from_name?}) sends an email; body is plain text/HTML; from_name defaults to the app name. Documented as sending to registered app users. Also usable server-side from backend functions.

- **Как се ползва:** Call SendEmail from the frontend or a backend function (e.g. after an inquiry form submit).
- **Ограничения / план:** 1 credit per email, 2 credits with a custom (email) domain; included on all plans. Recipient restriction to app users per SDK docs.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/integrations.md · https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/integrations.types.ts

## Backend / AI integrations (1)

### InvokeLLM and GenerateImage (Core AI integrations)

InvokeLLM({prompt, model?, add_context_from_internet?, response_json_schema?, file_urls?}) returns text or schema-shaped JSON; models listed in the SDK types: gpt_5_mini, gemini_3_flash, gpt_5_4, gpt_5_6_sol, gpt_5_6_luna, gemini_3_1_pro, claude_sonnet_4_6, claude_opus_4_6/4_7/4_8, claude-sonnet-5. GenerateImage({prompt, existing_image_urls?}) returns {url} (~1024 px short side).

- **Как се ползва:** `await base44.integrations.Core.InvokeLLM({prompt, response_json_schema})`.
- **Ограничения / план:** Single call, no tool use (use aiGateway for agents); metered in credits; non-default models use more credits.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/integrations.types.ts · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/integrations.md

## Backend / AI (1)

### AI Gateway (OpenAI-compatible endpoint)

base44.aiGateway.connection() returns {baseURL, token} for an OpenAI-compatible Chat Completions endpoint usable from Vercel AI SDK, Mastra, OpenAI SDK for tool-calling agent loops inside backend functions. Default model 'automatic' (cheapest); named models like claude_sonnet_4_6 cost more credits. Images via message content parts. Requests propagate a 'Base44-State' header.

- **Как се ползва:** In a backend function: `const {baseURL, token} = base44.aiGateway.connection(); createOpenAICompatible({name:'base44', baseURL, apiKey: token})`.
- **Ограничения / план:** Backend only; no streaming; metered per call against the app's credit quota like InvokeLLM; must bound loops (stopWhen).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/ai-gateway.md · https://raw.githubusercontent.com/base44/javascript-sdk/main/src/client.ts

## External connections (1)

### Custom integrations (OpenAPI) and Connectors

Two mechanisms. (1) Custom integrations: workspace admins register an external API by OpenAPI spec; call with base44.integrations.custom.call(slug, operationId 'get:/contacts', {payload, pathParams, queryParams}) → {success, status_code, data}; endpoint POST /apps/{appId}/integrations/custom/{slug}/{operationId}. (2) Connectors: app-level OAuth connections (catalog incl. googlecalendar, gmail, slack, stripe (auto-provisioned), Dropbox, Box, Google Drive, OneDrive, Discord, Teams, Notion, Airtable, Sheets/Docs/Classroom, Salesforce, HubSpot, GitHub, Linear, Google Analytics, Search Console; 14–34 types reported). Backend: asServiceRole.connectors.getConnection(type) → {accessToken, connectionConfig} with automatic token refresh; getWorkspaceConnection(connectorId); callApi(type, {method, path, query, headers, body, host}) proxies a request and reports credits charged. Per-user connectors: base44.connectors.connectAppUser(connectorId) (redirect URL), disconnectAppUser, and asServiceRole.connectors.getCurrentAppUserConnection(connectorId).

- **Как се ползва:** Dashboard → Integrations; or `npx base44 connectors list-available`, `connectors initiate --integration-type googlecalendar --scopes …`, `connectors push/pull`; MCP tools list_connectors / initiate_connector_connection.
- **Ограничения / план:** Custom/catalog integrations require Builder plan or higher; one connector per type per app; connecting REPLACES the scope set (no merge).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/connectors.ts · https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/custom-integrations.ts · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/connectors.md

## Auth / users (1)

### App Users: roles and invitations

Two app-user roles: 'user' and 'admin'. Invite via base44.users.inviteUser(email, role) (also auth.inviteUser) → POST /apps/{appId}/users/invite-user; invitee gets an email with a join link; re-inviting resends. Dashboard Overview exposes 'Invite Users' (Copy Link, Send Invites) and the 'App Users' page. App Visibility: public (anyone), private (authorized users only), workspace (workspace members).

- **Как се ползва:** Dashboard → App Users / Overview → Invite Users; or `npx base44 visibility public|private|workspace` (immediate, no deploy).
- **Ограничения / план:** Role must be 'user' or 'admin' (SDK throws otherwise).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/users.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/visibility.md · https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/auth.ts

## Scheduled tasks / automations (1)

### Workflows (scheduled tasks and event automations)

Dashboard 'Workflows (New)' page (replaces legacy 'automations'). Trigger types reported by the CLI: scheduled (cron), entity events, connector events, in-app agent, authentication, publishing, payments, webhooks, goal files, and manual (test runs / 'run now'). Runs record runId, workflowId, triggerType, status (running/completed/failed/cancelled), startedAt, completedAt, durationMs, stepsCount, errorMessage, isTestRun, statusReason; failed runs show which task broke and backend-function HTTP error details. Workflow list shows status (active/paused), totalRuns, lastRunAt/status, consecutiveFailures.

- **Как се ползва:** Dashboard → Workflows to create/test; `npx base44 workflows list [-n 1–200]`, `npx base44 workflows runs [--status failed] [--since 1h|2d] [--limit]`.
- **Ограничения / план:** CLI lists at most 200 workflows/runs, no paging; apps predating Workflows (legacy automations) fail the command; sandbox docs: scheduled work needs backend functions, actors have no automations.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/workflows-runs.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/workflows-list.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sandbox/SKILL.md

## Backend / agents (1)

### AI Agents (conversational, with WhatsApp)

Platform-run conversational agents defined in base44/agents/<name>.jsonc (name, description, instructions, tool_configs referencing entities with allowed_operations read/create/update/delete or backend functions, memory_config {enabled, scope global|user|both}, whatsapp_greeting) plus reusable agent-skills Markdown files. SDK base44.agents: createConversation, getConversations, getConversation, listConversations, subscribeToConversation (WebSocket), addMessage, getWhatsAppConnectURL(agentName). Dashboard 'Agents' page.

- **Как се ползва:** Dashboard → Agents; CLI `npx base44 agents push/pull`, `agent-skills push/pull`.
- **Ограничения / план:** Agent names /^[a-z0-9_]+$/ (1–100 chars); skill names kebab-case 1–64 chars, body ≤15,000 chars; push is a full replace.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/base44-agents.md

## Local development / developer platform (1)

### Remote development via MCP server (app.base44.com/mcp) and cloud sandbox

Dashboard 'MCP' page. Connect any coding agent (Claude Code, Cursor, Codex) to an app's cloud sandbox: `claude mcp add --transport http base44 https://app.base44.com/mcp`, OAuth PKCE or device flow (/oauth/device/code). Scopes apps:read (read_file, grep, list_directory, get_app_preview_url, get_app_status, list_user_apps) and sandbox:write (write_file, edit_file, run_command, create_checkpoint); connector tools list_connectors, initiate_connector_connection. Writes auto-commit (~5 s) and auto-deploy entities/functions/actors/agents; only create_checkpoint entries appear in the builder's version history (Restore/Revert). Same tools via `base44 sandbox …` CLI.

- **Как се ползва:** Add the MCP server, run /mcp → Authenticate, then edit files; call create_checkpoint before stopping.
- **Ограничения / план:** ~120 reads/min, ~60 mutations/min, ~30 commands/min per app; one external agent per app (builder blocked while active, ~10 min idle timeout); commands 120 s default / 600 s max, output ~1 MB; .agents/ protected; no live logs (tail /tmp/vite.log).
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-remote-dev/SKILL.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sandbox/SKILL.md

## Logs / observability (1)

### Function logs (base44 logs, Dashboard Logs)

Backend function logs viewable in the Dashboard 'Logs' page and via `npx base44 logs [--app-id] [--function <name>] [--level error] [--since/--until] [--limit ≤500] [--env prod|preview] [--follow]`. Follow mode streams lines in under a second where available, otherwise polls with ~20–30 s lag. SDK appLogs module: logUserInApp(pageName), fetchLogs(params), getStats({from,to}) (shown in Analytics page).

- **Как се ползва:** Dashboard → Logs, or `npx base44 logs --follow --function processOrder`.
- **Ограничения / план:** One-shot fetches lag ~20–30 s; --limit clamped to 500; --since/--until/--order rejected with --follow; legacy per-function deployments emit unstamped rows.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-troubleshooter/SKILL.md · https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/app-logs.ts · https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/app-logs.md

## Developer platform / analytics (1)

### Analytics event tracking (analytics.track)

base44.analytics.track(eventName, properties) records custom events (primitive property values) shown in the Dashboard 'Analytics' page; the SDK auto-captures initialization, heartbeat and session duration. Client option analytics.enabled.

- **Как се ползва:** `base44.analytics.track('inquiry_submitted', {source:'hero'})`.
- **Ограничения / план:** No PII recommended; limits not published.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/analytics.md · https://github.com/base44/javascript-sdk

## External app connections / developer platform (1)

### Platform / white-label embedding (base44-platform-starter)

Reference Next.js starter showing how to embed the Base44 builder inside a third-party product: per-user Base44 service principals, server-side API proxy with allow-list, public data callback API for built apps, and inbound signed webhooks (app deletion/state changes, verified with BASE44_WEBHOOK_PUBLIC_KEYS). Env: BASE44_ORG_ID, BASE44_SVC_KEY (user_tokens:mint), BASE44_PROVISION_KEY (service_users:provision), BASE44_PLATFORM_HOST, BASE44_APPS_FOLDER_ID; `npm run webhook:register -- --url … --activate <endpoint-id>`.

- **Как се ползва:** Clone the starter, configure env, run `npm run db:migrate && npm run dev`; register webhooks.
- **Ограничения / план:** Requires a provisioned Base44 workspace/org and scoped API keys (enterprise/partner arrangement implied).
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://github.com/base44/base44-platform-starter

## External app connections (1)

### Stripe Projects / projects.dev provisioning

Base44 apps can be provisioned from Stripe Projects / projects.dev; credentials arrive as BASE44_PROJECTS_* env vars (app id, access/refresh tokens) which the CLI normalizes, so `npx base44 scaffold` works without interactive login. Stripe is a special auto-provisioned connector type (no OAuth).

- **Как се ползва:** After provisioning, run `npx base44 scaffold` in the project folder.
- **Ограничения / план:** Scaffold uses backend-only template, never deploys.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/scaffold.md · https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md

## Developer changelog (1)

### Developer changelog / support channels

Developer-facing release tracking happens via GitHub Releases for base44/cli (v0.1.16–v0.1.25, Sept–Oct 2026), npm versions of @base44/sdk (0.8.x) and 'base44', GitHub Issues (cli bugs) and GitHub Discussions (orgs/base44/discussions) for feature requests. The official product changelog lives on docs.base44.com (not reachable in this audit).

- **Как се ползва:** Watch https://github.com/base44/cli/releases and https://github.com/orgs/base44/discussions.
- **Ограничения / план:** Release notes pages failed to render in this session.
- **Увереност:** medium · статус: непотвърдено
- **Източници:** https://github.com/base44/cli/releases · https://github.com/orgs/base44/discussions · https://registry.npmjs.org/@base44/sdk

## Support (1)

### Support channels and scope

Support = docs with 'Ask a question' AI assistant, Discord community (weekly office hours Tue/Wed/Thu 5 PM UTC), and ticket system (My Support Tickets at app.base44.com/support/conversations). Scope covers platform bugs, billing/account, Base44 connectors and GitHub sync; it explicitly does not debug your app code, prompts or architecture (use Discord or hire a partner). Elite gets 'Premium support'; Enterprise gets priority support with guaranteed response times and a dedicated account manager. Status page at status.base44.com; roadmap/feedback at feedback.base44.com. Support Terms allow Base44 to ignore/revoke support for abusive or policy-contesting tickets.

- **Как се ползва:** Docs > Ask a question; or app.base44.com/support/conversations > + New Ticket (include app link, expected vs actual, screenshots).
- **Ограничения / план:** No published SLA below Enterprise; 'Response times vary based on ticket volume'.
- **Увереност:** high · статус: непотвърдено
- **Източници:** https://docs.base44.com/Community-and-support/Contacting-support · https://docs.base44.com/Community-and-support/community · https://docs.base44.com/Enterprise/enterprise-overview

## Всички източници (363)

- Local README of @base44/superagent-native (scratchpad b44/base44__superagent-native.README.md)
- Local copy of the base44 npm CLI package (dist contains branches command)
- Owner screenshots ('Connect domain', Dashboard 'Domains')
- Owner screenshots (Dashboard 'Workflows (New)')
- Owner screenshots (Dashboard sidebar 'Code')
- Owner screenshots (Overview 'Invite Users', top-bar avatars + invite)
- Owner screenshots (Overview card)
- Owner screenshots (banner 'https://<app>.base44.app')
- Owner screenshots (branch 'Main', branch icon on messages)
- Owner screenshots (clarifying questions, option chips, 'Asking for clarification…', 'Planning…')
- Owner screenshots (device toggle)
- Owner screenshots (history icon)
- Owner screenshots of Dashboard Overview
- Owner screenshots of app.base44.com (3 Oct 2026)
- Owner screenshots of app.base44.com, 3 Oct 2026
- https://axonbuild.com/blog/base44-pricing/
- https://base44.com/affiliates
- https://base44.com/ai-agent-builder
- https://base44.com/ai-app-builder
- https://base44.com/blog/base44-ai-app-builder
- https://base44.com/blog/how-much-does-base44-cost
- https://base44.com/blog/how-to-write-ai-prompts
- https://base44.com/blog/introducing-branches
- https://base44.com/blog/maor-shlomo-building-the-model-behind-base
- https://base44.com/blog/update-smarter-building-with-automatic-optimization
- https://base44.com/blog/vibe-coding
- https://base44.com/blog/vibe-coding-best-practices
- https://base44.com/changelog
- https://base44.com/changelog/feature/base44-mobile-app-
- https://base44.com/changelog/feature/discussion-mode
- https://base44.com/changelog/feature/improved-versioning-&-project-history
- https://base44.com/changelog/feature/mobile-preview-mode
- https://base44.com/changelog/feature/referral-
- https://base44.com/changelog/feature/upgraded-analytics
- https://base44.com/changelog/feature/visual-edits
- https://base44.com/enterprise
- https://base44.com/pricing
- https://base44.com/website-builder
- https://docs.base44.com/
- https://docs.base44.com/Account-and-billing/Billing-and-plans
- https://docs.base44.com/Account-and-billing/Credits
- https://docs.base44.com/Account-and-billing/Managing-your-workspaces
- https://docs.base44.com/Account-and-billing/Student-discount
- https://docs.base44.com/Account-and-billing/tos-update-june-2026
- https://docs.base44.com/Building-your-app/AI-agents-for-apps
- https://docs.base44.com/Building-your-app/AI-chat-modes
- https://docs.base44.com/Building-your-app/Canvas
- https://docs.base44.com/Building-your-app/Commenting-on-your-app
- https://docs.base44.com/Building-your-app/Creating-workflows
- https://docs.base44.com/Building-your-app/Design
- https://docs.base44.com/Building-your-app/Design-foundations-and-layout
- https://docs.base44.com/Building-your-app/Managing-your-app-data
- https://docs.base44.com/Building-your-app/Mobile-experience
- https://docs.base44.com/Building-your-app/Using-media
- https://docs.base44.com/Building-your-app/managing-your-pages
- https://docs.base44.com/Building-your-app/working-with-branches
- https://docs.base44.com/Community-and-support/Contacting-support
- https://docs.base44.com/Community-and-support/Deleting-user-data
- https://docs.base44.com/Community-and-support/Referral-program
- https://docs.base44.com/Community-and-support/Troubleshooting
- https://docs.base44.com/Community-and-support/community
- https://docs.base44.com/Community-and-support/partner-program
- https://docs.base44.com/Enterprise/Enterprise-SSO-and-app-visibility
- https://docs.base44.com/Enterprise/Set-up-SSO
- https://docs.base44.com/Enterprise/backup-and-restore
- https://docs.base44.com/Enterprise/data-version-history
- https://docs.base44.com/Enterprise/enterprise-overview
- https://docs.base44.com/Enterprise/managing-enterprise-members
- https://docs.base44.com/Getting-Started/Glossary
- https://docs.base44.com/Getting-Started/Prompt-guide
- https://docs.base44.com/Getting-Started/Prompt-library
- https://docs.base44.com/Getting-Started/Quick-start-guide
- https://docs.base44.com/Getting-Started/Referral-program
- https://docs.base44.com/Getting-Started/starting-from-your-first-prompt
- https://docs.base44.com/Getting-Started/superagent
- https://docs.base44.com/Getting-started/changelog
- https://docs.base44.com/Guides/Setting-up-SSO
- https://docs.base44.com/Integrations/AI-integrations
- https://docs.base44.com/Integrations/built-in-integrations
- https://docs.base44.com/Integrations/github-connector
- https://docs.base44.com/Integrations/gmail-connector
- https://docs.base44.com/Integrations/linkedin-connector
- https://docs.base44.com/Integrations/slack-connector
- https://docs.base44.com/Performance-and-SEO/App-performance
- https://docs.base44.com/Performance-and-SEO/checking-your-seo-and-geo
- https://docs.base44.com/Setting-up-your-app/Managing-access
- https://docs.base44.com/Setting-up-your-app/Managing-login-and-registration
- https://docs.base44.com/Setting-up-your-app/Managing-security-settings
- https://docs.base44.com/Setting-up-your-app/Setting-up-SSO
- https://docs.base44.com/Setting-up-your-app/Setting-up-your-custom-domain
- https://docs.base44.com/Setting-up-your-app/running-a-security-scan
- https://docs.base44.com/Setting-up-your-app/setting-up-wix-payments
- https://docs.base44.com/Setting-up-your-app/tracking-payments
- https://docs.base44.com/api-reference/apps/get-app-analytics
- https://docs.base44.com/api-reference/generate-app-logo
- https://docs.base44.com/api-reference/get-analytics-user-stats
- https://docs.base44.com/changelog/developers
- https://docs.base44.com/changelog/product
- https://docs.base44.com/developers/app-code/editor/code-tab
- https://docs.base44.com/developers/app-code/local-development/github
- https://docs.base44.com/developers/backend/overview/pricing
- https://docs.base44.com/developers/backend/resources/auth
- https://docs.base44.com/developers/backend/resources/entities/entity-schemas
- https://docs.base44.com/developers/backend/resources/entities/user-schema
- https://docs.base44.com/developers/references/cli/commands/auth-social-login
- https://docs.base44.com/developers/references/cli/commands/branches-list
- https://docs.base44.com/developers/references/cli/get-started/overview
- https://docs.base44.com/developers/references/sdk/docs/interfaces/analytics
- https://docs.base44.com/developers/references/sdk/docs/type-aliases/integrations
- https://docs.base44.com/developers/references/sdk/getting-started/ai-gateway-images
- https://docs.base44.com/developers/skills/base44-cli/references/visibility
- https://docs.base44.com/developers/skills/base44-sdk/references/auth
- https://docs.base44.com/developers/skills/base44-sdk/references/users
- https://docs.base44.com/developers/white-label/skills-and-mcp
- https://docs.base44.com/documentation/account-and-billing/managing-your-account
- https://docs.base44.com/documentation/account-and-billing/new-plans-and-workspaces
- https://docs.base44.com/documentation/building-your-app/uploading-to-app-stores
- https://docs.base44.com/documentation/integrations/managing-workspace-integrations
- https://docs.base44.com/documentation/managing-app-data/testing-your-data
- https://docs.base44.com/documentation/performance-and-seo/app-analytics
- https://docs.base44.com/documentation/performance-and-seo/session-recordings
- https://docs.base44.com/documentation/using-your-workspaces/adding-workspace-skills
- https://docs.base44.com/documentation/using-your-workspaces/managing-workspace-members
- https://docs.base44.com/documentation/using-your-workspaces/managing-your-workspace-apps
- https://docs.base44.com/promoting-your-app/submitting-to-launchpad
- https://docs.base44.com/pt-BR/developers/references/sdk/docs/interfaces/ai-gateway
- https://docs.base44.com/superagents/customizing-your-superagent
- https://escapebase44.com/base44-export-code
- https://feedback.base44.com/p/auto-mode-only-is-disrupting-professional-system-design
- https://feedback.base44.com/p/auto-model-selection-is-bad-give-option-to-select-specific
- https://feedback.base44.com/p/base44s-quality-just-went-down-no-ai-model-selection
- https://feedback.base44.com/p/gemini-3-pro-a-game-changer
- https://feedback.base44.com/p/image-output-changed-to-1024x1024-on-march-10th-destroyed-my
- https://feedback.base44.com/p/improvements-to-the-inbuilt-image-generation
- https://feedback.base44.com/p/need-update-to-documentation-on-finding-out-how-many-credits
- https://feedback.base44.com/p/no-more-ai-model-selection
- https://feedback.base44.com/p/removal-of-model-selection-in-base44-is-blocking-real-workflows
- https://feedback.base44.com/p/seed-functionality-in-the-generateimage-integration-for-consistent-image-generation
- https://feedback.base44.com/p/visual-edits-change-text
- https://feedback.base44.com/p/your-badge-position-is-blocking-my-app
- https://github.com/Ai-Automators/base44-to-supabase-sdk
- https://github.com/Amal-David/docingest/blob/main/server/storage/docs/docs.base44.com/documentation_2026-07-07T03:54:54.947Z.md
- https://github.com/Christophersimons13/eride-content-queue/blob/main/pending/ai-tools-drop-2026-09-28/article.md
- https://github.com/Lior-Nis/base44_analysis/blob/main/data/raw/reddit_scraped_data_posts.csv
- https://github.com/PlayFundWin/daily-build-feed/blob/master/transcripts/ep041.txt
- https://github.com/ViniTasso/meu-portifolio-landingpage/blob/main/modelos/base44.com/raw/assets/sitemap.xml
- https://github.com/aadarshvelu/news-archive/blob/main/2026/August/11-Aug-26.json
- https://github.com/base44
- https://github.com/base44/base44-platform-starter
- https://github.com/base44/cli
- https://github.com/base44/cli/blob/main/CHANGELOG.md
- https://github.com/base44/cli/blob/main/README.md
- https://github.com/base44/cli/blob/main/packages/cli/src/core/resources/connector/stripe.ts
- https://github.com/base44/cli/blob/main/packages/functions-compiler/src/fetch-guard.ts
- https://github.com/base44/cli/issues
- https://github.com/base44/cli/issues/562
- https://github.com/base44/cli/issues/633
- https://github.com/base44/cli/issues/636
- https://github.com/base44/cli/releases
- https://github.com/base44/cli/tree/main/packages/functions-compiler/src/private-data-sources
- https://github.com/base44/javascript-sdk
- https://github.com/base44/kotlin-sdk
- https://github.com/base44/openclaw-onboarding
- https://github.com/base44/skills
- https://github.com/base44/skills/blob/main/README.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/SKILL.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/auth-social-login.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/auth-sso.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/connectors-create.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/connectors-initiate.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/connectors-push.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/create.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/deploy.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/eject.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/entities-create.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/exec.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/functions-create.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/rls-examples.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/secrets-list.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/secrets-set.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/site-deploy.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/site-open.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/visibility.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/workflows-list.md
- https://github.com/base44/skills/blob/main/skills/base44-cli/references/workflows-runs.md
- https://github.com/base44/skills/blob/main/skills/base44-remote-dev/SKILL.md
- https://github.com/base44/skills/blob/main/skills/base44-sandbox/SKILL.md
- https://github.com/base44/skills/blob/main/skills/base44-sdk/references/ai-gateway.md
- https://github.com/base44/skills/blob/main/skills/base44-sdk/references/app-logs.md
- https://github.com/base44/skills/blob/main/skills/base44-sdk/references/auth.md
- https://github.com/base44/skills/blob/main/skills/base44-sdk/references/connectors.md
- https://github.com/base44/skills/blob/main/skills/base44-sdk/references/entities.md
- https://github.com/base44/skills/blob/main/skills/base44-sdk/references/functions.md
- https://github.com/base44/skills/blob/main/skills/base44-sdk/references/integrations.md
- https://github.com/base44/skills/blob/main/skills/base44-troubleshooter/SKILL.md
- https://github.com/base44/skills/blob/main/skills/base44-troubleshooter/references/project-logs.md
- https://github.com/base44/swift-sdk
- https://github.com/carloearl/glyphlock/blob/main/src/lib/nups/frontendDemoSeeder.js
- https://github.com/cporter202/vibe-coding-with-base44
- https://github.com/danarandall/ai-a11y-toolkit/blob/main/START-HERE.md
- https://github.com/despia-native/despia-blog/blob/main/cmsfsl2a100020ajmbqochph4.md
- https://github.com/dstadelman/dstadelman.github.io/blob/main/_posts/2026-07-09-fable-is-back-here-s-what-you-should-try-first.md
- https://github.com/gmena83/goti/blob/main/docs/vibecoding-tutorials/other/01_How_To_Build_an_App_Using_ONLY_AI__Base44__n8n_Beginner_Tutorial__Vibe_Coding.md
- https://github.com/grok-cli/awesome-base-44
- https://github.com/markfulton/VibeCodingSEO
- https://github.com/orgs/base44/discussions
- https://github.com/orgs/base44/discussions/155
- https://github.com/orgs/base44/discussions/158
- https://github.com/orgs/base44/discussions/241
- https://news.ycombinator.com/item?id=44736101
- https://preuve.ai/blog/base44-review
- https://raw.githubusercontent.com/DanielWLiu07/pomme/main/docs/BASE44.md
- https://raw.githubusercontent.com/Peter-Sixhoj/ai-dev-tools-evaluations/main/projects/ai-dev-tools/evaluations/base44-evaluation.md
- https://raw.githubusercontent.com/PlayFundWin/daily-build-feed/master/archive/covered.md
- https://raw.githubusercontent.com/Tyler-R-Kendrick/epoch/main/docs/competition/products/base44/gossip.md
- https://raw.githubusercontent.com/Uricorn/base44-docs-tool/main/README.md
- https://raw.githubusercontent.com/ayeexcatx/ccg-site-docs/main/README.md
- https://raw.githubusercontent.com/baeseokjae/baeseokjae.github.io/main/content/posts/base44-review-2026.md
- https://raw.githubusercontent.com/base44/base44-platform-starter/main/docs/base44-identity.md
- https://raw.githubusercontent.com/base44/base44-platform-starter/main/docs/base44-platform-api.md
- https://raw.githubusercontent.com/base44/cli/main/CHANGELOG.md
- https://raw.githubusercontent.com/base44/cli/main/docs/commands.md
- https://raw.githubusercontent.com/base44/cli/main/docs/deployments.md
- https://raw.githubusercontent.com/base44/cli/main/docs/resources.md
- https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/branches/index.ts
- https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/publish.ts
- https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/sandbox/checkpoint.ts
- https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/sandbox/index.ts
- https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/sandbox/shared.ts
- https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/versions/create.ts
- https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/versions/deploy.ts
- https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/workflows/legacy-app.ts
- https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/workflows/limit.ts
- https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/commands/workflows/runs.ts
- https://raw.githubusercontent.com/base44/cli/main/packages/cli/src/cli/program.ts
- https://raw.githubusercontent.com/base44/javascript-sdk/main/src/client.ts
- https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/app-logs.ts
- https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/auth.ts
- https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/connectors.ts
- https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/custom-integrations.ts
- https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/entities.ts
- https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/entities.types.ts
- https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/functions.ts
- https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/integrations.types.ts
- https://raw.githubusercontent.com/base44/javascript-sdk/main/src/modules/sso.ts
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/SKILL.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/agent-skills-push.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/agents-push.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/auth-password-login.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/auth-social-login.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/auth-sso.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/connectors-list-available.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/create.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/dashboard.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/deploy.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/dev.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/eject.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/entities-create.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/exec.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/functions-create.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/rls-examples.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/scaffold.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/types-generate.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/visibility.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/workflows-list.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-cli/references/workflows-runs.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-remote-dev/SKILL.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sandbox/SKILL.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/SKILL.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/QUICK_REFERENCE.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/actors.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/ai-gateway.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/analytics.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/app-logs.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/auth.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/base44-agents.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/client.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/connectors.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/entities.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/functions.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/integrations.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/sso.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-sdk/references/users.md
- https://raw.githubusercontent.com/base44/skills/main/skills/base44-troubleshooter/SKILL.md
- https://raw.githubusercontent.com/benjamincanac/whichcodingtools/main/content/tools/base44.yml
- https://raw.githubusercontent.com/calebnewtonusc/amber-circles/main/research/vibe-coding-vs-docs.md
- https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/README.md
- https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/00-start-here.md
- https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/04-integrations-workflows.md
- https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/06-launch-checklist.md
- https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/07-developer-path.md
- https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/faq.md
- https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/glossary.md
- https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/quick-reference.md
- https://raw.githubusercontent.com/cporter202/vibe-coding-with-base44/main/docs/resources.md
- https://raw.githubusercontent.com/debraj-m/reddit_analyser/main/knowledge/blog/vendor-lock-in-ai-platforms.md
- https://raw.githubusercontent.com/edgarstool/edgars-mcp/main/docs/BASE44-HONGDOULANG-DEEP-RESEARCH.md
- https://raw.githubusercontent.com/grok-cli/awesome-base-44/main/README.md
- https://raw.githubusercontent.com/hewi333/Mom-n-Pop-Skills/main/skills/small-business-website-spec/references/base44-pricing.md
- https://raw.githubusercontent.com/johns10/code_my_spec_docs/main/content/base44-alternatives.md
- https://registry.npmjs.org/@base44%2fsuperagent-native
- https://registry.npmjs.org/@base44-preview%2fmetro-plugin
- https://registry.npmjs.org/@base44/sdk
- https://registry.npmjs.org/base44
- https://startupfortune.com/base44-built-its-own-ai-model-because-generic-chatbots-make-ugly-apps/
- https://tech.yahoo.com/ai/claude/articles/pitted-44s-ai-model-against-050048367.html
- https://techcrunch.com/2025/06/18/6-month-old-solo-owned-vibe-coder-base44-sells-to-wix-for-80m-cash/ (not fetched; blocked)
- https://techcrunch.com/2026/06/29/vibe-coding-platform-base44-launches-own-model-as-ai-startups-seek-defensibility/
- https://thenewstack.io/base44-base-one-model/
- https://www.appstuck.com/blog/base44-stuck-thinking-fix-2026
- https://www.banani.co/blog/base44-pricing-and-credits
- https://www.base44devs.com/blog/base44-credit-system-explained
- https://www.base44guide.io/articles/can-you-export-data-from-base44
- https://www.certifiedcode.us/resources/article/what-ai-model-does-base44-use
- https://www.jetadmin.io/blog/base44-pricing-2026-guide-to-plans-credits-and-real-total-cost/
- https://www.morphllm.com/base44-review
- https://www.nocode.mba/articles/base44-pricing
- https://www.nocode.mba/articles/base44-review
- https://www.npmjs.com/package/@base44/functions-compiler
- https://www.npmjs.com/package/@base44/sdk
- https://www.npmjs.com/package/@base44/superagent-native
- https://www.npmjs.com/package/@base44/vite-plugin
- https://www.npmjs.com/package/base44
- https://www.npmjs.com/package/base44-revenuecat
- https://www.reddit.com/r/Base44/comments/1lron1x/migrating_away_from_base44/
- https://www.reddit.com/r/Base44/comments/1luld15/does_base44_actually_work/
- https://www.reddit.com/r/Base44/comments/1m2fsgp/deployment_of_app_built_with_base44_to_apple_and/
- https://www.reddit.com/r/Base44/comments/1md2jmc/subject_urgent_unacceptable_delay_and_credit/
- https://www.reddit.com/r/Base44/comments/1mib0xz/base44_review/
- https://www.reddit.com/r/Base44/comments/1mkf0fu/base44_to_real_saas_app/
- https://www.reddit.com/r/Base44/comments/1mmnx7t/will_i_need_to_pay_base44_indefinitely/
- https://www.reddit.com/r/Base44/comments/1mnvjfu/imho_ive_not_had_a_positive_experience_with_this/
- https://www.reddit.com/r/Base44/comments/1mto3qs/base44_customer_service_suck/
- https://www.reddit.com/r/Base44/comments/1muwpmo/according_to_the_base44_discord_there_is_a_backup/
- https://www.reddit.com/r/Base44/comments/1mvb7sc/base44_critical_outage/
- https://www.reddit.com/r/Base44/comments/1mvetcz/base44_agent_is_here/
- https://www.reddit.com/r/Base44/comments/1mxo0bj/has_base44_become_more_broken_over_time/
- https://www.reddit.com/r/Base44/comments/1mzmyza/base44_founder_update_growth_milestone_new/
- https://www.reddit.com/r/Base44/comments/1n48ujr/escaping_base44_my_little_adventure/
- https://www.reddit.com/r/Base44/comments/1n4esrs/base44_says_you_own_your_apps_but_do_you_really/
- https://www.reddit.com/r/Base44/comments/1n5eduf/how_long_did_domain_transfer_take_from_godaddy/
- https://www.reddit.com/r/Base44/comments/1n5ee3e/how_to_topup_credits/
- https://www.reddit.com/r/Base44/comments/1n5mwbm/credits_use/
- https://www.reddit.com/r/Base44/comments/1n5pus3/how_to_export_code_from_base44_for_all_the_newbies/
- https://www.reddit.com/r/Base44/comments/1q5plx3/base44_is_breaking_apps_in_production_existing/
- https://www.reddit.com/r/Base44/comments/1s72dx7/ios_mobile_app/
- https://www.reddit.com/r/Base44/comments/1sui0wp/google_oauth_redirect_going_to_appbase44com/
- https://www.reddit.com/r/Base44/comments/1t4mv21/great_potential_but_erasing_user_data_and_60/
- https://www.reddit.com/r/Base44/comments/1tnip39/base44_deployment_stuck_on_old_bundle_github/
- https://www.reddit.com/r/Base44/comments/1ua8ah3/app_store/
- https://www.reddit.com/r/SaaS/comments/1lvch1j/base44_subreddit_reviews_seem_to_be_fake/
- https://www.reddit.com/r/cybersecurity/comments/1mcdd7d/critical_flaw_in_base44_that_gave_full_access/
- https://www.reddit.com/r/nocode/comments/1mtc3zw/best_tool_for_designers_that_want_to_build_an_app/
- https://www.reddit.com/r/vibecoding/comments/1n2lry8/burnt_out_on_base44_help/
- https://www.softr.io/blog/base44-pricing
- https://www.trustpilot.com/review/base44.com
- https://www.trustpilot.com/review/base44.com?page=4
- https://www.vellum.ai/blog/gpt-6-astra-benchmarks-explained
- https://www.vibecodingacademy.ai/blog/base44-vs-lovable
- https://www.websitebuilderexpert.com/vibe-coding/base44-review/
- https://x.com/Base44/status/2024520505018011874
- owner screenshot of app.base44.com (3 Oct 2026)
- owner screenshot of app.base44.com dashboard sidebar (3 Oct 2026)
