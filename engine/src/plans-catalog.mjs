import fs from 'node:fs';
export const DEFAULT_CATALOG = JSON.parse(fs.readFileSync(new URL('./plans-data.json', import.meta.url), 'utf8'));
export const DEFAULT_ACTION_PRICES = JSON.parse(fs.readFileSync(new URL('./pricing-actions.json', import.meta.url), 'utf8'));
const policy = p => ({ tokens: p.credits, max_active_sites: p.activeSites, fair_use_sites: p.activeSitesMax, validity_months: p.validityMonths, cloud_minutes: p.cloudMinutes ?? 0 });
export const DEFAULT_PLAN_TOKENS = Object.fromEntries([...(DEFAULT_CATALOG.free ? [['free', DEFAULT_CATALOG.free]] : []), ...Object.entries(DEFAULT_CATALOG.plans)].map(([id, p]) => [id, policy(p)]));

/** Catalog v13: the price set on sale — connected hosting, or the hosting-included prices behind the flag. */
export function soldPrices(plan, hostingIncluded = DEFAULT_CATALOG.features?.hostingIncluded === true) {
  const set = hostingIncluded && plan.hostingIncluded ? plan.hostingIncluded : plan;
  return { price: set.price, yearlyPrice: set.yearly?.price ?? null, yearlyDomain: set.yearly?.domain === true, hostingMode: set === plan ? 'connected' : 'included' };
}

export function offlineCatalog(reason = 'offline', source = 'offline') {
  const c = DEFAULT_CATALOG;
  const included = c.features?.hostingIncluded === true;
  return { currency: c.currency, taxInclusive: true, source, reason, version: c.version, pricing:{version:c.version,actions:DEFAULT_ACTION_PRICES},
    features: { hostingIncluded: included }, hostingMode: included ? 'included' : 'connected', release: c.release ?? null, starterBonus: c.starterBonus ?? null,
    free: c.free ? { id: 'free', price: 0, tokens: c.free.credits, activeSites: c.free.activeSites, cloudMinutes: c.free.cloudMinutes ?? 0, hosting: c.free.hosting ?? null } : null,
    plans: Object.entries(c.plans).map(([id,p]) => ({ ...p, id, tokens: p.credits, available: false, ...soldPrices(p, included), yearlyAvailable: false })),
    packs: c.packs.map(p => ({ ...p, available: false })), trial: c.trial };
}
