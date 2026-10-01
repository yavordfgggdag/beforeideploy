// Isolated setup regression tests: no real installation, login or cloud requests.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-setup-v12-'));
Object.assign(process.env, { BID_APP_DIR: path.join(tmp, 'app'), BID_CACHE_DIR: path.join(tmp, 'cache'), HOME: path.join(tmp, 'home'), BID_NO_KEYCHAIN: '1', BID_NO_BUNDLED_CLOUD: '1', BID_LANG: 'en' });
for (const name of ['home','bin']) fs.mkdirSync(path.join(tmp,name));
const originalPath = process.env.PATH;
const bin = path.join(tmp,'bin');
const script = (name, body) => fs.writeFileSync(path.join(bin,name), '#!/bin/sh\n'+body+'\n', { mode: 0o755 });
script('npm', 'echo 10.9.0');
script('netlify', 'exit 1');
process.env.PATH = bin;
const { setupStatus, setupStatusFull, setupAuto } = await import('../engine/src/setup.mjs');
const { setupLock, setupPreflight, installManaged, TOOLS_DIR } = await import('../engine/src/setup-tools.mjs');
after(() => { process.env.PATH = originalPath; fs.rmSync(tmp,{recursive:true,force:true}); });

test('Finder PATH: bundled engine exposes Node, npm and managed tools', () => {
  const engine=path.join(tmp,'engine'); fs.mkdirSync(engine);
  fs.copyFileSync(path.join(root,'engine/bid'),path.join(engine,'bid'));
  fs.mkdirSync(path.join(engine,'src'));
  fs.writeFileSync(path.join(engine,'src/bid.mjs'), 'console.log(JSON.stringify({runtime:process.env.BID_NODE_RUNTIME,path:process.env.PATH,version:process.version}))');
  const arch=spawnSync('/usr/bin/uname',['-m'],{encoding:'utf8'}).stdout.trim();
  const runtime=path.join(engine,'runtime',arch,'bin'); fs.mkdirSync(runtime,{recursive:true});
  fs.symlinkSync(process.execPath,path.join(runtime,'node'));
  const r=spawnSync('/bin/zsh',['-f',path.join(engine,'bid')],{env:{HOME:process.env.HOME,PATH:'/usr/bin:/bin',BID_APP_DIR:process.env.BID_APP_DIR},encoding:'utf8'});
  assert.equal(r.status,0,r.stderr); const data=JSON.parse(r.stdout);
  assert.equal(data.runtime,'bundled'); assert.equal(data.path.split(':')[0],path.join(TOOLS_DIR,'bin'));
  assert.equal(data.path.split(':').at(-1),fs.realpathSync(runtime));
});

test('status uses executing Node; broken CLI is not installed; Netlify alone does not require Git', async () => {
  const s=await setupStatus();
  assert.equal(s.items.find(i=>i.id==='node').ok,true);
  assert.equal(s.items.find(i=>i.id==='netlify-cli').ok,false);
  assert.equal(s.items.find(i=>i.id==='git').optional,true);
  assert.equal(s.items.find(i=>i.id==='gh-auth').optional,true);
  assert.equal(s.ready,false);
  assert.equal((await setupStatusFull()).items.some(i=>i.id.startsWith('cloud-')),false);
});

test('offline exits without attempting installs and gives every item a terminal state',async()=>{
  const s=await setupAuto({yes:true,preflight:async()=>{throw Object.assign(new Error('offline'),{code:'offline'});}});
  assert.equal(s.ok,false); assert.equal(s.code,'offline'); assert.deepEqual(s.installed,[]);
  assert.ok(s.steps.length>0 && s.steps.every(i=>i.status==='skipped'));
  assert.equal(fs.existsSync(path.join(process.env.BID_APP_DIR,'setup.lock')),false);
});

test('failed install is not success and dependent login is blocked',async()=>{
  const s=await setupAuto({yes:true,preflight:async()=>({})});
  assert.equal(s.ok,false); assert.equal(s.code,'setup_incomplete');
  assert.ok(s.failed.includes('netlify-cli')); assert.ok(s.blocked.includes('netlify-login'));
  assert.ok(s.steps.every(i=>['pass','fail','blocked','skipped'].includes(i.status)));
});

test('exclusive setup lock, fresh incomplete lock and dead-owner recovery',()=>{
  const release=setupLock(); assert.throws(()=>setupLock(),e=>e.code==='setup_busy'); release();
  const file=path.join(process.env.BID_APP_DIR,'setup.lock');
  fs.writeFileSync(file,''); assert.throws(()=>setupLock(),e=>e.code==='setup_busy'); fs.unlinkSync(file);
  fs.writeFileSync(file,JSON.stringify({pid:999999999})); setupLock()(); assert.equal(fs.existsSync(file),false);
});

test('managed install publishes only a verified tool and preserves the previous tool on failure',async()=>{
  let prefix;
  const run=async (cmd,args)=>{
    if(args[0]==='install') {
      assert.equal(args.includes('-g'),false); prefix=args[args.indexOf('--prefix')+1];
      assert.ok(prefix.startsWith(TOOLS_DIR)); fs.mkdirSync(path.join(prefix,'node_modules/.bin'),{recursive:true});
      fs.writeFileSync(path.join(prefix,'node_modules/.bin/netlify'),'#!/bin/sh\necho verified',{mode:0o755});
    }
    return {code:0,tail:['version']};
  };
  const installed=await installManaged('netlify-cli',{run}); const before=fs.readlinkSync(installed.path);
  assert.equal(fs.existsSync(installed.path),true); assert.equal(fs.existsSync(prefix),false);
  await assert.rejects(()=>installManaged('netlify-cli',{run:async()=>({code:1,tail:['ENOSPC']})}),e=>e.code==='install_failed');
  assert.equal(fs.readlinkSync(installed.path),before);
  assert.equal(fs.readdirSync(TOOLS_DIR).some(n=>n.startsWith('.staging-')),false);
});

test('preflight probes in parallel, denies service failure and insufficient disk',async()=>{
  const disk=()=>({bavail:2*1024**3,bsize:1}); let active=0,max=0;
  const probe=async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return {status:200};};
  await setupPreflight({disk,probe}); assert.equal(max,3);
  await assert.rejects(()=>setupPreflight({disk,probe:async()=>({status:503})}),e=>e.code==='offline');
  await assert.rejects(()=>setupPreflight({disk:()=>({bavail:1,bsize:1}),probe}),e=>e.code==='setup_disk_space');
});

// ---------------------------------------------------------------- V13 (docs/plan-v13/codex-setup-platform.md)

const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function waitFor(fn, ms = 10000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleepMs(50); } return false; }
const engineEnv = (dir, fake) => {
  const env = { PATH: `${fake}:/usr/bin:/bin`, HOME: path.join(dir, 'home'), BID_APP_DIR: path.join(dir, 'app'), BID_CACHE_DIR: path.join(dir, 'cache'), BID_NO_KEYCHAIN: '1', BID_NO_BUNDLED_CLOUD: '1', BID_LANG: 'en' };
  fs.mkdirSync(env.HOME, { recursive: true });
  return env;
};

test('B1: cancel kills the npm tree at once, cleans staging and reports cancelled well before the app SIGKILL', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'cancel-'));
  const fake = path.join(dir, 'bin'); fs.mkdirSync(fake);
  const pidFile = path.join(dir, 'npm.pid');
  // npm that ignores SIGTERM (as a hung install can): only SIGKILL of its process group stops it
  fs.writeFileSync(path.join(fake, 'npm'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 10.9.0; exit 0; fi\ntrap '' TERM\necho $$ > ${JSON.stringify(pidFile)}\nexec /bin/sleep 300\n`, { mode: 0o755 });
  const env = engineEnv(dir, fake);
  const child = spawn(process.execPath, [path.join(root, 'engine/src/bid.mjs'), 'setup', 'run', 'netlify-cli', '--yes'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => { out += d; });
  const exited = new Promise(r => child.on('close', code => r(code)));
  assert.ok(await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim()), 'fake npm started');
  const npmPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  const tools = path.join(env.BID_APP_DIR, 'tools');
  assert.ok(fs.readdirSync(tools).some(n => n.startsWith('.staging-')), 'staging exists while installing');
  const lock = JSON.parse(fs.readFileSync(path.join(env.BID_APP_DIR, 'setup.lock'), 'utf8'));
  assert.ok((lock.children || []).some(c => c.pid === npmPid), 'lock records the npm child for orphan recovery');
  const t0 = Date.now(); child.kill('SIGTERM');
  const code = await Promise.race([exited, sleepMs(7000).then(() => 'timeout')]);
  const took = Date.now() - t0;
  if (code === 'timeout') child.kill('SIGKILL');
  try { process.kill(-npmPid, 'SIGKILL'); } catch {}
  assert.equal(code, 130); assert.ok(took < 4500, `engine exited after ${took} ms (grace 1.5 s; the old 5 s grace lost to the app SIGKILL)`);
  assert.ok(/"code":"cancelled"/.test(out), 'cancelled result line');
  assert.equal(fs.readdirSync(tools).some(n => n.startsWith('.staging-')), false, 'staging removed');
  assert.equal(fs.existsSync(path.join(env.BID_APP_DIR, 'setup.lock')), false, 'lock released');
});

test('B1: lock recovery stops a dead owner\'s orphaned children and sweeps stale staging and temp links', async () => {
  const { pidStartTime } = await import('../engine/src/util.mjs');
  const orphan = spawn('/bin/sh', ['-c', 'trap "" TERM; exec /bin/sleep 300'], { detached: true, stdio: 'ignore' });
  const bystander = spawn('/bin/sleep', ['300'], { detached: true, stdio: 'ignore' });
  orphan.unref(); bystander.unref();
  assert.ok(await waitFor(() => pidStartTime(orphan.pid) !== null, 2000), 'ps works with a minimal PATH');
  const file = path.join(process.env.BID_APP_DIR, 'setup.lock');
  fs.mkdirSync(process.env.BID_APP_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid: 999999999, pidStart: 1, children: [{ pid: orphan.pid, pidStart: pidStartTime(orphan.pid) }, { pid: bystander.pid, pidStart: 1 }] }));
  const stale = path.join(TOOLS_DIR, '.staging-netlify-cli-old'); fs.mkdirSync(path.join(stale, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(TOOLS_DIR, 'bin'), { recursive: true });
  const tempLink = path.join(TOOLS_DIR, 'bin', 'netlify.0b8f4c2e-1111-4222-8333-123456789abc');
  fs.symlinkSync('/nonexistent', tempLink);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(stale, old, old); fs.lutimesSync(tempLink, old, old);
  const release = setupLock();
  try {
    const killed = await waitFor(() => orphan.signalCode === 'SIGKILL', 2000);
    const spared = alive(bystander.pid);
    for (const p of [orphan.pid, bystander.pid]) { try { process.kill(-p, 'SIGKILL'); } catch {} }
    assert.ok(killed, 'orphan killed');
    assert.ok(spared, 'a pid whose start time does not match is never killed');
    assert.equal(fs.existsSync(stale), false); assert.equal(fs.existsSync(tempLink), false);
  } finally { release(); }
});

test('B2: reinstalls keep only the active and the previous package folder', async () => {
  const fakeRun = async (cmd, args) => {
    if (args[0] === 'install') {
      const prefix = args[args.indexOf('--prefix') + 1];
      fs.mkdirSync(path.join(prefix, 'node_modules/.bin'), { recursive: true });
      fs.writeFileSync(path.join(prefix, 'node_modules/.bin/wrangler'), '#!/bin/sh\necho 4', { mode: 0o755 });
      fs.mkdirSync(path.join(prefix, '.npm-cache'), { recursive: true });
    }
    return { code: 0, tail: ['4'] };
  };
  const pkgs = path.join(TOOLS_DIR, 'pkgs');
  const other = path.join(pkgs, 'vercel-11111111-2222-4333-8444-555555555555'); fs.mkdirSync(other, { recursive: true });
  const ofId = () => fs.readdirSync(pkgs).filter(n => n.startsWith('wrangler-')).sort();
  for (let i = 0; i < 4; i++) await installManaged('wrangler', { run: fakeRun });
  const link = path.join(TOOLS_DIR, 'bin', 'wrangler');
  const active = path.relative(pkgs, fs.readlinkSync(link)).split(path.sep)[0];
  assert.equal(ofId().length, 2, ofId().join(','));
  assert.ok(ofId().includes(active));
  assert.equal(fs.existsSync(other), true, 'another tool is never pruned');
  assert.equal(fs.existsSync(path.join(pkgs, active, '.npm-cache')), false, 'per-install npm cache is not kept');
  // a failed install never prunes
  await assert.rejects(() => installManaged('wrangler', { run: async () => ({ code: 1, tail: ['x'] }) }));
  assert.equal(ofId().length, 2);
});

// B3 runs last: it adds a project, a working Netlify CLI, Git and a fake gh to the shared fixture.
test('B3: Netlify-only project with .git and no GitHub is not blocked by the Git identity', async () => {
  const realGit = spawnSync('/bin/sh', ['-c', 'command -v git'], { env: { PATH: originalPath }, encoding: 'utf8' }).stdout.trim();
  assert.ok(realGit, 'git is needed for this test');
  fs.symlinkSync(realGit, path.join(bin, 'git'));
  script('netlify', 'echo "netlify-cli/23.0.0"');
  const cfg = path.join(process.env.HOME, '.config', 'netlify'); fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'config.json'), JSON.stringify({ userId: 'u', users: { u: { email: 'a@b.c', auth: { token: 't' } } } }));
  const proj = path.join(tmp, 'site'); fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'index.html'), '<h1>x</h1>');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: proj }).status, 0);
  const { upsertProject } = await import('../engine/src/store.mjs');
  upsertProject(proj);
  const s = await setupStatus();
  const identity = s.items.find(i => i.id === 'git-identity');
  assert.equal(s.items.find(i => i.id === 'git').required, true, 'the project has .git');
  assert.equal(identity.ok, false); assert.equal(identity.required, false, 'no GitHub: identity is a recommendation');
  assert.equal(identity.action?.type, 'app', 'the in-app form is offered');
  const r = await setupAuto({ yes: true, preflight: async () => ({}) });
  assert.equal(r.ok, true, JSON.stringify(r.steps));
  // with --optional the identity step ends as a user step (the form), never as blocked on gh-auth
  const o = await setupAuto({ yes: true, includeOptional: true, preflight: async () => ({}) });
  const step = o.steps.find(x => x.id === 'git-identity');
  assert.equal(step.status, 'skipped'); assert.equal(step.reason, 'user_action');
  assert.equal(o.blocked.includes('git-identity'), false);
});

test('B3: a GitHub sign-in earlier in the same auto run lets Git identity come from GitHub', async () => {
  script('gh', [
    'M="$HOME/.gh-ok"',
    'case "$1 $2" in',
    '  "--version "*) echo "gh version 2.101.0"; exit 0;;',
    '  "auth token") [ -f "$M" ] && { echo tok; exit 0; }; exit 1;;',
    '  "auth login") : > "$M"; exit 0;;',
    '  "auth setup-git") exit 0;;',
    '  "api user") echo \'{"login":"octo","id":42,"name":"Octo Cat","email":null}\'; exit 0;;',
    'esac',
    'exit 1',
  ].join('\n'));
  const { listProjects, updateProject } = await import('../engine/src/store.mjs');
  updateProject(listProjects()[0].key, { hosting: 'ghpages' });
  const before = await setupStatus();
  assert.equal(before.items.find(i => i.id === 'gh-auth').ok, false);
  assert.equal(before.items.find(i => i.id === 'git-identity').required, true, 'GitHub Pages needs the identity');
  const r = await setupAuto({ yes: true, preflight: async () => ({}) });
  const st = id => r.steps.find(x => x.id === id)?.status;
  assert.equal(st('gh-auth'), 'pass'); assert.equal(st('git-identity'), 'pass', JSON.stringify(r.steps));
  assert.equal(r.ok, true, JSON.stringify(r));
  const name = spawnSync('git', ['config', '--global', 'user.name'], { encoding: 'utf8', env: process.env }).stdout.trim();
  assert.equal(name, 'Octo Cat');
});

test('B4: without the Command Line Tools the /usr/bin/git shim is never executed', async () => {
  const { gitProbe, gitBin } = await import('../engine/src/gitbin.mjs');
  const { detect } = await import('../engine/src/detect.mjs');
  const { fingerprint, scanSecrets } = await import('../engine/src/checks.mjs');
  const { gitStatus } = await import('../engine/src/git.mjs');
  const dir = fs.mkdtempSync(path.join(tmp, 'shim-'));
  const fake = path.join(dir, 'bin'); fs.mkdirSync(fake);
  const calls = path.join(dir, 'calls.log');
  // the shim: any run of it would pop the "install developer tools" dialog on a real Mac
  fs.writeFileSync(path.join(fake, 'git'), `#!/bin/sh\necho "$*" >> ${JSON.stringify(calls)}\nexit 1\n`, { mode: 0o755 });
  for (const n of ['npm', 'netlify']) fs.copyFileSync(path.join(bin, n), path.join(fake, n));
  const proj = path.join(dir, 'site'); fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'index.html'), '<h1>x</h1>');
  const saved = { ...gitProbe }, savedPath = process.env.PATH;
  Object.assign(gitProbe, { platform: 'darwin', shim: fs.realpathSync(path.join(fake, 'git')), toolsReady: () => false });
  process.env.PATH = fake;
  try {
    assert.equal(gitBin({ fresh: true }), null);
    const d = detect(proj);
    assert.equal(d.git.isRepo, false);
    fingerprint(proj, d); scanSecrets(proj, true);
    assert.equal(gitStatus(proj).installed, false);
    const s = await setupStatus();
    assert.equal(s.items.find(i => i.id === 'git').ok, false);
  } finally { Object.assign(gitProbe, saved); process.env.PATH = savedPath; gitBin({ fresh: true }); }
  assert.equal(fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '', '', 'the shim was executed');
});

test('B4: every Git spawn in the engine goes through gitbin.mjs', () => {
  const src = path.join(root, 'engine/src');
  const offenders = [];
  const walk = d => { for (const n of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, n.name);
    if (n.isDirectory()) walk(f);
    else if (/\.(mjs|cjs|js)$/.test(n.name) && n.name !== 'gitbin.mjs') {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/\b(sh|runStream|spawn|spawnSync|execFile|execFileSync|which)\(\s*['"`]git['"`]/.test(line)) offenders.push(`${path.relative(root, f)}:${i + 1}`);
      });
    }
  } };
  walk(src);
  assert.deepEqual(offenders, []);
});

test('B6: gh archive is checked against the sha256 in source, never against checksums.txt from the same origin', async () => {
  const { installGitHub, GH_RELEASE } = await import('../engine/src/setup-tools.mjs');
  for (const key of ['darwin-arm64', 'darwin-x64']) assert.match(GH_RELEASE.assets[key].sha256, /^[0-9a-f]{64}$/);
  const urls = [];
  const serve = (status, body) => async url => { urls.push(url); return new Response(body, { status }); };
  // a replaced asset (and a checksums.txt that would vouch for it) must not install
  await assert.rejects(() => installGitHub({ platformKey: 'darwin-arm64', fetch: serve(200, 'tampered zip') }), e => e.code === 'install_failed');
  assert.equal(urls.some(u => /checksums/.test(u)), false, 'checksums.txt is not fetched');
  assert.deepEqual(urls, [`https://github.com/cli/cli/releases/download/v${GH_RELEASE.version}/${GH_RELEASE.assets['darwin-arm64'].file}`]);
  // a 404 is a failed install, not "offline"; a network error is offline
  await assert.rejects(() => installGitHub({ platformKey: 'darwin-x64', fetch: serve(404, 'nope') }), e => e.code === 'install_failed');
  await assert.rejects(() => installGitHub({ platformKey: 'darwin-x64', fetch: async () => { throw new TypeError('fetch failed'); } }), e => e.code === 'offline');
  await assert.rejects(() => installGitHub({ platformKey: 'plan9-mips', fetch: serve(200, '') }), e => e.code === 'not_runnable');
  assert.equal(fs.readdirSync(TOOLS_DIR).some(n => n.startsWith('.staging-gh-')), false);
});
