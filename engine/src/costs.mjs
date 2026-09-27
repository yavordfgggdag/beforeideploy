// Cost Center — price table, local ledger, provider usage (real where the API allows it), budgets
import fs from 'node:fs';
import path from 'node:path';
import { spaceshipConnected } from './spaceship.mjs';
import { APP_DIR, readJSON, writeJSON, ensureDir, nowISO, which, runStream, extractJSON, HOME } from './util.mjs';

const PRICES_FILE = () => path.join(APP_DIR, 'prices.json');
const LEDGER_FILE = () => path.join(APP_DIR, 'ledger.jsonl');
const USAGE_CACHE = () => path.join(APP_DIR, 'usage-cache.json');
const BUDGET_FILE = () => path.join(APP_DIR, 'budgets.json');

// Editable estimates. Real provider numbers (when available) always win in the UI.
export const DEFAULT_PRICES = {
  version: 1,
  note: 'Оценки — редактирай при промяна на цените на доставчиците.',
  items: {
    'netlify:production': { unit: 'credits', amount: 15, label: 'Netlify production deploy' },
    'netlify:draft': { unit: 'credits', amount: 0, label: 'Netlify draft preview' },
    'netlify:bandwidth-gb': { unit: 'credits', amount: 10, label: 'Netlify bandwidth (за GB)' },
    'chatgpt:aifix': { unit: 'messages', amount: 1, label: 'ChatGPT AI Fix (от лимита на плана)' },
    'claude:aifix': { unit: 'messages', amount: 1, label: 'Claude AI Fix (от лимита на плана)' },
    'codex:aifix': { unit: 'tasks', amount: 1, label: 'Codex AI Fix (от лимита на плана)' },
    'github:push': { unit: 'free', amount: 0, label: 'GitHub push' },
    'vercel:production': { unit: 'free', amount: 0, label: 'Vercel production (в рамките на плана)' },
    'vercel:draft': { unit: 'free', amount: 0, label: 'Vercel preview (в рамките на плана)' },
    'cloudflare:production': { unit: 'free', amount: 0, label: 'Cloudflare Pages deploy (безплатен план)' },
    'cloudflare:draft': { unit: 'free', amount: 0, label: 'Cloudflare Pages preview (безплатен план)' },
    'ghpages:production': { unit: 'free', amount: 0, label: 'GitHub Pages deploy' },
    'local:check': { unit: 'free', amount: 0, label: 'Локална проверка / build' },
  },
};

export function getPrices() {
  const p = readJSON(PRICES_FILE(), null);
  if (!p?.items) {
    writeJSON(PRICES_FILE(), DEFAULT_PRICES);
    return DEFAULT_PRICES;
  }
  // add new default items without overwriting user edits
  let changed = false;
  for (const [k, v] of Object.entries(DEFAULT_PRICES.items)) {
    if (!p.items[k]) {
      p.items[k] = v;
      changed = true;
    }
  }
  if (changed) writeJSON(PRICES_FILE(), p);
  return p;
}

export function priceFor(service, op) {
  const items = getPrices().items;
  const base = op.split(':')[0];
  return items[`${service}:${op}`] || items[`${service}:${base}`] || null;
}

export function recordCost({ project, projectName, service, op, amount, unit, estimated = true, ref = null }) {
  const price = priceFor(service, op);
  const entry = {
    ts: nowISO(),
    project,
    projectName,
    service,
    op,
    amount: amount ?? price?.amount ?? 0,
    unit: unit ?? price?.unit ?? 'free',
    estimated,
    ref,
  };
  ensureDir(APP_DIR);
  fs.appendFileSync(LEDGER_FILE(), JSON.stringify(entry) + '\n');
  return entry;
}

export function listLedger({ limit = 300, key = null } = {}) {
  let lines = [];
  try {
    lines = fs.readFileSync(LEDGER_FILE(), 'utf8').trim().split('\n');
  } catch {
    return [];
  }
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (!key || e.project === key) out.push(e);
    } catch {}
  }
  return out;
}

export function getBudgets() {
  return readJSON(BUDGET_FILE(), { netlifyMinCredits: 50, warnAtPercent: 80 });
}

export function setBudgets(patch) {
  const b = { ...getBudgets(), ...patch };
  writeJSON(BUDGET_FILE(), b);
  return b;
}

// ---------------------------------------------------------------- provider usage

/** Walks an object and collects anything that looks like a quota: {included/limit, used}. */
function collectQuotas(obj, prefix = '', out = []) {
  if (!obj || typeof obj !== 'object' || out.length > 40) return out;
  const inc = obj.included ?? obj.limit ?? obj.quota ?? obj.total;
  const used = obj.used ?? obj.usage ?? obj.consumed;
  if (typeof inc === 'number' && typeof used === 'number') {
    out.push({ name: prefix || 'quota', included: inc, used, remaining: Math.max(0, inc - used), unit: obj.unit || null });
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) collectQuotas(v, prefix ? `${prefix}.${k}` : k, out);
    else if (/credit/i.test(k) && typeof v === 'number') out.push({ name: prefix ? `${prefix}.${k}` : k, value: v });
  }
  return out;
}

async function netlifyUsage() {
  const cli = which('netlify') ? { cmd: 'netlify', pre: [] } : which('npx') ? { cmd: 'npx', pre: ['--yes', 'netlify-cli'] } : null;
  if (!cli) return { service: 'netlify', connected: false, error: 'Няма Netlify CLI' };
  const r = await runStream(cli.cmd, [...cli.pre, 'api', 'listAccountsForUser'], { cwd: HOME, quiet: true, captureStdout: true, timeout: 120000 });
  const data = extractJSON(r.stdout);
  if (!Array.isArray(data)) return { service: 'netlify', connected: false, error: 'Не си влязъл в Netlify' };
  return {
    service: 'netlify',
    connected: true,
    accounts: data.map((a) => ({
      name: a.name,
      slug: a.slug,
      plan: a.type_name || a.type || null,
      billingPeriod: a.billing_period || null,
      quotas: collectQuotas(a.capabilities || {}, ''),
      credits: collectQuotas(a, '').filter((q) => /credit/i.test(q.name)),
      dashboard: `https://app.netlify.com/teams/${a.slug}/billing/usage`,
    })),
  };
}

export async function providerUsage({ refresh = false } = {}) {
  const cache = readJSON(USAGE_CACHE(), null);
  if (!refresh && cache && Date.now() - Date.parse(cache.at) < 10 * 60 * 1000) return cache;
  const netlify = await netlifyUsage().catch((e) => ({ service: 'netlify', connected: false, error: e.message }));
  const result = {
    at: nowISO(),
    providers: [
      netlify,
      {
        service: 'chatgpt',
        connected: null,
        note: 'ChatGPT няма публично API за лимита на абонамента.',
        dashboard: 'https://chatgpt.com/#settings',
      },
      {
        service: 'claude',
        connected: null,
        note: 'Claude няма публично API за лимита на абонамента.',
        dashboard: 'https://claude.ai/settings/usage',
      },
      {
        service: 'spaceship',
        connected: spaceshipConnected(),
        note: spaceshipConnected()
          ? 'Домейни и DNS — плащаш годишно при подновяване. Виж „Домейни“ за датите.'
          : 'Свържи Spaceship от „Домейни“, за да следиш изтичането на домейните.',
        dashboard: 'https://www.spaceship.com/application/billing/',
      },
    ],
  };
  writeJSON(USAGE_CACHE(), result);
  return result;
}

export async function costSummary({ refresh = false } = {}) {
  const ledger = listLedger({ limit: 500 });
  const month = new Date().toISOString().slice(0, 7);
  const totals = {};
  const byProject = {};
  for (const e of ledger) {
    if (!e.ts.startsWith(month)) continue;
    const k = `${e.service}|${e.unit}`;
    totals[k] = (totals[k] || 0) + (e.amount || 0);
    const pk = e.projectName || e.project || '—';
    byProject[pk] = byProject[pk] || {};
    byProject[pk][k] = (byProject[pk][k] || 0) + (e.amount || 0);
  }
  const counts = {};
  for (const e of ledger) if (e.ts.startsWith(month)) counts[e.op] = (counts[e.op] || 0) + 1;
  return {
    month,
    totals: Object.entries(totals).map(([k, v]) => {
      const [service, unit] = k.split('|');
      return { service, unit, amount: v };
    }),
    byProject: Object.entries(byProject).map(([name, t]) => ({
      name,
      items: Object.entries(t).map(([k, v]) => {
        const [service, unit] = k.split('|');
        return { service, unit, amount: v };
      }),
    })),
    counts,
    ledger: ledger.slice(0, 150),
    prices: getPrices(),
    budgets: getBudgets(),
    usage: await providerUsage({ refresh }),
    pricesFile: PRICES_FILE(),
  };
}
