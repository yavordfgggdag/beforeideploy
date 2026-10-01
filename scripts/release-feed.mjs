#!/usr/bin/env node
// Writes or updates releases/latest.json — the feed `bid update check` reads (engine/src/update.mjs).
//
//   node scripts/release-feed.mjs --out releases/latest.json --version 10.1.0 --url https://…/Before-I-Deploy-10.1.0.dmg \
//        --sha256 <hex> [--min-version 10.0.0] [--channel stable|beta] [--notes notes.json] \
//        [--asset win32-x64-msi=https://…/Before-I-Deploy-10.1.0.msi#<sha256>] [--asset linux-x64-appimage=…#<sha256>] …
//
// --url/--sha256 stay the macOS DMG (what older apps read); --asset adds feed v2 installers per OS
// (keys: darwin-universal, win32-<arch>-msi|msix|exe, linux-<arch>-appimage|deb; engine/src/platform).
//
// stable: replaces the top-level entry (keeping an existing `beta` block that is newer);
// beta:   writes only the `beta` block, the stable entry stays as it is.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const out = opt('out', 'releases/latest.json');
const version = opt('version');
const url = opt('url');
const sha256 = opt('sha256');
const channel = opt('channel', 'stable');
const minVersion = opt('min-version');
const notesFile = opt('notes');
if (!version || !url || !sha256) {
  console.error('usage: release-feed.mjs --version V --url URL --sha256 HEX [--out F] [--min-version V] [--channel stable|beta] [--notes notes.json]');
  process.exit(2);
}
if (!/^[0-9a-f]{64}$/i.test(sha256)) {
  console.error('❌ --sha256 must be a 64-hex digest');
  process.exit(2);
}
const assets = {};
args.forEach((a, i) => {
  if (a !== '--asset') return;
  const m = /^([a-z0-9]+-[a-z0-9]+(?:-[a-z]+)?)=(https?:\/\/[^#\s]+)#([0-9a-f]{64})$/i.exec(args[i + 1] || '');
  if (!m) {
    console.error(`❌ --asset must look like key=https://…#<sha256>: ${args[i + 1]}`);
    process.exit(2);
  }
  assets[m[1]] = { url: m[2], sha256: m[3].toLowerCase() };
});
const notes = notesFile ? JSON.parse(fs.readFileSync(notesFile, 'utf8')).notes ?? JSON.parse(fs.readFileSync(notesFile, 'utf8')) : {};
const entry = { version, url, sha256: sha256.toLowerCase(), notes, publishedAt: new Date().toISOString() };
if (Object.keys(assets).length) entry.assets = { 'darwin-universal': { url, sha256: entry.sha256 }, ...assets };

let feed = {};
if (fs.existsSync(out)) feed = JSON.parse(fs.readFileSync(out, 'utf8'));
if (channel === 'beta') {
  feed.beta = entry;
} else {
  const beta = feed.beta;
  feed = { ...entry, minVersion: minVersion ?? feed.minVersion ?? undefined };
  if (beta && compare(beta.version, version) > 0) feed.beta = beta; // a newer beta stays visible on the beta channel
}
if (feed.minVersion === undefined) delete feed.minVersion;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(feed, null, 2) + '\n');
console.log(`✅ ${out}: ${channel} ${version}${feed.minVersion ? ` (minVersion ${feed.minVersion})` : ''}`);

function compare(a, b) {
  const pa = String(a).split(/[-+]/)[0].split('.').map(Number);
  const pb = String(b).split(/[-+]/)[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  const preA = String(a).includes('-');
  const preB = String(b).includes('-');
  return preA === preB ? 0 : preA ? -1 : 1;
}
