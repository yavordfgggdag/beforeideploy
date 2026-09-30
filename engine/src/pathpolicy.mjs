// One policy for every file operation the engine does inside a user's project on someone else's behalf
// (AI patches, assistant context, undo) — WP01, audit E1/E2/E5.
//
// Classes:
//   blocked — never touched (.git, node_modules, CI workflows, tool configs that make git/npm run commands)
//   secret  — never read into a model context and never written by the AI (.env*, keys, certificates …)
//   config  — files that make tools run code or decide what gets built/published (package.json scripts,
//             bundler configs, hosting configs, lockfiles). Readable; changing them needs a separate,
//             explicit approval (`--allow-config`), and the app shows a distinct warning.
//   source  — everything else
//
// Paths are relative POSIX paths. Absolute paths, NUL bytes and any `..` segment are refused as written
// (`src/../x` is refused even though it would land inside the project), every existing parent on the way
// must be a real directory (no symlinks), and writes open the final file with O_NOFOLLOW so a symlink
// swapped in between the check and the write is not followed.
import fs from 'node:fs';
import path from 'node:path';

// compared case-insensitively: the default macOS volume (APFS) is case-insensitive
const BLOCKED_DIRS = new Set(['node_modules', '.git', '.netlify', '.vercel', '.next', 'dist', 'build', '.husky', '.github', '.vscode', '.idea']);
const BLOCKED_FILES = new Set(['.gitmodules', '.gitattributes', '.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs', '.envrc', '.netrc']);

const SECRET_EXACT = new Set(['.env', '.netrc', '.htpasswd', '.pgpass', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'credentials', 'credentials.json', 'service-account.json', 'secrets.json', 'secrets.yml', 'secrets.yaml']);
const SECRET_OK = new Set(['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.defaults']);
const SECRET_RE = [/^\.env\..+/, /\.(pem|key|p12|pfx|keystore|jks|p8|asc|gpg|ppk)$/, /^id_(rsa|dsa|ecdsa|ed25519)(\.|$)/, /^service-account.*\.json$/, /^credentials.*\.json$/];

const CONFIG_EXACT = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'bun.lockb', 'bunfig.toml',
  'netlify.toml', 'vercel.json', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc', 'firebase.json', 'bid.config.json',
  'makefile', 'dockerfile', 'procfile', 'justfile', '.nvmrc', '.node-version', '.tool-versions', 'deno.json', 'deno.jsonc',
  '_headers', '_redirects', 'turbo.json', 'nx.json', 'lerna.json',
]);
const CONFIG_RE = [
  /\.config\.(js|cjs|mjs|ts|cts|mts|json)$/, // vite/next/astro/tailwind/postcss/eslint … configs are programs
  /^\.(babelrc|eslintrc|prettierrc|stylelintrc|postcssrc|swcrc|lintstagedrc)(\..+)?$/,
  /^tsconfig(\..+)?\.json$/, /^jsconfig(\..+)?\.json$/,
  /^docker-compose.*\.ya?ml$/, /^compose\.ya?ml$/,
];

/** Class of a relative path: 'blocked' | 'secret' | 'config' | 'source'. */
export function classify(rel) {
  const parts = String(rel).split(/[\\/]+/).filter(Boolean);
  const lower = parts.map((p) => p.toLowerCase());
  if (lower.slice(0, -1).some((p) => BLOCKED_DIRS.has(p))) return 'blocked';
  const name = lower[lower.length - 1] || '';
  if (BLOCKED_DIRS.has(name) || BLOCKED_FILES.has(name)) return 'blocked';
  if (!SECRET_OK.has(name) && (SECRET_EXACT.has(name) || SECRET_RE.some((r) => r.test(name)))) return 'secret';
  if (CONFIG_EXACT.has(name) || CONFIG_RE.some((r) => r.test(name))) return 'config';
  return 'source';
}

/**
 * Resolves `rel` inside `root` for an operation. Returns { ok, abs, rel, cls, reason }.
 * op: 'read' (model context) | 'create' | 'edit' | 'delete' | 'restore' (undo of an earlier change).
 * reason: outside_project | blocked | secret | config_needs_approval | symlink
 */
export function resolveInProject(root, rel, { op = 'read', allowConfig = false } = {}) {
  const out = (reason, extra = {}) => ({ ok: !reason, abs: null, rel: String(rel || ''), cls: null, reason, ...extra });
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return out('outside_project');
  const segments = rel.split(/[\\/]+/);
  if (segments.some((s) => s === '..')) return out('outside_project');
  const clean = segments.filter((s) => s && s !== '.').join('/');
  if (!clean) return out('outside_project');
  const base = path.resolve(root);
  const abs = path.resolve(base, ...clean.split('/'));
  if (!abs.startsWith(base + path.sep)) return out('outside_project');
  const cls = classify(clean);
  if (cls === 'blocked') return out('blocked', { rel: clean, cls });
  if (cls === 'secret') return out('secret', { rel: clean, cls });
  if (cls === 'config' && op !== 'read' && op !== 'restore' && !allowConfig) return out('config_needs_approval', { rel: clean, cls, abs });
  // no symlink anywhere on the way — the project root itself may be a symlink (the user chose it)
  let probe = base;
  for (const p of clean.split('/')) {
    probe = path.join(probe, p);
    let st;
    try {
      st = fs.lstatSync(probe);
    } catch {
      break; // not created yet
    }
    if (st.isSymbolicLink()) return out('symlink', { rel: clean, cls });
  }
  return { ok: true, abs, rel: clean, cls, reason: null };
}

/** Back-compatible helper: the absolute path when the policy allows reading it, else null. */
export function safePath(dir, rel) {
  const r = resolveInProject(dir, rel, { op: 'read' });
  return r.ok ? r.abs : null;
}

function reassertParents(root, abs) {
  const base = path.resolve(root);
  let probe = base;
  for (const p of path.relative(base, path.dirname(abs)).split(path.sep).filter(Boolean)) {
    probe = path.join(probe, p);
    const st = fs.lstatSync(probe);
    if (st.isSymbolicLink() || !st.isDirectory()) throw Object.assign(new Error(`not a real directory: ${probe}`), { code: 'ELOOP' });
  }
}

/** Writes without following a symlink at the final component; parents are re-checked right before. */
export function writeNoFollow(root, abs, data, { exclusive = false } = {}) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  reassertParents(root, abs);
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | (exclusive ? fs.constants.O_EXCL : fs.constants.O_TRUNC) | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(abs, flags, 0o644);
  try {
    fs.writeSync(fd, typeof data === 'string' ? data : Buffer.from(data));
  } finally {
    fs.closeSync(fd);
  }
}

/** Removes a file (never a directory); a symlink in its place is removed as a link, never followed. */
export function removeNoFollow(root, abs) {
  reassertParents(root, abs);
  const st = fs.lstatSync(abs);
  if (st.isDirectory()) throw Object.assign(new Error(`is a directory: ${abs}`), { code: 'EISDIR' });
  fs.unlinkSync(abs);
}
