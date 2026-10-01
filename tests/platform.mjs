// Platform layer (engine/src/platform): folders, which/PATHEXT, cmd.exe quoting, process trees, PATH,
// runtime keys, terminal scripts, schedulers, release assets, secrets and bubblewrap. Every OS is simulated
// on any runner through the `platform` option; the last tests run the real thing on the current OS
// (Linux and Windows in .github/workflows/engine-cross.yml, macOS in engine-macos.yml).
//   node --test tests/platform.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-platform-'));
Object.assign(process.env, { BID_APP_DIR: path.join(tmp, 'app'), BID_CACHE_DIR: path.join(tmp, 'cache'), BID_NO_KEYCHAIN: '1', BID_LANG: 'en' });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const P = await import('../engine/src/platform/index.mjs');
const { win32, linux, darwin } = P;

// ---------------------------------------------------------------- folders

test('dirs: macOS unchanged, XDG on Linux, %APPDATA%/%LOCALAPPDATA% on Windows, overrides everywhere', () => {
  assert.deepEqual(P.dirs({ platform: 'darwin', env: {}, home: '/Users/a' }), {
    appDir: '/Users/a/Library/Application Support/BeforeIDeploy', cacheDir: '/Users/a/Library/Caches/BeforeIDeploy', configDir: '/Users/a/Library/Application Support/BeforeIDeploy',
  });
  assert.deepEqual(P.dirs({ platform: 'linux', env: {}, home: '/home/a' }), {
    appDir: '/home/a/.local/share/before-i-deploy', cacheDir: '/home/a/.cache/before-i-deploy', configDir: '/home/a/.config/before-i-deploy',
  });
  const xdg = P.dirs({ platform: 'linux', env: { XDG_DATA_HOME: '/d', XDG_CACHE_HOME: '/c', XDG_CONFIG_HOME: 'relative/ignored' }, home: '/home/a' });
  assert.deepEqual(xdg, { appDir: '/d/before-i-deploy', cacheDir: '/c/before-i-deploy', configDir: '/home/a/.config/before-i-deploy' });
  const w = P.dirs({ platform: 'win32', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, home: 'C:\\Users\\a' });
  assert.equal(w.appDir, 'C:\\Users\\a\\AppData\\Roaming\\BeforeIDeploy');
  assert.equal(w.cacheDir, 'C:\\Users\\a\\AppData\\Local\\BeforeIDeploy\\Cache');
  for (const platform of ['darwin', 'linux', 'win32']) {
    const o = P.dirs({ platform, env: { BID_APP_DIR: '/x/app', BID_CACHE_DIR: '/x/cache' }, home: '/h' });
    assert.equal(o.appDir, '/x/app'); assert.equal(o.cacheDir, '/x/cache');
  }
  assert.equal(P.platformOf('freebsd'), 'linux');
});

// ---------------------------------------------------------------- which

test('which: pure PATH walk; Windows PATHEXT order, Path spelling, quoted entries, no current folder', () => {
  const files = new Set(['C:\\tools\\npm.cmd', 'C:\\tools\\npm', 'C:\\Program Files\\nodejs\\node.exe', 'C:\\bin\\gh.exe', 'C:\\bin\\gh.cmd', 'C:\\x\\run.bat']);
  const fileOk = (f) => files.has(f);
  const env = { Path: 'C:\\tools;"C:\\Program Files\\nodejs";;C:\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  const w = (c) => P.which(c, { platform: 'win32', env, fileOk });
  assert.equal(w('npm'), 'C:\\tools\\npm.cmd', 'the extension-less sh shim npm also writes never matches on Windows');
  assert.equal(w('node'), 'C:\\Program Files\\nodejs\\node.exe');
  assert.equal(w('gh'), 'C:\\bin\\gh.exe', '.EXE before .CMD (PATHEXT order)');
  assert.equal(w('gh.cmd'), 'C:\\bin\\gh.cmd', 'an explicit extension is taken as is');
  assert.equal(w('C:\\x\\run'), 'C:\\x\\run.bat', 'a path is checked with PATHEXT too');
  assert.equal(w('missing'), null);
  assert.equal(P.which('npm', { platform: 'win32', env: { PATH: 'C:\\tools' }, fileOk }), 'C:\\tools\\npm.cmd', 'default PATHEXT');
  const posix = new Set(['/usr/bin/git', '/opt/x/tool']);
  const p = (c, PATH) => P.which(c, { platform: 'linux', env: { PATH }, fileOk: (f) => posix.has(f) });
  assert.equal(p('git', '/usr/local/bin::/usr/bin'), '/usr/bin/git');
  assert.equal(p('tool', ':'), null, 'an empty entry is not the current folder');
  assert.equal(p('/opt/x/tool', ''), '/opt/x/tool');
  assert.equal(p('', '/usr/bin'), null);
  // the real thing on this OS
  assert.equal(path.basename(P.which('node') || '').replace(/\.exe$/i, ''), 'node');
});

// ---------------------------------------------------------------- spawnSpec / cmd.exe quoting

test('spawnSpec: POSIX unchanged; Windows .cmd shims through cmd.exe /d /s /c with strict quoting', () => {
  assert.deepEqual(P.spawnSpec('npm', ['run', 'build'], { platform: 'darwin' }), { command: 'npm', args: ['run', 'build'], options: {} });
  assert.deepEqual(P.spawnSpec('npm', ['run'], { platform: 'linux' }), { command: 'npm', args: ['run'], options: {} });
  const resolve = (c) => ({ npm: 'C:\\Users\\a\\AppData\\Roaming\\npm\\npm.cmd', git: 'C:\\Program Files\\Git\\cmd\\git.exe', vite: 'C:\\p\\node_modules\\.bin\\vite.cmd' })[c] || null;
  const exe = P.spawnSpec('git', ['commit', '-m', 'a "b"'], { platform: 'win32', resolve });
  assert.deepEqual(exe, { command: 'C:\\Program Files\\Git\\cmd\\git.exe', args: ['commit', '-m', 'a "b"'], options: { windowsHide: true } }, '.exe: Node quotes it');
  const s = P.spawnSpec('npm', ['install', 'a b', 'x&y', '50%', 'q"t', 'tail\\'], { platform: 'win32', resolve, env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' } });
  assert.equal(s.command, 'C:\\Windows\\system32\\cmd.exe');
  assert.deepEqual(s.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(s.options.windowsVerbatimArguments, true);
  assert.equal(s.args[3], '"C:\\Users\\a\\AppData\\Roaming\\npm\\npm.cmd ^^^"install^^^" ^^^"a^^^ b^^^" ^^^"x^^^&y^^^" ^^^"50^^^%^^^" ^^^"q\\^^^"t^^^" ^^^"tail\\\\^^^""', 'batch files re-parse %*: carets twice');
  const dbl = P.spawnSpec('vite', ['a&b'], { platform: 'win32', resolve });
  assert.match(dbl.args[3], /\^\^\^"a\^\^\^&b\^\^\^"/, 'node_modules/.bin shims too');
  assert.deepEqual(P.spawnSpec('nothere', ['x'], { platform: 'win32', resolve }).command, 'nothere', 'unknown: spawn fails as before (ENOENT → 127)');
});

test('argvQuote follows the MSVCRT rules', () => {
  assert.equal(win32.argvQuote('plain'), '"plain"');
  assert.equal(win32.argvQuote('a b'), '"a b"');
  assert.equal(win32.argvQuote('say "hi"'), '"say \\"hi\\""');
  assert.equal(win32.argvQuote('C:\\dir\\'), '"C:\\dir\\\\"', 'a trailing backslash would escape the closing quote');
  assert.equal(win32.argvQuote('a\\"b'), '"a\\\\\\"b"', 'backslashes before a quote are doubled');
  assert.equal(win32.argvQuote(''), '""');
});

// ---------------------------------------------------------------- process trees

test('killTree: process group on POSIX, taskkill /T /F on Windows', () => {
  const calls = [];
  const run = (cmd, args) => { calls.push([cmd, ...args]); return { status: 0 }; };
  assert.equal(P.killTree(4242, 'SIGTERM', { platform: 'win32', run }), true);
  assert.deepEqual(calls, [['taskkill', '/T', '/F', '/PID', '4242']]);
  assert.equal(P.killTree(0), false);
  assert.deepEqual(P.groupOptions('darwin'), { detached: true });
  assert.deepEqual(P.groupOptions('linux'), { detached: true });
  assert.deepEqual(P.groupOptions('win32'), { windowsHide: true }, 'no new console on Windows');
});

// ---------------------------------------------------------------- runtime + PATH

test('runtime folder key comes from Node (arm64, never aarch64); macOS keeps its older folders', () => {
  assert.equal(P.runtimeKey('linux', 'arm64'), 'linux-arm64');
  assert.equal(P.runtimeKey('win32', 'x64'), 'win32-x64');
  assert.deepEqual(P.runtimeDirs('/e', { platform: 'darwin', arch: 'x64' }), ['/e/runtime/darwin-x64', '/e/runtime/x86_64']);
  assert.deepEqual(P.runtimeDirs('/e', { platform: 'darwin', arch: 'arm64' }), ['/e/runtime/darwin-arm64', '/e/runtime/arm64']);
  assert.deepEqual(P.runtimeDirs('/e', { platform: 'linux', arch: 'arm64' }), ['/e/runtime/linux-arm64']);
  const has = new Set(['C:\\e\\runtime\\win32-x64\\node.exe']);
  assert.deepEqual(P.bundledRuntime('C:\\e', { platform: 'win32', arch: 'x64', exists: (f) => has.has(f) }), { dir: 'C:\\e\\runtime\\win32-x64', bin: 'C:\\e\\runtime\\win32-x64' });
  assert.equal(P.runtimeNpmCli('C:\\e\\runtime\\win32-x64', 'win32'), 'C:\\e\\runtime\\win32-x64\\node_modules\\npm\\bin\\npm-cli.js');
  assert.equal(P.runtimeNpmCli('/e/runtime/linux-x64', 'linux'), '/e/runtime/linux-x64/lib/node_modules/npm/bin/npm-cli.js');
});

test('buildPath: managed tools first, the user PATH, install places, bundled runtime last — on every OS', () => {
  const exists = (f) => f === '/e/runtime/darwin-arm64/bin/node' || f === '/e/runtime/linux-x64/bin/node';
  const mac = P.buildPath({ platform: 'darwin', arch: 'arm64', env: { PATH: '/Users/a/.nvm/versions/node/v22.1.0/bin:/usr/bin:/bin' }, home: '/Users/a', appDir: '/A', engineDir: '/e', exists, fileOk: (f) => f.endsWith('/v22.1.0/bin/node') }).split(':');
  assert.deepEqual(mac, ['/A/tools/bin', '/Users/a/.nvm/versions/node/v22.1.0/bin', '/usr/bin', '/bin', '/Users/a/.volta/bin', '/Users/a/.asdf/shims', '/opt/homebrew/bin', '/usr/local/bin', '/Users/a/.bun/bin', '/Users/a/.local/bin', '/Users/a/Library/pnpm', '/Users/a/.npm-global/bin', '/usr/sbin', '/sbin', '/e/runtime/darwin-arm64/bin'],
    'the zsh launcher order, duplicates kept at their first place');
  // no node anywhere: nvm's default goes first (as the launcher did)
  const nvm = () => '/home/a/.nvm/versions/node/v20.11.0/bin';
  const lin = P.buildPath({ platform: 'linux', arch: 'x64', env: { PATH: '/usr/bin' }, home: '/home/a', appDir: '/A', engineDir: '/e', exists, fileOk: () => false, nvm }).split(':');
  assert.equal(lin[0], nvm()); assert.equal(lin[1], '/A/tools/bin'); assert.equal(lin.at(-1), '/e/runtime/linux-x64/bin');
  assert.ok(lin.includes('/snap/bin') && !lin.includes('/opt/homebrew/bin'));
  const win = P.buildPath({ platform: 'win32', arch: 'x64', env: { Path: 'C:\\Windows\\System32;c:\\windows\\system32\\;C:\\Users\\a\\AppData\\Roaming\\npm', SystemRoot: 'C:\\Windows', APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, home: 'C:\\Users\\a', appDir: 'C:\\A', engineDir: 'C:\\e', exists: (f) => f === 'C:\\e\\runtime\\win32-x64\\node.exe' }).split(';');
  assert.equal(win[0], 'C:\\A\\tools\\bin');
  assert.equal(win.filter((d) => d.toLowerCase().replace(/\\$/, '') === 'c:\\windows\\system32').length, 1, 'case-insensitive dedupe');
  assert.equal(win.at(-1), 'C:\\e\\runtime\\win32-x64');
});

test('nvmNodeBin: default alias, else the newest by version (not by string)', () => {
  const vers = ['v9.11.2', 'v18.2.0', 'v18.10.0', 'v20.1.0'];
  const fsx = (alias) => ({ readdir: () => vers, readFile: () => { if (alias === null) throw new Error('none'); return alias; }, isDir: () => true });
  assert.equal(P.nvmNodeBin('/h', fsx(null)), '/h/.nvm/versions/node/v20.1.0/bin');
  assert.equal(P.nvmNodeBin('/h', fsx('18\n')), '/h/.nvm/versions/node/v18.10.0/bin');
  assert.equal(P.nvmNodeBin('/h', fsx('lts/*')), '/h/.nvm/versions/node/v20.1.0/bin');
});

// ---------------------------------------------------------------- terminal scripts

test('terminal scripts: macOS .command byte-identical to before; Linux .sh; Windows .cmd', () => {
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  // what setup.mjs writeCommand wrote before the platform layer
  const envFile = "/Users/o'k/engine/env.zsh";
  const items = [{ title: 'Codex', script: 'codex login' }, { title: 'Claude', script: 'echo "Sign in"; claude' }];
  const body = items.map((i) => `echo "━━━ ${i.title} ━━━"\n${i.script}\necho`).join('\n');
  const legacySetup = `#!/bin/zsh\n# Before I Deploy — Setup\n[ -f ${q(envFile)} ] && source ${q(envFile)}\nclear\n${body}\necho\necho ${q('Done.')}\n`;
  const steps = items.flatMap((i) => [{ echo: `━━━ ${i.title} ━━━` }, { raw: i.script }, { blank: true }]);
  assert.equal(darwin.renderTerminal({ title: 'Setup', envFile, steps, done: 'Done.' }), legacySetup);
  // what aifix.mjs wrote before
  const legacyAifix = ['#!/bin/zsh', '# Before I Deploy — AI Fix (codex)', `[ -f ${q(envFile)} ] && source ${q(envFile)}`, `cd ${q('/p/my site')} || exit 1`, 'clear', 'echo "🤖 codex — fixing: build"', 'echo', `codex "$(cat ${q('/c/aifix-build.md')})"`, ''].join('\n');
  assert.equal(darwin.renderTerminal({ title: 'AI Fix (codex)', envFile, cwd: '/p/my site', steps: [{ echo: '🤖 codex — fixing: build' }, { blank: true }, { runWithFile: ['codex', '/c/aifix-build.md'] }] }), legacyAifix);

  const sh = linux.renderTerminal({ title: 'Setup', envFile, steps, done: 'Done.', pause: 'Press Enter' });
  assert.ok(sh.startsWith('#!/bin/sh\n') && sh.includes(`. ${q(envFile)}`) && sh.includes('read _bid_wait') && !sh.includes('source '));

  const cmd = win32.renderTerminal({ title: 'AI Fix', envFile: 'C:\\e\\env.cmd', cwd: 'C:\\p\\100% site', steps: [{ echo: 'fix & go <now>' }, { blank: true }, { raw: 'codex login', cmd: 'call codex login' }, { runWithFile: ['codex', "C:\\c\\it's.md"] }], done: 'Done', pause: 'Press any key' });
  const lines = cmd.split('\r\n');
  assert.equal(lines[0], '@echo off'); assert.equal(lines[1], 'chcp 65001 >nul');
  assert.ok(lines.includes('cd /d "C:\\p\\100%% site" || exit /b 1'), 'percent doubled in a batch file');
  assert.ok(lines.includes('echo fix ^& go ^<now^>'));
  assert.ok(lines.includes('call codex login'));
  assert.ok(lines.some((l) => l.startsWith('powershell.exe -NoProfile') && l.includes("Get-Content -Raw -Encoding UTF8 -LiteralPath 'C:\\c\\it''s.md'")));
  assert.ok(cmd.endsWith('pause >nul\r\n'));
  // launchers
  assert.equal(P.terminalLauncher('/x.command', { platform: 'darwin' }), null, 'the app opens .command files');
  assert.deepEqual(P.terminalLauncher('/x.sh', { platform: 'linux', find: (c) => c === 'gnome-terminal' }), ['gnome-terminal', '--', '/x.sh']);
  assert.equal(P.terminalLauncher('/x.sh', { platform: 'linux', find: () => null }), null);
  assert.deepEqual(P.terminalLauncher('C:\\x.cmd', { platform: 'win32', env: {} }), ['cmd.exe', '/d', '/c', 'start', '""', 'C:\\x.cmd']);
  // written with the right extension
  const f = P.writeTerminalScript(path.join(tmp, 'term'), { title: 't', steps: [] }, { platform: 'linux' });
  assert.equal(path.extname(f), '.sh');
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o111, 0o111);
});

// ---------------------------------------------------------------- schedulers

test('monitor schedulers: launchd plist escaped, systemd units quoted, schtasks without admin', () => {
  const plist = darwin.launchdPlist({ label: 'l', bid: '/A & B/<bid>', intervalSec: 600, logFile: '/l.log' });
  assert.ok(plist.includes('<string>/A &amp; B/&lt;bid&gt;</string>') && plist.includes('<integer>600</integer>'));
  const u = linux.systemdUnits({ unit: 'before-i-deploy-monitor', bid: '/home/a/my "x"/100%/bid', intervalMin: 10, logFile: '/l%.log' });
  assert.ok(u.service.includes('ExecStart="/home/a/my \\"x\\"/100%%/bid" monitor once'));
  assert.ok(u.service.includes('StandardOutput=append:/l%%.log') && u.service.includes('Environment=BID_MONITOR_AGENT=1'));
  assert.ok(u.timer.includes('OnUnitActiveSec=10min') && u.timer.includes('WantedBy=timers.target'));
  assert.deepEqual(win32.schtasksCreateArgs({ task: 'BeforeIDeploy Monitor', vbsFile: 'C:\\A\\monitor-agent.vbs', intervalMin: 10 }),
    ['/Create', '/F', '/SC', 'MINUTE', '/MO', '10', '/TN', 'BeforeIDeploy Monitor', '/TR', 'wscript.exe //B //Nologo "C:\\A\\monitor-agent.vbs"']);
  const files = win32.schedulerFiles({ bid: 'C:\\e\\bid.cmd', logFile: 'C:\\A\\m.log', cmdFile: 'C:\\A\\monitor-agent.cmd' });
  assert.ok(files.cmd.includes('set BID_MONITOR_AGENT=1') && files.cmd.includes('call "C:\\e\\bid.cmd" monitor once >> "C:\\A\\m.log" 2>&1'));
  assert.ok(files.vbs.includes(', 0, False'), 'hidden window');
});

// ---------------------------------------------------------------- updates

test('release feed: the installer for this OS; v1 feeds keep working', async () => {
  const { pickAsset } = await import('../engine/src/update.mjs');
  const v2 = { url: 'https://x/a.dmg', sha256: 'd', assets: { 'darwin-universal': { url: 'https://x/a.dmg', sha256: 'd' }, 'win32-x64-msi': { url: 'https://x/a.msi', sha256: 'w' }, 'linux-x64-appimage': { url: 'https://x/a.AppImage', sha256: 'l' }, 'linux-x64-deb': { url: 'https://x/a.deb', sha256: 'b' } } };
  assert.deepEqual(pickAsset(v2, { platform: 'darwin', arch: 'arm64' }), { key: 'darwin-universal', url: 'https://x/a.dmg', sha256: 'd' });
  assert.deepEqual(pickAsset(v2, { platform: 'win32', arch: 'x64' }), { key: 'win32-x64-msi', url: 'https://x/a.msi', sha256: 'w' });
  assert.equal(pickAsset(v2, { platform: 'linux', arch: 'x64' }).key, 'linux-x64-appimage');
  assert.equal(pickAsset(v2, { platform: 'linux', arch: 'x64', format: 'deb' }).key, 'linux-x64-deb');
  assert.equal(pickAsset(v2, { platform: 'linux', arch: 'arm64' }), null, 'no arm64 build: nothing to download');
  assert.deepEqual(pickAsset({ url: 'https://x/a.dmg', sha256: 'd' }, { platform: 'linux' }), { key: null, url: 'https://x/a.dmg', sha256: 'd' });
  assert.equal(P.updateFileExt('win32-x64-msi', 'win32'), '.msi');
  assert.equal(P.updateFileExt('linux-x64-deb', 'linux'), '.deb');
});

// ---------------------------------------------------------------- hosting CLI logins

test('configCandidates: the old lookups first, then XDG and Windows folders', () => {
  const mac = P.configCandidates('netlify', { platform: 'darwin', env: {}, home: '/Users/a' });
  assert.deepEqual(mac, ['/Users/a/Library/Preferences/netlify/config.json', '/Users/a/.config/netlify/config.json', '/Users/a/.netlify/config.json']);
  assert.ok(P.configCandidates('netlify', { platform: 'linux', env: { XDG_CONFIG_HOME: '/cfg' }, home: '/h' }).includes('/cfg/netlify/config.json'));
  assert.ok(P.configCandidates('netlify', { platform: 'win32', env: { APPDATA: 'C:\\R' }, home: 'C:\\U' }).includes('C:\\R\\netlify\\Config\\config.json'));
  assert.ok(P.configCandidates('wrangler', { platform: 'win32', env: {}, home: 'C:\\U' }).includes('C:\\U\\.wrangler\\config\\default.toml'));
});

// ---------------------------------------------------------------- bubblewrap

test('bwrap arguments: read-only system, caches writable, engine folders hidden, project last', () => {
  const a = linux.bwrapArgs({ cwd: '/home/a/.cache/before-i-deploy/staging/p', home: '/home/a', denied: ['/home/a/.local/share/before-i-deploy', '/home/a/.cache/before-i-deploy'], readOnly: ['/home/a/.local/share/before-i-deploy/tools'], runtimeDir: '/run/user/1000', exists: (d) => d !== '/home/a/.bun' });
  const s = a.join(' ');
  assert.ok(s.startsWith('--ro-bind / / --dev /dev --unshare-pid --proc /proc'));
  assert.ok(!s.includes('--new-session'), 'the engine stops scripts through their process group');
  const at = (x) => s.indexOf(x);
  assert.ok(at('--bind /home/a/.cache /home/a/.cache') < at('--tmpfs /home/a/.cache/before-i-deploy'), 'the cache folder is writable, ours inside it hidden');
  assert.ok(at('--tmpfs /run/user/1000') > 0, 'no session bus → no Secret Service');
  assert.ok(at('--ro-bind /home/a/.local/share/before-i-deploy/tools') > at('--tmpfs /home/a/.local/share/before-i-deploy'));
  assert.deepEqual(a.slice(-5), ['--bind', '/home/a/.cache/before-i-deploy/staging/p', '/home/a/.cache/before-i-deploy/staging/p', '--chdir', '/home/a/.cache/before-i-deploy/staging/p']);
  assert.ok(!s.includes('/home/a/.bun'));
});

// ---------------------------------------------------------------- secrets

test('secrets: AES-256-GCM file bound to the account; no plaintext on Linux/Windows; refuses without a passphrase', async () => {
  const sec = await import('../engine/src/secrets.mjs');
  const sealed = sec.sealSecret('session', '{"a":1}', 'pw');
  assert.ok(!sealed.includes('"a"'));
  assert.equal(sec.openSecret('session', sealed, 'pw'), '{"a":1}');
  assert.equal(sec.openSecret('session', sealed, 'wrong'), null);
  assert.equal(sec.openSecret('other', sealed, 'pw'), null, 'a file copied to another account does not open');
  const tampered = JSON.parse(sealed); tampered.data = Buffer.from('x').toString('base64');
  assert.equal(sec.openSecret('session', JSON.stringify(tampered), 'pw'), null);
  if (process.platform === 'darwin') return; // macOS: the Keychain, unchanged (tests/run.mjs)
  const dir = path.join(process.env.BID_APP_DIR, 'secrets');
  delete process.env.BID_SECRETS_PASSPHRASE;
  assert.equal(sec.secretsBackend(), 'unavailable');
  assert.throws(() => sec.setSecret('ai-key', { k: 'sk-secret' }), (e) => e.code === 'secrets_unavailable');
  assert.ok(!fs.existsSync(path.join(dir, 'ai-key.json')), 'never plaintext');
  process.env.BID_SECRETS_PASSPHRASE = 'correct horse';
  assert.equal(sec.secretsBackend(), 'encrypted-file');
  sec.setSecret('ai-key', { k: 'sk-secret' });
  assert.deepEqual(sec.getSecret('ai-key'), { k: 'sk-secret' });
  assert.ok(fs.existsSync(path.join(dir, 'ai-key.enc')) && !fs.readFileSync(path.join(dir, 'ai-key.enc'), 'utf8').includes('sk-secret'));
  // a plain file from an earlier Linux build moves into the protected store when read
  fs.writeFileSync(path.join(dir, 'legacy.json'), '{"t":"old"}');
  assert.deepEqual(sec.getSecret('legacy'), { t: 'old' });
  assert.ok(!fs.existsSync(path.join(dir, 'legacy.json')) && fs.existsSync(path.join(dir, 'legacy.enc')));
  sec.deleteSecret('ai-key');
  assert.equal(sec.getSecret('ai-key'), null);
  delete process.env.BID_SECRETS_PASSPHRASE;
});

test('DPAPI script: CurrentUser scope, data over stdin, script as -EncodedCommand', () => {
  const s = win32.dpapiScript('protect');
  assert.ok(s.includes('ProtectedData]::Protect(') && s.includes('DataProtectionScope]::CurrentUser') && s.includes('[Console]::In.ReadToEnd()'));
  assert.ok(win32.dpapiScript('unprotect').includes('::Unprotect('));
  assert.equal(Buffer.from(win32.encodePowerShell('ab'), 'base64').toString('utf16le'), 'ab');
});

// ---------------------------------------------------------------- the real OS

test('real OS: util.sh runs a .cmd shim with awkward arguments unchanged (Windows) / a script (POSIX)', async () => {
  const { sh } = await import('../engine/src/util.mjs');
  const dir = fs.mkdtempSync(path.join(tmp, 'shim '));
  fs.writeFileSync(path.join(dir, 'args.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
  const awkward = ['plain', 'two words', 'a&b|c', '50%', 'q"uote', 'trail\\', '(x)', '^caret', ''];
  let r;
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'echoargs.cmd'), '@echo off\r\nnode "%~dp0args.js" %*\r\n');
    r = sh('echoargs', awkward, { env: { ...process.env, PATH: `${dir};${process.env.PATH}` } });
  } else {
    fs.writeFileSync(path.join(dir, 'echoargs'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'args.js')}" "$@"\n`, { mode: 0o755 });
    r = sh('echoargs', awkward, { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
  }
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), awkward);
});

test('real OS: killTree stops a child and its grandchild', async () => {
  const marker = path.join(tmp, 'grandchild.pid');
  // a parent that starts a long-lived grandchild and records its pid
  const script = `const {spawn}=require('child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(marker)},String(g.pid));setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore', ...P.groupOptions() });
  for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 50));
  const grand = Number(fs.readFileSync(marker, 'utf8'));
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  assert.ok(alive(child.pid) && alive(grand));
  assert.equal(P.killTree(child.pid, 'SIGKILL'), true);
  for (let i = 0; i < 100 && (alive(child.pid) || alive(grand)); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(alive(grand), false, 'the grandchild is gone too');
});

test('real OS: the launcher starts the engine (bid on POSIX, bid.cmd on Windows)', () => {
  const env = { ...process.env, BID_NO_BUNDLED_CLOUD: '1' };
  const r = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${path.join(root, 'engine', 'bid.cmd')}" doctor`], { env, encoding: 'utf8', windowsVerbatimArguments: true, timeout: 60000 })
    : spawnSync('/bin/sh', [path.join(root, 'engine', 'bid'), 'doctor'], { env, encoding: 'utf8', timeout: 60000 });
  const result = (r.stdout || '').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e?.type === 'result');
  assert.ok(result?.ok, (r.stderr || '') + r.stdout);
  assert.equal(result.data.appDir, process.env.BID_APP_DIR);
  const parts = result.data.path.split(path.delimiter);
  assert.equal(parts[0], path.join(process.env.BID_APP_DIR, 'tools', 'bin'), 'managed tools first on every OS');
  assert.ok(['sandbox', 'basic', 'none'].includes(result.data.isolation));
});
