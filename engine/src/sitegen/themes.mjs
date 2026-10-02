// Themes = the recipes a site starts from: engine/themes/<id>/theme.json — picker metadata, the theme's own
// tokens, and sample content in every language (the no-AI path fills it with the owner's own details).
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_DIR, readJSON, isDir } from '../util.mjs';
import { t } from '../i18n.mjs';
import { LANGS, SECTION_TYPES } from './render.mjs';

export const THEMES_DIR = () => path.join(ENGINE_DIR, 'themes');
const CATEGORY_TEXT = {
  business: 'newsite.category.business',
  food: 'newsite.category.food',
  beauty: 'newsite.category.beauty',
  commerce: 'newsite.category.commerce',
  tech: 'newsite.category.tech',
  personal: 'newsite.category.personal',
  community: 'newsite.category.community',
};
// the order of the picker: the featured dozen first, in this order, then the rest alphabetically
const ORDER = ['mentor', 'landing', 'services', 'portfolio', 'restaurant', 'course', 'salon', 'shop', 'saas', 'event', 'blog', 'comingsoon'];

const cache = new Map();

/** The theme with that id, validated, or null. */
export function loadTheme(id) {
  if (!/^[a-z0-9-]+$/.test(String(id))) return null;
  if (cache.has(id)) return cache.get(id);
  const theme = readJSON(path.join(THEMES_DIR(), String(id), 'theme.json'), null);
  const ok = theme && theme.schema === 'bid.site-theme/1' && theme.id === id && theme.lang && LANGS.every((l) => theme.lang[l]?.pages?.index);
  cache.set(id, ok ? theme : null);
  return ok ? theme : null;
}

/** Every theme the engine ships, in picker order, with localized names (the shape the app's picker decodes). */
export function listThemes() {
  const dir = THEMES_DIR();
  if (!isDir(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => loadTheme(e.name))
    .filter(Boolean)
    .map((th) => ({
      id: th.id,
      title: th.titleKey ? t(th.titleKey) : th.id,
      description: th.descriptionKey ? t(th.descriptionKey) : '',
      // the pages of the finished site: the recipe's pages, the privacy page and 404
      pages: Object.keys(th.lang.en.pages).length + 2,
      category: CATEGORY_TEXT[th.category] ? th.category : 'other',
      categoryTitle: t(CATEGORY_TEXT[th.category] || 'newsite.category.other'),
      icon: th.icon || 'doc.richtext',
      accent: th.accent || '#5b8cff',
      featured: !!th.featured,
      style: th.style || 'calm',
      questions: Array.isArray(th.questions) ? th.questions : [],
    }))
    .sort((a, b) => (ORDER.indexOf(a.id) + 1 || 999) - (ORDER.indexOf(b.id) + 1 || 999) || a.id.localeCompare(b.id));
}

/** Problems in a theme file (used by the tests and by `bid new themes --check`); [] when it is sound. */
export function validateTheme(th) {
  const errors = [];
  if (!th || th.schema !== 'bid.site-theme/1') return ['schema must be bid.site-theme/1'];
  for (const l of LANGS) {
    const c = th.lang?.[l];
    if (!c) {
      errors.push(`${l}: missing`);
      continue;
    }
    if (!c.tagline || !c.description || !Array.isArray(c.nav)) errors.push(`${l}: tagline, description and nav are required`);
    for (const [pid, p] of Object.entries(c.pages || {})) {
      if (!/^[a-z0-9-]+$/.test(pid)) errors.push(`${l}/${pid}: bad page id`);
      if (pid !== 'index' && (!p.title || !p.description)) errors.push(`${l}/${pid}: title and description are required`);
      for (const s of p.sections || []) if (!SECTION_TYPES.includes(s.type)) errors.push(`${l}/${pid}: unknown section ${s.type}`);
    }
  }
  if (JSON.stringify(Object.keys(th.lang.bg?.pages || {})) !== JSON.stringify(Object.keys(th.lang.en?.pages || {}))) errors.push('bg and en must have the same pages');
  return errors;
}
