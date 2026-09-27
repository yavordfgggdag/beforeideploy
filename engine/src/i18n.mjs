// Engine message catalog. Texts live in engine/i18n/<lang>.json as flat "module.key" entries with
// {name} placeholders. The language comes from BID_LANG (the app passes it); missing keys fall back to en.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FALLBACK_LANG = 'en';
export const I18N_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'i18n');

const catalogs = new Map();

export function loadCatalog(lang) {
  if (!catalogs.has(lang)) {
    let data = null;
    if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) {
      try {
        data = JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${lang}.json`), 'utf8'));
      } catch {}
    }
    catalogs.set(lang, data);
  }
  return catalogs.get(lang);
}

/** Active language: BID_LANG ("bg", "pt-BR", "bg_BG.UTF-8" …) resolved to an existing catalog, else en. */
export function currentLang() {
  const raw = String(process.env.BID_LANG || '').trim().replace(/\..*$/, '').replace(/_/g, '-');
  if (!raw) return FALLBACK_LANG;
  const parts = raw.split('-');
  for (let n = parts.length; n > 0; n--) {
    const candidate = parts.slice(0, n).join('-');
    if (loadCatalog(candidate)) return candidate;
  }
  return FALLBACK_LANG;
}

function interpolate(text, params) {
  return text.replace(/\{(\w+)\}/g, (m, name) => (params && params[name] !== undefined && params[name] !== null ? String(params[name]) : m));
}

/** Translates `key` into the active language; returns the key itself if no catalog has it. */
export function t(key, params) {
  const lang = currentLang();
  const text = loadCatalog(lang)?.[key] ?? loadCatalog(FALLBACK_LANG)?.[key];
  return typeof text === 'string' ? interpolate(text, params) : key;
}

const MSG = Symbol('bid.msg');

/** A translatable message: `new EngineError(msg('git.notRepo'), 'no_repo')` keeps the key in the result. */
export function msg(key, params) {
  return { [MSG]: true, key, params: params || null };
}

export function isMsg(v) {
  return Boolean(v && typeof v === 'object' && v[MSG]);
}
