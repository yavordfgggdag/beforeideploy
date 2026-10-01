// Trusted log relay for an isolated dev server. The project child receives pipes, never an open file
// descriptor into the protected cache. macOS denies Node's stdio initialization on such a descriptor.
// Keep the child in this process group so Local Preview can stop the entire tree after the engine exits.
const { spawn } = require('node:child_process');
const child = spawn(process.argv[2], process.argv.slice(3), { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
child.on('close', code => { process.exitCode = code ?? 1; });
