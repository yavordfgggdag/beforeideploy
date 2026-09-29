#!/usr/bin/env node
// Engine test-suite. Builds throwaway fixture projects in a temp dir and exercises every core flow.
// Usage: node tests/run.mjs   (uses an isolated app/cache dir — never touches your real library)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BID = path.join(ROOT, 'engine', 'bid');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-test-'));
const ENV = {
  ...process.env,
  BID_APP_DIR: path.join(TMP, 'app'),
  BID_CACHE_DIR: path.join(TMP, 'cache'),
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  HOME: path.join(TMP, 'home'), // isolates Netlify auth lookup
  BID_NO_KEYCHAIN: '1', // never touch the real Keychain in tests
  BID_NO_BUNDLED_CLOUD: '1', // never talk to the real Supabase in tests
  BID_LANG: 'en', // assertions check message keys; texts come from engine/i18n/en.json
};
fs.mkdirSync(ENV.HOME, { recursive: true });

let passed = 0;
let failed = 0;

function bid(...args) {
  return bidEnv({}, ...args);
}

function bidEnv(extra, ...args) {
  const r = spawnSync(BID, args, { env: { ...ENV, ...extra }, encoding: 'utf8', timeout: 120000 });
  const lines = (r.stdout || '').trim().split('\n').filter(Boolean);
  const events = [];
  for (const l of lines) {
    try {
      events.push(JSON.parse(l));
    } catch {}
  }
  const result = events.find((e) => e.type === 'result') || null;
  return { code: r.status, events, result, data: result?.data, stderr: r.stderr };
}

// Swift model tests decode these captured engine results (App/Tests/BeforeIDeployTests/Fixtures).
// Written only on demand so the committed fixtures change deliberately: BID_WRITE_FIXTURES=1 node tests/run.mjs
const FIXTURES_DIR = path.join(ROOT, 'App', 'Tests', 'BeforeIDeployTests', 'Fixtures');
function fixture(name, data) {
  if (!process.env.BID_WRITE_FIXTURES) return;
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.writeFileSync(path.join(FIXTURES_DIR, `${name}.json`), JSON.stringify(data, null, 2) + '\n');
}

function t(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}\n     ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function mk(name, files, { repo = true, commit = true } = {}) {
  const dir = path.join(TMP, name);
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
  fs.mkdirSync(dir, { recursive: true });
  if (repo) {
    git(dir, 'init', '-q', '-b', 'main');
    if (commit) {
      git(dir, 'add', '-A');
      git(dir, 'commit', '-qm', 'init');
    }
  }
  return dir;
}

const stepOf = (check, id) => check.steps.find((s) => s.id === id);

// ------------------------------------------------------------------ fixtures
const HTML = '<!doctype html><title>ok</title><h1>Hello</h1>';
const staticSite = mk('static-site', { 'index.html': HTML, '.gitignore': 'node_modules/\n.env\n.env.*\n!.env.example\n.netlify/\n.DS_Store\n*.log\n' });

const buildJs = `const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html','<h1>built</h1>');`;
const viteApp = mk('vite-app', {
  'package.json': JSON.stringify({ name: 'vite-app', scripts: { build: 'node build.js', lint: 'node -e "process.exit(0)"', typecheck: 'node -e "console.log(\'types ok\')"' }, devDependencies: { vite: '^5.0.0' } }, null, 2),
  'build.js': buildJs,
  'node_modules/.keep': '',
  '.gitignore': 'node_modules/\ndist/\n.env\n.env.*\n!.env.example\n.netlify/\n.DS_Store\n*.log\n',
});

const failingBuild = mk('failing-build', {
  'package.json': JSON.stringify({ name: 'fail', scripts: { build: 'node -e "console.error(\'Boom: cannot compile\');process.exit(1)"', lint: 'node -e "0"' } }),
  'node_modules/.keep': '',
  '.gitignore': 'node_modules/\n',
});

const trackedEnv = mk('tracked-env', { 'index.html': HTML, '.env': 'API_KEY=supersecret\n' });

const secretInCode = mk('secret-in-code', {
  'index.html': HTML,
  'src/config.js': "export const stripe = 'sk_live_" + 'a1B2c3D4e5F6g7H8i9J0kLmN' + "';\n",
  '.gitignore': 'node_modules/\n.env\n',
});

const noGit = mk('no-git', { 'index.html': HTML }, { repo: false });

// ------------------------------------------------------------------ tests
console.log(`\nBefore I Deploy — engine tests\n  tmp: ${TMP}\n`);

t('doctor връща версия и node', () => {
  const r = bid('doctor');
  assert(r.result?.ok, 'doctor failed');
  fixture('doctor', r.data);
  assert(/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(r.data.engine), 'bad version');
});

t('project add / list / remove', () => {
  const a = bid('project', 'add', '--path', staticSite);
  assert(a.result.ok && a.data.key, 'add failed');
  assert(a.data.framework === 'static', `framework=${a.data.framework}`);
  const l = bid('project', 'list');
  assert(l.data.length === 1 && l.data[0].exists, 'list wrong');
  bid('project', 'add', '--path', viteApp);
  const r = bid('project', 'remove', '--project', a.data.key);
  assert(r.data.removed, 'not removed');
  assert(bid('project', 'list').data.length === 1, 'still listed');
});

t('project add отказва несъществуваща папка', () => {
  const r = bid('project', 'add', '--path', path.join(TMP, 'nope'));
  assert(r.result.ok === false && r.code !== 0, 'should fail');
  assert(r.result.key === 'project.folderNotFound' && r.result.params?.path === path.join(TMP, 'nope'), JSON.stringify(r.result));
});

// ---------------------------------------------------------------- i18n

const I18N = path.join(ROOT, 'engine', 'i18n');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8'));
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

t('i18n: en и bg имат едни и същи ключове и placeholders', () => {
  const en = catalog('en');
  const bg = catalog('bg');
  const ek = Object.keys(en).filter((k) => k !== '_meta');
  const bk = Object.keys(bg).filter((k) => k !== '_meta');
  const missing = ek.filter((k) => !(k in bg)).concat(bk.filter((k) => !(k in en)));
  assert(!missing.length, `missing: ${missing.join(', ')}`);
  for (const k of ek) {
    assert(typeof en[k] === 'string' && en[k] && typeof bg[k] === 'string' && bg[k], `empty: ${k}`);
    assert(placeholders(en[k]) === placeholders(bg[k]), `placeholders differ: ${k}`);
  }
});

t('i18n: scripts/i18n-check.mjs (engine + app каталози, без твърд текст в Swift)', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'i18n-check.mjs')], { encoding: 'utf8' });
  assert(r.status === 0, (r.stdout + r.stderr).trim().split('\n').slice(-8).join(' | '));
});

t('грешки: всеки EngineError код е документиран в docs/errors.md (scripts/error-codes.mjs)', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'error-codes.mjs')], { encoding: 'utf8' });
  assert(r.status === 0, (r.stdout + r.stderr).trim().split('\n').slice(-8).join(' | '));
});

t('release: бележки от CHANGELOG и latest.json (release-notes.mjs, release-feed.mjs)', () => {
  const node = (args) => spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
  const notes = node([path.join(ROOT, 'scripts', 'release-notes.mjs'), '10.0.0']);
  assert(notes.status === 0, notes.stderr);
  const n = JSON.parse(notes.stdout);
  assert(n.inDevelopment === true && n.notes.en.includes('AI Fix') && n.notes.bg.includes('AI Fix'), notes.stdout.slice(0, 200));
  assert(node([path.join(ROOT, 'scripts', 'release-notes.mjs'), '10.0.0', '--check']).status === 1, 'dev entry must fail --check');
  assert(node([path.join(ROOT, 'scripts', 'release-notes.mjs'), '10.0.0', '--check', '--allow-dev']).status === 0, '--allow-dev');
  assert(node([path.join(ROOT, 'scripts', 'release-notes.mjs'), '1.2.3']).status === 1, 'unknown version');

  const dir = path.join(TMP, 'release-feed');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'latest.json');
  const notesFile = path.join(dir, 'notes.json');
  fs.writeFileSync(notesFile, notes.stdout);
  const sha = 'a'.repeat(64);
  const feed = (...a) => node([path.join(ROOT, 'scripts', 'release-feed.mjs'), '--out', out, '--sha256', sha, ...a]);
  assert(feed('--version', '10.0.0', '--url', 'https://x/10.0.0.dmg', '--min-version', '9.0.0', '--notes', notesFile).status === 0, 'stable');
  let j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert(j.version === '10.0.0' && j.minVersion === '9.0.0' && j.notes.bg && j.sha256 === sha, JSON.stringify(j).slice(0, 200));
  assert(feed('--version', '10.1.0-beta.1', '--url', 'https://x/b.dmg', '--channel', 'beta').status === 0, 'beta');
  j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert(j.version === '10.0.0' && j.beta.version === '10.1.0-beta.1', 'beta goes to .beta');
  assert(feed('--version', '10.0.1', '--url', 'https://x/10.0.1.dmg').status === 0, 'stable 2');
  j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert(j.version === '10.0.1' && j.minVersion === '9.0.0' && j.beta?.version === '10.1.0-beta.1', 'minVersion and newer beta kept');
  assert(feed('--version', '10.2.0', '--url', 'https://x/10.2.0.dmg').status === 0, 'stable 3');
  j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert(!j.beta, 'older beta dropped');
  const bad = node([path.join(ROOT, 'scripts', 'release-feed.mjs'), '--out', out, '--version', '1', '--url', 'u', '--sha256', 'nope']);
  assert(bad.status === 2, 'bad sha must exit 2');
});

const { fitPrompt, PROMPT_MAX_CHARS } = await import(path.join(ROOT, 'engine', 'src', 'ai', 'fit.mjs'));
t('ai: prompt над 60 000 символа се съкращава — пази началото, края и редовете с грешки', () => {
  const small = 'intro\nbody\nend';
  assert(fitPrompt(small) === small, 'short prompts stay');
  const noise = Array.from({ length: 5000 }, (_, i) => `vite v5 transforming module ${i} ok`).join('\n');
  const big = `## Intro\ncontext line\n${noise}\nsrc/app.js:12:5 TypeError: x is not a function\n${noise}\n## How to answer\nSEARCH/REPLACE blocks`;
  const fit = fitPrompt(big);
  assert(big.length > PROMPT_MAX_CHARS && fit.length <= PROMPT_MAX_CHARS, `length ${fit.length}`);
  assert(fit.includes('## Intro') && fit.includes('TypeError: x is not a function') && fit.includes('SEARCH/REPLACE blocks'), 'kept the important parts');
  assert(/lines left out/.test(fit), 'marks what was dropped');
  const allErrors = Array.from({ length: 9000 }, (_, i) => `error ${i}: something failed in a very long line of output`).join('\n');
  assert(fitPrompt(allErrors).length <= PROMPT_MAX_CHARS, 'hard cap');
});

t('имейл шаблони: всеки има en и bg клон по .Data.locale и линка за потвърждение', () => {
  const dir = path.join(ROOT, 'supabase', 'email-templates');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
  assert(['confirmation.html', 'recovery.html', 'invite.html', 'magic_link.html'].every((f) => files.includes(f)), files.join(','));
  for (const f of files) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    assert(html.includes('{{ if eq .Data.locale "bg" }}') && html.includes('{{ else }}') && html.includes('{{ end }}'), f + ': language branches');
    assert((html.match(/\{\{ \.ConfirmationURL \}\}/g) || []).length === 2, f + ': link in both languages');
    assert(/[\u0400-\u04FF]/.test(html) && !html.includes('__'), f + ': Bulgarian text filled in');
  }
});

t('i18n: всеки ключ в engine/src съществува в каталога, няма неизползвани', () => {
  const en = catalog('en');
  const src = path.join(ROOT, 'engine', 'src');
  const used = new Set();
  const mjs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? mjs(path.join(dir, e.name)) : e.name.endsWith('.mjs') ? [path.join(dir, e.name)] : []));
  for (const f of mjs(src)) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\b(?:t|msg)\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    for (const m of text.matchAll(/'([a-z]+(?:\.[a-zA-Z0-9_]+)+)'/g)) if (m[1] in en) used.add(m[1]);
  }
  const unknown = [...used].filter((k) => /^[a-z]+\.[a-zA-Z]/.test(k) && !(k in en) && !/\.(mjs|cjs|json|log|md|command|html|zsh)$/.test(k));
  assert(!unknown.length, `not in catalog: ${unknown.join(', ')}`);
  const unused = Object.keys(en).filter((k) => k !== '_meta' && !used.has(k));
  assert(!unused.length, `unused keys: ${unused.join(', ')}`);
});

t('i18n: ценоразписът следва BID_LANG, редактираните етикети остават', () => {
  const en = bidEnv({ BID_LANG: 'en' }, 'prices');
  assert(en.data.items['local:check'].label === 'Local check / build', JSON.stringify(en.data.items['local:check']));
  const file = path.join(ENV.BID_APP_DIR, 'prices.json');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored.items['github:push'].label = 'Моят push';
  fs.writeFileSync(file, JSON.stringify(stored));
  const bg = bidEnv({ BID_LANG: 'bg' }, 'prices');
  assert(bg.data.items['local:check'].label === 'Локална проверка / build', bg.data.items['local:check'].label);
  assert(bg.data.items['github:push'].label === 'Моят push' && bidEnv({ BID_LANG: 'en' }, 'prices').data.items['github:push'].label === 'Моят push', 'edited label changed');
  const setup = bidEnv({ BID_LANG: 'bg' }, 'setup', 'status');
  assert(setup.data.items.some((i) => i.group === 'Основа'), 'setup group not bg');
});

t('i18n: BID_LANG=bg дава текстовете от V9, непознат език → en', () => {
  const nope = path.join(TMP, 'nope');
  const bg = bidEnv({ BID_LANG: 'bg' }, 'project', 'add', '--path', nope);
  assert(bg.result.error === `Папката не съществува: ${nope}`, bg.result.error);
  assert(bg.result.key === 'project.folderNotFound' && bg.result.code === 'not_found', JSON.stringify(bg.result));
  const locale = bidEnv({ BID_LANG: 'bg_BG.UTF-8' }, 'project', 'add', '--path', nope);
  assert(locale.result.error.startsWith('Папката не съществува'), locale.result.error);
  const de = bidEnv({ BID_LANG: 'de' }, 'project', 'add', '--path', nope);
  assert(de.result.error === `The folder does not exist: ${nope}`, de.result.error);
  const unset = bidEnv({ BID_LANG: '' }, 'project', 'add', '--path', nope);
  assert(unset.result.error.startsWith('The folder does not exist'), unset.result.error);
  const usage = bidEnv({ BID_LANG: 'bg' }, 'project', 'wat');
  assert(usage.code === 2 && usage.result.key === 'cli.unknownCommand' && usage.result.params?.command === 'project wat', JSON.stringify(usage.result));
  assert(usage.result.error === 'Непозната команда: project wat', usage.result.error);
});

t('detect: vite, npm, dist, скриптове', () => {
  const r = bid('detect', '--project', viteApp);
  assert(r.data.framework === 'vite', r.data.framework);
  assert(r.data.packageManager === 'npm', r.data.packageManager);
  assert(r.data.publishDir === 'dist', r.data.publishDir);
  assert(r.data.typecheckScript === 'typecheck', 'no typecheck');
});

t('check: статичен сайт → ready', () => {
  const r = bid('check', '--project', staticSite);
  assert(r.result.ok, r.result?.error);
  assert(r.data.status === 'ready', `status=${r.data.status} ${JSON.stringify(r.data.steps.map((s) => [s.id, s.status, s.summary]))}`);
  assert(r.events.some((e) => e.type === 'step' && e.status === 'running'), 'no live step events');
});

t('check: vite app — build създава dist, статус ready', () => {
  const r = bid('check', '--project', viteApp);
  fixture('check', r.data);
  assert(stepOf(r.data, 'build').status === 'pass', JSON.stringify(stepOf(r.data, 'build')));
  assert(fs.existsSync(path.join(viteApp, 'dist', 'index.html')), 'no dist');
  assert(stepOf(r.data, 'lint').status === 'pass', 'lint');
  assert(stepOf(r.data, 'typecheck').status === 'pass', 'typecheck');
  assert(r.events.some((e) => e.type === 'log' && e.step === 'typecheck' && /types ok/.test(e.line)), 'no streamed log');
  assert(r.data.status === 'ready', `status=${r.data.status}`);
});

t('check: инкрементално — непроменен проект ползва кеша, промяна или --force → пълна проверка', () => {
  const again = bid('check', '--project', viteApp);
  for (const id of ['lint', 'typecheck', 'build']) assert(stepOf(again.data, id).cached === true && stepOf(again.data, id).status === 'pass', `${id} should be cached: ${JSON.stringify(stepOf(again.data, id))}`);
  assert(!stepOf(again.data, 'git').cached && !stepOf(again.data, 'secrets').cached, 'git/secrets are never cached');
  assert(again.data.status === 'ready' && again.data.cached.includes('build'), JSON.stringify(again.data.cached));
  const forced = bid('check', '--project', viteApp, '--force');
  assert(!stepOf(forced.data, 'build').cached && stepOf(forced.data, 'build').status === 'pass', '--force must run the build');
  fs.appendFileSync(path.join(viteApp, 'build.js'), '\n// touched\n');
  const changed = bid('check', '--project', viteApp);
  assert(!stepOf(changed.data, 'build').cached && stepOf(changed.data, 'build').status === 'pass', 'a changed tree must rebuild');
  assert(stepOf(bid('check', '--project', viteApp).data, 'build').cached === true, 'cached again once the change is recorded');
  // leave the fixture clean (later tests expect a ready project): commit → new HEAD → full run → ready
  git(viteApp, 'add', '-A');
  git(viteApp, 'commit', '-qm', 'touch build');
  const clean = bid('check', '--project', viteApp);
  assert(!stepOf(clean.data, 'build').cached && clean.data.status === 'ready', `after commit: ${clean.data.status}`);
});

t('check: провален build → blocked + лог', () => {
  const r = bid('check', '--project', failingBuild);
  const b = stepOf(r.data, 'build');
  assert(b.status === 'fail', b.status);
  assert(r.data.status === 'blocked', r.data.status);
  assert(b.log && fs.readFileSync(b.log, 'utf8').includes('Boom'), 'log missing');
  assert(b.details.some((l) => l.includes('Boom')), 'details missing');
});

t('smart: спира при грешка и не deploy-ва', () => {
  const r = bid('smart', '--project', failingBuild);
  assert(r.code === 3 && r.result.code === 'blocked', `code=${r.code} ${r.result?.code}`);
  const dep = r.events.filter((e) => e.type === 'step' && e.id === 'deploy').pop();
  assert(dep?.status === 'skipped', 'deploy not skipped');
  const hosting = r.events.filter((e) => e.type === 'step' && e.id === 'hosting').pop();
  assert(hosting.status === 'skipped', 'steps after failure should be skipped');
});

t('deploy: blocked проект → отказ (код 3)', () => {
  const r = bid('netlify', 'deploy', '--project', failingBuild);
  assert(r.code === 3 && r.result.code === 'blocked', `${r.code} ${r.result?.code}`);
});

t('deploy: production без DEPLOY → отказ (код 2)', () => {
  const r = bid('netlify', 'deploy', '--project', viteApp, '--prod');
  assert(r.code === 2 && r.result.code === 'confirm_required', `${r.code} ${r.result?.code}`);
  const r2 = bid('netlify', 'deploy', '--project', viteApp, '--prod', '--confirm', 'deploy');
  assert(r2.code === 2, 'lowercase must not pass');
  const r3 = bid('smart', '--project', viteApp, '--prod');
  assert(r3.code === 2, 'smart --prod without confirm must fail');
});

t('deploy: без проверка → отказ', () => {
  const fresh = mk('fresh', { 'index.html': HTML });
  const r = bid('netlify', 'deploy', '--project', fresh);
  assert(r.code === 3 && r.result.code === 'needs_check', `${r.code} ${r.result?.code}`);
});

t('deploy: код, променен след проверката → отказ, докато не се провери отново (E7)', () => {
  const site = mk('changed-after-check', { 'index.html': HTML });
  const c = bid('check', '--project', site);
  assert(c.data?.fingerprint, 'the check stores a fingerprint');
  const before = bid('netlify', 'deploy', '--project', site);
  assert(before.result.code !== 'stale_check' && before.result.code !== 'needs_check', 'fresh check passes the guard: ' + before.result.code);
  fs.writeFileSync(path.join(site, 'index.html'), HTML + '<!-- edit -->');
  const after = bid('netlify', 'deploy', '--project', site);
  assert(after.code === 3 && after.result.code === 'stale_check' && after.result.key === 'deploy.changedSinceCheck', JSON.stringify(after.result));
});

t('deploy: без Netlify вход → отказ (код 5)', () => {
  const r = bid('netlify', 'deploy', '--project', viteApp);
  assert(r.code === 5 && r.result.code === 'not_logged_in', `${r.code} ${r.result?.code}`);
});

t('secrets: проследяван .env → fail + fix env.untrack', () => {
  const r = bid('check', '--project', trackedEnv);
  const s = stepOf(r.data, 'secrets');
  assert(s.status === 'fail', s.status);
  assert(s.fixes.includes('env.untrack'), JSON.stringify(s.fixes));
  const f = bid('fix', 'list', '--project', trackedEnv);
  assert(f.data.some((x) => x.id === 'env.untrack'), 'not in fix list');
});

t('fix: без --yes не прави нищо', () => {
  const r = bid('fix', 'apply', 'env.untrack', '--project', trackedEnv);
  assert(r.code === 2 && r.result.code === 'confirm_required', `${r.code}`);
  assert(git(trackedEnv, 'ls-files').includes('.env'), 'must still be tracked');
});

t('fix: env.untrack маха .env от индекса и го пази на диска', () => {
  const r = bid('fix', 'apply', 'env.untrack', '--project', trackedEnv, '--yes');
  assert(r.result.ok, r.result?.error);
  assert(!git(trackedEnv, 'ls-files').split('\n').includes('.env'), 'still tracked');
  assert(fs.existsSync(path.join(trackedEnv, '.env')), 'file deleted from disk!');
  assert(fs.readFileSync(path.join(trackedEnv, '.gitignore'), 'utf8').includes('.env'), 'not ignored');
});

t('issues: единен модел — .env в Git е blocker със safe fix, --recheck доказва поправката', () => {
  const dir = mk('issues-env', { 'index.html': HTML, '.env': 'SECRET=1\n' });
  bid('check', '--project', dir);
  const i = bid('issues', '--project', dir);
  assert(i.result.ok, i.result?.error);
  fixture('issues', i.data);
  const env = i.data.issues.find((x) => x.rule === 'trackedEnv');
  assert(env && env.severity === 'blocker' && env.kind === 'defect' && env.confidence === 'confirmed' && env.blocksRelease === true, JSON.stringify(env));
  assert(env.evidence.file === '.env' && env.fix.type === 'safe' && env.fix.id === 'env.untrack' && env.fix.risk === 'medium', JSON.stringify(env));
  assert(JSON.stringify(env.verify.steps) === '["secrets","git"]' && env.title && env.impact, 'verify + texts');
  assert(i.data.issues[0].severity === 'blocker', 'blockers come first');
  assert(i.data.counts.blocker >= 1 && i.data.counts.total === i.data.issues.length, JSON.stringify(i.data.counts));
  const fix = bid('fix', 'apply', 'env.untrack', '--project', dir, '--yes', '--recheck');
  assert(fix.result.ok, fix.result?.error);
  assert(fix.data.recheck && fix.data.recheck.verified === true && fix.data.recheck.unresolved.length === 0, JSON.stringify(fix.data.recheck));
  assert(fix.data.recheck.resolved.includes(env.id), 'the targeted issue is reported resolved');
  const after = bid('issues', '--project', dir);
  assert(!after.data.issues.some((x) => x.rule === 'trackedEnv'), 'issue gone after the verified fix');
  const st = bid('status', '--project', dir);
  assert(st.data.issues && Array.isArray(st.data.issues.issues) && st.data.release && st.data.release.capabilities.rollback === true, 'status carries issues + release capabilities');
});

t('issues: неуспешен build е blocker с AI поправка и доказателство от лога', () => {
  const i = bid('issues', '--project', failingBuild);
  const b = i.data.issues.find((x) => x.id === 'build.failed');
  assert(b && b.severity === 'blocker' && b.fix.type === 'ai' && b.fix.id === 'build' && b.evidence.log, JSON.stringify(b));
  assert(typeof b.evidence.detail === 'string' && b.evidence.detail.length > 0, 'log tail as evidence');
});

t('secrets: ключ в кода → fail с маскирана стойност', () => {
  const r = bid('check', '--project', secretInCode);
  const s = stepOf(r.data, 'secrets');
  assert(s.status === 'fail', s.status);
  const line = s.details.find((d) => d.includes('src/config.js:1'));
  assert(line && line.includes('Stripe'), JSON.stringify(s.details));
  assert(!line.includes('a1B2c3D4e5F6g7H8i9J0kLmN'), 'secret not masked');
});

t('no-git: fix list предлага git.init и gitignore.create', () => {
  const r = bid('fix', 'list', '--project', noGit);
  const ids = r.data.map((f) => f.id);
  assert(ids.includes('git.init') && ids.includes('gitignore.create'), ids.join(','));
});

t('fix: git.init + .gitignore', () => {
  const r = bid('fix', 'apply', 'git.init', '--project', noGit, '--yes');
  assert(r.result.ok, r.result?.error);
  assert(fs.existsSync(path.join(noGit, '.git')), 'no .git');
  assert(fs.existsSync(path.join(noGit, '.gitignore')), 'no .gitignore');
  const again = bid('fix', 'list', '--project', noGit).data.map((f) => f.id);
  assert(!again.includes('git.init') && !again.includes('gitignore.create'), again.join(','));
});

t('git: status показва промени, commit ги прибира', () => {
  fs.writeFileSync(path.join(staticSite, 'about.html'), HTML);
  const s = bid('git', 'status', '--project', staticSite);
  assert(s.data.changedCount === 1 && s.data.changed[0].path === 'about.html', JSON.stringify(s.data.changed));
  const c = bid('git', 'commit', '--project', staticSite, '--message', 'Add about page');
  assert(c.result.ok, c.result?.error);
  assert(c.data.changedCount === 0 && c.data.lastCommit.subject === 'Add about page', JSON.stringify(c.data.lastCommit));
});

t('git: commit само на избрани файлове', () => {
  fs.writeFileSync(path.join(staticSite, 'a.html'), HTML);
  fs.writeFileSync(path.join(staticSite, 'b.html'), HTML);
  const c = bid('git', 'commit', '--project', staticSite, '--message', 'only a', '--files-json', '["a.html"]');
  assert(c.result.ok, c.result?.error);
  assert(c.data.changed.some((f) => f.path === 'b.html') && !c.data.changed.some((f) => f.path === 'a.html'), JSON.stringify(c.data.changed));
});

t('git: файлове с кирилица и интервали — статус и commit само на тях (E11)', () => {
  const name = 'за нас.html';
  fs.writeFileSync(path.join(staticSite, name), HTML);
  fs.writeFileSync(path.join(staticSite, 'other.html'), HTML);
  const s = bid('git', 'status', '--project', staticSite);
  assert(s.data.changed.some((f) => f.path === name), JSON.stringify(s.data.changed));
  const c = bid('git', 'commit', '--project', staticSite, '--message', 'Cyrillic', '--files-json', JSON.stringify([name]));
  assert(c.result.ok, c.result?.error);
  assert(!c.data.changed.some((f) => f.path === name) && c.data.changed.some((f) => f.path === 'other.html'), JSON.stringify(c.data.changed));
});

t('git: push без remote → ясна грешка', () => {
  const r = bid('git', 'push', '--project', staticSite);
  assert(r.result.code === 'no_remote', r.result?.code);
});

t('git: remote → github URL се нормализира', () => {
  const r = bid('git', 'remote', '--project', staticSite, '--url', 'git@github.com:yavor/portfolio.git');
  assert(r.data.githubUrl === 'https://github.com/yavor/portfolio', r.data.githubUrl);
});

t('aifix: prompt с лога, скрити secrets, ChatGPT URL', () => {
  fs.appendFileSync(path.join(failingBuild, 'package.json'), '');
  const leak = mk('leaky-build', {
    'package.json': JSON.stringify({ name: 'leaky', scripts: { build: "node -e \"console.error('Error in src/app.js:3 token=abcdef1234567890 mail me@example.com sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456');process.exit(1)\"" } }),
    'src/app.js': 'const a = 1;\nconst b = 2;\nconst c = a + ;\n',
    'node_modules/.keep': '',
    '.gitignore': 'node_modules/\n',
  });
  bid('check', '--project', leak);
  const r = bid('aifix', '--project', leak, '--step', 'build', '--target', 'chatgpt');
  assert(r.result.ok, r.result?.error);
  const p = r.data.prompt;
  assert(p.includes('production build'), 'step name');
  assert(p.includes('Error in src/app.js'), 'log missing');
  assert(p.includes('src/app.js') && p.includes('const c = a + ;'), 'file context missing');
  assert(!p.includes('abcdef1234567890') && !p.includes('me@example.com') && !p.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'), 'secret leaked');
  assert(!p.includes(ENV.HOME) && !/\/Users\//.test(p), 'home path leaked');
  assert(r.data.url.startsWith('https://chatgpt.com/?q='), r.data.url.slice(0, 40));
  const c = bid('aifix', '--project', leak, '--step', 'build', '--target', 'claude');
  assert(c.data.url.startsWith('https://claude.ai/new?q='), 'claude url');
});

t('aifix: codex — без CLI ясна грешка, с CLI .command файл (независимо от машината)', () => {
  // PATH without any codex binary → missing_cli
  const noCodex = (process.env.PATH || '').split(':').filter((d) => d && !fs.existsSync(path.join(d, 'codex'))).join(':');
  const missing = bidEnv({ PATH: noCodex }, 'aifix', '--project', failingBuild, '--step', 'build', '--target', 'codex');
  assert(missing.result.code === 'missing_cli', JSON.stringify(missing.result));
  // a fake codex first in PATH → the command file is written (this path broke when the local `t` shadowed t())
  const fakeBin = path.join(TMP, 'fake-bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const ok = bidEnv({ PATH: `${fakeBin}:${noCodex}` }, 'aifix', '--project', failingBuild, '--step', 'build', '--target', 'codex');
  assert(ok.result.ok, JSON.stringify(ok.result));
  const cmd = fs.readFileSync(ok.data.commandFile, 'utf8');
  assert(cmd.includes('codex "$(cat') && cmd.includes('AI Fix (codex)'), cmd.slice(0, 300));
});

t('demo: примерен проект — създава се, добавя се, проверката минава с предупреждение за Git', () => {
  const r = bid('demo', 'create');
  assert(r.result.ok && r.data.created === true && r.data.path.endsWith(path.join('Before I Deploy Demo', 'demo-site')), JSON.stringify(r.result));
  const again = bid('demo', 'create');
  assert(again.data.created === false && again.data.key === r.data.key, 'idempotent');
  const c = bid('check', '--project', r.data.key);
  const st = (id) => c.data.steps.find((s) => s.id === id)?.status;
  assert(st('build') === 'pass' && st('git') === 'warn', JSON.stringify(c.data.steps.map((s) => [s.id, s.status])));
  assert(fs.existsSync(path.join(r.data.path, 'dist', 'index.html')), 'built');
  bid('project', 'remove', '--project', r.data.key);
});

// engine modules imported directly write only into the test sandbox
process.env.BID_APP_DIR = ENV.BID_APP_DIR;
process.env.BID_CACHE_DIR = ENV.BID_CACHE_DIR;
process.env.BID_NO_KEYCHAIN = '1';
const patchMod = await import(path.join(ROOT, 'engine', 'src', 'ai', 'patch.mjs'));
const aifixMod = await import(path.join(ROOT, 'engine', 'src', 'aifix.mjs'));
const hostingMod = await import(path.join(ROOT, 'engine', 'src', 'hosting.mjs'));

t('сигурност: AI промени не могат да пипнат .git, node_modules, .npmrc и workflows — и с друг регистър', () => {
  const dir = mk('safe-path', { 'src/app.js': 'x' });
  for (const bad of ['.GIT/config', '.git/hooks/pre-commit', 'Node_Modules/x/index.js', '.npmrc', 'sub/.NPMRC', '.github/workflows/ci.yml', '.Husky/pre-commit', '../x', '/etc/passwd']) {
    assert(patchMod.safePath(dir, bad) === null, 'must refuse ' + bad);
  }
  assert(patchMod.safePath(dir, 'src/app.js') === path.join(dir, 'src/app.js'), 'normal file allowed');
  assert(patchMod.safePath(dir, '.gitignore') !== null, '.gitignore is allowed');
});

t('ai apply: всичко или нищо — при грешка вече записаните файлове се връщат (E15)', () => {
  const dir = mk('apply-undo', { 'keep.txt': 'old' });
  fs.mkdirSync(path.join(dir, 'blocker'));
  const planned = [
    { path: 'keep.txt', action: 'edit', applicable: true, after: 'new' },
    { path: 'fresh.txt', action: 'create', applicable: true, after: 'x' },
    { path: 'blocker', action: 'edit', applicable: true, after: 'cannot write a folder' },
  ];
  let threw = false;
  try {
    patchMod.apply(dir, planned);
  } catch {
    threw = true;
  }
  assert(threw, 'the failing write is reported');
  assert(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8') === 'old', 'edited file restored');
  assert(!fs.existsSync(path.join(dir, 'fresh.txt')), 'created file removed');
});

t('сигурност: redaction маха ключове в JSON, Bearer, sb_secret, *_KEY=, пароли в URL', () => {
  const raw = [
    '{"apiKey": "abcd1234efgh5678"}',
    'Authorization: Bearer abcdefghijklmnop.qrstuv',
    'SUPABASE=sb_secret_ABCDEFGHIJKLMNOP12',
    'stripe sk_test_ABCDEFGHIJKL',
    'MY_SERVICE_KEY=hunter2hunter2',
    'DATABASE_URL=postgres://admin:s3cr3tpass@db.example.com:5432/app',
    "const password = 'correcthorse'",
  ].join('\n');
  const out = aifixMod.redact(raw);
  for (const secret of ['abcd1234efgh5678', 'abcdefghijklmnop', 'sb_secret_ABCDEFGHIJKLMNOP12', 'sk_test_ABCDEFGHIJKL', 'hunter2hunter2', 's3cr3tpass', 'correcthorse']) {
    assert(!out.includes(secret), 'leaked ' + secret + ' in: ' + out);
  }
  assert(out.includes('db.example.com'), 'keeps the non-secret part of the URL');
});

t('сигурност: публикуване от корена на проекта качва копие без dotfiles и node_modules', () => {
  const dir = mk('root-site', { 'index.html': '<h1>x</h1>', '.env': 'SECRET=1', '.git-keep/x': 'y', 'node_modules/a/i.js': '', 'img/logo.svg': '<svg/>', '.well-known/security.txt': 'x' });
  const out = hostingMod.stagePublicCopy(dir, '.');
  assert(out !== dir && fs.existsSync(path.join(out, 'index.html')) && fs.existsSync(path.join(out, 'img', 'logo.svg')), 'copied the site');
  for (const gone of ['.env', '.git-keep', 'node_modules']) assert(!fs.existsSync(path.join(out, gone)), gone + ' must not be published');
  assert(fs.existsSync(path.join(out, '.well-known', 'security.txt')), '.well-known stays');
  assert(hostingMod.stagePublicCopy(dir, 'dist') === 'dist', 'a build folder is published as it is');
});

t('сигурност: macOS Keychain — тайната минава през stdin и се чете обратно непроменена (само на Mac в CI)', () => {
  if (process.platform !== 'darwin' || !process.env.CI) return;
  const script = `import { setSecret, getSecret, deleteSecret } from ${JSON.stringify(path.join(ROOT, 'engine', 'src', 'secrets.mjs'))};
const v = { key: 'sk-test "quoted" \\\\ back\\\\slash ünicode ключ', n: 1 };
setSecret('bid-test-secret', v);
const back = getSecret('bid-test-secret');
deleteSecret('bid-test-secret');
if (JSON.stringify(back) !== JSON.stringify(v)) { console.error('mismatch', JSON.stringify(back)); process.exit(1); }`;
  const env = { ...process.env };
  delete env.BID_NO_KEYCHAIN;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
  assert(r.status === 0, r.stderr || r.stdout);
});

t('engine: никой не засенчва t() с локална променлива „t“', () => {
  const offenders = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.mjs')) { fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/\b(const|let|var)\s+t\s*=|\(\s*t\s*(,|\))\s*=>|\[\s*\w+\s*,\s*t\s*\]/.test(l)) offenders.push(`${path.relative(ROOT, p)}:${i + 1}`); }); } } };
  walk(path.join(ROOT, 'engine', 'src'));
  assert(offenders.length === 0, 'shadowing t(): ' + offenders.join(', '));
});

t('costs: AI fix се записва в ledger-а, има ценоразпис', () => {
  const r = bid('costs');
  assert(r.result.ok, r.result?.error);
  fixture('costs', r.data);
  assert(r.data.ledger.some((e) => e.op === 'aifix:build' && e.service === 'chatgpt'), 'ledger');
  assert(r.data.prices.items['netlify:production'].amount === 15, 'price table');
  assert(Array.isArray(r.data.usage.providers), 'usage');
});

t('setup: статус и защита без --yes', () => {
  const s = bid('setup', 'status');
  fixture('setup-status', s.data);
  assert(s.result.ok && s.data.items.some((i) => i.id === 'netlify-login'), 'items');
  const r = bid('setup', 'run', 'netlify-cli');
  assert(r.code === 2, `code ${r.code}`);
});

t('overview: карта за всеки проект + внимание', () => {
  const r = bid('overview', '--no-network');
  fixture('overview', r.data);
  assert(r.result.ok, r.result?.error);
  assert(r.data.cards.length >= 3, `${r.data.cards.length}`);
  assert(r.data.attention.some((a) => a.level === 'fail'), 'blocked project should need attention');
});

t('aifix: „всички проблеми“ включва грешки и предупреждения', () => {
  const r = bid('aifix', '--project', trackedEnv, '--step', 'all', '--target', 'copy');
  assert(r.result.ok, r.result?.error);
  assert(r.data.prompt.includes('senior full-stack'), 'special prompt');
  const none = bid('aifix', '--project', staticSite, '--step', 'all', '--target', 'copy');
  assert(none.result.code === 'nothing' || none.result.ok, 'nothing case');
});

// ---- Spaceship (mock API in a separate process)
import { spawn as spawnChild } from 'node:child_process';
const MOCK = path.join(TMP, 'mock-spaceship.cjs');
fs.writeFileSync(MOCK, `
const http=require('http');const port=Number(process.argv[2]);
const soon=new Date(Date.now()+10*86400000).toISOString();
let dns=[{type:'A',name:'@',address:'1.2.3.4',ttl:3600},{type:'TXT',name:'@',value:'v=spf1',ttl:3600}];
http.createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{
 if(q.headers['x-api-key']!=='K'||q.headers['x-api-secret']!=='S'){r.statusCode=401;return r.end('{}');}
 r.setHeader('content-type','application/json');
 if(q.url.startsWith('/domains'))return r.end(JSON.stringify({items:[{name:'moyat-sait.bg',autoRenew:false,expirationDate:soon,lifecycleStatus:'registered'}],total:1}));
 if(q.url.startsWith('/dns/records/')&&q.method==='GET')return r.end(JSON.stringify({items:dns,total:dns.length}));
 r.statusCode=204;r.end();});}).listen(port,'127.0.0.1',()=>console.log('up'));`);
const mockPort = 4300 + (process.pid % 400); // unique per run: a stale server from an interrupted run must not answer
const mock = spawnChild(process.execPath, [MOCK, String(mockPort)], { stdio: 'ignore', detached: true });
ENV.BID_SPACESHIP_BASE = `http://127.0.0.1:${mockPort}`;
spawnSync('sleep', ['0.6']);

t('spaceship: грешен ключ се отказва и не се запазва', () => {
  const r = spawnSync(BID, ['spaceship', 'connect'], { env: { ...ENV, BID_SPACESHIP_KEY: 'bad', BID_SPACESHIP_SECRET: 'x' }, encoding: 'utf8' });
  assert(/unauthorized/.test(r.stdout), r.stdout.slice(-200));
  const st = bid('spaceship', 'status');
  assert(st.data.connected === false, 'must not stay connected');
});

t('spaceship: свързване, домейни, изтичане, DNS', () => {
  const r = spawnSync(BID, ['spaceship', 'connect'], { env: { ...ENV, BID_SPACESHIP_KEY: 'K', BID_SPACESHIP_SECRET: 'S' }, encoding: 'utf8' });
  assert(/"ok":true/.test(r.stdout), r.stdout.slice(-300));
  const st = bid('spaceship', 'status', '--refresh');
  fixture('spaceship-status', st.data);
  assert(st.data.connected && st.data.domains[0].name === 'moyat-sait.bg', JSON.stringify(st.data).slice(0, 200));
  assert(st.data.domains[0].daysLeft <= 10, 'daysLeft');
  const dns = bid('spaceship', 'dns', '--domain', 'moyat-sait.bg');
  assert(dns.data.records.some((x) => x.type === 'A' && x.value === '1.2.3.4'), 'dns');
});

t('spaceship: план за свързване на домейн с Netlify (без промени)', () => {
  fs.mkdirSync(path.join(viteApp, '.netlify'), { recursive: true });
  fs.writeFileSync(path.join(viteApp, '.netlify', 'state.json'), JSON.stringify({ siteId: 'site-123' }));
  const lib = path.join(ENV.BID_APP_DIR, 'projects.json');
  const j = JSON.parse(fs.readFileSync(lib, 'utf8'));
  j.projects.find((p) => p.path === viteApp).netlify = { siteName: 'vite-app-demo' };
  fs.writeFileSync(lib, JSON.stringify(j));
  const r = bid('spaceship', 'connect-domain', '--project', viteApp, '--domain', 'moyat-sait.bg');
  assert(r.result.ok && r.data.applied === false, r.result?.error);
  assert(r.data.plan.add.some((a) => a.type === 'CNAME' && a.value === 'vite-app-demo.netlify.app'), 'cname');
  assert(r.data.plan.replace.some((x) => x.value === '1.2.3.4'), 'conflict detected');
});

t('overview: изтичащ домейн е в „внимание“', () => {
  const r = bid('overview');
  assert(r.data.attention.some((a) => a.text.includes('moyat-sait.bg')), JSON.stringify(r.data.attention));
  try { process.kill(-mock.pid); } catch {}
});

// ---- Account (mock Supabase)
const SB = path.join(TMP, 'mock-supabase.cjs');
fs.writeFileSync(SB, `
const http=require('http');const port=Number(process.argv[2]);const users={};let rows=[];
// v10: profiles (first signup = owner/admin), credit ledger, admin function, audit log; plus a fake Anthropic /v1/models
const profiles={};const ledger=[];const audit=[];
const tok=(e)=>({access_token:'AT-'+e,refresh_token:'RT-'+e,expires_in:3600,user:{id:'u-'+e,email:e,user_metadata:{full_name:'Test'},app_metadata:{provider:'email'}}});
const caller=(q)=>{const m=/^Bearer AT-(.+)$/.exec(q.headers.authorization||'');return m?profiles['u-'+m[1]]:null;};
const ANSWER='The build fails because src/app.js has a syntax error: a + ; is missing the right operand.\\n\\n<<<FILE src/app.js>>>\\n<<<<<<< SEARCH\\nconst c = a + ;\\n=======\\nconst c = a + b;\\n>>>>>>> REPLACE\\n<<<NEW FILE src/notes.txt>>>\\nfixed by ai\\n<<<END FILE>>>\\n<<<FILE ../outside.js>>>\\n<<<<<<< SEARCH\\nx\\n=======\\ny\\n>>>>>>> REPLACE\\n';
const ANSWER_PARTS=[ANSWER.slice(0,40),ANSWER.slice(40,120),ANSWER.slice(120)];
const balance=(id)=>ledger.filter(l=>l.user_id===id).reduce((a,l)=>a+l.delta,0);
http.createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{r.setHeader('content-type','application/json');
 if(q.url.startsWith('/deploys/')||q.url==='/'||/^\\/[a-z0-9-]+\\.html/.test(q.url)){let st={};try{st=JSON.parse(require('fs').readFileSync(process.argv[3],'utf8'));}catch{}const m=/^\\/deploys\\/([^/]+)(\\/.*)?$/.exec(q.url);let dir=null,rel=q.url;
  if(m){dir=(st.deploys||{})[m[1]]&&st.deploys[m[1]].dir;rel=m[2]||'/';}else{if(st.breakLive){r.statusCode=500;return r.end('broken');}dir=st.published&&st.deploys[st.published]&&st.deploys[st.published].dir;}
  if(!dir){r.statusCode=404;return r.end('no deploy');}const rp=rel.split('?')[0];const f=require('path').join(dir,rp==='/'?'index.html':rp);try{const body=require('fs').readFileSync(f);r.setHeader('content-type','text/html');return r.end(body);}catch(e){r.statusCode=404;return r.end('404');}}
 if(q.url.startsWith('/mon')){let st={};try{st=JSON.parse(require('fs').readFileSync(process.argv[3],'utf8'));}catch{}if(st.monDown){r.statusCode=503;return r.end('down');}r.setHeader('content-type','text/html');return r.end('<title>m</title>ok');}
 if(q.url==='/releases/latest.json'){const dmg='dmg-bytes';const sha=require('crypto').createHash('sha256').update(dmg).digest('hex');
   return r.end(JSON.stringify({version:'11.1.0',minVersion:'9.0.0',url:'http://127.0.0.1:'+port+'/releases/bid.dmg',sha256:sha,notes:{en:'Fixes',bg:'Поправки'},publishedAt:'2026-10-01T00:00:00Z',beta:{version:'11.2.0-beta.1',url:'http://127.0.0.1:'+port+'/releases/bid.dmg',sha256:sha}}));}
 if(q.url==='/releases/insecure.json'){return r.end(JSON.stringify({version:'99.0.0',url:'http://example.com/x.dmg',sha256:'a'.repeat(64)}));}
 if(q.url==='/releases/nosha.json'){return r.end(JSON.stringify({version:'99.0.0',url:'https://example.com/x.dmg'}));}
 if(q.url==='/releases/bid.dmg'){r.setHeader('content-type','application/octet-stream');return r.end('dmg-bytes');}
 if(q.url.startsWith('/v1/models')){if(q.headers['x-api-key']!=='sk-ant-good-key-123'){r.statusCode=401;return r.end('{}');}return r.end('{"data":[]}');}
 if(q.url==='/v1/messages'){if(q.headers['x-api-key']!=='sk-ant-good-key-123'){r.statusCode=401;return r.end('{"type":"error","error":{"message":"invalid x-api-key"}}');}
   r.setHeader('content-type','text/event-stream');const ev=(o)=>r.write('event: '+o.type+'\\ndata: '+JSON.stringify(o)+'\\n\\n');
   ev({type:'message_start',message:{model:'claude-sonnet-5',usage:{input_tokens:4500,output_tokens:1}}});ev({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
   for(const part of ANSWER_PARTS)ev({type:'content_block_delta',index:0,delta:{type:'text_delta',text:part}});
   ev({type:'content_block_stop',index:0});ev({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1500}});ev({type:'message_stop'});return r.end();}
 if(q.headers.apikey!=='ANON'){r.statusCode=401;return r.end('{"message":"no apikey"}');}
 const j=b?JSON.parse(b):{};
 if(q.url==='/functions/v1/ai-fix'){const me=caller(q);if(!me){r.statusCode=401;return r.end('{"error":"no session"}');}
   if(me.ai_disabled){r.statusCode=403;return r.end('{"error":"disabled","code":"disabled"}');}
   if(me.role==='normal'&&me.plan==='free'){r.statusCode=403;return r.end('{"error":"plan","code":"no_plan"}');}
   const bal=balance(me.user_id);if(bal<=0){r.statusCode=402;return r.end(JSON.stringify({error:'no credits',code:'quota_exhausted',renewsAt:'2026-10-01T00:00:00Z',balance:bal}));}
   if(!j.prompt||j.prompt.length>60000){r.statusCode=413;return r.end('{"error":"prompt"}');}
   r.setHeader('content-type','text/event-stream');const send=(o)=>r.write('data: '+JSON.stringify(o)+'\\n\\n');
   for(const part of ANSWER_PARTS)send({type:'delta',text:part});
   const charged=6000*(j.deep?5:1);ledger.push({user_id:me.user_id,delta:-charged,reason:'ai_fix'});
   send({type:'usage',input:4500,output:1500,model:'claude-sonnet-5',charged:charged,balance:balance(me.user_id)});send({type:'done'});return r.end();}
 if(q.url==='/functions/v1/billing'){const me=caller(q);if(!me){r.statusCode=401;return r.end('{"error":"no session"}');}
   const cat={currency:'EUR',plans:[{id:'flash',price:4.99,tokens:250000,available:true},{id:'high',price:9.99,tokens:1000000,available:true,yearlyPrice:95.9,yearlyAvailable:true},{id:'knight',price:19.99,tokens:2500000,available:false}],packs:[{id:'pack-500k',tokens:500000,price:4.99,available:true}],trial:{days:7,plan:'high',tokens:150000}};
   const st=()=>{const mine=ledger.filter(l=>l.user_id===me.user_id);const pl=mine.filter(l=>l.bucket==='plan').reduce((a,l)=>a+l.delta,0);const top=mine.filter(l=>l.bucket!=='plan').reduce((a,l)=>a+l.delta,0);
     return {plan:me.plan,subscription:me.trialEnds?{provider:'trial',tier:'high',status:'trial',renewsAt:null,endsAt:me.trialEnds,manageable:false}:null,balance:{plan:Math.max(0,pl),topup:Math.max(0,top),total:Math.max(0,pl+top)},trialAvailable:!me.trialEnds,usage:[{at:'2026-10-09T10:00:00Z',step:'build',model:'claude-sonnet-5',tokens:6000,project:'p1'}]};};
   if(j.action==='catalog')return r.end(JSON.stringify(cat));
   if(j.action==='status')return r.end(JSON.stringify(st()));
   if(j.action==='trial'){if(me.trialEnds){r.statusCode=409;return r.end('{"error":"used","code":"trial_used"}');}me.trialEnds='2026-10-17T12:00:00.000Z';me.plan='high';ledger.push({user_id:me.user_id,delta:150000,bucket:'plan',reason:'trial_grant'});return r.end(JSON.stringify(st()));}
   if(j.action==='checkout'){const it=cat.plans.find(x=>x.id===j.plan)||cat.packs.find(x=>x.id===j.pack);if(!it){r.statusCode=400;return r.end('{"error":"unknown"}');}if(!it.available){r.statusCode=409;return r.end('{"error":"x","code":"not_available"}');}return r.end(JSON.stringify({url:'https://pay.example/checkout?_ptxn=txn_'+(j.plan||j.pack)+(j.interval==='year'?'_year':''),transaction:'txn_1'}));}
   if(j.action==='portal'){r.statusCode=404;return r.end('{"error":"none","code":"no_subscription"}');}
   r.statusCode=400;return r.end('{"error":"unknown action"}');}
 if(q.url==='/functions/v1/account'){const me=caller(q);if(!me){r.statusCode=401;return r.end('{"error":"no session"}');}
   if(j.action==='export')return r.end(JSON.stringify({user:{id:me.user_id,email:me.email},profile:me,subscriptions:[],credit_ledger:ledger.filter(l=>l.user_id===me.user_id),ai_usage:[],projects:rows.filter(x=>x.user_id===me.user_id)}));
   if(j.action==='delete'){delete users[me.email];delete profiles[me.user_id];rows=rows.filter(x=>x.user_id!==me.user_id);audit.push({admin:me.user_id,action:'delete_me',target:me.user_id});return r.end('{"deleted":true}');}
   r.statusCode=400;return r.end('{"error":"unknown action"}');}
 if(q.url.startsWith('/rest/v1/settings')){if(!caller(q)){r.statusCode=401;return r.end('{}');}return r.end(JSON.stringify([{key:'plans',value:{flash:{tokens:250000},high:{tokens:1000000},knight:{tokens:2500000}}}]));}
 if(q.url.startsWith('/rest/v1/subscriptions')){const me=caller(q);if(!me){r.statusCode=401;return r.end('{}');}return r.end(JSON.stringify(me.plan!=='free'?[{provider:'manual',status:'active',period_end:'2026-11-01T00:00:00Z',cancel_at:null}]:[]));}
 if(q.url==='/auth/v1/settings'){return r.end('{"external":{"apple":false,"github":true,"google":false,"email":true}}');}
 if(q.url==='/auth/v1/signup'){if(users[j.email]){r.statusCode=400;return r.end('{"msg":"User already registered"}');}users[j.email]=j.password;
   profiles['u-'+j.email]={user_id:'u-'+j.email,email:j.email,role:Object.keys(profiles).length?'normal':'admin',plan:'free',locale:(j.data&&j.data.locale)||'en',ai_disabled:false,display_name:j.data&&j.data.full_name||null};
   return r.end(JSON.stringify(tok(j.email)));}
 if(q.url.startsWith('/rest/v1/profiles')){const me=caller(q);if(!me){r.statusCode=401;return r.end('{}');}
   const id=decodeURIComponent((/user_id=eq\.([^&]+)/.exec(q.url)||[])[1]||'');if(id!==me.user_id){return r.end('[]');}
   if(q.method==='PATCH'){if(j.locale)me.locale=j.locale;r.statusCode=204;return r.end();}
   return r.end(JSON.stringify([me]));}
 if(q.url.startsWith('/rest/v1/credit_balance')){const me=caller(q);if(!me){r.statusCode=401;return r.end('{}');}return r.end(JSON.stringify([{user_id:me.user_id,balance:balance(me.user_id)}]));}
 if(q.url==='/functions/v1/admin'){const me=caller(q);if(!me){r.statusCode=401;return r.end('{"error":"no session"}');}
   if(me.role!=='admin'){r.statusCode=403;return r.end('{"error":"admin only"}');}
   const t=profiles[j.user_id];audit.push({admin:me.user_id,action:j.action,target:j.user_id||null});
   if(j.action==='list_users')return r.end(JSON.stringify({users:Object.values(profiles).map(p=>({...p,balance:balance(p.user_id)}))}));
   if(j.action==='invite'){if(Object.values(profiles).some(p=>p.email===j.email)){r.statusCode=409;return r.end('{"error":"already registered","code":"invite_failed"}');}const id='u-'+j.email;profiles[id]={user_id:id,email:j.email,role:j.role||'vip',plan:'free',locale:j.locale||'en',ai_disabled:false,display_name:null};return r.end(JSON.stringify({user:{...profiles[id],balance:0}}));}
   if(j.action==='get_usage')return r.end(JSON.stringify({usage:[{id:'x1',user_id:j.user_id,created_at:'2026-10-09T10:00:00Z',step:'build',model:'claude-sonnet-5',input_tokens:4500,output_tokens:1500,charged_tokens:6000,status:'ok',project_key:'p1'}]}));
   if(j.action==='get_settings')return r.end(JSON.stringify({settings:{'ai.dailyCapPercent':15,'help.url':'https://example.com/help'}}));
   if(j.action==='set_settings')return r.end(JSON.stringify({saved:Object.keys(j.settings||{}).length}));
   if(!t&&j.action!=='audit_log'){r.statusCode=404;return r.end('{"error":"no such user"}');}
   if(j.action==='set_role'){t.role=j.role;return r.end(JSON.stringify({user:t}));}
   if(j.action==='set_plan_manual'){t.plan=j.plan;return r.end(JSON.stringify({user:t}));}
   if(j.action==='grant_credits'){ledger.push({user_id:t.user_id,delta:j.delta,reason:'admin_grant'});return r.end(JSON.stringify({balance:balance(t.user_id)}));}
   if(j.action==='disable_ai'){t.ai_disabled=!!j.disabled;return r.end(JSON.stringify({user:t}));}
   if(j.action==='audit_log')return r.end(JSON.stringify({entries:audit}));
   r.statusCode=400;return r.end('{"error":"unknown action"}');}
 if(q.url.startsWith('/auth/v1/token?grant_type=password')){if(users[j.email]!==j.password){r.statusCode=400;return r.end('{"error_description":"Invalid login credentials"}');}return r.end(JSON.stringify(tok(j.email)));}
 if(q.url==='/auth/v1/logout'){r.statusCode=204;return r.end();}
 if(q.url.startsWith('/rest/v1/bid_projects')){if(!/^Bearer AT-/.test(q.headers.authorization||'')){r.statusCode=401;return r.end('{}');}rows=JSON.parse(b);r.statusCode=201;return r.end();}
 r.statusCode=404;r.end('{}');});}).listen(port,'127.0.0.1');`);
const sbPort = 4800 + (process.pid % 400);
const FAKE_NETLIFY = path.join(TMP, 'fake-netlify.json');
const sb = spawnChild(process.execPath, [SB, String(sbPort), FAKE_NETLIFY], { stdio: 'ignore', detached: true });
ENV.BID_ANTHROPIC_API = `http://127.0.0.1:${sbPort}`;
spawnSync('sleep', ['0.6']);

t('cloud schema: engine-ът връща supabase/schema.sql', () => {
  const r = bid('cloud', 'schema');
  assert(r.data.sql && r.data.sql.includes('create table if not exists public.profiles'), 'schema missing');
  const f = bid('features', '--role', 'normal', '--plan', 'knight');
  assert(f.data['ai.cloud'] === true && f.data['ai.deep'] === true && f.data['projects.max'] === null, JSON.stringify(f.data));
});

t('акаунт: без облак → configured:false', () => {
  const r = bid('account', 'status');
  assert(r.data.configured === false, JSON.stringify(r.data));
});

t('акаунт: регистрация, вход, грешна парола, sync, изход', () => {
  try {
    const c = bid('cloud', 'config', '--url', `http://127.0.0.1:${sbPort}`, '--anon-key', 'ANON');
    assert(c.result.ok, c.result?.error);
    const s = bid('account', 'signup', '--email', 'yavor@example.com', '--password', 'supersecret1', '--name', 'Yavor');
    assert(s.data.loggedIn && s.data.email === 'yavor@example.com', JSON.stringify(s.data));
    const dup = bid('account', 'signup', '--email', 'yavor@example.com', '--password', 'supersecret1');
    assert(dup.result.key === 'account.auth.alreadyRegistered', JSON.stringify(dup.result));
    const weak = bid('account', 'signup', '--email', 'x@example.com', '--password', '123');
    assert(weak.result.code === 'weak_password' && weak.result.key === 'account.weakPassword', weak.result.code);
    bid('account', 'logout');
    assert(bid('account', 'status').data.loggedIn === false, 'still logged in');
    const anon = bid('account', 'status');
    assert(JSON.stringify(anon.data.providers) === '["github"]', 'providers from /auth/v1/settings: ' + JSON.stringify(anon.data));
    fixture('account-status-anon', anon.data);
    const bad = bid('account', 'login', '--email', 'yavor@example.com', '--password', 'wrong-pass');
    assert(bad.result.key === 'account.auth.invalidCredentials', JSON.stringify(bad.result));
    const badBg = bidEnv({ BID_LANG: 'bg' }, 'account', 'login', '--email', 'yavor@example.com', '--password', 'wrong-pass');
    assert(badBg.result.error === 'Грешен имейл или парола.', badBg.result.error);
    const good = bid('account', 'login', '--email', 'yavor@example.com', '--password', 'supersecret1');
    assert(good.data.loggedIn, 'login');
    fixture('account-status', good.data);
    assert(good.data.role === 'admin' && good.data.plan === 'free' && good.data.locale === 'en', JSON.stringify(good.data));
    assert(good.data.features['admin.panel'] === true && good.data.features['ai.ownKey'] === true && good.data.features['cloud.sync'] === true, JSON.stringify(good.data.features));
    const sync = bid('account', 'sync');
    assert(sync.result.ok && sync.data.synced >= 3, JSON.stringify(sync.result));
    const o = bid('account', 'oauth');
    assert(o.data.url.includes('/auth/v1/authorize?provider=github') && o.data.url.includes('beforeideploy'), o.data.url);

    // language → cloud profile
    const loc = bid('account', 'locale', '--set', 'bg');
    assert(loc.data.saved === true && bid('account', 'status').data.locale === 'bg', JSON.stringify(loc.result));

    // own AI key (vip/admin): rejected key is not stored, good key is verified and stored (masked in status)
    const badKey = spawnSync(BID, ['account', 'keys', 'set', '--provider', 'anthropic'], { env: { ...ENV, BID_AI_KEY: 'sk-ant-wrong' }, encoding: 'utf8' });
    assert(/"code":"unauthorized"/.test(badKey.stdout), badKey.stdout.slice(-200));
    assert(bid('account', 'keys', 'status').data.every((k) => !k.connected), 'bad key stored');
    const goodKey = spawnSync(BID, ['account', 'keys', 'set', '--provider', 'anthropic'], { env: { ...ENV, BID_AI_KEY: 'sk-ant-good-key-123' }, encoding: 'utf8' });
    assert(/"connected":true/.test(goodKey.stdout), goodKey.stdout.slice(-200));
    fixture('ai-keys', bid('account', 'keys', 'status').data);
    const ks = bid('account', 'keys', 'status').data.find((k) => k.provider === 'anthropic');
    assert(ks.connected && ks.hint && !ks.hint.includes('good-key'), JSON.stringify(ks));
    assert(!fs.readFileSync(path.join(ENV.BID_APP_DIR, 'profile.json'), 'utf8').includes('sk-ant'), 'key leaked into profile cache');
    assert(bid('account', 'status').data.features['ai.builtin'] === true, 'own key should enable built-in AI');
    bid('account', 'keys', 'delete', '--provider', 'anthropic');

    // admin panel: list users, roles, credits, audit; a normal user is refused
    const users = bid('admin', 'list_users');
    fixture('admin-users', users.data);
    assert(users.result.ok && users.data.users.length === 1, JSON.stringify(users.result));
    bid('account', 'logout');
    const friend = bid('account', 'signup', '--email', 'friend@example.com', '--password', 'supersecret2', '--name', 'Friend');
    assert(friend.data.role === 'normal' && friend.data.features['admin.panel'] === false && friend.data.features['cloud.sync'] === false, JSON.stringify(friend.data));
    assert(friend.data.features['projects.max'] === 2, 'free plan limit');
    const skipped = bid('account', 'sync');
    assert(skipped.result.ok && skipped.data.synced === 0 && skipped.data.skipped === 'plan', JSON.stringify(skipped.result));
    const refused = bid('admin', 'list_users');
    assert(refused.result.code === 'forbidden' && refused.result.key === 'admin.forbidden', JSON.stringify(refused.result));
    bid('account', 'logout');
    bid('account', 'login', '--email', 'yavor@example.com', '--password', 'supersecret1');
    const vip = bid('admin', 'set_role', '--user', 'u-friend@example.com', '--role', 'vip');
    assert(vip.result.ok && vip.data.user.role === 'vip', JSON.stringify(vip.result));
    const grant = bid('admin', 'grant_credits', '--user', 'u-friend@example.com', '--delta', '250000', '--reason', 'test');
    assert(grant.data.balance === 250000, JSON.stringify(grant.result));
    const log = bid('admin', 'audit_log');
    assert(log.data.entries.some((e) => e.action === 'set_role'), 'audit');
    bid('account', 'logout');
    const friend2 = bid('account', 'login', '--email', 'friend@example.com', '--password', 'supersecret2');
    assert(friend2.data.role === 'vip' && friend2.data.credits.balance === 250000 && friend2.data.features['ai.ownKey'] === true && friend2.data.features['cloud.sync'] === true, JSON.stringify(friend2.data));
    assert(bid('account', 'sync').data.synced >= 3, 'vip syncs');
    bid('account', 'logout');
    bid('account', 'login', '--email', 'yavor@example.com', '--password', 'supersecret1');
  } finally {
    // the mock stays up for the AI tests below; it is killed at exit
  }
});
process.on('exit', () => { try { process.kill(-sb.pid); } catch {} });

// ---- Built-in AI Fix (fake Anthropic + fake ai-fix function live in the mock Supabase server)
// node_modules/.keep: the deps step must pass so that only the build decides blocked/ready
t('check: lint и typecheck вървят паралелно, редът на стъпките се пази', () => {
  const slow = 'node -e "setTimeout(() => {}, 1500)"';
  const par = mk('parallel-app', { 'package.json': JSON.stringify({ name: 'parallel-app', scripts: { lint: slow, typecheck: slow } }), 'node_modules/.keep': '', 'index.html': '<h1>hi</h1>' });
  bid('project', 'add', '--path', par);
  const r = bid('check', '--project', par, '--force');
  assert(r.result.ok, r.result?.error);
  const ids = r.data.steps.map((x) => x.id);
  assert(ids.indexOf('lint') + 1 === ids.indexOf('typecheck'), 'order: ' + ids.join(','));
  const lint = r.data.steps.find((x) => x.id === 'lint');
  const tc = r.data.steps.find((x) => x.id === 'typecheck');
  assert(lint.status === 'pass' && tc.status === 'pass', `${lint.status}/${tc.status}`);
  assert(lint.duration >= 1.4 && tc.duration >= 1.4, 'each step waited');
  assert(r.data.duration < lint.duration + tc.duration - 0.8, `ran in parallel: total ${r.data.duration}s vs ${lint.duration}+${tc.duration}`);
});

const aiFixture = { 'package.json': JSON.stringify({ name: 'ai-app', scripts: { build: 'node src/app.js' } }), 'node_modules/.keep': '', 'src/app.js': 'const a = 1;\nconst b = 2;\nconst c = a + ;\nconsole.log(c);\n' };
const aiApp = mk('ai-app', aiFixture);

// ---- Releases (V11): fake Netlify CLI on PATH + the sandbox server serves the "deployed" files
const FAKE_BIN = path.join(TMP, 'bin');
fs.mkdirSync(FAKE_BIN, { recursive: true });
fs.writeFileSync(path.join(FAKE_BIN, 'netlify'), `#!/usr/bin/env node
const fs=require('fs'),path=require('path');const STATE=process.env.FAKE_NETLIFY_STATE;const PORT=process.env.FAKE_NETLIFY_PORT;const live='http://127.0.0.1:'+PORT+'/';
const load=()=>{try{return JSON.parse(fs.readFileSync(STATE,'utf8'));}catch{return {deploys:{},published:null,n:0};}};const save=(s)=>fs.writeFileSync(STATE,JSON.stringify(s));
const a=process.argv.slice(2);const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n');
if(a[0]==='deploy'){const s=load();s.n++;const id='dep-'+s.n;const di=a.indexOf('--dir');const dir=di>-1?path.resolve(a[di+1]):process.cwd();const prod=a.includes('--prod');
 s.deploys[id]={id,dir,state:'ready',context:prod?'production':'deploy-preview',created_at:new Date(Date.now()+s.n).toISOString(),deploy_ssl_url:'http://127.0.0.1:'+PORT+'/deploys/'+id+'/'};
 if(prod){s.published=id;s.deploys[id].published_at=new Date().toISOString();}save(s);out({deploy_id:id,deploy_url:s.deploys[id].deploy_ssl_url,url:live,site_name:'rel-site',logs:'http://logs/'+id});process.exit(0);}
if(a[0]==='api'){const s=load();const data=JSON.parse(a[a.indexOf('--data')+1]||'{}');const m=a[1];
 if(m==='getSite'){out({id:data.site_id,name:'rel-site',ssl_url:live,url:live,published_deploy:s.published?{id:s.published,published_at:s.deploys[s.published].published_at}:null});process.exit(0);}
 if(m==='listSiteDeploys'){out(Object.values(s.deploys).sort((x,y)=>y.created_at.localeCompare(x.created_at)));process.exit(0);}
 if(m==='getDeploy'){const d=s.deploys[data.deploy_id];if(!d){process.stderr.write('not found');process.exit(1);}out(d);process.exit(0);}
 if(m==='restoreSiteDeploy'){if(s.failRestore){process.stderr.write('boom');process.exit(1);}const d=s.deploys[data.deploy_id];if(!d)process.exit(1);s.published=d.id;d.published_at=new Date().toISOString();d.context='production';save(s);out(d);process.exit(0);}
 if(m==='listAccountsForUser'){out([{slug:'team',name:'Team'}]);process.exit(0);}}
if(a[0]==='sites:list'){out([{id:'site-rel',name:'rel-site',ssl_url:live}]);process.exit(0);}
process.stderr.write('fake netlify: unsupported '+a.join(' '));process.exit(1);
`);
fs.chmodSync(path.join(FAKE_BIN, 'netlify'), 0o755);
fs.mkdirSync(path.join(ENV.HOME, '.config', 'netlify'), { recursive: true });
fs.writeFileSync(path.join(ENV.HOME, '.config', 'netlify', 'config.json'), JSON.stringify({ userId: 'u1', users: { u1: { auth: { token: 'fake' }, email: 'ops@example.com' } } }));
ENV.PATH = `${FAKE_BIN}:${ENV.PATH}`;
ENV.FAKE_NETLIFY_STATE = FAKE_NETLIFY;
ENV.FAKE_NETLIFY_PORT = String(sbPort);
const fakeState = () => JSON.parse(fs.readFileSync(FAKE_NETLIFY, 'utf8'));
const relSite = mk('rel-site', { 'index.html': HTML, '.netlify/state.json': '{"siteId":"site-rel"}', '.gitignore': '.netlify/\n.env\n' });
let relOp = null;

t('release: preview → smoke → чака потвърждение; op записът пази етапи, време и snapshot', () => {
  const r = bid('release', 'preview', '--project', relSite);
  assert(r.result.ok, r.result?.error + ' ' + r.stderr.slice(-300));
  fixture('release-preview', r.data);
  relOp = r.data;
  assert(relOp.state === 'awaiting_confirmation' && relOp.readyFor === 'production', relOp.state);
  assert(relOp.stages.map((s) => `${s.id}:${s.status}`).join() === 'check:pass,preview:pass,smoke:pass', JSON.stringify(relOp.stages));
  assert(relOp.stages.every((s) => s.startedAt && s.finishedAt), 'timestamps');
  assert(relOp.preview.url.includes('/deploys/dep-1/') && relOp.preview.deployId === 'dep-1', JSON.stringify(relOp.preview));
  assert(relOp.smoke.ok && relOp.smoke.checks[0].status === 200 && fs.existsSync(relOp.smoke.log), 'smoke');
  assert(relOp.snapshot.fingerprint && relOp.snapshot.artifact.hash && relOp.snapshot.artifact.files === 1, JSON.stringify(relOp.snapshot));
  assert(fakeState().published === null, 'a preview must not publish production');
  assert(r.events.some((e) => e.type === 'step' && e.id === 'release.smoke' && e.status === 'pass'), 'release step events');
});

t('release: промяна след preview → promote отказва (stale_release), нищо не е публикувано', () => {
  fs.writeFileSync(path.join(relSite, 'index.html'), HTML + '<!-- v2 -->');
  const r = bid('release', 'promote', '--project', relSite, '--op', relOp.id, '--confirm', 'DEPLOY');
  assert(r.code === 3 && r.result.code === 'stale_release' && ['release.artifactChanged', 'release.sourceChanged'].includes(r.result.key), JSON.stringify(r.result));
  assert(fakeState().published === null, 'must not publish');
  const st = bid('release', 'status', '--project', relSite);
  assert(st.data.ops.find((o) => o.id === relOp.id).state === 'stale', 'op marked stale');
});

t('release: без DEPLOY няма production; с DEPLOY публикува точно провереното preview и го проверява', () => {
  relOp = bid('release', 'preview', '--project', relSite).data;
  assert(relOp.preview.deployId === 'dep-2', relOp.preview.deployId);
  const no = bid('release', 'promote', '--project', relSite, '--op', relOp.id);
  assert(no.code === 2 && no.result.code === 'confirm_required', 'confirm required');
  const r = bid('release', 'promote', '--project', relSite, '--op', relOp.id, '--confirm', 'DEPLOY');
  assert(r.result.ok, r.result?.error + ' ' + r.stderr.slice(-300));
  fixture('release-promote', r.data);
  assert(r.data.state === 'succeeded', JSON.stringify(r.data.stages));
  assert(r.data.production.deployId === 'dep-2' && fakeState().published === 'dep-2', 'the smoke-tested deploy is the published one');
  assert(fakeState().n === 2, 'no new deploy was created for production');
  assert(r.data.verify.ok && r.data.confirmation.typed === 'DEPLOY' && r.data.actor === 'cli', 'verify + confirmation recorded');
  assert(r.data.rollback.available === false && r.data.rollback.reason === 'no_previous', JSON.stringify(r.data.rollback));
  const st = bid('status', '--project', relSite);
  assert(st.data.lastProd.deployId === 'dep-2' && st.data.release.lastOp === relOp.id && st.data.release.currentOp === null, JSON.stringify(st.data.release));
  const h = bid('history', '--project', relSite);
  assert(h.data.some((e) => e.kind === 'release' && e.status === 'ok'), 'history has the release');
});

t('release: повторен promote не публикува втори път', () => {
  const r = bid('release', 'promote', '--project', relSite, '--op', relOp.id, '--confirm', 'DEPLOY');
  assert(r.result.ok && r.data.state === 'succeeded' && fakeState().n === 2 && fakeState().published === 'dep-2', 'idempotent');
});

t('release: втори release прави rollback наличен; провалена проверка на production не е успех', () => {
  fs.writeFileSync(path.join(relSite, 'index.html'), HTML + '<!-- v3 -->');
  const op3 = bid('release', 'preview', '--project', relSite).data;
  const r3 = bid('release', 'promote', '--project', relSite, '--op', op3.id, '--confirm', 'DEPLOY');
  assert(r3.data.state === 'succeeded' && r3.data.rollback.available === true && r3.data.rollback.deployId === 'dep-2', JSON.stringify(r3.data.rollback));
  // production breaks right after publishing
  fs.writeFileSync(path.join(relSite, 'index.html'), HTML + '<!-- v4 -->');
  const op4 = bid('release', 'preview', '--project', relSite).data;
  fs.writeFileSync(FAKE_NETLIFY, JSON.stringify({ ...fakeState(), breakLive: true }));
  const r4 = bid('release', 'promote', '--project', relSite, '--op', op4.id, '--confirm', 'DEPLOY');
  assert(r4.result.ok && r4.data.state === 'verify_failed', r4.result?.error || r4.data.state);
  assert(r4.data.verify.ok === false && r4.data.stages.find((s) => s.id === 'verify').status === 'fail', 'verify stage failed');
  assert(r4.data.rollback.available === true && r4.data.rollback.deployId === 'dep-3' && r4.data.rollback.restores === 'files', JSON.stringify(r4.data.rollback));
  assert(bid('history', '--project', relSite).data.some((e) => e.kind === 'release' && e.status === 'fail'), 'failed verification is recorded as a failure');
  fs.writeFileSync(FAKE_NETLIFY, JSON.stringify({ ...fakeState(), breakLive: false }));
});

t('release: rollback иска ROLLBACK, връща предишния production deploy и го проверява', () => {
  const no = bid('release', 'rollback', '--project', relSite);
  assert(no.code === 2 && no.result.code === 'confirm_required', 'confirm');
  const r = bid('release', 'rollback', '--project', relSite, '--confirm', 'ROLLBACK');
  assert(r.result.ok && r.data.kind === 'rollback' && r.data.state === 'succeeded', JSON.stringify(r.result));
  assert(fakeState().published === 'dep-3' && r.data.production.deployId === 'dep-3', 'previous production restored');
  const st = bid('release', 'status', '--project', relSite);
  fixture('release-status', st.data);
  assert(st.data.capabilities.rollback === true && st.data.site.publishedDeployId === 'dep-3' && st.data.deploys.length >= 4, 'status');
  assert(st.data.rollback.available === true && st.data.rollback.deployId === 'dep-4', 'next rollback target is the deploy published before');
  assert(st.data.current === null, 'nothing awaiting confirmation');
});

t('release: заключване — паралелен release се отказва; умрял процес се отчита като прекъснат', () => {
  const lock = path.join(ENV.BID_APP_DIR, 'ops', `${bid('status', '--project', relSite).data.project.key}.lock`);
  fs.writeFileSync(lock, JSON.stringify({ op: 'release-other', pid: process.pid, at: new Date().toISOString() }));
  const r = bid('release', 'preview', '--project', relSite);
  assert(r.code === 3 && r.result.code === 'release_in_progress', JSON.stringify(r.result));
  const key = bid('status', '--project', relSite).data.project.key;
  const ghost = { id: 'release-ghost', kind: 'release', project: key, projectName: 'rel-site', provider: 'netlify', actor: 'cli', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), state: 'promoting', stages: [], log: [], preview: { deployId: 'dep-none' } };
  fs.writeFileSync(path.join(ENV.BID_APP_DIR, 'ops', 'release-ghost.json'), JSON.stringify(ghost));
  fs.writeFileSync(lock, JSON.stringify({ op: 'release-ghost', pid: 999999, at: new Date().toISOString() }));
  const st = bid('release', 'status', '--project', relSite);
  assert(st.data.ops.find((o) => o.id === 'release-ghost').state === 'interrupted', 'ghost op must not stay "promoting"');
  const again = bid('release', 'preview', '--project', relSite);
  assert(again.result.ok && again.data.state === 'awaiting_confirmation', 'a dead lock does not block: ' + again.result?.error);
  const cancel = bid('release', 'cancel', '--project', relSite, '--op', again.data.id);
  assert(cancel.result.ok && cancel.data.state === 'cancelled', 'cancel');
  assert(bid('release', 'promote', '--project', relSite, '--op', again.data.id, '--confirm', 'DEPLOY').result.code === 'release_not_ready', 'cancelled cannot be promoted');
});

t('release: грешка от хостинга при публикуване → failed, не succeeded', () => {
  fs.writeFileSync(path.join(relSite, 'index.html'), HTML + '<!-- v5 -->');
  const op = bid('release', 'preview', '--project', relSite).data;
  fs.writeFileSync(FAKE_NETLIFY, JSON.stringify({ ...fakeState(), failRestore: true }));
  const r = bid('release', 'promote', '--project', relSite, '--op', op.id, '--confirm', 'DEPLOY');
  assert(!r.result.ok && r.result.code === 'netlify_failed', JSON.stringify(r.result));
  assert(bid('release', 'status', '--project', relSite).data.ops.find((o) => o.id === op.id).state === 'failed', 'op failed');
  fs.writeFileSync(FAKE_NETLIFY, JSON.stringify({ ...fakeState(), failRestore: false }));
});

t('deploy --recheck-if-stale: остаряла проверка се подновява вместо да се откаже', () => {
  fs.writeFileSync(path.join(relSite, 'index.html'), HTML + '<!-- v6 -->');
  const r = bid('deploy', '--project', relSite, '--recheck-if-stale');
  assert(r.result.ok && r.data.url.includes('/deploys/'), JSON.stringify(r.result));
  assert(r.events.some((e) => e.type === 'step' && e.id === 'build'), 'a fresh check ran first');
});

t('ai: собствен ключ → patch, прилагане само с --yes, файл извън проекта се отхвърля', () => {
  const chk = bid('check', '--project', aiApp);
  assert(chk.data.status === 'blocked', 'fixture must fail to build');
  const none = bid('ai', 'fix', '--project', aiApp, '--step', 'build');
  assert(none.result.code === 'ai_unavailable' && none.result.key === 'ai.unavailable.noKey', JSON.stringify(none.result));
  spawnSync(BID, ['account', 'keys', 'set', '--provider', 'anthropic'], { env: { ...ENV, BID_AI_KEY: 'sk-ant-good-key-123' }, encoding: 'utf8' });
  const fix = bid('ai', 'fix', '--project', aiApp, '--step', 'build');
  assert(fix.result.ok, fix.result?.error + ' ' + fix.stderr);
  fixture('ai-fix', fix.data);
  assert(fix.data.provider === 'anthropic' && fix.data.usage.input === 4500 && fix.data.usage.output === 1500, JSON.stringify(fix.data.usage));
  assert(fix.events.filter((e) => e.type === 'ai' && e.delta).length >= 3, 'streamed ai events');
  assert(fix.events.some((e) => e.type === 'step' && e.id === 'ai' && e.status === 'pass'), 'ai step event');
  const app = fix.data.files.find((f) => f.path === 'src/app.js');
  assert(app && app.applicable && app.additions === 1 && app.deletions === 1 && app.diff.includes('+const c = a + b;'), JSON.stringify(app));
  assert(fix.data.files.find((f) => f.path === '../outside.js').error === 'outside_project', 'outside file must be rejected');
  assert(fix.data.files.find((f) => f.path === 'src/notes.txt').applicable === true, 'new file');
  assert(fix.data.explanation.includes('syntax error'), 'explanation');
  const noYes = bid('ai', 'apply', '--project', aiApp, '--patch-file', fix.data.patchFile);
  assert(noYes.result.code === 'confirm_required', 'apply without --yes must refuse');
  assert(fs.readFileSync(path.join(aiApp, 'src/app.js'), 'utf8').includes('a + ;'), 'file changed without --yes');
  const foreign = bid('ai', 'apply', '--project', viteApp, '--patch-file', fix.data.patchFile, '--yes');
  assert(foreign.result.code === 'bad_patch', 'a patch for another project must be refused');
  const applied = bid('ai', 'apply', '--project', aiApp, '--patch-file', fix.data.patchFile, '--files', 'src/app.js', '--yes', '--commit');
  assert(applied.result.ok && applied.data.applied.join() === 'src/app.js', JSON.stringify(applied.result));
  assert(applied.data.skipped.some((x) => x.path === '../outside.js' && x.reason === 'outside_project'), JSON.stringify(applied.data.skipped));
  assert(fs.readFileSync(path.join(aiApp, 'src/app.js'), 'utf8').includes('const c = a + b;'), 'edit applied');
  assert(!fs.existsSync(path.join(aiApp, 'src/notes.txt')), 'unselected file must not be created');
  assert(/AI fix \(build\)/.test(git(aiApp, 'log', '-1', '--format=%s')), 'commit');
  assert(bid('check', '--project', aiApp).data.status !== 'blocked', 'build passes after the fix');
  const usage = bid('ai', 'usage');
  assert(usage.data.local.tokens >= 6000 && usage.data.local.byProvider.anthropic, JSON.stringify(usage.data.local));
  const explain = bid('ai', 'explain', '--project', aiApp, '--step', 'build');
  assert(explain.result.ok && explain.data.mode === 'explain' && explain.data.explanation.length > 10, JSON.stringify(explain.result));
  bid('account', 'keys', 'delete', '--provider', 'anthropic');
});

t('ai: undo връща файловете от последната поправка; повторното прилагане с --recheck доказва резултата', () => {
  const undo = bid('ai', 'undo', '--project', aiApp, '--yes');
  assert(undo.result.ok && undo.data.restored.join() === 'src/app.js', JSON.stringify(undo.result));
  assert(fs.readFileSync(path.join(aiApp, 'src/app.js'), 'utf8').includes('a + ;'), 'file not restored');
  assert(bid('ai', 'undo', '--project', aiApp, '--yes').result.code === 'nothing', 'a second undo has nothing to do');
  const st = bid('status', '--project', aiApp);
  const patchFile = fs.readdirSync(path.dirname(st.data.check.steps.find((x) => x.id === 'build').log)).filter((f) => /^ai-patch-/.test(f)).map((f) => path.join(path.dirname(st.data.check.steps.find((x) => x.id === 'build').log), f))[0];
  assert(patchFile, 'the patch file is still there (one file was skipped)');
  const again = bid('ai', 'apply', '--project', aiApp, '--patch-file', patchFile, '--files', 'src/app.js', '--yes', '--recheck');
  assert(again.result.ok && again.data.recheck && again.data.recheck.verified === true && again.data.recheck.stepStatus !== 'fail', JSON.stringify(again.data.recheck));
  // a file edited after the apply is left alone by undo
  fs.appendFileSync(path.join(aiApp, 'src/app.js'), '\n// user edit\n');
  const u2 = bid('ai', 'undo', '--project', aiApp, '--yes');
  assert(u2.data.restored.length === 0 && u2.data.skipped[0].reason === 'changed_since', JSON.stringify(u2.data));
});

t('ai: cloud път — план, кредити, quota_exhausted → exit 8, free → недостъпно', () => {
  const cloudApp = mk('ai-cloud-app', aiFixture);
  bid('project', 'add', '--path', cloudApp);
  assert(bid('check', '--project', cloudApp).data.status === 'blocked', 'fixture');
  bid('admin', 'set_role', '--user', 'u-friend@example.com', '--role', 'normal');
  bid('admin', 'set_plan_manual', '--user', 'u-friend@example.com', '--plan', 'high');
  const login = (email, pw) => { bid('account', 'logout'); return bid('account', 'login', '--email', email, '--password', pw); };
  const f = login('friend@example.com', 'supersecret2');
  assert(f.data.features['ai.cloud'] === true && f.data.credits.balance === 250000, JSON.stringify(f.data));
  assert(f.data.credits.monthlyGrant === 1000000 && f.data.credits.renewsAt === '2026-11-01T00:00:00Z', 'credits: ' + JSON.stringify(f.data.credits));
  fixture('account-status-high', f.data);
  const fix = bid('ai', 'fix', '--project', cloudApp, '--step', 'build');
  assert(fix.result.ok, fix.result?.error);
  assert(fix.data.provider === 'cloud' && fix.data.usage.charged === 6000 && fix.data.usage.balance === 244000, JSON.stringify(fix.data.usage));
  assert(bid('account', 'status').data.credits.balance === 244000, 'balance after fix');
  assert(fix.data.files.find((x) => x.path === 'src/app.js').applicable, 'cloud patch');
  const own = bid('ai', 'fix', '--project', cloudApp, '--step', 'build', '--provider', 'anthropic');
  assert(own.result.code === 'ai_unavailable' && own.result.key === 'ai.unavailable.ownKeyRole', JSON.stringify(own.result));
  login('yavor@example.com', 'supersecret1');
  bid('admin', 'grant_credits', '--user', 'u-friend@example.com', '--delta', '-244000', '--reason', 'test');
  login('friend@example.com', 'supersecret2');
  const out = bid('ai', 'fix', '--project', cloudApp, '--step', 'build');
  assert(out.code === 8 && out.result.code === 'quota_exhausted' && out.result.key === 'ai.quotaExhausted', JSON.stringify(out.result) + ' exit=' + out.code);
  login('yavor@example.com', 'supersecret1');
  bid('admin', 'set_plan_manual', '--user', 'u-friend@example.com', '--plan', 'free');
  login('friend@example.com', 'supersecret2');
  const free = bid('ai', 'fix', '--project', cloudApp, '--step', 'build');
  assert(free.result.code === 'ai_unavailable' && free.result.key === 'ai.unavailable.noPlan', JSON.stringify(free.result));
  login('yavor@example.com', 'supersecret1');
});

t('billing: каталог, статус, пробен период веднъж, checkout URL, неналичен план, портал', () => {
  const login = (email, pw) => { bid('account', 'logout'); return bid('account', 'login', '--email', email, '--password', pw); };
  login('friend@example.com', 'supersecret2');
  const cat = bid('billing', 'catalog');
  assert(cat.result.ok && cat.data.plans.length === 3 && cat.data.currency === 'EUR' && cat.data.trial.days === 7, JSON.stringify(cat.result));
  fixture('billing-catalog', cat.data);
  const st = bid('billing', 'status');
  assert(st.data.plan === 'free' && st.data.trialAvailable === true, JSON.stringify(st.data));
  const trial = bid('billing', 'trial');
  assert(trial.data.plan === 'high' && trial.data.balance.plan === 150000 && trial.data.subscription.provider === 'trial', JSON.stringify(trial.data));
  fixture('billing-status', trial.data);
  const again = bid('billing', 'trial');
  assert(again.result.code === 'billing_failed' && again.result.key === 'billing.trialUsed', JSON.stringify(again.result));
  const againBg = bidEnv({ BID_LANG: 'bg' }, 'billing', 'trial');
  assert(againBg.result.error === 'Безплатният пробен период вече е използван за този акаунт.', againBg.result.error);
  const co = bid('billing', 'checkout', '--plan', 'high');
  assert(co.data.url.startsWith('https://pay.example/checkout'), JSON.stringify(co.result));
  assert(bid('billing', 'checkout', '--pack', 'pack-500k').data.url.includes('pack-500k'), 'pack checkout');
  assert(bid('billing', 'checkout', '--plan', 'high', '--yearly').data.url.endsWith('high_year'), 'yearly checkout');
  const knight = bid('billing', 'checkout', '--plan', 'knight');
  assert(knight.result.key === 'billing.notAvailable', JSON.stringify(knight.result));
  const both = bid('billing', 'checkout');
  assert(both.code === 2 && both.result.key === 'billing.checkoutArgs', JSON.stringify(both.result));
  assert(bid('billing', 'portal').result.key === 'billing.noSubscription', 'portal without subscription');
  assert(bid('billing', 'refund').code === 2, 'unknown action');
  login('yavor@example.com', 'supersecret1');
  bid('admin', 'set_plan_manual', '--user', 'u-friend@example.com', '--plan', 'free');
  bid('account', 'logout');
  assert(bid('billing', 'status').result.code === 'not_logged_in', 'needs a session');
  login('yavor@example.com', 'supersecret1');
  // admin: invite a VIP, per-user AI usage, global settings
  const inv = bid('admin', 'invite', '--email', 'vip.friend@example.com', '--role', 'vip', '--locale', 'bg');
  assert(inv.data.user.role === 'vip' && inv.data.user.locale === 'bg', JSON.stringify(inv.result));
  const dupInv = bid('admin', 'invite', '--email', 'vip.friend@example.com');
  assert(dupInv.result.code === 'admin_failed', JSON.stringify(dupInv.result));
  const usage = bid('admin', 'get_usage', '--user', 'u-friend@example.com');
  assert(usage.data.usage[0].charged_tokens === 6000, JSON.stringify(usage.result));
  fixture('admin-usage', usage.data);
  const settings = bid('admin', 'get_settings');
  assert(settings.data.settings['ai.dailyCapPercent'] === 15, JSON.stringify(settings.result));
  const saved = bid('admin', 'set_settings', '--json', JSON.stringify({ settings: { 'help.url': 'https://example.com/help/errors' } }));
  assert(saved.data.saved === 1, JSON.stringify(saved.result));
});

t('update: latest.json → налична версия, beta канал, изтегляне със sha256; без feed → configured:false', () => {
  const feed = `http://127.0.0.1:${sbPort}/releases/latest.json`;
  const none = bidEnv({ BID_UPDATE_URL: '' }, 'update', 'check');
  assert(none.data.configured === false && none.data.available === false, JSON.stringify(none.data));
  const r = bidEnv({ BID_UPDATE_URL: feed }, 'update', 'check');
  fixture('update-check', r.data);
  assert(r.result.ok && r.data.current === fs.readFileSync(path.join(ROOT, 'engine', 'VERSION'), 'utf8').trim() && r.data.latest === '11.1.0' && r.data.available === true && r.data.mandatory === false, JSON.stringify(r.data));
  assert(r.data.notes.bg === 'Поправки', 'notes');
  const cached = bidEnv({ BID_UPDATE_URL: feed }, 'update', 'check');
  assert(cached.data.fromCache === true, 'second check should use the 6h cache');
  const beta = bidEnv({ BID_UPDATE_URL: feed }, 'update', 'check', '--channel', 'beta');
  assert(beta.data.latest === '11.2.0-beta.1' && beta.data.available === true, JSON.stringify(beta.data));
  const dl = bidEnv({ BID_UPDATE_URL: feed }, 'update', 'download');
  assert(dl.result.ok && fs.existsSync(dl.data.path) && fs.readFileSync(dl.data.path, 'utf8') === 'dmg-bytes', JSON.stringify(dl.result));
  assert(dl.data.path.startsWith(path.join(ENV.HOME, 'Downloads')), 'must land in ~/Downloads');
  for (const bad of ['insecure', 'nosha']) {
    const x = bidEnv({ BID_UPDATE_URL: `http://127.0.0.1:${sbPort}/releases/${bad}.json` }, 'update', 'download');
    assert(x.result.key === 'update.insecure', bad + ': ' + JSON.stringify(x.result));
  }
  // the app's own version decides (audit B5): an app already on 11.1.0 is up to date
  const same = bidEnv({ BID_UPDATE_URL: feed }, 'update', 'check', '--current', '11.1.0', '--force');
  assert(same.data.current === '11.1.0' && same.data.available === false, JSON.stringify(same.data));
});

t('logs & report: engine.log пази командите с маскирани пароли; докладът е без secrets', () => {
  const logs = bid('logs', '--tail', '400');
  assert(logs.data.entries.length > 20 && logs.data.entries.every((e) => e.cmd && typeof e.ms === 'number'), 'entries');
  const text = JSON.stringify(logs.data.entries);
  assert(text.includes('"signup"') && text.includes('***') && !text.includes('supersecret'), 'password must be masked in argv');
  assert(logs.data.entries.some((e) => e.ok === false && e.code), 'failed commands are logged with their code');
  fs.writeFileSync(path.join(ENV.BID_APP_DIR, 'logs', 'crash-2026-10-01-120000.txt'), 'Before I Deploy crashed: uncaught exception\nreason: user yavor@example.com\n');
  const rep = bid('report');
  assert(rep.data.files.includes('app-crash-2026-10-01-120000.txt'), 'app crash file in the report: ' + rep.data.files.join(','));
  assert(rep.result.ok && fs.existsSync(rep.data.path) && rep.data.files.includes('engine-log.ndjson') && rep.data.files.includes('doctor.json'), JSON.stringify(rep.result));
  const bundle = fs.readdirSync(rep.data.dir).map((f) => fs.readFileSync(path.join(rep.data.dir, f), 'utf8')).join('\n');
  assert(!bundle.includes('supersecret') && !bundle.includes('sk-ant-good-key-123') && !bundle.includes('yavor@example.com'), 'report leaks secrets or emails');
  assert(JSON.parse(fs.readFileSync(path.join(rep.data.dir, 'doctor.json'), 'utf8')).version === fs.readFileSync(path.join(ROOT, 'engine', 'VERSION'), 'utf8').trim(), 'doctor version');
});

t('акаунт: експорт на данните и изтриване с --confirm DELETE', () => {
  bid('account', 'logout');
  const gone = bid('account', 'signup', '--email', 'gone@example.com', '--password', 'supersecret3', '--name', 'Gone');
  assert(gone.data.loggedIn, JSON.stringify(gone.result));
  const exp = bid('account', 'export');
  assert(exp.result.ok && fs.existsSync(exp.data.path) && exp.data.path.startsWith(path.join(ENV.HOME, 'Downloads')), JSON.stringify(exp.result));
  const dump = JSON.parse(fs.readFileSync(exp.data.path, 'utf8'));
  assert(dump.user.email === 'gone@example.com' && Array.isArray(dump.projects) && dump.exportedAt, 'export content');
  const refused = bid('account', 'delete');
  assert(refused.result.code === 'confirm_required' && bid('account', 'status').data.loggedIn === true, 'delete without DELETE must refuse');
  const del = bid('account', 'delete', '--confirm', 'DELETE');
  assert(del.result.ok && del.data.deleted === true, JSON.stringify(del.result));
  assert(bid('account', 'status').data.loggedIn === false, 'session must be gone');
  const again = bid('account', 'login', '--email', 'gone@example.com', '--password', 'supersecret3');
  assert(again.result.ok === false, 'the user must not exist any more');
  bid('account', 'login', '--email', 'yavor@example.com', '--password', 'supersecret1');
});

t('хостинг: съветник — SSR изключва статичните хостинги', () => {
  const nextApp = mk('next-app', { 'package.json': JSON.stringify({ name: 'n', dependencies: { next: '15' }, scripts: { build: 'node -e 0' } }), 'node_modules/.keep': '' });
  const r = bid('hosting', 'advise', '--project', nextApp);
  fixture('hosting-advise', r.data);
  const cf = r.data.providers.find((p) => p.id === 'cloudflare');
  const gh = r.data.providers.find((p) => p.id === 'ghpages');
  assert(!cf.compatible && !gh.compatible, 'static hosts must be incompatible');
  assert(r.data.providers.find((p) => p.recommended).compatible, 'recommended must be compatible');
  const vc = r.data.providers.find((p) => p.id === 'vercel');
  assert(vc.reasons.some((x) => /Pro/.test(x)), 'vercel commercial note');
});

t('хостинг: смяна на доставчик и deploy без CLI → ясна грешка', () => {
  const s = bid('hosting', 'set', '--project', viteApp, '--provider', 'vercel');
  assert(s.data.hosting === 'vercel', 'set');
  bid('check', '--project', viteApp);
  const d = bid('deploy', '--project', viteApp);
  assert(['no_cli', 'not_logged_in', 'blocked'].includes(d.result.code), d.result.code + ' ' + d.result.error);
  const prod = bid('deploy', '--project', viteApp, '--prod');
  assert(prod.code === 2, 'prod without DEPLOY must fail');
  const bad = bid('hosting', 'set', '--project', viteApp, '--provider', 'nope');
  assert(bad.code === 2, 'unknown provider');
  bid('hosting', 'set', '--project', viteApp, '--provider', 'netlify');
  bid('check', '--project', viteApp);
});

async function httpGet(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', (e) => resolve({ status: 0, body: e.message }));
  });
}

const asyncTests = [];
function ta(name, fn) {
  asyncTests.push([name, fn]);
}

ta('правни линкове: облачните настройки печелят, cloud.json links е резервата (B6/R6)', async () => {
  const { publicLinks } = await import(path.join(ROOT, 'engine', 'src', 'account.mjs'));
  const l = publicLinks({ 'legal.privacy': 'https://x.test/privacy', 'support.email': 'help@x.test', 'legal.terms': '  ' });
  assert(l.privacy === 'https://x.test/privacy' && l.support === 'help@x.test', JSON.stringify(l));
  assert(l.terms === null && l.refund === null, 'blank or missing → null: ' + JSON.stringify(l));
  assert(JSON.stringify(Object.keys(publicLinks())) === '["privacy","terms","refund","support","help"]');
});

ta('local: start сервира dist, stop спира процеса', async () => {
  const s = bid('local', 'start', '--project', viteApp);
  assert(s.result.ok, s.result?.error);
  assert(s.data.running && s.data.port, 'not running');
  const res = await httpGet(s.data.url);
  assert(res.status === 200 && res.body.includes('built'), `http ${res.status}`);
  const deep = await httpGet(s.data.url + '/some/spa/route');
  assert(deep.status === 200, 'SPA fallback');
  const st = bid('local', 'status', '--project', viteApp);
  assert(st.data.running, 'status not running');
  const again = bid('local', 'start', '--project', viteApp);
  assert(again.data.pid === s.data.pid, 'second start should reuse the server');
  const stop = bid('local', 'stop', '--project', viteApp);
  assert(stop.data.stopped, 'not stopped');
  await new Promise((r) => setTimeout(r, 300));
  const after = await httpGet(s.data.url);
  assert(after.status === 0, 'server still answering');
  const p2 = bid('local', 'start', '--project', viteApp);
  assert(p2.data.port === s.data.port, `remembers last port (${p2.data.port} vs ${s.data.port})`);
  bid('local', 'stop', '--project', viteApp);
});

ta('local: сирак (сървър без state) се осиновява при start и спира със stop', async () => {
  const key = bid('project', 'list').data.find((p) => p.path === viteApp).key;
  // a static server left behind by a killed app: no state, but it answers with X-BID-Project
  const orphan = spawnChild(process.execPath, [path.join(ROOT, 'engine', 'src', 'static-server.cjs'), path.join(viteApp, 'dist'), '4180', key], { stdio: 'ignore', detached: true });
  orphan.unref();
  await new Promise((r) => setTimeout(r, 600));
  assert((await httpGet('http://127.0.0.1:4180')).status === 200, 'orphan not up');
  const s = bid('local', 'start', '--project', viteApp);
  assert(s.result.ok && s.data.running && s.data.port === 4180 && s.data.adopted === true, JSON.stringify(s.data));
  assert(bid('local', 'status', '--project', viteApp).data.port === 4180, 'status should show the adopted server');
  const stop = bid('local', 'stop', '--project', viteApp);
  assert(stop.data.stopped, JSON.stringify(stop.data));
  await new Promise((r) => setTimeout(r, 400));
  assert((await httpGet('http://127.0.0.1:4180')).status === 0, 'orphan still alive after stop');
  try { process.kill(orphan.pid); } catch {}
});

ta('сигурност: Local Preview не дава .env/.git, отказва чужд Host, спира само с тайния ключ', async () => {
  const dir = mk('dotfile-site', { 'index.html': '<h1>ok</h1>', '.env': 'SECRET=1', '.git/config': '[core]', '.well-known/security.txt': 'contact' }, { repo: false });
  const srv = spawnChild(process.execPath, [path.join(ROOT, 'engine', 'src', 'static-server.cjs'), dir, '4191', 'proj-key', 'secret-token'], { stdio: 'ignore', detached: true });
  srv.unref();
  await new Promise((r) => setTimeout(r, 600));
  const req = (p, { method = 'GET', headers = {} } = {}) => new Promise((resolve) => {
    const rq = http.request({ host: '127.0.0.1', port: 4191, path: p, method, headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    rq.on('error', () => resolve(0));
    rq.end();
  });
  try {
    assert((await req('/')) === 200, 'index');
    assert((await req('/.env')) === 404, '.env must not be served');
    assert((await req('/.git/config')) === 404, '.git must not be served');
    assert((await req('/%2e%65nv')) === 404, 'encoded .env');
    assert((await req('/.well-known/security.txt')) === 200, '.well-known allowed');
    assert((await req('/', { headers: { host: 'evil.example.com' } })) === 421, 'DNS rebinding host must be refused');
    assert((await req('/__bid__/stop', { method: 'DELETE', headers: { 'x-bid-key': 'proj-key' } })) === 403, 'the public project key must not stop it');
    assert((await req('/__bid__/stop', { method: 'DELETE', headers: { 'x-bid-key': 'secret-token' } })) === 200, 'the token stops it');
  } finally {
    try { process.kill(srv.pid); } catch {}
  }
});

ta('local: dev mode използва dev script', async () => {
  const devApp = mk('dev-app', {
    'package.json': JSON.stringify({
      name: 'dev-app',
      scripts: { dev: 'node server.js' },
    }),
    'server.js': "const port=process.env.PORT;require('http').createServer((q,s)=>s.end('dev '+port)).listen(port,'127.0.0.1')",
    'node_modules/.keep': '',
  });
  const s = bid('local', 'start', '--project', devApp, '--mode', 'dev');
  assert(s.result.ok, s.result?.error + ' ' + s.stderr);
  assert(s.data.mode === 'dev', s.data.mode);
  const res = await httpGet(s.data.url);
  assert(res.body.startsWith('dev'), res.body);
  const stop = bid('local', 'stop', '--project', devApp);
  assert(stop.data.stopped, 'dev not stopped');
  await new Promise((r) => setTimeout(r, 400));
  assert((await httpGet(s.data.url)).status === 0, 'dev server child still alive (process group kill failed)');
});

ta('monitor: потвърждава проблем след 2 неуспеха, обединява, отчита възстановяване; агентът иска --yes', async () => {
  const url = `http://127.0.0.1:${sbPort}/mon/`;
  const setDown = (down) => fs.writeFileSync(FAKE_NETLIFY, JSON.stringify({ ...fakeState(), monDown: down }));
  const site = mk('monitored-site', { 'index.html': HTML });
  bid('project', 'add', '--path', site);
  const key = bid('status', '--project', site).data.project.key;
  const lib = path.join(ENV.BID_APP_DIR, 'projects.json');
  const j = JSON.parse(fs.readFileSync(lib, 'utf8'));
  j.projects.find((p) => p.key === key).liveUrl = url;
  fs.writeFileSync(lib, JSON.stringify(j));
  const settings = bid('monitor', 'settings', '--json', '{"intervalMin":5,"timeoutMs":1500,"notify":{"down":true}}');
  assert(settings.data.intervalMin === 5 && settings.data.notify.down === true && settings.data.notify.ssl === true, JSON.stringify(settings.data));
  assert(bid('monitor', 'settings', '--json', '{"intervalMin":1}').result.code === 'usage', 'interval below 5 min refused');
  setDown(false);
  const ok1 = bid('monitor', 'once', '--project', site);
  assert(ok1.result.ok && ok1.data.samples[0].uptime.state === 'healthy' && ok1.data.events.length === 0, JSON.stringify(ok1.data));
  setDown(true);
  const f1 = bid('monitor', 'once', '--project', site);
  assert(f1.data.samples[0].uptime.state === 'problem' && f1.data.samples[0].failures === 1 && f1.data.events.length === 0, 'first failure is not an incident yet: ' + JSON.stringify(f1.data.samples[0]));
  assert(!f1.events.some((e) => e.type === 'notify'), 'no notification on a single blip');
  assert(f1.data.samples[0].uptime.attempts === 2, 'one bounded retry');
  const f2 = bid('monitor', 'once', '--project', site);
  assert(f2.data.events.some((e) => e.kind === 'down' && e.type === 'new'), 'second failure opens the incident: ' + JSON.stringify(f2.data.events));
  assert(f2.events.some((e) => e.type === 'notify'), 'notification on a confirmed problem');
  const f3 = bid('monitor', 'once', '--project', site);
  assert(f3.data.events.some((e) => e.kind === 'down' && e.type === 'ongoing') && !f3.events.some((e) => e.type === 'notify'), 'ongoing, no repeated notification');
  const st = bid('monitor', 'status');
  fixture('monitor-status', st.data);
  assert(st.data.runsOn === 'mac' && st.data.serverSide === false && st.data.openIncidents.length === 1 && st.data.openIncidents[0].count === 2, JSON.stringify(st.data.openIncidents));
  const ov = bid('overview', '--no-network');
  const card = ov.data.cards.find((c) => c.key === key);
  assert(card.signals.uptime.state === 'problem' && card.signals.uptime.source === 'monitor' && card.openIncidents === 1 && card.nextAction.id === 'investigate', JSON.stringify(card.signals) + JSON.stringify(card.nextAction));
  setDown(false);
  const r = bid('monitor', 'once', '--project', site);
  assert(r.data.events.some((e) => e.kind === 'down' && e.type === 'recovered'), 'recovery event');
  const inc = bid('monitor', 'incidents');
  assert(inc.data.length === 1 && inc.data[0].status === 'resolved' && inc.data[0].resolvedAt, JSON.stringify(inc.data));
  assert(bid('monitor', 'agent', 'install').result.code === 'confirm_required', 'agent needs --yes');
  if (process.platform !== 'darwin') assert(bid('monitor', 'agent', 'install', '--yes').result.code === 'unsupported', 'agent is macOS only');
});

ta('portfolio: клиент, сигнали с източник и време, „непроверено“ никога не е зелено, backup е честно несвързан', async () => {
  const site = mk('client-site', { 'index.html': HTML });
  bid('project', 'add', '--path', site);
  const c = bid('project', 'client', '--project', site, '--name', '  Bakery Ltd ');
  assert(c.result.ok && c.data.client === 'Bakery Ltd', JSON.stringify(c.result));
  assert(bid('project', 'client', '--project', site).result.code === 'usage', '--name required');
  const ov = bid('overview', '--no-network');
  fixture('overview', ov.data);
  const card = ov.data.cards.find((c) => c.name === 'client-site');
  assert(card.client === 'Bakery Ltd', 'client on the card');
  assert(card.signals.check.state === 'unchecked' && card.signals.uptime.state === 'unsupported' && card.signals.backup.state === 'unsupported', JSON.stringify(card.signals));
  assert(card.nextAction.id === 'check', JSON.stringify(card.nextAction));
  for (const s of Object.values(card.signals)) assert(['healthy', 'problem', 'unchecked', 'stale', 'unsupported'].includes(s.state), 'state vocabulary');
  bid('check', '--project', site);
  const ov2 = bid('overview', '--no-network');
  const card2 = ov2.data.cards.find((c) => c.name === 'client-site');
  assert(card2.signals.check.state === 'healthy' && card2.signals.check.source === 'check' && card2.signals.check.at, JSON.stringify(card2.signals.check));
  assert(card2.nextAction.id === 'connect-hosting', JSON.stringify(card2.nextAction));
  const b = bid('backup', 'status', '--project', site);
  fixture('backup-status', b.data);
  assert(b.data.connected === false && b.data.state === 'unsupported' && b.data.missing.length >= 2 && b.data.lastBackupAt === null, JSON.stringify(b.data));
  const st = bid('status', '--project', site);
  assert(st.data.backup && st.data.backup.connected === false, 'status carries the backup boundary');
});

ta('postdeploy: smoke checks — sitemap страници, 404 проваля, redirect извън сайта се отказва, timeout', async () => {
  const { smokeTest } = await import(path.join(ROOT, 'engine', 'src', 'postdeploy.mjs'));
  const srv = http.createServer((q, r) => {
    if (q.url === '/') return r.end('<!doctype html><title>Site</title>ok');
    if (q.url === '/sitemap.xml') return r.end(`<urlset><url><loc>http://127.0.0.1:${srv.address().port}/about</loc></url><url><loc>http://127.0.0.1:${srv.address().port}/missing</loc></url><url><loc>http://evil.example/x</loc></url></urlset>`);
    if (q.url === '/about') return r.end('<title>About</title>');
    if (q.url === '/off') { r.statusCode = 302; r.setHeader('location', 'http://evil.example/'); return r.end(); }
    if (q.url === '/slow') return setTimeout(() => r.end('late'), 3000);
    r.statusCode = 404; r.end('nope');
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const r = await smokeTest(base);
  assert(r.ok === false && r.checks.length === 3, JSON.stringify(r.checks));
  assert(r.checks[0].ok && r.checks.find((c) => c.url.endsWith('/about')).ok && r.checks.find((c) => c.url.endsWith('/missing')).reason === 'http 404', JSON.stringify(r.checks));
  assert(!r.checks.some((c) => c.url.includes('evil')), 'foreign sitemap entries are ignored');
  const off = await smokeTest(base, { paths: ['/off'], useSitemap: false });
  assert(off.checks[1].reason === 'redirect_offsite', JSON.stringify(off.checks[1]));
  const slow = await smokeTest(base, { paths: ['/slow'], useSitemap: false, timeoutMs: 500 });
  assert(slow.checks[1].reason === 'timeout', JSON.stringify(slow.checks[1]));
  srv.close();
});

ta('status: пълен snapshot за dashboard-а', async () => {
  const r = bid('status', '--project', viteApp);
  fixture('status', r.data);
  assert(r.result.ok, r.result?.error);
  for (const k of ['project', 'detect', 'git', 'local', 'check', 'netlifyAuth', 'fixes']) assert(k in r.data, `missing ${k}`);
  assert(r.data.check.status === 'ready', r.data.check.status);
  assert(Array.isArray(r.data.fixes) && r.data.detect.netlifyLinked === true, 'linked via state.json');
});

ta('history: записва проверките', async () => {
  const r = bid('history', '--limit', '100');
  fixture('history', r.data);
  assert(r.data.length >= 5, `only ${r.data.length}`);
  assert(r.data.some((e) => e.kind === 'check' && e.status === 'fail'), 'no failed check');
  const scoped = bid('history', '--project', failingBuild);
  assert(scoped.data.every((e) => e.projectName === 'failing-build'), 'scope');
});

for (const [name, fn] of asyncTests) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}\n     ${e.message}`);
  }
}

console.log(`\n${failed ? '❌' : '✅'} ${passed} passed, ${failed} failed\n`);
if (!failed) fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
