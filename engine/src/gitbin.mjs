// The one way the engine runs Git (audit SU-6 / B4).
// On a Mac without the Command Line Tools, /usr/bin/git is a shim: running it — even `git --version` or
// `git rev-parse` — pops the "install developer tools" dialog. Every Git call goes through gitBin(), which
// never executes the shim when the tools are missing, and these wrappers return a failed result instead.
import fs from 'node:fs';
import { which, sh, runStream } from './util.mjs';

/** What counts as the shim and how to ask whether the tools behind it exist. Tests replace the fields. */
export const gitProbe = {
  platform: process.platform,
  shim: '/usr/bin/git',
  toolsReady: () => sh('/usr/bin/xcode-select', ['-p'], { timeout: 2000 }).code === 0 &&
    sh('/usr/bin/xcrun', ['--find', 'git'], { timeout: 2000 }).code === 0,
};

let cache = null; // { key, bin } — keyed by PATH: a changed PATH (managed tools, tests) is looked up again

/** Absolute path of a Git that can run, or null. `fresh` skips the cache (the CLT install poll). */
export function gitBin({ fresh = false } = {}) {
  const key = `${process.env.PATH}\0${gitProbe.platform}\0${gitProbe.shim}`;
  if (!fresh && cache?.key === key) return cache.bin;
  let bin = which('git');
  if (bin) {
    let real = null;
    try { real = fs.realpathSync(bin); } catch { bin = null; }
    if (bin && gitProbe.platform === 'darwin' && real === gitProbe.shim && !gitProbe.toolsReady()) bin = null;
  }
  cache = { key, bin };
  return bin;
}

export const gitAvailable = (opts) => gitBin(opts);

const missing = () => ({ code: 127, stdout: '', stderr: 'git is not available', error: Object.assign(new Error('git is not available'), { code: 'ENOENT' }) });

/** `sh('git', …)` that never touches the shim. */
export function gitSh(args, opts = {}) {
  const bin = gitBin();
  return bin ? sh(bin, args, opts) : missing();
}

/** `runStream('git', …)` that never touches the shim. */
export function gitStream(args, opts = {}) {
  const bin = gitBin();
  if (bin) return runStream(bin, args, opts);
  return Promise.resolve({ code: 127, stdout: '', tail: ['git is not available'], duration: 0 });
}
