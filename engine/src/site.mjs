// Site quality (V11.1 "Launchpad", roadmap WP10): is the built site ready for a client, not only does it build?
// Reads the publish output (never the network): SEO basics, placeholder content, broken internal links and
// assets, accessibility basics, asset budgets, and the files every launched site needs (404, robots, sitemap).
// Plain regular expressions over HTML — good enough for the rules below, and the engine stays dependency-free.
//
// Per project: bid.config.json → { "site": { "disable": ["seo.canonical"], "severity": { "content.lorem": "warn" },
// "budgets": { "imageKB": 800, "pageKB": 3000 } } }
import fs from 'node:fs';
import path from 'node:path';
import { exists, readJSON } from './util.mjs';
import { t } from './i18n.mjs';

/**
 * Every rule with its default severity: 'fail' = visitors would notice, blocks the release; 'warn' = a
 * recommendation that shows as a warning; 'info' = a hint (the launch files, previews) that never changes
 * the check status but still gets an issue row — and a safe fix where a file can be created.
 */
export const SITE_RULES = {
  'seo.title': 'warn',
  'seo.titleLength': 'warn',
  'seo.description': 'warn',
  'seo.lang': 'warn',
  'seo.noindex': 'fail',
  'seo.canonical': 'info',
  'seo.og': 'info',
  'seo.robots': 'info',
  'seo.sitemap': 'info',
  'seo.favicon': 'info',
  'content.lorem': 'fail',
  'content.placeholderImage': 'fail',
  'content.localhost': 'fail',
  'content.brokenLinks': 'fail',
  'content.mixedContent': 'warn',
  'content.emptyHref': 'info',
  'content.todo': 'warn',
  'a11y.imgAlt': 'warn',
  'a11y.inputLabel': 'warn',
  'a11y.buttonText': 'warn',
  'assets.imageSize': 'warn',
  'assets.pageSize': 'warn',
  'structure.notFound': 'info',
};

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);
const SKIP = new Set(['node_modules', '.git', '.netlify', '.vercel', '.cache']);
const MAX_PAGES = 300;

/** Site rules from bid.config.json, merged with the defaults. */
export function siteConfig(dir) {
  const cfg = readJSON(path.join(dir, 'bid.config.json'), null)?.site || {};
  const disable = new Set(Array.isArray(cfg.disable) ? cfg.disable : []);
  const severity = { ...SITE_RULES };
  for (const [k, v] of Object.entries(cfg.severity || {})) if (k in severity && ['fail', 'warn', 'info'].includes(v)) severity[k] = v;
  const budgets = { imageKB: 500, pageKB: 3000, ...(cfg.budgets || {}) };
  return { disable, severity, budgets, country: readJSON(path.join(dir, 'bid.config.json'), null)?.country || null };
}

function listHtml(root) {
  const out = [];
  const walk = (rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_PAGES) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(r);
      } else if (/\.html?$/i.test(e.name)) out.push(r);
    }
  };
  walk('');
  return out.sort();
}

function lineOf(html, index) {
  return html.slice(0, index).split('\n').length;
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}

const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));

/** Where a relative or root-relative URL points on disk, or null for external / special URLs. */
function resolveLocal(root, page, url) {
  const u = url.trim().split('#')[0].split('?')[0];
  if (!u || /^(https?:|mailto:|tel:|data:|javascript:|\/\/|sms:|blob:)/i.test(u)) return null;
  const decoded = decodeURIComponent(u);
  const abs = decoded.startsWith('/') ? path.join(root, decoded) : path.join(root, path.dirname(page), decoded);
  return abs;
}

function localExists(abs) {
  if (exists(abs)) {
    try {
      if (fs.statSync(abs).isDirectory()) return exists(path.join(abs, 'index.html'));
    } catch {}
    return true;
  }
  // pretty URLs: /about → about.html or about/index.html
  return exists(`${abs}.html`) || exists(path.join(abs, 'index.html'));
}

/**
 * Scans the publish folder. Returns `{ status, summary, details, findings, pages, fixes }`; every finding is
 * `{ rule, severity, file?, line?, detail, count? }` with the severity already adjusted by the project config.
 */
export function scanSite(dir, d, { liveUrl = null } = {}) {
  const root = path.resolve(dir, d.publishDir || '.');
  const cfg = siteConfig(dir);
  const pages = listHtml(root);
  const findings = [];
  const add = (rule, over) => {
    if (cfg.disable.has(rule)) return;
    findings.push({ rule, severity: cfg.severity[rule], ...over });
  };

  // ---- site-level files
  if (!pages.some((p) => /^404(\.html|\/index\.html)$/.test(p))) add('structure.notFound', { detail: t('site.detail.notFound'), fixId: 'site.404' });
  if (!exists(path.join(root, 'robots.txt'))) add('seo.robots', { detail: t('site.detail.robots'), fixId: 'site.robots' });
  else if (/^\s*disallow:\s*\/\s*$/im.test(fs.readFileSync(path.join(root, 'robots.txt'), 'utf8'))) add('seo.noindex', { file: 'robots.txt', detail: t('site.detail.robotsDisallowAll') });
  if (!exists(path.join(root, 'sitemap.xml')) && !exists(path.join(root, 'sitemap-index.xml'))) add('seo.sitemap', { detail: t('site.detail.sitemap'), fixId: 'site.sitemap' });

  // ---- per page
  const labelled = new Set();
  let brokenTotal = 0;
  let altMissingTotal = 0;
  const seenTitles = new Map();
  for (const page of pages) {
    const abs = path.join(root, page);
    let html;
    try {
      html = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const size = Buffer.byteLength(html);
    if (size > cfg.budgets.pageKB * 1024) add('assets.pageSize', { file: page, detail: t('site.detail.pageSize', { kb: Math.round(size / 1024), budget: cfg.budgets.pageKB }) });
    const body = stripComments(html);
    const isIndex = /^index\.html$/.test(page);
    // an error page is meant to be short and hidden from search engines
    const isErrorPage = /^(404|500)(\.html|\/index\.html)$/.test(page);

    // SEO
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
    if (!title) add('seo.title', { file: page, detail: t('site.detail.noTitle') });
    else if (!isErrorPage) {
      const text = title[1].replace(/\s+/g, ' ').trim();
      if (text.length < 10 || text.length > 70) add('seo.titleLength', { file: page, line: lineOf(body, title.index), detail: t('site.detail.titleLength', { length: text.length, title: text.slice(0, 60) }) });
      const prev = seenTitles.get(text.toLowerCase());
      if (prev && prev !== page) add('seo.titleLength', { file: page, detail: t('site.detail.duplicateTitle', { other: prev }) });
      seenTitles.set(text.toLowerCase(), page);
    }
    if (!isErrorPage && !/<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["'][^"']{5,}/i.test(body) && !/<meta[^>]+content\s*=\s*["'][^"']{5,}["'][^>]*name\s*=\s*["']description["']/i.test(body)) add('seo.description', { file: page, detail: t('site.detail.noDescription') });
    const htmlTag = /<html\b[^>]*>/i.exec(body);
    if (htmlTag && attr(htmlTag[0], 'lang') === null) add('seo.lang', { file: page, line: lineOf(body, htmlTag.index), detail: t('site.detail.noLang') });
    if (!isErrorPage && /<meta[^>]+name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*noindex/i.test(body)) add('seo.noindex', { file: page, detail: t('site.detail.noindex') });
    if (isIndex) {
      if (!/<link[^>]+rel\s*=\s*["']canonical["']/i.test(body)) add('seo.canonical', { file: page, detail: t('site.detail.noCanonical') });
      if (!/<meta[^>]+property\s*=\s*["']og:title["']/i.test(body) || !/<meta[^>]+property\s*=\s*["']og:image["']/i.test(body)) add('seo.og', { file: page, detail: t('site.detail.noOg') });
      if (!/<link[^>]+rel\s*=\s*["'][^"']*\bicon\b[^"']*["']/i.test(body) && !exists(path.join(root, 'favicon.ico')) && !exists(path.join(root, 'favicon.svg'))) add('seo.favicon', { file: page, detail: t('site.detail.noFavicon') });
    }

    // content
    const lorem = /lorem ipsum|dolor sit amet/i.exec(body);
    if (lorem) add('content.lorem', { file: page, line: lineOf(body, lorem.index), detail: t('site.detail.lorem') });
    const todo = /\b(TODO|FIXME|XXX)\b/.exec(html);
    if (todo) add('content.todo', { file: page, line: lineOf(html, todo.index), detail: t('site.detail.todo', { word: todo[1] }) });

    // links and resources
    const tagRe = /<(a|img|script|link|source|video|audio|iframe|button|input)\b[^>]*>/gi;
    let m;
    const broken = [];
    let altMissing = 0;
    while ((m = tagRe.exec(body))) {
      const tag = m[0];
      const kind = m[1].toLowerCase();
      const line = lineOf(body, m.index);
      const url = kind === 'a' || kind === 'link' ? attr(tag, 'href') : attr(tag, 'src');
      if (url !== null) {
        if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(url)) add('content.localhost', { file: page, line, detail: url });
        if (kind !== 'a' && /^http:\/\//i.test(url)) add('content.mixedContent', { file: page, line, detail: url });
        if (kind === 'img' && /placeholder\.com|placehold\.(it|co)|via\.placeholder|picsum\.photos|dummyimage\.com|placekitten/i.test(url)) add('content.placeholderImage', { file: page, line, detail: url });
        if (kind === 'a' && url.trim() === '#') add('content.emptyHref', { file: page, line, detail: t('site.detail.emptyHref') });
        if (kind === 'link' && !/stylesheet|icon|manifest|preload|prefetch|modulepreload/i.test(attr(tag, 'rel') || '')) {
          // canonical / alternate / dns-prefetch links point elsewhere on purpose
        } else {
          const abs = resolveLocal(root, page, url);
          if (abs && !localExists(abs)) broken.push({ line, url });
        }
      }
      if (kind === 'img' && attr(tag, 'alt') === null) altMissing++;
      if (kind === 'input') {
        const type = (attr(tag, 'type') || 'text').toLowerCase();
        const id = attr(tag, 'id');
        if (!['hidden', 'submit', 'button', 'reset', 'image'].includes(type) && attr(tag, 'aria-label') === null && attr(tag, 'aria-labelledby') === null && !(id && new RegExp(`<label[^>]+for\\s*=\\s*["']${id}["']`, 'i').test(body)) && !/<label[^>]*>[^<]*$/i.test(body.slice(Math.max(0, m.index - 200), m.index))) {
          add('a11y.inputLabel', { file: page, line, detail: t('site.detail.inputLabel', { name: attr(tag, 'name') || id || type }) });
        }
      }
      if (kind === 'button' && attr(tag, 'aria-label') === null) {
        const close = body.indexOf('</button>', m.index);
        const inner = close > -1 ? body.slice(m.index + tag.length, close) : '';
        if (!inner.replace(/<[^>]+>/g, '').trim() && !/aria-label|title=/i.test(inner)) add('a11y.buttonText', { file: page, line, detail: t('site.detail.buttonText') });
      }
    }
    for (const b of broken.slice(0, 10)) add('content.brokenLinks', { file: page, line: b.line, detail: b.url });
    brokenTotal += broken.length;
    if (altMissing) add('a11y.imgAlt', { file: page, count: altMissing, detail: t('site.detail.imgAlt', { count: altMissing }) });
    altMissingTotal += altMissing;
    if (!labelled.size && page) labelled.add(page);
  }

  // ---- asset budgets
  const walkAssets = (rel, depth) => {
    if (depth > 6) return;
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walkAssets(r, depth + 1);
      } else if (IMAGE_EXT.has(path.extname(e.name).toLowerCase())) {
        const kb = Math.round(fs.statSync(path.join(root, r)).size / 1024);
        if (kb > cfg.budgets.imageKB) add('assets.imageSize', { file: r, detail: t('site.detail.imageSize', { kb, budget: cfg.budgets.imageKB }) });
      }
    }
  };
  walkAssets('', 0);

  const fails = findings.filter((f) => f.severity === 'fail').length;
  const warns = findings.filter((f) => f.severity === 'warn').length;
  const hints = findings.filter((f) => f.severity === 'info').length;
  const status = pages.length === 0 ? 'info' : fails ? 'fail' : warns ? 'warn' : 'pass';
  const summary =
    pages.length === 0
      ? t('site.summary.noPages')
      : status === 'pass'
        ? hints
          ? t('site.summary.readyHints', { pages: pages.length, hints })
          : t('site.summary.ready', { pages: pages.length })
        : t('site.summary.problems', { pages: pages.length, fails, warns });
  const details = findings.slice(0, 40).map((f) => `${f.severity.toUpperCase()} ${f.rule}${f.file ? ` · ${f.file}${f.line ? `:${f.line}` : ''}` : ''} — ${f.detail}`);
  const fixes = [...new Set(findings.map((f) => f.fixId).filter(Boolean))];
  return { status, summary, details, findings, pages: pages.length, brokenLinks: brokenTotal, imagesWithoutAlt: altMissingTotal, fixes, liveUrl };
}

// ---------------------------------------------------------------- fixes: the files every launched site needs

/** Where new site files go so the build ships them: the publish folder for static sites, `public/` (or `static/`) otherwise. */
export function siteFilesDir(dir, d) {
  if (!d.hasPackageJson || d.publishDir === '.') return dir;
  for (const cand of ['public', 'static']) if (exists(path.join(dir, cand))) return path.join(dir, cand);
  return path.join(dir, 'public');
}

export function robotsText(liveUrl) {
  const base = liveUrl ? String(liveUrl).replace(/\/$/, '') : null;
  return `User-agent: *\nAllow: /\n${base ? `\nSitemap: ${base}/sitemap.xml\n` : ''}`;
}

export function sitemapText(dir, d, liveUrl) {
  const root = path.resolve(dir, d.publishDir || '.');
  const base = liveUrl ? String(liveUrl).replace(/\/$/, '') : '';
  const pages = listHtml(root).filter((p) => !/^404(\.html|\/index\.html)$/.test(p) && !/(^|\/)(privacy|terms|impressum)\.html$/.test(p) || /^index\.html$/.test(p));
  const urls = pages.map((p) => {
    const rel = p.replace(/index\.html$/, '').replace(/\.html$/, '');
    return `  <url><loc>${base}/${rel}</loc></url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function notFoundHtml(lang, siteName) {
  const bg = String(lang || '').toLowerCase().startsWith('bg');
  const title = bg ? 'Страницата не е намерена' : 'Page not found';
  const text = bg ? 'Адресът не съществува или е преместен.' : 'This address does not exist or has moved.';
  const home = bg ? 'Към началото' : 'Back to the home page';
  return `<!doctype html>
<html lang="${bg ? 'bg' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>404 · ${title}${siteName ? ` · ${siteName}` : ''}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f19;color:#e6e9f2}main{text-align:center;padding:2rem}h1{font-size:4rem;margin:0}a{color:#7cc4ff}</style>
</head>
<body><main><h1>404</h1><p>${title}. ${text}</p><p><a href="/">${home}</a></p></main></body>
</html>
`;
}
