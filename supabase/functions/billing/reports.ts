import {type DbClient,type Row,type Deps,json,must} from "../_shared/db.ts";
import {creditRpc} from "../_shared/credits.ts";
import {probe,type ProbeOptions,type ProbeResult,validateTargetUrl} from "../_shared/netguard.ts";
import {rateLimited} from "../_shared/ratelimit.ts";
import {meterAction} from "./meter.ts";
export const REPORT_ACTIONS=["check_report","audit_run","operation_report","report_history"];
export type ReportDeps = Deps & {probe?:(url:string,opts:ProbeOptions)=>Promise<ProbeResult>};
const safeCount=(v:unknown)=>Number.isInteger(v)&&Number(v)>=0&&Number(v)<=100000?Number(v):0;

export async function reportAction(db:DbClient,user:string,body:Row,now:Date,deps:ReportDeps):Promise<Response> {
 const limit=await rateLimited(db,user,"billing.reports");if(limit)return limit;
 if(typeof body.projectKey!=="string"||body.projectKey.length>200)return json(400,{error:"projectKey required"});
 const {data:project}=must(await db.from("bid_projects").select("key,live_url").eq("user_id",user).eq("key",body.projectKey).maybeSingle());
 if(!project)return json(404,{code:"not_found",error:"Sync the project first"});
 if(body.action==="report_history") {
  const {data:reports}=must(await db.from("cloud_reports").select("operation_id,action,report,created_at").eq("user_id",user).eq("project_key",body.projectKey).order("created_at",{ascending:false}).limit(50));
  return json(200,{reports:reports??[]});
 }
 if(typeof body.operationId!=="string"||!/^[A-Za-z0-9_:-]{8,200}$/.test(body.operationId))return json(400,{error:"operationId required"});
 const {data:saved}=must(await db.from("cloud_reports").select("project_key,report,action").eq("user_id",user).eq("operation_id",body.operationId).maybeSingle());
 if(saved) {
  if(saved.project_key!==body.projectKey || (body.action==="audit_run" && saved.action!=="audit.full") || (body.action==="check_report" && saved.action!=="check.run"))return json(409,{code:"operation_conflict",error:"Operation belongs to a different report"});
  return json(200,{ok:true,duplicate:true,operationId:body.operationId,report:saved.report});
 }
 let report:Row;
 if(body.action==="operation_report") {
  const {data:hold}=must(await db.from("credit_holds").select("action,status").eq("user_id",user).eq("operation_id",body.operationId).maybeSingle());
  if(!hold || !["deploy.preview","deploy.production","deploy.rollback","backup.snapshot"].includes(hold.action))return json(404,{code:"not_found",error:"Publishing receipt required"});
  report={source:"client",status:["ok","failed"].includes(body.status)?body.status:"unknown",provider:["netlify","vercel","cloudflare","ghpages"].includes(body.provider)?body.provider:null};
 } else {
  const usageAction=body.action==="audit_run"?"audit.full":"check.run";
  let target:URL|null=null;
  if(body.action==="audit_run") {
   const checked=validateTargetUrl(project.live_url??"");if(!checked.ok)return json(400,{code:"url_rejected",error:"The project needs a public live URL"});
   target=checked.url;target.search="";target.hash="";
  }
  const reservation=await meterAction(db,user,{action:"meter",kind:"reserve",usageAction,operationId:body.operationId,projectKey:body.projectKey},now);
  if(!reservation.ok)return reservation;
  const receipt=await reservation.json();
  if(receipt.duplicate)return json(409,{code:"operation_in_progress",error:"The operation is already running; use its saved report"});
  if(body.action==="check_report") {
   report={source:"client",status:["ready","warnings","blocked"].includes(body.status)?body.status:"unknown",counts:{pass:safeCount(body.counts?.pass),warn:safeCount(body.counts?.warn),fail:safeCount(body.counts?.fail)},checkedAt:now.toISOString()};
  } else {
   // Pinned DNS, public addresses, same-host redirects and bounded bodies/timeouts remain enforced.
   const inspect=deps.probe??probe;
   const main=await inspect(target!.href,{audit:true,timeoutMs:5000,maxBodyBytes:262144,maxRedirects:3});
   const links:Row[]=[];
   const candidates=(main.audit?.links??[]).filter(text=>{try{return new URL(text).origin===target!.origin;}catch{return false;}}).slice(0,6);
   for(let i=0;i<candidates.length;i+=3) {
    const batch=await Promise.all(candidates.slice(i,i+3).map(async url=>{const r=await inspect(url,{method:"HEAD",timeoutMs:5000,maxBodyBytes:1024,maxRedirects:3});return {url,status:r.status,ok:r.ok,reason:r.reason};}));links.push(...batch);
   }
   report={source:"server",status:main.ok?"complete":"unreachable",url:target!.href,httpStatus:main.status,responseMs:main.ms,bytes:main.bytes,redirects:main.redirects,titlePresent:!!main.title,reason:main.reason,metadata:main.audit??null,links,scope:"bounded-http-audit",checkedAt:now.toISOString()};
  }
 }
 const receipt=await creditRpc(db,"bid_v12_report",{p_user:user,p_operation_id:body.operationId,p_project:body.projectKey,p_report:report,p_now:now.toISOString()});
 return json(receipt.ok===false?409:200,receipt);
}
