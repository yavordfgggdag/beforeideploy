// Windows specifics of the platform layer (index.mjs): %APPDATA% / %LOCALAPPDATA% folders, PATHEXT,
// cmd.exe quoting for `.cmd` / `.bat` shims, `.cmd` terminal scripts, Task Scheduler and the DPAPI
// PowerShell used by secrets.mjs. Pure functions (path.win32 everywhere), so tests/platform.mjs runs them on
// Linux and macOS.
import path from 'node:path';

const W = path.win32;
export const name = 'win32';

export function dirs(env, home) {
  const roaming = env.APPDATA || W.join(home, 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA || W.join(home, 'AppData', 'Local');
  const appDir = W.join(roaming, 'BeforeIDeploy');
  return { appDir, cacheDir: W.join(local, 'BeforeIDeploy', 'Cache'), configDir: appDir };
}

export function extraPathDirs(env, home) {
  const roaming = env.APPDATA || W.join(home, 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA || W.join(home, 'AppData', 'Local');
  const pf = env.ProgramFiles || env.PROGRAMFILES || 'C:\\Program Files';
  const sys = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  return [
    W.join(roaming, 'npm'), W.join(local, 'pnpm'), W.join(local, 'Volta', 'bin'), W.join(home, '.bun', 'bin'),
    W.join(pf, 'nodejs'), W.join(pf, 'Git', 'cmd'), W.join(local, 'Programs', 'Git', 'cmd'),
    W.join(sys, 'System32'), sys, W.join(sys, 'System32', 'Wbem'), W.join(sys, 'System32', 'WindowsPowerShell', 'v1.0'),
  ];
}

export const locale = () => ({});
export const legacyRuntimeNames = () => [];

/** PATHEXT as a list of lower-case extensions (the documented default when unset). */
export function pathExts(env) {
  const raw = env.PATHEXT || env.Pathext || '.COM;.EXE;.BAT;.CMD';
  return raw.split(';').map((e) => e.trim().toLowerCase()).filter((e) => e.startsWith('.'));
}

// ---------------------------------------------------------------- cmd.exe quoting
// Node refuses to spawn `.cmd` / `.bat` without a shell since CVE-2024-27980. We run them as
// `cmd.exe /d /s /c "<line>"` with windowsVerbatimArguments and quote every argument ourselves, the way
// cross-spawn does: first the MSVCRT rules (what the program's argv parser undoes), then a caret before every
// cmd.exe metacharacter. A batch file that forwards %* / %1 re-parses the expanded text (and an odd number of
// quotes in one argument flips the quote state for the rest), so for any `.cmd` / `.bat` the carets go on twice.

const META = /([()\][%!^"`<>&|;, *?])/g;

/** Quotes one argument for CommandLineToArgvW / the MSVCRT parser. */
export function argvQuote(arg) {
  let s = String(arg);
  s = s.replace(/(\\*)"/g, '$1$1\\"'); // backslashes before a quote are doubled, the quote escaped
  s = s.replace(/(\\*)$/, '$1$1'); // trailing backslashes doubled (the closing quote follows)
  return `"${s}"`;
}

/** One argument for a cmd.exe command line. */
export function cmdArg(arg, doubleEscape = false) {
  let s = argvQuote(arg).replace(META, '^$1');
  if (doubleEscape) s = s.replace(META, '^$1');
  return s;
}

/** The command itself (a path) for a cmd.exe command line. */
export const cmdCommand = (file) => String(file).replace(META, '^$1');

export const isCmdShim = (file) => /\.(cmd|bat)$/i.test(file);

/** [command, args, options] that run a `.cmd` / `.bat` through cmd.exe without a Node shell. */
export function shimSpawn(file, args, env = {}) {
  const line = [cmdCommand(W.normalize(file)), ...args.map((a) => cmdArg(a, true))].join(' ');
  const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe';
  return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true, windowsHide: true } };
}

// ---------------------------------------------------------------- terminal (.cmd)

/** Text for `echo` inside a batch file: carets before metacharacters, % doubled. */
export const batchEcho = (s) => (String(s) ? `echo ${String(s).replace(/%/g, '%%').replace(/([\^&|<>()])/g, '^$1')}` : 'echo.');
/** A double-quoted batch argument (paths cannot contain "); % doubled so no variable expands. */
export const batchQuote = (s) => `"${String(s).replace(/%/g, '%%').replace(/"/g, '')}"`;
/** A single-quoted PowerShell string. */
export const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

export const terminalExt = '.cmd';

function cmdStep(s) {
  if (s.blank) return 'echo.';
  if (s.echo !== undefined) return batchEcho(s.echo);
  if (s.raw !== undefined) return s.cmd ?? `rem ${String(s.raw).replace(/[\r\n]+/g, ' ')}`;
  if (s.runWithFile) {
    // cmd.exe cannot pass a whole file as one argument; PowerShell reads it and calls the CLI
    const ps = `& ${psQuote(s.runWithFile[0])} (Get-Content -Raw -Encoding UTF8 -LiteralPath ${psQuote(s.runWithFile[1])})`;
    return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${batchQuote(ps)}`;
  }
  if (s.run) return `call ${s.run.map((a, i) => (i === 0 && /^[\w.-]+$/.test(a) ? a : batchQuote(a))).join(' ')}`;
  return '';
}

/** A `.cmd` script (UTF-8 code page, so Bulgarian text is readable); it pauses before the window closes. */
export function renderTerminal({ title, envFile, cwd, steps = [], done, pause }) {
  const lines = ['@echo off', 'chcp 65001 >nul', `rem Before I Deploy — ${title}`];
  if (envFile) lines.push(`if exist ${batchQuote(envFile)} call ${batchQuote(envFile)}`);
  if (cwd) lines.push(`cd /d ${batchQuote(cwd)} || exit /b 1`);
  lines.push('cls');
  for (const s of steps) lines.push(cmdStep(s));
  if (done) lines.push('echo.', batchEcho(done));
  if (pause) lines.push(batchEcho(pause), 'pause >nul');
  return lines.join('\r\n') + '\r\n';
}

/** `start` opens a new console window for the script ("" is the window title). */
export const terminalLaunchers = (env = {}) => [[env.ComSpec || env.COMSPEC || 'cmd.exe', '/d', '/c', 'start', '""']];

export const updateAssetKeys = (arch) => [`win32-${arch}-msi`, `win32-${arch}-msix`, `win32-${arch}-exe`];
export const updateFileExt = (key) => (key.endsWith('-msix') ? '.msix' : key.endsWith('-exe') ? '.exe' : '.msi');

// ---------------------------------------------------------------- Task Scheduler (monitor agent)

/** A hidden launcher: wscript runs the .cmd without flashing a console every few minutes. */
export function schedulerFiles({ bid, logFile, cmdFile }) {
  const cmd = ['@echo off', 'set BID_MONITOR_AGENT=1', `call ${batchQuote(bid)} monitor once >> ${batchQuote(logFile)} 2>&1`].join('\r\n') + '\r\n';
  const vbs = `CreateObject("WScript.Shell").Run """" & "${String(cmdFile).replace(/"/g, '""')}" & """", 0, False\r\n`;
  return { cmd, vbs };
}

/** schtasks arguments (no admin rights: the task runs as the signed-in user). */
export function schtasksCreateArgs({ task, vbsFile, intervalMin }) {
  return ['/Create', '/F', '/SC', 'MINUTE', '/MO', String(intervalMin), '/TN', task, '/TR', `wscript.exe //B //Nologo "${vbsFile}"`];
}

// ---------------------------------------------------------------- DPAPI (secrets.mjs)

/**
 * PowerShell for DPAPI (CurrentUser scope, an app-specific entropy). The data travels base64 over stdin,
 * never argv; the script itself goes as -EncodedCommand (UTF-16LE base64), so no quoting can break it.
 */
export function dpapiScript(op) {
  const fn = op === 'protect' ? 'Protect' : 'Unprotect';
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Security',
    '$in = [Console]::In.ReadToEnd().Trim()',
    "$entropy = [Text.Encoding]::UTF8.GetBytes('BeforeIDeploy')",
    `$out = [Security.Cryptography.ProtectedData]::${fn}([Convert]::FromBase64String($in), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '[Console]::Out.Write([Convert]::ToBase64String($out))',
  ].join('; ');
}

export const encodePowerShell = (script) => Buffer.from(script, 'utf16le').toString('base64');

export function powershellExe(env = {}) {
  const sys = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  return W.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
