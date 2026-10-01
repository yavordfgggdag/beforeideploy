import assert from "node:assert/strict";
import {FakeDb,fakeDeps} from "../_shared/fake_supabase.ts";
import {reportAction} from "./reports.ts";
import {auditMarkup,type ProbeResult} from "../_shared/netguard.ts";
const now=new Date('2026-10-01T09:00:00Z');
function world(){const db=new FakeDb({profiles:[{user_id:'u',plan:'high'}],bid_projects:[{user_id:'u',key:'shop',live_url:'https://shop.example.test'}],settings:[]});db.rpcResponses.bid_hold={ok:true};db.rpcResponses.bid_v12_report={ok:true};return db;}
Deno.test('cloud reports: reserve precedes server probes; retry and denied quota cannot run a second audit',async()=>{
 const db=world();let probes=0;
 const deps={...fakeDeps(db),probe:async(url:string)=>{probes++;assert.ok(db.rpcCalls.some(c=>c.fn==='bid_hold'));return {ok:true,url,finalUrl:url,status:200,ms:12,reason:null,ip:'8.8.8.8',redirects:0,title:'Home',tlsExpiresAt:null,bytes:200,audit:{description:true,language:true,canonical:true,h1:true,missingAlt:0,links:['https://evil.test'],securityHeaders:[],truncated:false}} as ProbeResult;}};
 const body={action:'audit_run',projectKey:'shop',operationId:'audit-first'};
 assert.equal((await reportAction(db,'u',body,now,deps)).status,200);assert.equal(probes,1);
 const saved=db.rpcCalls.find(c=>c.fn==='bid_v12_report')!.args.p_report;
 assert.equal(saved.source,'server');assert.equal(saved.links.length,0);assert.equal(saved.responseMs,12);
 db.rpcResponses.bid_hold={ok:true,duplicate:true};assert.equal((await reportAction(db,'u',body,now,deps)).status,409);assert.equal(probes,1);
 db.rpcResponses.bid_hold={ok:false,code:'quota_exhausted'};assert.equal((await reportAction(db,'u',{...body,operationId:'audit-second'},now,deps)).status,402);assert.equal(probes,1);
 assert.equal((await reportAction(db,'other',body,now,deps)).status,404);
});
Deno.test('cloud reports: client check only stores bounded counts; publishing requires a supported owned receipt',async()=>{
 const db=world(),deps=fakeDeps(db);
 await reportAction(db,'u',{action:'check_report',projectKey:'shop',operationId:'check-first',status:'ready',counts:{pass:3,warn:-1,fail:Infinity},logs:'SECRET',source:'server'},now,deps);
 const report=db.rpcCalls.find(c=>c.fn==='bid_v12_report')!.args.p_report;
 assert.deepEqual(report.counts,{pass:3,warn:0,fail:0});assert.equal(report.logs,undefined);assert.equal(report.source,'client');
 assert.equal((await reportAction(db,'u',{action:'operation_report',projectKey:'shop',operationId:'arbitrary'},now,deps)).status,404);
 db.tables.cloud_reports=[{user_id:'u',project_key:'shop',operation_id:'one',report:{}},{user_id:'other',project_key:'shop',operation_id:'two',report:{}}];
 const history=await (await reportAction(db,'u',{action:'report_history',projectKey:'shop'},now,deps)).json();assert.equal(history.reports.length,1);
});
Deno.test('audit metadata strips query strings, bounds same-origin links and never returns HTML or cookie headers',()=>{
 const html='<html lang="bg"><title>Site</title><meta content="A site" name="description"><link href="/" rel="canonical"><h1>Hi</h1><img src="a"><img alt="" src="b"><a href="/about?token=SECRET#x">About</a><a href="https://evil.test">Other</a></html>';
 const result=auditMarkup(html,new URL('https://shop.test'),{'set-cookie':'SECRET','content-security-policy':"default-src 'self'"},true);
 assert.equal(result.description,true);assert.equal(result.language,true);assert.equal(result.canonical,true);assert.equal(result.missingAlt,1);assert.equal(result.truncated,true);
 assert.deepEqual(result.links,['https://shop.test/about']);assert.ok(!JSON.stringify(result).includes('SECRET'));
});
