// No cloud credentials or payment requests: catalog contracts and read-only demo isolation.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DEFAULT_CATALOG, offlineCatalog } from '../engine/src/plans-catalog.mjs';
import { billingDemo } from '../engine/src/billing-demo.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-catalog-'));
Object.assign(process.env, { BID_APP_DIR: tmp, BID_CACHE_DIR: path.join(tmp, 'cache'), BID_NO_KEYCHAIN: '1', BID_NO_BUNDLED_CLOUD: '1' });
const { billingCommand } = await import('../engine/src/billing.mjs');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('one canonical catalog drives the engine, schema and generated website prices', () => {
  const check = spawnSync(process.execPath, ['scripts/catalog-sync.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  const credits = spawnSync(process.execPath, ['scripts/credits-sync.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(credits.status, 0, credits.stderr);
  assert.deepEqual(DEFAULT_CATALOG, JSON.parse(fs.readFileSync(path.join(root, 'supabase/functions/_shared/plans-catalog.json'), 'utf8')));
  const html = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
  for (const plan of Object.values(DEFAULT_CATALOG.plans)) {
    assert.ok(html.includes(`€${plan.price.toFixed(2)}`));
    assert.ok(html.includes(plan.credits.toLocaleString('en-US')));
  }
  for (const pack of DEFAULT_CATALOG.packs) assert.ok(html.includes(`€${pack.price.toFixed(2)}`));
});
test('signed-out/offline catalog keeps all prices visible and disables purchases', async () => {
  const c = await billingCommand('catalog', {});
  assert.equal(c.source, 'offline');
  assert.deepEqual(c.plans.map(p => [p.tokens, p.activeSites, p.validityMonths]), [[100000,1,1],[300000,3,3],[1000000,10,10]]);
  assert.ok([...c.plans, ...c.packs].every(p => p.price > 0 && !p.available));
  assert.equal(offlineCatalog().plans[2].extras.netlifyCredits, false);
});
test('demo reads are consistent and every mutation is refused before network access', async () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('demo accessed network'); };
  try {
    const u = await billingCommand('usage', { demo: true });
    const s = await billingCommand('status', { demo: true });
    assert.equal(u.source, 'demo');
    assert.equal(u.remaining.available, s.balance.available);
    assert.equal(u.daily.reduce((sum,day) => sum+day.credits,0), u.used.tokens);
    assert.equal(u.byAction.reduce((sum,a) => sum+a.credits,0), u.used.tokens);
    for (const action of ['checkout','trial','portal','sync','confirm-change']) await assert.rejects(billingCommand(action, { demo: true }), { code: 'demo_read_only' });
    const fixed = billingDemo('usage', new Date('2026-10-15T12:00:00Z'));
    assert.equal(fixed.period.start, '2026-09-16T00:00:00.000Z');
    assert.equal(fixed.daily.slice(-7).reduce((sum,day)=>sum+day.credits,0),fixed.weekly.used);
    assert.equal(fixed.byModel.reduce((sum,m)=>sum+m.tokens,0),fixed.byAction.find(a=>a.action==='ai').credits);
  } finally { globalThis.fetch = fetchBefore; }
});
