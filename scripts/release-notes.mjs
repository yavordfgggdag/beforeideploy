#!/usr/bin/env node
// Release notes for one version from CHANGELOG.md, as JSON for latest.json (WP8-A).
//
//   node scripts/release-notes.mjs                 # version from engine/VERSION
//   node scripts/release-notes.mjs 10.1.0          # explicit version
//   node scripts/release-notes.mjs --check         # exit 1 unless the entry exists, has en + bg bullets
//                                                  # and is not marked "(in development)"; --allow-dev relaxes the last rule
//
// CHANGELOG.md format (see the file): `## <version>` sections with `### English` and `### Български`
// subsections of `- ` bullets. An entry without language subsections (V9) is used for both languages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const allowDev = args.includes('--allow-dev');
const version = args.find((a) => !a.startsWith('--')) || fs.readFileSync(path.join(ROOT, 'engine', 'VERSION'), 'utf8').trim();

const LANG_HEADINGS = { English: 'en', Български: 'bg' };

export function parseChangelog(text) {
  const entries = [];
  const sections = text.split(/^## /m).slice(1);
  for (const section of sections) {
    const [headingLine, ...rest] = section.split('\n');
    const heading = headingLine.trim();
    const ver = heading.split(/\s+/)[0];
    const inDevelopment = /\(in development\)/i.test(heading);
    const notes = {};
    let lang = null;
    const plain = [];
    for (const line of rest) {
      const h = /^### (.+)$/.exec(line.trim());
      if (h) {
        lang = LANG_HEADINGS[h[1].trim()] || h[1].trim().toLowerCase();
        continue;
      }
      if (/^- /.test(line.trim())) {
        const bullet = line.trim();
        if (lang) (notes[lang] ||= []).push(bullet);
        else plain.push(bullet);
      }
    }
    if (!Object.keys(notes).length && plain.length) {
      notes.en = plain;
      notes.bg = plain;
    }
    entries.push({ version: ver, inDevelopment, notes: Object.fromEntries(Object.entries(notes).map(([k, v]) => [k, v.join('\n')])) });
  }
  return entries;
}

const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const entry = parseChangelog(changelog).find((e) => e.version === version || e.version === version.replace(/-.*$/, ''));

if (!entry) {
  console.error(`❌ CHANGELOG.md has no entry for ${version}`);
  process.exit(1);
}
if (check) {
  const problems = [];
  for (const l of ['en', 'bg']) if (!entry.notes[l]) problems.push(`no ${l} notes`);
  if (entry.inDevelopment && !allowDev) problems.push('still marked "(in development)" — finish the entry before releasing');
  if (problems.length) {
    console.error(`❌ CHANGELOG.md ${version}: ${problems.join('; ')}`);
    process.exit(1);
  }
  console.log(`✅ CHANGELOG.md has release notes for ${version} (en, bg)`);
} else {
  console.log(JSON.stringify(entry, null, 2));
}
