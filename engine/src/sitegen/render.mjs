// Renders the content of one site (one language) into its files. Pure: no disk, no network — `renderSite`
// returns `{ 'index.html': '…', … }`. Every string from the content is escaped; the only markup that
// survives is `*…*` → <em> in headings, icon *names* (icons.mjs) and links with a safe scheme.
import { ICONS, icon } from './icons.mjs';
import { stylesheet } from './css.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Escaped text with `*words*` turned into <em>words</em> — the one bit of emphasis headings may carry. */
export const rich = (s) => esc(s).replace(/\*([^*\n]{1,120})\*/g, '<em>$1</em>');
const SAFE_HREF = /^(\/[^\s]*|#[^\s]*|mailto:[^\s]+|tel:[^\s]+|https?:\/\/[^\s]+)$/i;
export const href = (h) => (typeof h === 'string' && SAFE_HREF.test(h.trim()) ? esc(h.trim()) : '#');
const ico = (name, cls) => icon(ICONS[name] ? name : 'spark', cls);
const id = (s) => (typeof s === 'string' && /^[a-z][a-z0-9-]{0,40}$/i.test(s) ? s : '');
const list = (v) => (Array.isArray(v) ? v : []);
const pair = (v) => (Array.isArray(v) ? v : [v]);

const COMMON = {
  bg: { skip: 'Към съдържанието', menu: 'Основно меню', privacy: 'Поверителност', rights: 'Всички права запазени.', send: 'Изпрати', email: 'Имейл', name: 'Име', message: 'Съобщение', formNote: 'Отговаряме до един работен ден. Данните се ползват само за отговор.', links: 'Връзки', photo: 'Снимка' },
  en: { skip: 'Skip to content', menu: 'Main menu', privacy: 'Privacy', rights: 'All rights reserved.', send: 'Send', email: 'Email', name: 'Name', message: 'Message', formNote: 'We reply within one working day. Your details are used only to answer you.', links: 'Links', photo: 'Photo' },
};
export const LANGS = Object.keys(COMMON);

const PRIVACY = {
  bg: [
    ['Какво събираме', 'Само това, което ни изпратите сами — например име, имейл и съобщение от формата за контакт. Сайтът не използва рекламни или проследяващи бисквитки.'],
    ['Защо', 'За да отговорим на запитването ви. Не продаваме и не преотстъпваме данни на трети лица за маркетинг.'],
    ['Колко дълго', 'Пазим съобщенията толкова, колкото е нужно за отговор и за законовите ни задължения, след което ги изтриваме.'],
    ['Хостинг', 'Сайтът се хоства при доставчик в ЕС/САЩ със стандартни договорни клаузи. Сървърът записва технически логове (IP адрес, време) за сигурност.'],
    ['Вашите права', 'Можете да поискате достъп, поправка или изтриване на данните си и да подадете жалба до КЗЛД. Пишете ни на адреса от страницата за контакт — отговаряме до 30 дни.'],
  ],
  en: [
    ['What we collect', 'Only what you send us yourself — for example your name, email and message from the contact form. The site uses no advertising or tracking cookies.'],
    ['Why', 'To answer your request. We never sell or share your data with third parties for marketing.'],
    ['How long', 'We keep messages as long as needed to answer and to meet legal obligations, then delete them.'],
    ['Hosting', 'The site is hosted by a provider in the EU/US under standard contractual clauses. The server keeps technical logs (IP address, time) for security.'],
    ['Your rights', 'You can ask for access, correction or deletion of your data and complain to your data protection authority. Write to the address on the contact page — we answer within 30 days.'],
  ],
};

// ---------------------------------------------------------------- page pieces

function header(site, c, pagePath) {
  const nav = list(c.nav).map(([label, h]) => `<a href="${href(h)}"${h === pagePath ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('');
  const cta = c.headerCta ? `<a class="btn" href="${href(c.headerCta[1])}">${esc(c.headerCta[0])}</a>` : '';
  return `  <a class="skip" href="#main">${site.common.skip}</a>
  <header class="top">
    <div class="wrap">
      <a class="brand" href="/"><span class="mark">${ico(site.mark)}</span>${esc(site.name)}</a>
      <nav class="nav" aria-label="${site.common.menu}">${nav}</nav>
      ${cta}
    </div>
  </header>`;
}

function footer(site, c) {
  const links = list(c.nav).map(([label, h]) => `<a href="${href(h)}">${esc(label)}</a>`).join('');
  return `  <footer class="foot">
    <div class="wrap">
      <p>© ${site.year} ${esc(site.name)} · ${site.common.rights}</p>
      <nav aria-label="${site.common.menu}">${links}<a href="/privacy.html">${site.common.privacy}</a></nav>
    </div>
  </footer>`;
}

function head(site, { title, description, index }) {
  return `<!doctype html>
<html lang="${site.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
${index ? '  <link rel="canonical" href="/">\n' : ''}  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta name="theme-color" content="${site.tokens.bg}">
  <meta property="og:title" content="${esc(index ? site.name : title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="/og.svg">
  <meta property="og:type" content="website">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
`;
}

const img = (im, extra = '') => (im && typeof im.src === 'string' ? `<img src="${href(im.src)}" alt="${esc(im.alt || '')}"${im.width ? ` width="${+im.width}"` : ''}${im.height ? ` height="${+im.height}"` : ''}${extra}>` : '');

function hero(h, site) {
  const art = h.image
    ? `<div class="hero-photo">${img(h.image)}</div>`
    : h.card
      ? `<div class="card-art" aria-hidden="true">
          <h3>${ico(h.card.icon || 'spark')}${esc(h.card.title)}</h3>
          <ul>${list(h.card.rows).map(([a, b]) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`).join('')}</ul>${h.card.note ? `\n          <p class="note">${esc(h.card.note)}</p>` : ''}
        </div>`
      : '';
  const buttons = [h.cta ? `<a class="btn" href="${href(h.cta[1])}">${esc(h.cta[0])}${ico('arrow')}</a>` : '', h.cta2 ? `<a class="btn ghost" href="${href(h.cta2[1])}">${esc(h.cta2[0])}</a>` : ''].filter(Boolean).join('\n          ');
  const avatar = h.avatar ? `<div class="avatar" aria-hidden="true">${typeof h.avatar === 'object' ? img(h.avatar) : esc(h.avatar)}</div>\n        ` : '';
  const after = h.links ? `\n        <nav class="links" aria-label="${site.common.links}">${list(h.links).map(([ic, label, h2]) => `<a href="${href(h2)}">${ico(ic)}${esc(label)}${ico('arrow', 'go')}</a>`).join('')}</nav>` : '';
  const chips = h.chips ? `\n          <div class="chips" style="margin-top:22px">${list(h.chips).map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : '';
  return `    <section class="hero${h.center ? ' center' : ''}">
      <div class="wrap">
        ${avatar}<div>
          ${h.eyebrow ? `<span class="eyebrow">${ico(h.eyebrowIcon || 'spark')}${esc(h.eyebrow)}</span>` : ''}
          <h1>${rich(h.title)}</h1>
          <p class="lead">${esc(h.lead)}</p>${buttons ? `\n          <div class="actions">\n          ${buttons}\n          </div>` : ''}${chips}
        </div>${after}
        ${art}
      </div>
    </section>`;
}

const sectionHead = (s) => (s.title ? `<div class="head"><h2>${rich(s.title)}</h2>${s.intro ? `<p>${esc(s.intro)}</p>` : ''}</div>` : '');

// aliases a theme recipe may use; they render with the section they name
const ALIAS = { audience: 'cards', programs: 'pricing', story: 'story', booking: 'cta', hours: 'contact' };

/** The section types a theme or the AI may ask for. */
export const SECTION_TYPES = ['cards', 'stats', 'menu', 'pricing', 'steps', 'timeline', 'quotes', 'gallery', 'posts', 'faq', 'chips', 'prose', 'story', 'cta', 'contact', 'form', 'article', ...Object.keys(ALIAS)];

function section(s, site) {
  const C = site.common;
  const type = ALIAS[s.type] || s.type;
  const open = `    <section class="section${s.alt ? ' alt' : ''}"${id(s.id) ? ` id="${id(s.id)}"` : ''}>
      <div class="wrap">
        ${sectionHead(s)}`;
  const close = `
      </div>
    </section>`;
  let inner = '';
  switch (type) {
    case 'cards':
      inner = `<div class="grid">${list(s.items).map(([ic, h, p]) => `
          <article class="card"><div class="badge">${ico(ic)}</div><h3>${esc(h)}</h3><p>${esc(p)}</p></article>`).join('')}
        </div>`;
      break;
    case 'stats':
      inner = `<div class="stats">${list(s.items).map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
      break;
    case 'menu':
      inner = `<div class="menu">${list(s.groups).map((g) => `
          <div>
            <h3>${esc(g.name)}</h3>${list(g.items).map(([n, d, p]) => `
            <div class="dish"><b>${esc(n)}</b><span class="price">${esc(p)}</span>${d ? `<small>${esc(d)}</small>` : ''}</div>`).join('')}
          </div>`).join('')}
        </div>`;
      break;
    case 'pricing':
      inner = `<div class="plans">${list(s.items).map((p) => `
          <article class="plan${p.featured ? ' featured' : ''}">${p.featured ? `<span class="tag">${esc(p.featured)}</span>` : ''}
            <h3>${esc(p.name)}</h3>
            <div class="amount">${esc(p.price)}${p.per ? ` <small>${esc(p.per)}</small>` : ''}</div>
            <ul>${list(p.features).map((f) => `<li>${ico('check')}<span>${esc(f)}</span></li>`).join('')}</ul>
            ${p.cta ? `<a class="btn${p.featured ? '' : ' ghost'}" href="${href(p.cta[1])}">${esc(p.cta[0])}</a>` : ''}
          </article>`).join('')}
        </div>`;
      break;
    case 'steps':
      inner = `<div class="steps">${list(s.items).map(([h, p]) => `<div class="step"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('')}</div>`;
      break;
    case 'timeline':
      inner = `<ol class="timeline">${list(s.items).map(([w, h, p]) => `
          <li><span class="when">${esc(w)}</span><h3>${esc(h)}</h3><p>${esc(p)}</p></li>`).join('')}
        </ol>`;
      break;
    case 'quotes':
      inner = `<div class="quotes">${list(s.items).map(([q, who]) => `
          <figure class="quote"><div class="stars" aria-hidden="true">${ico('star').repeat(5)}</div><blockquote>${esc(q)}</blockquote><figcaption>${esc(who)}</figcaption></figure>`).join('')}
        </div>`;
      break;
    case 'gallery':
      // an item is a caption (gradient tile) or { src, alt, caption } (a photo)
      inner = `<div class="gallery">${list(s.items).map((c) => (c && typeof c === 'object' && c.src ? `<figure class="tile">${img(c, ' loading="lazy"')}${c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : ''}</figure>` : `<div class="tile"><span>${esc(c)}</span></div>`)).join('')}</div>`;
      break;
    case 'posts':
      inner = `<div class="posts">${list(s.items).map((p) => `
          <a class="post" href="${href(p.href)}"><span class="meta"><b>${esc(p.tag)}</b><span>${esc(p.date)}</span></span><h3>${esc(p.h)}</h3><p>${esc(p.p)}</p></a>`).join('')}
        </div>`;
      break;
    case 'faq':
      inner = `<div class="faq">${list(s.items).map(([q, a]) => `
          <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
        </div>`;
      break;
    case 'chips':
      inner = `<div class="chips">${list(s.items).map((c) => `<span>${esc(c)}</span>`).join('')}</div>`;
      break;
    case 'prose':
      inner = `<div class="prose">${list(s.items).map(([h, p]) => `${h ? `<h2>${esc(h)}</h2>` : ''}<p>${esc(p)}</p>`).join('')}</div>`;
      break;
    case 'story':
      inner = `<div class="story"><div class="prose">${list(s.items).map(([h, p]) => `${h ? `<h2>${esc(h)}</h2>` : ''}<p>${esc(p)}</p>`).join('')}</div>${s.image ? `<div class="photo">${img(s.image, ' loading="lazy"')}</div>` : ''}</div>`;
      break;
    case 'cta':
      return `    <section class="section"${id(s.id) ? ` id="${id(s.id)}"` : ''}>
      <div class="wrap">
        <div class="cta"><div><h2>${rich(s.h || s.title)}</h2><p>${esc(s.p || s.intro)}</p></div>${s.button ? `<a class="btn" href="${href(s.button[1])}">${esc(s.button[0])}</a>` : ''}</div>
      </div>
    </section>`;
    case 'contact': {
      const rows = list(s.rows).map(([ic, label, value, h]) => `
            <div class="row">${ico(ic)}<div><small>${esc(label)}</small>${h ? `<a href="${href(h)}">${esc(value)}</a>` : `<span>${esc(value)}</span>`}</div></div>`).join('');
      const hours = list(s.hours).length ? `
            <div class="row">${ico('clock')}<div style="flex:1"><small>${esc(s.hoursTitle)}</small><ul class="hours">${list(s.hours).map(([d, h]) => `<li><span>${esc(d)}</span><span>${esc(h)}</span></li>`).join('')}</ul></div></div>` : '';
      const extra = list(s.fields).map((f) => {
        const fid = id(f.id) || 'extra';
        return `
            <label for="f-${fid}">${esc(f.label)}${f.options ? `<select id="f-${fid}" name="${fid}">${list(f.options).map((o) => `<option>${esc(o)}</option>`).join('')}</select>` : `<input id="f-${fid}" name="${fid}" type="${['text', 'date', 'tel', 'email', 'number'].includes(f.type) ? f.type : 'text'}">`}</label>`;
      }).join('');
      const formName = id(s.formName) || 'contact';
      inner = `<div class="contact">
          <div class="info">${rows}${hours}
          </div>
          <form class="form" name="${formName}" method="POST" data-netlify="true" netlify-honeypot="company">
            <input type="hidden" name="form-name" value="${formName}">
            <p class="hp"><label for="f-company">Company</label><input id="f-company" name="company"></p>
            <label for="f-name">${C.name}<input id="f-name" name="name" autocomplete="name" required></label>
            <label for="f-email">${C.email}<input id="f-email" name="email" type="email" autocomplete="email" required></label>${extra}
            <label for="f-message">${esc(s.messageLabel || C.message)}<textarea id="f-message" name="message"></textarea></label>
            <button class="btn" type="submit">${esc(s.send || C.send)}</button>
            <small>${C.formNote}</small>
          </form>
        </div>`;
      break;
    }
    case 'form': {
      const formName = id(s.formName) || 'signup';
      inner = `<form class="form" name="${formName}" method="POST" data-netlify="true" netlify-honeypot="company" style="max-width:560px">
          <input type="hidden" name="form-name" value="${formName}">
          <p class="hp"><label for="f-company">Company</label><input id="f-company" name="company"></p>
          <label for="f-email">${C.email}<input id="f-email" name="email" type="email" autocomplete="email" required></label>
          <button class="btn" type="submit">${esc(s.button || C.send)}</button>
          ${s.note ? `<small>${esc(s.note)}</small>` : ''}
        </form>`;
      break;
    }
    case 'article':
      return `    <article class="section">
      <div class="wrap article">
        <span class="eyebrow">${ico('book')}${esc(s.tag)}</span>
        <h1>${rich(s.h)}</h1>
        ${list(s.body).map((b) => (String(b).startsWith('## ') ? `<h2>${esc(b.slice(3))}</h2>` : String(b).startsWith('> ') ? `<blockquote>${esc(b.slice(2))}</blockquote>` : `<p>${esc(b)}</p>`)).join('\n        ')}
        <p><a class="btn ghost" href="/">${esc(s.back || C.home || '←')}</a></p>
      </div>
    </article>`;
    default:
      throw new Error(`unknown section ${s.type}`);
  }
  return open + inner + close;
}

function page(site, c, pid) {
  const p = c.pages[pid];
  const index = pid === 'index';
  const title = index ? `${site.name} — ${c.tagline}` : `${p.title} · ${site.name}`;
  const description = index ? site.description || c.description : p.description;
  const body = [];
  if (p.hero) body.push(hero(p.hero, site));
  if (p.pagehead) body.push(`    <section class="pagehead"><div class="wrap"><h1>${rich(pair(p.pagehead)[0])}</h1><p>${esc(pair(p.pagehead)[1])}</p></div></section>`);
  for (const s of list(p.sections)) body.push(section(s, site));
  return `${head(site, { title, description, index })}${header(site, c, index ? '/' : `/${pid}.html`)}
  <main id="main">
${body.join('\n')}
  </main>
${footer(site, c)}
</body>
</html>
`;
}

function privacy(site, c) {
  return `${head(site, { title: `${site.privacyTitle} · ${site.name}`, description: site.lang === 'bg' ? `Какви данни събира ${site.name} и как ги пази.` : `What data ${site.name} collects and how it is kept.`, index: false })}${header(site, c, '/privacy.html')}
  <main id="main">
    <section class="pagehead"><div class="wrap"><h1>${esc(site.privacyTitle)}</h1><p>${esc(site.privacyText)}</p></div></section>
    <section class="section"><div class="wrap prose">
${PRIVACY[site.lang].map(([h, p]) => `      <h2>${h}</h2><p>${p}</p>`).join('\n')}
      <p><a href="/">${esc(site.home)}</a></p>
    </div></section>
  </main>
${footer(site, c)}
</body>
</html>
`;
}

function notFound(site) {
  return `<!doctype html>
<html lang="${site.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>404 · ${esc(site.notFoundTitle)} · ${esc(site.name)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main id="main" class="notfound">
    <div>
      <b>404</b>
      <h1>${esc(site.notFoundTitle)}</h1>
      <p>${esc(site.notFoundText)}</p>
      <a class="btn" href="/">${esc(site.home)}</a>
    </div>
  </main>
</body>
</html>
`;
}

const favicon = (site) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${site.tokens.accent}"/><stop offset="1" stop-color="${site.tokens.accent2}"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><g transform="translate(14 14) scale(1.5)" fill="none" stroke="${site.tokens.onAccent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[site.mark] || ICONS.spark}</g></svg>
`;

const og = (site, c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${site.tokens.accent}"/><stop offset="1" stop-color="${site.tokens.accent2}"/></linearGradient><radialGradient id="r" cx="0.85" cy="0.15" r="0.7"><stop offset="0" stop-color="${site.tokens.accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${site.tokens.accent}" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="630" fill="${site.tokens.bg}"/><rect width="1200" height="630" fill="url(#r)"/><rect x="80" y="90" width="96" height="96" rx="26" fill="url(#g)"/><g transform="translate(104 114) scale(2)" fill="none" stroke="${site.tokens.onAccent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[site.mark] || ICONS.spark}</g><text x="80" y="360" font-family="system-ui,-apple-system,sans-serif" font-size="84" font-weight="800" fill="${site.tokens.text}">${esc(site.name)}</text><text x="80" y="440" font-family="system-ui,-apple-system,sans-serif" font-size="38" fill="${site.tokens.muted}">${esc(c.tagline)}</text><rect x="80" y="500" width="160" height="8" rx="4" fill="url(#g)"/></svg>
`;

const NETLIFY = `[build]
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"

[[headers]]
  for = "/*.css"
  [headers.values]
    Cache-Control = "public, max-age=3600"
`;
const GITIGNORE = `.DS_Store\n.netlify/\n.env\n.env.*\n!.env.example\n*.log\nnode_modules/\n`;

/**
 * `site` = { name, lang, mark, tokens, description?, privacyTitle, privacyText, home, notFoundTitle, notFoundText }
 * `content` = one language of a theme: { tagline, description, nav, headerCta, pages: { index: {…}, … } }
 * Returns the files of the finished site, path → text.
 */
export function renderSite(site, content) {
  const lang = LANGS.includes(site.lang) ? site.lang : 'en';
  const s = { ...site, lang, year: site.year || String(new Date().getFullYear()), common: COMMON[lang], mark: ICONS[site.mark] ? site.mark : 'spark' };
  const files = {};
  const pageIds = Object.keys(content.pages || {});
  if (!pageIds.includes('index')) throw new Error('content has no index page');
  for (const pid of pageIds) {
    if (!/^[a-z0-9-]+$/.test(pid)) throw new Error(`bad page id ${pid}`);
    files[`${pid}.html`] = page(s, content, pid);
  }
  files['privacy.html'] = privacy(s, content);
  files['404.html'] = notFound(s);
  files['styles.css'] = stylesheet(s.tokens);
  files['favicon.svg'] = favicon(s);
  files['og.svg'] = og(s, content);
  files['robots.txt'] = 'User-agent: *\nAllow: /\n\nSitemap: /sitemap.xml\n';
  files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...pageIds.map((p) => (p === 'index' ? '/' : `/${p}`)), '/privacy'].map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
  files['netlify.toml'] = NETLIFY;
  files['.gitignore'] = GITIGNORE;
  files['bid.config.json'] = '{\n  "site": { "budgets": { "imageKB": 500 } }\n}\n';
  return files;
}
