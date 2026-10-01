// Isolation for code the engine does not own (WP01, audit E3/E4).
//
// Project scripts (lint, typecheck, build, install, dev server) are someone else's code. They run with:
//   - scriptEnv(): an explicit allowlist of environment variables — never the engine's own environment,
//     which can carry BID_PASSWORD, BID_AI_KEY, BID_PUSHOVER_*, NETLIFY_AUTH_TOKEN … No wildcards:
//     NODE_OPTIONS can load code and npm_config_* can carry registry credentials.
//   - isolate(): on macOS, `sandbox-exec` with a profile that denies the Keychain services and every file
//     under the engine's own folders (sessions, secrets fallback, logs, AI history). On Linux, bubblewrap
//     (`bwrap`): the system read-only, the project writable, the engine's folders and the session bus
//     (Secret Service) hidden. Network stays open (installs need it). The check result reports the level:
//     "sandbox" (either of those), "basic" (Linux without a working bwrap, Windows: allowlisted environment
//     only, secrets are not in it) or "none" (BID_NO_SANDBOX=1, macOS without sandbox-exec). Automatic runs
//     of changed scripts are refused at every level (checks.mjs, scriptsTrust).
//
// Hosting CLIs (netlify, vercel, wrangler, gh) are the user's tools with the user's logins: they keep the
// environment minus the engine's own secrets (cliEnv).
//
// Endpoint overrides (BID_ANTHROPIC_API …) exist for the test suite only. They are honoured when
// BID_TEST_ENDPOINTS=1 AND the engine is not the bundled production copy (engine/.production, written by
// scripts/build.sh) — a stray variable in a shipped app can never send a real key to another host.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { APP_DIR, CACHE_DIR, ENGINE_DIR, HOME, which } from './util.mjs';
import { platformOf, linux, runtimeDirs } from './platform/index.mjs';

const SCRIPT_ENV_NAMES = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'TMPDIR', 'TERM', 'TZ'];
// what programs on Windows cannot start without (no secrets among them)
const WINDOWS_ENV_NAMES = ['SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'HOMEDRIVE', 'HOMEPATH', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'];
const NODE_ENVS = new Set(['production', 'development', 'test']);

/** Environment for project scripts: allowlisted names only, plus what the tools need to behave in CI mode. */
export function scriptEnv(extra = {}) {
  const env = {};
  const names = platformOf() === 'win32' ? [...SCRIPT_ENV_NAMES, ...WINDOWS_ENV_NAMES] : SCRIPT_ENV_NAMES;
  for (const k of names) if (process.env[k] !== undefined) env[k] = process.env[k];
  if (NODE_ENVS.has(process.env.NODE_ENV)) env.NODE_ENV = process.env.NODE_ENV;
  return { ...env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', ...extra };
}

// the engine's own secrets and switches — never handed to another program
const OWN_SECRET = /^(BID_(PASSWORD|AI_KEY|ACCESS|REFRESH|PUSHOVER_USER|PUSHOVER_TOKEN|SPACESHIP_KEY|SPACESHIP_SECRET|SUPABASE_ANON_KEY|STOP_TOKEN)|BID_TEST_.*)$/;

/** Environment for the user's hosting CLIs: theirs, minus the engine's own secrets. */
export function cliEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!OWN_SECRET.test(k)) env[k] = v;
  return { ...env, ...extra };
}

/** True inside the app bundle (scripts/build.sh writes engine/.production); false in the repository and tests. */
export function isProductionBundle() {
  return fs.existsSync(path.join(ENGINE_DIR, '.production'));
}

/** A test-only endpoint override, or null. */
export function testEndpoint(name) {
  const v = process.env[name];
  if (!v) return null;
  const testing = process.env.BID_TEST_ENDPOINTS === '1' || process.env.BID_TEST_ALLOW_PRIVATE_WEBHOOK === '1';
  return testing && !isProductionBundle() ? v : null;
}

/** Where every configurable endpoint points right now (doctor shows it; nothing secret in here). */
export function endpoints() {
  return {
    anthropic: testEndpoint('BID_ANTHROPIC_API') || 'https://api.anthropic.com',
    openai: testEndpoint('BID_OPENAI_API') || 'https://api.openai.com',
    spaceship: testEndpoint('BID_SPACESHIP_BASE') || 'https://spaceship.dev/api/v1',
    pushover: testEndpoint('BID_TEST_PUSHOVER_URL') || 'https://api.pushover.net/1',
    overrides: process.env.BID_TEST_ENDPOINTS === '1' && !isProductionBundle(),
  };
}

const sbString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// the sandbox matches real paths (/var → /private/var on macOS), so every denied folder is resolved first
function realDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** The sandbox profile for project scripts (macOS SBPL). */
export function sandboxProfile() {
  const denied = [APP_DIR, CACHE_DIR, path.join(HOME, 'Library', 'Keychains')].map((p) => `(subpath ${sbString(realDir(p))})`).join(' ');
  return [
    '(version 1)',
    '(allow default)',
    // the login keychain and the data-protection keychain are reached through these services
    '(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd.xpc") (global-name "com.apple.secd") (global-name "com.apple.security.agent"))',
    `(deny file-read* file-write* ${denied})`,
  ].join('\n');
}

// ---------------------------------------------------------------- Linux: bubblewrap

/** The session bus lives here; hiding it keeps the Secret Service (and the user's keyring) out of reach. */
function userRuntimeDir() {
  const d = process.env.XDG_RUNTIME_DIR || (typeof process.getuid === 'function' ? `/run/user/${process.getuid()}` : null);
  return d && fs.existsSync(d) ? d : null;
}

/** bwrap arguments for a project script running in `cwd`. */
export function bwrapProfile(cwd) {
  // the package managers' caches must be writable inside a read-only home: create the usual two first
  for (const d of [path.join(HOME, '.npm'), path.join(HOME, '.cache')]) try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return linux.bwrapArgs({
    writable: process.env.TMPDIR ? [process.env.TMPDIR] : [],
    cwd: cwd ? path.resolve(cwd) : null,
    home: HOME,
    denied: [realDir(APP_DIR), realDir(CACHE_DIR), path.join(HOME, '.local', 'share', 'keyrings')].filter((d) => fs.existsSync(d)),
    // the bundled Node and the managed CLIs may sit inside a hidden folder: programs only, read-only
    readOnly: [...runtimeDirs(ENGINE_DIR), path.join(APP_DIR, 'tools')],
    runtimeDir: userRuntimeDir(),
    exists: fs.existsSync,
  });
}

let bwrapWorks = null;
/** bubblewrap is installed and allowed to create its namespaces here (Ubuntu 24.04 AppArmor, containers…). */
function bwrapUsable() {
  if (bwrapWorks !== null) return bwrapWorks;
  if (!which('bwrap')) return (bwrapWorks = false);
  const r = spawnSync('bwrap', [...bwrapProfile(null), '--', 'true'], { stdio: 'ignore', timeout: 5000 });
  return (bwrapWorks = r.status === 0);
}

/** Which isolation project scripts get on this machine: sandbox | basic | none. */
export function isolationLevel() {
  if (process.env.BID_NO_SANDBOX === '1') return 'none';
  const os = platformOf();
  if (os === 'darwin') return which('sandbox-exec') ? 'sandbox' : 'none';
  if (os === 'linux') return bwrapUsable() ? 'sandbox' : 'basic';
  return 'basic'; // Windows: the allowlisted environment (scriptEnv); no secrets are in it
}

/** Wraps a command for a project script: [cmd, args, level]. `cwd` is the folder the script may write. */
export function isolate(cmd, args, { cwd } = {}) {
  const level = isolationLevel();
  if (level !== 'sandbox') return [cmd, args, level];
  if (platformOf() === 'linux') return ['bwrap', [...bwrapProfile(cwd || process.cwd()), '--', cmd, ...args], 'sandbox'];
  return ['sandbox-exec', ['-p', sandboxProfile(), cmd, ...args], 'sandbox'];
}
