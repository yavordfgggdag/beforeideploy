// Linux specifics of the platform layer (index.mjs): XDG folders, `.sh` terminal scripts, systemd --user
// timers, bubblewrap arguments and the libsecret (`secret-tool`) command lines. Pure functions; no engine
// imports. Other POSIX systems (FreeBSD …) get this behaviour too.
import path from 'node:path';
import { posixStep, shQuote } from './darwin.mjs';

const P = path.posix;
export const name = 'linux';
const FOLDER = 'before-i-deploy';

/** An XDG variable counts only when it is an absolute path (the spec says relative values are invalid). */
const xdg = (env, key, fallback) => (env[key] && P.isAbsolute(env[key]) ? env[key] : fallback);

export function dirs(env, home) {
  return {
    appDir: P.join(xdg(env, 'XDG_DATA_HOME', P.join(home, '.local', 'share')), FOLDER),
    cacheDir: P.join(xdg(env, 'XDG_CACHE_HOME', P.join(home, '.cache')), FOLDER),
    configDir: P.join(xdg(env, 'XDG_CONFIG_HOME', P.join(home, '.config')), FOLDER),
  };
}

export function extraPathDirs(env, home) {
  return [
    `${home}/.volta/bin`, `${home}/.asdf/shims`, '/home/linuxbrew/.linuxbrew/bin', '/usr/local/bin', `${home}/.bun/bin`,
    `${home}/.local/bin`, P.join(xdg(env, 'XDG_DATA_HOME', `${home}/.local/share`), 'pnpm'), `${home}/.npm-global/bin`,
    '/usr/bin', '/bin', '/usr/sbin', '/sbin', '/snap/bin',
  ];
}

/** Forced like macOS (en_US there): tools print English, parseable output. C.UTF-8 exists on every current
 * glibc/musl system; en_US.UTF-8 is often not generated. */
export const locale = () => ({ LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' });

export const legacyRuntimeNames = () => [];

export const terminalExt = '.sh';
export { shQuote };

/** A POSIX `.sh` script for a terminal emulator; it waits for Enter so the window does not vanish. */
export function renderTerminal({ title, envFile, cwd, steps = [], done, pause }) {
  const lines = ['#!/bin/sh', `# Before I Deploy — ${title}`];
  if (envFile) lines.push(`[ -f ${shQuote(envFile)} ] && . ${shQuote(envFile)}`);
  if (cwd) lines.push(`cd ${shQuote(cwd)} || exit 1`);
  lines.push('clear');
  for (const s of steps) lines.push(posixStep(s));
  if (done) lines.push('echo', `echo ${shQuote(done)}`);
  if (pause) lines.push(`printf '%s' ${shQuote(pause)}`, 'read _bid_wait');
  return lines.join('\n') + '\n';
}

/** Terminal emulators to try, best effort, in order: [command, ...args before the script]. */
export const terminalLaunchers = () => [
  ['x-terminal-emulator', '-e'],
  ['gnome-terminal', '--'],
  ['konsole', '-e'],
  ['xfce4-terminal', '-x'],
  ['xterm', '-e'],
];

export const updateAssetKeys = (arch, format) =>
  format === 'deb' ? [`linux-${arch}-deb`, `linux-${arch}-appimage`] : [`linux-${arch}-appimage`, `linux-${arch}-deb`];
export const updateFileExt = (key) => (key.endsWith('-deb') ? '.deb' : '.AppImage');

// ---------------------------------------------------------------- systemd --user timer (monitor agent)

/** systemd quoting for ExecStart: double quotes, backslash escapes, `%` doubled (specifier syntax). */
export const systemdQuote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;

export function systemdUnits({ unit, bid, intervalMin, logFile }) {
  const service = `[Unit]
Description=Before I Deploy — site monitor

[Service]
Type=oneshot
Environment=BID_MONITOR_AGENT=1
ExecStart=${systemdQuote(bid)} monitor once
StandardOutput=append:${logFile.replace(/%/g, '%%')}
StandardError=append:${logFile.replace(/%/g, '%%')}
`;
  const timer = `[Unit]
Description=Before I Deploy — site monitor every ${intervalMin} min

[Timer]
OnBootSec=1min
OnUnitActiveSec=${intervalMin}min
Unit=${unit}.service

[Install]
WantedBy=timers.target
`;
  return { service, timer };
}

// ---------------------------------------------------------------- bubblewrap (project scripts)

/**
 * bwrap arguments for a project script: the whole system read-only, the project, temp and the package
 * managers' caches writable, the engine's own folders and the session bus (Secret Service) replaced by empty
 * tmpfs. Network stays shared (installs need it). No --new-session: the engine stops the script through its
 * process group. `exists` decides which optional folders are bound.
 */
export function bwrapArgs({ cwd, home, denied = [], writable = [], readOnly = [], runtimeDir, exists = () => true }) {
  // /tmp stays the real one (tools and tests pass files through it); the engine keeps nothing there
  const a = ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--bind', '/tmp', '/tmp', '--die-with-parent'];
  const caches = [`${home}/.npm`, `${home}/.cache`, `${home}/.yarn`, `${home}/.pnpm-store`, `${home}/.local/share/pnpm`, `${home}/.bun`];
  for (const d of [...caches, ...writable]) if (d && exists(d)) a.push('--bind', d, d);
  for (const d of denied) if (d) a.push('--tmpfs', d);
  if (runtimeDir) a.push('--tmpfs', runtimeDir);
  // programs inside a denied folder that scripts may run (the bundled Node, managed CLIs), never the data
  for (const d of readOnly) if (d && exists(d)) a.push('--ro-bind', d, d);
  // last: a project inside a denied folder (a staging copy) is still reachable
  if (cwd) a.push('--bind', cwd, cwd, '--chdir', cwd);
  return a;
}

// ---------------------------------------------------------------- libsecret

export const secretAttrs = (service, account) => ['service', service, 'account', account];
