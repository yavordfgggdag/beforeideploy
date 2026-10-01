import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
const [bid, project, issue] = process.argv.slice(2);
const child = spawn(bid, ['ai', 'chat', '--project', project, '--action', 'diagnose', '--issue', issue, '--message', '[[eval:stall]] cancellation probe'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', error = '', stopping = false;
const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
child.stdout.on('data', chunk => {
  output += chunk;
  if (!stopping && output.split('\n').some(line => { try { const event = JSON.parse(line); return event.type === 'ai' && event.reset; } catch { return false; } })) {
    stopping = true;
    setTimeout(() => child.kill('SIGTERM'), 100);
  }
});
child.stderr.on('data', chunk => error += chunk);
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
clearTimeout(timeout);
assert(stopping, 'request reached the provider stage: ' + error);
assert.equal(code, 130, output + error);
const events = output.trim().split('\n').map(line => JSON.parse(line));
assert.equal(events.filter(e => e.type === 'result').length, 1);
assert.equal(events.at(-1).code, 'cancelled');
for (const started of events.filter(e => e.type === 'step' && e.status === 'running')) {
  assert(events.some(e => e.id === started.id && ['pass', 'fail', 'skipped'].includes(e.status)), 'stage closed: ' + started.id);
}
const history = spawnSync(bid, ['ai', 'history', '--project', project], { env: process.env, encoding: 'utf8' });
const result = JSON.parse(history.stdout.trim().split('\n').at(-1));
assert.equal(result.data.entries.at(-1).stopped, 'cancelled');
assert.equal(result.data.entries.at(-1).request.issue, issue);
assert.equal(events.find(e => e.historyId)?.historyId, result.data.entries.at(-1).historyId,
  'cancelled turns retain the same identity when history is loaded again');
console.log('cancellation closes stages, emits one final result and retains retry scope');
