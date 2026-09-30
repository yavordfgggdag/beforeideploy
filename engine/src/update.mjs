// Self-update (V10 WP6.3): `bid update check|download`. The release feed URL comes from the cloud
// `settings.release.url` (Admin panel) or BID_UPDATE_URL; without it the feature is dormant.
//
// latest.json:
//   { "version": "10.1.0", "minVersion": "10.0.0", "url": "https://…/Before-I-Deploy-10.1.0.dmg",
//     "sha256": "…", "notes": { "en": "…", "bg": "…" }, "publishedAt": "2026-10-01T00:00:00Z",
//     "beta": { "version": "10.2.0-beta.1", "url": "…", "sha256": "…", "notes": { … } } }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_DIR, EngineError, readJSON, writeJSON, nowISO, ensureDir, fetchT } from './util.mjs';
import { isProductionBundle } from './isolation.mjs';
import { msg } from './i18n.mjs';

const CACHE = () => path.join(APP_DIR, 'update-cache.json');
const CACHE_TTL_MS = 6 * 3600 * 1000;

/** Feed URL: BID_UPDATE_URL → the cloud setting (Admin panel) → release.json written into the engine by
 * the release build, so people who never sign in still get updates (audit R3). */
export function updateUrl() {
  if (process.env.BID_UPDATE_URL) return process.env.BID_UPDATE_URL;
  const profile = readJSON(path.join(APP_DIR, 'profile.json'), null);
  if (profile?.settings?.release?.url) return profile.settings.release.url;
  const bundled = readJSON(new URL('../release.json', import.meta.url), null);
  return bundled?.url || null;
}

/** Semver-ish compare: 1.2.3 < 1.2.4; a prerelease (10.0.0-dev) is lower than its release (10.0.0). */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v || '0').trim().split('-', 2);
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre: pre || null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (x.pre && !y.pre) return -1;
  if (!x.pre && y.pre) return 1;
  if (x.pre && y.pre) return x.pre < y.pre ? -1 : x.pre > y.pre ? 1 : 0;
  return 0;
}

export async function updateCheck({ current, force = false, channel = 'stable' } = {}) {
  const url = updateUrl();
  if (!url) return { current, configured: false, available: false, mandatory: false, channel };
  const cache = readJSON(CACHE(), null);
  if (!force && cache && cache.url === url && cache.current === current && cache.channel === channel && Date.now() - Date.parse(cache.at) < CACHE_TTL_MS) {
    return { ...cache.result, fromCache: true };
  }
  let res;
  try {
    res = await fetchT(url, { headers: { 'cache-control': 'no-cache' } });
  } catch (e) {
    throw new EngineError(msg('update.network', { error: e.message }), 'network');
  }
  if (!res.ok) throw new EngineError(msg('update.http', { status: res.status }), 'update_failed');
  const feed = await res.json().catch(() => null);
  if (!feed?.version) throw new EngineError(msg('update.badFeed'), 'update_failed');
  const latest = channel === 'beta' && feed.beta?.version && compareVersions(feed.beta.version, feed.version) > 0 ? feed.beta : feed;
  const result = {
    current,
    configured: true,
    channel,
    latest: latest.version,
    available: compareVersions(latest.version, current) > 0,
    mandatory: !!feed.minVersion && compareVersions(feed.minVersion, current) > 0,
    url: latest.url || null,
    sha256: latest.sha256 || null,
    notes: latest.notes || null,
    publishedAt: latest.publishedAt || null,
    checkedAt: nowISO(),
  };
  writeJSON(CACHE(), { at: nowISO(), url, current, channel, result });
  return result;
}

/** Downloads the DMG to ~/Downloads and verifies its sha256 (the file is deleted on mismatch). */
export async function updateDownload({ current, channel = 'stable' } = {}) {
  const r = await updateCheck({ current, force: true, channel });
  if (!r.available || !r.url) throw new EngineError(msg('update.nothing'), 'nothing');
  // a release must be HTTPS and carry its sha256 (plain http only for a local test feed)
  let u;
  try {
    u = new URL(r.url);
  } catch {
    throw new EngineError(msg('update.insecure'), 'update_failed');
  }
  // plain http only for a local test feed, and never from the engine inside the app
  const local = u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname) && !isProductionBundle();
  if ((u.protocol !== 'https:' && !local) || !/^[0-9a-f]{64}$/i.test(String(r.sha256 || ''))) {
    throw new EngineError(msg('update.insecure'), 'update_failed');
  }
  let res;
  try {
    res = await fetchT(r.url, {}, 60000);
  } catch (e) {
    throw new EngineError(msg('update.network', { error: e.message }), 'network');
  }
  if (!res.ok) throw new EngineError(msg('update.http', { status: res.status }), 'update_failed');
  // streamed to disk and hashed on the way, with a size cap and an idle timeout (WP02) — never the whole DMG in memory
  const max = Number(process.env.BID_UPDATE_MAX_BYTES) || 600 * 1024 * 1024;
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > max) throw new EngineError(msg('update.tooLarge', { mb: Math.round(max / 1048576) }), 'update_failed');
  const dir = ensureDir(path.join(os.homedir(), 'Downloads'));
  const file = path.join(dir, `Before I Deploy ${r.latest}.dmg`);
  const part = `${file}.part`;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  let bytes = 0;
  let idle = null;
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(() => res.abortController?.abort(), 60000);
  };
  try {
    arm();
    for await (const chunk of res.body) {
      arm();
      bytes += chunk.length;
      if (bytes > max) throw new EngineError(msg('update.tooLarge', { mb: Math.round(max / 1048576) }), 'update_failed');
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
    }
    await new Promise((ok, bad) => out.end((e) => (e ? bad(e) : ok())));
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    if (e instanceof EngineError) throw e;
    throw new EngineError(msg('update.network', { error: e.message }), 'network');
  } finally {
    clearTimeout(idle);
  }
  const sha256 = hash.digest('hex');
  if (sha256 !== String(r.sha256).toLowerCase()) {
    fs.rmSync(part, { force: true });
    throw new EngineError(msg('update.corrupt'), 'update_corrupt');
  }
  fs.renameSync(part, file);
  return { path: file, version: r.latest, sha256, bytes, notes: r.notes };
}
