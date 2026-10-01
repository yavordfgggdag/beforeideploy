// Credit model V3 (docs/PLAN-UNIFIED-BG.md §9.3). Pure functions — the same rules the database enforces;
// the UI uses them to explain availability ("ready at 14:30"), never to grant anything.
export const RELEASE_HOURS = 336; // 14 days
export const HOUR = 3_600_000;
export const GUARD_24H = 0.25; // share of B per rolling 24 h (settled spend)
export const GUARD_7D = 0.5; // share of B per rolling 7 days (settled spend)

export interface Spend { at: number; credits: number; source: 'included' | 'carried' | 'bonus' | 'pack' }
export interface Period { start: number; budget: number }

/** Released included credits at time t: R(t) = floor(B · min(1, max(0, (t − t₀) / 336 h))). */
export function released(p: Period, t: number): number {
  const f = Math.min(1, Math.max(0, (t - p.start) / (RELEASE_HOURS * HOUR)));
  return Math.floor(p.budget * f);
}

const sumSince = (spends: Spend[], from: number, to: number) =>
  spends.filter((s) => s.source === 'included' && s.at > from && s.at <= to).reduce((a, s) => a + s.credits, 0);

export interface Availability {
  included: number; // spendable included credits now (after release and guards)
  reason: 'ok' | 'release' | 'guard24h' | 'guard7d' | 'exhausted';
  releasedNow: number;
  spentIncluded: number;
}

/**
 * Spendable included credits now, and which rule binds. `held` = active reservations on included credits.
 * The 24 h / 7 day guards look at SETTLED spend only: they decide whether a new task may start, never how
 * big it may be — so one large task (e.g. creating a site) is not refused just because it exceeds 25 % of B.
 * The 14-day guarantee comes from the release curve alone.
 */
export function includedAvailable(p: Period, spends: Spend[], held: number, t: number): Availability {
  const spentIncluded = sumSince(spends, p.start - 1, t);
  const releasedNow = released(p, t);
  const byRelease = Math.max(0, releasedNow - spentIncluded - held);
  const over24 = sumSince(spends, t - 24 * HOUR, t) >= Math.floor(p.budget * GUARD_24H);
  const over7 = sumSince(spends, t - 168 * HOUR, t) >= Math.floor(p.budget * GUARD_7D);
  let reason: Availability['reason'] = 'ok';
  if (spentIncluded + held >= p.budget) reason = 'exhausted';
  else if (over24) reason = 'guard24h';
  else if (over7) reason = 'guard7d';
  else if (byRelease < p.budget - spentIncluded - held) reason = 'release';
  const included = over24 || over7 ? 0 : byRelease;
  return { included, reason, releasedNow, spentIncluded };
}

/**
 * Earliest moment (≥ t) at which `need` included credits will be spendable, assuming no further spending.
 * Steps through hours; null when the period's budget can never cover it.
 */
export function readyAt(p: Period, spends: Spend[], held: number, need: number, t: number): number | null {
  const spent = sumSince(spends, p.start - 1, t);
  if (spent + held + need > p.budget) return null;
  for (let x = t; x <= p.start + 31 * 24 * HOUR; x += HOUR / 4) {
    if (includedAvailable(p, spends, held, x).included >= need) return x;
  }
  return null;
}

/** Order in which balances are spent: bonus → carried (oldest) → included → packs. */
export function spendPlan(need: number, balances: { bonus: number; carried: number; included: number; packs: number }) {
  const out: Record<'bonus' | 'carried' | 'included' | 'packs', number> = { bonus: 0, carried: 0, included: 0, packs: 0 };
  let left = need;
  for (const k of ['bonus', 'carried', 'included', 'packs'] as const) {
    const take = Math.min(left, balances[k]);
    out[k] = take;
    left -= take;
  }
  return { ...out, covered: left === 0, missing: left };
}
