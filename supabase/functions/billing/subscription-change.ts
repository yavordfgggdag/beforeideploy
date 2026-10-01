import { type DbClient, type Row, json, must, sha256Hex, isDuplicate } from "../_shared/db.ts";

type Provider = (path: string, body?: Row, method?: string) => Promise<Row>;
const tiers = ["free", "flash", "high", "knight"];
const fingerprint = (s: Row) => sha256Hex(JSON.stringify({ items:s.items, status:s.status, period:s.current_billing_period, scheduled:s.scheduled_change, updated:s.updated_at }));
const totals = (p: Row) => {
  const immediate = p.immediate_transaction?.details?.totals;
  const next = p.next_transaction?.details?.totals ?? p.recurring_transaction_details?.totals;
  if ((p.immediate_transaction && immediate?.grand_total == null) || next?.grand_total == null || !(immediate?.currency_code ?? p.currency_code)) {
    throw Object.assign(new Error("Incomplete provider price preview"), { status:502,code:"provider_error" });
  }
  return { amount:Number(immediate?.grand_total ?? 0), nextAmount:Number(next.grand_total), currency:String(immediate?.currency_code ?? p.currency_code) };
};

/** Preview the change to the existing subscription. Never creates a second transaction/subscription. */
export async function previewChange(db: DbClient, userId: string, sub: Row, target: string, priceId: string, knownPrices: string[], provider: Provider, now: Date) {
  const remote = await provider(`/subscriptions/${sub.provider_ref}`, undefined, "GET");
  if (!["active", "trialing"].includes(remote.status)) return json(409, { code:"billing_conflict", error:"Resolve the subscription's status before changing plan" });
  if (remote.scheduled_change) return json(409, { code:"billing_conflict", error:"Resolve the scheduled change in the customer portal first" });
  const items = (remote.items ?? []) as Row[];
  const planItems = items.filter(i => knownPrices.includes(i.price?.id ?? i.price_id));
  if (planItems.length !== 1) return json(409, { code:"billing_conflict", error:"The subscription must contain exactly one recognized plan" });
  if ((planItems[0].price?.id ?? planItems[0].price_id) === priceId) return json(200, { changed:false, unchanged:true });
  const downgrade = tiers.indexOf(target) < tiers.indexOf(sub.tier);
  const effectiveAt = downgrade ? remote.current_billing_period?.ends_at : now.toISOString();
  if (!effectiveAt) return json(409,{ code:"billing_conflict",error:"The billing period is missing" });
  const request = {
    items:[...items.filter(i => !knownPrices.includes(i.price?.id ?? i.price_id)).map(i => ({price_id:i.price?.id ?? i.price_id, quantity:i.quantity ?? 1})), {price_id:priceId,quantity:1}],
    proration_billing_mode:downgrade ? "do_not_bill" : "prorated_immediately",
    on_payment_failure:"prevent_change",
  };
  const quote = await provider(`/subscriptions/${sub.provider_ref}/preview`,request,"PATCH");
  const money = totals(quote);
  if (!Number.isSafeInteger(money.amount) || !Number.isSafeInteger(money.nextAmount) || money.amount < 0 || money.nextAmount < 0) return json(502,{code:"provider_error",error:"Invalid provider preview amount"});
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime()+10*60_000).toISOString();
  must(await db.from("billing_changes").insert({id,user_id:userId,provider_ref:sub.provider_ref,from_tier:sub.tier,to_tier:target,effective_at:effectiveAt,expires_at:expiresAt,request,quote:money,fingerprint:await fingerprint(remote),status:"preview",created_at:now.toISOString()}));
  return json(200, { preview:{ id,plan:target,...money,effectiveAt,expiresAt,downgrade } });
}

export async function confirmChange(db: DbClient, userId: string, id: string, provider: Provider, now: Date) {
  const {data:change} = await db.from("billing_changes").select("*").eq("id",id).eq("user_id",userId).maybeSingle();
  if (!change) return json(404,{code:"not_found",error:"Preview not found"});
  if (change.status === "applied") return json(200,{changed:true, effectiveAt:change.effective_at});
  if (change.status !== "preview") return json(409,{code:"billing_conflict",error:"This change is already being processed; synchronize the subscription"});
  if (Date.parse(change.expires_at)<=now.getTime()) return json(409,{code:"preview_expired",error:"Preview expired; review the current price again"});
  // A partial unique index permits one applying change per subscription. Conditional UPDATE claims this preview once.
  const claim = await db.from("billing_changes").update({status:"applying"}).eq("id",id).eq("user_id",userId).eq("status","preview").select("id").maybeSingle();
  if (claim.error && !isDuplicate(claim.error)) must(claim);
  if (claim.error || !claim.data) return json(409,{code:"billing_conflict",error:"Another change is in progress"});
  let submitted = false;
  try {
    const remote = await provider(`/subscriptions/${change.provider_ref}`,undefined,"GET");
    if (await fingerprint(remote) !== change.fingerprint) {
      must(await db.from("billing_changes").update({status:"stale"}).eq("id",id));
      return json(409,{code:"preview_expired",error:"Subscription changed; review it again"});
    }
    const quote = await provider(`/subscriptions/${change.provider_ref}/preview`,change.request,"PATCH");
    const money = totals(quote);
    if (money.amount !== change.quote.amount || money.nextAmount !== change.quote.nextAmount || money.currency !== change.quote.currency) {
      must(await db.from("billing_changes").update({status:"stale"}).eq("id",id));
      return json(409,{code:"preview_expired",error:"Price changed; review it again"});
    }
    submitted = true;
    const updated = await provider(`/subscriptions/${change.provider_ref}`,change.request,"PATCH");
    // The webhook/sync remains authoritative for payments and grants. Keep the intent for deferred entitlements.
    must(await db.from("billing_changes").update({status:"applied"}).eq("id",id));
    must(await db.from("subscriptions").update({tier:change.to_tier,raw:updated,updated_at:now.toISOString()}).eq("user_id",userId).eq("provider_ref",change.provider_ref));
    return json(200,{changed:true,effectiveAt:change.effective_at});
  } catch (error) {
    // An unknown network outcome after PATCH must not invite another charge. Sync resolves it against Paddle.
    if (!submitted || (error as {definite?:boolean}).definite) await db.from("billing_changes").update({status:"failed"}).eq("id",id);
    throw error;
  }
}
