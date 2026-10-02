// The brief (`bid.site-brief/1`): what the owner told us in the "New site" form. `applyBrief` turns a theme's
// sample content into the owner's site without AI — their name, what they offer, how to reach them, their
// photos. With AI (S3) the same brief is the input of the content step; the result lands in the same shape.
import { EngineError } from '../util.mjs';
import { msg } from '../i18n.mjs';
import { STYLE_IDS, paletteIds } from './tokens.mjs';
import { LANGS } from './render.mjs';

export const BRIEF_SCHEMA = 'bid.site-brief/1';
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

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
    photos,
    style,
    palette,
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
export function applyBrief(theme, brief, images = []) {
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

  // contacts → every contact section's rows; the hero's phone CTA when there is a phone
  const rows = [];
  if (brief.contacts.email) rows.push(['mail', labels.email, brief.contacts.email, `mailto:${brief.contacts.email}`]);
  if (brief.contacts.phone) rows.push(['phone', labels.phone, brief.contacts.phone, `tel:${brief.contacts.phone.replace(/[^\d+]/g, '')}`]);
  if (brief.contacts.address) rows.push(['pin', labels.address, brief.contacts.address]);
  if (brief.contacts.instagram) rows.push(['instagram', labels.instagram, `@${brief.contacts.instagram}`, `https://instagram.com/${brief.contacts.instagram}`]);
  if (brief.contacts.website) rows.push(['globe', labels.website, brief.contacts.website.replace(/^https?:\/\//i, ''), brief.contacts.website]);
  if (rows.length) {
    for (const s of sectionsOf('contact')) s.rows = rows;
    const fixTel = (pairLike) => (Array.isArray(pairLike) && /^tel:/.test(pairLike[1]) && brief.contacts.phone ? [pairLike[0], `tel:${brief.contacts.phone.replace(/[^\d+]/g, '')}`] : pairLike);
    const fixMail = (pairLike) => (Array.isArray(pairLike) && /^mailto:/.test(pairLike[1]) && brief.contacts.email ? [pairLike[0], `mailto:${brief.contacts.email}`] : pairLike);
    c.headerCta = fixMail(fixTel(c.headerCta));
    for (const p of pages) {
      if (p.hero) {
        p.hero.cta = fixMail(fixTel(p.hero.cta));
        p.hero.cta2 = fixMail(fixTel(p.hero.cta2));
      }
      for (const s of p.sections || []) if (s.button) s.button = fixMail(fixTel(s.button));
    }
  }

  // photos → the hero (first photo) and the galleries (the rest, or all when there is no hero art)
  if (images.length) {
    const hero = c.pages.index?.hero;
    let rest = images;
    if (hero && !hero.center) {
      hero.image = { src: `/${images[0].file}`, alt: images[0].alt || brief.name };
      delete hero.card;
      rest = images.slice(1);
    } else if (hero?.avatar !== undefined) {
      hero.avatar = { src: `/${images[0].file}`, alt: images[0].alt || brief.name };
      rest = images.slice(1);
    }
    const galleries = sectionsOf('gallery');
    if (rest.length && galleries.length) galleries[0].items = rest.map((im, i) => ({ src: `/${im.file}`, alt: im.alt || `${brief.name} — ${labels.photo} ${i + 1}`, caption: im.caption }));
  }

  // the owner's own words where they gave them
  if (brief.description) c.description = brief.description;
  if (brief.offer && c.pages.index?.hero) c.pages.index.hero.lead = brief.offer.slice(0, 280);
  if (brief.audience && c.pages.index?.hero?.eyebrow) c.pages.index.hero.eyebrow = brief.audience.slice(0, 60);
  return c;
}
