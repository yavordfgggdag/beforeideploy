import { gitAvailable } from './setup-tools.mjs';
// Project detection: framework, package manager, scripts, publish dir, git, Netlify link
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, exists, isDir, sh } from './util.mjs';

const SSR_FRAMEWORKS = new Set(['next', 'nuxt', 'remix', 'sveltekit']);

const FRAMEWORK_DEFAULT_DIR = {
  vite: 'dist',
  astro: 'dist',
  cra: 'build',
  next: 'out',
  gatsby: 'public',
  nuxt: '.output/public',
  sveltekit: 'build',
  eleventy: '_site',
  remix: 'build/client',
  static: '.',
};

export function detectPM(dir, pkg) {
  if (pkg?.packageManager) {
    const name = String(pkg.packageManager).split('@')[0];
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) return name;
  }
  if (exists(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(dir, 'bun.lockb')) || exists(path.join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

export function detectFramework(dir, pkg) {
  if (!pkg) return exists(path.join(dir, 'index.html')) ? 'static' : 'unknown';
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.next) return 'next';
  if (deps.astro) return 'astro';
  if (deps['@sveltejs/kit']) return 'sveltekit';
  if (deps.nuxt || deps.nuxt3) return 'nuxt';
  if (deps.gatsby) return 'gatsby';
  if (Object.keys(deps).some((d) => d.startsWith('@remix-run/'))) return 'remix';
  if (deps['react-scripts']) return 'cra';
  if (deps['@11ty/eleventy']) return 'eleventy';
  if (deps.vite) return 'vite';
  return exists(path.join(dir, 'index.html')) ? 'static' : 'node';
}

function readNetlifyToml(dir) {
  const file = path.join(dir, 'netlify.toml');
  if (!exists(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const build = text.split(/^\s*\[/m).find((s) => s.startsWith('build]')) || text;
  const pick = (key) => {
    const m = build.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm'));
    return m ? m[1] : null;
  };
  return {
    publish: pick('publish'),
    command: pick('command'),
    functions: pick('functions') || (/\[functions\]/.test(text) ? 'netlify/functions' : null),
  };
}

export function githubUrlFromRemote(remote) {
  if (!remote) return null;
  let url = remote.trim();
  const ssh = url.match(/^git@([^:]+):(.+)$/);
  if (ssh) url = `https://${ssh[1]}/${ssh[2]}`;
  url = url.replace(/^ssh:\/\/git@/, 'https://');
  url = url.replace(/^(https?:\/\/)[^@/]+@/, '$1'); // strip credentials
  url = url.replace(/\.git$/, '');
  return url;
}

export function gitBasics(dir) {
  const inside = sh('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, timeout: 5000 });
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return { isRepo: false };
  const branch = sh('git', ['branch', '--show-current'], { cwd: dir }).stdout.trim() || 'detached HEAD';
  const remote = sh('git', ['remote', 'get-url', 'origin'], { cwd: dir }).stdout.trim() || null;
  return { isRepo: true, branch, remote, githubUrl: githubUrlFromRemote(remote) };
}

export function netlifyLink(dir) {
  const state = readJSON(path.join(dir, '.netlify', 'state.json'), null);
  return state?.siteId ? { linked: true, siteId: state.siteId } : { linked: false, siteId: null };
}

export function detect(dir) {
  dir = path.resolve(dir);
  if (!isDir(dir)) {
    return { exists: false, path: dir, name: path.basename(dir) };
  }
  const pkg = readJSON(path.join(dir, 'package.json'), null);
  const hasPackageJson = !!pkg;
  const framework = detectFramework(dir, pkg);
  const packageManager = hasPackageJson ? detectPM(dir, pkg) : null;
  const scriptsObj = pkg?.scripts || {};
  const scripts = Object.keys(scriptsObj);
  const allDeps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  let typecheckScript = ['typecheck', 'type-check', 'check-types', 'tsc', 'types'].find((s) => scriptsObj[s]) || null;
  if (!typecheckScript && scriptsObj.check) {
    // `check` counts as typecheck only when it can run non-interactively
    const c = scriptsObj.check;
    if (/\btsc\b|svelte-check|vue-tsc/.test(c) || (/astro check/.test(c) && allDeps['@astrojs/check'])) typecheckScript = 'check';
  }
  const toml = readNetlifyToml(dir);

  let publishDir = toml?.publish || null;
  if (!publishDir) {
    const def = FRAMEWORK_DEFAULT_DIR[framework];
    if (def && (def === '.' || exists(path.join(dir, def)))) publishDir = def;
  }
  if (!publishDir) {
    for (const cand of ['dist', 'build', 'out', '_site', 'public']) {
      if (exists(path.join(dir, cand, 'index.html'))) {
        publishDir = cand;
        break;
      }
    }
  }
  if (!publishDir && !hasPackageJson && exists(path.join(dir, 'index.html'))) publishDir = '.';
  if (!publishDir) publishDir = FRAMEWORK_DEFAULT_DIR[framework] || 'dist';

  const publishAbs = path.resolve(dir, publishDir);
  const publishReady = exists(path.join(publishAbs, 'index.html'));
  const functionsDir = toml?.functions || (isDir(path.join(dir, 'netlify', 'functions')) ? 'netlify/functions' : null);
  const hasFunctions = !!functionsDir && isDir(path.join(dir, functionsDir));
  const nl = netlifyLink(dir);

  return {
    exists: true,
    path: dir,
    name: path.basename(dir),
    framework,
    ssr: SSR_FRAMEWORKS.has(framework),
    packageManager,
    hasPackageJson,
    hasNodeModules: exists(path.join(dir, 'node_modules')),
    scripts,
    buildScript: scriptsObj.build ? 'build' : null,
    lintScript: scriptsObj.lint ? 'lint' : null,
    typecheckScript,
    publishDir,
    publishReady,
    hasFunctions,
    netlifyToml: !!toml,
    netlifyLinked: nl.linked,
    siteId: nl.siteId,
    hasGitignore: exists(path.join(dir, '.gitignore')),
    git: gitBasics(dir),
  };
}

export function pmRunArgs(pm, script, extra = []) {
  const bin = pm || 'npm';
  if (bin === 'npm') return [bin, ['run', script, ...(extra.length ? ['--', ...extra] : [])]];
  // yarn, pnpm and bun forward arguments after the script name directly
  return [bin, ['run', script, ...extra]];
}
