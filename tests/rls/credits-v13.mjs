// Credit model V3 against the real SQL (supabase/credits-v13.sql). Mirrors web/src/lib/credits.test.ts — the UI's
// reference math — so the database enforces exactly what the app explains. Catalog v13 defaults are in force:
// release 336 h, guards 25 % / 24 h and 50 % / 7 days on settled included spend, packs ≤ 200 000 credits per hour.
export async function testCreditsV3({db,t,assert,as}) {
 const t0='2026-11-02T08:00:00Z';
 const H=3600000, at=hours=>new Date(Date.parse(t0)+hours*H).toISOString();
 const rpc=async(name,args)=>{
  const keys=Object.keys(args);
  const r=await as('service_role',null,q=>q(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as result`,Object.values(args)));
  return r.rows[0].result;
 };
 let n=0;
 const user=async(plan='flash',{sub=true,created=t0}={})=>{
  const id=(await db.query("insert into auth.users(email) values($1) returning id",[`v3-${++n}@example.test`])).rows[0].id;
  await db.query('update profiles set plan=$2,created_at=$3 where user_id=$1',[id,plan,created]);
  if(sub && plan!=='free') await db.query("insert into subscriptions(user_id,provider,provider_ref,customer_ref,tier,status,period_start,period_end) values($1::uuid,'paddle',($1::uuid)::text,'ctm_'||$1::text,$2,'active',$3,$4)",[id,plan,t0,at(30*24)]);
  return id;
 };
 const B={flash:40000,high:100000,knight:800000};
 const grant=(id,tier,when=t0,ref=`period-${when}`)=>rpc('bid_grant',{p_user:id,p_credits:B[tier],p_source:'plan_grant',p_ref:ref,p_tier:tier,p_granted_at:when,p_now:when});
 const pack=(id,credits,when=t0,ref='pack-'+when)=>rpc('bid_grant',{p_user:id,p_credits:credits,p_source:'topup',p_ref:ref,p_granted_at:when,p_now:when});
 const state=(id,when,action=null)=>rpc('bid_v13_state',{p_user:id,p_now:when,p_action:action});
 const charge=(id,credits,op,when,action='ai.fix')=>rpc('bid_charge',{p_user:id,p_action:action,p_credits:credits,p_operation_id:op,p_now:when});
 const spends=async(id,op)=>Object.fromEntries((await db.query('select kind,sum(credits)::bigint as c from credit_spends where user_id=$1 and operation_id=$2 group by kind',[id,op])).rows.map(r=>[r.kind,Number(r.c)]));

 await t('V3 release: R(t) = floor(B·(t−t₀)/336 h), capped at B; the included budget releases over 14 days',async()=>{
  const id=await user('flash'); await grant(id,'flash');
  for(const [h,want] of [[0,0],[1,119],[168,20000],[335,39880],[336,40000],[500,40000]]) {
   const s=await state(id,at(h));
   assert(s.included.released===want,`R(${h} h)=${s.included.released}, expected ${want}`);
  }
  const s=await state(id,at(100)); assert(s.included.budget===40000 && Date.parse(s.included.releaseEndsAt)===Date.parse(at(336)),'budget and release end');
  assert(s.reason==='release' && s.included.availableNow===s.included.released,'not yet released credits are not spendable');
 });

 await t('V3 guarantee: greedy maximum use cannot exhaust the included budget before 336 h',async()=>{
  const id=await user('flash'); await grant(id,'flash');
  let total=0, exhaustedAt=null;
  for(let h=0;h<=20*24;h+=2) {
   const a=(await state(id,at(h))).included.availableNow;
   if(a>0) { const r=await charge(id,a,`greedy-${h}`,at(h)); assert(r.ok,`greedy charge at ${h} h: ${JSON.stringify(r)}`); total+=a; }
   if(total>=B.flash && exhaustedAt===null) exhaustedAt=h;
  }
  assert(exhaustedAt!==null && exhaustedAt>=336,`exhausted at ${exhaustedAt} h`);
  const blocked=await charge(id,1,'greedy-after',at(20*24+1));
  assert(!blocked.ok && blocked.code==='quota_exhausted','nothing left after the period budget');
 });

 await t('V3 reservations count against availability: two devices cannot spend the same released credits',async()=>{
  const id=await user('flash'); await grant(id,'flash');
  const a=(await state(id,at(168))).included.availableNow; assert(a===20000,'half released');
  assert((await rpc('bid_hold',{p_user:id,p_action:'ai.fix',p_credits:a,p_operation_id:'device-one',p_now:at(168)})).ok,'first device reserves');
  const second=await rpc('bid_hold',{p_user:id,p_action:'ai.fix',p_credits:1,p_operation_id:'device-two',p_now:at(168)});
  assert(!second.ok && second.code==='credits_release' && second.reason==='release','second device waits for release');
  assert((await state(id,at(168))).included.held===20000,'held is visible');
 });

 await t('V3 guards: one large task may exceed 25 % when the window is clear; then new tasks wait (24 h, then 7 days)',async()=>{
  const id=await user('high'); await grant(id,'high');
  const d9=9*24;
  assert((await state(id,at(d9))).included.availableNow>=30000,'≈64 % released at day 9');
  const big=await charge(id,30000,'create-site',at(d9));
  assert(big.ok,'a 30 000 task (30 % of B) starts when nothing was spent in the last 24 h');
  const next=await charge(id,100,'small-after',at(d9+1));
  assert(!next.ok && next.code==='guard_24h' && next.reason==='guard24h','guard24h blocks new tasks after 25 % of B');
  assert(Date.parse(next.readyAt)===Date.parse(at(d9+24)),`ready when the spend leaves the window: ${next.readyAt}`);
  const s=await state(id,at(d9+1)); assert(s.guards.last24h===30000 && s.guards.cap24h===25000 && s.included.availableNow===0,'guard meter');
  assert((await charge(id,25000,'second-day',at(d9+25))).ok,'window clear after 24 h');
  const week=await charge(id,100,'third-day',at(d9+50));
  assert(!week.ok && week.code==='guard_7d','guard7d: 55 000 settled in 7 days ≥ 50 % of B');
  assert(Date.parse(week.readyAt)===Date.parse(at(d9+7*24)),`7-day guard clears when the first spend leaves the window: ${week.readyAt}`);
 });

 await t('V3 spend order: bonus → carried (oldest first) → included → packs; packs continue when included is guarded',async()=>{
  const id=await user('high');
  await grant(id,'high',at(-31*24),'prior-period');               // last month's lot: carried (High keeps 3 months)
  await grant(id,'high',at(-20*24),'current-period');             // this period, fully released (20 days in)
  await db.query("update subscriptions set period_start=$2 where user_id=$1",[id,at(-20*24)]);
  assert((await rpc('bid_v13_claim_bonus',{p_user:id,p_email_hash:'b'.repeat(64),p_now:t0})).ok,'bonus claimed');
  await pack(id,100000);
  const s=await state(id,t0,'ai.fix');
  assert(s.bonus.available===60000 && s.carried===100000 && s.included.availableNow===100000 && s.packs.available===100000,`balances ${JSON.stringify(s)}`);
  assert((await charge(id,200000,'order-one',t0)).ok,'one task across three balances');
  const first=await spends(id,'order-one');
  assert(first.bonus===60000 && first.carried===100000 && first.included===40000 && !first.pack,`bonus, carried, then included: ${JSON.stringify(first)}`);
  assert((await charge(id,50000,'order-two',at(1))).ok,'next task while included is guarded');
  const second=await spends(id,'order-two');
  assert(second.pack===50000 && !second.included,`packs are not subject to R(t) or guards: ${JSON.stringify(second)}`);
 });

 await t('V3 bonus: only for site creation / large fixes, never for chat or checks',async()=>{
  const id=await user('flash',{sub:false});
  await db.query("update profiles set plan='free' where user_id=$1",[id]);
  await db.query(`update settings set value=jsonb_set(value,'{free,tokens}','0') where key='plans'`);
  try {
   assert((await rpc('bid_v13_claim_bonus',{p_user:id,p_email_hash:'c'.repeat(64),p_now:t0})).ok,'bonus claimed');
   const chat=await charge(id,100,'bonus-chat',t0,'ai.chat');
   assert(!chat.ok && chat.code==='quota_exhausted','chat cannot use the starter bonus');
   assert((await charge(id,37000,'bonus-site',t0,'ai.fix')).ok,'site creation uses the bonus right away');
   assert((await state(id,at(30*24+1),'ai.fix')).bonus.free===0,'bonus expires after 30 days');
  } finally { await db.query(`update settings set value=jsonb_set(value,'{free,tokens}','10000') where key='plans'`); }
 });

 await t('V3 starter bonus: once per customer (account, e-mail and Paddle customer)',async()=>{
  const a=await user('high'), b=await user('high'), c=await user('high');
  assert((await rpc('bid_v13_claim_bonus',{p_user:a,p_email_hash:'d'.repeat(64),p_now:t0})).ok,'first claim');
  assert((await rpc('bid_v13_claim_bonus',{p_user:a,p_email_hash:'e'.repeat(64),p_now:t0})).code==='bonus_used','same account twice');
  assert((await rpc('bid_v13_claim_bonus',{p_user:b,p_email_hash:'d'.repeat(64),p_now:t0})).code==='bonus_used','same e-mail on a new account');
  await db.query("update subscriptions set customer_ref=(select customer_ref from subscriptions where user_id=$2) where user_id=$1",[c,a]);
  assert((await rpc('bid_v13_claim_bonus',{p_user:c,p_email_hash:'f'.repeat(64),p_now:t0})).code==='bonus_used','same payment customer on a new account');
  const lots=(await db.query("select credits,expires_at from credit_grants where user_id=$1 and source='bonus_grant'",[a])).rows;
  assert(lots.length===1 && Number(lots[0].credits)===60000 && Date.parse(lots[0].expires_at)===Date.parse(at(30*24)),'60 000 for 30 days');
  await db.query('delete from auth.users where id=$1',[a]);
  const d=await user('high',{sub:false});
  assert((await rpc('bid_v13_claim_bonus',{p_user:d,p_email_hash:'d'.repeat(64),p_now:t0})).code==='bonus_used','account deletion does not free the e-mail');
 });

 await t('V3 packs: outside the release schedule, under a technical rate limit per hour',async()=>{
  const id=await user('high'); await grant(id,'high'); await pack(id,1000000);
  assert((await charge(id,150000,'pack-at-t0',t0)).ok,'a pack works at t₀ when nothing is released yet');
  const limited=await charge(id,60000,'pack-rate',at(0.5));
  assert(!limited.ok && limited.code==='pack_rate','more than 200 000 pack credits within an hour is refused');
  assert((await charge(id,60000,'pack-later',at(1.01))).ok,'allowed again after the hour');
 });

 await t('V3 readyAt: when N credits will be available (estimate)',async()=>{
  const id=await user('flash'); await grant(id,'flash');
  const r=await rpc('bid_v13_ready_at',{p_user:id,p_need:2000,p_now:t0});
  const after=(Date.parse(r.readyAt)-Date.parse(t0))/H;
  assert(after>0 && after<=17 && r.reason==='release',`2 000 credits after ${after} h`);
  assert((await state(id,r.readyAt)).included.availableNow>=2000,'available at readyAt');
  const none=await rpc('bid_v13_ready_at',{p_user:id,p_need:50000,p_now:t0});
  assert(none.readyAt===null && none.reason==='exhausted' && none.nextPeriodAt,'more than B: next period');
  assert((await rpc('bid_v13_ready_at',{p_user:id,p_need:0,p_now:t0})).reason==='ok','nothing needed');
 });

 await t('V3 upgrade keeps t₀ and uses the new B (no fresh period); downgrade waits and paid lots stay',async()=>{
  const id=await user('flash'); await grant(id,'flash');
  const eff=at(7*24);
  const change=(await db.query("insert into billing_changes(user_id,provider_ref,from_tier,to_tier,status,request,quote,fingerprint,effective_at,expires_at) values($1,$4,'flash','high','applied','{}',$2,'v3-upgrade',$3,$3) returning id",[id,JSON.stringify({periodStart:t0,periodEnd:at(30*24)}),eff,id])).rows[0].id;
  await db.query("update subscriptions set tier='high' where user_id=$1",[id]); await db.query("update profiles set plan='high' where user_id=$1",[id]);
  const g=await rpc('bid_upgrade_grant',{p_user:id,p_change:change,p_now:eff});
  assert(g.ok && g.granted>0,'proportional upgrade lot');
  const s=await state(id,eff);
  assert(Date.parse(s.included.periodStart)===Date.parse(t0),'t₀ unchanged');
  assert(s.included.budget===100000 && s.included.released===50000,`R uses the new B from the old t₀: ${s.included.released}`);
  assert(s.included.left===40000+g.granted,'only the paid difference was added');
  // downgrade to Flash at renewal: the next period's B is Flash; the High lot (3 months) stays as carried
  const k=await user('knight'); await grant(k,'knight');
  await charge(k,100000,'knight-spend',at(15*24));
  await db.query("update subscriptions set tier='flash' where user_id=$1",[k]); await db.query("update profiles set plan='flash' where user_id=$1",[k]);
  await grant(k,'flash',at(30*24),'renewal-flash');
  const after=await state(k,at(30*24+1));
  assert(after.included.budget===40000 && after.carried===700000,`paid Knight lot kept: ${JSON.stringify(after)}`);
  assert((await charge(k,300000,'carried-spend',at(30*24+1))).ok,'carried credits are spendable at once');
 });

 await t('V3 migration: lots from before V3 are fully released; Free gets 10 000 a month with one site',async()=>{
  const id=await user('high');
  await db.query("insert into credit_ledger(user_id,delta,bucket,reason,ref,created_at) values($1,250000,'plan','plan_grant','v1-period',$2)",[id,t0]);
  const s=await rpc('bid_usage_summary',{p_user:id,p_now:t0});
  assert(s.available.now===250000 && s.carried.length===1 && s.carried[0].remaining===250000,'imported balance is spendable at once');
  assert((await charge(id,200000,'migrated-spend',t0)).ok,'no release curve on migrated lots');
  const free=await user('free');
  const f=await rpc('bid_usage_summary',{p_user:free,p_now:at(7*24)});
  assert(f.included.budget===10000 && f.included.released===5000 && f.sites.max===1,`Free: 10 000 released over 14 days, one site ${JSON.stringify(f.included)}`);
  const again=await rpc('bid_usage_summary',{p_user:free,p_now:at(8*24)});
  assert(again.included.budget===10000 && (await db.query("select count(*)::int n from credit_grants where user_id=$1 and source='free_grant'",[free])).rows[0].n===1,'one Free grant per month');
  const next=await rpc('bid_usage_summary',{p_user:free,p_now:at(30*24)});
  assert(Date.parse(next.included.periodStart)===Date.parse('2026-12-02T08:00:00Z') && next.included.released===0,'next month: a new Free period');
 });

 await t('V3 usage contract: included, guards, reason, carried, bonus, packs, cloud minutes, sites; v2 fields still decode',async()=>{
  const id=await user('high'); await grant(id,'high'); await pack(id,100000);
  const u=await rpc('bid_usage_summary',{p_user:id,p_now:at(24)});
  assert(u.v===3,'version');
  for(const k of ['budget','released','spent','held','availableNow','releaseEndsAt']) assert(k in u.included,`included.${k}`);
  for(const k of ['last24h','cap24h','last7d','cap7d']) assert(k in u.guards,`guards.${k}`);
  assert(['ok','release','guard24h','guard7d','exhausted'].includes(u.reason),'reason');
  assert(Array.isArray(u.carried) && 'remaining' in u.bonus && u.packs.length===1 && u.cloudMinutes.included===1000 && u.sites.max===3,'balances and entitlements');
  assert(u.included.tokens===100000 && u.included.released===7142,'v2 included.tokens kept');
  for(const field of ['serverTime','unit','plan','period','used','reserved','remaining','purchased','limits','pricing','history','session','weekly']) assert(field in u,`v2 field ${field}`);
  assert(u.session.windowHours===24 && u.weekly.windowHours===168,'v2 meters describe the guards');
  assert(u.pricing.spendOrder.join()==='bonus,carried,included,packs','spend order published');
 });
}
