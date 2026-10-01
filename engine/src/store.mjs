// Project Library, per-project state and deploy history
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, readJSON, writeJSON, projectKey, nowISO, ensureDir, EngineError, isDir } from './util.mjs';
import { detect } from './detect.mjs';
import { msg } from './i18n.mjs';

const PROJECTS_FILE = () => path.join(APP_DIR, 'projects.json');
const STATE_DIR = () => path.join(APP_DIR, 'state');
const HISTORY_FILE = () => path.join(APP_DIR, 'history.jsonl');

// ---------------------------------------------------------------- projects

function loadLibrary() {
  const lib = readJSON(PROJECTS_FILE(), null);
  if (!lib || !Array.isArray(lib.projects)) return { version: 1, projects: [] };
  return lib;
}

function saveLibrary(lib) {
  writeJSON(PROJECTS_FILE(), lib);
}

export function listProjects() {
  const lib = loadLibrary();
  return lib.projects
    .map((p) => ({ ...p, exists: isDir(p.path), lastStatus: getState(p.key).check?.status || null }))
    .sort((a, b) => String(b.lastOpened || '').localeCompare(String(a.lastOpened || '')));
}

export function findProject(ref) {
  if (!ref) return null;
  const lib = loadLibrary();
  const byKey = lib.projects.find((p) => p.key === ref);
  if (byKey) return byKey;
  const abs = path.resolve(String(ref).replace(/^~(?=\/|$)/, process.env.HOME || ''));
  return lib.projects.find((p) => p.path === abs) || null;
}

export function upsertProject(dir, patch = {}) {
  const abs = path.resolve(String(dir).replace(/^~(?=\/|$)/, process.env.HOME || ''));
  if (!isDir(abs)) throw new EngineError(msg('project.folderNotFound', { path: abs }), 'not_found');
  const d = detect(abs);
  const lib = loadLibrary();
  const key = projectKey(abs);
  const existing = lib.projects.find((p) => p.key === key);
  const base = existing || { key, path: abs, name: d.name, addedAt: nowISO() };
  const merged = {
    ...base,
    name: base.customName || d.name,
    framework: d.framework,
    packageManager: d.packageManager,
    publishDir: d.publishDir,
    github: d.git?.githubUrl || base.github || null,
    netlify: {
      ...(base.netlify || {}),
      siteId: d.siteId || base.netlify?.siteId || null,
    },
    lastOpened: nowISO(),
    ...patch,
  };
  if (!d.netlifyLinked && base.netlify?.siteId && !d.siteId) {
    // link removed on disk — keep cached info but mark unlinked
    merged.netlify.linked = false;
  } else {
    merged.netlify.linked = d.netlifyLinked;
  }
  if (existing) Object.assign(existing, merged);
  else lib.projects.push(merged);
  saveLibrary(lib);
  return merged;
}

export function updateProject(key, patch) {
  const lib = loadLibrary();
  const p = lib.projects.find((x) => x.key === key);
  if (!p) return null;
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && p[k] && typeof p[k] === 'object') p[k] = { ...p[k], ...clean(v) };
    else p[k] = v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : v;
  }
  saveLibrary(lib);
  return p;
}

export function removeProject(key) {
  const lib = loadLibrary();
  const before = lib.projects.length;
  lib.projects = lib.projects.filter((p) => p.key !== key);
  saveLibrary(lib);
  return before !== lib.projects.length;
}

/** Resolves --project (key or path). Unknown paths are added to the library automatically. */
export function resolveProject(ref) {
  if (!ref || ref === true) throw new EngineError(msg('project.missingArg'), 'usage', 2);
  const found = findProject(ref);
  if (found) {
    if (!isDir(found.path)) throw new EngineError(msg('project.folderMissing', { path: found.path }), 'not_found');
    return found;
  }
  return upsertProject(ref);
}

// ---------------------------------------------------------------- state

export function getState(key) {
  return readJSON(path.join(STATE_DIR(), `${key}.json`), {}) || {};
}

export function setState(key, patch) {
  const cur = getState(key);
  const next = { ...cur, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  writeJSON(path.join(STATE_DIR(), `${key}.json`), next);
  return next;
}

// ---------------------------------------------------------------- history

export function addHistory(entry) {
  ensureDir(APP_DIR);
  const line = JSON.stringify({ ts: nowISO(), ...entry }) + '\n';
  fs.appendFileSync(HISTORY_FILE(), line);
  // keep the file bounded
  try {
    const st = fs.statSync(HISTORY_FILE());
    if (st.size > 1024 * 1024) {
      const lines = fs.readFileSync(HISTORY_FILE(), 'utf8').trim().split('\n');
      fs.writeFileSync(HISTORY_FILE(), lines.slice(-2000).join('\n') + '\n');
    }
  } catch {}
}

export function listHistory({ key = null, limit = 50 } = {}) {
  let lines = [];
  try {
    lines = fs.readFileSync(HISTORY_FILE(), 'utf8').trim().split('\n');
  } catch {
    return [];
  }
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (!key || e.project === key) out.push(e);
    } catch {}
  }
  return out;
}
