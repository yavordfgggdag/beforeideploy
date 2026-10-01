import { gitAvailable } from './setup-tools.mjs';
// GitHub panel: status, fetch, commit, push
import path from 'node:path';
import { EngineError, ev, sh, runStream, logDir, which } from './util.mjs';
import { gitBasics } from './detect.mjs';
import { addHistory } from './store.mjs';
import { t, msg } from './i18n.mjs';

const GIT_ENV = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' });

export function gitStatus(dir) {
  if (!gitAvailable()) return { isRepo: false, installed: false };
  const base = gitBasics(dir);
  if (!base.isRepo) return { ...base, installed: true };

  // -z: file names come raw — no quoting or \ooo escapes for Cyrillic, spaces or quotes (audit E11)
  const entries = sh('git', ['status', '--porcelain=v1', '-uall', '-z'], { cwd: dir }).stdout.split('\0');
  const changed = [];
  let changedCount = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) continue;
    const code = e.slice(0, 2);
    // a rename / copy is followed by its old name, which is not a separate change
    if (code[0] === 'R' || code[0] === 'C') i++;
    changedCount++;
    if (changed.length < 300) changed.push({ path: e.slice(3), code: code.trim() || '?' });
  }

  let ahead = null;
  let behind = null;
  const up = sh('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: dir });
  const hasUpstream = up.code === 0;
  if (hasUpstream) {
    const c = sh('git', ['rev-list', '--left-right', '--count', '@{u}...HEAD'], { cwd: dir }).stdout.trim().split(/\s+/);
    behind = Number(c[0]) || 0;
    ahead = Number(c[1]) || 0;
  }

  let lastCommit = null;
  const log = sh('git', ['log', '-1', '--format=%h%x1f%s%x1f%cr'], { cwd: dir });
  if (log.code === 0 && log.stdout.trim()) {
    const [hash, subject, relative] = log.stdout.trim().split('\x1f');
    lastCommit = { hash, subject, relative };
  }

  return {
    ...base,
    installed: true,
    changed,
    changedCount,
    hasUpstream,
    upstream: hasUpstream ? up.stdout.trim() : null,
    ahead,
    behind,
    lastCommit,
  };
}

/** Full sha of HEAD, or null outside a repo / before the first commit. */
export function gitHead(dir) {
  const r = sh('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function gitFetch(project) {
  const r = await runStream('git', ['fetch', '--quiet', 'origin'], { cwd: project.path, env: GIT_ENV(), step: 'fetch', timeout: 20000, quiet: true });
  return { fetched: r.code === 0, status: gitStatus(project.path) };
}

export async function gitCommit(project, { message, files }) {
  const dir = project.path;
  if (!message || message === true) throw new EngineError(msg('git.missingMessage'), 'usage', 2);
  const st = gitStatus(dir);
  if (!st.isRepo) throw new EngineError(msg('git.notRepo'), 'no_repo');
  const logFile = path.join(logDir(project.key), 'git.log');
  ev.step('commit', { label: 'Commit', status: 'running' });

  const list = Array.isArray(files) && files.length ? files : null;
  const add = list ? sh('git', ['add', '-A', '--', ...list], { cwd: dir }) : sh('git', ['add', '-A'], { cwd: dir });
  if (add.code !== 0) {
    ev.step('commit', { label: 'Commit', status: 'fail', summary: add.stderr.trim() });
    throw new EngineError(msg('git.addFailed', { error: add.stderr.trim() }), 'git_failed');
  }
  // hooks can hang (an editor, a prompt): a commit gets two minutes (WP02)
  const r = await runStream('git', ['commit', '-m', message], { cwd: dir, env: GIT_ENV(), step: 'commit', logFile, timeout: 120000 });
  if (r.code !== 0) {
    ev.step('commit', { label: 'Commit', status: 'fail', summary: r.tail.slice(-1)[0] || t('git.commitFailed'), log: logFile });
    throw new EngineError(msg('git.commitFailed'), 'git_failed');
  }
  const after = gitStatus(dir);
  ev.step('commit', { label: 'Commit', status: 'pass', summary: after.lastCommit ? `${after.lastCommit.hash} ${after.lastCommit.subject}` : t('git.done') });
  addHistory({ project: project.key, projectName: project.name, kind: 'commit', status: 'ok', message });
  return after;
}

export async function gitPush(project) {
  const dir = project.path;
  const st = gitStatus(dir);
  if (!st.isRepo) throw new EngineError(msg('git.notRepo'), 'no_repo');
  if (!st.remote) throw new EngineError(msg('git.noRemote'), 'no_remote');
  const logFile = path.join(logDir(project.key), 'git.log');
  ev.step('push', { label: 'Push', status: 'running', summary: st.githubUrl || st.remote });
  const args = st.hasUpstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'];
  const r = await runStream('git', args, { cwd: dir, env: GIT_ENV(), step: 'push', logFile, timeout: 120000 });
  if (r.code !== 0) {
    ev.step('push', { label: 'Push', status: 'fail', summary: r.tail.slice(-1)[0] || t('git.pushFailedShort'), details: r.tail.slice(-10), log: logFile });
    addHistory({ project: project.key, projectName: project.name, kind: 'push', status: 'fail', log: logFile });
    throw new EngineError(msg('git.pushFailed'), 'git_failed');
  }
  ev.step('push', { label: 'Push', status: 'pass', summary: t('git.pushed', { branch: st.branch }) });
  addHistory({ project: project.key, projectName: project.name, kind: 'push', status: 'ok', url: st.githubUrl });
  ev.notify(`✅ ${project.name}`, t('git.notify.pushed', { branch: st.branch }), st.githubUrl);
  return gitStatus(dir);
}

export function gitSetRemote(project, url) {
  if (!url || url === true) throw new EngineError(msg('git.missingUrl'), 'usage', 2);
  const dir = project.path;
  const has = sh('git', ['remote', 'get-url', 'origin'], { cwd: dir }).code === 0;
  const r = sh('git', has ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url], { cwd: dir });
  if (r.code !== 0) throw new EngineError(r.stderr.trim() || msg('git.remoteFailed'), 'git_failed');
  return gitStatus(dir);
}
