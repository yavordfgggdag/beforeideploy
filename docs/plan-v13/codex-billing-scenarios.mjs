import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const schema = fs.readFileSync('../../supabase/schema.sql','utf8');
const db = new PGlite();
await db.exec(`create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;`);
await db.exec(schema);
const now='2026-10-01T09:00:00Z';
const later=(days,hours=0)=>new Date(Date.parse(now)+(days*24+hours)*3600000).toISOString();
const rpc=async(name,args)=>{const k=Object.keys(args);return (await db.query(`select public.${name}(${k.map((x,i)=>`${x}=>$${i+1}`).join(',')}) as r`,Object.values(args))).rows[0].r;};
let n=0;
const user=async(plan)=>{const id=(await db.query("insert into auth.users(email) values($1) returning id",[`u${n++}@x.test`])).rows[0].id;
 await db.query('update profiles set plan=$2,created_at=$3 where user_id=$1',[id,plan,now]);
 if(plan!=='free') await db.query("insert into subscriptions(user_id,provider,provider_ref,tier,status,period_start,period_end) values($1::uuid,'paddle',($1::uuid)::text,$2,'active',$3,$4)",[id,plan,now,later(31)]);
 return id;};
const bal=async id=>Number((await db.query('select coalesce(sum(delta),0) n from credit_ledger where user_id=$1',[id])).rows[0].n);
const lots=async id=>(await db.query('select source,ref,credits,left_credits,bucket from credit_grants where user_id=$1 order by granted_at',[id])).rows;
const g=(id,c,src,ref,tier,at=now)=>rpc('bid_grant',{p_user:id,p_credits:c,p_source:src,p_ref:ref,p_tier:tier,p_granted_at:at,p_now:at});
const out={};
// S1 downgrade Knight->Flash: next Flash grant trims prepaid Knight credits to Flash cap
{const id=await user('knight'); await g(id,1000000,'plan_grant','k-txn-1','knight');
 await db.query("update profiles set plan='flash' where user_id=$1",[id]);
 await g(id,100000,'plan_grant','f-txn-2','flash',later(31));
 out.S1={balanceAfterFlashRenewal:await bal(id),lots:await lots(id)};}
// S2 mixed txn refund: refund only the pack line (4.99 of 34.98) -> share applies to plan+pack
{const id=await user('high'); await g(id,300000,'plan_grant','txnM','high'); await g(id,100000,'topup','txnM:pri_pack','high');
 const r=await rpc('bid_refund',{p_user:id,p_ref:'txnM',p_adjustment:'adj1',p_share:4.99/34.98,p_now:now});
 out.S2={r,lots:await lots(id)};}
// S3 pack-only free user windows
{const id=await user('free'); await g(id,1000000,'topup','pack1',null);
 const a=await rpc('bid_charge',{p_user:id,p_action:'ai.chat',p_credits:20001,p_operation_id:'s3-op-0001',p_now:now});
 const ent=await rpc('bid_v12_entitlement',{p_user:id,p_now:now});
 out.S3={charge20001:a.code,ent};}
// S4 hold TTL shorter than a 20-min deploy -> double reservation, debt
{const id=await user('knight'); await g(id,10000,'plan_grant','s4','knight');
 const h1=await rpc('bid_hold',{p_user:id,p_action:'deploy.production',p_credits:9000,p_operation_id:'s4-op-0001',p_counts_window:false,p_now:now});
 const h2=await rpc('bid_hold',{p_user:id,p_action:'deploy.production',p_credits:9000,p_operation_id:'s4-op-0002',p_counts_window:false,p_now:later(0,16/60)});
 const s1=await rpc('bid_settle',{p_user:id,p_operation_id:'s4-op-0001',p_credits:9000,p_now:later(0,17/60)});
 const s2=await rpc('bid_settle',{p_user:id,p_operation_id:'s4-op-0002',p_credits:9000,p_now:later(0,18/60)});
 out.S4={h1:h1.ok,h2:h2.ok,s1:s1.ok,s2:s2.ok,debt:(await db.query('select debt from credit_accounts where user_id=$1',[id])).rows[0].debt,balance:await bal(id)};}
// S5 payment_refund marker duplicates (no unique index)
{const id=await user('high'); await g(id,300000,'plan_grant','txnD','high');
 for(let i=0;i<3;i++) await rpc('bid_refund',{p_user:id,p_ref:'txnD',p_adjustment:'adjD',p_share:0.5,p_now:now});
 out.S5={markers:(await db.query("select count(*)::int n from credit_ledger where user_id=$1 and reason='payment_refund'",[id])).rows[0].n,left:(await lots(id))[0].left_credits};}
// S6 legacy monitor targets during migration grace on Flash: both charged daily
{const id=await user('flash'); await g(id,100000,'plan_grant','s6','flash');
 for(const k of ['p1','p2']){await db.query("insert into bid_projects(user_id,key,name) values($1,$2,$2)",[id,k]).catch(e=>{throw e});
  await db.query("insert into sites(user_id,project_key,state,activated_at,migration_grace_until) values($1,$2,'active',$3,$4)",[id,k,now,later(14)]);}
 const r=await rpc('bid_site_burn',{p_day:later(1).slice(0,10),p_now:later(1,1)});
 out.S6={burn:r,balance:await bal(id)};}
// S7 cancelled subscriber keeps windows/1 site; site limit uses last tier
console.log(JSON.stringify(out,null,1));
