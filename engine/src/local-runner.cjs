// Trusted log relay for an isolated dev server. The project child receives pipes, never an open file
// descriptor into the protected cache. macOS denies Node's stdio initialization on such a descriptor.
// Keep the child in this process group so Local Preview can stop the entire tree after the engine exits.
// Windows: npm/pnpm are `.cmd` shims, started through the platform layer's spawnSpec (identity on POSIX).
const { spawn } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

import(pathToFileURL(path.join(__dirname, 'platform', 'index.mjs')).href).then(({ spawnSpec }) => {
  const spec = spawnSpec(process.argv[2], process.argv.slice(3));
  const child = spawn(spec.command, spec.args, { ...spec.options, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.on('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
  child.on('close', code => { process.exitCode = code ?? 1; });
});
