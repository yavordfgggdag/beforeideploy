// Before I Deploy V6 — shared engine helpers
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { t, msg, isMsg } from './i18n.mjs';
import * as platform from './platform/index.mjs';

export const HOME = os.homedir();
// per OS (platform/index.mjs dirs): macOS ~/Library/…/BeforeIDeploy, Linux XDG …/before-i-deploy,
// Windows %APPDATA% / %LOCALAPPDATA%\BeforeIDeploy; BID_APP_DIR / BID_CACHE_DIR override everywhere
const DIRS = platform.dirs();
export const APP_DIR = DIRS.appDir;
export const CACHE_DIR = DIRS.cacheDir;
// fileURLToPath decodes %20 etc. — the installed engine lives under "Application Support"
export const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// ---------------------------------------------------------------- network

/**
 * fetch with a deadline (WP02, audit E7). The timer covers the request and the response headers; bodies are
 * read by the caller (streams get their own idle timeout, ai/providers.mjs). A timeout rejects with an Error
 * whose code is ETIMEDOUT, so the callers' existing network-error handling reports it.
 */
export async function fetchT(url, opts = {}, timeoutMs = Number(process.env.BID_FETCH_TIMEOUT_MS) || 20000) {
  const ctl = new AbortController();
  const outer = opts.signal;
  if (outer?.aborted) ctl.abort();
  else if (outer) outer.addEventListener('abort', () => ctl.abort(), { once: true });
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    res.abortController = ctl;
    return res;
  } catch (e) {
    if (ctl.signal.aborted && !outer?.aborted) throw Object.assign(new Error(`timed out after ${Math.round(timeoutMs / 1000)} s`), { code: 'ETIMEDOUT', name: 'TimeoutError' });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** A cloud function's shared rate limit (WP03) → one clear engine error, whatever the function. */
export function throwIfRateLimited(res, data) {
  if (res.status === 429 && data?.code === 'rate_limited') throw new EngineError(msg('cloud.rateLimited', { seconds: data.windowSeconds || 60 }), 'rate_limited');
  if (res.status === 503 && data?.code === 'rate_limit_unavailable') throw new EngineError(msg('cloud.rateLimitUnavailable'), 'rate_limited');
}

/**
 * Appends one line and keeps the file bounded (WP02, audit E11): past maxBytes only the last keepLines lines
 * stay. Append-only logs (costs ledger, assistant history) must not grow for years.
 */
export function appendBounded(file, line, { maxBytes = 2 * 1024 * 1024, keepLines = 10000, mode } = {}) {
  fs.appendFileSync(file, line.endsWith('\n') ? line : line + '\n', mode ? { mode } : undefined);
  try {
    if (fs.statSync(file).size > maxBytes) {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      fs.writeFileSync(file, lines.slice(-keepLines).join('\n') + '\n', mode ? { mode } : undefined);
    }
  } catch {}
}

/** Removes files in `dir` matching `re`: all but the newest `keep`, and any older than `maxAgeDays`. */
export function pruneFiles(dir, re, { keep = Infinity, maxAgeDays = Infinity } = {}) {
  let list = [];
  try {
    list = fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => {
      const p = path.join(dir, f);
      return { p, t: fs.statSync(p).mtimeMs };
    });
  } catch {
    return 0;
  }
  list.sort((a, b) => b.t - a.t);
  const cutoff = Date.now() - maxAgeDays * 86400000;
  let n = 0;
  list.forEach((e, i) => {
    if (i >= keep || e.t < cutoff) {
      try {
        fs.rmSync(e.p, { recursive: true, force: true });
        n++;
      } catch {}
    }
  });
  return n;
}

// ---------------------------------------------------------------- output

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/**
 * Exits once stdout has drained. On macOS (and whenever stdout is a pipe) writes are asynchronous, so a
 * plain process.exit() right after a large result line (e.g. `bid logs`) cut the output at 64 KB.
 */
export function exitAfterFlush(code = 0) {
  const c = typeof code === 'number' ? code : 0;
  process.stdout.write('', () => process.exit(c));
}

export const ev = {
  step: (id, fields = {}) => emit({ type: 'step', id, ...fields }),
  log: (step, line) => emit({ type: 'log', step, line }),
  info: (message) => emit({ type: 'info', message }),
  notify: (title, body, url) => emit({ type: 'notify', title, body, url: url || null }),
};

export class EngineError extends Error {
  /** `message` is plain text or `msg(key, params)`; a key is translated with BID_LANG and kept for the app. */
  constructor(message, code = 'error', exitCode = 1) {
    super(isMsg(message) ? t(message.key, message.params) : message);
    this.code = code;
    this.exitCode = exitCode;
    this.key = isMsg(message) ? message.key : null;
    this.params = isMsg(message) ? message.params : null;
  }
}

export function ok(data) {
  emit({ type: 'result', ok: true, data: data === undefined ? null : data });
}

export function fail(err) {
  const message = err?.message || String(err);
  const out = { type: 'result', ok: false, error: message, code: err?.code || 'error' };
  if (err?.key) {
    out.key = err.key;
    if (err.params) out.params = err.params;
  }
  if (typeof err?.resetsAt === 'string') out.resetsAt = err.resetsAt;
  emit(out);
  return err?.exitCode || 1;
}

// ---------------------------------------------------------------- data

export function projectKey(p) {
  return crypto.createHash('sha1').update(path.resolve(p)).digest('hex').slice(0, 12);
}

export function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJSON(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function logDir(key) {
  return ensureDir(path.join(CACHE_DIR, key));
}

export function nowISO() {
  return new Date().toISOString();
}

export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '').replace(/\r/g, '');
}

// ---------------------------------------------------------------- args

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const name = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[name] = next;
          i++;
        } else {
          flags[name] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ---------------------------------------------------------------- processes

/** Path of a program on PATH, or null — a pure-Node PATH walk (PATHEXT on Windows), no shell. */
export function which(cmd) {
  return platform.which(cmd);
}

export function sh(cmd, args, opts = {}) {
  // Windows: `.cmd` shims run through cmd.exe with strict quoting (platform.spawnSpec); POSIX: unchanged
  const spec = platform.spawnSpec(cmd, args, { env: opts.env || process.env });
  const r = spawnSync(spec.command, spec.args, {
    ...spec.options,
    encoding: 'utf8',
    cwd: opts.cwd,
    env: opts.env || process.env,
    timeout: opts.timeout || 60000,
    maxBuffer: 64 * 1024 * 1024,
    input: opts.input,
  });
  return {
    code: r.status ?? (r.error ? 127 : 1),
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error,
  };
}

// every running child: lint and typecheck run in parallel, a cancel must stop all of them (audit E5)
const children = new Set();
// Spawn listeners (the setup lock records its children so a later run can stop orphans of a killed engine).
const spawnListeners = new Set();
export function onChildSpawn(fn) {
  spawnListeners.add(fn);
  return () => spawnListeners.delete(fn);
}

/** Kills a process group by leader pid (an orphan left by a killed engine); Windows: taskkill /T. */
export function killGroup(pid, signal = 'SIGKILL') {
  return platform.killTree(pid, signal);
}

function killTree(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  if (!platform.killTree(child.pid, signal)) {
    try {
      child.kill(signal);
    } catch {}
  }
}

// Cancel (audit B1): every child process group gets SIGTERM at once and SIGKILL after CANCEL_GRACE_MS, then
// the engine reports `cancelled` and exits, so the `exit` handlers (staging cleanup, lock release) run well
// before the app's own SIGKILL deadline (Engine.swift EngineHandle.cancel, 8 s).
export const CANCEL_GRACE_MS = 1500;
let cancelling = false;
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    if (cancelling) return;
    cancelling = true;
    const running = [...children];
    for (const c of running) killTree(c, 'SIGTERM');
    const finish = () => {
      for (const c of new Set([...running, ...children])) killTree(c, 'SIGKILL');
      emit({ type: 'result', ok: false, error: t('run.cancelled'), code: 'cancelled', key: 'run.cancelled' });
      exitAfterFlush(130);
    };
    if (running.length) setTimeout(finish, CANCEL_GRACE_MS); else finish();
  });
}

/**
 * Runs a command, streaming its output as log events.
 * stdout+stderr are merged into the log unless `captureStdout` is set,
 * in which case stdout is collected separately (still written to the log file).
 */
export function runStream(cmd, args, { cwd, env, logFile, step, captureStdout = false, timeout = 0, quiet = false, display = null, input = false, onChunk, onLine } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const logStream = logFile ? fs.createWriteStream(logFile, { flags: 'w' }) : null;
    // `display` keeps wrapper arguments (the sandbox profile) and anything sensitive out of the log header
    if (logStream) logStream.write(`$ ${display || `${cmd} ${args.join(' ')}`}\n# ${cwd || process.cwd()}\n# ${new Date().toString()}\n\n`);

    // a cancel in progress: never start new work (the next setup step) in the grace window
    if (cancelling) {
      if (logStream) logStream.end(`${t('run.cancelled')}\n`);
      return resolve({ code: 130, stdout: '', tail: [t('run.cancelled')], duration: 0 });
    }
    let child;
    try {
      const fullEnv = { FORCE_COLOR: '0', NO_COLOR: '1', ...(env || process.env) };
      // the child's own PATH finds the program (Windows resolves `.cmd` shims through it)
      const spec = platform.spawnSpec(cmd, args, { env: fullEnv });
      child = spawn(spec.command, spec.args, {
        ...spec.options,
        cwd,
        env: fullEnv,
        stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        // a process group on POSIX (cancel stops the whole tree); Windows: taskkill /T, no new console
        ...platform.groupOptions(),
      });
    } catch (e) {
      if (logStream) logStream.end(String(e));
      return resolve({ code: 127, stdout: '', tail: [String(e.message)], duration: 0 });
    }
    children.add(child);
    for (const fn of spawnListeners) { try { fn(child); } catch {} }
    child.stdin?.on('error', () => {});

    const tail = [];
    let stdoutBuf = '';
    const partial = { out: '', err: '' };

    const pushLine = (line) => {
      const clean = stripAnsi(line);
      if (!clean.trim()) return;
      tail.push(clean);
      if (tail.length > 200) tail.shift();
      if (!quiet) ev.log(step || 'run', clean);
      onLine?.(clean);
    };

    const onData = (which) => (chunk) => {
      const s = chunk.toString();
      onChunk?.(s, child.stdin);
      if (logStream) logStream.write(s);
      if (which === 'out' && captureStdout) {
        stdoutBuf += s;
        return;
      }
      partial[which] += s;
      const lines = partial[which].split('\n');
      partial[which] = lines.pop();
      lines.forEach(pushLine);
    };

    child.stdout.on('data', onData('out'));
    child.stderr.on('data', onData('err'));

    let timer = null;
    if (timeout > 0) {
      timer = setTimeout(() => {
        pushLine(t('run.timeout', { seconds: Math.round(timeout / 1000) }));
        killTree(child, 'SIGTERM');
        // a tool that ignores SIGTERM (watch modes, stuck servers) must not hang the check forever
        setTimeout(() => killTree(child, 'SIGKILL'), 5000).unref();
      }, timeout);
    }

    child.on('error', (e) => pushLine(String(e.message)));
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (partial.out) pushLine(partial.out);
      if (partial.err) pushLine(partial.err);
      children.delete(child);
      const done = () =>
        resolve({ code: code ?? 1, stdout: stdoutBuf, tail, duration: (Date.now() - started) / 1000 });
      if (logStream) logStream.end(`\n# exit ${code}\n`, done);
      else done();
    });
  });
}

// ---------------------------------------------------------------- network

export function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

// a port is usable only if we can bind it AND nothing already answers HTTP there
// (an orphaned server bound to another interface can pass the bind test on macOS)
async function usable(port) {
  return (await portFree(port)) && !(await httpAlive(`http://127.0.0.1:${port}`, 400)) && !(await httpAlive(`http://localhost:${port}`, 400));
}

export async function findFreePort(preferred) {
  if (preferred && (await usable(preferred))) return preferred;
  for (let p = 4173; p < 4300; p++) {
    if (await usable(p)) return p;
  }
  throw new EngineError(msg('local.noFreePort', { from: 4173, to: 4300 }));
}

export function httpAlive(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * When a process started (`ps -o lstart`), normalised to seconds — with the pid it identifies one process
 * instance, so a lock left by a dead process whose pid was reused is not mistaken for a live holder.
 * null when ps cannot tell (the caller then falls back to pidAlive alone).
 */
// absolute path: the caller's PATH can be minimal (Finder, tests), and lock identity must not depend on it
const PS = ['/bin/ps', '/usr/bin/ps'].find(f => fs.existsSync(f)) || 'ps';
export function pidStartTime(pid) {
  if (!pid || platform.isWindows()) return null; // Windows: no ps — locks fall back to pid + liveness
  const r = spawnSync(PS, ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 5000 });
  const text = (r.stdout || '').trim();
  if (r.status !== 0 || !text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.round(ms / 1000) : text;
}

/** pidAlive + the start time recorded when the lock was taken: a reused pid does not count as the holder. */
export function processHolds(lock) {
  if (!lock?.pid || !pidAlive(lock.pid)) return false;
  if (lock.pidStart === undefined || lock.pidStart === null) return true;
  const now = pidStartTime(lock.pid);
  return now === null || now === lock.pidStart;
}

/**
 * Which entries of a folder a publish sends (stagePublicCopy and the artifact manifest agree on this):
 * no dotfiles except .well-known, never node_modules; a site published from the project root also leaves
 * the tooling files behind.
 */
const ROOT_TOOLING = new Set(['node_modules', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bid.config.json']);
export function publishIncludes(name, { root = false } = {}) {
  if (name.startsWith('.') && name !== '.well-known') return false;
  if (name === 'node_modules') return false;
  if (root && ROOT_TOOLING.has(name)) return false;
  return true;
}

export function extractJSON(text) {
  if (!text) return null;
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  const candidates = [];
  if (firstObj > -1) candidates.push([firstObj, text.lastIndexOf('}')]);
  if (firstArr > -1) candidates.push([firstArr, text.lastIndexOf(']')]);
  candidates.sort((a, b) => a[0] - b[0]);
  for (const [s, e] of candidates) {
    if (e > s) {
      try {
        return JSON.parse(text.slice(s, e + 1));
      } catch {}
    }
  }
  return null;
}
