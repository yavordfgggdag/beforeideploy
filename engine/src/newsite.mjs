// "New site" (V11.1 "Launchpad", roadmap WP19): a curated static template with everything the site quality
// check asks for already in place — SEO meta, 404, robots, sitemap, favicon, a privacy page in the site's
// language, netlify.toml and .gitignore — so a brand-new site is "ready for visitors" on its first check.
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_DIR, EngineError, sh, which, exists, isDir } from './util.mjs';
import { upsertProject } from './store.mjs';
import { repoSlug } from './fixes.mjs';
import { t, msg } from './i18n.mjs';

const TEMPLATES_DIR = () => path.join(ENGINE_DIR, 'templates');
export const LANGS = ['bg', 'en'];

/** Literal keys (the catalog check proves every text exists and is used). */
const TEMPLATE_TEXT = {
  landing: { title: 'newsite.template.landing.title', description: 'newsite.template.landing.description' },
  portfolio: { title: 'newsite.template.portfolio.title', description: 'newsite.template.portfolio.description' },
};
const SITE_TEXT = {
  bg: { description: 'newsite.defaultDescription.bg', tagline: 'newsite.tagline.bg', privacyTitle: 'newsite.privacy.title.bg', privacyText: 'newsite.privacy.text.bg', home: 'newsite.home.bg', notFoundTitle: 'newsite.notFound.title.bg', notFoundText: 'newsite.notFound.text.bg' },
  en: { description: 'newsite.defaultDescription.en', tagline: 'newsite.tagline.en', privacyTitle: 'newsite.privacy.title.en', privacyText: 'newsite.privacy.text.en', home: 'newsite.home.en', notFoundTitle: 'newsite.notFound.title.en', notFoundText: 'newsite.notFound.text.en' },
};

/** The templates the engine ships, with their localized names. */
export function listTemplates() {
  const dir = TEMPLATES_DIR();
  if (!isDir(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && exists(path.join(dir, e.name, 'index.html')))
    .map((e) => ({ id: e.name, title: TEMPLATE_TEXT[e.name] ? t(TEMPLATE_TEXT[e.name].title) : e.name, description: TEMPLATE_TEXT[e.name] ? t(TEMPLATE_TEXT[e.name].description) : '', pages: fs.readdirSync(path.join(dir, e.name)).filter((f) => f.endsWith('.html')).length }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function copyTemplate(src, dst, vars) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name);
    const to = path.join(dst, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyTemplate(from, to, vars);
    } else if (/\.(html|txt|xml|css|js|json|toml|md|svg|webmanifest)$/i.test(e.name) || e.name.startsWith('.')) {
      const text = fs.readFileSync(from, 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
      fs.writeFileSync(to, text);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

/**
 * Creates `<dir>/<slug>` from a template, initialises Git with one commit and adds the project to the library.
 * Nothing is deployed; the first check runs from the app.
 */
export function createSite({ template = 'landing', name, dir, lang = 'bg', description = '' }) {
  if (!name || name === true || !String(name).trim()) throw new EngineError(msg('newsite.missingName'), 'usage', 2);
  if (!dir || dir === true) throw new EngineError(msg('newsite.missingDir'), 'usage', 2);
  const src = path.join(TEMPLATES_DIR(), String(template));
  if (!/^[a-z0-9-]+$/.test(String(template)) || !exists(path.join(src, 'index.html'))) throw new EngineError(msg('newsite.unknownTemplate', { template }), 'usage', 2);
  const language = LANGS.includes(String(lang)) ? String(lang) : 'en';
  const parent = path.resolve(String(dir).replace(/^~(?=\/|$)/, process.env.HOME || ''));
  if (!isDir(parent)) throw new EngineError(msg('project.folderNotFound', { path: parent }), 'not_found');
  const slug = repoSlug(String(name).trim());
  const target = path.join(parent, slug);
  if (exists(target)) throw new EngineError(msg('newsite.exists', { path: target }), 'exists');
  const siteName = String(name).trim();
  const vars = {
    NAME: siteName.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]),
    SLUG: slug,
    LANG: language,
    YEAR: String(new Date().getFullYear()),
    DESCRIPTION: (description && description !== true ? String(description) : t(SITE_TEXT[language].description, { name: siteName })).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]),
    TAGLINE: t(SITE_TEXT[language].tagline),
    PRIVACY_TITLE: t(SITE_TEXT[language].privacyTitle),
    PRIVACY_TEXT: t(SITE_TEXT[language].privacyText),
    HOME: t(SITE_TEXT[language].home),
    NOTFOUND_TITLE: t(SITE_TEXT[language].notFoundTitle),
    NOTFOUND_TEXT: t(SITE_TEXT[language].notFoundText),
  };
  fs.mkdirSync(target, { recursive: true });
  copyTemplate(src, target, vars);
  // the language-specific pages: keep the one for this language, drop the other
  for (const l of LANGS) {
    const f = path.join(target, `privacy.${l}.html`);
    if (!exists(f)) continue;
    if (l === language) fs.renameSync(f, path.join(target, 'privacy.html'));
    else fs.unlinkSync(f);
  }
  let git = false;
  if (which('git')) {
    let r = sh('git', ['init', '-q', '-b', 'main'], { cwd: target });
    if (r.code !== 0) r = sh('git', ['init', '-q'], { cwd: target });
    if (r.code === 0) {
      sh('git', ['add', '-A'], { cwd: target });
      const c = sh('git', ['-c', 'user.email=beforeideploy@local', '-c', 'user.name=Before I Deploy', 'commit', '-qm', `New site: ${siteName} (${template})`], { cwd: target });
      git = c.code === 0;
    }
  }
  const project = upsertProject(target, { customName: siteName, name: siteName });
  return { project, path: target, template, lang: language, git, files: fs.readdirSync(target).filter((f) => f !== '.git').sort() };
}
