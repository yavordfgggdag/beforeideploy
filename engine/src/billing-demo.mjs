import { offlineCatalog, DEFAULT_ACTION_PRICES, DEFAULT_CATALOG } from './plans-catalog.mjs';
/** Review data only (usage contract v3, credit model V3). Demo mutations are refused before any credentials or network access. */
export function billingDemo(action, now = new Date()) {
  if (action === 'catalog') return offlineCatalog('demo', 'demo');
  const DAY = 86400000, HOUR = 3600000;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = new Date(today - 5 * DAY).toISOString();
  const end = new Date(today + 25 * DAY).toISOString();
  const B = DEFAULT_CATALOG.plans.high.credits;
  const release = DEFAULT_CATALOG.release ?? { hours: 336, guard24hShare: 0.25, guard7dShare: 0.5 };
  // Included spend on three days of the period (all settled), one live reservation.
  const spends = [{ day: 4, credits: 9400 }, { day: 2, credits: 6100 }, { day: 0, credits: 1240 }];
  const spent = spends.reduce((n, s) => n + s.credits, 0), held = 1000;
  const released = Math.floor(B * Math.min(1, Math.max(0, (now.getTime() - Date.parse(start)) / (release.hours * HOUR))));
  const last24h = 1240, last7d = spent, cap24h = Math.floor(B * release.guard24hShare), cap7d = Math.floor(B * release.guard7dShare);
  const availableIncluded = Math.max(0, Math.min(released, B) - spent - held);
  const carried = [{ id: 'demo-carried', source: 'plan_grant', remaining: 22000, available: 22000, grantedAt: new Date(today - 35 * DAY).toISOString(), expiresAt: new Date(today + 50 * DAY).toISOString() }];
  const packs = [{ id: 'demo-pack', remaining: 100000, expiresAt: new Date(today + 180 * DAY).toISOString() }];
  const planLeft = B - spent + carried[0].remaining, packLeft = packs[0].remaining;
  const total = planLeft + packLeft, available = total - held;
  const subscription = { provider: 'demo', tier: 'high', status: 'active', interval: 'month', renewsAt: end, endsAt: null, manageable: false };
  const status = { source: 'demo', plan: 'high', subscription, balance: { plan: planLeft, topup: packLeft, total, available }, trialAvailable: false, usage: [] };
  if (action === 'status') return status;
  const daily = Array.from({ length: 30 }, (_, i) => {
    const back = 29 - i;
    return { date: new Date(today - back * DAY).toISOString().slice(0, 10), credits: spends.find(s => s.day === back)?.credits ?? 0 };
  });
  const reason = availableIncluded < Math.max(0, B - spent - held) ? 'release' : 'ok';
  return { source: 'demo', v: 3, serverTime: now.toISOString(), unit: 'credits', plan: 'high', subscription, trialAvailable: false, reason,
    period: { start, end, renewsAt: end, source: 'subscription', included: B, used: spent, reserved: held, packs: packLeft, available, debt: 0, forecastDaysLeft: 9 },
    included: { tokens: B, budget: B, released, spent, held, left: B - spent, free: B - spent - held, availableNow: availableIncluded, periodStart: start, periodEnd: end, releaseEndsAt: new Date(Date.parse(start) + release.hours * HOUR).toISOString() },
    guards: { last24h, cap24h, last7d, cap7d, clears24hAt: null, clears7dAt: null },
    available: { now: availableIncluded + carried[0].available + packLeft, total: B - spent - held + carried[0].available + packLeft },
    carried, bonus: { credits: 60000, remaining: 0, expiresAt: null, claimed: true, appliesTo: DEFAULT_CATALOG.starterBonus?.actions ?? ['ai.fix', 'ai.fix.deep'] },
    packRate: { lastHour: 0, capPerHour: release.packCreditsPerHour ?? 200000 },
    cloudMinutes: { included: DEFAULT_CATALOG.plans.high.cloudMinutes ?? 0, used: null, tracked: false },
    used: { tokens: spent, operations: 46 }, reserved: { tokens: held, operations: 1 },
    remaining: { plan: planLeft, purchased: packLeft, total, available }, purchased: { tokens: packLeft, expires: '12 months after purchase' },
    session: { windowHours: 24, capPercent: 25, cap: cap24h, used: last24h, reserved: held, remaining: Math.max(0, cap24h - last24h), resetsAt: null },
    weekly: { windowHours: 168, capPercent: 50, cap: cap7d, used: last7d, reserved: held, remaining: Math.max(0, cap7d - last7d), resetsAt: null },
    sites: { active: 2, limit: 3, max: 3, fairUse: 3, paused: 0, items:[{id:'demo-shop',projectKey:'demo-shop',name:'shop.example',state:'active',hostingOwner:'user',credits:0},{id:'demo-studio',projectKey:'demo-studio',name:'studio.example',state:'active',hostingOwner:'user',credits:0}] }, packs,
    byAction: [{action:'ai',credits:14740,operations:31},{action:'check',credits:500,operations:10},{action:'audit',credits:1500,operations:5}],
    daily,
    byModel:[{model:'claude-opus-5-5',tokens:10200,operations:20},{model:'claude-sonnet-5-5',tokens:4540,operations:11}],
    limits:{perMinute:6,perHour:60,releaseHours:release.hours,guard24hPercent:25,guard7dPercent:50},
    pricing:{version:'2026-10',actions:DEFAULT_ACTION_PRICES,spendOrder:['bonus','carried','included','packs']}, reconciled:{releasedHolds:0},history:{operations:[],ledger:[]} };
}
