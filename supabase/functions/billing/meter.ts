import actions from "../_shared/pricing-actions.json" with {type:"json"};
import {type DbClient,type Row,json,must} from "../_shared/db.ts";
import {creditRpc,expireDue,pricingVersion} from "../_shared/credits.ts";
import {rateLimited} from "../_shared/ratelimit.ts";

export const METER_ACTIONS=["sites","site_activate","site_pause","estimate","meter","boost","nudge_ack","domain_request"];
const billable=["check.run","audit.full","deploy.preview","deploy.production","deploy.rollback","backup.snapshot"];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const result=(r:Row)=>json(r.ok===false ? r.code==="invalid_domain"?400:r.code==="quota_exhausted"?402:["operation_conflict","operation_released","boost_used","boost_unavailable","hosting_not_ready","domain_used"].includes(r.code)?409:403 : 200,r);

/** The client never chooses the price, window flag or settlement amount. */
export async function meterAction(db:DbClient,user:string,body:Row,now:Date):Promise<Response> {
 const limited=await rateLimited(db,user,`billing.${body.action}`);if(limited)return limited;
 await expireDue(db,user,now);
 const base={p_user:user,p_now:now.toISOString()};
 if(body.action==="sites") return json(200,(await creditRpc(db,"bid_usage_summary",base)).sites);
 if(body.action==="site_activate"||body.action==="site_pause") {
  if(typeof body.projectKey!=="string"||!body.projectKey.trim())return json(400,{error:"projectKey required"});
  return result(await creditRpc(db,"bid_site_change",{...base,p_project:body.projectKey,p_active:body.action==="site_activate",p_hosting:body.hostingOwner==="bid"?"bid":"user"}));
 }
 if(body.action==="boost") return result(await creditRpc(db,"bid_boost",base));
 if(body.action==="nudge_ack") {
  if(typeof body.periodRef!=="string"||!["75","90","100","w5h80","w5h100","week80","week100","site_limit"].includes(String(body.threshold)))return json(400,{error:"periodRef and threshold required"});
  return result(await creditRpc(db,"bid_nudge_ack",{...base,p_period:body.periodRef,p_threshold:String(body.threshold)}));
 }
 if(body.siteId!=null && (typeof body.siteId!=="string"||!uuid.test(body.siteId)))return json(400,{error:"invalid siteId"});
 if(body.action==="domain_request") {
  if(typeof body.domain!=="string")return json(400,{error:"domain required"});
  return result(await creditRpc(db,"bid_domain_request",{...base,p_domain:body.domain.trim().toLowerCase(),p_site:body.siteId??null}));
 }
 const {data:settingsRows}=must(await db.from("settings").select("key,value"));
 const settings=Object.fromEntries((settingsRows??[]).map(r=>[r.key,r.value]));
 const prices={...actions,...settings["pricing.actions"]} as Row;
 if(body.action==="estimate") {
  // V3 readiness (docs/PLAN-UNIFIED-BG.md §9.9): `credits` asks when N credits can start ({readyAt, reason});
  // with an AI action (ai.fix …) the starter bonus counts only where it applies.
  if(body.credits!=null) {
   if(!Number.isSafeInteger(body.credits)||body.credits<0||body.credits>1000000000)return json(400,{error:"credits must be a whole number"});
   if(body.usageAction!=null&&![...billable,"ai.fix","ai.fix.deep","ai.chat"].includes(body.usageAction))return json(400,{error:"unknown metered action"});
   return json(200,await creditRpc(db,"bid_v13_ready_at",{...base,p_need:body.credits,p_action:body.usageAction??null}));
  }
  if(![...billable,"site.day","monitor.fast","monitor.path"].includes(body.usageAction))return json(400,{error:"unknown metered action"});
  const price=prices[body.usageAction];
  if(!Number.isSafeInteger(price?.credits)||price.credits<0||price.credits>1000000000||typeof price.window!=="boolean")return json(503,{error:"Action pricing is unavailable",code:"meter_unavailable"});
  const ready=price.credits>0?await creditRpc(db,"bid_v13_ready_at",{...base,p_need:price.credits,p_action:body.usageAction}):{readyAt:now.toISOString(),reason:"ok"};
  return json(200,{action:body.usageAction,credits:price.credits,countsInWindow:price.window,pricingVersion:await pricingVersion(settings),readyAt:ready.readyAt??null,reason:ready.reason??null});
 }
 if(typeof body.operationId!=="string"||!/^[A-Za-z0-9_:-]{8,200}$/.test(body.operationId))return json(400,{error:"operationId required"});
 const kind=body.kind??"charge";
 if(!["charge","reserve","settle","release"].includes(kind))return json(400,{error:"invalid metering operation"});
 if(kind==="settle"||kind==="release") {
  const {data:hold}=must(await db.from("credit_holds").select("*").eq("user_id",user).eq("operation_id",body.operationId).maybeSingle());
  if(!hold || !billable.includes(hold.action))return json(404,{error:"reservation not found",code:"not_found"});
  if(kind==="release")return result(await creditRpc(db,"bid_release",{...base,p_operation_id:body.operationId}));
  return result(await creditRpc(db,"bid_settle",{...base,p_operation_id:body.operationId,p_credits:hold.credits}));
 }
 if(!billable.includes(body.usageAction))return json(400,{error:"unknown metered action"});
 let site=body.siteId??null;
 if(!site&&typeof body.projectKey==="string")site=(await db.from("sites").select("id").eq("user_id",user).eq("project_key",body.projectKey).maybeSingle()).data?.id??null;
 if(["deploy.preview","deploy.production","backup.snapshot"].includes(body.usageAction)&&!site)return json(403,{error:"Activate the site first",code:"site_paused"});
 const price=prices[body.usageAction];
 if(!Number.isSafeInteger(price?.credits)||price.credits<0||price.credits>1000000000||typeof price.window!=="boolean")return json(503,{error:"Action pricing is unavailable",code:"meter_unavailable"});
 return result(await creditRpc(db,kind==="reserve"?"bid_hold":"bid_charge",{...base,p_action:body.usageAction,p_credits:price.credits,p_operation_id:body.operationId,p_site:site,p_counts_window:price.window,p_pricing_version:await pricingVersion(settings)}));
}
