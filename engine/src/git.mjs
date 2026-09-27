// GitHub panel: status, fetch, commit, push
import path from 'node:path';
import { EngineError, ev, sh, runStream, logDir, which } from './util.mjs';
import { gitBasics } from './detect.mjs';
import { addHistory } from './store.mjs';

const GIT_ENV = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' });

export function gitStatus(dir) {
  if (!which('git')) return { isRepo: false, installed: false };
  const base = gitBasics(dir);
  if (!base.isRepo) return { ...base, installed: true };

  const porcelain = sh('git', ['status', '--porcelain=v1', '-uall'], { cwd: dir }).stdout.split('\n').filter(Boolean);
  const changed = porcelain.slice(0, 300).map((l) => {
    const code = l.slice(0, 2);
    let file = l.slice(3);
    if (file.includes(' -> ')) file = file.split(' -> ')[1];
    return { path: file.replace(/^"|"$/g, ''), code: code.trim() || '?' };
  });

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
    changedCount: porcelain.length,
    hasUpstream,
    upstream: hasUpstream ? up.stdout.trim() : null,
    ahead,
    behind,
    lastCommit,
  };
}

export async function gitFetch(project) {
  const r = await runStream('git', ['fetch', '--quiet', 'origin'], { cwd: project.path, env: GIT_ENV(), step: 'fetch', timeout: 20000, quiet: true });
  return { fetched: r.code === 0, status: gitStatus(project.path) };
}

export async function gitCommit(project, { message, files }) {
  const dir = project.path;
  if (!message || message === true) throw new EngineError('Липсва commit message', 'usage', 2);
  const st = gitStatus(dir);
  if (!st.isRepo) throw new EngineError('Проектът не е Git repository', 'no_repo');
  const logFile = path.join(logDir(project.key), 'git.log');
  ev.step('commit', { label: 'Commit', status: 'running' });

  const list = Array.isArray(files) && files.length ? files : null;
  const add = list ? sh('git', ['add', '-A', '--', ...list], { cwd: dir }) : sh('git', ['add', '-A'], { cwd: dir });
  if (add.code !== 0) {
    ev.step('commit', { label: 'Commit', status: 'fail', summary: add.stderr.trim() });
    throw new EngineError(`git add се провали: ${add.stderr.trim()}`, 'git_failed');
  }
  const r = await runStream('git', ['commit', '-m', message], { cwd: dir, env: GIT_ENV(), step: 'commit', logFile });
  if (r.code !== 0) {
    ev.step('commit', { label: 'Commit', status: 'fail', summary: r.tail.slice(-1)[0] || 'git commit се провали', log: logFile });
    throw new EngineError('git commit се провали', 'git_failed');
  }
  const after = gitStatus(dir);
  ev.step('commit', { label: 'Commit', status: 'pass', summary: after.lastCommit ? `${after.lastCommit.hash} ${after.lastCommit.subject}` : 'Готово' });
  addHistory({ project: project.key, projectName: project.name, kind: 'commit', status: 'ok', message });
  return after;
}

export async function gitPush(project) {
  const dir = project.path;
  const st = gitStatus(dir);
  if (!st.isRepo) throw new EngineError('Проектът не е Git repository', 'no_repo');
  if (!st.remote) throw new EngineError('Няма origin remote. Добави GitHub repo първо.', 'no_remote');
  const logFile = path.join(logDir(project.key), 'git.log');
  ev.step('push', { label: 'Push', status: 'running', summary: st.githubUrl || st.remote });
  const args = st.hasUpstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'];
  const r = await runStream('git', args, { cwd: dir, env: GIT_ENV(), step: 'push', logFile, timeout: 120000 });
  if (r.code !== 0) {
    ev.step('push', { label: 'Push', status: 'fail', summary: r.tail.slice(-1)[0] || 'git push се провали', details: r.tail.slice(-10), log: logFile });
    addHistory({ project: project.key, projectName: project.name, kind: 'push', status: 'fail', log: logFile });
    throw new EngineError('git push се провали. Виж лога (често е липсващ достъп до GitHub).', 'git_failed');
  }
  ev.step('push', { label: 'Push', status: 'pass', summary: `Качено в ${st.branch}` });
  addHistory({ project: project.key, projectName: project.name, kind: 'push', status: 'ok', url: st.githubUrl });
  ev.notify(`✅ ${project.name}`, `Push към ${st.branch} е готов`, st.githubUrl);
  return gitStatus(dir);
}

export function gitSetRemote(project, url) {
  if (!url || url === true) throw new EngineError('Липсва URL', 'usage', 2);
  const dir = project.path;
  const has = sh('git', ['remote', 'get-url', 'origin'], { cwd: dir }).code === 0;
  const r = sh('git', has ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url], { cwd: dir });
  if (r.code !== 0) throw new EngineError(r.stderr.trim() || 'Неуспешно задаване на remote', 'git_failed');
  return gitStatus(dir);
}
