// macOS specifics of the platform layer (index.mjs). Everything here is what the engine always did on a Mac:
// ~/Library folders, the zsh `.command` scripts Terminal opens, the launchd agent. Keychain and sandbox-exec
// stay in secrets.mjs / isolation.mjs. Pure functions; no engine imports.
import path from 'node:path';

const P = path.posix;
export const name = 'darwin';

export function dirs(env, home) {
  const appDir = P.join(home, 'Library', 'Application Support', 'BeforeIDeploy');
  return { appDir, cacheDir: P.join(home, 'Library', 'Caches', 'BeforeIDeploy'), configDir: appDir };
}

/** The usual install places, after the user's own PATH (audit E12) — the order the zsh launcher used. */
export function extraPathDirs(env, home) {
  return [
    `${home}/.volta/bin`, `${home}/.asdf/shims`, '/opt/homebrew/bin', '/usr/local/bin', `${home}/.bun/bin`,
    `${home}/.local/bin`, `${home}/Library/pnpm`, `${home}/.npm-global/bin`, '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ];
}

/** Forced like the zsh launcher did: tools print English, parseable output. */
export const locale = () => ({ LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' });

/** Runtime folders from before the platform key (scripts/bundle-node.sh: runtime/arm64, runtime/x86_64). */
export const legacyRuntimeNames = (arch) => [arch === 'x64' ? 'x86_64' : arch];

export const terminalExt = '.command';

export const shQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

/**
 * A zsh `.command` file the app opens in Terminal. Byte-for-byte the scripts setup.mjs and aifix.mjs wrote
 * before the platform layer (tests/platform.mjs pins this).
 */
export function renderTerminal({ title, envFile, cwd, steps = [], done }) {
  const lines = ['#!/bin/zsh', `# Before I Deploy — ${title}`];
  if (envFile) lines.push(`[ -f ${shQuote(envFile)} ] && source ${shQuote(envFile)}`);
  if (cwd) lines.push(`cd ${shQuote(cwd)} || exit 1`);
  lines.push('clear');
  for (const s of steps) lines.push(posixStep(s));
  if (done) lines.push('echo', `echo ${shQuote(done)}`);
  return lines.join('\n') + '\n';
}

/** One script step in POSIX shell syntax (shared with linux.mjs). */
export function posixStep(s) {
  if (s.blank) return 'echo';
  if (s.echo !== undefined) return `echo "${s.echo}"`;
  if (s.raw !== undefined) return s.raw;
  if (s.runWithFile) return `${s.runWithFile[0]} "$(cat ${shQuote(s.runWithFile[1])})"`;
  if (s.run) return s.run.map((a, i) => (i === 0 && /^[\w.-]+$/.test(a) ? a : shQuote(a))).join(' ');
  return '';
}

/** The app opens `.command` files itself (NSWorkspace); the engine never launches Terminal. */
export const terminalLaunchers = () => [];

/** Release feed asset keys, in order of preference (the feed's top-level url is the DMG, as before). */
export const updateAssetKeys = () => ['darwin-universal'];
export const updateFileExt = () => '.dmg';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** launchd agent for `bid monitor once` (values XML-escaped: a path with & or < must not break the plist). */
export function launchdPlist({ label, bid, intervalSec, logFile }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>${xml(bid)}</string><string>monitor</string><string>once</string></array>
  <key>EnvironmentVariables</key><dict><key>BID_MONITOR_AGENT</key><string>1</string></dict>
  <key>StartInterval</key><integer>${intervalSec}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict></plist>
`;
}
