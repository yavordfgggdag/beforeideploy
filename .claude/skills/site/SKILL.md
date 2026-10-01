---
name: site
description: Work on the Before I Deploy public website (site/) — edit pages, pricing, legal pages, preview locally and save. Use for any change to the website, landing page, pricing page, terms, privacy, checkout page, "сайта", "сайт".
---

# Website work

How the site is built today:
- Pages in `site/*.html` are **generated** by `scripts/site-build.py` (shared header, footer, pricing cards).
  Change the generator, not the HTML, or the next build overwrites the edit. `site/checkout.html`,
  `site/style.css` and images are edited directly.
- Prices come only from `supabase/functions/_shared/plans-catalog.json`. Never type a price into a page.
- Design values (colours, spacing, fonts) come from `design/tokens.json`.
- English is the main language; every text must be easy to move into a translation file later.

Steps:
1. If not on a `site/…` branch, start one (skill `start`, area `site`).
2. Make the change; run `python3 scripts/site-build.py`.
3. Preview: `python3 -m http.server -d site 8080` → http://localhost:8080 . Check desktop width and a
   390 px phone width, light and dark if the page supports it. Take screenshots when possible.
4. CI rule (`.github/workflows/site.yml`): the committed pages must equal the generator's output —
   `git diff --exit-code -- site/` after the build.
5. Save (skill `save`). Saving also happens automatically when you finish a reply.

Never: publish to production (`Publish Website.command` is the owner's), put a real Paddle token in
`checkout.html`, or add trackers/analytics before a cookie page exists.
