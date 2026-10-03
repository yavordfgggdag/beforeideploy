// Writes a site to disk from a theme + brief (no AI) or from ready content: files, the owner's photos (resized
// on macOS with the built-in `sips`), `bid.site.json` (the source of truth for later edits), Git, the library.
import fs from 'node:fs';
import path from 'node:path';
import { EngineError, sh, which, exists, isDir, ensureDir } from '../util.mjs';
import { upsertProject } from '../store.mjs';
import { repoSlug } from '../fixes.mjs';
import { t, msg } from '../i18n.mjs';
import { gitBin, gitSh } from '../gitbin.mjs';
import { loadTheme } from './themes.mjs';
import { normalizeBrief, applyBrief, applyImages } from './brief.mjs';
import { resolveTokens } from './tokens.mjs';
import { renderSite } from './render.mjs';
import crypto from 'node:crypto';

export const SITE_TEXT = {
  bg: { description: 'newsite.defaultDescription.bg', privacyTitle: 'newsite.privacy.title.bg', privacyText: 'newsite.privacy.text.bg', home: 'newsite.home.bg', notFoundTitle: 'newsite.notFound.title.bg', notFoundText: 'newsite.notFound.text.bg' },
  en: { description: 'newsite.defaultDescription.en', privacyTitle: 'newsite.privacy.title.en', privacyText: 'newsite.privacy.text.en', home: 'newsite.home.en', notFoundTitle: 'newsite.notFound.title.en', notFoundText: 'newsite.notFound.text.en' },
};
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const MAX_WIDTH = 1600;
const BUDGET_KB = 500;

/** Copies the brief's photos into `<target>/images/`, shrinking big ones on macOS. Returns what went where. */
function placePhotos(photos, target) {
  const out = [];
  if (!photos.length) return out;
  const dir = path.join(target, 'images');
  const sips = process.platform === 'darwin' ? which('sips') : null;
  let n = 0;
  for (const p of photos) {
    const src = path.resolve(String(p.path).replace(/^~(?=\/|$)/, process.env.HOME || ''));
    const ext = path.extname(src).toLowerCase();
    if (!IMAGE_EXT.has(ext) || !exists(src)) continue;
    fs.mkdirSync(dir, { recursive: true });
    n += 1;
    const file = `images/photo-${n}${ext === '.jpeg' ? '.jpg' : ext}`;
    const dst = path.join(target, file);
    fs.copyFileSync(src, dst);
    const kb = fs.statSync(dst).size / 1024;
    if (sips && kb > BUDGET_KB && ext !== '.gif') {
      // smaller than the site budget: resample, then a lighter JPEG quality when it is still too big
      sh(sips, ['--resampleWidth', String(MAX_WIDTH), dst], { timeout: 30000 });
      if (fs.statSync(dst).size / 1024 > BUDGET_KB && ['.jpg', '.jpeg'].includes(ext)) sh(sips, ['-s', 'formatOptions', '70', dst], { timeout: 30000 });
    }
    out.push({ file, alt: p.alt, caption: p.caption, bytes: fs.statSync(dst).size });
  }
  return out;
}

/**
 * `brief` → a finished site in `<dir>/<slug>`: `{ project, path, template, lang, git, files }` (the shape
 * `bid new create` has always returned). `content`, when given, is ready content (the AI path) in the
 * brief's language and replaces the theme sample.
 */
export function generateSite({ brief: input, dir, content = null }) {
  const brief = normalizeBrief(input);
  if (!dir || dir === true) throw new EngineError(msg('newsite.missingDir'), 'usage', 2);
  const theme = loadTheme(brief.theme);
  if (!theme) throw new EngineError(msg('newsite.unknownTemplate', { template: brief.theme }), 'usage', 2);
  const parent = path.resolve(String(dir).replace(/^~(?=\/|$)/, process.env.HOME || ''));
  if (!isDir(parent)) throw new EngineError(msg('project.folderNotFound', { path: parent }), 'not_found');
  const slug = repoSlug(brief.name);
  const target = path.join(parent, slug);
  if (exists(target)) throw new EngineError(msg('newsite.exists', { path: target }), 'exists');

  const text = SITE_TEXT[brief.lang];
  const tokens = resolveTokens(theme.tokens, { style: brief.style, palette: brief.palette, scheme: brief.scheme });
  fs.mkdirSync(target, { recursive: true });
  let files;
  try {
    const images = placePhotos(brief.photos, target);
    const pageContent = content ? applyImages(JSON.parse(JSON.stringify(content)), images, brief) : applyBrief(theme, brief, images);
    const site = {
      name: brief.name,
      lang: brief.lang,
      mark: theme.mark,
      art: theme.art, schema: theme.schemaOrg,
      tokens,
      description: brief.description || (content ? pageContent.description : '') || t(text.description, { name: brief.name }),
      privacyTitle: t(text.privacyTitle),
      privacyText: t(text.privacyText),
      home: t(text.home),
      notFoundTitle: t(text.notFoundTitle),
      notFoundText: t(text.notFoundText),
    };
    files = renderSite(site, pageContent);
    for (const [name, body] of Object.entries(files)) writeSiteFile(target, name, body);
    // the source of truth for "change it with words" (S4): brief + resolved look + the content that was rendered
    // file hashes: `bid site edit` refuses to overwrite a file the owner changed by hand (S4)
    const hashes = Object.fromEntries(Object.entries(files).map(([name, body]) => [name, crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)]));
    const record = { schema: 'bid.site/1', createdAt: new Date().toISOString(), engine: 'sitegen/1', theme: theme.id, brief: { ...brief, photos: images.map((im) => ({ file: im.file, alt: im.alt, caption: im.caption })) }, tokens, content: pageContent, files: hashes, history: [] };
    fs.writeFileSync(path.join(target, 'bid.site.json'), JSON.stringify(record, null, 2) + '\n');
  } catch (e) {
    fs.rmSync(target, { recursive: true, force: true });
    throw e;
  }
  let git = false;
  if (gitBin()) {
    let r = gitSh(['init', '-q', '-b', 'main'], { cwd: target });
    if (r.code !== 0) r = gitSh(['init', '-q'], { cwd: target });
    if (r.code === 0) {
      gitSh(['add', '-A'], { cwd: target });
      const c = gitSh(['-c', 'user.email=beforeideploy@local', '-c', 'user.name=Before I Deploy', 'commit', '-qm', `New site: ${brief.name} (${theme.id})`], { cwd: target });
      git = c.code === 0;
    }
  }
  const project = upsertProject(target, { customName: brief.name, name: brief.name });
  return { project, path: target, template: theme.id, theme: theme.id, lang: brief.lang, style: brief.style || theme.style || null, palette: brief.palette, git, files: fs.readdirSync(target).filter((f) => f !== '.git').sort() };
}

/** Writes one rendered file, creating its folder (`art/…`) when needed. */
export function writeSiteFile(dir, name, body) {
  const p = path.join(dir, name);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, body);
}

/** Renders without touching the disk — for previews and tests. */
export function previewSite(input, content = null) {
  const brief = normalizeBrief(input);
  const theme = loadTheme(brief.theme);
  if (!theme) throw new EngineError(msg('newsite.unknownTemplate', { template: brief.theme }), 'usage', 2);
  const text = SITE_TEXT[brief.lang];
  const pageContent = content || applyBrief(theme, brief, []);
  return renderSite(
    { name: brief.name, lang: brief.lang, mark: theme.mark, art: theme.art, schema: theme.schemaOrg, tokens: resolveTokens(theme.tokens, { style: brief.style, palette: brief.palette, scheme: brief.scheme }), description: brief.description || t(text.description, { name: brief.name }), privacyTitle: t(text.privacyTitle), privacyText: t(text.privacyText), home: t(text.home), notFoundTitle: t(text.notFoundTitle), notFoundText: t(text.notFoundText) },
    pageContent,
  );
}
