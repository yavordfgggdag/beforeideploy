// "New site" (V11.1 "Launchpad", roadmap WP19; Site Builder S1): a site generated from a theme recipe with the
// owner's details in place — SEO meta, 404, robots, sitemap, favicon, a privacy page in the site's language,
// netlify.toml and .gitignore — so a brand-new site is "ready for visitors" on its first check.
// The generator lives in ./sitegen; this module keeps the `bid new` command surface the app calls.
import { listThemes } from './sitegen/themes.mjs';
import { generateSite } from './sitegen/generate.mjs';
import { LANGS as SITE_LANGS } from './sitegen/render.mjs';

export const LANGS = SITE_LANGS;

/** The themes the engine ships, with their localized names, category and picker look. */
export function listTemplates() {
  return listThemes();
}

/**
 * Creates `<dir>/<slug>` from a theme, initialises Git with one commit and adds the project to the library.
 * Nothing is deployed; the first check runs from the app.
 */
export function createSite({ template = 'landing', name, dir, lang = 'bg', description = '' }) {
  const clean = (v) => (v === true || v === undefined || v === null ? '' : String(v));
  return generateSite({ brief: { theme: clean(template) || 'landing', name: clean(name), lang: clean(lang), description: clean(description) }, dir });
}
