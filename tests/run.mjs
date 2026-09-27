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
  assert(r.data.engine === '9.0.0', 'bad version');
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

t('i18n: всеки ключ в engine/src съществува в каталога, няма неизползвани', () => {
  const en = catalog('en');
  const src = path.join(ROOT, 'engine', 'src');
  const used = new Set();
  for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.mjs'))) {
    const text = fs.readFileSync(path.join(src, f), 'utf8');
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
  assert(stepOf(r.data, 'build').status === 'pass', JSON.stringify(stepOf(r.data, 'build')));
  assert(fs.existsSync(path.join(viteApp, 'dist', 'index.html')), 'no dist');
  assert(stepOf(r.data, 'lint').status === 'pass', 'lint');
  assert(stepOf(r.data, 'typecheck').status === 'pass', 'typecheck');
  assert(r.events.some((e) => e.type === 'log' && e.step === 'typecheck' && /types ok/.test(e.line)), 'no streamed log');
  assert(r.data.status === 'ready', `status=${r.data.status}`);
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

t('aifix: codex без инсталиран CLI → ясна грешка', () => {
  const r = bid('aifix', '--project', failingBuild, '--step', 'build', '--target', 'codex');
  if (r.result.ok) assert(fs.existsSync(r.data.commandFile), 'command file');
  else assert(r.result.code === 'missing_cli', r.result.code);
});

t('costs: AI fix се записва в ledger-а, има ценоразпис', () => {
  const r = bid('costs');
  assert(r.result.ok, r.result?.error);
  assert(r.data.ledger.some((e) => e.op === 'aifix:build' && e.service === 'chatgpt'), 'ledger');
  assert(r.data.prices.items['netlify:production'].amount === 15, 'price table');
  assert(Array.isArray(r.data.usage.providers), 'usage');
});

t('setup: статус и защита без --yes', () => {
  const s = bid('setup', 'status');
  assert(s.result.ok && s.data.items.some((i) => i.id === 'netlify-login'), 'items');
  const r = bid('setup', 'run', 'netlify-cli');
  assert(r.code === 2, `code ${r.code}`);
});

t('overview: карта за всеки проект + внимание', () => {
  const r = bid('overview', '--no-network');
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
const mockPort = 4799;
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
const tok=(e)=>({access_token:'AT-'+e,refresh_token:'RT-'+e,expires_in:3600,user:{id:'u-'+e,email:e,user_metadata:{full_name:'Test'},app_metadata:{provider:'email'}}});
http.createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{r.setHeader('content-type','application/json');
 if(q.headers.apikey!=='ANON'){r.statusCode=401;return r.end('{"message":"no apikey"}');}
 const j=b?JSON.parse(b):{};
 if(q.url==='/auth/v1/signup'){if(users[j.email]){r.statusCode=400;return r.end('{"msg":"User already registered"}');}users[j.email]=j.password;return r.end(JSON.stringify(tok(j.email)));}
 if(q.url.startsWith('/auth/v1/token?grant_type=password')){if(users[j.email]!==j.password){r.statusCode=400;return r.end('{"error_description":"Invalid login credentials"}');}return r.end(JSON.stringify(tok(j.email)));}
 if(q.url==='/auth/v1/logout'){r.statusCode=204;return r.end();}
 if(q.url.startsWith('/rest/v1/bid_projects')){if(!/^Bearer AT-/.test(q.headers.authorization||'')){r.statusCode=401;return r.end('{}');}rows=JSON.parse(b);r.statusCode=201;return r.end();}
 r.statusCode=404;r.end('{}');});}).listen(port,'127.0.0.1');`);
const sbPort = 4798;
const sb = spawnChild(process.execPath, [SB, String(sbPort)], { stdio: 'ignore', detached: true });
spawnSync('sleep', ['0.6']);

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
    const bad = bid('account', 'login', '--email', 'yavor@example.com', '--password', 'wrong-pass');
    assert(bad.result.key === 'account.auth.invalidCredentials', JSON.stringify(bad.result));
    const badBg = bidEnv({ BID_LANG: 'bg' }, 'account', 'login', '--email', 'yavor@example.com', '--password', 'wrong-pass');
    assert(badBg.result.error === 'Грешен имейл или парола.', badBg.result.error);
    const good = bid('account', 'login', '--email', 'yavor@example.com', '--password', 'supersecret1');
    assert(good.data.loggedIn, 'login');
    const sync = bid('account', 'sync');
    assert(sync.result.ok && sync.data.synced >= 3, JSON.stringify(sync.result));
    const o = bid('account', 'oauth');
    assert(o.data.url.includes('/auth/v1/authorize?provider=github') && o.data.url.includes('beforeideploy'), o.data.url);
  } finally {
    try { process.kill(-sb.pid); } catch {}
  }
});

t('хостинг: съветник — SSR изключва статичните хостинги', () => {
  const nextApp = mk('next-app', { 'package.json': JSON.stringify({ name: 'n', dependencies: { next: '15' }, scripts: { build: 'node -e 0' } }), 'node_modules/.keep': '' });
  const r = bid('hosting', 'advise', '--project', nextApp);
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

ta('status: пълен snapshot за dashboard-а', async () => {
  const r = bid('status', '--project', viteApp);
  assert(r.result.ok, r.result?.error);
  for (const k of ['project', 'detect', 'git', 'local', 'check', 'netlifyAuth', 'fixes']) assert(k in r.data, `missing ${k}`);
  assert(r.data.check.status === 'ready', r.data.check.status);
  assert(Array.isArray(r.data.fixes) && r.data.detect.netlifyLinked === true, 'linked via state.json');
});

ta('history: записва проверките', async () => {
  const r = bid('history', '--limit', '100');
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
