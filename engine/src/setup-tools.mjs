// Managed tool installation. Never writes to a global npm prefix or the application bundle.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_DIR, ENGINE_DIR, EngineError, ensureDir, which, sh, runStream, fetchT, readJSON, processHolds, pidStartTime } from './util.mjs';
import { msg } from './i18n.mjs';
import { cliEnv } from './isolation.mjs';

export const TOOLS_DIR = path.join(APP_DIR, 'tools');
export const TOOL_PACKAGES = Object.freeze({
  'netlify-cli': { pkg: 'netlify-cli@23', bin: 'netlify' },
  vercel: { pkg: 'vercel@48', bin: 'vercel' },
  wrangler: { pkg: 'wrangler@4', bin: 'wrangler' },
  codex: { pkg: '@openai/codex@0.115', bin: 'codex' },
  'claude-code': { pkg: '@anthropic-ai/claude-code@2', bin: 'claude' },
});

export function gitAvailable() {
  const bin = which('git');
  if (!bin) return null;
  let real;
  try { real = fs.realpathSync(bin); } catch { return null; }
  if (process.platform === 'darwin' && real === '/usr/bin/git') {
    if (sh('/usr/bin/xcode-select', ['-p'], { timeout: 2000 }).code !== 0 ||
        sh('/usr/bin/xcrun', ['--find', 'git'], { timeout: 2000 }).code !== 0) return null;
  }
  return bin;
}

export function resolveNpm() {
  const npm = which('npm');
  if (npm) return { cmd: npm, args: [] };
  const cli = path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
  if (fs.existsSync(cli)) return { cmd: process.execPath, args: [cli] };
  const bundled = path.join(ENGINE_DIR, 'runtime', process.arch === 'x64' ? 'x86_64' : process.arch, 'lib/node_modules/npm/bin/npm-cli.js');
  return fs.existsSync(bundled) ? { cmd: process.execPath, args: [bundled] } : null;
}

/** O_EXCL lock with process identity; release only our own inode. */
export function setupLock() {
  ensureDir(APP_DIR);
  const file = path.join(APP_DIR, 'setup.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      const inode = fs.fstatSync(fd).ino;
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, pidStart: pidStartTime(process.pid) }));
      fs.closeSync(fd);
      const release = () => {
        try { if (fs.statSync(file).ino === inode) fs.unlinkSync(file); } catch {}
        process.removeListener('exit', release);
      };
      process.once('exit', release);
      return release;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const before = fs.statSync(file);
      const owner = readJSON(file, null);
      // An empty record can be a concurrent process still writing its identity; never steal a fresh lock.
      if (processHolds(owner) || (!owner && Date.now() - before.mtimeMs < 30000)) break;
      try { if (fs.statSync(file).ino === before.ino) fs.unlinkSync(file); } catch {}
    }
  }
  throw new EngineError(msg('setup.busy'), 'setup_busy');
}

export async function setupPreflight({ urls, disk = () => fs.statfsSync(ensureDir(TOOLS_DIR)), probe = fetchT } = {}) {
  const stat = disk();
  const free = Number(stat.bavail) * Number(stat.bsize);
  if (free < 1.5 * 1024 ** 3) throw new EngineError(msg('setup.diskFull'), 'setup_disk_space');
  const endpoints = urls || ['https://registry.npmjs.org/-/ping', 'https://github.com', 'https://api.netlify.com'];
  const checks = await Promise.all(endpoints.map(async url => {
    try {
      const r = await probe(url, { method: 'HEAD', redirect: 'error' }, 4000);
      await r.body?.cancel();
      return r.status < 500;
    } catch { return false; }
  }));
  if (checks.some(ok => !ok)) throw new EngineError(msg('setup.offline'), 'offline');
  return { freeGB: Math.floor(free / 1024 ** 3) };
}

export function installError(result) {
  const tail = result.tail.join('\n');
  if (/EACCES|EPERM/.test(tail)) return msg('setup.permissions', { dir: TOOLS_DIR });
  if (/ENOSPC/.test(tail)) return msg('setup.diskFull');
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT/.test(tail)) return msg('setup.offline');
  if (/ENOENT/.test(tail) || result.code === 127) return msg('setup.npmMissing');
  return msg('setup.toolFailed');
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
  ensureDir(staging);
  let published = false;
  const cleanup = () => { fs.rmSync(staging, { recursive: true, force: true }); if (!published) fs.rmSync(destination, { recursive: true, force: true }); };
  process.once('exit', cleanup);
  try {
    const result = await run(npm.cmd, [...npm.args, 'install', '--prefix', staging, '--no-audit', '--no-fund',
      '--loglevel=http', '--progress=false', '--fetch-timeout=60000', '--fetch-retries=2', tool.pkg], {
      cwd: staging, step: id, logFile, timeout: 360000,
      env: { ...cliEnv(), npm_config_cache: path.join(TOOLS_DIR, 'npm-cache'), npm_config_update_notifier: 'false' },
    });
    if (result.code !== 0) throw new EngineError(installError(result), 'install_failed');
    const candidate = path.join(staging, 'node_modules', '.bin', tool.bin);
    const check = await run(candidate, ['--version'], { cwd: staging, step: id, timeout: 15000, quiet: true });
    if (check.code !== 0) throw new EngineError(msg('setup.toolFailed'), 'install_failed');
    fs.renameSync(staging, destination);
    fs.symlinkSync(path.join(destination, 'node_modules', '.bin', tool.bin), temporaryLink);
    fs.renameSync(temporaryLink, link); // Atomic switch; keep the old installation usable until this point.
    published = true;
    return { id, path: link };
  } finally {
    process.removeListener('exit', cleanup);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(temporaryLink, { force: true });
    if (!published) fs.rmSync(destination, { recursive: true, force: true });
  }
}

/** GitHub's official, checksummed macOS binary; it does not require Homebrew or sudo. */
export async function installGitHub({ logFile } = {}) {
  const release = '2.101.0';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const filename = `gh_${release}_macOS_${arch}.zip`;
  const base = `https://github.com/cli/cli/releases/download/v${release}`;
  const uuid = crypto.randomUUID();
  const staging = ensureDir(path.join(TOOLS_DIR, `.staging-gh-${uuid}`));
  const destination = path.join(TOOLS_DIR, 'pkgs', `gh-${uuid}`);
  const link = path.join(TOOLS_DIR, 'bin', 'gh');
  let published = false;
  const cleanup = () => { fs.rmSync(staging, { recursive: true, force: true }); if (!published) fs.rmSync(destination, { recursive: true, force: true }); };
  process.once('exit', cleanup);
  try {
    const download = async (url, max) => {
      const res = await fetchT(url, { signal: AbortSignal.timeout(180000) }, 10000);
      if (!res.ok) throw new EngineError(msg('setup.offline'), 'offline');
      const chunks = []; let bytes = 0;
      for await (const chunk of res.body) {
        bytes += chunk.length;
        if (bytes > max) { res.abortController.abort(); throw new EngineError(msg('setup.toolFailed'), 'install_failed'); }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    };
    const sums = (await download(`${base}/gh_${release}_checksums.txt`, 1024 * 1024)).toString();
    const expected = sums.split('\n').find(line => line.trim().split(/\s+/).at(-1) === filename)?.split(/\s+/)[0];
    const archive = await download(`${base}/${filename}`, 64 * 1024 * 1024);
    if (!expected || crypto.createHash('sha256').update(archive).digest('hex') !== expected) throw new EngineError(msg('setup.toolFailed'), 'install_failed');
    const zip = path.join(staging, 'gh.zip'); fs.writeFileSync(zip, archive);
    const binary = `gh_${release}_macOS_${arch}/bin/gh`;
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
  } finally {
    process.removeListener('exit', cleanup);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(`${link}.${uuid}`, { force: true });
    if (!published) fs.rmSync(destination, { recursive: true, force: true });
  }
}
