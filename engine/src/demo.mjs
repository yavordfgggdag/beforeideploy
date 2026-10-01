// "Try it with a sample project" (V10 onboarding): a small real website in ~/Documents/Before I Deploy Demo,
// with a build script, a Git repository and one uncommitted change, so every check has something to say.
// Idempotent: running it again reuses the folder.
import fs from 'node:fs';
import path from 'node:path';
import { sh } from './util.mjs';
import { upsertProject } from './store.mjs';

const FILES = {
  'package.json': JSON.stringify({ name: 'demo-site', private: true, scripts: { build: 'node build.mjs' } }, null, 2) + '\n',
  'build.mjs': `// Copies src/ to dist/ and stamps the build time — a stand-in for Vite / Next / Astro.
import fs from 'node:fs';
import { gitSh } from './gitbin.mjs';
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist', { recursive: true });
for (const f of fs.readdirSync('src')) fs.copyFileSync('src/' + f, 'dist/' + f);
const html = fs.readFileSync('dist/index.html', 'utf8').replace('{{built}}', new Date().toISOString().slice(0, 16).replace('T', ' '));
fs.writeFileSync('dist/index.html', html);
console.log('built dist/ (' + fs.readdirSync('dist').length + ' files)');
`,
  'src/index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Demo site — Before I Deploy</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Hello from the demo site 👋</h1>
    <p>Change this text, save, and watch Before I Deploy check the project again by itself.</p>
    <p class="muted">Built {{built}}</p>
  </main>
</body>
</html>
`,
  'src/style.css': `body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 18px/1.5 -apple-system, system-ui, sans-serif; background: linear-gradient(135deg, #0b3d91, #3b9cff); color: #fff; }
main { max-width: 34rem; padding: 2rem; }
h1 { font-size: 2.4rem; margin: 0 0 .5rem; }
.muted { opacity: .7; font-size: .9rem; }
`,
  '.gitignore': 'node_modules/\ndist/\n.DS_Store\n',
  'node_modules/.keep': '',
};

export function demoCreate({ home = process.env.HOME || '' } = {}) {
  const dir = path.join(home, 'Documents', 'Before I Deploy Demo', 'demo-site');
  const fresh = !fs.existsSync(path.join(dir, 'package.json'));
  if (fresh) {
    for (const [rel, content] of Object.entries(FILES)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    const env = { ...process.env, GIT_AUTHOR_NAME: 'Before I Deploy', GIT_AUTHOR_EMAIL: 'demo@beforeideploy.app', GIT_COMMITTER_NAME: 'Before I Deploy', GIT_COMMITTER_EMAIL: 'demo@beforeideploy.app' };
    gitSh(['init', '-q'], { cwd: dir, env });
    gitSh(['add', '-A'], { cwd: dir, env });
    gitSh(['commit', '-qm', 'Demo site'], { cwd: dir, env });
    // one uncommitted change, so the Git step has something to show
    fs.writeFileSync(path.join(dir, 'src', 'about.html'), '<!doctype html><title>About</title><h1>About</h1>\n');
  }
  const project = upsertProject(dir, { name: 'demo-site' });
  return { ...project, created: fresh };
}
