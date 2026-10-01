import { offlineCatalog } from './plans-catalog.mjs';
/** Review data only. Demo mutations are refused before any credentials or network access. */
export function billingDemo(action, now = new Date()) {
  if (action === 'catalog') return offlineCatalog('demo', 'demo');
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()-29)).toISOString();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+1)).toISOString();
  const subscription = { provider: 'demo', tier: 'high', status: 'active', interval: 'month', renewsAt: end, endsAt: null, manageable: false };
  const status = { source: 'demo', plan: 'high', subscription, balance: { plan: 210000, topup: 120000, total: 330000, available: 329000 }, trialAvailable: false, usage: [] };
  if (action === 'status') return status;
  const window = (used,cap,hours) => ({ used, cap, reserved: 1000, remaining: cap-used-1000, resetsAt: new Date(now.getTime()+hours*3600000).toISOString() });
  return { source: 'demo', v: 2, serverTime: now.toISOString(), unit: 'credits', plan: 'high', subscription, trialAvailable: false,
    period: { start, end, renewsAt: end, source: 'subscription' }, included: { tokens: 300000 }, used: { tokens: 90000, operations: 46 }, reserved: { tokens: 1000, operations: 1 },
    remaining: { plan: 210000, purchased: 120000, total: 330000, available: 329000 }, purchased: { tokens: 120000, expires: '12 months after purchase' },
    session: { ...window(18500,60000,3),windowHours:5,capPercent:20 }, weekly: window(62000,120000,58),
    sites: { active: 2, limit: 3, paused: 0 }, packs: [{ id:'demo-pack',remaining:120000,expiresAt:new Date(now.getTime()+180*86400000).toISOString() }],
    byAction: [{action:'ai',credits:87500,operations:31},{action:'check',credits:500,operations:10},{action:'audit',credits:2000,operations:5}],
    daily: Array.from({length:30},(_,i)=>({date:new Date(now.getTime()-(29-i)*86400000).toISOString().slice(0,10),credits:i < 22 ? 1200 : i === 22 ? 1600 : i < 29 ? 8800 : 9200})),
    byModel:[{model:'claude-opus-5-5',tokens:65000,operations:20},{model:'claude-sonnet-5-5',tokens:22500,operations:11}],
    limits:{perMinute:6,perHour:60,sessionHours:5,sessionCapPercent:20,sessionCap:60000,sessionUsed:18500},
    pricing:{version:'v12.2',spendOrder:['oldest-first']}, reconciled:{releasedHolds:0},history:{operations:[],ledger:[]} };
}
