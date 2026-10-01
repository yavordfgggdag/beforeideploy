// Behavioral tests against the actual SQL implementation, not an in-memory copy of the billing rules.
export async function testCredits({db,t,assert,rejects,as}) {
 const now='2026-10-01T09:00:00Z';
 const later=(days,hours=0)=>new Date(Date.parse(now)+(days*24+hours)*3600000).toISOString();
 const rpc=async(name,args)=>{
  const keys=Object.keys(args);
  const r=await as('service_role',null,q=>q(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as result`,Object.values(args)));
  return r.rows[0].result;
 };
 const user=async(plan='high')=>{
  const id=(await db.query("insert into auth.users(email) values('credits@example.test') returning id")).rows[0].id;
  await db.query('update profiles set plan=$2,created_at=$3 where user_id=$1',[id,plan,now]);
  if(plan!=='free') await db.query("insert into subscriptions(user_id,provider,provider_ref,tier,status,period_start,period_end) values($1::uuid,'paddle',($1::uuid)::text,$2,'active',$3,$4)",[id,plan,now,later(31)]);
  return id;
 };
 const grant=(id,n=300000,ref='purchase-1',tier='high',at=now,expires=null)=>rpc('bid_grant',{p_user:id,p_credits:n,p_source:'plan_grant',p_ref:ref,p_tier:tier,p_granted_at:at,p_expires_at:expires,p_now:at});
 const charge=(id,n,op,at=now,window=true)=>rpc('bid_charge',{p_user:id,p_action:'ai.chat',p_credits:n,p_operation_id:op,p_counts_window:window,p_now:at});
 const summary=(id,at=now)=>rpc('bid_usage_summary',{p_user:id,p_now:at});
 const balance=async id=>Number((await db.query('select coalesce(sum(delta),0) as n from credit_ledger where user_id=$1',[id])).rows[0].n);
 await t('V12 grants: idempotency, FIFO expiry, accumulation cap and original-price preservation',async()=>{
  const id=await user();
  await grant(id,300000,'old','high',now,later(2));
  const dup=await grant(id,300000,'old','high'); assert(dup.duplicate,'grant duplicate');
  await grant(id,300000,'new','high',later(1));
  assert((await charge(id,50000,'fifo-spend',later(1))).ok,'spend');
  const lots=(await db.query('select ref,left_credits from credit_grants where user_id=$1 order by granted_at',[id])).rows;
  assert(Number(lots[0].left_credits)===250000 && Number(lots[1].left_credits)===300000,'oldest expiry consumed first');
  assert((await summary(id,later(3))).remaining.available===300000,'only unspent expired lot expires');
  await grant(id,300000,'three','high',later(3)); await grant(id,300000,'four','high',later(3)); await grant(id,300000,'five','high',later(3));
  assert(await balance(id)===900000,'High cap 3 monthly grants');
  assert((await rpc('bid_reconcile_usage',{})).drift.length===0,'ledger reconciles');
 });
 await t('V12 holds: atomic limits, pinned expiry, release, settlement and retry never double-charge',async()=>{
  const id=await user(); await grant(id,300000,'held-lot','high',now,later(0,0.1));
  const hold={p_user:id,p_action:'ai.fix',p_credits:40000,p_operation_id:'reserve-one',p_now:now};
  assert((await rpc('bid_hold',hold)).ok,'reserve');
  assert((await rpc('bid_hold',{...hold,p_operation_id:'reserve-two'})).code==='window_5h','other reservation consumes window');
  assert((await rpc('bid_hold',hold)).duplicate,'retry shares reservation');
  assert((await summary(id,later(0,0.11))).remaining.total===40000,'hold pins expiring credits');
  const settle=await rpc('bid_settle',{p_user:id,p_operation_id:'reserve-one',p_credits:10000,p_now:later(0,0.12)});
  assert(settle.ok && settle.balance===0,'real charge and unspent expiry');
  const retry=await rpc('bid_settle',{p_user:id,p_operation_id:'reserve-one',p_credits:10000,p_now:later(0,0.12)});
  assert(retry.duplicate && retry.charged===10000,'settle idempotent');
  assert((await summary(id,later(0,0.13))).used.tokens===10000,'single event');
  const id2=await user(); await grant(id2,300000);
  await rpc('bid_hold',{...hold,p_user:id2});
  assert((await rpc('bid_release',{p_user:id2,p_operation_id:'reserve-one',p_now:now})).released,'release');
  assert(await balance(id2)===300000,'full reserve returned');
  assert((await rpc('bid_settle',{p_user:id2,p_operation_id:'reserve-one',p_credits:1,p_now:now})).code==='operation_released','released work cannot settle');
  await rpc('bid_hold',{...hold,p_user:id2,p_operation_id:'orphan-test'});
  assert((await summary(id2,later(0,0.3))).reserved.tokens===0 && await balance(id2)===300000,'orphan released after TTL');
 });
 await t('V12 windows: 5h reset, anchored week, packs cannot bypass, upgrade and Boost',async()=>{
  const id=await user('flash'); await grant(id,100000,'monthly','flash');
  assert((await charge(id,20001,'too-large')).code==='window_5h','deny above cap');
  assert((await summary(id)).session.resetsAt===null,'denied operation does not start session');
  assert((await charge(id,20000,'first-pass')).ok,'cap exact');
  await rpc('bid_grant',{p_user:id,p_credits:1000000,p_source:'topup',p_ref:'pack',p_now:now,p_granted_at:now});
  assert((await charge(id,1,'pack-cannot-bypass')).code==='window_5h','packs keep window');
  assert((await charge(id,20000,'next-session',later(0,5))).ok,'whole session resets');
  assert((await charge(id,1,'week-denied',later(0,10))).code==='window_week','week cap');
  const s=await summary(id,later(1)); assert(Date.parse(s.weekly.resetsAt)===Date.parse(later(7)),'week anchored at subscription');
  await db.query("update profiles set plan='knight' where user_id=$1",[id]);
  assert((await summary(id,later(1))).session.cap===200000,'upgrade applies immediately');
  const boosted=await rpc('bid_boost',{p_user:id,p_now:later(1)});
  assert(boosted.ok && boosted.windows.session.cap===300000 && boosted.windows.week.cap===600000,'boost both caps');
  assert((await rpc('bid_boost',{p_user:id,p_now:later(1)})).code==='boost_used','once a week');
  assert((await summary(id,later(2,1))).session.cap===200000,'boost expires');
  assert((await rpc('bid_boost',{p_user:id,p_now:later(7)})).ok,'next subscription week');
 });
 await t('V12 settlement: underestimated started work becomes debt, next pack repays it exactly',async()=>{
  const id=await user(); await grant(id,1000);
  await rpc('bid_hold',{p_user:id,p_action:'ai.chat',p_credits:800,p_operation_id:'underestimated',p_now:now});
  const r=await rpc('bid_settle',{p_user:id,p_operation_id:'underestimated',p_credits:1300,p_now:now});
  assert(r.ok && r.balance===-300,'all actual work billed');
  assert((await summary(id)).period.debt===300,'debt visible');
  await rpc('bid_grant',{p_user:id,p_credits:500,p_source:'topup',p_ref:'recovery',p_now:now,p_granted_at:now});
  const s=await summary(id); assert(s.period.debt===0 && s.remaining.available===200 && s.remaining.purchased===200,'no extra charge during repayment');
  assert((await rpc('bid_reconcile_usage',{})).drift.length===0,'events equal ledger charges');
 });
 await t('V12 refunds: only the original lot remainder, unique adjustment, no later purchase clawback',async()=>{
  const id=await user(); await grant(id,10000,'txn-old'); await charge(id,9000,'spend-original'); await grant(id,300000,'txn-new');
  const args={p_user:id,p_ref:'txn-old',p_adjustment:'adj-1',p_share:1,p_now:now};
  assert((await rpc('bid_refund',args)).taken===1000,'only original unspent 1000');
  assert((await rpc('bid_refund',args)).taken===0,'refund duplicate');
  assert(await balance(id)===300000,'new payment intact');
 });
 await t('V12 sites: server limits, daily idempotency, pause preserves site and cancellation retains one',async()=>{
  const id=await user('high'); await grant(id);
  for(const key of ['one','two','three','four']) await db.query('insert into bid_projects(user_id,key,name) values($1,$2,$2)',[id,key]);
  for(const key of ['one','two','three']) assert((await rpc('bid_site_change',{p_user:id,p_project:key,p_active:true,p_now:now})).ok,'activate');
  assert((await rpc('bid_site_change',{p_user:id,p_project:'four',p_active:true,p_now:now})).code==='site_limit','fourth requires Knight');
  assert(await balance(id)===297000,'one daily charge each');
  await rpc('bid_site_change',{p_user:id,p_project:'one',p_active:false,p_now:now});
  await rpc('bid_site_change',{p_user:id,p_project:'one',p_active:true,p_now:now});
  assert(await balance(id)===297000,'reactivation same UTC day free');
  await db.query("update profiles set plan='free' where user_id=$1",[id]);
  const s=await summary(id); assert(s.sites.active===1 && s.sites.paused===2 && s.sites.items.length===3,'residual mode one site, never delete');
  const free=await user('free'); await rpc('bid_grant',{p_user:free,p_credits:100000,p_source:'topup',p_ref:'freepack',p_now:now,p_granted_at:now});
  await db.query("insert into bid_projects(user_id,key,name) values($1,'free','Free')",[free]);
  assert((await rpc('bid_site_change',{p_user:free,p_project:'free',p_active:true,p_now:now})).code==='site_limit','free packs provide no site slots');
  assert((await charge(free,100,'free-pack-ai')).ok,'free packs retain metered AI access');
 });
 await t('V12 sites: 3-day bounded hosting debt, pause without deletion and free rollback',async()=>{
  const id=await user('flash'); await grant(id,1000,'start','flash');
  await db.query("insert into bid_projects(user_id,key,name) values($1,'debt','Debt')",[id]);
  const active=await rpc('bid_site_change',{p_user:id,p_project:'debt',p_active:true,p_now:now});
  for(let d=1;d<=3;d++) await rpc('bid_v12_burn_one',{p_user:id,p_site:active.siteId,p_day:later(d).slice(0,10),p_now:later(d)});
  assert((await summary(id,later(3))).period.debt===3000,'three days debt cap');
  await rpc('bid_enforce_sites',{p_user:id,p_now:later(4)});
  const s=await summary(id,later(4)); assert(s.sites.active===0 && s.sites.items[0].pausedReason==='no_credits','pause after grace');
  assert((await rpc('bid_charge',{p_user:id,p_action:'deploy.rollback',p_credits:0,p_operation_id:'safety-rollback',p_site:active.siteId,p_counts_window:false,p_now:later(4)})).ok,'rollback allowed with debt and paused site');
 });
 await t('V12 migration: old ledger remains intact, FIFO imports balances, site grace prevents forced pause',async()=>{
  const id=await user('high');
  await db.query("insert into credit_ledger(user_id,delta,bucket,reason,ref,created_at,pricing_version) values($1,250000,'plan','plan_grant','v1-period',$2,'v1'),($1,-10000,'plan','ai_fix','old-op',$2,'v1')",[id,now]);
  const s=await summary(id); assert(s.remaining.available===240000 && s.included.tokens===250000,'existing High gift preserved until renewal');
  assert((await db.query("select count(*)::int as n from credit_ledger where user_id=$1 and pricing_version='v1'",[id])).rows[0].n===2,'no old entry rewritten');
  for(let i=0;i<4;i++) await db.query("insert into sites(user_id,project_key,state,activated_at,migration_grace_until) values($1,$2,'active',$3,$4)",[id,`legacy-${i}`,now,later(14)]);
  assert((await summary(id)).sites.active===4,'14 day grace');
  assert((await summary(id,later(14))).sites.active===3,'enforcement after grace');
 });
 await t('V12 totals and nudges: all 1200 events counted, threshold acknowledged once',async()=>{
  const id=await user('flash'); await grant(id,100000,'base','flash');
  // 1200 independent operations: more than PostgREST max-rows. Actual SQL paths populate all aggregates.
  await db.query("select bid_charge($1,'check.run',65,'bulk-op-'||n,null,false,'2026-10',$2) from generate_series(1,1200) n",[id,now]);
  const s=await summary(id); assert(s.used.tokens===78000 && s.used.operations===1200 && s.byAction[0].credits===78000 && s.daily.reduce((n,d)=>n+d.credits,0)===78000,'no 1000-row truncation');
  assert(s.nudge.threshold===75 && s.nudge.kind==='upgrade','75 percent upgrade');
  await rpc('bid_nudge_ack',{p_user:id,p_period:s.nudge.periodRef,p_threshold:'75',p_now:now});
  assert((await summary(id)).nudge===null,'once per threshold');
  await charge(id,12000,'ninety-percent',now,false); assert((await summary(id)).nudge.threshold===90,'90 escalation');
  await charge(id,10000,'all-used-up',now,false); assert((await summary(id)).nudge.threshold===100,'100 stop');
 });
 await t('V12 rolling deploy: late V1 settlement imports once, old holds and both windows remain accurate',async()=>{
  const id=await user('high');
  await db.query("insert into credit_ledger(user_id,delta,bucket,reason,ref,created_at) values($1,300000,'plan','plan_grant','legacy-grant',$2)",[id,now]);
  const u=(await db.query("insert into ai_usage(user_id,status,charged_tokens,created_at) values($1,'pending',0,$2) returning id",[id,now])).rows[0].id;
  await db.query("insert into credit_ledger(user_id,delta,bucket,reason,ref,created_at) values($1,-5000,'hold','hold',$2,$3)",[id,u,now]);
  const before=await summary(id);assert(before.reserved.tokens===5000 && before.remaining.available===295000,'old request still reserved');
  await db.query("delete from credit_ledger where user_id=$1 and reason='hold'",[id]);
  await db.query("update ai_usage set status='ok',charged_tokens=1234 where id=$1",[u]);
  await db.query("insert into credit_ledger(user_id,delta,bucket,reason,ref,created_at) values($1,-1234,'plan','ai_fix',$2,$3)",[id,u,now]);
  const after=await summary(id);assert(after.remaining.available===298766 && after.remaining.plan===298766,'late debit consumed imported lot');
  assert(after.used.tokens===1234 && after.session.used===1234 && after.weekly.used===1234,'late usage in both windows');
  assert((await summary(id)).used.tokens===1234,'repeated read does not reimport');
  assert((await rpc('bid_reconcile_usage',{})).drift.length===0,'legacy debit and receipt agree');
 });
 await t('V12 orphan settlement, calendar anchor on renewal and a Boost crossing a week boundary',async()=>{
  const id=await user('knight');await grant(id,1000000,'base','knight');
  await rpc('bid_hold',{p_user:id,p_action:'ai.chat',p_credits:1000,p_operation_id:'late-provider',p_now:now});
  await summary(id,later(0,1));
  assert((await rpc('bid_settle',{p_user:id,p_operation_id:'late-provider',p_credits:800,p_now:later(0,1)})).ok,'late result after TTL is billed once');
  assert(await balance(id)===999200,'TTL release not returned twice');
  await db.query("update subscriptions set period_start=$2,period_end=$3 where user_id=$1",[id,later(31),later(61)]);
  assert(Date.parse((await summary(id,later(32))).weekly.resetsAt)===Date.parse(later(35)),'renewal preserves original week anchor');
  const crossing=await user('knight'); await grant(crossing,1000000,'base','knight');
  await rpc('bid_boost',{p_user:crossing,p_now:later(6,20)});
  assert((await summary(crossing,later(7,1))).weekly.cap===600000,'Boost lasts full 24h across week boundary');
  assert((await summary(crossing,later(7,21))).weekly.cap===400000,'Boost ends on time');
 });
 await t('V12 economics: actual 30-day action profile fits each plan and multi-month validity',async()=>{
  // Runs the actual charge paths every day, including both windows, at normal distributed usage.
  const profile={site:30000,production:5000,preview:3000,check:3000,audit:1600,ai:57400};
  assert(Object.values(profile).reduce((a,b)=>a+b,0)===100000,'one standard site-month');
  for(const [tier,credits,sites,months] of [['flash',100000,1,1],['high',300000,3,1],['high',300000,1,3],['knight',1000000,10,1],['knight',1000000,1,10]]) {
   const id=await user(tier); await grant(id,credits,'one-payment',tier);
   for(let m=0;m<months;m++) for(let d=0;d<30;d++) {
    // Real calendar months, with 30 profile days spread within each month (including February).
    const start=new Date(Date.UTC(2026,9+m,1,9)); const end=new Date(Date.UTC(2026,10+m,1,9));
    const at=new Date(+start+(+end-+start)*d/30).toISOString();
    for(const [action,n] of [['site.day',1000],['deploy.production',d<10?500:0],['deploy.preview',d<20?150:0],['check.run',100],['audit.full',d%7===0 && d<28?400:0],['ai.chat',d===29?2300:1900]]) {
     if(!n) continue;
     const r=await rpc('bid_charge',{p_user:id,p_action:action,p_credits:n*sites,p_operation_id:`${m}-${d}-${action}`,p_counts_window:action!=='site.day',p_now:at});
     assert(r.ok,`${tier} ${sites}×${months}, ${m}/${d} ${action}: ${JSON.stringify(r)}`);
    }
   }
   assert(await balance(id)===0,`${tier} ${sites}×${months} exact total`);
  }
 });
 await t('V12 security: all new tables enforce tenant reads/service writes, every definer RPC is private',async()=>{
  const id=await user(), other=await user(); await grant(id); await grant(other);
  await charge(id,100,'security-spend');
  await rpc('bid_hold',{p_user:id,p_action:'ai.fix',p_credits:100,p_operation_id:'security-hold',p_now:now});
  await db.query("insert into sites(user_id,project_key) values($1,'secure')",[id]);
  await db.query("insert into usage_nudges(user_id,period_ref,threshold) values($1,'test','75')",[id]);
  await db.query("insert into domain_orders(user_id,domain,year_ref) values($1,'example.test','2026')",[id]);
  await db.query("insert into netlify_allocations(user_id,period_ref) values($1,'test')",[id]);
  for(const table of ['credit_accounts','credit_grants','credit_holds','credit_allocations','sites','usage_windows','usage_events','usage_daily','usage_nudges','domain_orders','netlify_allocations']) {
   const mine=await as('authenticated',id,q=>q(`select * from ${table}`)); assert(mine.rows.length>0 && mine.rows.every(r=>r.user_id===id),`${table} own read`);
   assert((await as('anon',null,q=>q(`select * from ${table}`))).rows.length===0,`${table} anon invisible`);
   assert((await as('authenticated',other,q=>q(`select * from ${table} where user_id=$1`,[id]))).rows.length===0,`${table} other tenant invisible`);
   assert((await as('authenticated',id,q=>q(`update ${table} set user_id=user_id`))).affectedRows===0,`${table} no client update`);
   assert((await as('authenticated',id,q=>q(`delete from ${table}`))).affectedRows===0,`${table} no client delete`);
  }
  await rejects(()=>as('authenticated',id,q=>q("insert into credit_grants(user_id,source,bucket,credits,left_credits,granted_at,expires_at,ref) values($1,'topup','topup',999,999,now(),now()+interval '1 year','hack')",[id])),/row-level security/);
  const funcs=(await db.query("select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'bid_v12_%' or p.proname in ('bid_credit_status','bid_grant','bid_charge','bid_hold','bid_settle','bid_release','bid_boost','bid_refund','bid_site_change','bid_site_burn','bid_enforce_sites','bid_usage_summary','bid_nudge_ack','bid_reconcile_usage'))")).rows;
  for(const f of funcs) {
   assert(f.prosecdef && f.proconfig.some(s=>s.includes('search_path=public, pg_temp')),`${f.proname} fixed search path`);
   const p=(await db.query("select has_function_privilege('authenticated',$1,'execute') as client,has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('service_role',$1,'execute') as service",[f.oid])).rows[0];
   assert(!p.client && !p.anon && p.service,`${f.proname} service only`);
  }
 });
}
