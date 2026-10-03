#!/usr/bin/env node
// Theme checker (S7): everything a new or changed Site Builder theme must satisfy, in one command.
//
//   node scripts/theme-check.mjs <id> [<id> …]     the named themes
//   node scripts/theme-check.mjs --all               every theme in engine/themes
//   --strict                                         also forbids sample reviews and stats (required for NEW themes)
//
// Checks: the file (schema, picker fields, keywords, hints, titles in both catalogs), the look (WCAG AA for the
// theme's palette, its dark twin and its pinned dark look), the words (links resolve, icons exist, no invented
// numbers or claims, no clichés, right language, same pages in bg and en), and the result (the theme rendered in
// both languages with the engine's quality scanner). Exit code 1 when any theme has an error; warnings are advice.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BID_LANG = 'en';
process.env.BID_NO_KEYCHAIN = '1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENGINE = path.join(ROOT, 'engine', 'src');
const THEMES = path.join(ROOT, 'engine', 'themes');
const { validateTheme } = await import(`${ENGINE}/sitegen/themes.mjs`);
const { applyBrief, normalizeBrief } = await import(`${ENGINE}/sitegen/brief.mjs`);
const { renderSite, SECTION_TYPES, structuredData } = await import(`${ENGINE}/sitegen/render.mjs`);
const { ICONS } = await import(`${ENGINE}/sitegen/icons.mjs`);
const { MOTIFS } = await import(`${ENGINE}/sitegen/art.mjs`);
const { STYLE_IDS, resolveTokens, darkOf, auditTokens, FONTS } = await import(`${ENGINE}/sitegen/tokens.mjs`);
const { scanSite } = await import(`${ENGINE}/site.mjs`);
const { SITE_TEXT } = await import(`${ENGINE}/sitegen/generate.mjs`);
const { t } = await import(`${ENGINE}/i18n.mjs`);

const CATEGORIES = ['business', 'food', 'beauty', 'commerce', 'tech', 'personal', 'community'];
const QUESTIONS = ['services', 'contacts', 'photos', 'offer', 'audience'];
const catalogs = { en: JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', 'i18n', 'en.json'), 'utf8')), bg: JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', 'i18n', 'bg.json'), 'utf8')) };
const ALL = process.argv.includes('--all');
const STRICT = process.argv.includes('--strict');
const ids = ALL ? fs.readdirSync(THEMES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!ids.length) { console.error('usage: node scripts/theme-check.mjs <id…> | --all [--strict]'); process.exit(2); }

const AI = await import(`${ENGINE}/sitegen/ai.mjs`);
let failed = 0;
for (const id of ids) {
  const dir = path.join(THEMES, id);
  const errors = [];
  const warns = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warns.push(m);
  let th;
  let tx;
  try { th = JSON.parse(fs.readFileSync(path.join(dir, 'theme.json'), 'utf8')); } catch (e) { console.log(`✗ ${id}: theme.json — ${e.message}`); failed++; continue; }
  tx = { en: { title: catalogs.en[`newsite.template.${id}.title`], description: catalogs.en[`newsite.template.${id}.description`] }, bg: { title: catalogs.bg[`newsite.template.${id}.title`], description: catalogs.bg[`newsite.template.${id}.description`] } };

  // ---------------------------------------------------------------- identity and picker metadata
  if (th.id !== id) err(`id "${th.id}" must equal the folder name "${id}"`);
  if (!CATEGORIES.includes(th.category)) err(`category must be one of ${CATEGORIES.join(', ')}`);
  if (!th.icon || typeof th.icon !== 'string') err('icon (an SF Symbol name for the Mac picker) is required');
  if (!/^#[0-9a-f]{6}$/i.test(th.accent || '')) err('accent must be #rrggbb');
  if (th.accent !== th.tokens?.accent) (STRICT ? err : warn)('accent should equal tokens.accent');
  if (!ICONS[th.mark]) err(`mark "${th.mark}" is not an engine icon`);
  if (!MOTIFS.includes(th.art)) err(`art must be one of ${MOTIFS.join(', ')}`);
  if (!/^[A-Za-z]{3,40}$/.test(th.schemaOrg || '')) err('schemaOrg must be a schema.org type name');
  if (!STYLE_IDS.includes(th.style)) err(`style must be one of ${STYLE_IDS.join(', ')}`);
  if (th.titleKey !== `newsite.template.${id}.title` || th.descriptionKey !== `newsite.template.${id}.description`) err('titleKey/descriptionKey must be newsite.template.<id>.title/.description');
  for (const q of th.questions || []) if (!QUESTIONS.includes(q)) err(`unknown question ${q}`);
  if (!Array.isArray(th.questions) || !th.questions.length) err('questions must list what to ask (services, contacts, photos)');
  for (const l of ['en', 'bg']) {
    const k = th.keywords?.[l] || [];
    if (k.length < 6) err(`keywords.${l}: at least 6`);
    if (new Set(k.map((x) => x.toLowerCase())).size !== k.length) err(`keywords.${l}: duplicates`);
    if (l === 'bg' && k.some((w) => !/[а-яА-Я]/.test(w))) err('keywords.bg: Bulgarian words in Cyrillic');
    if (l === 'en' && k.some((w) => /[а-яА-Я]/.test(w))) err('keywords.en: English words');
  }
  for (const l of ['en', 'bg']) {
    const x = tx[l] || {};
    if (!x.title || x.title.length > 28) err(`i18n.${l}.title is required, at most 28 characters`);
    if (!x.description || x.description.length < 40 || x.description.length > 170) err(`i18n.${l}.description is required, 40–170 characters`);
  }
  if (tx.bg?.title && !/[а-яА-Я]/.test(tx.bg.title)) err('i18n.bg.title must be Bulgarian');
  if (tx.en?.title && /[а-яА-Я]/.test(tx.en.title)) err('i18n.en.title must be English');
  for (const e of validateTheme(th)) err(e);
  for (const l of ['en', 'bg']) for (const r of th.hints?.[l]?.services || []) { if (l === 'bg' && /[a-z]{4,}/i.test(r[0])) warn('hints.bg service in Latin letters: ' + r[0]); }

  // ---------------------------------------------------------------- tokens
  const tk = th.tokens || {};
  for (const k of ['bg', 'bg2', 'surface', 'text', 'muted', 'line', 'accent', 'accent2']) if (!tk[k]) err(`tokens.${k} missing`);
  for (const k of ['font', 'head']) if (tk[k] !== undefined && !FONTS[tk[k]]) err(`tokens.${k} must be one of ${Object.keys(FONTS).join(', ')}`);
  try {
    const light = resolveTokens(tk, {});
    for (const [what, tok] of [['auto/own', light], ['dark', resolveTokens(tk, { scheme: 'dark' })], ['twin', light.dark ? light : darkOf(light)]]) {
      const bad = auditTokens(tok);
      if (bad.length) err(`contrast (${what}): ${bad.join('; ')}`);
    }
  } catch (e) { err(`tokens: ${e.message}`); }

  // ---------------------------------------------------------------- content, per language
  const WORDS = { en: /[a-z]{3,}/i, bg: /[а-я]{3,}/i };
  const INVENTED = /\b(19|20)\d{2}\b|\b\d+\s*\+|\b\d{2,}\s*(years|clients|customers|projects|students|members|reviews|awards|%)|\b(award|certified|licensed|guarantee|24\/7|free|no\.?\s?1|best in|leading)\b|\b(години опит|клиенти|награда|сертифициран|лицензиран|гаранция|безплатн|№\s?1|най-добр|водещ)/i;
  const TEXT_KEYS = ['title', 'description', 'tagline', 'lead', 'eyebrow', 'intro', 'h', 'p', 'name', 'label', 'note', 'text'];
  const strings = (o, out = [], p = '') => {
    if (typeof o === 'string') out.push([p, o]);
    else if (Array.isArray(o)) o.forEach((v, i) => strings(v, out, `${p}[${i}]`));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) strings(v, out, p ? `${p}.${k}` : k);
    return out;
  };
  const html = {};
  for (const l of ['en', 'bg']) {
    const c = th.lang?.[l];
    if (!c) continue;
    const pages = Object.entries(c.pages || {});
    const ids = new Set(pages.flatMap(([, p]) => (p.sections || []).map((s) => s.id).filter(Boolean)));
    const pageIds = new Set(pages.map(([pid]) => pid));
    const check = (h, where) => {
      if (typeof h !== 'string' || !h) return;
      if (/^(mailto:|tel:|https?:)/.test(h)) return;
      const m = /^\/(?:([a-z0-9-]+)\.html)?(?:#([a-z0-9-]+))?$/.exec(h);
      if (!m) { err(`${l}: ${where}: bad link ${h}`); return; }
      if (m[1] && m[1] !== 'privacy' && !pageIds.has(m[1])) err(`${l}: ${where}: link to missing page ${h}`);
      if (m[2] && !m[1] && !ids.has(m[2])) (STRICT ? err : warn)(`${l}: ${where}: link to missing section #${m[2]} (dropped when the site is generated)`);
    };
    for (const [label, h] of c.nav || []) { check(h, `nav "${label}"`); if ((c.nav || []).length > 5) warn(`${l}: nav has more than 5 items`); }
    if (c.headerCta) check(c.headerCta[1], 'headerCta');
    for (const [pid, p] of pages) {
      if (p.hero) { check(p.hero.cta?.[1], `${pid} hero.cta`); check(p.hero.cta2?.[1], `${pid} hero.cta2`); }
      for (const [i, s] of (p.sections || []).entries()) {
        if (s.button && s.type !== 'form' && Array.isArray(s.button)) check(s.button[1], `${pid}[${i}] button`); // a form's button is a label
        for (const pl of s.items || []) if (pl && pl.cta) check(pl.cta[1], `${pid}[${i}] plan cta`);
        for (const it of s.items || []) if (Array.isArray(it) && ['cards', 'trust', 'audience'].includes(s.type) && !ICONS[it[0]]) err(`${l}: ${pid}[${i}] ${s.type}: unknown icon "${it[0]}"`);
        if (s.type === 'quotes') (STRICT ? err : warn)(`${l}: ${pid}[${i}]: no "quotes" sections — a template must not invent reviews`);
        if (s.type === 'stats') (STRICT ? err : warn)(`${l}: ${pid}[${i}]: no "stats" sections — a template must not invent numbers`);
        if (s.type === 'posts' || s.type === 'timeline') warn(`${l}: ${pid}[${i}]: ${s.type} usually needs invented dates/names`);
        if (s.type === 'contact') for (const r of s.rows || []) if (!ICONS[r[0]]) err(`${l}: contact row icon "${r[0]}"`);
      }
    }
    if (!pages.find(([pid]) => pid === 'index')?.[1]?.sections?.some((s) => s.type === 'contact')) (STRICT ? err : warn)(`${l}: the home page needs a contact section (id "contact")`);
    // text hygiene
    for (const [p, s] of strings(c)) {
      if (/^\//.test(s) || ICONS[s] || /\.(type|id|formName|icon|eyebrowIcon|src|alt|field|fields\[\d+\]\.id)$/.test(p) || /^(nav|headerCta)\[\d+\]\[1\]$/.test(p) || /(cta|cta2|button)\[1\]$/.test(p) || /\.rows\[\d+\]\[(0|3)\]$/.test(p) || /\.items\[\d+\]\[0\]$/.test(p) && ICONS[s]) continue;
      if (/lorem|ipsum|TODO|TBD|\bxxx\b/i.test(s)) err(`${l}: placeholder text at ${p}`);
      if (/<[a-z/][^>]*>/i.test(s)) err(`${l}: HTML in ${p}`);
      if (/(^|\.\.\.|…)\s*$/.test(s) && /[,;:]$/.test(s)) warn(`${l}: ends with punctuation at ${p}`);
      if (l === 'bg' && /[a-z]{4,}/i.test(s.replace(/https?:\S+|mailto:\S+|tel:\S+|\S+@\S+|\{\{NAME\}\}|Instagram|Facebook|Google|WhatsApp|Wi-?Fi|SPA|WC|Pilates|Booking|TripAdvisor|QR|PDF|SEO|ISO|LED|USB|BIO|DJ/g, ''))) warn(`${l}: Latin letters at ${p}: "${s.slice(0, 50)}"`);
      if (l === 'en' && /[а-я]{2,}/i.test(s)) err(`${l}: Cyrillic at ${p}`);
      if (/[“”„"]{1}[^"“”„]*$/.test('') ) { /* noop */ }
      if (INVENTED.test(s) && !/\.(rows|hours)/.test(p) && !/pricing|menu|prices/.test(p)) warn(`${l}: possible invented fact at ${p}: "${s.slice(0, 70)}"`);
      if (/^[a-zа-я]/.test(s) && /\.(title|h|name)$/.test(p) === false && /(title|lead|intro|p)$/.test(p) && false) warn('capitalisation');
    }
    const ct = [...strings(c)].filter(([p]) => /\.(title|h|tagline)$/.test(p) || /^tagline$/.test(p));
    for (const [p, s] of ct) if (s.length > 80) warn(`${l}: long heading at ${p} (${s.length})`);
    const lead = c.pages.index?.hero?.lead || '';
    if (lead.length < 50 || lead.length > 260) warn(`${l}: hero lead length ${lead.length} (aim 80–220)`);
    if (!c.pages.index?.hero?.title) err(`${l}: hero title missing`);
    const secs = (c.pages.index?.sections || []).length;
    if (secs < 4) (STRICT ? err : warn)(`${l}: the home page needs at least 4 sections (has ${secs})`);
    const types = new Set((c.pages.index?.sections || []).map((s) => s.type));
    if (!types.has('faq') && !types.has('steps')) warn(`${l}: home has neither steps nor faq`);
    html[l] = c;
  }
  // the engine's own text audit (the one the AI's output faces): no invented numbers/claims, wrong language, placeholders
  for (const l of ['en', 'bg']) {
    if (!th.lang?.[l]) continue;
    try {
      const brief = normalizeBrief({ name: th.sample?.name || 'Sample', lang: l, theme: id });
      const c = applyBrief(th, brief, [], { keepSamples: true });
      for (const issue of AI.auditContent(brief, c)) {
        const sec = issue.path[2] === 'sections' ? c.pages[issue.path[1]].sections[issue.path[3]] : null;
        if (sec && (sec.type === 'quotes' || sec.type === 'stats') && !STRICT) continue; // dropped at generation
        const hard = issue.kinds.filter((k) => ['number', 'claim', 'language', 'placeholder'].includes(k));
        const soft = issue.kinds.filter((k) => !hard.includes(k));
        if (hard.length) err(`${l}: audit ${hard.join('+')} at ${issue.path.join('.')}: "${issue.text.slice(0, 80)}" — ${issue.detail[0]}`);
        else if (soft.length) warn(`${l}: audit ${soft.join('+')} at ${issue.path.join('.')}: "${issue.text.slice(0, 60)}" — ${issue.detail[0]}`);
      }
    } catch (e) { err(`${l}: audit failed — ${e.message}`); }
  }
  // bg and en have the same shape
  const shape = (c) => JSON.stringify(Object.fromEntries(Object.entries(c.pages || {}).map(([pid, p]) => [pid, (p.sections || []).map((s) => [s.type, s.id || '', (s.items || s.groups || []).length])])));
  if (html.en && html.bg && shape(html.en) !== shape(html.bg)) err('bg and en must have the same pages, sections (type, id) and item counts');

  // ---------------------------------------------------------------- render both languages with the sample name and scan the output
  for (const l of ['en', 'bg']) {
    if (!th.lang?.[l] || errors.some((e) => /^theme|schema must/.test(e))) continue;
    try {
      const brief = normalizeBrief({ name: th.sample?.name || 'Sample', lang: l, theme: id });
      const c = applyBrief(th, brief, []);
      const text = SITE_TEXT[l];
      const site = { name: brief.name, lang: l, mark: th.mark, art: th.art, schema: th.schemaOrg, tokens: resolveTokens(th.tokens, {}), description: t(text.description, { name: brief.name }), privacyTitle: t(text.privacyTitle), privacyText: t(text.privacyText), home: t(text.home), notFoundTitle: t(text.notFoundTitle), notFoundText: t(text.notFoundText) };
      const files = renderSite(site, c);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'themechk-'));
      for (const [name, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(tmp, name)), { recursive: true }); fs.writeFileSync(path.join(tmp, name), body); }
      const r = scanSite(tmp, { publishDir: '.' });
      for (const f of r.findings) {
        if (f.severity === 'fail') err(`${l}: site check ${f.rule} ${f.file || ''} ${f.detail || ''}`);
        else if (f.severity === 'warn') warn(`${l}: site check ${f.rule} ${f.file || ''} ${f.detail || ''}`);
      }
      fs.rmSync(tmp, { recursive: true, force: true });
      JSON.parse(structuredData(site, c));
    } catch (e) { err(`${l}: render failed — ${e.stack?.split('\n').slice(0, 3).join(' | ')}`); }
  }

  const ok = errors.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${id}${warns.length ? `  (${warns.length} warnings)` : ''}`);
  for (const e of errors) console.log(`    ERROR ${e}`);
  for (const w of warns.slice(0, 12)) console.log(`    warn  ${w}`);
  if (warns.length > 12) console.log(`    … ${warns.length - 12} more warnings`);
}
process.exit(failed ? 1 : 0);
