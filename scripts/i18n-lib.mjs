// Shared helpers for the i18n scripts: .strings read/write and placeholder signatures.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENGINE_I18N = path.join(ROOT, 'engine', 'i18n');
export const APP_RESOURCES = path.join(ROOT, 'App', 'Resources');

export function parseStrings(text, file = '') {
  const out = {};
  const duplicates = [];
  let i = 0;
  const n = text.length;
  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i + 2);
        i = end < 0 ? n : end + 2;
      } else if (text.startsWith('//', i)) {
        const end = text.indexOf('\n', i);
        i = end < 0 ? n : end + 1;
      } else return;
    }
  };
  const str = () => {
    if (text[i] !== '"') throw new Error(`${file}: expected " at ${i}`);
    i++;
    let s = '';
    while (i < n && text[i] !== '"') {
      if (text[i] === '\\') {
        const c = text[i + 1];
        if (c === 'n') s += '\n';
        else if (c === 't') s += '\t';
        else if (c === 'U' || c === 'u') {
          s += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 4;
        } else s += c;
        i += 2;
      } else s += text[i++];
    }
    i++;
    return s;
  };
  for (;;) {
    skip();
    if (i >= n) break;
    const key = str();
    skip();
    if (text[i] !== '=') throw new Error(`${file}: expected = after "${key}"`);
    i++;
    skip();
    const value = str();
    skip();
    if (text[i] !== ';') throw new Error(`${file}: expected ; after "${key}"`);
    i++;
    if (key in out) duplicates.push(key);
    out[key] = value;
  }
  return { entries: out, duplicates };
}

/** Placeholder signature of an app (.strings) text: number of %@ / %1$@ … formats. */
export const stringsFormats = (s) => (String(s).match(/%(\d+\$)?[@dfs]/g) || []).length;

/** Placeholder signature of an engine text: sorted {name} list. */
export const braces = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const escape = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t');

/** Writes a .strings file sorted by key, with a blank line between key groups. */
export function writeStrings(file, entries, title) {
  const lines = [`/* ${title} */`, ''];
  let prev = null;
  for (const key of Object.keys(entries).sort()) {
    const group = key.split('.')[0];
    if (prev && group !== prev) lines.push('');
    prev = group;
    lines.push(`"${key}" = "${escape(entries[key])}";`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

export function readStrings(file) {
  return fs.existsSync(file) ? parseStrings(fs.readFileSync(file, 'utf8'), file).entries : {};
}
