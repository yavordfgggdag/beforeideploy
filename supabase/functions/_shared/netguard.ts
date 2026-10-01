// Before I Deploy — outbound network guard for cloud probes (V11 RC, server-side monitoring).
//
// A probe from the cloud worker may only reach PUBLIC hosts. This module makes that a property of the
// connection, not of a name check: the hostname is resolved, every address is validated against the
// private / loopback / link-local / metadata / reserved ranges (IPv4 and IPv6, including IPv4-mapped and
// NAT64 forms), and the TCP connection is opened to the VALIDATED ADDRESS — TLS still verifies the
// certificate for the hostname through SNI. A DNS answer that changes between the check and the connect
// (rebinding) therefore cannot redirect the worker: the socket never resolves the name again. Redirects
// are followed by re-running the whole procedure for the new location; no credentials are ever sent.
//
// `allowPrivate` exists for the local-only development mode (`deno test`, `supabase functions serve` on a
// laptop). index.ts never sets it; a deployed worker cannot be switched into it by a request.

export interface ProbeOptions {
  audit?: boolean;
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxRedirects?: number;
  maxBodyBytes?: number;
  /** DNS resolver (injected in tests). Default: Deno.resolveDns A + AAAA. */
  resolve?: (host: string) => Promise<string[]>;
  /** TCP connect to a validated address (injected in tests). */
  connect?: (ip: string, port: number, tls: boolean, sni: string) => Promise<Deno.Conn>;
  /** Local-only mode: loopback and private ranges are reachable. NEVER true in the deployed worker. */
  allowPrivate?: boolean;
  userAgent?: string;
}

export interface ProbeResult {
  ok: boolean;
  url: string;
  finalUrl: string;
  status: number | null;
  ms: number;
  reason: string | null;
  ip: string | null;
  redirects: number;
  title: string | null;
  tlsExpiresAt: string | null;
  bytes: number;
  audit?: { description: boolean; language: boolean; canonical: boolean; h1: boolean; missingAlt: number; links: string[]; securityHeaders: string[]; truncated: boolean };
}

// ---------------------------------------------------------------- address classification

/** Parses a textual IPv4 address to its 32-bit value, or null. */
export function ipv4ToInt(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inV4Range(ip: number, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/");
  const bits = Number(bitsText);
  const b = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((b & mask) >>> 0);
}

/** Everything that is not globally routable or not a host we may probe. */
const V4_BLOCKED = [
  "0.0.0.0/8", // "this" network
  "10.0.0.0/8",
  "100.64.0.0/10", // carrier-grade NAT
  "127.0.0.0/8",
  "169.254.0.0/16", // link-local incl. cloud metadata 169.254.169.254
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24", // TEST-NET-1
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved + broadcast
];

/** Expands an IPv6 textual address to 8 words, or null when it is not valid. Handles `::`, embedded IPv4 and zone ids. */
export function ipv6ToWords(s: string): number[] | null {
  let text = s.trim();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (!/^[0-9a-fA-F:.]+$/.test(text)) return null;
  // embedded IPv4 at the tail (::ffff:1.2.3.4)
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".")) {
    const v4 = ipv4ToInt(text.slice(lastColon + 1));
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon)}:${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (head.length + tail.length > 8) return null;
  const fill = halves.length === 2 ? new Array(8 - head.length - tail.length).fill("0") : [];
  const words = [...head, ...fill, ...tail].map((w) => (w.length > 4 ? NaN : parseInt(w, 16)));
  if (words.length !== 8 || words.some((w) => Number.isNaN(w))) return null;
  return words;
}

function v6Prefix(words: number[], prefix: number[], bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const w = i >> 4;
    const bit = 15 - (i & 15);
    if (((words[w] >> bit) & 1) !== ((prefix[w] >> bit) & 1)) return false;
  }
  return true;
}

const V6_BLOCKED: [string, number][] = [
  ["::/128", 128], // unspecified
  ["::1/128", 128], // loopback
  ["fc00::/7", 7], // unique local
  ["fe80::/10", 10], // link-local
  ["fec0::/10", 10], // site-local (deprecated)
  ["ff00::/8", 8], // multicast
  ["2001:db8::/32", 32], // documentation
  ["100::/64", 64], // discard
  ["2001::/32", 32], // Teredo (peer address embedded)
  ["2002::/16", 16], // 6to4 (embeds IPv4; refuse rather than decode)
];

/**
 * True when an address may be probed from the cloud: public, unicast, not a translation of a private
 * IPv4 (::ffff:a.b.c.d, 64:ff9b::a.b.c.d) and not a reserved range.
 */
export function isPublicAddress(ip: string): boolean {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) return !V4_BLOCKED.some((c) => inV4Range(v4, c));
  const words = ipv6ToWords(ip);
  if (!words) return false;
  // IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96): judge the embedded IPv4
  const mapped = words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff;
  const nat64 = words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((w) => w === 0);
  if (mapped || nat64) {
    const embedded = ((words[6] << 16) >>> 0) + words[7];
    return !V4_BLOCKED.some((c) => inV4Range(embedded, c));
  }
  for (const [cidr, bits] of V6_BLOCKED) {
    const prefix = ipv6ToWords(cidr.split("/")[0])!;
    if (v6Prefix(words, prefix, bits)) return false;
  }
  // only 2000::/3 is global unicast today
  return (words[0] & 0xe000) === 0x2000;
}

/** URL policy for a monitoring target: http(s), a hostname (never an IP literal or localhost), default ports. */
export function validateTargetUrl(text: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials_in_url" };
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, reason: "local_host" };
  if (ipv4ToInt(host) !== null || host.startsWith("[") || ipv6ToWords(host)) return { ok: false, reason: "ip_literal" };
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) return { ok: false, reason: "hostname" };
  if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, reason: "port" };
  return { ok: true, url };
}

// ---------------------------------------------------------------- pinned HTTP/1.1 client

async function defaultResolve(host: string): Promise<string[]> {
  const out: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    try {
      out.push(...(await Deno.resolveDns(host, type)));
    } catch {
      // one family may be absent
    }
  }
  return out;
}

async function defaultConnect(ip: string, port: number, tls: boolean, sni: string): Promise<Deno.Conn> {
  const tcp = await Deno.connect({ hostname: ip, port });
  if (!tls) return tcp;
  // certificate is verified for the hostname (SNI), the packets go to the pinned address
  return await Deno.startTls(tcp, { hostname: sni });
}

const DEFAULTS = { method: "GET" as const, timeoutMs: 5000, maxRedirects: 3, maxBodyBytes: 256 * 1024, userAgent: "BeforeIDeploy-Monitor/1 (+https://beforeideploy.app)" };

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(Object.assign(new Error("timeout"), { reason: "timeout" }));
    }, ms);
    p.then((v) => {
      clearTimeout(timer);
      resolve(v);
    }, (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  bytes: number;
}

/** One HTTP/1.1 exchange over a pinned connection; reads until close or the body cap. */
async function exchange(conn: Deno.Conn, url: URL, method: string, userAgent: string, maxBody: number): Promise<RawResponse> {
  const path = url.pathname + url.search;
  const req = `${method} ${path || "/"} HTTP/1.1\r\nHost: ${url.host}\r\nUser-Agent: ${userAgent}\r\nAccept: text/html,*/*;q=0.5\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n`;
  await conn.write(new TextEncoder().encode(req));
  const chunks: Uint8Array[] = [];
  let total = 0;
  const buf = new Uint8Array(16 * 1024);
  while (total < maxBody + 64 * 1024) {
    const n = await conn.read(buf);
    if (n === null) break;
    chunks.push(buf.slice(0, n));
    total += n;
    if (method === "HEAD" && total > 0 && new TextDecoder().decode(concat(chunks)).includes("\r\n\r\n")) break;
  }
  const all = concat(chunks);
  const text = new TextDecoder("latin1").decode(all);
  const sep = text.indexOf("\r\n\r\n");
  const headText = sep >= 0 ? text.slice(0, sep) : text;
  const lines = headText.split("\r\n");
  const m = /^HTTP\/1\.[01] (\d{3})/.exec(lines[0] || "");
  if (!m) throw Object.assign(new Error("bad response"), { reason: "bad_response" });
  const headers: Record<string, string> = {};
  for (const l of lines.slice(1)) {
    const i = l.indexOf(":");
    if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  let body = sep >= 0 ? all.subarray(sep + 4) : new Uint8Array();
  if ((headers["transfer-encoding"] || "").toLowerCase().includes("chunked")) body = dechunk(body);
  return { status: Number(m[1]), headers, body: body.subarray(0, maxBody), bytes: Math.min(body.length, maxBody) };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function dechunk(body: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 0;
  const text = new TextDecoder("latin1").decode(body);
  while (i < body.length) {
    const lineEnd = text.indexOf("\r\n", i);
    if (lineEnd < 0) break;
    const size = parseInt(text.slice(i, lineEnd).split(";")[0], 16);
    if (!Number.isFinite(size) || size === 0) break;
    parts.push(body.subarray(lineEnd + 2, lineEnd + 2 + size));
    i = lineEnd + 2 + size + 2;
  }
  return concat(parts);
}

/**
 * Fetches `url` with the pinned client. Never throws for a target problem — the result says why.
 */
export async function probe(target: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const o = { ...DEFAULTS, ...opts };
  const resolve = o.resolve ?? defaultResolve;
  const connect = o.connect ?? defaultConnect;
  const started = Date.now();
  const base: ProbeResult = { ok: false, url: target, finalUrl: target, status: null, ms: 0, reason: null, ip: null, redirects: 0, title: null, tlsExpiresAt: null, bytes: 0 };
  const done = (patch: Partial<ProbeResult>): ProbeResult => ({ ...base, ...patch, ms: Date.now() - started });

  let current = target;
  const origin = (() => {
    try {
      return new URL(target).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    const v = validateTargetUrl(current);
    if (!v.ok) return done({ finalUrl: current, reason: v.reason, redirects: hop });
    const url = v.url;
    const host = url.hostname.toLowerCase();
    // redirects only inside the same site (or its www. twin) — a probe never follows a site elsewhere
    if (host.replace(/^www\./, "") !== origin) return done({ finalUrl: current, reason: "redirect_offsite", redirects: hop });

    let addresses: string[];
    try {
      addresses = await withTimeout(resolve(host), o.timeoutMs, () => {});
    } catch {
      return done({ finalUrl: current, reason: "dns", redirects: hop });
    }
    if (!addresses.length) return done({ finalUrl: current, reason: "dns", redirects: hop });
    const bad = addresses.find((a) => !isPublicAddress(a));
    if (bad && !o.allowPrivate) return done({ finalUrl: current, reason: "private_address", ip: bad, redirects: hop });
    const ip = addresses[0];
    const tls = url.protocol === "https:";
    const port = url.port ? Number(url.port) : tls ? 443 : 80;

    let conn: Deno.Conn | null = null;
    try {
      conn = await withTimeout(connect(ip, port, tls, host), o.timeoutMs, () => {});
      const res = await withTimeout(exchange(conn, url, o.method, o.userAgent, o.maxBodyBytes), o.timeoutMs, () => conn?.close());
      let tlsExpiresAt: string | null = null;
      const tlsConn = conn as unknown as { handshake?: () => Promise<{ peerCertificate?: { validTo?: string } }> };
      if (tls && typeof tlsConn.handshake === "function") {
        try {
          const hs = await tlsConn.handshake();
          tlsExpiresAt = hs?.peerCertificate?.validTo ?? null;
        } catch {
          // older runtimes do not expose the certificate
        }
      }
      try {
        conn.close();
      } catch {
        // already closed
      }
      conn = null;
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        current = new URL(res.headers.location, url).toString();
        continue;
      }
      const html = new TextDecoder().decode(res.body);
      const title = /<title[^>]*>([^<]{0,300})<\/title>/i.exec(html)?.[1]?.trim() ?? null;
      const ok = res.status >= 200 && res.status < 300;
      const audit = o.audit ? auditMarkup(html,url,res.headers,res.bytes>=o.maxBodyBytes) : undefined;
      return done({ ok, finalUrl: current, status: res.status, ip, redirects: hop, title, tlsExpiresAt, bytes: res.bytes, reason: ok ? null : `http_${res.status}`, ...(audit ? {audit} : {}) });
    } catch (e) {
      try {
        conn?.close();
      } catch {
        // ignore
      }
      const reason = (e as { reason?: string })?.reason ?? ((e as Error)?.message?.includes("certificate") ? "tls" : "connect");
      return done({ finalUrl: current, reason, ip, redirects: hop });
    }
  }
  return done({ finalUrl: current, reason: "too_many_redirects", redirects: o.maxRedirects + 1 });
}

/** Bounded metadata only: HTML and cookies never enter a saved report. Links drop query/fragment. */
export function auditMarkup(html:string,url:URL,headers:Record<string,string>,truncated:boolean):NonNullable<ProbeResult["audit"]> {
 const attr=(tag:string,name:string)=>new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`,"i").exec(tag)?.[1] ?? "";
 const tags=(name:string)=>html.match(new RegExp(`<${name}\\b[^>]*>`,"gi")) ?? [];
 const links:string[]=[];
 for(const tag of tags("a")) {
  try {const link=new URL(attr(tag,"href"),url); if(link.origin!==url.origin || link.username || link.password)continue;link.search="";link.hash="";if(!links.includes(link.href)&&link.href!==url.href)links.push(link.href);if(links.length===6)break;}catch{}
 }
 return {description:tags("meta").some(t=>attr(t,"name").toLowerCase()==="description"&&attr(t,"content").trim().length>0),language:tags("html").some(t=>!!attr(t,"lang")),canonical:tags("link").some(t=>attr(t,"rel").toLowerCase()==="canonical"&&!!attr(t,"href")),h1:/<h1\b/i.test(html),missingAlt:tags("img").filter(t=>! /\balt\s*=/i.test(t)).length,links,securityHeaders:["strict-transport-security","content-security-policy","x-content-type-options"].filter(name=>!!headers[name]),truncated};
}
