// Platform layer (PLAN-UNIFIED §5.4, docs/plan-v13/codex-setup-platform.md P1–P5, P12, P13, P18, P22, P23).
// One place for what differs between macOS, Linux and Windows: folders, finding programs, starting `.cmd`
// shims, stopping process trees, PATH, the bundled runtime, terminal scripts and release assets. The OS
// specifics live in darwin.mjs / linux.mjs / win32.mjs as pure functions.
//
// Every function takes an optional `platform` (and env, home, file probes …), so tests/platform.mjs can
// simulate Windows on a Linux runner. Nothing here imports the rest of the engine (util.mjs imports this).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as darwin from './darwin.mjs';
import * as linux from './linux.mjs';
import * as win32 from './win32.mjs';

const IMPL = { darwin, linux, win32 };

/** darwin | linux | win32 — other POSIX systems behave like Linux. */
export function platformOf(platform = process.platform) {
  return IMPL[platform] ? platform : 'linux';
}
export const impl = (platform) => IMPL[platformOf(platform)];
export const isWindows = (platform = process.platform) => platform === 'win32';
export const pathFor = (platform = process.platform) => (isWindows(platform) ? path.win32 : path.posix);
export const delimiter = (platform = process.platform) => (isWindows(platform) ? ';' : ':');

// ---------------------------------------------------------------- folders (P5)

/**
 * The engine's folders: app data (projects, sessions, tools), cache (logs, staging) and config.
 * BID_APP_DIR / BID_CACHE_DIR override them on every OS (tests, portable installs).
 */
export function dirs({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const d = impl(platform).dirs(env, home);
  const appDir = env.BID_APP_DIR || d.appDir;
  return { appDir, cacheDir: env.BID_CACHE_DIR || d.cacheDir, configDir: env.BID_APP_DIR ? appDir : d.configDir };
}

// ---------------------------------------------------------------- which (P2)

/** The PATH value; Windows spells the variable `Path`. */
export function getPath(env = process.env) {
  if (env.PATH !== undefined) return env.PATH;
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  return key ? env[key] : '';
}

function defaultFileOk(platform) {
  return (file) => {
    try {
      if (!fs.statSync(file).isFile()) return false;
      if (!isWindows(platform)) fs.accessSync(file, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * Finds a program like the shell would, without a shell (no /bin/sh, so it works on Windows): walks PATH,
 * on Windows tries every PATHEXT extension. A name with a path separator is checked as given.
 * Returns the path or null. `fileOk` replaces the file probe (tests).
 */
export function which(cmd, { platform = process.platform, env = process.env, fileOk = defaultFileOk(platform) } = {}) {
  if (!cmd || typeof cmd !== 'string') return null;
  const P = pathFor(platform);
  const win = isWindows(platform);
  let names = [cmd];
  if (win) {
    const exts = win32.pathExts(env);
    const ext = P.extname(cmd).toLowerCase();
    names = ext && exts.includes(ext) ? [cmd] : exts.map((e) => cmd + e);
  }
  const hasSep = win ? /[\\/]/.test(cmd) : cmd.includes('/');
  if (hasSep) return names.find((n) => fileOk(n)) || null;
  for (let dir of getPath(env).split(delimiter(platform))) {
    if (win) dir = dir.replace(/^"(.*)"$/, '$1');
    if (!dir) continue; // an empty entry means "current folder" to a shell — never for us
    for (const n of names) {
      const file = P.join(dir, n);
      if (fileOk(file)) return file;
    }
  }
  return null;
}

// ---------------------------------------------------------------- spawning (P3, P4)

/**
 * How to start `cmd args` on this OS: { command, args, options }. POSIX: unchanged. Windows: the program is
 * resolved through PATH/PATHEXT; a `.cmd` / `.bat` shim (npm, netlify, gh-installed tools…) runs through
 * cmd.exe with strict quoting, because Node refuses to start it directly (CVE-2024-27980).
 */
export function spawnSpec(cmd, args = [], { platform = process.platform, env = process.env, resolve } = {}) {
  if (!isWindows(platform)) return { command: cmd, args, options: {} };
  const found = (resolve || ((c) => which(c, { platform, env })))(cmd) || cmd;
  if (win32.isCmdShim(found)) return win32.shimSpawn(found, args, env);
  return { command: found, args, options: { windowsHide: true } };
}

/**
 * Options that let the engine stop a child with everything it started: a new process group on POSIX
 * (`detached`, as before); on Windows `detached` would open a console, and taskkill /T walks the tree.
 */
export function groupOptions(platform = process.platform) {
  return isWindows(platform) ? { windowsHide: true } : { detached: true };
}

/**
 * Stops a process and its descendants. POSIX: the process group (leader pid), else the pid alone.
 * Windows: `taskkill /T /F /PID` (Windows has no SIGTERM for console programs). Returns true when sent.
 */
export function killTree(pid, signal = 'SIGTERM', { platform = process.platform, run = spawnSync } = {}) {
  if (!pid) return false;
  if (isWindows(platform)) {
    try {
      const r = run('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
      if (r?.status === 0) return true;
    } catch {}
    try { process.kill(pid); return true; } catch { return false; }
  }
  try { process.kill(-pid, signal); return true; } catch {}
  try { process.kill(pid, signal); return true; } catch { return false; }
}

// ---------------------------------------------------------------- bundled runtime (P1, P20)

/** `darwin-arm64`, `linux-x64`, `win32-x64` … — Node's own names, so `aarch64` never appears. */
export const runtimeKey = (platform = process.platform, arch = process.arch) => `${platformOf(platform)}-${arch}`;

/** Folders a bundled Node runtime can live in, preferred first (the key, then the older macOS names). */
export function runtimeDirs(engineDir, { platform = process.platform, arch = process.arch } = {}) {
  const P = pathFor(platform);
  return [runtimeKey(platform, arch), ...impl(platform).legacyRuntimeNames(arch)].map((n) => P.join(engineDir, 'runtime', n));
}

/** The folder holding the runtime's `node` (POSIX: <dir>/bin; Windows zip layout: node.exe at the top). */
export const runtimeBinDir = (dir, platform = process.platform) => (isWindows(platform) ? dir : pathFor(platform).join(dir, 'bin'));

/** npm's CLI script inside a runtime folder. */
export const runtimeNpmCli = (dir, platform = process.platform) =>
  isWindows(platform) ? path.win32.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js') : path.posix.join(dir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

/** The first bundled runtime that exists: { dir, bin } or null. */
export function bundledRuntime(engineDir, { platform = process.platform, arch = process.arch, exists = fs.existsSync } = {}) {
  const node = isWindows(platform) ? 'node.exe' : 'node';
  for (const dir of runtimeDirs(engineDir, { platform, arch })) {
    const bin = runtimeBinDir(dir, platform);
    if (exists(pathFor(platform).join(bin, node))) return { dir, bin };
  }
  return null;
}

// ---------------------------------------------------------------- PATH (P1)

const versionKey = (v) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
const byVersion = (a, b) => {
  const x = versionKey(a), y = versionKey(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

/** nvm without nvm.sh: the default alias, else the newest installed version (POSIX). */
export function nvmNodeBin(home, { readdir = fs.readdirSync, readFile = fs.readFileSync, isDir = (d) => fs.statSync(d).isDirectory() } = {}) {
  const base = path.posix.join(home, '.nvm', 'versions', 'node');
  let versions;
  try { versions = readdir(base).filter((v) => /^v\d/.test(v)).sort(byVersion); } catch { return null; }
  const binOf = (v) => {
    const d = path.posix.join(base, v, 'bin');
    try { return isDir(d) ? d : null; } catch { return null; }
  };
  let alias = '';
  try { alias = String(readFile(path.posix.join(home, '.nvm', 'alias', 'default'), 'utf8')).trim().replace(/^v/, ''); } catch {}
  if (alias) {
    const match = versions.filter((v) => v.startsWith(`v${alias}`)).map(binOf).filter(Boolean);
    if (match.length) return match.at(-1);
  }
  return versions.map(binOf).filter(Boolean).at(-1) || null;
}

/**
 * The PATH every engine process uses, on every OS: managed tools first, then the user's PATH (so nvm, asdf
 * and volta pick the Node they chose), then the usual install places, the bundled runtime last. Without a
 * `node` anywhere, nvm's default comes first (as the zsh launcher did). Duplicates keep their first place.
 */
export function buildPath({
  platform = process.platform, env = process.env, home = os.homedir(), appDir = dirs({ platform, env, home }).appDir,
  engineDir, arch = process.arch, exists = fs.existsSync, fileOk, nvm = nvmNodeBin,
} = {}) {
  const P = pathFor(platform);
  const win = isWindows(platform);
  const norm = (d) => (win ? d.replace(/[\\/]+$/, '').toLowerCase() : d.replace(/(.)\/+$/, '$1'));
  const tools = P.join(appDir, 'tools', 'bin');
  const runtime = engineDir ? bundledRuntime(engineDir, { platform, arch, exists })?.bin : null;
  const user = getPath(env).split(delimiter(platform)).map((d) => (win ? d.replace(/^"(.*)"$/, '$1') : d)).filter(Boolean);
  let list = [tools, ...user, ...impl(platform).extraPathDirs(env, home)];
  if (!win && !which('node', { platform, env: { PATH: list.join(':') }, fileOk })) {
    const n = nvm(home);
    if (n) list = [n, ...list];
  }
  const seen = new Set(runtime ? [norm(runtime)] : []);
  const out = [];
  for (const d of list) {
    const k = norm(d);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  if (runtime) out.push(runtime);
  return out.join(delimiter(platform));
}

/** Sets this process's PATH (and the locale on macOS/Linux) — `bid.mjs` does this before anything runs. */
export function applyEnginePath({ engineDir, env = process.env, platform = process.platform } = {}) {
  env.PATH = buildPath({ platform, env, engineDir });
  Object.assign(env, impl(platform).locale(env));
  return env.PATH;
}

// ---------------------------------------------------------------- terminal scripts (P18)

/**
 * A script the user runs in a terminal: macOS `.command` (zsh, opened by the app), Linux `.sh`, Windows `.cmd`.
 * `file` is the path without extension; steps: {echo}, {blank}, {raw (POSIX), cmd (Windows)}, {run: argv},
 * {runWithFile: [bin, file]}. Returns the written file.
 */
export function writeTerminalScript(file, spec, { platform = process.platform } = {}) {
  const m = impl(platform);
  const out = file + m.terminalExt;
  fs.writeFileSync(out, m.renderTerminal(spec));
  if (!isWindows(platform)) fs.chmodSync(out, 0o755);
  return out;
}

/**
 * How to open a terminal script, best effort: [command, ...args] or null (macOS: the app opens it; Linux:
 * the first terminal emulator found; Windows: `cmd /c start`).
 */
export function terminalLauncher(script, { platform = process.platform, env = process.env, find = (c) => which(c, { platform, env }) } = {}) {
  for (const [cmd, ...args] of impl(platform).terminalLaunchers(env)) {
    if (isWindows(platform) || find(cmd)) return [cmd, ...args, script];
  }
  return null;
}

// ---------------------------------------------------------------- release assets (P23)

/** Feed keys to look for, preferred first: darwin-universal; linux-x64-appimage / -deb; win32-x64-msi … */
export const updateAssetKeys = ({ platform = process.platform, arch = process.arch, format } = {}) => impl(platform).updateAssetKeys(arch, format);
export const updateFileExt = (key, platform = process.platform) => impl(platform).updateFileExt(key);

// ---------------------------------------------------------------- hosting CLI logins (P21)

/**
 * Where the hosting CLIs keep their login, in the order the engine looks. The first entries are the ones
 * the engine always checked (macOS and the plain Linux defaults); XDG overrides and Windows folders follow.
 */
export function configCandidates(tool, { platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const P = pathFor(platform);
  const j = (...p) => P.join(...p);
  const base = {
    netlify: [j(home, 'Library', 'Preferences', 'netlify', 'config.json'), j(home, '.config', 'netlify', 'config.json'), j(home, '.netlify', 'config.json')],
    vercel: [j(home, 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'), j(home, '.local', 'share', 'com.vercel.cli', 'auth.json')],
    wrangler: [j(home, 'Library', 'Preferences', '.wrangler', 'config', 'default.toml'), j(home, '.wrangler', 'config', 'default.toml'), j(home, '.config', '.wrangler', 'config', 'default.toml')],
  }[tool] || [];
  const extra = [];
  const os_ = platformOf(platform);
  if (os_ === 'linux') {
    const cfg = env.XDG_CONFIG_HOME && P.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : null;
    const data = env.XDG_DATA_HOME && P.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : null;
    if (tool === 'netlify' && cfg) extra.push(j(cfg, 'netlify', 'config.json'));
    if (tool === 'vercel' && data) extra.push(j(data, 'com.vercel.cli', 'auth.json'));
    if (tool === 'wrangler' && cfg) extra.push(j(cfg, '.wrangler', 'config', 'default.toml'));
  } else if (os_ === 'win32') {
    const roaming = env.APPDATA || j(home, 'AppData', 'Roaming');
    if (tool === 'netlify') extra.push(j(roaming, 'netlify', 'Config', 'config.json'));
    if (tool === 'vercel') extra.push(j(roaming, 'xdg.data', 'com.vercel.cli', 'auth.json'), j(roaming, 'com.vercel.cli', 'Data', 'auth.json'));
    if (tool === 'wrangler') extra.push(j(roaming, 'xdg.config', '.wrangler', 'config', 'default.toml'));
  }
  return [...base, ...extra.filter((f) => !base.includes(f))];
}

export { darwin, linux, win32 };
