// The brief (`bid.site-brief/1`): what the owner told us in the "New site" form. `applyBrief` turns a theme's
// sample content into the owner's site without AI — their name, what they offer, how to reach them, their
// photos. With AI (S3) the same brief is the input of the content step; the result lands in the same shape.
import crypto from 'node:crypto';
import { EngineError } from '../util.mjs';
import { msg } from '../i18n.mjs';
import { STYLE_IDS, SCHEMES, paletteIds } from './tokens.mjs';
import { LANGS } from './render.mjs';
import { TONES, checkText, finalizeContent } from './ai.mjs';

export const BRIEF_SCHEMA = 'bid.site-brief/1';
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Opening hours as `[[days, time], …]` from rows or from the owner's lines ("Mon–Fri 9:00–18:00", "Sun closed").
 * Whatever does not look like days + hours is dropped; nothing is invented.
 */
export function parseHours(input) {
  const rows = [];
  const lines = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/\r?\n|;/) : [];
  for (const l of lines) {
    if (Array.isArray(l) && l.length >= 2) {
      const [d, h] = [str(l[0], 40), str(l[1], 40)];
      if (d && h) rows.push([d, h]);
      continue;
    }
    if (l && typeof l === 'object' && !Array.isArray(l) && (l.days || l.day)) {
      const [d, h] = [str(l.days || l.day, 40), str(l.time || l.hours, 40)];
      if (d && h) rows.push([d, h]);
      continue;
    }
    const m = /^\s*(.+?)\s*[:\-–—]?\s+((?:\d{1,2}(?:[:.]\d{2})?\s*(?:[–—-]|до|to)\s*\d{1,2}(?:[:.]\d{2})?|closed|затворено|почивен(?: ден)?|по уговорка|by appointment).*)$/iu.exec(typeof l === 'string' ? l : '');
    if (m && m[1].length <= 40) rows.push([m[1].replace(/[:\-–—\s]+$/, ''), m[2].trim().slice(0, 40)]);
  }
  return rows.slice(0, 8);
}

/** A clean brief from whatever came in (the app's form, a JSON file, flags). Throws on what cannot be fixed. */
export function normalizeBrief(input = {}) {
  const b = input && typeof input === 'object' ? input : {};
  const name = str(b.name, 80);
  if (!name) throw new EngineError(msg('newsite.missingName'), 'usage', 2);
  const theme = str(b.theme || b.template, 40) || 'landing';
  if (!/^[a-z0-9-]+$/.test(theme)) throw new EngineError(msg('newsite.unknownTemplate', { template: theme }), 'usage', 2);
  const lang = LANGS.includes(b.lang) ? b.lang : 'en';
  const style = STYLE_IDS.includes(b.style) ? b.style : null;
  const palette = style && paletteIds(style).includes(b.palette) ? b.palette : null;
  // S5: light by day and its dark twin at night (auto), or one look pinned
  const scheme = SCHEMES.includes(b.scheme) ? b.scheme : 'auto';
  const services = (Array.isArray(b.services) ? b.services : [])
    .map((s) => (typeof s === 'string' ? { name: s } : s && typeof s === 'object' ? s : null))
    .filter((s) => s && str(s.name, 80))
    .slice(0, 8)
    .map((s) => ({ name: str(s.name, 80), text: str(s.text || s.description, 240), price: str(s.price, 40) }));
  const c = b.contacts && typeof b.contacts === 'object' ? b.contacts : {};
  const contacts = {
    email: /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(str(c.email, 120)) ? str(c.email, 120) : '',
    phone: str(c.phone, 40).replace(/[^\d+ ()-]/g, ''),
    address: str(c.address, 160),
    instagram: str(c.instagram, 60).replace(/^@|^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[^\w.]/g, ''),
    website: /^https?:\/\/[^\s<>"']+$/i.test(str(c.website, 200)) ? str(c.website, 200) : '',
  };
  const hours = parseHours(b.hours);
  const tone = TONES.includes(b.tone) ? b.tone : null;
  const photos = (Array.isArray(b.photos) ? b.photos : [])
    .map((p) => (typeof p === 'string' ? { path: p } : p && typeof p === 'object' && typeof p.path === 'string' ? p : null))
    .filter(Boolean)
    .slice(0, 12)
    .map((p) => ({ path: p.path, alt: str(p.alt, 160), caption: str(p.caption, 80) }));
  return {
    schema: BRIEF_SCHEMA,
    theme,
    lang,
    name,
    description: str(b.description, 300),
    offer: str(b.offer || b.about, 1200),
    audience: str(b.audience, 200),
    services,
    contacts,
    hours,
    tone,
    photos,
    style,
    palette,
    scheme,
  };
}

const LABELS = {
  bg: { email: 'Имейл', phone: 'Телефон', address: 'Адрес', instagram: 'Instagram', website: 'Сайт', photo: 'Снимка' },
  en: { email: 'Email', phone: 'Phone', address: 'Address', instagram: 'Instagram', website: 'Website', photo: 'Photo' },
};

// a theme may write the owner's name into its text ("Hi, I'm {{NAME}}"); the renderer escapes the result
const clone = (o, vars) => JSON.parse(JSON.stringify(o), (k, v) => (typeof v === 'string' ? v.replace(/\{\{(NAME|YEAR)\}\}/g, (m, key) => vars[key] ?? m) : v));

/**
 * The theme's content for the brief's language with the owner's details in place. `images` maps a photo index
 * to the file it was copied to (`images/photo-1.jpg`), decided by the generator.
 */
export function applyBrief(theme, brief, images = [], opts = {}) {
  const L = LABELS[brief.lang] ? brief.lang : 'en';
  const c = clone(theme.lang[L], { NAME: brief.name, YEAR: String(new Date().getFullYear()) });
  const labels = LABELS[L];
  const pages = Object.values(c.pages);
  const sectionsOf = (type) => pages.flatMap((p) => (p.sections || []).filter((s) => s.type === type));

  // services → the first cards section (what we do) and, with prices, the first pricing section
  if (brief.services.length) {
    const cards = sectionsOf('cards')[0] || sectionsOf('audience')[0];
    if (cards) {
      const icons = (cards.items || []).map((it) => it[0]);
      cards.items = brief.services.map((s, i) => [icons[i % Math.max(1, icons.length)] || 'spark', s.name, s.text || s.price || '']);
    }
    const priced = brief.services.filter((s) => s.price);
    const pricing = sectionsOf('pricing')[0] || sectionsOf('programs')[0];
    if (pricing && priced.length) {
      const old = pricing.items || [];
      pricing.items = priced.map((s, i) => ({ ...(old[i] || old[0] || {}), featured: i === Math.min(1, priced.length - 1) && old.some((o) => o.featured) ? old.find((o) => o.featured).featured : undefined, name: s.name, price: s.price, per: undefined, features: s.text ? [s.text] : old[i]?.features || [] }));
    }
    const menu = sectionsOf('menu')[0];
    if (menu && priced.length && !pricing) menu.groups = [{ name: menu.groups?.[0]?.name || '', items: priced.map((s) => [s.name, s.text, s.price]) }];
  }

  // contacts → every contact section's rows. The theme's sample channels, hours, phone links and address never
  // stay on a real site: what the owner gave is shown, the rest is left out (the form always works).
  const rows = [];
  if (brief.contacts.email) rows.push(['mail', labels.email, brief.contacts.email, `mailto:${brief.contacts.email}`]);
  if (brief.contacts.phone) rows.push(['phone', labels.phone, brief.contacts.phone, `tel:${brief.contacts.phone.replace(/[^\d+]/g, '')}`]);
  // the address opens the map (a plain https link — nothing is embedded, so nothing tracks the visitor)
  if (brief.contacts.address) rows.push(['pin', labels.address, brief.contacts.address, `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(brief.contacts.address)}`]);
  if (brief.contacts.instagram) rows.push(['instagram', labels.instagram, `@${brief.contacts.instagram}`, `https://instagram.com/${brief.contacts.instagram}`]);
  if (brief.contacts.website) rows.push(['globe', labels.website, brief.contacts.website.replace(/^https?:\/\//i, ''), brief.contacts.website]);
  for (const s of sectionsOf('contact')) {
    s.rows = rows;
    if (brief.hours?.length) s.hours = brief.hours;
    else { delete s.hours; delete s.hoursTitle; }
  }
  const fixLink = (pair) => {
    if (!Array.isArray(pair) || typeof pair[1] !== 'string') return pair;
    if (pair[1].startsWith('tel:')) return [pair[0], brief.contacts.phone ? `tel:${brief.contacts.phone.replace(/[^\d+]/g, '')}` : '/#contact'];
    if (pair[1].startsWith('mailto:')) return [pair[0], brief.contacts.email ? `mailto:${brief.contacts.email}` : '/#contact'];
    return pair;
  };
  c.headerCta = fixLink(c.headerCta);
  if (Array.isArray(c.nav)) c.nav = c.nav.map(fixLink); // a nav item to a sample phone or email points at the contact section (or goes with it)
  for (const p of pages) {
    if (p.hero) {
      p.hero.cta = fixLink(p.hero.cta);
      p.hero.cta2 = fixLink(p.hero.cta2);
      // a link-in-bio row to a phone or email the owner did not give goes (nothing to point at)
      if (Array.isArray(p.hero.links)) p.hero.links = p.hero.links.filter((l) => !(Array.isArray(l) && typeof l[2] === 'string' && ((l[2].startsWith('tel:') && !brief.contacts.phone) || (l[2].startsWith('mailto:') && !brief.contacts.email)))).map((l) => (Array.isArray(l) && /^(tel|mailto):/.test(l[2] || '') ? [l[0], l[1], fixLink([l[1], l[2]])[1]] : l));
    }
    for (const s of p.sections || []) {
      if (s.button) s.button = fixLink(s.button);
      for (const it of Array.isArray(s.items) ? s.items : []) if (it && it.cta) it.cta = fixLink(it.cta);
    }
  }

  // the hero card shows the owner's own services and prices — or leaves (the illustration takes its place)
  const hero = c.pages.index?.hero;
  if (hero?.card) {
    if (brief.services.length) {
      hero.card.rows = brief.services.slice(0, 4).map((s) => [s.name, s.price || '']);
      delete hero.card.note;
    } else delete hero.card;
  }
  // an eyebrow that states a fact ("Open until 23:00", "Free slots") goes unless the brief says so
  if (hero?.eyebrow) {
    const k = checkText(brief, hero.eyebrow, 'eyebrow').kinds;
    if (k.includes('number') || k.includes('claim') || /\d/.test(hero.eyebrow)) { delete hero.eyebrow; delete hero.eyebrowIcon; }
  }

  applyImages(c, images, brief);

  // the owner's own words where they gave them
  if (brief.description) c.description = brief.description;
  if (brief.offer && c.pages.index?.hero) c.pages.index.hero.lead = brief.offer.slice(0, 280);
  if (brief.audience && c.pages.index?.hero) c.pages.index.hero.eyebrow = brief.audience.slice(0, 60);
  // reviews and stats the owner never gave are not shown; links to what is gone are dropped
  return finalizeContent(c, brief, { keepSamples: !!opts.keepSamples });
}

/**
 * The parts of a finished site that still show the theme's sample facts: a menu or price list when the owner gave
 * no prices. Each carries a fingerprint, so `bid site` warns until the section has been changed.
 */
export function sampleSections(content, brief) {
  const out = [];
  if ((brief.services || []).some((s) => s.price)) return out;
  for (const [pid, p] of Object.entries(content.pages || {})) {
    (p.sections || []).forEach((s, i) => {
      if (s.type === 'menu' || s.type === 'pricing' || s.type === 'programs') out.push({ page: pid, section: i, type: s.type, hash: sectionHash(s) });
    });
  }
  return out;
}

/** A short fingerprint of one section's content. */
export const sectionHash = (s) => crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex').slice(0, 12);
/** The copied photos into the content: the first in the hero (or the avatar), the rest in the first gallery. */
export function applyImages(c, images = [], brief = {}) {
  if (!images.length) return c;
  const L = LABELS[brief.lang] ? brief.lang : 'en';
  const labels = LABELS[L];
  const pages = Object.values(c.pages || {});
  const hero = c.pages?.index?.hero;
  let rest = images;
  if (hero && !hero.center) {
    hero.image = { src: `/${images[0].file}`, alt: images[0].alt || brief.name };
    delete hero.card;
    rest = images.slice(1);
  } else if (hero?.avatar !== undefined) {
    hero.avatar = { src: `/${images[0].file}`, alt: images[0].alt || brief.name };
    rest = images.slice(1);
  }
  const galleries = pages.flatMap((p) => (p.sections || []).filter((s) => s.type === 'gallery'));
  if (rest.length && galleries.length) galleries[0].items = rest.map((im, i) => ({ src: `/${im.file}`, alt: im.alt || `${brief.name} — ${labels.photo} ${i + 1}`, caption: im.caption }));
  return c;
}

