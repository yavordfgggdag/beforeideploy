# Site Builder — how sites are made

The plan: https://claude.ai/code/artifact/1d0f168b-e02f-46da-a8d1-a1926fac17a1 (packages S1–S6). This file is the
developer side of S1: where the code is, how a theme is written, how to add a section, how to test.

## Pipeline

```
brief (bid.site-brief/1)  ──▶  theme recipe (theme.json)  ──▶  content (one language)  ──▶  files on disk
   the owner's answers          pages, sections, sample text     applyBrief() or the AI (S3)   renderSite()
```

- `engine/src/sitegen/brief.mjs` — `normalizeBrief()` cleans the form (name, description, offer, audience,
  services with prices, contacts, photos, style, palette); `applyBrief()` writes those into the theme's sample
  content without AI: services → the first cards section (+ pricing/menu when prices exist), contacts → every
  contact section and every `tel:`/`mailto:` button, photos → the hero and the first gallery.
- `engine/src/sitegen/tokens.mjs` — three styles (`calm`, `bold`, `elegant`) × four palettes each. A theme
  ships its own tokens; a brief may override style and palette. Nothing else reaches the CSS.
- `engine/src/sitegen/render.mjs` — pure: content → `{ 'index.html': …, 'styles.css': …, … }`. Every string
  is escaped (`esc`), `*words*` in headings become `<em>`, links keep only `/`, `#`, `mailto:`, `tel:`,
  `http(s):` (`href`), icons are names from `icons.mjs`, section ids and form names are validated.
- `engine/src/sitegen/generate.mjs` — writes the files, copies photos into `images/` (resized with `sips` on
  macOS when over the 500 KB budget), writes `bid.site.json`, `git init` + first commit, adds the project.
- `engine/src/newsite.mjs` — the `bid new` surface the app already calls, now a thin wrapper.

## Commands

```
bid new list                       the themes in picker order (title, description, pages, category, icon, accent, featured, style, questions)
bid new styles                     styles and their palettes
bid new check                      validates every theme.json
bid new create --template mentor --name "Ива" --dir ~/Sites [--lang bg|en] [--description D] [--style bold --palette coral]
bid new generate --brief brief.json --dir ~/Sites
bid new preview  --brief brief.json          renders in memory (no files) — for previews and tests
bid new suggest  --say "…"                   the closest themes to the owner's words (S5)
```

A brief:

```json
{
  "schema": "bid.site-brief/1",
  "theme": "mentor", "lang": "bg", "name": "Ива Петрова",
  "description": "Коучинг за хора, които сменят посоката.",
  "offer": "Помагам ви да стигнете до следващата стъпка без излишен стрес.",
  "audience": "за хора на кръстопът",
  "services": [{ "name": "Единична сесия", "price": "120 лв.", "text": "60 минути онлайн" }],
  "contacts": { "email": "iva@example.com", "phone": "+359 888 000 000", "instagram": "iva.coach", "address": "София" },
  "photos": [{ "path": "/Users/iva/Pictures/me.jpg", "alt": "Ива в офиса" }],
  "style": "calm", "palette": "sand"
}
```

## bid.site.json

Every generated site keeps `bid.site.json` next to its HTML: the brief (photo paths replaced by the copied
files), the resolved tokens and the exact content that was rendered. S4 ("change it with words") edits this
document and re-renders; the HTML is never patched by hand.

## Writing a theme

`engine/themes/<id>/theme.json`, schema `bid.site-theme/1`:

| Field | Meaning |
| --- | --- |
| `id`, `category`, `icon`, `accent` | the picker: category key (`newsite.category.*`), SF Symbol, accent colour |
| `featured` | on the first screen of the picker (12 themes); the rest sit under "More" |
| `titleKey`, `descriptionKey` | i18n keys in `engine/i18n/*.json` (`newsite.template.<id>.title/description`) |
| `mark` | the brand icon (a name from `icons.mjs`) |
| `style`, `tokens` | the look the theme was designed with (`tokens.mjs` shape); a brief may override |
| `questions` | which form fields matter for this theme (`offer`, `audience`, `services`, `photos`, `contacts`) |
| `art` | the illustration motif (S5): `blobs` `waves` `grid` `orbit` `leaves` `peaks` `rings` `confetti` |
| `sample.name` | the name the preview picture is rendered with |
| `keywords.bg`, `keywords.en` | what "something else" matches: three or more words people would type |
| `lang.bg`, `lang.en` | `tagline`, `description`, `nav`, `headerCta`, `pages` — the same page ids in both languages |

A page: `{ "title", "description", "pagehead": [h1, lead], "hero": {…}, "sections": [ … ] }` (`index` has no
title/description — they come from the site). `{{NAME}}` in any text becomes the owner's name.

Section types (`render.mjs` `SECTION_TYPES`): `cards` `stats` `menu` `pricing` `steps` `timeline` `quotes`
`gallery` `posts` `faq` `chips` `prose` `story` `cta` `contact` `form` `article`, plus the aliases a recipe may
use for readability: `audience`→cards, `programs`→pricing, `story`, `booking`→cta, `hours`→contact.

Rules a theme must follow (the tests enforce them): no lorem ipsum or placeholder images, no `TODO`, every
internal link resolves, titles 10–70 characters, one `<h1>` per page, every form field labelled — i.e. the
site passes the `site` check step on its first run in both languages and in all three styles.

Adding a section type: a renderer in `render.mjs` (escape every value), its CSS in `css.mjs`, the name in
`SECTION_TYPES`, and a test in `tests/run.mjs`.

## The Mac wizard (S2)

`App/Sources/BeforeIDeploy/Screens/SiteBuilderSheet.swift` — `SiteBuilderSheet` (sheet `.newSite`), one
`SiteBuilderDraft` object for the three steps:

1. `ThemeStep` — the featured themes, category chips, a search in the owner's words (ranks by title and
   description), "More" for the rest; the right pane renders `bid new preview` for the selected theme.
2. `DetailsStep` — the brief: name (required), what you offer, who it is for, services (name, price, one line),
   contacts, style × palette (`bid new styles`), photos (drop zone or picker, paths only), language, folder.
3. `PreviewStep` — `bid new preview` of the full brief in a `WKWebView` (stylesheet inlined, page links stay
   inside the preview), computer or phone width; "Save" runs `bid new generate` and opens the project.

Screenshots: `open "Before I Deploy.app" --args -BIDScreen newsite -BIDSiteBuilderStep theme|details|preview`
fills a demo brief (`newsite.demo.*`) so every step renders with content; the screenshots workflow takes all three.

## The AI (S3)

`engine/src/sitegen/ai.mjs` is the whole pipeline — pure ESM, no imports — and `supabase/functions/_shared/site-ai.mjs`
is its byte-identical copy (`node scripts/sitegen-sync.mjs`; a test fails when they differ). Three steps:

| Step | Model | Input → output |
| --- | --- | --- |
| plan | Haiku 4.5 (`ai.models.explain`) | brief + recipe outline → which sections stay, the tone, a style suggestion |
| content | the plan's model (`ai.models[plan]`: Sonnet 5.5 on Flash, Opus 5.5 on High/Knight) | brief + recipe → every text, in a fixed JSON schema (structured outputs) |
| review | Haiku 4.5 | the numbered texts + the checker's findings → replacement texts for only the strings that break a rule (S7) |

The model writes words only. `mergeContent()` puts them into the recipe: hrefs, icons, section ids, form fields,
contact rows and photos never come from the model, and a `keep: false` section is dropped unless it is the
contact / CTA / form. The system prompt forbids invented reviews, numbers, names and prices.

The cloud answers with the engine the owner chose — Claude (default) or Codex (`bid ai settings --json '{"cloudEngine":"codex"}'`,
the assistant settings on the Mac, Settings in the shared UI); `site-gen` maps the three steps to that engine's models per
plan (`ai.models` / `ai.modelsCodex`) and bills them the same way. Two hosts run the same code: `bid new content` on the owner's Anthropic key (steps run in the engine,
`engine/src/sitegen/aicontent.mjs`), or the metered `site-gen` Edge Function (steps run there; one hold for the
worst case of all three steps, one settlement with the real tokens under `ai.site.create`, which the starter
bonus covers). The result is a content file (`bid.site-content/1`) in the cache; `bid new preview --content` and
`bid new generate --content` take it, so the AI runs once per site.

The wizard: the "Write the texts with AI" toggle on step 2 (on when the account can use the built-in AI), the
three steps as a progress strip on step 3, the charge after; an AI failure keeps the sample texts and says why.

### Quality of the words (S7)

The model is one part; the pipeline does the rest, deterministically, in the same pure file (`ai.mjs`):

- **Guides.** The writer reads a craft guide (headline starts from the visitor's need, buttons name the action, FAQ answers
  never invent a policy), a language guide (Bulgarian: "вие", sentence case, „…“, `25 €`, no calques or officialese)
  and one for the kind of site (the theme's category: business, food, beauty, commerce, tech, personal, community).
  The brief can carry a **tone** — `friendly`, `professional`, `premium`, `playful` (Mac wizard and shared UI) — and the
  engine adds the kind of site (`aiTheme()`); none picked = the model decides.
- **The audit** (`auditContent`, no model): every prose string (`textsOf`) is checked for invented numbers (10 and over,
  percentages, `+`) and claims (award-winning, certified, guarantee, free first call, best, years of experience …) that the
  brief does not contain, clichés (`passionate`, `cutting-edge`, `индивидуален подход` …), the wrong language, texts far
  over their role's length, left-over placeholders and repeats. The brief's own numbers, years and prices pass.
- **Mechanical clean-up** (`finalizeContent`): emoji, Markdown, links and `!` out; cut at a sentence or word, never
  mid-word; sample **reviews** and **stats** the brief cannot support are dropped; links to sections that are gone are
  removed. Names and prices from the brief (or the theme's sample) are locked: the model writes the lines around them.
- **The review** gets the numbered texts and the findings and answers `{ fixes: [{ id, text }] }` — replacement texts
  only — so the writer's words stay the writer's and the cheap model cannot flatten the site. `applyFixes` applies them;
  then `neutralise` cuts a sentence with an invented number or claim out of any paragraph that has other sentences, and
  reports (`audit.left`) what it could not fix. The result carries `audit: { found, fixed, cut, left }`.
- **Honest drafts without AI.** `applyBrief` shows only what the owner gave: the contact rows, **opening hours**
  (`hours`, one line each: "Mon–Fri 9:00–18:00"), phone and mail links, the hero card (their services and prices — or the
  illustration instead of an invented card) — the theme's example email, phone, address and hours never reach a real site.
  A menu or price list the owner never gave stays as the theme's example and is recorded in `bid.site.json`
  (`samples`); `bid check` warns `content.sample` until the section is changed, and fails `content.exampleContact` for
  `hello@example.com` / `+359 888 000 000` left in a link.
- **Measuring it.** `ANTHROPIC_API_KEY=… node scripts/site-ai-eval.mjs` writes ten sample briefs
  (`tests/site-evals/briefs.json`, Bulgarian and English, from thin to full) through the real pipeline with the owner's own
  key and prints, per brief, what the checker found, what the review fixed and what is left; exit 1 when an invented
  number, claim or placeholder survives. `--offline` runs the same harness against a stand-in writer that over-reaches
  (used by the engine tests); `--model` picks the writing model.

## Editing with words (S4)

`bid site edit --project P --say "…"` changes `bid.site.json` and re-renders; HTML is never patched by hand.

- **Without a model** (`localEdit`, bg + en): a colour word → the palette of the current style (`зелено` → forest,
  `корал` → coral …), a style word (`спокоен`, `bold`, `елегантен`), `по-тъмно` / `lighter` → the dark or light palette
  of the style (or the nearest style that has one), `махни отзивите` / `remove the stats` → `drop_section`, a new
  title in quotes → the hero title. A request the words recognise but that changes nothing ends as `nothing`.
- **With a model** (own key: the fast model; cloud: `site-gen` mode `edit`, action `ai.site.edit`): the owner's
  words + the current content → a short list of ops in `EDIT_SCHEMA` (`set_text`, `set_items`, `drop_section`,
  `add_section`, `style`, `none`). `applyEdits()` applies them: only words change; links, icons, ids, forms and
  the contact section stay; an added section is built here from the type and the rows.
- **Hand edits are safe**: `bid.site.json` keeps a hash per rendered file; a change that would overwrite a file
  the owner edited by hand is refused (`site_modified`, the files named) unless `--force`.
- **Every edit is one commit** (`Site: <the words>`); `bid site history` lists them, `bid site undo` reverts the
  last with a new commit; `bid site info` tells the app whether a project is a generated site.
- The app: "Edit the site…" on the project screen (generated sites only) → the site from its folder, the field,
  example chips, the applied / refused summary, the charge, the history with Undo.

## Beauty and themes (S5)

- **Pictures in the picker.** `engine/themes/<id>/preview.jpg` is the first screen of a sample site (the theme's
  `sample.name`, English, its own look) at 1280×800. `node scripts/theme-shots.mjs [id|--all|--check]` renders them
  with Chromium through Playwright (`playwright-core`, dev tooling only — the engine stays dependency-free) and
  records the theme.json fingerprint in `engine/themes/previews.json`; `bid new check` reports `present`,
  `stale` or `missing`, and the engine tests fail on anything but `present`. The **theme-previews** workflow
  runs on every push that touches a theme, the renderer or the script (and by hand): it renders all of them on
  macOS — the fonts the Mac app's users see — and commits the pictures to the branch, so after a theme change a
  `git pull` brings the pictures; no tool chain is needed on any machine.
- **"Something else".** The last card of the picker: the owner describes the site in their words; the themes are
  ranked by `keywords.bg` / `keywords.en`, title and description (`bid new suggest --say "…"`, no model; the app
  ranks the same way offline). Nothing close → start from the business landing, every text changes later.
- **Light and dark.** `scheme` in the brief: `auto` (default — the palette by day, its dark twin at night via
  `prefers-color-scheme`), `light`, `dark`. `tokens.mjs` `darkOf()` makes the twin: a near-black tinted with the
  accent, lifted surfaces, light text, accents raised until they read. Text on the accent is computed from its
  luminance (`onAccentFor`), so a lemon or cyan button gets dark text. With words: "switch on dark mode", "light
  mode", "follow the system" change the scheme; "darker" still picks a dark palette as in S4.
- **Illustrations.** `art.mjs` draws SVG in the site's colours from a seed (the site's name): eight motifs
  (`blobs waves grid orbit leaves peaks rings confetti`), one per theme (`art` in theme.json). They go where a photo
  would: the hero panel when the theme has no card (`art/hero.svg`), a band under a centred hero (`art/band.svg`),
  the story picture (`art/story.svg`) and the gallery tiles (`art/tile-1…6.svg`). Files of the site, so the owner
  can replace them; a photo from the brief still wins. The Mac preview inlines them as data URLs.

### Design and honesty (S7)

- **WCAG 2.2 AA everywhere.** `tokens.mjs` derives, once, the accessible colours the stylesheet uses for text and
  buttons (`accentText`, `accent2Text`, `accentSolid`, `accent2Solid`, `onAccent`); `auditTokens()` lists failing pairings
  and the tests prove all 12 palettes, their dark twins and every theme pass. Picture captions are pills, readable on any photo.
- **A phone menu without script** (a `<details>`), **search-engine data** (`schema.org` JSON-LD from what the site shows,
  `schemaOrg` per theme; Open Graph and Twitter cards; the address opens the map), and two new section types:
  `trust` (a strip of short promises, rows `[icon, text]`) and `split` (feature rows with an illustration, rows
  `[heading, text, bullet…]`).
- **45 themes** — every kind of small business: the original 21 plus law, accounting, agency, building, car repair,
  cleaning, transport, vet, florist, bakery, bar, farm, yoga, barber, spa, tattoo, music, podcast, photographer, interior,
  school, kids, dance and travel. New themes use `trust`, `split`, `steps`, `faq`, never reviews or stats.
- **Hints.** `hints` in theme.json (`en`/`bg`: an example `offer`, `audience` and three `[name, price, line]` services for
  that trade) become the placeholders of the wizard (Mac and shared UI), so a first-time owner sees what to write.

### Adding a theme (the partner's checklist)

1. `engine/themes/<id>/theme.json` — copy the closest theme; keep `schema`, set `id`, `category`, `icon`, `accent`,
   `mark`, `art`, `schemaOrg`, `sample.name`, `keywords.bg/en` (six or more words people would type), `style`,
   `tokens`, `questions`, `hints.bg/en`, and the recipe in `lang.bg` and `lang.en` with the same pages, sections and item counts.
   Write only what a template can honestly say: **no invented numbers, years, awards, "free", guarantees, named people,
   reviews or stats**; concrete words of the trade; natural Bulgarian (the checker flags Latin letters and the list of empty phrases).
2. `engine/i18n/bg.json` and `en.json` — `newsite.template.<id>.title` and `.description`.
3. `node scripts/theme-check.mjs <id> --strict` must print ✓ with no errors (file, AA contrast in light, dark and the
   dark twin, links, icons, the text audit, both languages rendered and scanned). `--all` checks every theme.
   `bid new check` must list no errors; `node tests/run.mjs` creates it in both languages and all styles.
4. Push — the **theme-previews** workflow renders the picture on macOS and commits it; `git pull` to get it (or
   `node scripts/theme-shots.mjs <id>` locally with Chrome installed). Without it the card shows the accent
   gradient and the engine tests fail.

## The shared UI and the desktop shell (S6)

The same three steps, on the same engine commands, in `web/src/screens/CreateSite.tsx` — the UI the Tauri apps
(macOS, Windows, Linux) and later the web app share:

- `web/src/lib/engine.ts` is the bridge: inside the desktop shell `window.__TAURI__` (`withGlobalTauri`) runs
  `engine_run` (`bid <args>`, NDJSON events as `engine://event`, the final result as the call's value), reads a
  theme's picture through `theme_preview` (validated id, data URL), and opens the OS pickers for photos and the
  folder. The UI's language travels as `BID_LANG`, so the engine's messages come in the owner's language. In a
  plain browser `hasEngine()` is false and the screen says the desktop app is needed — it never pretends.
- `web/src/lib/sitebuilder.ts` is pure: the brief (`bid.site-brief/1`) as the engine reads it, the theme ranking
  for "Something else" (the same rules as the Mac app and `bid new suggest`), `inlinePreview()` (one page of a
  rendered site as a document for an `<iframe srcdoc>`: stylesheet inlined, illustrations as data URLs, internal
  links rewritten so the screen shows the page they point to), and `errorKey()` — the plain-words message for an
  engine code: out of credits, credits released later, no network, timeout, not signed in, AI unavailable, rate
  limited, cloud not deployed, folder exists, hand-edited files. Tested under `node --test`.
- The flow: theme (pictures, categories, search, "Something else") → about you (name, offer, audience, services,
  contacts, style × palette, light/dark/auto, photos, language, folder, the AI toggle with its price) → look and
  save (`new content` with its three steps when the AI is on, `new preview` in the iframe, computer/phone,
  `new generate`) → done: the folder, Git, "change it with words" (`site edit`, the examples, the applied/refused
  summary, hand-edit guard with "Replace my hand edits", history, undo).
- `desktop/src-tauri/src/lib.rs`: `site` joins the command allowlist; `engine_run` takes `lang`; `theme_preview`
  reads only `engine/themes/<id>/preview.jpg` for a validated id. `cargo test` covers the allowlist, the language
  and the picture guard against the real engine.

## Tests

`node tests/run.mjs` — the `new:` tests create every theme in both languages and every style, run the
quality check, and verify escaping, links, photos, contacts and `bid.site.json`; `new content:` runs the AI
pipeline against the fake model (own key and cloud) and checks that links and contacts never come from it.
`cd web && npm test` — the pure Site Builder helpers of the shared UI; `cd desktop/src-tauri && cargo test` — the
desktop shell against the real engine. `deno test supabase/functions` — `site-gen` with a fake model: steps,
models per plan, merging, billing, duplicates, failures, edit mode. `new S7-B:` covers the audit, the review by id, locked prices, honest drafts and the site check rules; `new S7-C:` the 45 themes (honest, with hints) and the offline AI evaluation; `aifix S7-D:` the evidence and knowledge of AI Fix. `site edit:` in the engine suite covers the local words, the model path,
the hand-edit guard, history and undo. `new S5:` covers the pictures and their freshness, suggestions in both
languages, the three schemes, the illustration files and the scheme words.
