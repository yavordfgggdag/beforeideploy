// Engine log and support report (V10 WP6.6/6.9). Every command appends one NDJSON line to
// APP_DIR/logs/engine.log (argv with secret-looking flag values masked); `bid report` bundles the
// redacted tail of that log, the latest per-project logs and `doctor` into a zip for support.
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, CACHE_DIR, ensureDir, nowISO, sh, which } from './util.mjs';
import { redact } from './aifix.mjs';

const LOG_DIR = () => ensureDir(path.join(APP_DIR, 'logs'));
export const LOG_FILE = () => path.join(LOG_DIR(), 'engine.log');
const MAX_BYTES = 5 * 1024 * 1024;

const SENSITIVE_FLAG = /^--(password|token|key|secret|access|refresh|anon-key|api-key)(=.*)?$/i;

/** argv with the values of secret-looking flags replaced by *** (both `--flag value` and `--flag=value`). */
export function redactArgv(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    const m = SENSITIVE_FLAG.exec(a);
    if (m) {
      if (m[2]) out.push(`${a.split('=')[0]}=***`);
      else {
        out.push(a);
        if (i + 1 < argv.length && !String(argv[i + 1]).startsWith('--')) {
          out.push('***');
          i++;
        }
      }
    } else out.push(a);
  }
  return out;
}

function rotate() {
  try {
    if (fs.statSync(LOG_FILE()).size > MAX_BYTES) fs.renameSync(LOG_FILE(), `${LOG_FILE()}.1`);
  } catch {}
}

/** Appends one entry; never throws (logging must not break a command). */
export function logEvent(entry) {
  try {
    rotate();
    fs.appendFileSync(LOG_FILE(), JSON.stringify({ ts: nowISO(), pid: process.pid, ...entry }) + '\n');
  } catch {}
}

export function logTail(n = 200) {
  let lines = [];
  try {
    lines = fs.readFileSync(LOG_FILE(), 'utf8').trim().split('\n');
  } catch {
    return [];
  }
  return lines.slice(-n).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { raw: l };
    }
  });
}

const tailText = (file, n) => {
  try {
    return redact(fs.readFileSync(file, 'utf8').split('\n').slice(-n).join('\n'));
  } catch {
    return null;
  }
};

/**
 * Writes a support report: redacted engine log tail, doctor output, the latest logs of every project
 * (redacted, last 300 lines each) and a README. Returns { path (zip or folder), dir, files }.
 */
export function createReport({ doctor, version }) {
  const stamp = nowISO().replace(/[:.]/g, '-');
  const dir = ensureDir(path.join(CACHE_DIR, `report-${stamp}`));
  const files = [];
  const put = (name, text) => {
    if (text === null || text === undefined) return;
    fs.writeFileSync(path.join(dir, name), text);
    files.push(name);
  };
  put('engine-log.ndjson', redact(logTail(500).map((e) => JSON.stringify(e)).join('\n')));
  put('doctor.json', redact(JSON.stringify({ version, ...doctor }, null, 2)));
  let entries = [];
  try {
    entries = fs.readdirSync(CACHE_DIR, { withFileTypes: true });
  } catch {}
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('report-')) continue;
    let logs = [];
    try {
      logs = fs.readdirSync(path.join(CACHE_DIR, e.name)).filter((f) => f.endsWith('.log'));
    } catch {}
    for (const f of logs) put(`${e.name}-${f}`, tailText(path.join(CACHE_DIR, e.name, f), 300));
  }
  put(
    'README.txt',
    ['Before I Deploy — support report', `created: ${nowISO()}`, `engine: ${version || '?'}`, '', 'Secrets, emails and home paths were redacted before writing these files.', 'Attach this archive to your support request.', ''].join('\n')
  );
  let archive = null;
  if (which('zip')) {
    const zipPath = `${dir}.zip`;
    const r = sh('zip', ['-qr', zipPath, path.basename(dir)], { cwd: CACHE_DIR, timeout: 60000 });
    if (r.code === 0) archive = zipPath;
  }
  return { path: archive || dir, dir, zip: archive, files };
}
