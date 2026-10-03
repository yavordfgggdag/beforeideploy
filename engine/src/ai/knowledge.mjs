// What the app already knows about common failures (S7). A failing check's log goes to the model together with the
// "likely causes" found here, so it starts from the real cause instead of guessing — and the facts that only the
// project can supply (a file that exists under a different capitalisation, the Node version, a fix that was already
// applied and did not help) are looked up here, never left to the model. Pure and offline; every hint is plain
// English for the model (the answer is written in the owner's language by the prompt).
import fs from 'node:fs';
import path from 'node:path';

/**
 * Failure patterns → what to tell the model. Each `test` runs on the log tail and the check's detail lines;
 * `hint` is one or two sentences, a cause and the smallest safe fix. Order = priority; at most `MAX` are used.
 */
export const PLAYBOOK = [
  { id: 'module-missing', test: /Cannot find (?:module|package) '([^']+)'|Module not found: (?:Error: )?Can't resolve '([^']+)'|Failed to resolve import "([^"]+)"|Could not resolve "([^"]+)"|ERR_MODULE_NOT_FOUND/i,
    hint: (m) => `The import "${m[1] || m[2] || m[3] || m[4] || 'it names'}" cannot be found. A name that does not start with "." or "/" is a package: it must be listed in package.json dependencies and installed (one command in the terminal), not copied into the code. A relative path is a wrong file name or folder, including capitalisation.` },
  { id: 'ts-module', test: /TS2307|TS7016|Could not find a declaration file for module/i,
    hint: () => 'TypeScript cannot find a module or its types. For a package, the missing piece is usually `@types/<name>` as a dev dependency or a missing install; for a relative path, check the file name and extension.' },
  { id: 'eresolve', test: /ERESOLVE|unable to resolve dependency tree|Could not resolve dependency|peer dep/i,
    hint: () => 'npm found two packages that want different versions of a third. The least risky fix is aligning the version the log names (or `--legacy-peer-deps` for that one install). Never delete package-lock.json or node_modules as the fix.' },
  { id: 'node-version', test: /Unsupported engine|The engine "node" is incompatible|requires Node(?:\.js)? (?:version )?[>=^~]?\s*\d+|node: bad option|SyntaxError: Unexpected token '\?\?=?'|ERR_REQUIRE_ESM/i,
    hint: (m, ctx) => `The Node version does not match what the project needs${ctx.node ? ` (this Mac runs ${ctx.node})` : ''}. The host reads the version from \`NODE_VERSION\` in netlify.toml ([build.environment]) or a \`.nvmrc\` file; set it to the version the log or package.json "engines" asks for.` },
  { id: 'window-undefined', test: /(?:window|document|localStorage|sessionStorage|navigator|self) is not defined|ReferenceError: (?:window|document)/i,
    hint: () => 'Code that only works in a browser runs on the server while the site is built. Fix by running it only in the browser (inside useEffect / onMounted, behind `typeof window !== "undefined"`, or a client-only dynamic import), not by changing the build.' },
  { id: 'env-missing', test: /(?:Missing|Undefined|Unset) (?:required )?environment variable|is not set in (?:the )?environment|process\.env\.[A-Z0-9_]+ (?:is )?undefined|Invalid environment variables|env var(?:iable)?s? .* (?:missing|required)|Environment variable not found/i,
    hint: () => 'A required environment variable is missing where the build runs. Variable NAMES go in the host settings (Netlify: Site configuration → Environment variables) and in a local .env that Git ignores; never write a value into code or Git, and never ask the owner to paste a secret. A browser-exposed variable needs the framework prefix (VITE_, NEXT_PUBLIC_, PUBLIC_).' },
  { id: 'ts-implicit', test: /TS7006|TS7031|TS7005|implicitly has an? 'any' type/i,
    hint: () => 'A value has no type. Give it the real type (or the parameter an explicit one) rather than switching strict mode off or adding `any` everywhere.' },
  { id: 'ts-property', test: /TS2339|TS2551|Property '[^']+' does not exist on type/i,
    hint: () => 'The code uses a property the type does not have. Check for a typo or an optional value first; extend the type only when the data really has it. Do not cast to `any` to make it pass.' },
  { id: 'ts-null', test: /TS2531|TS2532|TS18047|TS18048|TS2322.*undefined|is possibly '(?:null|undefined)'/i,
    hint: () => 'A value can be null or undefined here. Handle that case (a guard, optional chaining, a default) instead of asserting with `!` or ignoring the error.' },
  { id: 'eslint-unused', test: /no-unused-vars|@typescript-eslint\/no-unused-vars|is defined but never used|is assigned a value but never used/i,
    hint: () => 'Remove the unused variable or import (or use it). Do not add an eslint-disable comment or turn the rule off.' },
  { id: 'eslint-hooks', test: /react-hooks\/(?:rules-of-hooks|exhaustive-deps)|React Hook .* (?:is called conditionally|has a missing dependency)/i,
    hint: () => 'A React hook is called conditionally or its dependency list is incomplete. Move the hook above any early return, or add the dependency; do not silence the rule.' },
  { id: 'cannot-read', test: /Cannot read propert(?:y|ies) of (?:undefined|null)(?: \(reading '([^']+)'\))?|undefined is not an object|is not a function|x is undefined/i,
    hint: (m) => `A value is undefined at runtime${m[1] ? ` where the code reads "${m[1]}"` : ''}. Find where it should have been set (data not loaded yet, a wrong key, a missing prop) and guard or fix that place; the file and line in the log are the starting point.` },
  { id: 'json-html', test: /Unexpected token '<'|is not valid JSON|JSON\.parse: unexpected character|Unexpected end of JSON input/i,
    hint: () => 'Something expected JSON but got an HTML page or nothing — usually a wrong URL or path, a 404, or a missing file. Check the address being fetched or the JSON file itself.' },
  { id: 'oom', test: /JavaScript heap out of memory|FATAL ERROR: .*(?:heap|memory)|ENOMEM|Killed\s*$/im,
    hint: () => 'The build ran out of memory. Raise it with `NODE_OPTIONS=--max-old-space-size=4096` in the build environment (netlify.toml [build.environment]) before reducing the project.' },
  { id: 'port-busy', test: /EADDRINUSE|address already in use|port \d+ is (?:already )?in use/i,
    hint: () => 'The port is already taken — usually the app\'s own Local Preview or another dev server is still running. Stop that one (the Local Preview stop button) instead of changing code.' },
  { id: 'enospc', test: /ENOSPC|no space left on device|System limit for number of file watchers/i,
    hint: () => 'The disk is full (or the file-watcher limit was hit). That is not a code problem: free space (empty the Trash, delete old build folders) and run the check again.' },
  { id: 'git-auth', test: /Permission denied \(publickey\)|Authentication failed|could not read Username|Repository not found|remote: Support for password authentication was removed/i,
    hint: () => 'Git cannot sign in to the remote. Fix it in the app (sign in to GitHub there) or by checking the repository address — not by putting a token into the URL or the code.' },
  { id: 'git-nonff', test: /non-fast-forward|failed to push some refs|Updates were rejected/i,
    hint: () => 'The remote has commits this copy does not. Pull (or fetch and merge) first; never force-push as the fix.' },
  { id: 'postcss-tailwind', test: /Unknown at rule @(?:tailwind|apply|layer)|tailwindcss.*(?:PostCSS plugin|cannot find)/i,
    hint: () => 'Tailwind is not wired into the build: the PostCSS/Tailwind config is missing or the package is not installed. Add the missing config or dependency; do not remove the directives.' },
  { id: 'css-import', test: /Can't resolve '[^']+\.css'|Failed to resolve import ".*\.css"/i,
    hint: () => 'A stylesheet import points at a file that does not exist; check the path and capitalisation.' },
  { id: 'next-config', test: /Invalid next\.config|next\.config\.[mc]?js.*(?:error|invalid)|Error: Invalid configuration object/i,
    hint: () => 'The framework config has an invalid or removed option. Compare it with the version in package.json and change only the option the log names.' },
  { id: 'spa-404', test: /Page not found|404.*(?:\/[a-z-]+)|Not Found.*route/i, steps: ['hosting', 'deploy'],
    hint: () => 'A single-page app needs a rewrite so every route serves index.html: a `_redirects` file (`/* /index.html 200`) or a [[redirects]] block in netlify.toml.' },
  { id: 'build-command', test: /(?:Command|Script) not found|missing script: (?:build|start)|npm ERR! missing script|could not determine executable/i,
    hint: () => 'The build command in the host settings or netlify.toml does not exist in package.json "scripts". Make the two agree (usually `npm run build` and the build script that exists).' },
  { id: 'publish-dir', test: /Deploy directory '([^']+)' does not exist|publish directory .* not found|No such file or directory.*\b(?:dist|build|out|public)\b/i,
    hint: (m) => `The publish folder${m[1] ? ` "${m[1]}"` : ''} is not where the build puts its output. Make netlify.toml's [build] publish setting match the real output folder (dist for Vite, out for static exports, build for Create React App).` },
  { id: 'case-sensitive', test: /Can't resolve '\.{1,2}\/[^']*[A-Z][^']*'|Cannot find module '\.{1,2}\/[^']*[A-Z]/,
    hint: () => 'A relative import with capital letters fails to resolve: macOS ignores capitalisation but the host (Linux) does not. Make the import match the real file name exactly.' },
];

/** Hints per Site Builder / site-quality rule (the `site` step lists them as `WARN rule · file:line — …`). */
export const SITE_RULES = {
  'seo.title': 'Every page needs one <title> of about 10–70 characters that says what the page is and names the site.',
  'seo.titleLength': 'Make the <title> 10–70 characters (and different on every page).',
  'seo.description': 'Add <meta name="description" content="…"> of one or two plain sentences (about 70–160 characters) per page.',
  'seo.lang': 'Add the language to the opening tag: <html lang="en"> (or "bg") so screen readers and search engines read it right.',
  'seo.noindex': 'A noindex rule hides the site from search: remove it from the meta tag or robots.txt unless that is intended.',
  'content.lorem': 'Replace the placeholder text with the real words. Do not invent facts; ask which text to use if unknown.',
  'content.placeholderImage': 'Replace the placeholder image address with a real image file in the project.',
  'content.localhost': 'A link or file points to localhost: change it to a relative path (/page.html) or the real address.',
  'content.brokenLinks': 'A link points to a page or file that does not exist: fix the address, or create the page. Check the file name and capitalisation.',
  'content.mixedContent': 'The page loads something over http: change it to https (or a relative path).',
  'content.emptyHref': 'A link goes nowhere (href="#"): give it a real address, or make it a button.',
  'content.exampleContact': 'An example email or phone number is still in a link: replace it with the owner\'s real one — ask for it; never invent one.',
  'content.sample': 'The page still shows example menu items or prices from the theme: the owner must replace them with their own (they can use "Change it with words").',
  'a11y.imgAlt': 'Every <img> needs an alt text that describes the picture in a few words (alt="" only for purely decorative images).',
  'a11y.inputLabel': 'Every form field needs a visible <label for="id"> connected to it (or an aria-label when there is no visible text).',
  'a11y.buttonText': 'A button without text cannot be read by a screen reader: add words inside it or an aria-label.',
  'assets.imageSize': 'The image is too large: resize it to the width it is shown at and save it as an optimised JPEG/WebP.',
  'assets.pageSize': 'The page is too heavy: remove unused inline code and heavy embedded files.',
};

const MAX_HINTS = 6;

/** The rule ids in `WARN rule · file:line — detail` lines of the site check. */
export function siteRulesIn(text) {
  return [...new Set([...String(text || '').matchAll(/\b(?:FAIL|WARN|INFO)\s+((?:seo|content|a11y|assets|structure)\.[A-Za-z]+)/g)].map((m) => m[1]))];
}

/** Files in the project whose name differs from `want` only by capitalisation (shallow, bounded) — the macOS-vs-Linux trap. */
export function caseTwin(dir, importPath) {
  const base = path.basename(String(importPath || '')).replace(/\.[a-z]+$/i, '').toLowerCase();
  if (!base || base.length < 2) return null;
  let seen = 0;
  const walk = (rel, depth) => {
    if (depth > 4 || seen > 3000) return null;
    let entries = [];
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.') || ['dist', 'build', 'out'].includes(e.name)) continue;
      seen++;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { const f = walk(r, depth + 1); if (f) return f; }
      else if (e.name.replace(/\.[a-z]+$/i, '').toLowerCase() === base && e.name.replace(/\.[a-z]+$/i, '') !== path.basename(String(importPath)).replace(/\.[a-z]+$/i, '')) return r;
    }
    return null;
  };
  return walk('', 0);
}

/**
 * The likely causes for a failing check, most specific first: `[{ id, text }]`.
 * `ctx`: `{ stepIds, log, dir, node, siteBuilder, previousFix }` — everything is optional.
 */
export function knownCauses(ctx = {}) {
  const log = String(ctx.log || '');
  const steps = new Set(ctx.stepIds || []);
  const out = [];
  const add = (id, text) => { if (text && !out.some((o) => o.id === id)) out.push({ id, text }); };

  if (ctx.previousFix) add('previous-fix', `A previous automatic fix for this step changed ${ctx.previousFix.files.join(', ')}${ctx.previousFix.at ? ` (${ctx.previousFix.at})` : ''} and the check still fails. Do not repeat that change; look for the real cause.`);

  // the macOS-is-case-insensitive trap, proven from the project's own files
  const rel = /(?:Can't resolve|Cannot find module|Failed to resolve import|Could not resolve)\s+['"](\.{1,2}\/[^'"]+)['"]/.exec(log);
  if (rel && ctx.dir) {
    const twin = caseTwin(ctx.dir, rel[1]);
    if (twin) add('case-twin', `The project has the file "${twin}", but the import is "${rel[1]}" — the names differ only in capitalisation. macOS does not care, the host does. Change the import to match the real file name exactly (or rename the file).`);
  }

  for (const p of PLAYBOOK) {
    if (p.steps && !p.steps.some((s) => steps.has(s))) continue;
    const m = p.test.exec(log);
    if (m) add(p.id, p.hint(m, ctx));
  }

  // site-quality rules the check named
  for (const rule of siteRulesIn(log)) if (SITE_RULES[rule]) add(`site:${rule}`, `${rule}: ${SITE_RULES[rule]}`);

  if (ctx.siteBuilder) add('site-builder', 'This site was generated by the Site Builder from bid.site.json. Text and structure are best changed with the app\'s "Change it with words"; if a file is edited by hand instead, the Site Builder will refuse to overwrite it later. Never edit bid.site.json by hand.');

  // proven hints first, the rest in table order, bounded
  return out.slice(0, MAX_HINTS);
}
