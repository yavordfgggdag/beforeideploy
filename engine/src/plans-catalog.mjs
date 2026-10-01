import fs from 'node:fs';
export const DEFAULT_CATALOG = JSON.parse(fs.readFileSync(new URL('./plans-data.json', import.meta.url), 'utf8'));
export const DEFAULT_PLAN_TOKENS = Object.fromEntries(Object.entries(DEFAULT_CATALOG.plans).map(([id, p]) => [id, { tokens: p.credits, max_active_sites: p.activeSites, fair_use_sites: p.activeSitesMax, validity_months: p.validityMonths }]));
export function offlineCatalog(reason = 'offline', source = 'offline') {
  const c = DEFAULT_CATALOG;
  return { currency: c.currency, taxInclusive: true, source, reason, version: c.version,
    plans: Object.entries(c.plans).map(([id,p]) => ({ ...p, id, tokens: p.credits, available: false, yearlyPrice: p.yearly.price, yearlyAvailable: false })),
    packs: c.packs.map(p => ({ ...p, available: false })), trial: c.trial };
}
