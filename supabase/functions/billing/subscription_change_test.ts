import assert from "node:assert/strict";
import {FakeDb} from "../_shared/fake_supabase.ts";
import {type Row} from "../_shared/db.ts";
import {previewChange,confirmChange} from "./subscription-change.ts";
import {reconcilePlan} from "../_shared/credits.ts";
const now = new Date("2026-10-10T12:00:00Z");
function world() {
  const sub = { id:"s1", user_id:"u1",provider:"paddle",provider_ref:"sub_1",status:"active",tier:"flash",period_start:"2026-10-01T00:00:00Z",period_end:"2026-11-01T00:00:00Z" };
  const db = new FakeDb({profiles:[{user_id:"u1",role:"normal",plan:"flash"}],subscriptions:[sub],billing_changes:[]});
  let remote: Row = {id:"sub_1",status:"active",items:[{price:{id:"pri_flash"},quantity:1},{price:{id:"pri_addon"},quantity:2}],current_billing_period:{starts_at:sub.period_start,ends_at:sub.period_end},updated_at:"2026-10-01T00:00:00Z"};
  let price = 1250;
  const calls:Row[]=[];
  const provider = async (path:string,body?:Row,method?:string) => {
    calls.push({path,body,method});
    if(method === "GET") return remote;
    if(path.endsWith("/preview")) return {currency_code:"EUR",immediate_transaction:body?.proration_billing_mode === "do_not_bill" ? null : {details:{totals:{grand_total:String(price),currency_code:"EUR"}}},next_transaction:{details:{totals:{grand_total:"2999"}}}};
    remote={...remote,items:body!.items.map((i:Row)=>({price:{id:i.price_id},quantity:i.quantity})),updated_at:"2026-10-10T12:01:00Z"};
    return remote;
  };
  return {db,sub,provider,calls,prices:["pri_flash","pri_high"],setPrice:(p:number)=>{price=p;}};
}
Deno.test("billing change: review first, retain add-ons, PATCH once, never POST a transaction",async()=>{
  const w=world();
  const response=await previewChange(w.db,"u1",w.sub,"high","pri_high",w.prices,w.provider,now);
  assert.equal(response.status,200);
  const preview=(await response.json()).preview;
  assert.equal(preview.amount,1250);
  assert.equal(w.calls.filter(c=>!c.path.endsWith("preview") && c.method === "PATCH").length,0);
  // Postgres jsonb reorders properties; comparison must be semantic.
  w.db.tables.billing_changes[0].quote={currency:"EUR",nextAmount:2999,amount:1250};
  const applied=await confirmChange(w.db,"u1",preview.id,w.provider,now);
  assert.equal(applied.status,200);
  assert.equal((await applied.json()).changed,true);
  const mutation=w.calls.find(c=>c.method === "PATCH" && !c.path.endsWith("preview"))!;
  assert.equal(mutation.path,"/subscriptions/sub_1");
  assert.deepEqual(mutation.body.items,[{price_id:"pri_addon",quantity:2},{price_id:"pri_high",quantity:1}]);
  assert.equal(mutation.body.proration_billing_mode,"prorated_immediately");
  assert.equal(mutation.body.on_payment_failure,"prevent_change");
  assert.equal(await reconcilePlan(w.db,"u1",now),"high");
  await confirmChange(w.db,"u1",preview.id,w.provider,now);
  assert.equal(w.calls.filter(c=>c.method === "PATCH" && !c.path.endsWith("preview")).length,1);
  assert.ok(w.calls.every(c=>c.method !== "POST"));
});
Deno.test("billing change: another user, expired review and changed price cannot confirm",async()=>{
  const w=world();
  const p=(await(await previewChange(w.db,"u1",w.sub,"high","pri_high",w.prices,w.provider,now)).json()).preview;
  assert.equal((await confirmChange(w.db,"u2",p.id,w.provider,now)).status,404);
  assert.equal((await confirmChange(w.db,"u1",p.id,w.provider,new Date(now.getTime()+11*60000))).status,409);
  w.setPrice(1300);
  const r=await confirmChange(w.db,"u1",p.id,w.provider,now);
  assert.equal((await r.json()).code,"preview_expired");
  assert.equal(w.calls.filter(c=>c.method === "PATCH" && !c.path.endsWith("preview")).length,0);
});
Deno.test("billing change: downgrade retains the paid entitlement until renewal",async()=>{
  const w=world();
  // Begin with High at the provider and locally.
  await w.provider("/subscriptions/sub_1",{items:[{price_id:"pri_high",quantity:1}]},"PATCH");
  w.sub.tier="high";
  const p=(await(await previewChange(w.db,"u1",w.sub,"flash","pri_flash",w.prices,w.provider,now)).json()).preview;
  assert.equal(p.amount,0);
  assert.equal(p.downgrade,true);
  assert.equal((await confirmChange(w.db,"u1",p.id,w.provider,now)).status,200);
  assert.equal(await reconcilePlan(w.db,"u1",now),"high");
  assert.equal(await reconcilePlan(w.db,"u1",new Date("2026-11-01T00:00:00Z")),"flash");
  assert.equal(w.calls.at(-1)?.body.proration_billing_mode,"do_not_bill");
  assert.ok(!("effective_from" in w.calls.at(-1)!.body),"Paddle does not support effective_from on item updates");
});
Deno.test("billing change: a timed-out mutation stays locked until provider synchronization",async()=>{
  const w=world();
  const p=(await(await previewChange(w.db,"u1",w.sub,"high","pri_high",w.prices,w.provider,now)).json()).preview;
  const unknown=async(path:string,body?:Row,method?:string)=>{
    if(method === "PATCH" && !path.endsWith("preview")) throw new Error("connection lost after submit");
    return w.provider(path,body,method);
  };
  await assert.rejects(confirmChange(w.db,"u1",p.id,unknown,now));
  assert.equal(w.db.tables.billing_changes[0].status,"applying");
  assert.equal((await confirmChange(w.db,"u1",p.id,w.provider,now)).status,409);
});
