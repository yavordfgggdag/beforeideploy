// Releases (V11): one operation record per release, with stages, timestamps, log and a final state, so the
// app can show progress, resume after a restart and never report a half-done publish as success.
//
//   bid release preview --project P            check → preview deploy → smoke checks → awaiting_confirmation
//   bid release promote --project P --op ID --confirm DEPLOY
//                                              re-verify snapshot → publish the smoke-tested deploy → verify production
//   bid release status  --project P [--op ID]  operations (reconciled with the host when interrupted)
//   bid release rollback --project P --confirm ROLLBACK [--deploy ID]
//   bid release cancel  --project P --op ID
//
// Invariants: a release only promotes a preview whose source fingerprint and build artifact are unchanged;
// one release at a time per project (lock file with pid); a repeated promote does not publish twice — it
// reads the host's state first; a failed verification is never "succeeded" and offers the rollback target.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_DIR, EngineError, ev, ensureDir, logDir, nowISO, pidAlive, pidStartTime, processHolds, readJSON, writeJSON } from './util.mjs';
import { detect } from './detect.mjs';
import { runChecks, fingerprint, artifactHash, buildConfigHash } from './checks.mjs';
import { getState, setState, addHistory, findProject, updateProject } from './store.mjs';
import { deployProject, PROVIDERS, providerStatus } from './hosting.mjs';
import { netlifyDeploys, netlifySiteState, netlifyGetDeploy, netlifyPublishDeploy } from './netlify.mjs';
import { smokeTest, configuredPaths, writeSmokeLog } from './postdeploy.mjs';
import { t, msg } from './i18n.mjs';

const OPS_DIR = () => path.join(APP_DIR, 'ops');
const opFile = (id) => path.join(OPS_DIR(), `${id}.json`);
const lockFile = (key) => path.join(OPS_DIR(), `${key}.lock`);
const ACTOR = () => (process.env.BID_CLIENT === 'app' ? 'app' : 'cli');

/** What each hosting provider can do in a release. Shown honestly in the app; false means "not offered". */
export const CAPABILITIES = {
  netlify: { preview: true, production: true, status: true, logs: true, domains: true, rollback: true, publishArtifact: true },
  vercel: { preview: true, production: true, status: false, logs: true, domains: false, rollback: false, publishArtifact: false },
  cloudflare: { preview: true, production: true, status: false, logs: true, domains: false, rollback: false, publishArtifact: false },
  ghpages: { preview: false, production: true, status: false, logs: true, domains: false, rollback: false, publishArtifact: false },
};

export function capabilities(provider) {
  return { provider, ...(CAPABILITIES[provider] || CAPABILITIES.netlify) };
}

// ---------------------------------------------------------------- op records

function newOp(project, provider, kind = 'release') {
  return {
    id: `${kind}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    kind,
    project: project.key,
    projectName: project.name,
    provider,
    actor: ACTOR(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    state: 'created',
    stages: [],
    log: [],
  };
}

function saveOp(op) {
  ensureDir(OPS_DIR());
  op.updatedAt = nowISO();
  writeJSON(opFile(op.id), op);
  setState(op.project, { release: { ...(getState(op.project).release || {}), lastOp: op.id, ...(FINAL.has(op.state) ? { currentOp: null } : { currentOp: op.id }) } });
  return op;
}

const FINAL = new Set(['succeeded', 'failed', 'cancelled', 'stale', 'verify_failed', 'interrupted']);

function logLine(op, text) {
  op.log.push(`${nowISO()} ${text}`);
  if (op.log.length > 400) op.log.splice(0, op.log.length - 400);
}

const STAGE_LABELS = () => ({ check: t('release.stage.check'), preview: t('release.stage.preview'), smoke: t('release.stage.smoke'), promote: t('release.stage.promote'), verify: t('release.stage.verify') });

function stage(op, id, patch) {
  let s = op.stages.find((x) => x.id === id);
  if (!s) {
    s = { id, status: 'pending' };
    op.stages.push(s);
  }
  Object.assign(s, patch);
  if (patch.status === 'running' && !s.startedAt) s.startedAt = nowISO();
  if (['pass', 'fail', 'skipped'].includes(patch.status)) s.finishedAt = nowISO();
  ev.step(`release.${id}`, { label: STAGE_LABELS()[id] || id, category: 'Release', ...patch });
  saveOp(op);
  return s;
}

export function loadOp(id) {
  if (!id || id === true) throw new EngineError(msg('release.missingOp'), 'usage', 2);
  const op = readJSON(opFile(String(id).replace(/[^a-z0-9-]/gi, '')), null);
  if (!op) throw new EngineError(msg('release.opNotFound', { id }), 'not_found');
  return op;
}

export function listOps(key, { limit = 20 } = {}) {
  ensureDir(OPS_DIR());
  return fs
    .readdirSync(OPS_DIR())
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJSON(path.join(OPS_DIR(), f), null))
    .filter((o) => o && o.project === key)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

// ---------------------------------------------------------------- lock (one release per project)

function acquireLock(project, op) {
  ensureDir(OPS_DIR());
  const f = lockFile(project.key);
  const cur = readJSON(f, null);
  // the holder is alive only when the pid exists AND it is the same process instance (start time):
  // after a crash the pid can be reused by an unrelated program, which must not block releases forever
  if (cur && cur.pid !== process.pid && processHolds(cur)) {
    throw new EngineError(msg('release.inProgress', { op: cur.op }), 'release_in_progress', 3);
  }
  if (cur && cur.pid !== process.pid) {
    // the previous engine died mid-release: its op can no longer be trusted
    const stale = readJSON(opFile(cur.op), null);
    if (stale && !FINAL.has(stale.state)) {
      stale.state = 'interrupted';
      logLine(stale, `lock holder pid ${cur.pid} is gone${pidAlive(cur.pid) ? ' (pid reused by another process)' : ''} — marked interrupted`);
      saveOp(stale);
    }
  }
  writeJSON(f, { op: op.id, pid: process.pid, pidStart: pidStartTime(process.pid), at: nowISO() });
}

function releaseLock(project) {
  try {
    fs.unlinkSync(lockFile(project.key));
  } catch {}
}

// ---------------------------------------------------------------- snapshot binding

async function snapshot(project) {
  const d = detect(project.path);
  return {
    fingerprint: fingerprint(project.path, d),
    buildConfig: buildConfigHash(project.path, d),
    artifact: !d.ssr && d.publishReady ? await artifactHash(project.path, d.publishDir) : null,
    at: nowISO(),
  };
}

/** source → buildConfig → artifact, in that order; the first difference names the reason. */
async function snapshotMatches(op, project) {
  const now = await snapshot(project);
  if (now.fingerprint !== op.snapshot.fingerprint) return { ok: false, reason: 'source' };
  if (op.snapshot.buildConfig && now.buildConfig !== op.snapshot.buildConfig) return { ok: false, reason: 'buildConfig' };
  if ((op.snapshot.artifact?.hash || null) !== (now.artifact?.hash || null)) return { ok: false, reason: 'artifact' };
  return { ok: true };
}

/**
 * How a release proves it publishes what was checked (V11 RC):
 *   artifact  — static output: SHA-256 manifest, re-hashed right before and right after every upload;
 *   deployId  — Netlify: the smoke-tested preview deploy is published by id, whatever the build type;
 *   none      — SSR on a provider that rebuilds from source: no verifiable identity → the release flow refuses
 *               (plain `bid deploy` remains available and says the same).
 */
function identityFor(d, provider, caps) {
  if (!d.ssr && d.publishReady) return provider === 'netlify' && caps.publishArtifact ? 'artifact+deployId' : 'artifact';
  if (provider === 'netlify' && caps.publishArtifact) return 'deployId';
  return 'none';
}

/** Re-hash the publish folder around an upload; a difference means someone changed files while they were being sent. */
async function assertArtifactUnchanged(op, project, when) {
  if (!op.snapshot?.artifact?.hash) return;
  const d = detect(project.path);
  const now = await artifactHash(project.path, d.publishDir);
  if ((now?.hash || null) !== op.snapshot.artifact.hash) {
    op.failure = 'artifact_changed';
    logLine(op, `artifact changed ${when} upload: ${op.snapshot.artifact.hash.slice(0, 12)} → ${now?.hash?.slice(0, 12) || 'none'}`);
    throw new EngineError(msg('release.changedDuringUpload'), 'stale_release', 3);
  }
}

// ---------------------------------------------------------------- preview

export async function releasePreview(project, { force = false } = {}) {
  const p = findProject(project.key) || project;
  const provider = p.hosting || 'netlify';
  const caps = capabilities(provider);
  const op = newOp(p, provider);
  acquireLock(p, op);
  try {
    op.state = 'preview_running';
    saveOp(op);

    stage(op, 'check', { status: 'running' });
    const check = await runChecks(p, { stopOnFail: true, force });
    op.snapshot = { fingerprint: check.fingerprint, buildConfig: check.buildConfig || null, artifact: check.artifact || null, at: check.at };
    op.check = { at: check.at, status: check.status, counts: check.counts };
    const det = detect(p.path);
    op.identity = identityFor(det, provider, caps);
    if (op.identity === 'none') {
      stage(op, 'check', { status: 'fail', summary: t('release.identityUnsupported', { provider: PROVIDERS[provider].name }) });
      op.state = 'failed';
      op.failure = 'identity_unsupported';
      saveOp(op);
      throw new EngineError(msg('release.identityUnsupported', { provider: PROVIDERS[provider].name }), 'release_unsupported', 3);
    }
    if (check.status === 'blocked') {
      stage(op, 'check', { status: 'fail', summary: t('release.checkBlocked') });
      op.state = 'failed';
      op.failure = 'check_blocked';
      saveOp(op);
      throw new EngineError(msg('smart.blocked'), 'blocked', 3);
    }
    stage(op, 'check', { status: 'pass', summary: t('release.checkPassed', { warn: check.counts.warn }) });

    if (!caps.preview) {
      stage(op, 'preview', { status: 'skipped', summary: t('release.noPreview', { provider: PROVIDERS[provider].name }) });
      stage(op, 'smoke', { status: 'skipped' });
      op.state = 'awaiting_confirmation';
      op.readyFor = 'production';
      saveOp(op);
      return op;
    }

    stage(op, 'preview', { status: 'running' });
    await assertArtifactUnchanged(op, p, 'before');
    // the upload goes out from a staged copy that must equal the snapshot and is re-hashed after the upload
    // (staging.mjs) — edits in the project folder during the upload can no longer change what is sent
    const dep = await deployProject(p, { prod: false, expectedArtifact: op.snapshot.artifact?.hash ?? null, artifactCode: 'stale_release' });
    op.preview = { url: dep.url, deployId: dep.deployId || null, at: nowISO(), artifact: dep.artifact?.hash || op.snapshot.artifact?.hash || null, uploaded: dep.artifact || null };
    stage(op, 'preview', { status: 'pass', summary: dep.url });

    stage(op, 'smoke', { status: 'running', summary: dep.url });
    const smoke = await smokeTest(dep.url, { paths: configuredPaths(p.path), requireHttps: /^https:/.test(dep.url) });
    const smokeLog = path.join(logDir(p.key), `smoke-preview-${op.id}.log`);
    writeSmokeLog(smokeLog, smoke);
    op.smoke = { ...smoke, log: smokeLog };
    if (!smoke.ok) {
      const bad = smoke.checks.filter((c) => !c.ok);
      stage(op, 'smoke', { status: 'fail', summary: t('release.smokeFailed', { count: bad.length, total: smoke.checks.length }), details: bad.map((c) => `${c.status} ${c.url} ${c.reason || ''}`), log: smokeLog });
      op.state = 'failed';
      op.failure = 'smoke';
      saveOp(op);
      addHistory({ project: p.key, projectName: p.name, kind: 'release', status: 'fail', url: dep.url, message: t('release.history.smokeFailed'), log: smokeLog });
      throw new EngineError(msg('release.smokeFailedMsg', { count: bad.length }), 'smoke_failed');
    }
    stage(op, 'smoke', { status: 'pass', summary: t('release.smokePassed', { count: smoke.checks.length }), log: smokeLog });
    op.state = 'awaiting_confirmation';
    op.readyFor = 'production';
    saveOp(op);
    ev.notify(t('release.notify.previewReady', { project: p.name }), dep.url, dep.url);
    return op;
  } catch (e) {
    if (!FINAL.has(op.state)) {
      op.state = 'failed';
      op.failure = op.failure || e.failure || e.code || 'error';
      logLine(op, `error: ${e.message}`);
      saveOp(op);
    }
    throw e;
  } finally {
    releaseLock(p);
  }
}

// ---------------------------------------------------------------- promote

export async function releasePromote(project, { op: opId, confirm } = {}) {
  if (confirm !== 'DEPLOY') throw new EngineError(msg('deploy.confirmRequired'), 'confirm_required', 2);
  const p = findProject(project.key) || project;
  const op = loadOp(opId);
  if (op.project !== p.key) throw new EngineError(msg('release.opNotFound', { id: opId }), 'not_found');
  const caps = capabilities(op.provider);

  // a repeated promote (double click, reconnect) must not publish twice: read what already happened
  if (op.state === 'succeeded' || op.state === 'verify_failed') return op;
  if (op.state === 'promoting' || op.state === 'verifying') return reconcile(p, op);
  if (op.state !== 'awaiting_confirmation') throw new EngineError(msg('release.notReady', { state: op.state }), 'release_not_ready', 3);

  const same = await snapshotMatches(op, p);
  if (!same.ok) {
    op.state = 'stale';
    op.failure = same.reason === 'artifact' ? 'artifact_changed' : same.reason === 'buildConfig' ? 'build_config_changed' : 'source_changed';
    logLine(op, `snapshot changed since preview (${same.reason})`);
    saveOp(op);
    throw new EngineError(msg(same.reason === 'artifact' ? 'release.artifactChanged' : same.reason === 'buildConfig' ? 'release.buildConfigChanged' : 'release.sourceChanged'), 'stale_release', 3);
  }

  acquireLock(p, op);
  try {
    op.confirmation = { typed: 'DEPLOY', at: nowISO(), by: ACTOR() };
    op.state = 'promoting';
    saveOp(op);
    stage(op, 'promote', { status: 'running' });

    let production;
    if (op.provider === 'netlify' && caps.publishArtifact && op.preview?.deployId) {
      const before = await netlifySiteState(p);
      op.production = { previousDeployId: before.publishedDeployId, previousPublishedAt: before.publishedAt };
      saveOp(op);
      const published = await netlifyPublishDeploy(p, op.preview.deployId);
      const after = await netlifySiteState(p);
      if (after.publishedDeployId !== op.preview.deployId) throw new EngineError(msg('netlify.publishFailed'), 'netlify_failed');
      production = { url: after.liveUrl, deployId: published.id, at: nowISO(), sha: null };
      setState(p.key, { lastProd: { url: production.url, at: production.at, deployId: production.deployId, restoredFrom: op.preview.deployId } });
      updateProject(p.key, { netlify: { liveUrl: production.url } });
      addHistory({ project: p.key, projectName: p.name, kind: 'production', status: 'ok', url: production.url, message: t('release.history.publishedPreview') });
    } else {
      // no publish-by-id on this provider: the checked artifact is uploaded again, re-hashed before and after
      await assertArtifactUnchanged(op, p, 'before');
      const dep = await deployProject(p, { prod: true, confirm: 'DEPLOY', expectedArtifact: op.snapshot.artifact?.hash ?? null, artifactCode: 'stale_release' });
      production = { url: dep.url, deployId: dep.deployId || null, at: nowISO(), artifact: op.snapshot.artifact?.hash || null };
    }
    op.production = { ...(op.production || {}), ...production };
    stage(op, 'promote', { status: 'pass', summary: production.url });

    op.state = 'verifying';
    saveOp(op);
    stage(op, 'verify', { status: 'running', summary: production.url });
    const verify = production.url ? await smokeTest(production.url, { paths: configuredPaths(p.path), requireHttps: /^https:/.test(production.url) }) : { ok: false, checks: [], reason: 'no_url' };
    const verifyLog = path.join(logDir(p.key), `smoke-production-${op.id}.log`);
    if (verify.checks) writeSmokeLog(verifyLog, verify);
    op.verify = { ...verify, log: verifyLog };
    op.rollback = rollbackInfo(op, caps);
    if (!verify.ok) {
      const bad = (verify.checks || []).filter((c) => !c.ok);
      stage(op, 'verify', { status: 'fail', summary: t('release.verifyFailed', { count: bad.length }), details: bad.map((c) => `${c.status} ${c.url} ${c.reason || ''}`), log: verifyLog });
      op.state = 'verify_failed';
      saveOp(op);
      addHistory({ project: p.key, projectName: p.name, kind: 'release', status: 'fail', url: production.url, message: t('release.history.verifyFailed'), log: verifyLog });
      ev.notify(`❌ ${p.name}`, t('release.notify.verifyFailed'), production.url);
      return op;
    }
    stage(op, 'verify', { status: 'pass', summary: t('release.verifyPassed', { count: verify.checks.length }), log: verifyLog });
    op.state = 'succeeded';
    saveOp(op);
    addHistory({ project: p.key, projectName: p.name, kind: 'release', status: 'ok', url: production.url, message: t('release.history.succeeded', { actor: op.actor }) });
    ev.notify(t('deploy.notify.live', { project: p.name }), production.url, production.url);
    return op;
  } catch (e) {
    if (!FINAL.has(op.state)) {
      op.state = 'failed';
      op.failure = e.failure || e.code || 'error';
      logLine(op, `error: ${e.message}`);
      op.rollback = rollbackInfo(op, caps);
      saveOp(op);
    }
    throw e;
  } finally {
    releaseLock(p);
  }
}

function rollbackInfo(op, caps) {
  if (!caps.rollback) return { available: false, reason: 'unsupported', restores: null };
  const prev = op.production?.previousDeployId || null;
  if (!prev) return { available: false, reason: 'no_previous', restores: null };
  return { available: true, deployId: prev, restores: 'files', note: t('release.rollback.note') };
}

// ---------------------------------------------------------------- status / reconcile

/** An op that was mid-promote when the engine stopped: ask the host what really happened. */
async function reconcile(project, op) {
  if (op.provider !== 'netlify' || !op.preview?.deployId) {
    op.state = 'interrupted';
    logLine(op, 'interrupted with unknown result — the provider offers no status API');
    return saveOp(op);
  }
  const site = await netlifySiteState(project);
  if (site.publishedDeployId === op.preview.deployId) {
    op.production = { ...(op.production || {}), url: site.liveUrl, deployId: site.publishedDeployId, at: site.publishedAt || nowISO() };
    op.state = 'verifying';
    stage(op, 'promote', { status: 'pass', summary: t('release.reconciled') });
    const verify = await smokeTest(site.liveUrl, { paths: configuredPaths(project.path), requireHttps: /^https:/.test(site.liveUrl || '') });
    op.verify = verify;
    op.rollback = rollbackInfo(op, capabilities(op.provider));
    op.state = verify.ok ? 'succeeded' : 'verify_failed';
    stage(op, 'verify', { status: verify.ok ? 'pass' : 'fail', summary: t(verify.ok ? 'release.verifyPassed' : 'release.verifyFailed', { count: verify.ok ? verify.checks.length : verify.checks.filter((c) => !c.ok).length }) });
    return saveOp(op);
  }
  op.state = 'interrupted';
  logLine(op, `interrupted: published deploy is ${site.publishedDeployId}, not the preview`);
  return saveOp(op);
}

export async function releaseStatus(project, { op: opId = null } = {}) {
  const p = findProject(project.key) || project;
  const provider = p.hosting || 'netlify';
  const st = getState(p.key);
  let ops = listOps(p.key);
  // an op still "in progress" whose engine is gone is reported honestly, not left spinning
  const lock = readJSON(lockFile(p.key), null);
  for (const o of ops) {
    if (!FINAL.has(o.state) && o.state !== 'awaiting_confirmation' && !(lock && lock.op === o.id && processHolds(lock))) {
      if (o.state === 'promoting' || o.state === 'verifying') {
        try {
          await reconcile(p, o);
        } catch (e) {
          o.state = 'interrupted';
          logLine(o, `reconcile failed: ${e.message}`);
          saveOp(o);
        }
      } else {
        o.state = 'interrupted';
        saveOp(o);
      }
    }
  }
  ops = listOps(p.key);
  let deploys = [];
  let site = null;
  if (provider === 'netlify' && detect(p.path).netlifyLinked && providerStatus('netlify').loggedIn) {
    try {
      site = await netlifySiteState(p);
      deploys = await netlifyDeploys(p);
    } catch {}
  }
  const current = ops.find((o) => o.state === 'awaiting_confirmation') || null;
  return {
    provider,
    capabilities: capabilities(provider),
    current,
    ops: opId ? ops.filter((o) => o.id === opId) : ops,
    deploys,
    site,
    lastProd: st.lastProd || null,
    rollback: site?.publishedDeployId ? rollbackTarget(deploys, site.publishedDeployId) : { available: false, reason: provider === 'netlify' ? 'no_previous' : 'unsupported' },
  };
}

function rollbackTarget(deploys, publishedId) {
  const ready = deploys.filter((d) => d.state === 'ready' && d.id !== publishedId && d.context === 'production');
  const prev = ready[0] || null;
  if (!prev) return { available: false, reason: 'no_previous', restores: null };
  return { available: true, deployId: prev.id, restores: 'files', createdAt: prev.createdAt, note: t('release.rollback.note') };
}

// ---------------------------------------------------------------- rollback / cancel

export async function releaseRollback(project, { confirm, deploy } = {}) {
  if (confirm !== 'ROLLBACK') throw new EngineError(msg('release.rollbackConfirm'), 'confirm_required', 2);
  const p = findProject(project.key) || project;
  const provider = p.hosting || 'netlify';
  const caps = capabilities(provider);
  if (!caps.rollback) throw new EngineError(msg('release.rollbackUnsupported', { provider: PROVIDERS[provider].name }), 'unsupported');
  const site = await netlifySiteState(p);
  let target = deploy && deploy !== true ? String(deploy) : null;
  if (!target) {
    const list = await netlifyDeploys(p);
    const rb = rollbackTarget(list, site.publishedDeployId);
    if (!rb.available) throw new EngineError(msg('release.noRollbackTarget'), 'nothing');
    target = rb.deployId;
  }
  const op = newOp(p, provider, 'rollback');
  acquireLock(p, op);
  try {
    op.confirmation = { typed: 'ROLLBACK', at: nowISO(), by: ACTOR() };
    op.production = { previousDeployId: site.publishedDeployId, target };
    op.state = 'promoting';
    saveOp(op);
    stage(op, 'promote', { status: 'running', summary: target });
    const d = await netlifyGetDeploy(p, target);
    if (d.state !== 'ready') throw new EngineError(msg('release.deployNotReady', { id: target }), 'nothing');
    await netlifyPublishDeploy(p, target);
    const after = await netlifySiteState(p);
    if (after.publishedDeployId !== target) throw new EngineError(msg('netlify.publishFailed'), 'netlify_failed');
    op.production = { ...op.production, url: after.liveUrl, deployId: target, at: nowISO() };
    stage(op, 'promote', { status: 'pass', summary: after.liveUrl });
    setState(p.key, { lastProd: { url: after.liveUrl, at: nowISO(), deployId: target, rollback: true } });
    op.state = 'verifying';
    stage(op, 'verify', { status: 'running' });
    const verify = await smokeTest(after.liveUrl, { paths: configuredPaths(p.path), requireHttps: /^https:/.test(after.liveUrl || '') });
    op.verify = verify;
    op.state = verify.ok ? 'succeeded' : 'verify_failed';
    stage(op, 'verify', { status: verify.ok ? 'pass' : 'fail', summary: t(verify.ok ? 'release.verifyPassed' : 'release.verifyFailed', { count: verify.ok ? verify.checks.length : verify.checks.filter((c) => !c.ok).length }) });
    saveOp(op);
    addHistory({ project: p.key, projectName: p.name, kind: 'rollback', status: verify.ok ? 'ok' : 'fail', url: after.liveUrl, message: t('release.history.rolledBack', { id: target }) });
    ev.notify(t('release.notify.rolledBack', { project: p.name }), after.liveUrl, after.liveUrl);
    return op;
  } catch (e) {
    if (!FINAL.has(op.state)) {
      op.state = 'failed';
      op.failure = e.failure || e.code || 'error';
      logLine(op, `error: ${e.message}`);
      saveOp(op);
    }
    throw e;
  } finally {
    releaseLock(p);
  }
}

export function releaseCancel(project, { op: opId } = {}) {
  const op = loadOp(opId);
  if (op.project !== project.key) throw new EngineError(msg('release.opNotFound', { id: opId }), 'not_found');
  if (op.state !== 'awaiting_confirmation') throw new EngineError(msg('release.notReady', { state: op.state }), 'release_not_ready', 3);
  op.state = 'cancelled';
  logLine(op, `cancelled by ${ACTOR()}`);
  return saveOp(op);
}
