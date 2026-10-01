import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-chat-test-'));
process.env.BID_APP_DIR = temp;
const { appendHistory, assistantHistory, assistantReset, conversationMessages, historyResult, updateConversationPatch, updateConversationUndo, discardConversationPatch } = await import('../engine/src/ai/conversation.mjs');
after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('history survives reload, redacts secrets, bounds retention and isolates projects', () => {
  for (let i = 0; i < 205; i++) appendHistory('site-a', { conversation: 'one', message: `Question ${i}`, summary: 'Answer', valid: true });
  appendHistory('site-b', { conversation: 'two', message: 'Keep this private', summary: 'sk-ant-api03-SECRETSECRETSECRETSECRET1234', valid: true });
  const a = assistantHistory({ key: 'site-a' }, { limit: 200 });
  assert.equal(a.entries.length, 200);
  assert.equal(a.entries[0].message, 'Question 5');
  assert.equal(a.conversation, 'one');
  assert.equal(fs.statSync(path.join(temp, 'chats/site-a.jsonl')).mode & 0o777, 0o600);
  assert(!fs.readFileSync(path.join(temp, 'chats/site-b.jsonl'), 'utf8').includes('SECRETSECRET'));
  assistantReset({ key: 'site-a' });
  assert.equal(assistantHistory({ key: 'site-a' }).entries.length, 0);
  assert.equal(assistantHistory({ key: 'site-b' }).entries.length, 1);
});

test('provider context has alternating bounded turns from only the current conversation', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ conversation: 'current', valid: true, message: `Q${i} ` + 'x'.repeat(900), summary: `A${i} ` + 'y'.repeat(900) }));
  rows.push({ conversation: 'other', valid: true, message: 'wrong website', summary: 'private' });
  rows.push({ conversation: 'current', valid: false, message: 'failed request', summary: 'invalid' });
  const messages = conversationMessages(rows, 'current');
  assert(messages.length >= 2 && messages.length <= 12);
  assert(messages.reduce((n, m) => n + m.content.length, 0) <= 4000);
  messages.forEach((m, i) => assert.equal(m.role, i % 2 ? 'assistant' : 'user'));
  assert(messages.at(-1).content.startsWith('A9'));
  assert(!JSON.stringify(messages).includes('private'));
});

test('full proposal diff, apply state and undo are durable while raw code changes stay out of output', () => {
  const result = historyResult({ output: { summary: 'Safe', changes: [{ content: 'hidden' }] }, files: [{ path: 'a.js', diff: '+line\n'.repeat(900) }], valid: true });
  assert(!('changes' in result.output));
  assert.equal(result.files[0].diff.length, 5400, 'review must not silently truncate a patch');
  appendHistory('proposal', { patchFile: '/patch', result });
  assert.equal(discardConversationPatch({ key: 'proposal' }, '/patch').discarded, true);
  assert.equal(assistantHistory({ key: 'proposal' }).entries[0].result.discarded, true);
  assert.equal(discardConversationPatch({ key: 'site-b' }, '/patch').discarded, false, 'another project cannot discard this proposal');
  updateConversationPatch('proposal', '/patch', { applied: { applied: ['a.js'], undoFile: '/undo' }, verified: false });
  assert.equal(assistantHistory({ key: 'proposal' }).entries[0].result.applied.undoFile, '/undo');
  updateConversationUndo('proposal', '/undo', ['a.js'], []);
  assert.equal(assistantHistory({ key: 'proposal' }).entries[0].result.undone, true);
});

test('concurrent CLI writers preserve every operation', async () => {
  const url = new URL('../engine/src/ai/conversation.mjs', import.meta.url).href;
  await Promise.all(Array.from({ length: 4 }, (_, worker) => new Promise((resolve, reject) => {
    const script = `import {appendHistory} from ${JSON.stringify(url)}; for(let i=0;i<10;i++) appendHistory('concurrent',{id:${worker}*10+i});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = ''; child.stderr.on('data', chunk => error += chunk);
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(error)));
  })));
  const entries = assistantHistory({ key: 'concurrent' }, { limit: 200 }).entries;
  assert.equal(entries.length, 40);
  assert.equal(new Set(entries.map(e => e.id)).size, 40);
});

test('patch and undo files under HOME stay absolute so Apply, Review and Undo still find them after a restart', () => {
  // V13 P0: history redaction rewrote HOME to `~`, so a patch under ~/Library/Caches was saved as `~/Library/…`
  const home = os.homedir();
  const patchFile = path.join(home, 'Library', 'Caches', 'BeforeIDeploy', 'site', 'ai-patch-build-1.json');
  const undoFile = path.join(home, 'Library', 'Application Support', 'BeforeIDeploy', 'undo', 'site', 'ai-undo-1.json');
  appendHistory('home-paths', { message: `see ${home}/notes and mail me@example.com`, patchFile, request: { patchFile, files: 'src/a.js' },
    result: historyResult({ output: { summary: 'ok' }, patchFile, files: [{ path: 'src/a.js', diff: `+${home}/x` }], valid: true }) });
  let entry = assistantHistory({ key: 'home-paths' }).entries[0];
  assert.equal(entry.patchFile, patchFile);
  assert.equal(entry.request.patchFile, patchFile);
  assert.equal(entry.result.patchFile, patchFile);
  assert(!entry.message.includes(home) && !entry.message.includes('me@example.com'), 'display text is still redacted');
  assert(!entry.result.files[0].diff.includes(home), 'diff text is still redacted');
  updateConversationPatch('home-paths', patchFile, { applied: { applied: ['src/a.js'], skipped: [], undoFile }, verified: false });
  entry = assistantHistory({ key: 'home-paths' }).entries[0];
  assert.equal(entry.result.applied?.undoFile, undoFile, 'apply state is persisted against the absolute patch path');
  updateConversationUndo('home-paths', undoFile, ['src/a.js'], []);
  assert.equal(assistantHistory({ key: 'home-paths' }).entries[0].result.undone, true, 'undo state is persisted against the absolute undo path');
});
