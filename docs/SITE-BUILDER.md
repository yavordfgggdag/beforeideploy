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

## Tests

`node tests/run.mjs` — the `new:` tests create every theme in both languages and every style, run the
quality check, and verify escaping, links, photos, contacts and `bid.site.json`.
