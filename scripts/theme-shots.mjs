#!/usr/bin/env node
// Site Builder S5 — the picture of every theme in the picker: engine/themes/<id>/preview.jpg.
//
//   node scripts/theme-shots.mjs            every theme (the ones whose theme.json changed, or all with --all)
//   node scripts/theme-shots.mjs mentor     one theme
//   node scripts/theme-shots.mjs --check    no browser: fails when a preview is missing or older than its theme.json
//
// Renders `bid new preview` for the theme's sample name (English, the theme's own look), serves it from memory and
// photographs the first screen at 1280×800 with Chromium through Playwright (playwright-core; `BID_CHROME` points
// at a browser binary, otherwise the system Chrome, otherwise Playwright's own Chromium). previews.json records the
// theme.json fingerprint each picture was made from, so `bid new check` and the engine tests can tell a stale one.
// The engine itself stays dependency-free: this is dev tooling, run by the partner after a theme change or by the
// "theme-previews" workflow on macOS (the fonts the Mac app's users see).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES = path.join(ROOT, 'engine', 'themes');
const PREVIEWS = path.join(THEMES, 'previews.json');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const ids = args.filter((a) => !a.startsWith('--'));

process.env.BID_LANG = process.env.BID_LANG || 'en';
const { listThemes, previewStatus, themeHash } = await import(path.join(ROOT, 'engine', 'src', 'sitegen', 'themes.mjs'));
const { previewSite } = await import(path.join(ROOT, 'engine', 'src', 'sitegen', 'generate.mjs'));

const made = fs.existsSync(PREVIEWS) ? JSON.parse(fs.readFileSync(PREVIEWS, 'utf8')) : { version: 1, themes: {} };
const themes = listThemes().filter((th) => !ids.length || ids.includes(th.id));
if (!themes.length) {
  console.error(`no such theme: ${ids.join(', ')}`);
  process.exit(2);
}

if (flag('--check')) {
  const bad = themes.map((th) => [th.id, previewStatus(th.id)]).filter(([, st]) => st !== 'present');
  if (bad.length) {
    console.error(`theme previews out of date: ${bad.map(([id, st]) => `${id} (${st})`).join(', ')}\nrun: node scripts/theme-shots.mjs   (or the "theme-previews" workflow)`);
    process.exit(1);
  }
  console.log(`theme previews: ${themes.length} present and current`);
  process.exit(0);
}

const todo = themes.filter((th) => flag('--all') || ids.length || previewStatus(th.id) !== 'present');
if (!todo.length) {
  console.log('theme previews are current; --all redraws every one');
  process.exit(0);
}

// ---------------------------------------------------------------- the browser

async function loadPlaywright() {
  const tries = ['playwright-core', 'playwright'];
  try {
    const g = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    for (const n of ['playwright-core', 'playwright']) tries.push(path.join(g, n));
  } catch {}
  const require = createRequire(path.join(ROOT, 'scripts', 'package.json'));
  for (const mod of tries) {
    try {
      // a global install is a directory: ESM needs its entry file
      const entry = mod.startsWith('/') ? path.join(mod, 'index.mjs') : require.resolve(mod);
      if (!fs.existsSync(entry)) continue;
      // playwright-core's entry is CommonJS: its exports arrive under `default`
      const m = await import(entry);
      if (m.chromium || m.default?.chromium) return m.chromium ? m : m.default;
    } catch {}
  }
  throw new Error('Playwright is not installed: npm i --no-save --prefix scripts playwright-core');
}

async function launch(pw) {
  const options = { headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] };
  if (process.env.BID_CHROME) return pw.chromium.launch({ ...options, executablePath: process.env.BID_CHROME });
  try {
    return await pw.chromium.launch({ ...options, channel: 'chrome' });
  } catch {
    return pw.chromium.launch(options);
  }
}

// ---------------------------------------------------------------- a site from memory

function serve(files) {
  const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', xml: 'application/xml', txt: 'text/plain', json: 'application/json' };
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url || '/').split('?')[0].replace(/^\//, '')) || 'index.html';
    const body = files[name] ?? files[`${name}.html`];
    if (body === undefined) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': types[name.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

const pw = await loadPlaywright();
const browser = await launch(pw);
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
let failed = 0;
for (const th of todo) {
  const files = previewSite({ theme: th.id, name: th.sample || th.title, lang: 'en' });
  const { server, url } = await serve(files);
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(150);
    const out = path.join(THEMES, th.id, 'preview.jpg');
    await page.screenshot({ path: out, type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: 1280, height: 800 } });
    await page.close();
    made.themes[th.id] = { hash: themeHash(th.id), at: new Date().toISOString().slice(0, 10), bytes: fs.statSync(out).size };
    console.log(`${th.id.padEnd(12)} ${Math.round(fs.statSync(out).size / 1024)} KB`);
  } catch (e) {
    failed += 1;
    console.error(`${th.id}: ${e.message}`);
  } finally {
    server.close();
  }
}
await browser.close();
made.version = 1;
made.themes = Object.fromEntries(Object.entries(made.themes).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(PREVIEWS, JSON.stringify(made, null, 2) + '\n');
process.exit(failed ? 1 : 0);
