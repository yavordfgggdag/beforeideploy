// Site Builder in the shared UI (S6): the shapes the engine's `bid new …` / `bid site …` commands return and the
// pure helpers the Create-site screen needs — the brief as the engine reads it (bid.site-brief/1), ranking the
// themes by the owner's words, inlining a rendered site for an <iframe>, and the message key for an engine
// error. No React, no i18n here, so these run under `node --test` as they are.

export interface Theme {
  id: string; title: string; description: string; pages: number; category: string; categoryTitle: string;
  icon: string; accent: string; featured: boolean; style: string; questions: string[];
  preview: string | null; art: string; keywords: string[]; sample: string;
}
export interface Palette { id: string; dark: boolean; bg: string; accent: string; accent2: string }
export interface Style { head: string; radius: number; palettes: Palette[] }
export type Styles = Record<string, Style>;
export interface Suggestion { id: string; score: number; title: string; description: string }

export interface Service { name: string; price: string; text: string }
export interface Brief {
  schema: 'bid.site-brief/1'; theme: string; lang: 'bg' | 'en'; name: string; description: string; offer: string; audience: string;
  services: Service[]; contacts: { email: string; phone: string; instagram: string; address: string; website: string };
  photos: { path: string; alt: string }[]; style: string | null; palette: string | null; scheme: 'auto' | 'light' | 'dark';
}
export const emptyBrief = (lang: 'bg' | 'en'): Brief => ({
  schema: 'bid.site-brief/1', theme: 'mentor', lang, name: '', description: '', offer: '', audience: '', services: [{ name: '', price: '', text: '' }],
  contacts: { email: '', phone: '', instagram: '', address: '', website: '' }, photos: [], style: null, palette: null, scheme: 'auto',
});

/** The JSON the engine reads (`--brief '{…}'`): empty service rows are left out, the name trimmed. */
export function briefJSON(b: Brief, { photos = true } = {}): string {
  return JSON.stringify({ ...b, name: b.name.trim(), services: b.services.filter((s) => s.name.trim()), photos: photos ? b.photos : [] });
}

/** `bid new content` / `generate` results. */
export interface ContentResult { contentFile: string; provider: string; model: string | null; usage: { input: number; output: number; charged?: number | null; model?: string | null }; styleSuggestion: string | null; pages: string[] }
export interface GenerateResult { project: { key: string; name: string; path: string }; path: string; theme: string; lang: string; style: string | null; palette: string | null; git: boolean; files: string[] }
export interface EditResult { applied: string[]; refused: string[]; summary: string; provider: string; usage: { charged?: number | null } | null; changed: string[]; removed: string[]; commit: string | null }
export interface SiteInfo { generated: boolean; theme?: string; scheme?: string; edits?: number; modified?: string[]; history?: { sha: string | null; say: string; at: string | null; kind: string }[] }

/**
 * The themes for the owner's words, best first — the same ranking the Mac app uses offline: a keyword hit
 * weighs three, a word in title/description one; stems match both ways. Empty words → the list unchanged.
 */
export function rankThemes(themes: Theme[], query: string): Theme[] {
  const words = query.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, '')).filter((w) => w.length > 1);
  if (!words.length) return themes;
  return themes
    .map((t) => {
      const hay = `${t.title} ${t.description} ${t.categoryTitle}`.toLowerCase();
      const keys = t.keywords.map((k) => k.toLowerCase());
      const score = words.reduce((n, w) => {
        const kw = keys.some((k) => k === w || (w.length > 3 && k.startsWith(w)) || (k.length > 3 && w.startsWith(k)));
        return n + (kw ? 3 : 0) + (hay.includes(w) ? 1 : 0);
      }, 0);
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t);
}

// UTF-8 → base64 in the browser and under node --test alike (no Buffer, no Node types)
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/**
 * One page of a rendered site (`bid new preview` files) as a self-contained document for an <iframe srcdoc>:
 * the stylesheet inlined, the illustrations as data URLs, internal links rewritten to `#page=<file>` so the
 * screen can show the page they point to. Photos are never in a preview (they are copied at save time).
 */
export function inlinePreview(files: Record<string, string>, page = 'index.html'): string {
  let html = files[page] ?? files['index.html'] ?? '';
  html = html.replace('<link rel="stylesheet" href="/styles.css">', `<style>${files['styles.css'] ?? ''}</style>`);
  for (const [name, svg] of Object.entries(files)) if (name.startsWith('art/') && name.endsWith('.svg')) html = html.split(`src="/${name}"`).join(`src="data:image/svg+xml;base64,${b64(svg)}"`);
  html = html.replace(/href="\/([a-z0-9-]*)(\.html)?(#[^"]*)?"/g, (_m, p: string, _ext: string, hash: string) => `href="#page=${p ? `${p}.html` : 'index.html'}${hash ?? ''}"`);
  return html;
}

/** `#page=about.html` from an iframe link, or null. */
export const pageFromHash = (hash: string): string | null => {
  const m = /^#page=([a-z0-9-]+\.html)/.exec(hash);
  return m ? m[1] : null;
};

/**
 * The i18n key that explains an engine error to the owner in plain words (no credits, no network, timeout …),
 * or null when the engine's own message is the best there is.
 */
export function errorKey(code: string | undefined): string | null {
  switch (code) {
    case 'quota_exhausted': return 'err.noCredits';
    case 'credits_release': case 'guard_24h': case 'guard_7d': case 'pack_rate': return 'err.creditsLater';
    case 'network': return 'err.network';
    case 'ai_timeout': case 'timeout': return 'err.timeout';
    case 'not_logged_in': return 'err.notLoggedIn';
    case 'ai_unavailable': return 'err.aiUnavailable';
    case 'ai_rate_limited': return 'err.rateLimited';
    case 'cloud_function_missing': case 'not_configured': return 'err.cloudMissing';
    case 'exists': return 'err.exists';
    case 'site_modified': return 'err.handEdited';
    case 'no_engine': return 'err.noEngine';
    default: return null;
  }
}

/** Credits for the whole creation (S3: 10 000–20 000 per site) and for one edit, shown before anything is spent. */
export const ESTIMATE = { create: { min: 10_000, max: 20_000 }, edit: { min: 1_000, max: 3_000 } };
