// No cloud credentials or payment requests: catalog contracts and read-only demo isolation.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { DEFAULT_CATALOG, offlineCatalog, soldPrices } from '../engine/src/plans-catalog.mjs';
import { billingDemo } from '../engine/src/billing-demo.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-catalog-'));
Object.assign(process.env, { BID_APP_DIR: tmp, BID_CACHE_DIR: path.join(tmp, 'cache'), BID_NO_KEYCHAIN: '1', BID_SECRETS_PASSPHRASE: 'test-passphrase', BID_NO_BUNDLED_CLOUD: '1' });
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
  // catalog v13: Free has its own row; connected hosting is on sale until features.hostingIncluded is switched on
  assert.equal(DEFAULT_CATALOG.version, 'v13');
  assert.equal(DEFAULT_CATALOG.features.hostingIncluded, false);
  assert.ok(html.includes(`${DEFAULT_CATALOG.free.credits.toLocaleString('en-US')} AI credits a month`));
  assert.ok(html.includes('released gradually over 14 days') && html.includes('60,000 credits'));
  assert.ok(!html.includes('€14.99'), 'hosting-included prices stay hidden while the flag is off');
});
test('catalog v13 carries both price sets; the flag decides what is shown', () => {
  const sold = offlineCatalog();
  assert.equal(sold.hostingMode, 'connected');
  assert.deepEqual(sold.plans.map(p => [p.id, p.price, p.yearlyPrice, p.hostingMode]), [['flash', 9.99, 99.9, 'connected'], ['high', 29.99, 299.9, 'connected'], ['knight', 99.99, 999.9, 'connected']]);
  assert.deepEqual(Object.values(DEFAULT_CATALOG.plans).map(p => [p.hostingIncluded.price, p.hostingIncluded.yearly.price]), [[14.99, 183.9], [29.99, 358.9], [99.99, 1089.9]]);
  assert.deepEqual(Object.values(DEFAULT_CATALOG.plans).map(p => p.cloudMinutes), [300, 1000, 4000]);
  assert.deepEqual([sold.free.tokens, sold.free.activeSites, sold.starterBonus.credits, sold.release.hours], [10000, 1, 60000, 336]);
  assert.deepEqual(soldPrices(DEFAULT_CATALOG.plans.knight, true), { price: 99.99, yearlyPrice: 1089.9, yearlyDomain: true, hostingMode: 'included' });
});
test('signed-out/offline catalog keeps all prices visible and disables purchases', async () => {
  const c = await billingCommand('catalog', {});
  assert.equal(c.source, 'offline');
  assert.deepEqual(c.plans.map(p => [p.tokens, p.activeSites, p.validityMonths]), [[40000,1,1],[100000,3,3],[800000,10,10]]);
  assert.ok([...c.plans, ...c.packs].every(p => p.price > 0 && !p.available));
  assert.equal(offlineCatalog().plans[2].extras.netlifyCredits, false);
  assert.equal(c.pricing.actions["audit.full"].credits,400);
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
    assert.equal(fixed.period.start, '2026-10-10T00:00:00.000Z');
    // usage contract v3 in the demo: release curve, guards, carried, bonus, packs (credit model V3)
    assert.equal(fixed.v, 3);
    assert.equal(fixed.included.budget, 100000);
    assert.equal(fixed.included.released, Math.floor(100000 * (5.5 * 24) / 336));
    assert.equal(fixed.included.availableNow, fixed.included.released - fixed.included.spent - fixed.included.held);
    assert.equal(fixed.reason, 'release');
    assert.equal(fixed.guards.last7d, fixed.used.tokens);
    assert.equal(fixed.sites.max, 3);
    assert.equal(fixed.daily.slice(-7).reduce((sum,day)=>sum+day.credits,0),fixed.weekly.used);
    assert.equal(fixed.byModel.reduce((sum,m)=>sum+m.tokens,0),fixed.byAction.find(a=>a.action==='ai').credits);
  } finally { globalThis.fetch = fetchBefore; }
});


test('usage ETag is scoped to account and cloud, handles 304, and never restores a logged-out cache', async () => {
  const { setSecret, deleteSecret } = await import('../engine/src/secrets.mjs');
  const { setCloudConfig } = await import('../engine/src/account.mjs');
  setCloudConfig({url:'https://receipt-tests.supabase.co',anonKey:'test-only'});
  const session = id => setSecret('session',{accessToken:'fake',expiresAt:Date.now()+3600000,user:{id}});
  const previous = globalThis.fetch;
  let calls=0;
  session('alice');
  try {
    globalThis.fetch = async (_url, options) => {
      calls++;
      if(calls===1) { assert.equal(options.headers['If-None-Match'],undefined); return Response.json({...billingDemo('usage'),source:'cloud'},{headers:{etag:'"one"'}}); }
      assert.equal(options.headers['If-None-Match'],'"one"');
      return new Response(null,{status:304,headers:{etag:'"one"'}});
    };
    const first=await billingCommand('usage',{}), second=await billingCommand('usage',{});
    assert.equal(second.remaining.available,first.remaining.available);assert.equal(second.stale,false);
    globalThis.fetch = async () => { deleteSecret('session'); throw new Error('offline'); };
    await assert.rejects(billingCommand('usage',{}),{code:'not_logged_in'});
    session('bob');
    globalThis.fetch = async (_url,options) => {assert.equal(options.headers['If-None-Match'],undefined);deleteSecret('session');return Response.json(billingDemo('usage'));};
    await assert.rejects(billingCommand('usage',{}),{code:'not_logged_in'});
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp,'usage-report.json'))).userId,'alice');
  } finally { globalThis.fetch=previous;deleteSecret('session'); }
});

test('provider metering reserves before dispatch, settles failed remote attempts, releases launch failures and recovers only the receipt',async()=>{
  const {setSecret,deleteSecret}=await import('../engine/src/secrets.mjs');
  const {meteredProviderCall,reconcileMeter}=await import('../engine/src/meter.mjs');
  const session={accessToken:'fake',expiresAt:Date.now()+3600000,user:{id:'meter-user'}};
  setSecret('session',session);
  const previous=globalThis.fetch;
  const calls=[];let blocked=false,receiptLost=false,providerCalls=0;
  globalThis.fetch=async(url,options)=>{
    if(url.includes('/rest/'))return Response.json([{role:'normal'}]);
    const body=JSON.parse(options.body);calls.push({...body,kind:body.action === 'operation_report' ? 'report' : body.kind});
    if(blocked && body.kind==='reserve')return Response.json({code:'window_week',resetsAt:'2026-10-08T00:00:00Z'},{status:403});
    if(receiptLost && body.action==='operation_report')throw new Error('offline');
    return Response.json({ok:true});
  };
  try {
    const invoke=async()=>{providerCalls++;assert.equal(calls.at(-1).kind,'reserve');return {code:0};};
    await meteredProviderCall({key:'shop'},'deploy.preview',invoke);
    assert.deepEqual(calls.map(c=>c.kind),['reserve','report']);assert.equal(calls[0].operationId,calls[1].operationId);
    await meteredProviderCall({key:'shop'},'deploy.preview',async()=>({code:127}));assert.equal(calls.at(-1).kind,'release');
    await assert.rejects(meteredProviderCall({key:'shop'},'deploy.preview',async()=>{throw Object.assign(new Error('provider rejected'),{code:'netlify_failed'});}));assert.equal(calls.at(-1).kind,'report');
    receiptLost=true;await meteredProviderCall({key:'shop'},'deploy.preview',invoke);
    const operation=calls.at(-1).operationId;receiptLost=false;await reconcileMeter(session);
    assert.equal(calls.at(-1).operationId,operation);assert.equal(calls.at(-1).kind,'report');assert.equal(providerCalls,2);
    blocked=true;await assert.rejects(meteredProviderCall({key:'shop'},'deploy.preview',invoke),{code:'window_week',resetsAt:'2026-10-08T00:00:00Z'});assert.equal(providerCalls,2);
    const before=calls.length;await reconcileMeter({...session,user:{id:'other'}});assert.equal(calls.length,before);
  } finally {globalThis.fetch=previous;deleteSecret('session');}
});


test('usage watch streams reports and cancellation produces one final result without a purchase',async()=>{
 const child=spawn(process.execPath,[path.join(root,'engine/src/bid.mjs'),'billing','usage','--watch','--demo'],{env:{...process.env,BID_BILLING_DEMO:'1'},stdio:['ignore','pipe','pipe']});
 let output='',error='',cancelled=false;
 child.stdout.on('data',chunk=>{output+=chunk; if(!cancelled && output.includes('"type":"usage"')){cancelled=true;child.kill('SIGTERM');}});
 child.stderr.on('data',chunk=>error+=chunk);
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('watch did not respond'));},5000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
 assert.equal(code,130,error);const lines=output.trim().split('\n').map(JSON.parse);
 assert.equal(lines.filter(l=>l.type==='usage').length,1);assert.equal(lines.filter(l=>l.type==='result').length,1);assert.equal(lines.at(-1).code,'cancelled');
});

test('credit model V3: estimate asks when N credits can start; refusals keep their reason and readyAt', async () => {
  const { setSecret, deleteSecret } = await import('../engine/src/secrets.mjs');
  const { setCloudConfig } = await import('../engine/src/account.mjs');
  setCloudConfig({ url: 'https://receipt-tests.supabase.co', anonKey: 'test-only' });
  setSecret('session', { accessToken: 'fake', expiresAt: Date.now() + 3600000, user: { id: 'v3-user' } });
  const previous = globalThis.fetch, bodies = [];
  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body); bodies.push(body);
      if (body.action === 'estimate') return Response.json({ need: body.credits, readyAt: '2026-10-12T08:00:00Z', reason: 'release' });
      return Response.json({ code: 'guard_24h', reason: 'guard24h', readyAt: '2026-10-11T09:00:00Z' }, { status: 403 });
    };
    const est = await billingCommand('estimate', { credits: '37000', 'usage-action': 'ai.fix' });
    assert.equal(est.readyAt, '2026-10-12T08:00:00Z');
    assert.deepEqual([bodies[0].credits, bodies[0].usageAction], [37000, 'ai.fix']);
    await assert.rejects(billingCommand('estimate', { credits: '-5' }), { code: 'usage' });
    await assert.rejects(billingCommand('meter', { 'usage-action': 'check.run', 'operation-id': 'op-guarded-1', kind: 'reserve' }), e => e.code === 'guard_24h' && e.readyAt === '2026-10-11T09:00:00Z');
  } finally { globalThis.fetch = previous; deleteSecret('session'); }
});
