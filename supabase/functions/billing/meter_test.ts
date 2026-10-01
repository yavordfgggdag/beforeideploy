import assert from "node:assert/strict";
import {FakeDb} from "../_shared/fake_supabase.ts";
import {meterAction} from "./meter.ts";
const user="u",now=new Date("2026-10-01T09:00:00Z"),site="12345678-1234-1234-1234-123456789abc";
function world(){return new FakeDb({profiles:[{user_id:user,plan:"high",role:"normal"}],settings:[],sites:[{id:site,user_id:user,project_key:"shop",state:"active"}]});}
Deno.test("meter: server owns action price, site identity, window participation and settlement amount",async()=>{
 const db=world(); db.rpcResponses.bid_hold={ok:true,reserved:150};
 const r=await meterAction(db,user,{action:"meter",kind:"reserve",usageAction:"deploy.preview",operationId:"deploy-once",projectKey:"shop",credits:0,countsInWindow:false},now);
 assert.equal(r.status,200);
 const args=db.rpcCalls.find(c=>c.fn==="bid_hold")!.args;
 assert.equal(args.p_credits,150);assert.equal(args.p_counts_window,true);assert.equal(args.p_site,site);assert.equal(args.p_user,user);
 db.tables.credit_holds=[{user_id:user,operation_id:"deploy-once",action:"deploy.preview",credits:150}];db.rpcResponses.bid_settle={ok:true,charged:150};
 await meterAction(db,user,{action:"meter",kind:"settle",operationId:"deploy-once",credits:1},now);
 assert.equal(db.rpcCalls.find(c=>c.fn==="bid_settle")!.args.p_credits,150);
 assert.equal((await meterAction(db,"other",{action:"meter",kind:"settle",operationId:"deploy-once"},now)).status,404);
});
Deno.test("meter: no client-minted grants, AI amounts or owner hosting; only configured actions",async()=>{
 const db=world();
 for(const usageAction of ["site.day","ai.chat","grant","domain.register"])assert.equal((await meterAction(db,user,{action:"meter",usageAction,operationId:"illegal-op"},now)).status,400);
 assert.equal((await meterAction(db,user,{action:"meter",usageAction:"deploy.production",operationId:"no-site-123"},now)).status,403);
 const quote=await (await meterAction(db,user,{action:"estimate",usageAction:"audit.full"},now)).json();assert.equal(quote.credits,400);
 db.rpcResponses.bid_boost={ok:false,code:"boost_used",resetsAt:"2026-10-08"};
 assert.equal((await meterAction(db,user,{action:"boost"},now)).status,409);
});
