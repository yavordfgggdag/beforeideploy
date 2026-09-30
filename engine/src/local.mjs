// Local Preview: start / stop / restart / status
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { ENGINE_DIR, EngineError, ev, findFreePort, httpAlive, logDir, nowISO, pidAlive, sleep, exists, sh, which } from './util.mjs';

/** Start time of a process as `ps` prints it — with the pid it identifies the process even after pid reuse. */
function procStart(pid) {
  if (!pid) return null;
  const r = sh('ps', ['-o', 'lstart=', '-p', String(pid)]);
  return r.code === 0 ? r.stdout.trim() || null : null;
}

/** The saved pid is still the server we started — not another program that got the same pid later (audit E8). */
function ourProcess(st) {
  if (!st?.pid || !pidAlive(st.pid)) return false;
  return !st.procStart || procStart(st.pid) === st.procStart;
}
import { detect, pmRunArgs } from './detect.mjs';
import { scriptEnv, isolate } from './isolation.mjs';
import { getState, setState, updateProject } from './store.mjs';
import { t, msg } from './i18n.mjs';

export function localStatus(project) {
  const st = getState(project.key).local;
  if (st?.pid && ourProcess(st)) {
    return { running: true, ...st };
  }
  if (st) setState(project.key, { local: undefined });
  return { running: false };
}

// ---------------------------------------------------------------- orphans (WP6.4)
// A static preview server outlives the app when the app is killed. It answers with X-BID-Project, so a
// later `start` adopts it instead of failing on a busy port, and `stop` can shut it down via its endpoint.

const PORT_FROM = 4173;
const PORT_TO = 4300;

function probe(url, { method = 'HEAD', headers = {}, timeout = 400 } = {}) {
  return new Promise((resolve) => {
    const req = http.request(url, { method, headers, timeout }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, headers: res.headers });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function pidOnPort(port) {
  if (!which('lsof')) return null;
  const r = sh('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { timeout: 5000 });
  const pid = Number(r.stdout.trim().split('\n')[0]);
  return r.code === 0 && pid > 0 ? pid : null;
}

/** Scans the preview port range for a static server that reports this project's key. */
export async function findOrphan(project) {
  for (let port = PORT_FROM; port < PORT_TO; port++) {
    const url = `http://127.0.0.1:${port}`;
    const r = await probe(url);
    if (r?.headers?.['x-bid-project'] === project.key) return { port, url, pid: pidOnPort(port) };
  }
  return null;
}

async function adoptOrphan(project) {
  const orphan = await findOrphan(project);
  if (!orphan) return null;
  const state = { pid: orphan.pid, port: orphan.port, url: orphan.url, mode: 'build', label: t('local.adoptedLabel'), adopted: true, startedAt: nowISO(), log: null, procStart: procStart(orphan.pid) };
  setState(project.key, { local: state });
  updateProject(project.key, { lastPort: orphan.port });
  ev.step('local', { label: 'Local Preview', status: 'pass', summary: t('local.adopted', { port: orphan.port }) });
  return { running: true, ...state };
}

function plan(project, d, port, mode, stopToken = '') {
  const dir = project.path;
  const staticDir = path.resolve(dir, d.publishDir || '.');
  const canStatic = !d.ssr && exists(path.join(staticDir, 'index.html'));
  const has = (s) => d.scripts?.includes(s);

  const devArgs = () => {
    switch (d.framework) {
      case 'next':
        return ['-p', String(port), '-H', '127.0.0.1'];
      case 'cra':
        return [];
      case 'gatsby':
        return ['-p', String(port), '-H', '127.0.0.1'];
      case 'nuxt':
        return ['--port', String(port), '--host', '127.0.0.1'];
      case 'eleventy':
        return ['--port', String(port)];
      default:
        return ['--port', String(port), '--host', '127.0.0.1'];
    }
  };

  if (mode === 'build' || mode === 'auto') {
    if (canStatic) {
      return {
        mode: 'build',
        label: `Build output (${d.publishDir})`,
        cmd: process.execPath,
        args: [path.join(ENGINE_DIR, 'src', 'static-server.cjs'), staticDir, String(port), project.key],
      };
    }
    if (mode === 'build' && has('preview')) {
      const [cmd, args] = pmRunArgs(d.packageManager, 'preview', devArgs());
      return { mode: 'build', label: 'preview script', cmd, args };
    }
    if (mode === 'build' && has('start')) {
      const [cmd, args] = pmRunArgs(d.packageManager, 'start', d.framework === 'next' ? ['-p', String(port)] : []);
      return { mode: 'build', label: 'start script', cmd, args };
    }
    if (mode === 'build') throw new EngineError(msg('local.noBuild'), 'no_build');
  }

  if (has('dev')) {
    const [cmd, args] = pmRunArgs(d.packageManager, 'dev', devArgs());
    return { mode: 'dev', label: 'dev server', cmd, args };
  }
  if (has('start')) {
    const [cmd, args] = pmRunArgs(d.packageManager, 'start', []);
    return { mode: 'dev', label: 'start script', cmd, args };
  }
  if (has('preview')) {
    const [cmd, args] = pmRunArgs(d.packageManager, 'preview', devArgs());
    return { mode: 'dev', label: 'preview script', cmd, args };
  }
  if (exists(path.join(dir, 'index.html'))) {
    return {
      mode: 'build',
      label: 'static files',
      cmd: process.execPath,
      args: [path.join(ENGINE_DIR, 'src', 'static-server.cjs'), dir, String(port), project.key],
    };
  }
  throw new EngineError(msg('local.noServer'), 'no_server');
}

export async function localStart(project, { mode = 'auto' } = {}) {
  const cur = localStatus(project);
  if (cur.running) return cur;
  const adopted = await adoptOrphan(project);
  if (adopted) return adopted;

  const d = detect(project.path);
  const port = await findFreePort(project.lastPort);
  const stopToken = crypto.randomBytes(16).toString('hex');
  const p = plan(project, d, port, mode, stopToken);
  const logFile = path.join(logDir(project.key), 'local.log');
  const fd = fs.openSync(logFile, 'w');
  fs.writeSync(fd, `$ ${p.cmd} ${p.args.join(' ')}\n# ${nowISO()}\n\n`);

  ev.step('local', { label: 'Local Preview', status: 'running', summary: t('local.starting', { label: p.label, port }) });

  // a dev server is the project's own code: isolated like a check; the static server is ours and gets the
  // stop token through the environment, never argv (visible in `ps`) or the log header
  const own = p.cmd === process.execPath;
  const [cmd, args] = own ? [p.cmd, p.args] : isolate(p.cmd, p.args);
  const child = spawn(cmd, args, {
    cwd: project.path,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: own ? { ...scriptEnv(), PORT: String(port), HOST: '127.0.0.1', BID_STOP_TOKEN: stopToken } : scriptEnv({ PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none' }),
  });
  child.unref();
  fs.closeSync(fd);

  let url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (!pidAlive(child.pid)) break;
    if (await httpAlive(url)) {
      ready = true;
      break;
    }
    // dev servers sometimes pick another port — read it from the log
    if (i > 4 && i % 3 === 0) {
      const log = fs.readFileSync(logFile, 'utf8');
      const m = log.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})/g);
      if (m) {
        const alt = m[m.length - 1].replace('localhost', '127.0.0.1');
        if (alt !== url && (await httpAlive(alt))) {
          url = alt;
          ready = true;
          break;
        }
      }
    }
    await sleep(500);
  }

  if (!ready) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
    const tail = fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-20);
    ev.step('local', { label: 'Local Preview', status: 'fail', summary: t('local.stepFailed'), details: tail, log: logFile });
    const lines = tail.filter((l) => l.trim() && !l.startsWith('$') && !l.startsWith('#') && !/^Node\.js v\d/.test(l.trim()));
    const last = lines.find((l) => /error/i.test(l)) || lines.slice(-1)[0];
    throw new EngineError(last ? msg('local.failedWithReason', { reason: last.trim().slice(0, 200) }) : msg('local.failedSeeLog'), 'local_failed');
  }

  const realPort = Number(new URL(url).port);
  const state = { pid: child.pid, port: realPort, url, mode: p.mode, label: p.label, startedAt: nowISO(), log: logFile, stopToken, procStart: procStart(child.pid) };
  setState(project.key, { local: state });
  updateProject(project.key, { lastPort: realPort });
  ev.step('local', { label: 'Local Preview', status: 'pass', summary: url });
  ev.notify(`🟢 ${project.name}`, `Local Preview: ${url}`, url);
  return { running: true, ...state };
}

export async function localStop(project) {
  const st = getState(project.key).local;
  // an adopted server is asked to stop through its own endpoint (we may not know its pid)
  if (st?.adopted && st.url) {
    // we never learned its stop token: stop the process listening on the port, but only after the server
    // proved it is ours (X-BID-Project) — a reused port must not take an unrelated process down
    const who = await probe(st.url, { timeout: 800 });
    let stopped = false;
    if (who?.headers?.['x-bid-project'] === project.key) {
      const pid = pidOnPort(st.port) || st.pid;
      if (pid && pidAlive(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
          stopped = true;
        } catch {}
      }
      for (let i = 0; i < 20 && (await httpAlive(st.url, 300)); i++) await sleep(150);
    }
    setState(project.key, { local: undefined });
    return { running: false, stopped: stopped || !(await httpAlive(st.url, 300)) };
  }
  if (!st?.pid || !ourProcess(st)) {
    setState(project.key, { local: undefined });
    return { running: false, stopped: false };
  }
  const kill = (sig) => {
    try {
      process.kill(-st.pid, sig);
    } catch {
      try {
        process.kill(st.pid, sig);
      } catch {}
    }
  };
  kill('SIGTERM');
  for (let i = 0; i < 20 && pidAlive(st.pid); i++) await sleep(150);
  if (pidAlive(st.pid)) kill('SIGKILL');
  setState(project.key, { local: undefined });
  return { running: false, stopped: true };
}

export async function localRestart(project, opts = {}) {
  const prev = getState(project.key).local;
  await localStop(project);
  await sleep(300);
  return localStart(project, { mode: opts.mode || prev?.mode || 'auto' });
}
