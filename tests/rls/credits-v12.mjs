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
  await db.query("update subscriptions set tier='knight' where user_id=$1",[id]);
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
  await db.query("update subscriptions set status='canceled' where user_id=$1",[id]);
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
 await t('V12 trial: one atomic email claim, exact gift expiry, no partial trial after failure',async()=>{
  const id=await user('free'),other=await user('free'),hash='a'.repeat(64);
  const args={p_user:id,p_email_hash:hash,p_tier:'high',p_days:7,p_credits:50000,p_now:now};
  await rejects(()=>rpc('bid_start_trial',{...args,p_credits:-1}),/invalid trial/);
  assert((await db.query('select count(*)::int as n from trial_claims where email_hash=$1',[hash])).rows[0].n===0,'failure did not claim address');
  assert((await rpc('bid_start_trial',args)).ok,'trial starts');
  assert((await rpc('bid_start_trial',{...args,p_user:other})).code==='trial_used','same email cannot claim twice');
  const during=await summary(id);assert(during.included.tokens===50000 && during.session.cap===10000 && during.sites.limit===1,'gift defines trial base');
  const expired=await summary(id,later(7));assert(expired.plan==='free' && expired.remaining.available===0,'gift expires at seven days');
 });
 await t('V12 upgrade: proportional grant once, monthly slice for annual plans, no downgrade grant',async()=>{
  for(const annual of [false,true]) {
   const id=await user('flash');await grant(id,100000,'original','flash');
   const at=later(15,12),end=annual?'2027-10-01T09:00:00Z':later(31);
   const change=(await db.query("insert into billing_changes(user_id,provider_ref,from_tier,to_tier,status,request,quote,fingerprint,effective_at,expires_at) values($1,$2,'flash','high','applied','{}',$3,'reviewed',$4,$4) returning id",[id,id,JSON.stringify({periodStart:now,periodEnd:end}),at])).rows[0].id;
   const first=await rpc('bid_upgrade_grant',{p_user:id,p_change:change,p_now:at});assert(first.granted===100000,'half-month difference, independent of annual payment');
   assert((await rpc('bid_upgrade_grant',{p_user:id,p_change:change,p_now:at})).duplicate,'same provider change once');
   await db.query("update billing_changes set from_tier='high',to_tier='flash' where id=$1",[change]);
   assert((await rpc('bid_upgrade_grant',{p_user:id,p_change:change,p_now:at})).granted===0,'no downgrade gift');
  }
 });
 await t('V12 monitor extras: atomically priced configuration, incremental paths, daily recurrence and Knight benefit',async()=>{
  const id=await user();await grant(id);await db.query("insert into bid_projects(user_id,key,name) values($1,'monitor','Monitor')",[id]);
  const site=await rpc('bid_site_change',{p_user:id,p_project:'monitor',p_active:true,p_now:now});
  const config={p_user:id,p_project:'monitor',p_url:'https://example.test',p_interval:5,p_checks:JSON.stringify({kinds:['down','page'],paths:['/a','/b','/c','/d']}),p_now:now};
  assert((await rpc('bid_monitor_register',config)).charged===550,'fast plus one path');
  config.p_checks=JSON.stringify({kinds:['down','page'],paths:['/a','/b','/c','/d','/e']});
  assert((await rpc('bid_monitor_register',config)).charged===50,'only newly added path');
  assert((await rpc('bid_monitor_register',config)).charged===0,'same-day repeat free');
  await rpc('bid_v12_burn_one',{p_user:id,p_site:site.siteId,p_day:later(1).slice(0,10),p_now:later(1)});
  assert(await balance(id)===296800,'two days base and extras');
  const knight=await user('knight');await grant(knight,1000000,'base','knight');await db.query("insert into bid_projects(user_id,key,name) values($1,'knight','Knight')",[knight]);
  await rpc('bid_site_change',{p_user:knight,p_project:'knight',p_active:true,p_now:now});
  assert((await rpc('bid_monitor_register',{...config,p_user:knight,p_project:'knight',p_checks:JSON.stringify({kinds:['down'],paths:[]})})).charged===0,'Knight fast included');
  await charge(id,296800,"spend-remainder",later(1),false);
  const denied=await rpc('bid_monitor_register',{...config,p_checks:JSON.stringify({kinds:['down'],paths:['/1','/2','/3','/4','/5','/6']})});
  assert(denied.code==='quota_exhausted','cannot enable unpaid extras');
  assert((await db.query('select checks from monitor_targets where user_id=$1',[id])).rows[0].checks.paths.length===5,'old configuration unchanged');
 });
 await t('V12 domain: 7-day monthly wait, annual immediate, one per subscription year, manual review and EUR15 cap',async()=>{
  for(const annual of [false,true]) {
   const id=await user('knight');await grant(id,1000000,'paid','knight');
   if(annual)await db.query("update subscriptions set raw='{\"billing_cycle\":{\"interval\":\"year\"}}',period_end=$2 where user_id=$1",[id,later(365)]);
   const args={p_user:id,p_domain:'example.com',p_now:now};
   if(!annual)assert((await rpc('bid_domain_request',args)).code==='domain_wait','monthly waiting period');
   args.p_now=annual?now:later(7);
   const order=await rpc('bid_domain_request',args);assert(order.ok && order.status==='review' && order.costCapEur===15,'review only, no registration');
   assert((await rpc('bid_domain_request',args)).duplicate,'repeat request same order');
   assert((await rpc('bid_domain_request',{...args,p_domain:'second.com'})).code==='domain_used','one per year');
   await rejects(()=>db.query('update domain_orders set cost_eur=16 where id=$1',[order.orderId]),/check constraint/);
  }
  const free=await user('free');assert((await rpc('bid_domain_request',{p_user:free,p_domain:'example.com',p_now:now})).code==='domain_unavailable','no free domain');
 });
 await t('V12 paid year: unattended accrual, calendar slices, source-scoped refund and no grants after full refund',async()=>{
  const id=await user('high');
  await db.query("update subscriptions set raw='{\"billing_cycle\":{\"interval\":\"year\"}}',period_end=$2 where user_id=$1",[id,later(365)]);
  const pay={p_user:id,p_transaction:'annual-transaction',p_subscription:id,p_tier:'high',p_interval:'year',p_credits:300000,p_start:now,p_end:later(365),p_now:now};
  assert((await rpc('bid_record_payment',pay)).ok,'first month paid');
  assert(await balance(id)===300000,'one slice initially');
  assert((await rpc('bid_record_payment',pay)).duplicate,'repeated transaction');
  await rpc('bid_scheduler_credits',{p_now:'2026-12-02T09:00:00Z'});
  assert(await balance(id)===900000,'three grants while Mac is closed');
  const refund=await rpc('bid_refund',{p_user:id,p_ref:'annual-transaction',p_adjustment:'annual-full-refund',p_share:1,p_now:'2026-12-02T09:00:00Z'});
  assert(refund.taken===900000,'refund includes every slice bought by the original transaction');
  await rpc('bid_accrue_periods',{p_user:id,p_now:'2027-08-01T09:00:00Z'});
  assert(await balance(id)===0,'full refund stops future slices');
  const other=await user('high');await rpc('bid_record_payment',{...pay,p_user:other,p_transaction:'annual-second',p_subscription:other});
  await rpc('bid_accrue_periods',{p_user:other,p_now:'2027-10-15T09:00:00Z'});
  assert((await summary(other,'2027-10-15T09:00:00Z')).remaining.available===600000,'missed paid slices retain their original expiry after subscription end');
 });
 await t('V12 migration: verified annual receipt resumes without duplicating legacy monthly grants and refunds include them',async()=>{
  const id=await user('high'),end='2027-10-01T09:00:00Z';
  await db.query("update subscriptions set period_end=$2,raw='{\"billing_cycle\":{\"interval\":\"year\"}}' where user_id=$1",[id,end]);
  await db.query("insert into credit_ledger(user_id,delta,bucket,reason,ref,created_at) values($1,250000,'plan','plan_grant','legacy-paid',$2),($1,250000,'plan','plan_grant',$3,$4)",[id,now,id+':m1',later(31)]);
  const payload={data:{subscription_id:id,billing_period:{starts_at:now,ends_at:end},origin:'web'}};
  await db.query("insert into billing_events(id,type,user_id,ref,payload) values($1,'transaction.completed',$2,'legacy-paid',$3)",['annual-legacy-'+id,id,JSON.stringify(payload)]);
  await rpc('bid_scheduler_credits',{p_now:'2026-12-02T09:00:00Z'});
  const lots=(await db.query('select ref,credits,payment_ref from credit_grants where user_id=$1',[id])).rows;
  assert(lots.length===3,'initial and November preserved, only December added');
  assert(lots.find(l=>l.ref==='legacy-paid:m2')?.credits===300000,'next grant uses V2 High amount');
  assert(await balance(id)===800000,'historic 250k amounts unchanged');
  await rpc('bid_refund',{p_user:id,p_ref:'legacy-paid',p_adjustment:'legacy-refund',p_share:1,p_now:'2026-12-02T09:00:00Z'});
  assert(await balance(id)===0,'refund revokes legacy and new slices of this payment only');
  await rpc('bid_scheduler_credits',{p_now:'2027-01-02T09:00:00Z'});assert(await balance(id)===0,'no later accrual after refund');
 });
 await t('V12 annual upgrade: future monthly differences stay separate and refund only the upgrade payment',async()=>{
  const id=await user('flash'),end='2027-10-01T09:00:00Z';
  await db.query("update subscriptions set period_end=$2,raw='{\"billing_cycle\":{\"interval\":\"year\"}}' where user_id=$1",[id,end]);
  await rpc('bid_record_payment',{p_user:id,p_transaction:'annual-base-'+id,p_subscription:id,p_tier:'flash',p_interval:'year',p_credits:100000,p_start:now,p_end:end,p_now:now});
  const at=later(15,12);
  const change=(await db.query("insert into billing_changes(user_id,provider_ref,from_tier,to_tier,status,request,quote,fingerprint,effective_at,expires_at) values($1,$2,'flash','high','applied','{}',$3,'annual-upgrade',$4,$4) returning id",[id,id,JSON.stringify({periodStart:now,periodEnd:end,paymentRef:'annual-upgrade-'+id}),at])).rows[0].id;
  await db.query("update subscriptions set tier='high' where user_id=$1",[id]);
  await rpc('bid_upgrade_grant',{p_user:id,p_change:change,p_now:at});
  await rpc('bid_scheduler_credits',{p_now:'2026-11-02T09:00:00Z'});
  const next=(await db.query("select sum(credits)::int as n from credit_grants where user_id=$1 and granted_at='2026-11-01T09:00:00Z'",[id])).rows[0];assert(next.n===300000,'next month receives full High allowance');
  const refunded=await rpc('bid_refund',{p_user:id,p_ref:'annual-upgrade-'+id,p_adjustment:'upgrade-refund',p_share:1,p_now:'2026-11-02T09:00:00Z'});
  assert(refunded.taken===300000,'refund takes proportional current gift and next-month upgrade difference');
  assert(await balance(id)===100000,'original annual payment survives');
  await rpc('bid_scheduler_credits',{p_now:'2026-12-02T09:00:00Z'});
  assert(await balance(id)===200000,'only original paid component accrues after upgrade refund');
 });
 await t('V12 out-of-order refunds: late payment and upgrade linking cannot restore refunded credits',async()=>{
  const id=await user('high');const paid='late-payment-'+id;
  await rpc('bid_refund',{p_user:id,p_ref:paid,p_adjustment:'refund-first',p_share:0.5,p_now:now});
  await rpc('bid_record_payment',{p_user:id,p_transaction:paid,p_subscription:id,p_tier:'high',p_interval:'year',p_credits:300000,p_start:now,p_end:later(365),p_now:now});
  assert(await balance(id)===150000,'late payment grants only the unrefunded share');
  await rpc('bid_refund',{p_user:id,p_ref:paid,p_adjustment:'refund-first',p_share:0.5,p_now:now});
  assert(await balance(id)===150000,'duplicate does not refund a net slice twice');
  await rpc('bid_accrue_periods',{p_user:id,p_now:'2026-11-02T09:00:00Z'});
  await rpc('bid_refund',{p_user:id,p_ref:paid,p_adjustment:'refund-first',p_share:0.5,p_now:'2026-11-02T09:00:00Z'});
  assert(await balance(id)===300000,'future net slice is idempotent');
  await rpc('bid_refund',{p_user:id,p_ref:paid,p_adjustment:'second-partial',p_share:0.2,p_now:'2026-11-02T09:00:00Z'});
  assert(await balance(id)===180000,'later partial adjustment uses each slice’s original paid amount');
  const late='late-upgrade-'+id;
  const change=(await db.query("insert into billing_changes(user_id,provider_ref,from_tier,to_tier,status,request,quote,fingerprint,effective_at,expires_at) values($1,$2,'flash','high','applied','{}',$3,'late-upgrade',$4,$4) returning id",[id,id,JSON.stringify({periodStart:now,periodEnd:later(31)}),later(15,12)])).rows[0].id;
  await rpc('bid_upgrade_grant',{p_user:id,p_change:change,p_now:later(15,12)});
  await rpc('bid_refund',{p_user:id,p_ref:late,p_adjustment:'upgrade-refund-first',p_share:1,p_now:later(15,12)});
  await db.query("update billing_changes set quote=quote||jsonb_build_object('paymentRef',$2::text) where id=$1",[change,late]);
  await rpc('bid_upgrade_grant',{p_user:id,p_change:change,p_now:later(15,12)});
  assert(Number((await db.query("select left_credits from credit_grants where user_id=$1 and source='upgrade_grant'",[id])).rows[0].left_credits)===0,'late-linked gift is refunded');
  const other=await user();const txn='webhook-late-'+other;
  await db.query("insert into billing_events(id,type,user_id,ref,payload) values($1,'transaction.completed',$2,$3,$4)",['paid-'+other,other,txn,JSON.stringify({data:{details:{totals:{total:'1000'}}}})]);
  await db.query("insert into billing_events(id,type,payload) values($1,'adjustment.updated',$2)",['ref-'+other,JSON.stringify({data:{id:'adj-late',transaction_id:txn,action:'refund',status:'approved',totals:{total:'1000'}}})]);
  await rpc('bid_record_payment',{p_user:other,p_transaction:txn,p_subscription:other,p_tier:'high',p_interval:'year',p_credits:300000,p_start:now,p_end:later(365),p_now:now});
  assert(await balance(other)===0,'ownerless approved event is recovered after the payment arrives');
 });
 await t('V12 compatibility receipt: annual calendar slices include only current settled usage and reserve exact headroom',async()=>{
  const id=await user(),start='2026-01-31T10:00:00Z',end='2027-01-31T10:00:00Z',at='2026-03-02T12:00:00Z';
  await db.query("update subscriptions set period_start=$2,period_end=$3,raw='{\"billing_cycle\":{\"interval\":\"year\"}}' where user_id=$1",[id,start,end]);
  await grant(id,300000,'calendar-grant','high',start);
  await charge(id,2000,'prior-month','2026-02-01T10:00:00Z');
  await charge(id,3000,'this-month','2026-03-01T10:00:00Z');
  await rpc('bid_hold',{p_user:id,p_action:'ai.chat',p_credits:30000,p_operation_id:'live-window',p_now:at});
  const u=await summary(id,at);
  assert(Date.parse(u.period.start)===Date.parse('2026-02-28T10:00:00Z') && Date.parse(u.period.end)===Date.parse('2026-03-31T10:00:00Z'),'calendar anchor preserved across February');
  assert(u.used.tokens===3000 && u.reserved.tokens===30000 && u.session.remaining===30000,'settled and reserved are distinct');
  assert(u.remaining.available===265000 && u.remaining.total===295000,'same canonical available balance for both usage decoders');
  for(const field of ['serverTime','unit','plan','period','included','used','reserved','remaining','purchased','limits','pricing','history'])assert(field in u,`legacy required field ${field}`);
 });
 await t('V12 cloud artifacts: require owned receipts, settle once atomically, isolate tenants and cascade on deletion',async()=>{
  const id=await user(),other=await user();await grant(id);
  await db.query("insert into bid_projects(user_id,key,name) values($1,'shop','Shop'),($2,'shop','Other')",[id,other]);
  const args={p_user:id,p_operation_id:'cloud-check',p_project:'shop',p_report:JSON.stringify({source:'client',status:'ready'}),p_now:now};
  assert((await rpc('bid_v12_report',args)).code==='not_found','no receipt cannot save');
  await rpc('bid_hold',{p_user:id,p_action:'check.run',p_credits:50,p_operation_id:'cloud-check',p_now:now});
  assert((await rpc('bid_v12_report',{...args,p_user:other})).code==='not_found','other user cannot settle it');
  assert((await rpc('bid_v12_report',args)).charged===50,'settle and save atomic');
  assert((await rpc('bid_v12_report',args)).duplicate,'same report is idempotent');
  assert(await balance(id)===299950,'single charge');
  assert((await as('authenticated',other,q=>q('select * from cloud_reports'))).rows.length===0,'other tenant cannot read');
  assert((await as('authenticated',id,q=>q('update cloud_reports set report=report'))).affectedRows===0,'client cannot modify');
  await rejects(()=>as('authenticated',id,q=>q("insert into cloud_reports(user_id,operation_id,project_key,action,report) values($1,'forged','shop','check.run','{}')",[id])),/row-level security/);
  await db.query('delete from auth.users where id=$1',[id]);
  for(const table of ['cloud_reports','credit_accounts','credit_grants','credit_holds','credit_allocations','usage_events','usage_windows','usage_daily'])assert((await db.query(`select * from ${table} where user_id=$1`,[id])).rows.length===0,`${table} cascades`);
  assert((await db.query('select * from profiles where user_id=$1',[other])).rows.length===1,'other user preserved');
 });
 await t('V12 security: all new tables enforce tenant reads/service writes, every definer RPC is private',async()=>{
  const id=await user(), other=await user(); await grant(id); await grant(other);
  await charge(id,100,'security-spend');
  await rpc('bid_hold',{p_user:id,p_action:'ai.fix',p_credits:100,p_operation_id:'security-hold',p_now:now});
  await db.query("insert into sites(user_id,project_key) values($1,'secure')",[id]);
  await db.query("insert into usage_nudges(user_id,period_ref,threshold) values($1,'test','75')",[id]);
  await db.query("insert into domain_orders(user_id,domain,year_ref) values($1,'example.test','2026')",[id]);
  await db.query("insert into netlify_allocations(user_id,period_ref) values($1,'test')",[id]);
  await db.query("insert into credit_periods(transaction_ref,user_id,tier,interval,monthly_credits,validity_months,starts_at,ends_at) values('security-paid',$1,'high','year',300000,3,$2,$3)",[id,now,later(365)]);
  await rpc('bid_refund',{p_user:id,p_ref:'security-paid',p_adjustment:'security-refund',p_share:0.1,p_now:now});
  for(const table of ['credit_refunds','credit_periods','credit_accounts','credit_grants','credit_holds','credit_allocations','sites','usage_windows','usage_events','usage_daily','usage_nudges','domain_orders','netlify_allocations']) {
   const mine=await as('authenticated',id,q=>q(`select * from ${table}`)); assert(mine.rows.length>0 && mine.rows.every(r=>r.user_id===id),`${table} own read`);
   assert((await as('anon',null,q=>q(`select * from ${table}`))).rows.length===0,`${table} anon invisible`);
   assert((await as('authenticated',other,q=>q(`select * from ${table} where user_id=$1`,[id]))).rows.length===0,`${table} other tenant invisible`);
   assert((await as('authenticated',id,q=>q(`update ${table} set user_id=user_id`))).affectedRows===0,`${table} no client update`);
   assert((await as('authenticated',id,q=>q(`delete from ${table}`))).affectedRows===0,`${table} no client delete`);
  }
  await rejects(()=>as('authenticated',id,q=>q("insert into credit_grants(user_id,source,bucket,credits,left_credits,granted_at,expires_at,ref) values($1,'topup','topup',999,999,now(),now()+interval '1 year','hack')",[id])),/row-level security/);
  const funcs=(await db.query("select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'bid_v12_%' or p.proname in ('bid_accrue_periods','bid_record_payment','bid_scheduler_credits','bid_monitor_register','bid_start_trial','bid_upgrade_grant','bid_domain_request','bid_credit_status','bid_grant','bid_charge','bid_hold','bid_settle','bid_release','bid_boost','bid_refund','bid_site_change','bid_site_burn','bid_enforce_sites','bid_usage_summary','bid_nudge_ack','bid_reconcile_usage'))")).rows;
  for(const f of funcs) {
   assert(f.prosecdef && f.proconfig.some(s=>s.includes('search_path=public, pg_temp')),`${f.proname} fixed search path`);
   const p=(await db.query("select has_function_privilege('authenticated',$1,'execute') as client,has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('service_role',$1,'execute') as service",[f.oid])).rows[0];
   assert(!p.client && !p.anon && p.service,`${f.proname} service only`);
  }
 });
 await t('B1 downgrade: Knight→Flash renewal keeps prepaid Knight credits; the cap limits only the new grant',async()=>{
  const id=await user('knight'); await grant(id,1000000,'knight-paid','knight');
  await db.query("update profiles set plan='flash' where user_id=$1",[id]);
  await db.query("update subscriptions set tier='flash' where user_id=$1",[id]);
  await grant(id,100000,'flash-renewal','flash',later(31));
  const lots=(await db.query('select ref,left_credits from credit_grants where user_id=$1',[id])).rows;
  assert(Number(lots.find(l=>l.ref==='knight-paid').left_credits)===1000000,'paid Knight lot untouched until its own expiry');
  assert(Number(lots.find(l=>l.ref==='flash-renewal').left_credits)===100000,'new Flash grant counted against Flash lots only');
  assert(await balance(id)===1100000,'no paid credits vanish on downgrade');
  assert((await db.query("select count(*)::int n from credit_ledger where user_id=$1 and reason='grant_cap'",[id])).rows[0].n===0,'no cap trim');
  await grant(id,100000,'flash-renewal-2','flash',later(31));
  assert(await balance(id)===1100000,'second Flash lot above the Flash cap is limited (new grant only)');
  assert(Number((await db.query("select left_credits from credit_grants where user_id=$1 and ref='knight-paid'",[id])).rows[0].left_credits)===1000000,'cap never trims the older paid lot');
 });
 await t('B3 holds: a 20-minute deploy keeps its reservation (TTL = task timeout + 5 min), no overlapping debt',async()=>{
  const id=await user('knight'); await grant(id,10000,'b3-lot','knight');
  const hold=(op,at)=>rpc('bid_hold',{p_user:id,p_action:'deploy.production',p_credits:9000,p_operation_id:op,p_counts_window:false,p_now:at});
  assert((await hold('b3-deploy-a',now)).ok,'first deploy reserves');
  assert((await hold('b3-deploy-b',later(0,16/60))).code==='quota_exhausted','reservation still held at +16 min');
  assert((await rpc('bid_settle',{p_user:id,p_operation_id:'b3-deploy-a',p_credits:9000,p_now:later(0,21/60)})).ok,'settles after 21 min');
  assert(Number((await db.query('select debt from credit_accounts where user_id=$1',[id])).rows[0].debt)===0 && await balance(id)===1000,'no debt');
  assert((await rpc('bid_hold',{p_user:id,p_action:'deploy.preview',p_credits:150,p_operation_id:'b3-orphan',p_counts_window:false,p_now:now})).ok,'preview reserves');
  assert((await summary(id,later(0,24/60))).reserved.tokens===150,'still reserved before 25 min');
  assert((await summary(id,later(0,26/60))).reserved.tokens===0,'orphaned after 25 min');
  const ai=await rpc('bid_hold',{p_user:id,p_action:'ai.fix',p_credits:100,p_operation_id:'b3-ai-hold',p_now:later(1)});
  const exp=(await db.query("select extract(epoch from expires_at-created_at)::int as ttl from credit_holds where user_id=$1 and operation_id='b3-ai-hold'",[id])).rows[0].ttl;
  assert(ai.ok && exp===900,'AI keeps the 15-minute TTL');
 });
}
