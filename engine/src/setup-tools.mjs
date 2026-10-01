// Managed tool installation. Never writes to a global npm prefix or the application bundle.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_DIR, ENGINE_DIR, EngineError, ensureDir, which, sh, runStream, fetchT, readJSON, processHolds, pidAlive, pidStartTime, onChildSpawn, killGroup } from './util.mjs';
import { msg } from './i18n.mjs';
import { cliEnv } from './isolation.mjs';

export const TOOLS_DIR = path.join(APP_DIR, 'tools');
// audit B5: one manifest with exact versions + tarball integrity (tools-manifest.json)
const MANIFEST = JSON.parse(fs.readFileSync(new URL('./tools-manifest.json', import.meta.url), 'utf8')).tools;
export const TOOL_PACKAGES = Object.freeze(Object.fromEntries(Object.entries(MANIFEST).map(([id, m]) =>
  [id, Object.freeze({ ...m, pkg: `${m.package}@${m.version}` })])));

export { gitAvailable } from './gitbin.mjs'; // kept for callers; the logic lives in gitbin.mjs

export function resolveNpm() {
  const npm = which('npm');
  if (npm) return { cmd: npm, args: [] };
  const cli = path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
  if (fs.existsSync(cli)) return { cmd: process.execPath, args: [cli] };
  const bundled = path.join(ENGINE_DIR, 'runtime', process.arch === 'x64' ? 'x86_64' : process.arch, 'lib/node_modules/npm/bin/npm-cli.js');
  return fs.existsSync(bundled) ? { cmd: process.execPath, args: [bundled] } : null;
}

/** Stops the process groups a dead lock owner recorded (npm, gh, unzip left running after a hard kill). */
function stopOrphans(owner) {
  for (const child of Array.isArray(owner?.children) ? owner.children : []) {
    // only a recorded start time that ps confirms proves the pid is still that child, not a reused pid
    if (!Number.isInteger(child?.pid) || child.pid <= 1 || child.pid === process.pid || child.pidStart == null || !pidAlive(child.pid)) continue;
    const now = pidStartTime(child.pid);
    if (now !== null && now === child.pidStart) killGroup(child.pid, 'SIGKILL');
  }
}

/**
 * Start-of-run sweep (audit B1), only while holding the lock: every `.staging-*` folder and half-made
 * `bin/<bin>.<uuid>` link older than our lock belongs to a run that was killed before its exit handlers ran.
 */
export function sweepStale(since = Date.now()) {
  const removed = [];
  const sweep = (dir, match) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (!match(name)) continue;
      const file = path.join(dir, name);
      try {
        if (fs.lstatSync(file).mtimeMs > since) continue;
        fs.rmSync(file, { recursive: true, force: true });
        removed.push(file);
      } catch {}
    }
  };
  sweep(TOOLS_DIR, name => name.startsWith('.staging-'));
  sweep(path.join(TOOLS_DIR, 'bin'), name => /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name));
  return removed;
}

/** O_EXCL lock with process identity; release only our own inode. Records our children for orphan recovery. */
export function setupLock() {
  ensureDir(APP_DIR);
  const file = path.join(APP_DIR, 'setup.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      const inode = fs.fstatSync(fd).ino;
      const record = { pid: process.pid, pidStart: pidStartTime(process.pid), children: [] };
      fs.writeFileSync(fd, JSON.stringify(record));
      fs.closeSync(fd);
      const takenAt = Date.now();
      const stopTracking = onChildSpawn(child => {
        if (!child.pid) return;
        record.children = [...record.children.filter(c => c.pid !== child.pid), { pid: child.pid, pidStart: pidStartTime(child.pid) }].slice(-32);
        try { if (fs.statSync(file).ino === inode) fs.writeFileSync(file, JSON.stringify(record), { mode: 0o600 }); } catch {}
      });
      const release = () => {
        stopTracking();
        try { if (fs.statSync(file).ino === inode) fs.unlinkSync(file); } catch {}
        process.removeListener('exit', release);
      };
      process.once('exit', release);
      sweepStale(takenAt);
      return release;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const before = fs.statSync(file);
      const owner = readJSON(file, null);
      // An empty record can be a concurrent process still writing its identity; never steal a fresh lock.
      if (processHolds(owner) || (!owner && Date.now() - before.mtimeMs < 30000)) break;
      stopOrphans(owner);
      try { if (fs.statSync(file).ino === before.ino) fs.unlinkSync(file); } catch {}
    }
  }
  throw new EngineError(msg('setup.busy'), 'setup_busy');
}

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The `pkgs/<id>-<uuid>` folder a `bin/<bin>` link points into, or null. */
function linkedPackage(link) {
  let target;
  try { target = fs.readlinkSync(link); } catch { return null; }
  const rel = path.relative(path.join(TOOLS_DIR, 'pkgs'), path.resolve(path.dirname(link), target));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep)[0] : null;
}

/**
 * Audit B2: after a successful switch keep the active install and the one before it (a quick way back),
 * delete every other `pkgs/<id>-<uuid>`. Only names of exactly this id match, never `<id>-other-<uuid>`.
 */
export function prunePackages(id, keep = []) {
  const dir = path.join(TOOLS_DIR, 'pkgs');
  const re = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-${UUID_RE}$`);
  const removed = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return removed; }
  for (const name of names) {
    if (!re.test(name) || keep.includes(name)) continue;
    try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); removed.push(name); } catch {}
  }
  return removed;
}

const HOSTS = Object.freeze({
  npm: 'https://registry.npmjs.org/-/ping',
  github: 'https://github.com',
  netlify: 'https://api.netlify.com',
  vercel: 'https://api.vercel.com',
  cloudflare: 'https://api.cloudflare.com/client/v4',
});
const STEP_HOSTS = Object.freeze({ gh: ['github'], 'gh-auth': ['github'], 'git-identity': ['github'], 'netlify-login': ['netlify'], 'vercel-auth': ['vercel'], 'wrangler-auth': ['cloudflare'] });

/** What a run needs (audit B8): hosts only for the queued steps, disk only when something is installed. */
export function preflightPlan(ids) {
  const keys = new Set();
  let install = false;
  for (const id of ids) {
    if (TOOL_PACKAGES[id]) { keys.add('npm'); install = true; }
    if (id === 'gh') install = true;
    for (const k of STEP_HOSTS[id] || []) keys.add(k);
  }
  return { urls: [...keys].map(k => HOSTS[k]), disk: install };
}

/** `ids`: the steps this run will start. Without ids (older callers) every host and the disk are checked. */
export async function setupPreflight({ ids, urls, disk = () => fs.statfsSync(ensureDir(TOOLS_DIR)), probe = fetchT } = {}) {
  const plan = ids ? preflightPlan(ids) : { urls: [HOSTS.npm, HOSTS.github, HOSTS.netlify], disk: true };
  let free = null;
  if (plan.disk) {
    const stat = disk();
    free = Number(stat.bavail) * Number(stat.bsize);
    if (free < 1.5 * 1024 ** 3) throw new EngineError(msg('setup.diskFull'), 'setup_disk_space');
  }
  const endpoints = urls || plan.urls;
  const checks = await Promise.all(endpoints.map(async url => {
    try {
      // any answer below 500 (including a redirect to a login page) proves the host is reachable
      const r = await probe(url, { method: 'HEAD', redirect: 'manual' }, 4000);
      await r.body?.cancel();
      return r.status < 500;
    } catch { return false; }
  }));
  if (checks.some(ok => !ok)) throw new EngineError(msg('setup.offline'), 'offline');
  return { freeGB: free === null ? null : Math.floor(free / 1024 ** 3), hosts: endpoints };
}

export function installError(result) {
  const tail = result.tail.join('\n');
  if (/EACCES|EPERM/.test(tail)) return msg('setup.permissions', { dir: TOOLS_DIR });
  if (/ENOSPC/.test(tail)) return msg('setup.diskFull');
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT/.test(tail)) return msg('setup.offline');
  if (/ENOENT/.test(tail) || result.code === 127) return msg('setup.npmMissing');
  return msg('setup.toolFailed');
}

/** npm recorded what it installed; it must be exactly the pinned version with the pinned tarball integrity. */
export function verifyLocked(prefix, tool) {
  const lock = readJSON(path.join(prefix, 'package-lock.json'), null);
  const entry = lock?.packages?.[`node_modules/${tool.package}`];
  if (!entry || entry.version !== tool.version || entry.integrity !== tool.integrity) {
    throw new EngineError(msg('setup.integrity', { name: tool.package }), 'install_failed');
  }
}

export async function installManaged(id, { logFile, run = runStream } = {}) {
  const tool = TOOL_PACKAGES[id];
  if (!tool) throw new EngineError(msg('setup.unknownStep', { id }), 'usage', 2);
  const npm = resolveNpm();
  if (!npm) throw new EngineError(msg('setup.npmMissing'), 'setup_npm_missing');
  ensureDir(path.join(TOOLS_DIR, 'pkgs'));
  ensureDir(path.join(TOOLS_DIR, 'bin'));
  const uuid = crypto.randomUUID();
  const staging = path.join(TOOLS_DIR, `.staging-${id}-${uuid}`);
  const destination = path.join(TOOLS_DIR, 'pkgs', `${id}-${uuid}`);
  const link = path.join(TOOLS_DIR, 'bin', tool.bin);
  const temporaryLink = `${link}.${uuid}`;
  const previous = linkedPackage(link);
  ensureDir(staging);
  let published = false;
  const cleanup = () => { fs.rmSync(staging, { recursive: true, force: true }); if (!published) fs.rmSync(destination, { recursive: true, force: true }); };
  process.once('exit', cleanup);
  try {
    // a per-install cache inside staging: it is deleted with the staging folder, so it can never grow unbounded
    const env = { ...cliEnv(), npm_config_cache: path.join(staging, '.npm-cache'), npm_config_update_notifier: 'false' };
    // --ignore-scripts: no package code runs before the integrity check below (audit B5)
    const result = await run(npm.cmd, [...npm.args, 'install', '--prefix', staging, '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund',
      '--loglevel=http', '--progress=false', '--fetch-timeout=60000', '--fetch-retries=2', tool.pkg], {
      cwd: staging, step: id, logFile, timeout: 360000, env,
    });
    if (result.code !== 0) throw new EngineError(installError(result), 'install_failed');
    verifyLocked(staging, tool);
    if (tool.scripts) {
      // only this package's own install script (see tools-manifest.json note), after the bytes were verified
      const rebuilt = await run(npm.cmd, [...npm.args, 'rebuild', '--prefix', staging, '--foreground-scripts', '--loglevel=http', tool.package], {
        cwd: staging, step: id, logFile: null, timeout: 180000, env,
      });
      if (rebuilt.code !== 0) throw new EngineError(installError(rebuilt), 'install_failed');
    }
    const candidate = path.join(staging, 'node_modules', '.bin', tool.bin);
    const check = await run(candidate, ['--version'], { cwd: staging, step: id, timeout: 15000, quiet: true });
    if (check.code !== 0) throw new EngineError(msg('setup.toolFailed'), 'install_failed');
    fs.rmSync(path.join(staging, '.npm-cache'), { recursive: true, force: true });
    fs.renameSync(staging, destination);
    fs.symlinkSync(path.join(destination, 'node_modules', '.bin', tool.bin), temporaryLink);
    fs.renameSync(temporaryLink, link); // Atomic switch; keep the old installation usable until this point.
    published = true;
    prunePackages(id, [path.basename(destination), previous].filter(Boolean));
    fs.rmSync(path.join(TOOLS_DIR, 'npm-cache'), { recursive: true, force: true }); // the old shared cache (V12)
    return { id, path: link };
  } finally {
    process.removeListener('exit', cleanup);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(temporaryLink, { force: true });
    if (!published) fs.rmSync(destination, { recursive: true, force: true });
  }
}

/**
 * The pinned GitHub CLI release (audit B6). The sha256 of each archive is part of the source, so a release
 * asset replaced on the download origin cannot pass: checksums.txt from that same origin is not trusted.
 * Bump version and hashes together (gh_<v>_checksums.txt, cross-checked by downloading each zip).
 */
export const GH_RELEASE = Object.freeze({
  version: '2.101.0',
  assets: Object.freeze({
    'darwin-arm64': { file: 'gh_2.101.0_macOS_arm64.zip', dir: 'gh_2.101.0_macOS_arm64', sha256: 'e4303e39d8f07141c4bad4b99b01079f05029c59b27076e8fbc825c985ecdd8b' },
    'darwin-x64': { file: 'gh_2.101.0_macOS_amd64.zip', dir: 'gh_2.101.0_macOS_amd64', sha256: 'a6fd66c88e2f07d6e4e058173db341d07dd74d58cf8f19ae668293d2bb614ca3' },
  }),
});

/** GitHub's official macOS binary, verified against GH_RELEASE; it does not require Homebrew or sudo. */
export async function installGitHub({ logFile, platformKey = `${process.platform}-${process.arch}`, fetch = fetchT } = {}) {
  const release = GH_RELEASE.version;
  const asset = GH_RELEASE.assets[platformKey];
  if (!asset) throw new EngineError(msg('setup.notRunnable'), 'not_runnable');
  const filename = asset.file;
  const base = `https://github.com/cli/cli/releases/download/v${release}`;
  const uuid = crypto.randomUUID();
  const staging = ensureDir(path.join(TOOLS_DIR, `.staging-gh-${uuid}`));
  const destination = path.join(TOOLS_DIR, 'pkgs', `gh-${uuid}`);
  const link = path.join(TOOLS_DIR, 'bin', 'gh');
  const previous = linkedPackage(link);
  let published = false;
  const cleanup = () => { fs.rmSync(staging, { recursive: true, force: true }); if (!published) fs.rmSync(destination, { recursive: true, force: true }); };
  process.once('exit', cleanup);
  try {
    const download = async (url, max) => {
      let res;
      try { res = await fetch(url, { signal: AbortSignal.timeout(180000) }, 10000); }
      catch { throw new EngineError(msg('setup.offline'), 'offline'); }
      // the server answered: a 404/403/5xx is a failed install, not a missing network
      if (!res.ok) throw new EngineError(msg('setup.toolFailed'), 'install_failed');
      const chunks = []; let bytes = 0;
      try {
        for await (const chunk of res.body) {
          bytes += chunk.length;
          if (bytes > max) { res.abortController?.abort(); throw new EngineError(msg('setup.toolFailed'), 'install_failed'); }
          chunks.push(chunk);
        }
      } catch (e) { throw e instanceof EngineError ? e : new EngineError(msg('setup.offline'), 'offline'); }
      return Buffer.concat(chunks);
    };
    const expected = asset.sha256;
    const archive = await download(`${base}/${filename}`, 64 * 1024 * 1024);
    if (crypto.createHash('sha256').update(archive).digest('hex') !== expected) throw new EngineError(msg('setup.toolFailed'), 'install_failed');
    const zip = path.join(staging, 'gh.zip'); fs.writeFileSync(zip, archive);
    const binary = `${asset.dir}/bin/gh`;
    const result = await runStream('/usr/bin/unzip', ['-q', zip, binary, '-d', staging], { step: 'gh', logFile, timeout: 30000 });
    if (result.code !== 0) throw new EngineError(msg('setup.toolFailed'), 'install_failed');
    const candidate = path.join(staging, binary);
    fs.chmodSync(candidate, 0o755);
    if ((await runStream(candidate, ['--version'], { quiet: true, timeout: 15000 })).code !== 0) throw new EngineError(msg('setup.toolFailed'), 'install_failed');
    fs.unlinkSync(zip);
    ensureDir(path.dirname(destination)); ensureDir(path.dirname(link));
    fs.renameSync(staging, destination);
    fs.symlinkSync(path.join(destination, binary), `${link}.${uuid}`);
    fs.renameSync(`${link}.${uuid}`, link);
    published = true;
    prunePackages('gh', [path.basename(destination), previous].filter(Boolean));
  } finally {
    process.removeListener('exit', cleanup);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(`${link}.${uuid}`, { force: true });
    if (!published) fs.rmSync(destination, { recursive: true, force: true });
  }
}
