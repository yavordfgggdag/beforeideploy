// Discrete simulation (1-minute steps) of the proposed linear-release AI budget.
const H = 60, D = 24 * H, REL = 336 * H; // minutes
const R = (B, t) => Math.floor(B * Math.min(1, Math.max(0, t / REL)));
function run({ B, c5 = Math.floor(B * 5 / 336), c7 = Math.floor(B / 2), useCaps = true, demand, horizon = 30 * D }) {
  const spends = []; // [t, amount]
  let spent = 0, t = 0, exhaustedAt = null;
  const inWin = (w) => spends.filter(([s]) => s > t - w).reduce((a, [, x]) => a + x, 0);
  for (t = 0; t <= horizon; t++) {
    const want = demand(t); if (!want) continue;
    let allow = R(B, t) - spent;
    if (useCaps) { allow = Math.min(allow, c5 - inWin(5 * H), c7 - inWin(7 * D)); }
    const x = Math.max(0, Math.min(want, allow));
    if (x > 0) { spends.push([t, x]); spent += x; }
    if (spent >= B && exhaustedAt === null) exhaustedAt = t;
  }
  return { spent, exhaustedAt: exhaustedAt === null ? null : +(exhaustedAt / D).toFixed(2) };
}
const out = [];
for (const [name, B] of [['Flash', 100000], ['High', 300000], ['Knight', 1000000]]) {
  const c5 = Math.floor(B * 5 / 336);
  const greedy = run({ B, demand: () => B });               // spends whatever is allowed every minute
  const greedyNoCaps = run({ B, useCaps: false, demand: () => B });
  // single task of X credits must wait until released (no caps) / or be chunked into ≤c5 pieces (caps)
  out.push({ plan: name, B, cap5h: c5, cap7d: Math.floor(B / 2), maxUseExhaustDay_caps: greedy.exhaustedAt, maxUseExhaustDay_onlyR: greedyNoCaps.exhaustedAt });
}
console.log(JSON.stringify(out, null, 1));
// time until a task of X credits can run at the start of a period
const waitFor = (B, X) => +(Math.ceil(X / B * 336)).toFixed(0); // hours until R(t) >= X
for (const [name, B] of [['Flash', 100000], ['High', 300000], ['Knight', 1000000]]) {
  const c5 = Math.floor(B * 5 / 336);
  for (const [task, X] of [['малка поправка (Sonnet)', 900], ['поправка (Opus)', 1800], ['създаване на сайт (Sonnet, ~37k)', 37000], ['създаване на сайт (Opus, ~74k)', 74000]]) {
    console.log(`${name.padEnd(6)} ${task.padEnd(34)} R(t)≥X след ${String(waitFor(B, X)).padStart(4)} ч · брой 5ч прозорци ако се дели: ${Math.ceil(X / c5)} (≈ ${(Math.ceil(X / c5) * 5 / 24).toFixed(1)} дни непрекъснато)`);
  }
}
