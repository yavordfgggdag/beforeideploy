// Generates engine/templates/<id>/ from content.mjs (`node scripts/templates/generate.mjs [id …]`): one shared design system,
// bilingual pages (name.bg.html / name.en.html — the engine keeps the one for the site's language).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from './content.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine', 'templates');

const FONTS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  rounded: 'ui-rounded, "SF Pro Rounded", -apple-system, system-ui, "Segoe UI", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

const ICONS = {
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0113 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  phone: '<path d="M6.6 3.5h3l1.5 4-2 1.3a11 11 0 006.1 6.1l1.3-2 4 1.5v3a2 2 0 01-2.1 2A16.5 16.5 0 014.6 5.6a2 2 0 012-2.1z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4 7l8 6 8-6"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.2a4.3 4.3 0 017.5 2.6C19.5 15.4 12 20 12 20z"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.8l-5.1 2.6 1-5.6-4.1-4 5.7-.8z"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/>',
  shield: '<path d="M12 3.5l7 2.8v5.2c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6.3z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/>',
  cup: '<path d="M5 8h11v5a5.5 5.5 0 01-11 0z"/><path d="M16 9.5h1.5a2.5 2.5 0 010 5H16"/><path d="M8 3.5v2M11 3.5v2"/>',
  bed: '<path d="M3.5 18.5v-11M3.5 14h17v4.5M20.5 14v-2.5a3 3 0 00-3-3h-6V14"/><circle cx="7.3" cy="11" r="1.8"/>',
  scissors: '<circle cx="6.5" cy="7" r="2.5"/><circle cx="6.5" cy="17" r="2.5"/><path d="M8.6 8.4L19 17M8.6 15.6L19 7"/>',
  tooth: '<path d="M7.5 4c-2.5 0-3.7 2.3-3.2 5 .5 2.4 1.5 3.7 1.9 6.6.3 2.4.9 4.4 2 4.4 1.6 0 1.4-5 3.8-5s2.2 5 3.8 5c1.1 0 1.7-2 2-4.4.4-2.9 1.4-4.2 1.9-6.6.5-2.7-.7-5-3.2-5-2 0-2.5 1.2-4.5 1.2S9.5 4 7.5 4z"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6.5a3 3 0 016 0V8"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V19h12V9.5"/><path d="M10 19v-5h4v5"/>',
  code: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/>',
  book: '<path d="M4.5 5.5A2 2 0 016.5 3.5H19v14H6.5a2 2 0 00-2 2z"/><path d="M4.5 19.5a2 2 0 002 2H19"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3"/>',
  ring: '<circle cx="12" cy="14.5" r="6"/><path d="M9.5 3.5h5l1.5 3-4 2.5-4-2.5z"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3.5 9h17M12 9v11"/><path d="M12 9c-1.5-3-5-4-5-1.5S12 9 12 9zm0 0c1.5-3 5-4 5-1.5S12 9 12 9z"/>',
  rocket: '<path d="M12 3c3.5 2 5 5.5 5 9.5l-2.5 3h-5L7 12.5C7 8.5 8.5 5 12 3z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M9.5 15.5L8 20l2.5-1.5M14.5 15.5L16 20l-2.5-1.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.5 14.6c2.4.2 4 1.8 4.5 4.4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.5"/>',
  tools: '<path d="M14.5 6.5a4 4 0 00-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 005.2-5.2l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
  hand: '<path d="M7 12.5V6.8a1.5 1.5 0 013 0V11V4.8a1.5 1.5 0 013 0V11V6a1.5 1.5 0 013 0v7.5c0 4-2.5 7-6.5 7-2.5 0-4-1.2-5.5-3.5L4.3 13.6a1.5 1.5 0 012.4-1.8z"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.5l5.5 3.5-5.5 3.5z"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l8.5-8.5M16 6l2.5 2.5M14 8l2 2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
};
const icon = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.spark}</svg>`;
for (const t of TEMPLATES) {
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === 'icon' && typeof v === 'string' && !ICONS[v]) throw new Error(`${t.id}: unknown icon ${v}`); walk(v); }
  };
  walk(t);
}

const esc = (s) => String(s);

function css(th) {
  const head = FONTS[th.head || th.font || 'sans'];
  const body = FONTS[th.font || 'sans'];
  return `/* ${th.name} — edit the variables below to restyle the whole site */
:root {
  --bg: ${th.bg};
  --bg-2: ${th.bg2};
  --surface: ${th.surface};
  --text: ${th.text};
  --muted: ${th.muted};
  --line: ${th.line};
  --accent: ${th.accent};
  --accent-2: ${th.accent2};
  --on-accent: ${th.onAccent || '#ffffff'};
  --radius: ${th.radius || 18}px;
  --font: ${body};
  --font-head: ${head};
  --shadow: 0 1px 2px rgba(0,0,0,.06), 0 12px 40px -12px rgba(0,0,0,${th.dark ? '.55' : '.18'});
  color-scheme: ${th.dark ? 'dark' : 'light'};
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
body { margin: 0; font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.6; font-size: 17px; -webkit-font-smoothing: antialiased; }
img, svg { max-width: 100%; }
a { color: var(--accent); text-underline-offset: 3px; }
h1, h2, h3 { font-family: var(--font-head); line-height: 1.12; letter-spacing: ${th.head === 'serif' ? '-0.01em' : '-0.025em'}; margin: 0; font-weight: ${th.head === 'serif' ? 600 : 750}; }
p { margin: 0; }
.wrap { width: min(1140px, 100% - 40px); margin-inline: auto; }
.skip { position: absolute; left: -999px; top: 8px; background: var(--accent); color: var(--on-accent); padding: 8px 14px; border-radius: 10px; z-index: 10; }
.skip:focus { left: 8px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 6px; }

/* header */
.top { position: sticky; top: 0; z-index: 5; backdrop-filter: saturate(160%) blur(14px); -webkit-backdrop-filter: saturate(160%) blur(14px); background: color-mix(in srgb, var(--bg) 78%, transparent); border-bottom: 1px solid var(--line); }
.top .wrap { display: flex; align-items: center; gap: 18px; min-height: 66px; }
.brand { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-head); font-weight: 750; font-size: 1.08rem; color: var(--text); text-decoration: none; letter-spacing: -0.01em; }
.mark { width: 28px; height: 28px; border-radius: 9px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); display: grid; place-items: center; color: var(--on-accent); }
.mark svg { width: 16px; height: 16px; }
.nav { display: flex; gap: 4px; margin-left: auto; flex-wrap: wrap; }
.nav a { color: var(--muted); text-decoration: none; font-size: .94rem; padding: 7px 12px; border-radius: 999px; }
.nav a:hover, .nav a[aria-current="page"] { color: var(--text); background: var(--bg-2); }
.top .btn { padding: 9px 16px; font-size: .92rem; }

/* buttons */
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 13px 22px; border-radius: 999px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: var(--on-accent); text-decoration: none; font-weight: 650; border: 0; font: inherit; font-weight: 650; cursor: pointer; box-shadow: 0 8px 24px -10px var(--accent); transition: transform .15s ease, box-shadow .15s ease; }
.btn:hover { transform: translateY(-1px); box-shadow: 0 12px 28px -10px var(--accent); }
.btn svg { width: 18px; height: 18px; }
.btn.ghost { background: transparent; color: var(--text); box-shadow: inset 0 0 0 1.5px var(--line); }
.btn.ghost:hover { box-shadow: inset 0 0 0 1.5px var(--accent); }
.actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 28px; }

/* hero */
.hero { position: relative; overflow: hidden; padding: clamp(56px, 9vw, 120px) 0 clamp(48px, 7vw, 96px); }
.hero::before { content: ""; position: absolute; inset: -30% -10% auto auto; width: 70vw; height: 70vw; max-width: 900px; max-height: 900px; background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 26%, transparent), transparent 70%); pointer-events: none; }
.hero::after { content: ""; position: absolute; inset: auto auto -40% -15%; width: 55vw; height: 55vw; max-width: 700px; max-height: 700px; background: radial-gradient(closest-side, color-mix(in srgb, var(--accent-2) 20%, transparent), transparent 70%); pointer-events: none; }
.hero .wrap { position: relative; z-index: 1; display: grid; grid-template-columns: 1.15fr .85fr; gap: clamp(28px, 5vw, 64px); align-items: center; }
.hero.center .wrap { grid-template-columns: 1fr; text-align: center; justify-items: center; }
.hero.center .lead { margin-inline: auto; }
.hero.center .actions { justify-content: center; }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); font-size: .82rem; font-weight: 650; letter-spacing: .02em; margin-bottom: 20px; }
.eyebrow svg { width: 15px; height: 15px; }
.hero h1 { font-size: clamp(2.5rem, 6.2vw, 4.6rem); }
.hero h1 em { font-style: ${th.head === 'serif' ? 'italic' : 'normal'}; background: linear-gradient(120deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lead { font-size: clamp(1.08rem, 1.6vw, 1.25rem); color: var(--muted); max-width: 600px; margin-top: 20px; }
.card-art { background: var(--surface); border: 1px solid var(--line); border-radius: calc(var(--radius) + 6px); padding: 22px; box-shadow: var(--shadow); transform: rotate(${th.tilt ?? 1.5}deg); }
.card-art h3 { font-size: 1rem; display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.card-art h3 svg { width: 18px; height: 18px; color: var(--accent); }
.card-art ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.card-art li { display: flex; justify-content: space-between; gap: 16px; padding: 12px 14px; border-radius: 12px; background: var(--bg-2); font-size: .95rem; }
.card-art li span:last-child { color: var(--accent); font-weight: 650; white-space: nowrap; }
.card-art .note { margin-top: 14px; font-size: .85rem; color: var(--muted); }

/* sections */
.section { padding: clamp(56px, 8vw, 104px) 0; }
.section.alt { background: var(--bg-2); }
.head { max-width: 680px; margin-bottom: 40px; }
.head h2 { font-size: clamp(1.8rem, 3.6vw, 2.6rem); }
.head p { color: var(--muted); margin-top: 14px; font-size: 1.08rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 26px; transition: transform .2s ease, box-shadow .2s ease; }
.card:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
.card h3 { font-size: 1.15rem; margin: 16px 0 8px; }
.card p { color: var(--muted); font-size: .98rem; }
.badge { width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.badge svg { width: 22px; height: 22px; }

/* stats */
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 18px; }
.stat { padding: 22px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); }
.stat b { display: block; font-family: var(--font-head); font-size: clamp(1.8rem, 3.4vw, 2.5rem); background: linear-gradient(120deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.stat span { color: var(--muted); font-size: .95rem; }

/* price list / menu */
.menu { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 22px 48px; }
.menu h3 { font-size: 1.3rem; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.dish { display: grid; grid-template-columns: 1fr auto; gap: 2px 16px; padding: 12px 0; border-bottom: 1px dashed var(--line); }
.dish b { font-weight: 650; }
.dish .price { color: var(--accent); font-weight: 700; white-space: nowrap; }
.dish small { grid-column: 1 / -1; color: var(--muted); font-size: .92rem; }

/* pricing */
.plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 18px; align-items: stretch; }
.plan { display: flex; flex-direction: column; gap: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: calc(var(--radius) + 4px); padding: 28px; }
.plan.featured { border-color: transparent; background: linear-gradient(var(--surface), var(--surface)) padding-box, linear-gradient(135deg, var(--accent), var(--accent-2)) border-box; border: 2px solid transparent; box-shadow: var(--shadow); }
.plan .tag { align-self: flex-start; font-size: .78rem; font-weight: 700; padding: 4px 10px; border-radius: 999px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: var(--on-accent); }
.plan h3 { font-size: 1.2rem; }
.plan .amount { font-family: var(--font-head); font-size: 2.4rem; font-weight: 750; }
.plan .amount small { font-size: 1rem; color: var(--muted); font-weight: 500; }
.plan ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; flex: 1; }
.plan li { display: flex; gap: 10px; color: var(--muted); font-size: .96rem; }
.plan li svg { width: 18px; height: 18px; color: var(--accent); flex: none; margin-top: 3px; }
.plan .btn { justify-content: center; }

/* steps & timeline */
.steps { counter-reset: step; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; }
.step { position: relative; padding: 26px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); }
.step::before { counter-increment: step; content: counter(step, decimal-leading-zero); font-family: var(--font-head); font-weight: 750; font-size: 1.6rem; color: var(--accent); }
.step h3 { font-size: 1.1rem; margin: 10px 0 6px; }
.step p { color: var(--muted); font-size: .96rem; }
.timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; border-left: 2px solid var(--line); margin-left: 8px; }
.timeline li { position: relative; padding: 0 0 30px 30px; }
.timeline li::before { content: ""; position: absolute; left: -9px; top: 4px; width: 16px; height: 16px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 0 0 5px var(--bg); }
.section.alt .timeline li::before { box-shadow: 0 0 0 5px var(--bg-2); }
.timeline .when { font-size: .85rem; font-weight: 700; color: var(--accent); letter-spacing: .02em; }
.timeline h3 { font-size: 1.12rem; margin: 4px 0 6px; }
.timeline p { color: var(--muted); }

/* quotes */
.quotes { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
.quote { margin: 0; padding: 26px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); }
.quote .stars { color: var(--accent); display: flex; gap: 2px; margin-bottom: 12px; }
.quote .stars svg { width: 17px; height: 17px; fill: currentColor; }
.quote blockquote { margin: 0; font-size: 1.04rem; }
.quote figcaption { margin-top: 16px; color: var(--muted); font-size: .92rem; font-weight: 600; }

/* gallery (gradient tiles — replace with your photos) */
.gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
.tile { aspect-ratio: 4 / 3; border-radius: var(--radius); padding: 18px; display: flex; align-items: flex-end; color: #fff; font-weight: 650; background: linear-gradient(145deg, var(--accent), var(--accent-2)); position: relative; overflow: hidden; }
.tile:nth-child(3n+2) { background: linear-gradient(200deg, var(--accent-2), color-mix(in srgb, var(--accent) 60%, #000)); }
.tile:nth-child(3n) { background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 70%, #fff), var(--accent)); }
.tile::after { content: ""; position: absolute; inset: 0; background: linear-gradient(transparent 45%, rgba(0,0,0,.35)); }
.tile span { position: relative; z-index: 1; text-shadow: 0 1px 8px rgba(0,0,0,.3); }

/* posts */
.posts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
.post { display: flex; flex-direction: column; gap: 10px; padding: 26px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); text-decoration: none; color: inherit; transition: transform .2s ease, box-shadow .2s ease; }
.post:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
.post .meta { font-size: .84rem; color: var(--muted); display: flex; gap: 10px; }
.post .meta b { color: var(--accent); }
.post h3 { font-size: 1.22rem; }
.post p { color: var(--muted); }
.article { max-width: 720px; margin-inline: auto; }
.article h1 { font-size: clamp(2.1rem, 5vw, 3.2rem); margin: 12px 0 18px; }
.article p { margin: 0 0 18px; font-size: 1.1rem; }
.article h2 { font-size: 1.5rem; margin: 34px 0 12px; }
.article blockquote { margin: 26px 0; padding: 6px 0 6px 22px; border-left: 3px solid var(--accent); font-size: 1.2rem; font-family: var(--font-head); }

/* faq */
.faq { display: grid; gap: 12px; max-width: 820px; }
.faq details { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 22px; }
.faq summary { cursor: pointer; font-weight: 650; list-style: none; display: flex; justify-content: space-between; gap: 16px; }
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after { content: "+"; color: var(--accent); font-size: 1.3rem; line-height: 1; }
.faq details[open] summary::after { content: "–"; }
.faq details p { color: var(--muted); margin-top: 12px; }

/* links (link in bio) */
.links { display: grid; gap: 12px; width: min(520px, 100%); margin: 30px auto 0; }
.links a { display: flex; align-items: center; gap: 14px; padding: 16px 20px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); color: var(--text); text-decoration: none; font-weight: 600; transition: transform .15s ease, border-color .15s ease; }
.links a:hover { transform: translateY(-2px); border-color: var(--accent); }
.links a svg { width: 22px; height: 22px; color: var(--accent); }
.links a .go { margin-left: auto; color: var(--muted); width: 18px; height: 18px; }
.avatar { width: 104px; height: 104px; border-radius: 50%; margin: 0 auto 18px; display: grid; place-items: center; font-family: var(--font-head); font-size: 2.4rem; font-weight: 750; color: var(--on-accent); background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 0 0 6px var(--bg), 0 0 0 8px color-mix(in srgb, var(--accent) 40%, transparent); }

/* tags / skills */
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips span { padding: 7px 14px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); font-size: .92rem; }

/* call to action */
.cta { border-radius: calc(var(--radius) + 10px); padding: clamp(36px, 6vw, 64px); background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: var(--on-accent); display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: center; box-shadow: var(--shadow); }
.cta h2 { font-size: clamp(1.7rem, 3.4vw, 2.4rem); }
.cta p { opacity: .9; margin-top: 10px; max-width: 560px; }
.cta .btn { background: var(--on-accent); color: var(--accent); box-shadow: none; }

/* contact */
.contact { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.info { display: grid; gap: 14px; align-content: start; }
.row { display: flex; gap: 14px; align-items: flex-start; padding: 18px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); }
.row svg { width: 22px; height: 22px; color: var(--accent); flex: none; margin-top: 2px; }
.row small { display: block; color: var(--muted); font-size: .85rem; }
.row a { color: var(--text); font-weight: 600; text-decoration: none; }
.hours { list-style: none; padding: 0; margin: 6px 0 0; display: grid; gap: 4px; font-size: .95rem; }
.hours li { display: flex; justify-content: space-between; gap: 20px; }
form.form { display: grid; gap: 14px; padding: 26px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); }
.form label { display: grid; gap: 6px; font-size: .9rem; font-weight: 600; }
.form input, .form textarea, .form select { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.form input:focus, .form textarea:focus, .form select:focus { outline: 2px solid var(--accent); border-color: transparent; }
.form textarea { min-height: 120px; resize: vertical; }
.form .hp { display: none; }
.form .btn { justify-self: start; }
.form small { color: var(--muted); }

/* page header for inner pages */
.pagehead { padding: clamp(48px, 7vw, 88px) 0 8px; }
.pagehead h1 { font-size: clamp(2.2rem, 5vw, 3.4rem); }
.pagehead p { color: var(--muted); margin-top: 14px; font-size: 1.12rem; max-width: 640px; }
.prose { max-width: 760px; }
.prose h2 { font-size: 1.4rem; margin: 30px 0 10px; }
.prose p { color: var(--muted); margin-bottom: 12px; }

/* footer */
.foot { border-top: 1px solid var(--line); padding: 36px 0; color: var(--muted); font-size: .92rem; }
.foot .wrap { display: flex; justify-content: space-between; gap: 18px; flex-wrap: wrap; align-items: center; }
.foot a { color: var(--muted); }
.foot nav { display: flex; gap: 16px; flex-wrap: wrap; }

/* 404 */
.notfound { min-height: 72vh; display: grid; place-items: center; text-align: center; }
.notfound b { display: block; font-family: var(--font-head); font-size: clamp(5rem, 16vw, 9rem); line-height: 1; background: linear-gradient(120deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.notfound p { color: var(--muted); margin: 14px 0 26px; }

@media (max-width: 860px) {
  .hero .wrap, .contact, .cta { grid-template-columns: 1fr; }
  .card-art { transform: none; }
  .nav { display: none; }
  body { font-size: 16px; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; scroll-behavior: auto !important; } }
`;
}

// ---------------------------------------------------------------- page pieces
const COMMON = {
  bg: { skip: 'Към съдържанието', menu: 'Основно меню', privacy: 'Поверителност', rights: 'Всички права запазени.', home: 'Начало', footer: 'Направено с грижа.', send: 'Изпрати', email: 'Имейл', name: 'Име', message: 'Съобщение', phone: 'Телефон', formNote: 'Отговаряме до един работен ден. Данните се ползват само за отговор.' },
  en: { skip: 'Skip to content', menu: 'Main menu', privacy: 'Privacy', rights: 'All rights reserved.', home: 'Home', footer: 'Made with care.', send: 'Send', email: 'Email', name: 'Name', message: 'Message', phone: 'Phone', formNote: 'We reply within one working day. Your details are used only to answer you.' },
};

function header(t, L, c, page) {
  const nav = c.nav.map(([label, href]) => `<a href="${href}"${href === page.path ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const cta = c.headerCta ? `<a class="btn" href="${c.headerCta[1]}">${c.headerCta[0]}</a>` : '';
  return `  <a class="skip" href="#main">${COMMON[L].skip}</a>
  <header class="top">
    <div class="wrap">
      <a class="brand" href="/"><span class="mark">${icon(t.mark)}</span>{{NAME}}</a>
      <nav class="nav" aria-label="${COMMON[L].menu}">${nav}</nav>
      ${cta}
    </div>
  </header>`;
}

function footer(t, L, c) {
  const links = c.nav.map(([label, href]) => `<a href="${href}">${label}</a>`).join('');
  return `  <footer class="foot">
    <div class="wrap">
      <p>© {{YEAR}} {{NAME}} · ${COMMON[L].rights}</p>
      <nav aria-label="${COMMON[L].menu}">${links}<a href="/privacy.html">${COMMON[L].privacy}</a></nav>
    </div>
  </footer>`;
}

function head(t, L, { title, description, index }) {
  return `<!doctype html>
<html lang="{{LANG}}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
${index ? '  <link rel="canonical" href="/">\n' : ''}  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta name="theme-color" content="${t.theme.bg}">
  <meta property="og:title" content="${index ? '{{NAME}}' : title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="/og.svg">
  <meta property="og:type" content="website">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
`;
}

function hero(h) {
  const art = h.card
    ? `<div class="card-art" aria-hidden="true">
          <h3>${icon(h.card.icon || 'spark')}${h.card.title}</h3>
          <ul>${h.card.rows.map(([a, b]) => `<li><span>${a}</span><span>${b}</span></li>`).join('')}</ul>${h.card.note ? `\n          <p class="note">${h.card.note}</p>` : ''}
        </div>`
    : '';
  const buttons = [h.cta ? `<a class="btn" href="${h.cta[1]}">${h.cta[0]}${icon('arrow')}</a>` : '', h.cta2 ? `<a class="btn ghost" href="${h.cta2[1]}">${h.cta2[0]}</a>` : ''].filter(Boolean).join('\n          ');
  const avatar = h.avatar ? `<div class="avatar" aria-hidden="true">${h.avatar}</div>\n        ` : '';
  const after = h.links ? `\n        <nav class="links" aria-label="Links">${h.links.map(([ic, label, href]) => `<a href="${href}">${icon(ic)}${label}${icon('arrow', 'go')}</a>`).join('')}</nav>` : '';
  const chips = h.chips ? `\n          <div class="chips" style="margin-top:22px">${h.chips.map((c) => `<span>${c}</span>`).join('')}</div>` : '';
  return `    <section class="hero${h.center ? ' center' : ''}">
      <div class="wrap">
        ${avatar}<div>
          ${h.eyebrow ? `<span class="eyebrow">${icon(h.eyebrowIcon || 'spark')}${h.eyebrow}</span>` : ''}
          <h1>${h.title}</h1>
          <p class="lead">${h.lead}</p>${buttons ? `\n          <div class="actions">\n          ${buttons}\n          </div>` : ''}${chips}
        </div>${after}
        ${art}
      </div>
    </section>`;
}

const sectionHead = (s) => (s.title ? `<div class="head"><h2>${s.title}</h2>${s.intro ? `<p>${s.intro}</p>` : ''}</div>` : '');

function section(s, L) {
  const open = `    <section class="section${s.alt ? ' alt' : ''}"${s.id ? ` id="${s.id}"` : ''}>
      <div class="wrap">
        ${sectionHead(s)}`;
  const close = `
      </div>
    </section>`;
  let inner = '';
  switch (s.type) {
    case 'cards':
      inner = `<div class="grid">${s.items.map(([ic, h, p]) => `
          <article class="card"><div class="badge">${icon(ic)}</div><h3>${h}</h3><p>${p}</p></article>`).join('')}
        </div>`;
      break;
    case 'stats':
      inner = `<div class="stats">${s.items.map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('')}</div>`;
      break;
    case 'menu':
      inner = `<div class="menu">${s.groups.map((g) => `
          <div>
            <h3>${g.name}</h3>${g.items.map(([n, d, p]) => `
            <div class="dish"><b>${n}</b><span class="price">${p}</span>${d ? `<small>${d}</small>` : ''}</div>`).join('')}
          </div>`).join('')}
        </div>`;
      break;
    case 'pricing':
      inner = `<div class="plans">${s.items.map((p) => `
          <article class="plan${p.featured ? ' featured' : ''}">${p.featured ? `<span class="tag">${p.featured}</span>` : ''}
            <h3>${p.name}</h3>
            <div class="amount">${p.price}${p.per ? ` <small>${p.per}</small>` : ''}</div>
            <ul>${p.features.map((f) => `<li>${icon('check')}<span>${f}</span></li>`).join('')}</ul>
            <a class="btn${p.featured ? '' : ' ghost'}" href="${p.cta[1]}">${p.cta[0]}</a>
          </article>`).join('')}
        </div>`;
      break;
    case 'steps':
      inner = `<div class="steps">${s.items.map(([h, p]) => `<div class="step"><h3>${h}</h3><p>${p}</p></div>`).join('')}</div>`;
      break;
    case 'timeline':
      inner = `<ol class="timeline">${s.items.map(([w, h, p]) => `
          <li><span class="when">${w}</span><h3>${h}</h3><p>${p}</p></li>`).join('')}
        </ol>`;
      break;
    case 'quotes':
      inner = `<div class="quotes">${s.items.map(([q, who]) => `
          <figure class="quote"><div class="stars" aria-hidden="true">${icon('star').repeat(5)}</div><blockquote>${q}</blockquote><figcaption>${who}</figcaption></figure>`).join('')}
        </div>`;
      break;
    case 'gallery':
      inner = `<div class="gallery">${s.items.map((c) => `<div class="tile"><span>${c}</span></div>`).join('')}</div>`;
      break;
    case 'posts':
      inner = `<div class="posts">${s.items.map((p) => `
          <a class="post" href="${p.href}"><span class="meta"><b>${p.tag}</b><span>${p.date}</span></span><h3>${p.h}</h3><p>${p.p}</p></a>`).join('')}
        </div>`;
      break;
    case 'faq':
      inner = `<div class="faq">${s.items.map(([q, a]) => `
          <details><summary>${q}</summary><p>${a}</p></details>`).join('')}
        </div>`;
      break;
    case 'chips':
      inner = `<div class="chips">${s.items.map((c) => `<span>${c}</span>`).join('')}</div>`;
      break;
    case 'prose':
      inner = `<div class="prose">${s.items.map(([h, p]) => `${h ? `<h2>${h}</h2>` : ''}<p>${p}</p>`).join('')}</div>`;
      break;
    case 'cta':
      return `    <section class="section"${s.id ? ` id="${s.id}"` : ''}>
      <div class="wrap">
        <div class="cta"><div><h2>${s.h}</h2><p>${s.p}</p></div><a class="btn" href="${s.button[1]}">${s.button[0]}</a></div>
      </div>
    </section>`;
    case 'contact': {
      const C = COMMON[L];
      const rows = s.rows.map(([ic, label, value, href]) => `
            <div class="row">${icon(ic)}<div><small>${label}</small>${href ? `<a href="${href}">${value}</a>` : `<span>${value}</span>`}</div></div>`).join('');
      const hours = s.hours ? `
            <div class="row">${icon('clock')}<div style="flex:1"><small>${s.hoursTitle}</small><ul class="hours">${s.hours.map(([d, h]) => `<li><span>${d}</span><span>${h}</span></li>`).join('')}</ul></div></div>` : '';
      const extra = (s.fields || []).map((f) => `
            <label for="f-${f.id}">${f.label}${f.options ? `<select id="f-${f.id}" name="${f.id}">${f.options.map((o) => `<option>${o}</option>`).join('')}</select>` : `<input id="f-${f.id}" name="${f.id}" type="${f.type || 'text'}">`}</label>`).join('');
      inner = `<div class="contact">
          <div class="info">${rows}${hours}
          </div>
          <form class="form" name="${s.formName || 'contact'}" method="POST" data-netlify="true" netlify-honeypot="company">
            <input type="hidden" name="form-name" value="${s.formName || 'contact'}">
            <p class="hp"><label for="f-company">Company</label><input id="f-company" name="company"></p>
            <label for="f-name">${C.name}<input id="f-name" name="name" autocomplete="name" required></label>
            <label for="f-email">${C.email}<input id="f-email" name="email" type="email" autocomplete="email" required></label>${extra}
            <label for="f-message">${s.messageLabel || C.message}<textarea id="f-message" name="message"></textarea></label>
            <button class="btn" type="submit">${s.send || C.send}</button>
            <small>${C.formNote}</small>
          </form>
        </div>`;
      break;
    }
    case 'form': {
      // a single-field signup (coming soon, newsletter)
      inner = `<form class="form" name="${s.formName}" method="POST" data-netlify="true" netlify-honeypot="company" style="max-width:560px">
          <input type="hidden" name="form-name" value="${s.formName}">
          <p class="hp"><label for="f-company">Company</label><input id="f-company" name="company"></p>
          <label for="f-email">${COMMON[L].email}<input id="f-email" name="email" type="email" autocomplete="email" required></label>
          <button class="btn" type="submit">${s.button}</button>
          <small>${s.note}</small>
        </form>`;
      break;
    }
    case 'article':
      return `    <article class="section">
      <div class="wrap article">
        <span class="eyebrow">${icon('book')}${s.tag}</span>
        <h1>${s.h}</h1>
        ${s.body.map((b) => (b.startsWith('## ') ? `<h2>${b.slice(3)}</h2>` : b.startsWith('> ') ? `<blockquote>${b.slice(2)}</blockquote>` : `<p>${b}</p>`)).join('\n        ')}
        <p><a class="btn ghost" href="/">${s.back}</a></p>
      </div>
    </article>`;
    default:
      throw new Error(`unknown section ${s.type}`);
  }
  return open + inner + close;
}

function page(t, L, pg) {
  const c = t.lang[L];
  const p = c.pages[pg.id];
  const index = pg.id === 'index';
  const title = index ? `{{NAME}} — ${c.tagline}` : `${p.title} · {{NAME}}`;
  const description = index ? `{{DESCRIPTION:${c.description}}}` : p.description;
  const body = [];
  if (p.hero) body.push(hero(p.hero));
  if (p.pagehead) body.push(`    <section class="pagehead"><div class="wrap"><h1>${p.pagehead[0]}</h1><p>${p.pagehead[1]}</p></div></section>`);
  for (const s of p.sections || []) body.push(section(s, L));
  return `${head(t, L, { title, description, index })}${header(t, L, c, { path: index ? '/' : `/${pg.id}.html` })}
  <main id="main">
${body.join('\n')}
  </main>
${footer(t, L, c)}
</body>
</html>
`;
}

function privacy(t, L) {
  const c = t.lang[L];
  const bg = L === 'bg';
  const sections = bg
    ? [
        ['Какво събираме', 'Само това, което ни изпратите сами — например име, имейл и съобщение от формата за контакт. Сайтът не използва рекламни или проследяващи бисквитки.'],
        ['Защо', 'За да отговорим на запитването ви. Не продаваме и не преотстъпваме данни на трети лица за маркетинг.'],
        ['Колко дълго', 'Пазим съобщенията толкова, колкото е нужно за отговор и за законовите ни задължения, след което ги изтриваме.'],
        ['Хостинг', 'Сайтът се хоства при доставчик в ЕС/САЩ със стандартни договорни клаузи. Сървърът записва технически логове (IP адрес, време) за сигурност.'],
        ['Вашите права', 'Можете да поискате достъп, поправка или изтриване на данните си и да подадете жалба до КЗЛД. Пишете ни на адреса от страницата за контакт — отговаряме до 30 дни.'],
      ]
    : [
        ['What we collect', 'Only what you send us yourself — for example your name, email and message from the contact form. The site uses no advertising or tracking cookies.'],
        ['Why', 'To answer your request. We never sell or share your data with third parties for marketing.'],
        ['How long', 'We keep messages as long as needed to answer and to meet legal obligations, then delete them.'],
        ['Hosting', 'The site is hosted by a provider in the EU/US under standard contractual clauses. The server keeps technical logs (IP address, time) for security.'],
        ['Your rights', 'You can ask for access, correction or deletion of your data and complain to your data protection authority. Write to the address on the contact page — we answer within 30 days.'],
      ];
  return `${head(t, L, { title: `{{PRIVACY_TITLE}} · {{NAME}}`, description: bg ? 'Какви данни събира {{NAME}} и как ги пази.' : 'What data {{NAME}} collects and how it is kept.', index: false })}${header(t, L, c, { path: '/privacy.html' })}
  <main id="main">
    <section class="pagehead"><div class="wrap"><h1>{{PRIVACY_TITLE}}</h1><p>{{PRIVACY_TEXT}}</p></div></section>
    <section class="section"><div class="wrap prose">
${sections.map(([h, p]) => `      <h2>${h}</h2><p>${p}</p>`).join('\n')}
      <p><a href="/">{{HOME}}</a></p>
    </div></section>
  </main>
${footer(t, L, c)}
</body>
</html>
`;
}

function notFound(t) {
  return `<!doctype html>
<html lang="{{LANG}}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>404 · {{NOTFOUND_TITLE}} · {{NAME}}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main id="main" class="notfound">
    <div>
      <b>404</b>
      <h1>{{NOTFOUND_TITLE}}</h1>
      <p>{{NOTFOUND_TEXT}}</p>
      <a class="btn" href="/">{{HOME}}</a>
    </div>
  </main>
</body>
</html>
`;
}

const favicon = (t) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.theme.accent}"/><stop offset="1" stop-color="${t.theme.accent2}"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><g transform="translate(14 14) scale(1.5)" fill="none" stroke="${t.theme.onAccent || '#fff'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[t.mark]}</g></svg>
`;

const og = (t, L) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.theme.accent}"/><stop offset="1" stop-color="${t.theme.accent2}"/></linearGradient><radialGradient id="r" cx="0.85" cy="0.15" r="0.7"><stop offset="0" stop-color="${t.theme.accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${t.theme.accent}" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="630" fill="${t.theme.bg}"/><rect width="1200" height="630" fill="url(#r)"/><rect x="80" y="90" width="96" height="96" rx="26" fill="url(#g)"/><g transform="translate(104 114) scale(2)" fill="none" stroke="${t.theme.onAccent || '#fff'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[t.mark]}</g><text x="80" y="360" font-family="system-ui,-apple-system,sans-serif" font-size="84" font-weight="800" fill="${t.theme.text}">{{NAME}}</text><text x="80" y="440" font-family="system-ui,-apple-system,sans-serif" font-size="38" fill="${t.theme.muted}">${t.lang[L].tagline}</text><rect x="80" y="500" width="160" height="8" rx="4" fill="url(#g)"/></svg>
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

// ---------------------------------------------------------------- write
const only = process.argv.slice(2);
for (const t of TEMPLATES) {
  if (only.length && !only.includes(t.id)) continue;
  const dir = path.join(OUT, t.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const w = (f, s) => fs.writeFileSync(path.join(dir, f), s);
  w('styles.css', css({ ...t.theme, name: t.id }));
  w('404.html', notFound(t));
  w('favicon.svg', favicon(t));
  w('netlify.toml', NETLIFY);
  w('.gitignore', GITIGNORE);
  w('bid.config.json', '{\n  "site": { "budgets": { "imageKB": 500 } }\n}\n');
  w('robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: /sitemap.xml\n');
  const pageIds = Object.keys(t.lang.en.pages);
  if (Object.keys(t.lang.bg.pages).join() !== pageIds.join()) throw new Error(`${t.id}: bg/en pages differ`);
  w('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...pageIds.map((p) => (p === 'index' ? '/' : `/${p}`)), '/privacy'].map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  for (const L of ['bg', 'en']) {
    for (const id of pageIds) w(`${id}.${L}.html`, page(t, L, { id }));
    w(`privacy.${L}.html`, privacy(t, L));
    w(`og.${L}.svg`, og(t, L));
  }
}
console.log('ok', TEMPLATES.length);
