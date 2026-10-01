// Web i18n check: bg and en have the same keys; every literal t('key') in src exists; dynamic prefixes are listed.
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const bg = JSON.parse(fs.readFileSync(path.join(root, 'i18n/bg.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n/en.json'), 'utf8'));
const errs = [];
for (const k of Object.keys(bg)) if (!(k in en)) errs.push(`en missing ${k}`);
for (const k of Object.keys(en)) if (!(k in bg)) errs.push(`bg missing ${k}`);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
for (const f of walk(root)) {
  const src = fs.readFileSync(f, 'utf8');
  if (f.endsWith(path.join('i18n', 'index.ts'))) continue;
  for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) {
    const k = m[1];
    const ok = k.endsWith('.') ? Object.keys(bg).some((x) => x.startsWith(k)) : k in bg; // dynamic prefix: t('status.' + s)
    if (!ok) errs.push(`${path.relative(root, f)}: unknown key ${k}`);
  }
}
// Bulgarian values must not be identical to English except brand/product words
const allow = /^(Netlify|Cloudflare Pages|Vercel|GitHub Pages|Free|Flash|High|Knight|Sonnet 5\.5|—)$/;
for (const k of Object.keys(bg)) if (bg[k] === en[k] && !allow.test(bg[k])) errs.push(`bg==en for ${k}: ${bg[k]}`);
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
console.log(`✅ web i18n ok (${Object.keys(bg).length} keys)`);
