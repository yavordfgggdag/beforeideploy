// Smoke checks after a deploy (V11): the preview and the production site must answer, serve HTML with a
// title, stay on https, and the pages the project lists (bid.config.json → postdeploy.urls, plus the first
// entries of sitemap.xml) must all be 200. Pure Node http/https; every request has a timeout and follows at
// most 3 redirects, only inside the deploy's own host (or its www twin) — never to arbitrary hosts.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { nowISO, readJSON } from './util.mjs';

const MAX_REDIRECTS = 3;
const MAX_BODY = 512 * 1024;

function sameSite(a, b) {
  const strip = (h) => h.replace(/^www\./, '');
  return strip(a.hostname) === strip(b.hostname);
}

/** GET with timeout and bounded same-site redirects. Resolves { status, ms, body, finalUrl, error }. */
export function fetchPage(url, { timeoutMs = 8000, redirects = 0 } = {}) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return resolve({ status: 0, error: 'bad_url', ms: 0 });
    }
    if (!/^https?:$/.test(u.protocol)) return resolve({ status: 0, error: 'bad_scheme', ms: 0 });
    const lib = u.protocol === 'https:' ? https : http;
    const t0 = Date.now();
    const req = lib.request(u, { method: 'GET', timeout: timeoutMs, headers: { 'user-agent': 'BeforeIDeploy-smoke/11', accept: 'text/html,*/*' } }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        let next;
        try {
          next = new URL(res.headers.location, u);
        } catch {
          return resolve({ status: code, error: 'bad_redirect', ms: Date.now() - t0 });
        }
        if (redirects >= MAX_REDIRECTS) return resolve({ status: code, error: 'too_many_redirects', ms: Date.now() - t0 });
        if (!sameSite(u, next)) return resolve({ status: code, error: 'redirect_offsite', ms: Date.now() - t0, finalUrl: next.href });
        return fetchPage(next.href, { timeoutMs, redirects: redirects + 1 }).then((r) => resolve({ ...r, redirected: true }));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        if (body.length < MAX_BODY) body += c;
      });
      res.on('end', () => resolve({ status: code, ms: Date.now() - t0, body, finalUrl: u.href, contentType: res.headers['content-type'] || '' }));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, error: 'timeout', ms: Date.now() - t0 });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.code || e.message, ms: Date.now() - t0 }));
    req.end();
  });
}

function sitemapUrls(xml, base, max) {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) && out.length < max) {
    try {
      const u = new URL(m[1]);
      if (sameSite(u, base)) out.push(u.pathname + u.search);
    } catch {}
  }
  return out;
}

/** Paths a project wants verified after every deploy (bid.config.json → postdeploy.urls). */
export function configuredPaths(projectDir) {
  const cfg = readJSON(path.join(projectDir, 'bid.config.json'), null);
  const list = Array.isArray(cfg?.postdeploy?.urls) ? cfg.postdeploy.urls : [];
  return list.filter((p) => typeof p === 'string' && p.startsWith('/')).slice(0, 20);
}

/**
 * Runs the smoke checks against `baseUrl`. Returns { ok, url, at, checks: [{ url, ok, status, ms, reason }] }.
 * `ok` is true only when every page passed — a single broken page is a failed verification.
 */
export async function smokeTest(baseUrl, { paths = [], useSitemap = true, maxPages = 10, timeoutMs = 8000, requireHttps = null } = {}) {
  const base = new URL(baseUrl);
  const wantHttps = requireHttps ?? base.protocol === 'https:';
  const checks = [];
  const home = await fetchPage(base.href, { timeoutMs });
  const homeOk = home.status === 200 && /<title[\s>]/i.test(home.body || '') && (!wantHttps || /^https:/.test(home.finalUrl || base.href));
  checks.push({
    url: base.href,
    ok: homeOk,
    status: home.status,
    ms: home.ms,
    reason: home.error || (home.status !== 200 ? `http ${home.status}` : !/<title[\s>]/i.test(home.body || '') ? 'no_title' : wantHttps && !/^https:/.test(home.finalUrl || '') ? 'not_https' : null),
  });
  let pages = [...new Set(paths)];
  if (useSitemap && homeOk) {
    const sm = await fetchPage(new URL('/sitemap.xml', base).href, { timeoutMs });
    if (sm.status === 200 && /<urlset|<sitemapindex/.test(sm.body || '')) {
      for (const p of sitemapUrls(sm.body, base, maxPages)) if (!pages.includes(p) && p !== '/') pages.push(p);
    }
  }
  pages = pages.filter((p) => p !== '/').slice(0, maxPages);
  for (const p of pages) {
    const r = await fetchPage(new URL(p, base).href, { timeoutMs });
    checks.push({ url: new URL(p, base).href, ok: r.status === 200, status: r.status, ms: r.ms, reason: r.error || (r.status !== 200 ? `http ${r.status}` : null) });
  }
  return { ok: checks.every((c) => c.ok), url: base.href, at: nowISO(), checks, pages: checks.length };
}

/** Writes a smoke result next to the deploy logs so the app can open it. */
export function writeSmokeLog(file, result) {
  try {
    fs.writeFileSync(file, result.checks.map((c) => `${c.ok ? 'ok  ' : 'FAIL'} ${c.status}\t${c.ms}ms\t${c.url}${c.reason ? `\t${c.reason}` : ''}`).join('\n') + '\n');
  } catch {}
}
