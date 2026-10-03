// Themes = the recipes a site starts from: engine/themes/<id>/theme.json — picker metadata, the theme's own
// tokens, and sample content in every language (the no-AI path fills it with the owner's own details).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ENGINE_DIR, readJSON, isDir, exists } from '../util.mjs';
import { t, loadCatalog } from '../i18n.mjs';
import { LANGS, SECTION_TYPES } from './render.mjs';
import { MOTIFS } from './art.mjs';

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
      // S5: the picture in the picker (made by scripts/theme-shots.mjs), the motif of its illustrations, the words
      // "something else" matches against, and the name the preview was rendered with
      preview: previewPath(th.id),
      art: MOTIFS.includes(th.art) ? th.art : 'blobs',
      keywords: keywordsOf(th),
      sample: th.sample?.name || '',
      // S7: what to write in each box of the form, for this kind of site, in each language (placeholders, never saved)
      hints: hintsOf(th),
    }))
    .sort((a, b) => (ORDER.indexOf(a.id) + 1 || 999) - (ORDER.indexOf(b.id) + 1 || 999) || a.id.localeCompare(b.id));
}

/** The wizard's example texts per language; only well-formed ones. */
function hintsOf(th) {
  const out = {};
  for (const l of LANGS) {
    const h = th.hints?.[l];
    if (!h || typeof h !== 'object') continue;
    const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const services = (Array.isArray(h.services) ? h.services : []).filter(Array.isArray).slice(0, 4).map((r) => [str(r[0], 60), str(r[1], 30), str(r[2], 120)]).filter((r) => r[0]);
    out[l] = { offer: str(h.offer, 300), audience: str(h.audience, 100), services };
  }
  return out;
}

const previewPath = (id) => {
  const p = path.join(THEMES_DIR(), id, 'preview.jpg');
  return exists(p) ? p : null;
};
const keywordsOf = (th) => [...new Set(LANGS.flatMap((l) => (Array.isArray(th.keywords?.[l]) ? th.keywords[l] : [])).map((k) => String(k).toLowerCase().trim()).filter(Boolean))];

/** What the model is told about the theme: the kind of site in English and the category that picks its writing guide. */
export function aiTheme(theme) {
  const en = loadCatalog('en') || {};
  return { kind: [en[theme.titleKey], en[theme.descriptionKey]].filter(Boolean).join(' — ').slice(0, 160) || theme.id, category: CATEGORY_TEXT[theme.category] ? theme.category : 'business' };
}

/** The theme.json fingerprint a preview was made from: `bid new check` says when the picture is stale. */
export const themeHash = (id) => {
  const p = path.join(THEMES_DIR(), id, 'theme.json');
  return exists(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16) : null;
};
export const PREVIEWS_FILE = () => path.join(THEMES_DIR(), 'previews.json');

/** `present` / `stale` (theme.json changed since the picture) / `missing` for one theme's preview. */
export function previewStatus(id) {
  if (!previewPath(id)) return 'missing';
  const made = readJSON(PREVIEWS_FILE(), {})?.themes?.[id];
  return made && made.hash === themeHash(id) ? 'present' : 'stale';
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ');

/**
 * "Something else": the themes closest to the owner's words, best first — keywords, title and description in both
 * languages. `[]` when nothing matches at all (the app then starts from `landing`).
 */
export function suggestThemes(say, { limit = 3 } = {}) {
  const text = ` ${norm(say).replace(/\s+/g, ' ').trim()} `;
  if (text.trim().length < 2) return [];
  const words = text.trim().split(' ').filter((w) => w.length > 2);
  const scored = [];
  for (const th of listThemes()) {
    let score = 0;
    for (const k of th.keywords) {
      if (text.includes(` ${k} `)) score += k.includes(' ') ? 6 : 4; // a whole keyword
      else if (words.some((w) => (w.length > 3 && k.startsWith(w.slice(0, Math.max(4, w.length - 2)))) || (k.length > 3 && w.startsWith(k.slice(0, Math.max(4, k.length - 2)))))) score += 2; // a stem
    }
    const title = norm(th.title);
    const desc = norm(th.description);
    for (const w of words) {
      if (` ${title} `.includes(` ${w} `)) score += 3;
      else if (desc.includes(w)) score += 1;
    }
    if (th.id === say) score += 10;
    if (score > 0) scored.push({ id: th.id, score, title: th.title, description: th.description, preview: th.preview });
  }
  return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
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
  // S5: what the gallery and "something else" need from a theme
  if (th.art !== undefined && !MOTIFS.includes(th.art)) errors.push(`art must be one of ${MOTIFS.join(', ')}`);
  for (const l of LANGS) if (!Array.isArray(th.keywords?.[l]) || th.keywords[l].filter((k) => typeof k === 'string' && k.trim()).length < 3) errors.push(`keywords.${l}: at least three words for "something else"`);
  if (!th.sample?.name || typeof th.sample.name !== 'string') errors.push('sample.name: the name the preview picture is rendered with');
  // S7: examples for the form, so a first-time owner knows what to write in each box
  for (const l of LANGS) {
    const h = th.hints?.[l];
    if (!h || typeof h.offer !== 'string' || !h.offer.trim() || typeof h.audience !== 'string' || !h.audience.trim() || !Array.isArray(h.services) || h.services.length < 2 || !h.services.every((r) => Array.isArray(r) && typeof r[0] === 'string' && r[0].trim())) errors.push(`hints.${l}: offer, audience and at least two example services [name, price, line]`);
  }
  return errors;
}
