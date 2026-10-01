// Demo data for the prototype and for screenshots (no network). The real app reads the same shapes from the engine/cloud.
import { HOUR } from '../lib/credits';

export type SiteStatus = 'ready' | 'warnings' | 'blocked' | 'down' | 'draft';
export interface Issue { id: string; severity: 'blocker' | 'high' | 'medium' | 'low'; title: string; detail: string; fix: 'auto' | 'ai' | 'manual' }
export interface Site {
  id: string; name: string; url: string | null; status: SiteStatus; provider: 'netlify' | 'cloudflare' | 'vercel' | 'ghpages' | null;
  hosting: 'connected' | 'included' | null; domain: string | null; sslDays: number | null; uptime: number | null;
  lastCheck: number; lastDeploy: number | null; lastBackup: number | null; issues: Issue[]; framework: string;
}

const now = Date.now();
export const SITES: Site[] = [
  { id: 'iva', name: 'Фризьорски салон Ива', url: 'https://salon-iva.bg', status: 'down', provider: 'netlify', hosting: 'included', domain: 'salon-iva.bg', sslDays: 64, uptime: 98.7,
    lastCheck: now - 12 * 60_000, lastDeploy: now - 2 * 24 * HOUR, lastBackup: now - 2 * 24 * HOUR, framework: 'Статичен сайт',
    issues: [{ id: 'i1', severity: 'blocker', title: 'Сайтът не отговаря (503) от 6 минути', detail: 'Две последователни проверки от облака върнаха 503.', fix: 'manual' }] },
  { id: 'north', name: 'Studio North', url: 'https://studio-north.eu', status: 'warnings', provider: 'netlify', hosting: 'connected', domain: 'studio-north.eu', sslDays: 12, uptime: 100,
    lastCheck: now - 3 * HOUR, lastDeploy: now - 9 * 24 * HOUR, lastBackup: now - 9 * 24 * HOUR, framework: 'Astro',
    issues: [
      { id: 'n1', severity: 'high', title: 'Сертификатът изтича след 12 дни', detail: 'Подновяването при доставчика не е потвърдено.', fix: 'manual' },
      { id: 'n2', severity: 'medium', title: '3 страници нямат описание', detail: 'about, work, contact', fix: 'ai' },
      { id: 'n3', severity: 'low', title: 'Изображение над 500 KB', detail: 'hero.jpg — 1,4 MB', fix: 'auto' },
    ] },
  { id: 'bistro', name: 'Бистро Лозенец', url: 'https://bistro-lozenets.netlify.app', status: 'ready', provider: 'netlify', hosting: 'included', domain: null, sslDays: 80, uptime: 100,
    lastCheck: now - 26 * 60_000, lastDeploy: now - 26 * 60_000, lastBackup: now - 26 * 60_000, framework: 'Създаден с Before I Deploy', issues: [] },
  { id: 'shop', name: 'Ателие Лен — витрина', url: null, status: 'draft', provider: null, hosting: null, domain: null, sslDays: null, uptime: null,
    lastCheck: now - 2 * HOUR, lastDeploy: null, lastBackup: null, framework: 'Чернова (Създай сайт)', issues: [] },
];

export interface ActivityItem { at: number; site: string; kind: 'deploy' | 'check' | 'incident' | 'ai' | 'backup' | 'billing'; text: string; credits?: number }
export const ACTIVITY: ActivityItem[] = [
  { at: now - 6 * 60_000, site: 'Фризьорски салон Ива', kind: 'incident', text: 'Открит е срив (503). Известие изпратено по имейл и Pushover.' },
  { at: now - 26 * 60_000, site: 'Бистро Лозенец', kind: 'deploy', text: 'Публикувано на живо · проверено след публикуване ✓' },
  { at: now - 40 * 60_000, site: 'Бистро Лозенец', kind: 'ai', text: 'AI поправка: описания на 4 страници', credits: 1_240 },
  { at: now - 3 * HOUR, site: 'Studio North', kind: 'check', text: 'Проверка: 0 блокиращи, 3 предупреждения' },
  { at: now - 26 * HOUR, site: 'Бистро Лозенец', kind: 'backup', text: 'Архив #18 · 2,1 MB · SHA-256 записан' },
  { at: now - 30 * HOUR, site: '—', kind: 'billing', text: 'Купен пакет 100 000 кредита (тестово плащане)' },
];

/** Catalog V3 (docs/PLAN-UNIFIED-BG.md §11.9) — demo copy; the app reads the canonical catalog from the cloud. */
export const CATALOG = {
  plans: [
    { id: 'free', price: 0, yearly: null, credits: 10_000, sites: 1, netlify: 'Free · 300' },
    { id: 'flash', price: 14.99, yearly: 183.9, credits: 40_000, sites: 1, netlify: 'Personal · 1 000' },
    { id: 'high', price: 29.99, yearly: 358.9, credits: 100_000, sites: 3, netlify: 'Pro · 3 000' },
    { id: 'knight', price: 99.99, yearly: 1089.9, credits: 800_000, sites: 10, netlify: 'Pro · 5 000' },
  ],
  packs: [{ credits: 100_000, price: 4.99 }, { credits: 500_000, price: 19.99 }, { credits: 1_000_000, price: 39.99 }],
  starterBonus: 60_000,
};

export const ACCOUNT = {
  plan: 'high' as const, periodStart: now - 5 * 24 * HOUR - 3 * HOUR, renewsAt: now + 25 * 24 * HOUR,
  spends: [
    { at: now - 4 * 24 * HOUR, credits: 9_400, source: 'included' as const },
    { at: now - 2 * 24 * HOUR, credits: 6_100, source: 'included' as const },
    { at: now - 40 * 60_000, credits: 1_240, source: 'included' as const },
  ],
  carried: [{ credits: 22_000, expires: now + 50 * 24 * HOUR }], bonus: 0, packs: 100_000, cloudMinutes: { used: 212, total: 1_000 },
};
