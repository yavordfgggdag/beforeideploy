// Staged publish artifacts (WP01, audit E6/E15). Every static upload goes out from a private copy:
//
//   1. the publish folder is copied with the same filter the manifest uses (no dotfiles except
//      .well-known, no node_modules, no tooling files in a root publish, no symlinks)
//   2. the copy is hashed; when an expected manifest hash is given (the check's or the release
//      snapshot's) and the copy differs, nothing is uploaded
//   3. the provider uploads the copy — never the live project folder
//   4. the copy is hashed again after the upload; a difference means someone touched the upload
//   5. the copy is removed
//
// So the manifest a person reviewed, the manifest the engine verified and the bytes that were sent are the
// same thing. Copies live in CACHE_DIR/publish/<projectKey>-<pid>-<time>, so two jobs never share a folder,
// and copies older than a day are removed on the next staging.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, EngineError, publishIncludes } from './util.mjs';
import { artifactHash } from './checks.mjs';
import { msg } from './i18n.mjs';

const STAGING = () => path.join(CACHE_DIR, 'publish');
const DAY = 24 * 3600 * 1000;

function prune() {
  let list = [];
  try {
    list = fs.readdirSync(STAGING(), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of list) {
    const p = path.join(STAGING(), e.name);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > DAY) fs.rmSync(p, { recursive: true, force: true });
    } catch {}
  }
}

export const isRootPublish = (projectDir, publishDir) => !publishDir || publishDir === '.' || publishDir === './' || path.resolve(projectDir, publishDir) === path.resolve(projectDir);

/**
 * Copies the publish folder into a private staging folder and hashes it.
 * Returns { dir, hash, files, bytes, verify(), cleanup() }.
 * expected: manifest hash the copy must match (null = none recorded); code: error code on a mismatch.
 */
export async function stageArtifact(project, publishDir, { expected = null, code = 'stale_check' } = {}) {
  prune();
  const src = path.resolve(project.path, publishDir || '.');
  const asRoot = isRootPublish(project.path, publishDir);
  const dir = path.join(STAGING(), `${project.key}-${process.pid}-${Date.now().toString(36)}`);
  let count = 0;
  const copy = (from, to, top) => {
    fs.mkdirSync(to, { recursive: true });
    const list = fs.readdirSync(from, { withFileTypes: true });
    for (const e of list) {
      if (count > 20000) return;
      if (!publishIncludes(e.name, { root: top })) continue;
      const a = path.join(from, e.name);
      const b = path.join(to, e.name);
      if (e.isDirectory()) copy(a, b, false);
      else if (e.isFile()) {
        fs.copyFileSync(a, b);
        count++;
      }
    }
  };
  copy(src, dir, asRoot);
  const cleanup = () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  };
  const manifest = await artifactHash(dir, '.', { asRoot });
  if (expected && manifest?.hash !== expected) {
    cleanup();
    throw Object.assign(new EngineError(msg('deploy.artifactMismatch', { expected: String(expected).slice(0, 12), actual: (manifest?.hash || 'none').slice(0, 12) }), code, 3), { failure: 'artifact_changed' });
  }
  const verify = async () => {
    const again = await artifactHash(dir, '.', { asRoot });
    if (again?.hash !== manifest?.hash) {
      cleanup();
      throw Object.assign(new EngineError(msg('release.changedDuringUpload'), 'stale_release', 3), { failure: 'artifact_changed' });
    }
  };
  return { dir, hash: manifest?.hash || null, files: manifest?.files || 0, bytes: manifest?.bytes || 0, verify, cleanup };
}
