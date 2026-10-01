import bg from './bg.json';
import en from './en.json';

export type Lang = 'bg' | 'en';
const tables: Record<Lang, Record<string, string>> = { bg, en };
let current: Lang = (() => {
  try { const s = localStorage.getItem('bid.lang'); if (s === 'bg' || s === 'en') return s; } catch { /* storage unavailable */ }
  return 'en'; // English first (global launch); Bulgarian is one click away
})();

export const getLang = () => current;
export function setLang(l: Lang) { current = l; try { localStorage.setItem('bid.lang', l); } catch { /* ignore */ } document.documentElement.lang = l; }

/** t('key', {name: 'x'}) — {name} placeholders. Missing keys show the key so the i18n check catches them. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const s = tables[current][key] ?? tables.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

const nf = () => new Intl.NumberFormat(current === 'bg' ? 'bg-BG' : 'en-GB');
export const num = (n: number) => nf().format(n);
export const money = (n: number) => new Intl.NumberFormat(current === 'bg' ? 'bg-BG' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(n);
export const time = (ms: number) => new Intl.DateTimeFormat(current === 'bg' ? 'bg-BG' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
