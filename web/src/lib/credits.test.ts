import { test } from 'node:test';
import assert from 'node:assert/strict';
import { released, includedAvailable, readyAt, spendPlan, HOUR, RELEASE_HOURS, type Spend } from './credits.ts';

const P = { start: 0, budget: 40_000 }; // Flash V3

test('R(t) releases linearly over 14 days and never exceeds B', () => {
  assert.equal(released(P, 0), 0);
  assert.equal(released(P, 168 * HOUR), 20_000);
  assert.equal(released(P, RELEASE_HOURS * HOUR), 40_000);
  assert.equal(released(P, 40 * 24 * HOUR), 40_000);
});

test('greedy maximum use cannot exhaust the included budget before day 14', () => {
  const spends: Spend[] = [];
  let exhaustedAt: number | null = null;
  for (let t = 0; t <= 30 * 24 * HOUR; t += HOUR / 4) {
    const a = includedAvailable(P, spends, 0, t).included;
    if (a > 0) spends.push({ at: t, credits: a, source: 'included' });
    const total = spends.reduce((x, s) => x + s.credits, 0);
    if (total >= P.budget && exhaustedAt === null) exhaustedAt = t;
  }
  assert.ok(exhaustedAt !== null && exhaustedAt >= RELEASE_HOURS * HOUR, `exhausted at ${exhaustedAt! / HOUR} h`);
});

test('reservations count against availability (no double spend from two devices)', () => {
  const t = 168 * HOUR;
  const a = includedAvailable(P, [], 0, t).included;
  const b = includedAvailable(P, [], a, t).included;
  assert.equal(b, 0);
});

test('readyAt explains when a task becomes possible', () => {
  const at = readyAt(P, [], 0, 2_000, 0)!;
  assert.ok(at > 0 && at <= 17 * HOUR, `ready after ${at / HOUR} h`);
  assert.equal(readyAt(P, [], 0, 50_000, 0), null);
});

test('spend order: bonus, carried, included, packs', () => {
  const r = spendPlan(70_000, { bonus: 60_000, carried: 5_000, included: 3_000, packs: 100_000 });
  assert.deepEqual([r.bonus, r.carried, r.included, r.packs, r.covered], [60_000, 5_000, 3_000, 2_000, true]);
});

test('one large task may exceed the 24 h guard share when nothing was spent in the window', () => {
  const High = { start: 0, budget: 100_000 };
  const t0 = 9 * 24 * HOUR; // ≈ 64 % released
  assert.ok(includedAvailable(High, [], 0, t0).included >= 30_000);
  // after spending 25 % within 24 h, new tasks wait for the window
  const spends: Spend[] = [{ at: t0, credits: 25_000, source: 'included' }];
  const a = includedAvailable(High, spends, 0, t0 + HOUR);
  assert.equal(a.included, 0); assert.equal(a.reason, 'guard24h');
});
