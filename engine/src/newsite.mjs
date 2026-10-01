// "New site" (V11.1 "Launchpad", roadmap WP19): a curated static template with everything the site quality
// check asks for already in place — SEO meta, 404, robots, sitemap, favicon, a privacy page in the site's
// language, netlify.toml and .gitignore — so a brand-new site is "ready for visitors" on its first check.
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_DIR, EngineError, sh, which, exists, isDir } from './util.mjs';
import { upsertProject } from './store.mjs';
import { repoSlug } from './fixes.mjs';
import { t, msg } from './i18n.mjs';
import { gitBin, gitSh } from './gitbin.mjs';

const TEMPLATES_DIR = () => path.join(ENGINE_DIR, 'templates');
export const LANGS = ['bg', 'en'];

/**
 * Every template: category, SF Symbol and accent for the app's picker, and literal text keys (the catalog
 * check proves every text exists and is used). The order here is the order in the picker.
 */
const TEMPLATES = {
  landing: { category: 'business', icon: 'sparkles.rectangle.stack', accent: '#5b8cff', title: 'newsite.template.landing.title', description: 'newsite.template.landing.description' },
  services: { category: 'business', icon: 'wrench.and.screwdriver', accent: '#ea580c', title: 'newsite.template.services.title', description: 'newsite.template.services.description' },
  comingsoon: { category: 'business', icon: 'hourglass', accent: '#a855f7', title: 'newsite.template.comingsoon.title', description: 'newsite.template.comingsoon.description' },
  restaurant: { category: 'food', icon: 'fork.knife', accent: '#b4532a', title: 'newsite.template.restaurant.title', description: 'newsite.template.restaurant.description' },
  hotel: { category: 'food', icon: 'bed.double', accent: '#0f766e', title: 'newsite.template.hotel.title', description: 'newsite.template.hotel.description' },
  salon: { category: 'beauty', icon: 'scissors', accent: '#c0265e', title: 'newsite.template.salon.title', description: 'newsite.template.salon.description' },
  clinic: { category: 'beauty', icon: 'cross.case', accent: '#0284c7', title: 'newsite.template.clinic.title', description: 'newsite.template.clinic.description' },
  fitness: { category: 'beauty', icon: 'figure.run', accent: '#65a30d', title: 'newsite.template.fitness.title', description: 'newsite.template.fitness.description' },
  shop: { category: 'commerce', icon: 'bag', accent: '#7c3aed', title: 'newsite.template.shop.title', description: 'newsite.template.shop.description' },
  realestate: { category: 'commerce', icon: 'building.2', accent: '#1e40af', title: 'newsite.template.realestate.title', description: 'newsite.template.realestate.description' },
  saas: { category: 'tech', icon: 'cloud', accent: '#6366f1', title: 'newsite.template.saas.title', description: 'newsite.template.saas.description' },
  app: { category: 'tech', icon: 'iphone', accent: '#2563eb', title: 'newsite.template.app.title', description: 'newsite.template.app.description' },
  portfolio: { category: 'personal', icon: 'rectangle.3.group', accent: '#ff5a36', title: 'newsite.template.portfolio.title', description: 'newsite.template.portfolio.description' },
  resume: { category: 'personal', icon: 'person.text.rectangle', accent: '#0f766e', title: 'newsite.template.resume.title', description: 'newsite.template.resume.description' },
  blog: { category: 'personal', icon: 'text.book.closed', accent: '#c2410c', title: 'newsite.template.blog.title', description: 'newsite.template.blog.description' },
  linkinbio: { category: 'personal', icon: 'link', accent: '#f43f5e', title: 'newsite.template.linkinbio.title', description: 'newsite.template.linkinbio.description' },
  event: { category: 'community', icon: 'ticket', accent: '#f43f5e', title: 'newsite.template.event.title', description: 'newsite.template.event.description' },
  wedding: { category: 'community', icon: 'heart', accent: '#a47148', title: 'newsite.template.wedding.title', description: 'newsite.template.wedding.description' },
  course: { category: 'community', icon: 'graduationcap', accent: '#16a34a', title: 'newsite.template.course.title', description: 'newsite.template.course.description' },
  nonprofit: { category: 'community', icon: 'hands.sparkles', accent: '#15803d', title: 'newsite.template.nonprofit.title', description: 'newsite.template.nonprofit.description' },
};
const CATEGORY_TEXT = {
  business: 'newsite.category.business',
  food: 'newsite.category.food',
  beauty: 'newsite.category.beauty',
  commerce: 'newsite.category.commerce',
  tech: 'newsite.category.tech',
  personal: 'newsite.category.personal',
  community: 'newsite.category.community',
};
const SITE_TEXT = {
  bg: { description: 'newsite.defaultDescription.bg', tagline: 'newsite.tagline.bg', privacyTitle: 'newsite.privacy.title.bg', privacyText: 'newsite.privacy.text.bg', home: 'newsite.home.bg', notFoundTitle: 'newsite.notFound.title.bg', notFoundText: 'newsite.notFound.text.bg' },
  en: { description: 'newsite.defaultDescription.en', tagline: 'newsite.tagline.en', privacyTitle: 'newsite.privacy.title.en', privacyText: 'newsite.privacy.text.en', home: 'newsite.home.en', notFoundTitle: 'newsite.notFound.title.en', notFoundText: 'newsite.notFound.text.en' },
};

const hasIndex = (dir) => exists(path.join(dir, 'index.html')) || LANGS.some((l) => exists(path.join(dir, `index.${l}.html`)));
const LANG_FILE = new RegExp(`^(.+)\\.(${LANGS.join('|')})\\.([a-z0-9]+)$`, 'i');

/** The templates the engine ships, with their localized names, category and picker look. */
export function listTemplates() {
  const dir = TEMPLATES_DIR();
  if (!isDir(dir)) return [];
  const order = Object.keys(TEMPLATES);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && hasIndex(path.join(dir, e.name)))
    .map((e) => {
      const meta = TEMPLATES[e.name];
      // a page in two languages (index.bg.html + index.en.html) is one page of the finished site
      const pages = new Set(fs.readdirSync(path.join(dir, e.name)).filter((f) => f.endsWith('.html')).map((f) => f.replace(LANG_FILE, '$1.$3')));
      return {
        id: e.name,
        title: meta ? t(meta.title) : e.name,
        description: meta ? t(meta.description) : '',
        pages: pages.size,
        category: meta?.category || 'other',
        categoryTitle: meta ? t(CATEGORY_TEXT[meta.category]) : t('newsite.category.other'),
        icon: meta?.icon || 'doc.richtext',
        accent: meta?.accent || '#5b8cff',
      };
    })
    .sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999) || a.id.localeCompare(b.id));
}

// {{KEY}} is replaced by the value; {{KEY:fallback}} uses the template's own text when the key is in `useFallback`
// (a site-specific default description reads better than the generic one).
function substitute(text, vars, useFallback) {
  return text.replace(/\{\{([A-Z_]+)(?::([^{}]*))?\}\}/g, (m, k, fallback) => (fallback !== undefined && useFallback.has(k) ? fallback : k in vars ? vars[k] : m));
}

function copyTemplate(src, dst, vars, useFallback) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name);
    const to = path.join(dst, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyTemplate(from, to, vars, useFallback);
    } else if (/\.(html|txt|xml|css|js|json|toml|md|svg|webmanifest)$/i.test(e.name) || e.name.startsWith('.')) {
      fs.writeFileSync(to, substitute(fs.readFileSync(from, 'utf8'), vars, useFallback));
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

/** name.<lang>.ext → name.ext for the site's language; the other languages' copies are removed. */
function keepLanguage(dir, language) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '.git') keepLanguage(p, language);
      continue;
    }
    const m = LANG_FILE.exec(e.name);
    if (!m) continue;
    if (m[2].toLowerCase() === language) fs.renameSync(p, path.join(dir, `${m[1]}.${m[3]}`));
    else fs.unlinkSync(p);
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
  if (!/^[a-z0-9-]+$/.test(String(template)) || !hasIndex(src)) throw new EngineError(msg('newsite.unknownTemplate', { template }), 'usage', 2);
  const language = LANGS.includes(String(lang)) ? String(lang) : 'en';
  const parent = path.resolve(String(dir).replace(/^~(?=\/|$)/, process.env.HOME || ''));
  if (!isDir(parent)) throw new EngineError(msg('project.folderNotFound', { path: parent }), 'not_found');
  const slug = repoSlug(String(name).trim());
  const target = path.join(parent, slug);
  if (exists(target)) throw new EngineError(msg('newsite.exists', { path: target }), 'exists');
  const siteName = String(name).trim();
  const userDescription = !!(description && description !== true && String(description).trim());
  const vars = {
    NAME: siteName.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]),
    SLUG: slug,
    LANG: language,
    YEAR: String(new Date().getFullYear()),
    DESCRIPTION: (userDescription ? String(description) : t(SITE_TEXT[language].description, { name: siteName })).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]),
    TAGLINE: t(SITE_TEXT[language].tagline),
    PRIVACY_TITLE: t(SITE_TEXT[language].privacyTitle),
    PRIVACY_TEXT: t(SITE_TEXT[language].privacyText),
    HOME: t(SITE_TEXT[language].home),
    NOTFOUND_TITLE: t(SITE_TEXT[language].notFoundTitle),
    NOTFOUND_TEXT: t(SITE_TEXT[language].notFoundText),
  };
  fs.mkdirSync(target, { recursive: true });
  copyTemplate(src, target, vars, new Set(userDescription ? [] : ['DESCRIPTION']));
  // the language-specific files: keep the one for this language, drop the others
  keepLanguage(target, language);
  let git = false;
  if (gitBin()) {
    let r = gitSh(['init', '-q', '-b', 'main'], { cwd: target });
    if (r.code !== 0) r = gitSh(['init', '-q'], { cwd: target });
    if (r.code === 0) {
      gitSh(['add', '-A'], { cwd: target });
      const c = gitSh(['-c', 'user.email=beforeideploy@local', '-c', 'user.name=Before I Deploy', 'commit', '-qm', `New site: ${siteName} (${template})`], { cwd: target });
      git = c.code === 0;
    }
  }
  const project = upsertProject(target, { customName: siteName, name: siteName });
  return { project, path: target, template, lang: language, git, files: fs.readdirSync(target).filter((f) => f !== '.git').sort() };
}
