// Cost Center — price table, local ledger, provider usage (real where the API allows it), budgets
import fs from 'node:fs';
import path from 'node:path';
import { spaceshipConnected } from './spaceship.mjs';
import { APP_DIR, readJSON, writeJSON, ensureDir, nowISO, which, runStream, extractJSON, HOME, appendBounded } from './util.mjs';
import { t, isDefaultText } from './i18n.mjs';

const PRICES_FILE = () => path.join(APP_DIR, 'prices.json');
const LEDGER_FILE = () => path.join(APP_DIR, 'ledger.jsonl');
const USAGE_CACHE = () => path.join(APP_DIR, 'usage-cache.json');
const BUDGET_FILE = () => path.join(APP_DIR, 'budgets.json');

// Editable estimates. Real provider numbers (when available) always win in the UI.
export const DEFAULT_PRICES = {
  version: 1,
  note: t('costs.prices.note'),
  items: {
    'netlify:production': { unit: 'credits', amount: 15, label: t('costs.price.netlifyProduction') },
    'netlify:draft': { unit: 'credits', amount: 0, label: t('costs.price.netlifyDraft') },
    'netlify:bandwidth-gb': { unit: 'credits', amount: 10, label: t('costs.price.netlifyBandwidth') },
    'chatgpt:aifix': { unit: 'messages', amount: 1, label: t('costs.price.chatgptAifix') },
    'claude:aifix': { unit: 'messages', amount: 1, label: t('costs.price.claudeAifix') },
    'codex:aifix': { unit: 'tasks', amount: 1, label: t('costs.price.codexAifix') },
    'github:push': { unit: 'free', amount: 0, label: t('costs.price.githubPush') },
    'vercel:production': { unit: 'free', amount: 0, label: t('costs.price.vercelProduction') },
    'vercel:draft': { unit: 'free', amount: 0, label: t('costs.price.vercelDraft') },
    'cloudflare:production': { unit: 'free', amount: 0, label: t('costs.price.cloudflareProduction') },
    'cloudflare:draft': { unit: 'free', amount: 0, label: t('costs.price.cloudflareDraft') },
    'ghpages:production': { unit: 'free', amount: 0, label: t('costs.price.ghpagesProduction') },
    'local:check': { unit: 'free', amount: 0, label: t('costs.price.localCheck') },
  },
};

// prices.json keeps the labels in the language it was created in; untouched defaults follow BID_LANG
const PRICE_LABEL_KEYS = {
  'netlify:production': 'costs.price.netlifyProduction',
  'netlify:draft': 'costs.price.netlifyDraft',
  'netlify:bandwidth-gb': 'costs.price.netlifyBandwidth',
  'chatgpt:aifix': 'costs.price.chatgptAifix',
  'claude:aifix': 'costs.price.claudeAifix',
  'codex:aifix': 'costs.price.codexAifix',
  'github:push': 'costs.price.githubPush',
  'vercel:production': 'costs.price.vercelProduction',
  'vercel:draft': 'costs.price.vercelDraft',
  'cloudflare:production': 'costs.price.cloudflareProduction',
  'cloudflare:draft': 'costs.price.cloudflareDraft',
  'ghpages:production': 'costs.price.ghpagesProduction',
  'local:check': 'costs.price.localCheck',
};

function localizePrices(p) {
  const items = {};
  for (const [id, item] of Object.entries(p.items)) {
    const key = PRICE_LABEL_KEYS[id];
    items[id] = key && isDefaultText(key, item.label) ? { ...item, label: t(key) } : item;
  }
  return { ...p, note: isDefaultText('costs.prices.note', p.note) ? t('costs.prices.note') : p.note, items };
}

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
  return localizePrices(p);
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
  appendBounded(LEDGER_FILE(), JSON.stringify(entry), { maxBytes: 4 * 1024 * 1024, keepLines: 20000 });
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
// Netlify's capability names are API field paths (capabilities.credits, swar_auto_topup_credits …): the
// known ones get a readable label, the rest lose the path and underscores (never shown raw).
const QUOTA_LABELS = [
  [/(^|\.)plan_credits$/, 'costs.quota.planCredits'],
  [/auto_topup_credits$/, 'costs.quota.autoTopup'],
  [/(^|\.)credits$/, 'costs.quota.credits'],
  [/dev_server_cpu_cores$/, 'costs.quota.devCpu'],
  [/dev_server_memory_gb$/, 'costs.quota.devMemory'],
  [/dev_servers$/, 'costs.quota.devServers'],
  [/bandwidth/, 'costs.quota.bandwidth'],
  [/build_minutes|build-minutes/, 'costs.quota.buildMinutes'],
  [/sites$/, 'costs.quota.sites'],
  [/members$/, 'costs.quota.members'],
];
const QUOTA_TEXT = { 'costs.quota.planCredits': () => t('costs.quota.planCredits'), 'costs.quota.autoTopup': () => t('costs.quota.autoTopup'), 'costs.quota.credits': () => t('costs.quota.credits'), 'costs.quota.devCpu': () => t('costs.quota.devCpu'), 'costs.quota.devMemory': () => t('costs.quota.devMemory'), 'costs.quota.devServers': () => t('costs.quota.devServers'), 'costs.quota.bandwidth': () => t('costs.quota.bandwidth'), 'costs.quota.buildMinutes': () => t('costs.quota.buildMinutes'), 'costs.quota.sites': () => t('costs.quota.sites'), 'costs.quota.members': () => t('costs.quota.members') };
export function quotaLabel(name) {
  const hit = QUOTA_LABELS.find(([re]) => re.test(name));
  if (hit) return QUOTA_TEXT[hit[1]]();
  const last = String(name).split('.').pop().replace(/[_-]+/g, ' ').trim();
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function collectQuotas(obj, prefix = '', out = []) {
  if (!obj || typeof obj !== 'object' || out.length > 40) return out;
  const inc = obj.included ?? obj.limit ?? obj.quota ?? obj.total;
  const used = obj.used ?? obj.usage ?? obj.consumed;
  if (typeof inc === 'number' && typeof used === 'number') {
    out.push({ name: prefix || 'quota', label: quotaLabel(prefix || 'quota'), included: inc, used, remaining: Math.max(0, inc - used), unit: obj.unit || null });
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) collectQuotas(v, prefix ? `${prefix}.${k}` : k, out);
    else if (/credit/i.test(k) && typeof v === 'number') out.push({ name: prefix ? `${prefix}.${k}` : k, label: quotaLabel(prefix ? `${prefix}.${k}` : k), value: v });
  }
  return out;
}

async function netlifyUsage() {
  const cli = which('netlify') ? { cmd: 'netlify', pre: [] } : null; // installed CLI only (audit E10)
  if (!cli) return { service: 'netlify', connected: false, error: t('costs.netlify.noCli'), errorKey: 'costs.netlify.noCli' };
  const r = await runStream(cli.cmd, [...cli.pre, 'api', 'listAccountsForUser'], { cwd: HOME, quiet: true, captureStdout: true, timeout: 120000 });
  const data = extractJSON(r.stdout);
  if (!Array.isArray(data)) return { service: 'netlify', connected: false, error: t('costs.netlify.notLoggedIn'), errorKey: 'costs.netlify.notLoggedIn' };
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
  // only the Netlify answer is cached; the notes are rebuilt so they follow BID_LANG
  const cache = readJSON(USAGE_CACHE(), null);
  const cached = cache?.providers?.find((p) => p.service === 'netlify');
  let at = cache?.at;
  let netlify = cached;
  if (refresh || !cached || !at || Date.now() - Date.parse(at) >= 10 * 60 * 1000) {
    netlify = await netlifyUsage().catch((e) => ({ service: 'netlify', connected: false, error: e.message }));
    at = nowISO();
    writeJSON(USAGE_CACHE(), { at, providers: [netlify] });
  }
  if (netlify.errorKey) netlify = { ...netlify, error: t(netlify.errorKey) };
  return {
    at,
    providers: [
      netlify,
      {
        service: 'chatgpt',
        connected: null,
        note: t('costs.chatgpt.note'),
        dashboard: 'https://chatgpt.com/#settings',
      },
      {
        service: 'claude',
        connected: null,
        note: t('costs.claude.note'),
        dashboard: 'https://claude.ai/settings/usage',
      },
      {
        service: 'spaceship',
        connected: spaceshipConnected(),
        note: spaceshipConnected()
          ? t('costs.spaceship.connected')
          : t('costs.spaceship.notConnected'),
        dashboard: 'https://www.spaceship.com/application/billing/',
      },
    ],
  };
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
    byProject: Object.entries(byProject).map(([name, sums]) => ({
      name,
      items: Object.entries(sums).map(([k, v]) => {
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
