// Test-only RPC contract adapter. Economic invariants, locking, RLS, FIFO and expiry are proved by
// tests/rls/credits-v12.mjs against real PostgreSQL. This adapter lets HTTP/SSE tests inspect receipts.
import type { Row } from "./db.ts";
import type { FakeDb } from "./fake_supabase.ts";
import catalog from "./plans-catalog.json" with { type: "json" };
import { addMonths } from "./billing-period.ts";

export function fakeCreditRpc(db: FakeDb, fn: string, a: Row): Row | null {
  if(!["bid_v12_payment_refunds","bid_record_payment","bid_accrue_periods","bid_scheduler_credits","bid_site_burn","bid_monitor_register","bid_start_trial","bid_upgrade_grant","bid_grant","bid_refund","bid_credit_status","bid_enforce_sites","bid_hold","bid_settle","bid_release"].includes(fn)) return null;
  const t=db.tables, user=a.p_user, now=new Date(a.p_now ?? db.clock()), iso=now.toISOString();
  const rows=(name:string)=>t[name]??=[];
  const mine=(name:string)=>rows(name).filter(r=>r.user_id===user);
  const settings=Object.fromEntries(rows("settings").map(r=>[r.key,r.value]));
  const profile=mine("profiles")[0] ?? {};
  const ledger=(delta:number,bucket:string,reason:string,ref:string,extra:Row={})=>rows("credit_ledger").push({id:crypto.randomUUID(),user_id:user,delta,bucket,reason,ref,created_at:iso,...extra});
  const balance=(bucket?:string)=>mine("credit_ledger").filter(r=>!bucket||r.bucket===bucket).reduce((n,r)=>n+Number(r.delta??0),0);
  if(fn==="bid_scheduler_credits")return {ok:true,accounts:0};
  if(fn==="bid_site_burn")return {ok:true,processed:rows("sites").filter(s=>s.state==="active").length};
  if(fn==="bid_monitor_register") {
    const site=mine("sites").find(s=>s.project_key===a.p_project&&s.state==="active");
    if(!site)return {ok:false,code:"site_paused"};
    const target={user_id:user,project_key:a.p_project,site_id:site.id,url:a.p_url,enabled:true,interval_min:a.p_interval,checks:a.p_checks,next_run_at:iso,updated_at:iso};
    const old=mine("monitor_targets").find(r=>r.project_key===a.p_project);
    if(old)Object.assign(old,target);else rows("monitor_targets").push({id:crypto.randomUUID(),...target});
    return {ok:true,registered:true,target,charged:0};
  }
  if(!mine("credit_accounts").length) {
    rows("credit_accounts").push({user_id:user});
    for(const bucket of ["plan","topup"]) {
      let rest=Math.max(0,balance(bucket));
      for(const l of mine("credit_ledger").filter(r=>r.bucket===bucket && r.delta>0).reverse()) {
        const left=Math.min(rest,l.delta); rest-=left;
        const sub=mine("subscriptions").find(s=>s.provider==="trial" && (s.id===l.ref || l.reason==="trial_grant"));
        rows("credit_grants").push({id:crypto.randomUUID(),user_id:user,ref:l.ref,source:l.reason,bucket,credits:l.delta,left_credits:left,granted_at:l.created_at??iso,expires_at:l.expires_at??sub?.period_end??addMonths(now,12).toISOString()});
      }
    }
  }
  const refresh=()=>{
    for(const h of mine("credit_holds").filter(h=>h.status==="held" && h.expires_at<=iso)) {
      ledger(h.credits,"hold","hold_release",h.id); h.status="orphaned";
      const u=mine("ai_usage").find(u=>u.id===h.ai_usage_id); if(u) u.status="orphaned";
    }
    for(const l of mine("credit_ledger").filter(l=>l.reason==="hold" && !l.operation_id)) {
      const u=mine("ai_usage").find(u=>u.id===l.ref);
      if(!u || u.status && u.status!=="pending" || +now-Date.parse(u.created_at??l.created_at)>900000) {
        t.credit_ledger=rows("credit_ledger").filter(r=>r!==l); if(u?.status==="pending") u.status="orphaned";
      }
    }
    for(const g of mine("credit_grants").filter(g=>g.expires_at<=iso && g.left_credits>0)) {
      ledger(-g.left_credits,g.bucket,"grant_expiry",g.id); g.left_credits=0;
    }
  };
  const before=mine("credit_holds").filter(h=>h.status==="held").length+mine("credit_ledger").filter(l=>l.reason==="hold"&&!l.operation_id).length;
  if(fn!=="bid_settle") refresh();
  const status=()=>{
    const holds=mine("credit_holds").filter(h=>h.status==="held");
    const legacy=mine("credit_ledger").filter(l=>l.reason==="hold"&&!l.operation_id);
    const reserved=holds.reduce((n,h)=>n+h.credits,0)-legacy.reduce((n,h)=>n+h.delta,0);
    return {ok:true,released:before-holds.length-legacy.length,reservedTokens:reserved,open:holds.length+legacy.length,available:Math.max(0,balance()),balance:balance(),plan:Math.max(0,balance("plan")),topup:Math.max(0,balance("topup")),total:Math.max(0,balance("plan")+balance("topup"))};
  };
  const takeLots=(n:number)=>{
    let rest=n;
    for(const g of mine("credit_grants").filter(g=>g.left_credits>0).sort((x,y)=>x.expires_at.localeCompare(y.expires_at)||x.granted_at.localeCompare(y.granted_at))) {
      const take=Math.min(rest,g.left_credits);g.left_credits-=take;rest-=take;if(!rest)break;
    }
  };
  if(fn==="bid_v12_payment_refunds") return {ok:true}; // Real out-of-order reconciliation is covered against SQL.
  if(fn==="bid_accrue_periods") {
    for(const p of mine("credit_periods").filter(p=>p.refund_share<1)) {
      for(let m=p.granted_through+1;m<(p.interval==="year"?12:1);m++) {
        const at=addMonths(new Date(p.starts_at),m);if(+at>+now)break;
        fakeCreditRpc(db,"bid_grant",{p_user:user,p_credits:Math.round(p.monthly_credits*(1-p.refund_share)),p_source:"plan_grant",p_ref:m?`${p.transaction_ref}:m${m}`:p.transaction_ref,p_tier:p.tier,p_granted_at:at.toISOString(),p_now:iso});p.granted_through=m;
      }
    }
    return {ok:true};
  }
  if(fn==="bid_record_payment") {
    if(rows("credit_periods").some(p=>p.transaction_ref===a.p_transaction))return {ok:true,duplicate:true};
    rows("credit_periods").push({user_id:user,transaction_ref:a.p_transaction,subscription_ref:a.p_subscription,tier:a.p_tier,interval:a.p_interval,monthly_credits:a.p_credits,starts_at:a.p_start,ends_at:a.p_end,granted_through:-1,refund_share:0});
    fakeCreditRpc(db,"bid_accrue_periods",a);return {ok:true};
  }
  if(fn==="bid_start_trial") {
    if(rows("trial_claims").some(r=>r.email_hash===a.p_email_hash)||mine("subscriptions").some(s=>["trial","paddle"].includes(s.provider)))return {ok:false,code:"trial_used"};
    rows("trial_claims").push({email_hash:a.p_email_hash,claimed_at:iso});
    const id=crypto.randomUUID(),end=new Date(+now+a.p_days*86400000).toISOString();
    rows("subscriptions").push({id,user_id:user,provider:"trial",tier:a.p_tier,status:"trial",period_start:iso,period_end:end,updated_at:iso});profile.plan=a.p_tier;
    fakeCreditRpc(db,"bid_grant",{...a,p_source:"trial_grant",p_ref:id,p_granted_at:iso,p_expires_at:end});
    return {ok:true,subscriptionId:id};
  }
  if(fn==="bid_upgrade_grant") {
    const c=mine("billing_changes").find(c=>c.id===a.p_change&&c.status==="applied");
    if(!c||Date.parse(c.effective_at)>+now)return {ok:true,granted:0};
    const credits=(tier:string)=>settings.plans?.[tier]?.tokens??(catalog.plans as Row)[tier]?.credits??0;
    const fraction=Math.min(1,Math.max(0,(Date.parse(c.quote.periodEnd)-Date.parse(c.effective_at))/(Date.parse(c.quote.periodEnd)-Date.parse(c.quote.periodStart))));
    const n=Math.round((credits(c.to_tier)-credits(c.from_tier))*fraction);
    if(!(n>0))return {ok:true,granted:0};
    return fakeCreditRpc(db,"bid_grant",{...a,p_credits:n,p_source:"upgrade_grant",p_ref:`${c.provider_ref}:upg:${c.id}`,p_tier:c.to_tier,p_granted_at:c.effective_at});
  }
  if(fn==="bid_credit_status") return status();
  if(fn==="bid_enforce_sites") return {ok:true,paused:0};
  if(fn==="bid_grant") {
    if(mine("credit_ledger").some(l=>l.reason===a.p_source && l.ref===a.p_ref)) return {ok:true,duplicate:true};
    const at=new Date(a.p_granted_at??iso);
    const months=a.p_source==="topup"||a.p_source==="admin_grant"?12:(catalog.plans as Row)[a.p_tier]?.validityMonths??1;
    const bucket=a.p_source==="topup"||a.p_source==="admin_grant"?"topup":"plan";
    const expires=a.p_expires_at??addMonths(at,months).toISOString();
    rows("credit_grants").push({id:crypto.randomUUID(),user_id:user,ref:a.p_ref,source:a.p_source,bucket,credits:a.p_credits,left_credits:a.p_credits,granted_at:at.toISOString(),expires_at:expires});
    ledger(a.p_credits,bucket,a.p_source,a.p_ref,{expires_at:expires,created_at:at.toISOString()});refresh();
    return {ok:true,granted:a.p_credits,expiresAt:expires};
  }
  if(fn==="bid_refund") {
    if(mine("credit_ledger").some(l=>l.reason==="payment_refund"&&l.ref===a.p_adjustment))return {ok:true,taken:0,duplicate:true};
    ledger(0,"plan","payment_refund",a.p_adjustment);
    let taken=0;
    for(const g of mine("credit_grants").filter(g=>g.ref===a.p_ref||String(g.ref).startsWith(`${a.p_ref}:`))) {
      const ref=`${a.p_adjustment}:${g.id}`;if(mine("credit_ledger").some(l=>l.reason==="grant_refund"&&l.ref===ref))continue;
      const n=Math.min(g.left_credits,Math.round(g.credits*a.p_share));g.left_credits-=n;taken+=n;ledger(-n,g.bucket,"grant_refund",ref);
    }
    const period=mine("credit_periods").find(p=>p.transaction_ref===a.p_ref);if(period)period.refund_share=Math.min(1,period.refund_share+a.p_share);
    return {ok:true,taken};
  }
  const prior=mine("usage_events").find(e=>e.operation_id===a.p_operation_id);
  const hold=mine("credit_holds").find(h=>h.operation_id===a.p_operation_id);
  if(fn==="bid_hold") {
    if(prior) return {ok:true,duplicate:true,settled:true,charged:prior.credits};
    if(hold) return {ok:hold.status==="held",duplicate:true,holdId:hold.id};
    if(balance()<a.p_credits) return {ok:false,code:"quota_exhausted",balance:balance()};
    const sub=mine("subscriptions").find(s=>s.provider==="trial"&&s.status==="trial"&&Date.parse(s.period_end)>+now);
    const plan=profile.plan==="free"?"flash":profile.plan;
    const monthly=sub?settings["billing.catalog"]?.trial?.tokens??catalog.trial.tokens:settings.plans?.[plan]?.tokens??(catalog.plans as Row)[plan]?.credits??100000;
    const hours=Number(settings["ai.sessionHours"]??5), cap=monthly*Number(settings["ai.sessionCapPercent"]??20)/100;
    const recent=mine("ai_usage").filter(u=>Date.parse(u.created_at)>=+now-hours*3600000);
    const used=recent.reduce((n,u)=>n+Number(u.charged_tokens??0),0);
    const reserved=mine("credit_holds").filter(h=>h.status==="held").reduce((n,h)=>n+h.credits,0);
    if(a.p_counts_window!==false && used+reserved+a.p_credits>cap) return {ok:false,code:"window_5h",legacyCode:"session_cap",windowHours:5,cap,spent:used,resetsAt:new Date(Date.parse(recent[0]?.created_at??iso)+hours*3600000).toISOString()};
    const h={id:crypto.randomUUID(),user_id:user,operation_id:a.p_operation_id,credits:a.p_credits,action:a.p_action,ai_usage_id:a.p_ai_usage,pricing_version:a.p_pricing_version,status:"held",created_at:iso,expires_at:new Date(+now+900000).toISOString()};
    rows("credit_holds").push(h);ledger(-a.p_credits,"hold","hold",h.id,{operation_id:a.p_operation_id});
    return {ok:true,holdId:h.id,reserved:a.p_credits};
  }
  if(fn==="bid_release") {
    if(hold?.status==="held") {ledger(hold.credits,"hold","hold_release",hold.id);hold.status="released";}
    return {ok:true};
  }
  if(fn==="bid_settle") {
    if(prior) return {ok:true,duplicate:true,charged:prior.credits,balance:balance()};
    if(!hold||!["held","orphaned"].includes(hold.status))return {ok:false,code:"operation_released"};
    if(hold.status==="held") ledger(hold.credits,"hold","hold_release",hold.id);
    hold.status="settled";const n=a.p_credits, plan=Math.min(n,Math.max(0,balance("plan")));
    if(plan)ledger(-plan,"plan","action",a.p_operation_id,{operation_id:a.p_operation_id,pricing_version:hold.pricing_version});
    if(n>plan)ledger(-(n-plan),"topup","action",a.p_operation_id,{operation_id:a.p_operation_id,pricing_version:hold.pricing_version});
    takeLots(n);
    rows("usage_events").push({id:crypto.randomUUID(),user_id:user,operation_id:a.p_operation_id,credits:n,action:hold.action,ai_usage_id:hold.ai_usage_id,created_at:iso});
    const u=mine("ai_usage").find(u=>u.id===hold.ai_usage_id);
    if(u&&a.p_ai)Object.assign(u,{charged_tokens:n,status:a.p_ai.status,model:a.p_ai.model,input_tokens:a.p_ai.input,output_tokens:a.p_ai.output,cost_usd:a.p_ai.costUsd});
    return {ok:true,charged:n,balance:balance()};
  }
  return null;
}
