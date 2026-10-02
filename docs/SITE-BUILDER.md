# Site Builder — how sites are made (S1: the generator)

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
| review | Haiku 4.5 | brief + content → the same content with invented facts removed and lengths cut |

The model writes words only. `mergeContent()` puts them into the recipe: hrefs, icons, section ids, form fields,
contact rows and photos never come from the model, and a `keep: false` section is dropped unless it is the
contact / CTA / form. The system prompt forbids invented reviews, numbers, names and prices.

Two hosts run the same code: `bid new content` on the owner's Anthropic key (steps run in the engine,
`engine/src/sitegen/aicontent.mjs`), or the metered `site-gen` Edge Function (steps run there; one hold for the
worst case of all three steps, one settlement with the real tokens under `ai.site.create`, which the starter
bonus covers). The result is a content file (`bid.site-content/1`) in the cache; `bid new preview --content` and
`bid new generate --content` take it, so the AI runs once per site.

The wizard: the "Write the texts with AI" toggle on step 2 (on when the account can use the built-in AI), the
three steps as a progress strip on step 3, the charge after; an AI failure keeps the sample texts and says why.

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

## Tests

`node tests/run.mjs` — the `new:` tests create every theme in both languages and every style, run the
quality check, and verify escaping, links, photos, contacts and `bid.site.json`; `new content:` runs the AI
pipeline against the fake model (own key and cloud) and checks that links and contacts never come from it.
`deno test supabase/functions` — `site-gen` with a fake model: steps, models per plan, merging, billing,
duplicates, failures, edit mode. `site edit:` in the engine suite covers the local words, the model path,
the hand-edit guard, history and undo.
