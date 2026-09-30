// deno test supabase/functions   (no external network: the probed "site" is a local server; the cloud
// guard is tested with an injected resolver so private ranges are provably refused)
import assert from "node:assert/strict";
import { FakeDb, fakeDeps, post } from "../_shared/fake_supabase.ts";
import { isPublicAddress, ipv6ToWords, probe, validateTargetUrl } from "../_shared/netguard.ts";
import { createMonitorHandler, LIMITS } from "./handler.ts";

const ME = { id: "u-me", email: "me@example.com" };
const OTHER = { id: "u-other", email: "o@example.com" };

// ---------------------------------------------------------------- address classification

Deno.test("netguard: private, loopback, link-local, metadata and mapped addresses are not public", () => {
  const blocked = ["127.0.0.1", "10.1.2.3", "172.16.0.9", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255", "198.18.0.5", "192.0.2.1", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "64:ff9b::10.0.0.1", "ff02::1", "2001:db8::1", "2002:c0a8:101::1"];
  for (const ip of blocked) assert.equal(isPublicAddress(ip), false, ip);
  const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::6810:84e5", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8", "64:ff9b::808:808"];
  for (const ip of allowed) assert.equal(isPublicAddress(ip), true, ip);
  assert.equal(isPublicAddress("not-an-ip"), false);
  assert.equal(isPublicAddress("172.32.0.1"), true, "172.32/12 is public");
  assert.deepEqual(ipv6ToWords("::ffff:1.2.3.4"), [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
  assert.equal(ipv6ToWords("1::2::3"), null);
});

Deno.test("netguard: target URL policy — https/http, hostname only, no IP literal, no localhost, no credentials, default ports", () => {
  assert.equal(validateTargetUrl("https://example.com/").ok, true);
  assert.equal(validateTargetUrl("http://shop.example.com/health").ok, true);
  for (const [u, reason] of [
    ["ftp://example.com", "scheme"],
    ["https://127.0.0.1/", "ip_literal"],
    ["https://[::1]/", "ip_literal"],
    ["https://localhost/", "local_host"],
    ["https://box.local/", "local_host"],
    ["https://db.internal/", "local_host"],
    ["https://user:pw@example.com/", "credentials_in_url"],
    ["https://example.com:8443/", "port"],
    ["https://intranet/", "hostname"],
    ["nope", "invalid_url"],
  ] as [string, string][]) {
    const v = validateTargetUrl(u);
    assert.equal(v.ok, false, u);
    if (!v.ok) assert.equal(v.reason, reason, u);
  }
});

// ---------------------------------------------------------------- pinned probe against a local server

async function localSite(handler: (req: Request) => Response | Promise<Response>) {
  const ac = new AbortController();
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: ac.signal, onListen: () => {} }, handler);
  const port = (server.addr as Deno.NetAddr).port;
  return { port, close: async () => {
    ac.abort();
    await server.finished;
  } };
}

/** Resolver + connector that pretend the site's name resolves to the local server (the guard sees 127.0.0.1). */
function localDeps(port: number, opts: { publicName?: boolean } = {}) {
  const connected: string[] = [];
  return {
    connected,
    resolve: (_host: string) => Promise.resolve([opts.publicName ? "93.184.216.34" : "127.0.0.1"]),
    connect: async (ip: string, _port: number, _tls: boolean, _sni: string) => {
      connected.push(ip);
      return await Deno.connect({ hostname: "127.0.0.1", port });
    },
  };
}

Deno.test("netguard: the connection goes to the resolved address, redirects stay on-site and are re-validated, bodies are capped", async () => {
  const site = await localSite((req) => {
    const u = new URL(req.url);
    if (u.pathname === "/") return new Response("<html><title>Home &amp; ok</title>" + "x".repeat(400 * 1024), { headers: { "content-type": "text/html" } });
    if (u.pathname === "/old") return new Response(null, { status: 301, headers: { location: "/" } });
    if (u.pathname === "/away") return new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
    if (u.pathname === "/loop") return new Response(null, { status: 302, headers: { location: "/loop" } });
    if (u.pathname === "/chunked") {
      const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("<title>chunk</title>")); c.close(); } });
      return new Response(body, { headers: { "content-type": "text/html" } });
    }
    return new Response("nope", { status: 404 });
  });
  try {
    const d = localDeps(site.port, { publicName: true });
    const home = await probe("http://www.example.com/", { ...d, timeoutMs: 3000 });
    assert.equal(home.ok, true);
    assert.equal(home.status, 200);
    assert.equal(home.title, "Home &amp; ok");
    assert.equal(home.ip, "93.184.216.34", "the guard's verdict is about the resolved address");
    assert.deepEqual(d.connected, ["93.184.216.34"], "the socket is opened to the validated address, never by name");
    assert.ok(home.bytes <= 256 * 1024, "body is capped at 256 KB");

    const moved = await probe("http://example.com/old", { ...d });
    assert.equal(moved.ok, true);
    assert.equal(moved.redirects, 1);
    assert.equal(moved.finalUrl, "http://example.com/");

    const away = await probe("http://example.com/away", { ...d });
    assert.equal(away.ok, false);
    assert.equal(away.reason, "redirect_offsite");
    assert.equal(d.connected.filter((ip) => ip !== "93.184.216.34").length, 0, "the off-site host is never contacted");

    const loop = await probe("http://example.com/loop", { ...d, maxRedirects: 2 });
    assert.equal(loop.reason, "too_many_redirects");

    const chunked = await probe("http://example.com/chunked", { ...d });
    assert.equal(chunked.ok, true);
    assert.equal(chunked.title, "chunk");

    const missing = await probe("http://example.com/missing", { ...d });
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 404);
    assert.equal(missing.reason, "http_404");
  } finally {
    await site.close();
  }
});

Deno.test("netguard: a name that resolves to a private address is refused before any connection; local-only mode allows it explicitly", async () => {
  const site = await localSite(() => new Response("<title>local</title>"));
  try {
    const d = localDeps(site.port); // resolves to 127.0.0.1
    const cloud = await probe("http://example.com/", { ...d });
    assert.equal(cloud.ok, false);
    assert.equal(cloud.reason, "private_address");
    assert.deepEqual(d.connected, [], "no socket was opened");
    // metadata endpoint behind a public-looking name
    const meta = await probe("http://example.com/", { ...d, resolve: () => Promise.resolve(["169.254.169.254"]) });
    assert.equal(meta.reason, "private_address");
    // a dual-stack answer with one private address is refused as a whole
    const mixed = await probe("http://example.com/", { ...d, resolve: () => Promise.resolve(["93.184.216.34", "fd00::1"]) });
    assert.equal(mixed.reason, "private_address");
    const local = await probe("http://example.com/", { ...d, allowPrivate: true });
    assert.equal(local.ok, true, "local-only development mode");
    const dns = await probe("http://example.com/", { ...d, resolve: () => Promise.reject(new Error("NXDOMAIN")) });
    assert.equal(dns.reason, "dns");
    const empty = await probe("http://example.com/", { ...d, resolve: () => Promise.resolve([]) });
    assert.equal(empty.reason, "dns");
  } finally {
    await site.close();
  }
});

Deno.test("netguard: a site that never answers hits the timeout, not the worker", async () => {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  const pending = (async () => {
    for await (const conn of listener) {
      // accept and stay silent
      setTimeout(() => {
        try {
          conn.close();
        } catch { /* closed */ }
      }, 2000);
    }
  })();
  try {
    const d = localDeps(port, { publicName: true });
    const t0 = Date.now();
    const r = await probe("http://example.com/", { ...d, timeoutMs: 400 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "timeout");
    assert.ok(Date.now() - t0 < 1500, "bounded");
  } finally {
    listener.close();
    await pending.catch(() => {});
  }
});

// ---------------------------------------------------------------- handler

function world(user = ME) {
  const db = new FakeDb({
    profiles: [{ user_id: ME.id, email: ME.email }, { user_id: OTHER.id, email: OTHER.email }],
    bid_projects: [
      { user_id: ME.id, key: "shop", name: "Shop", live_url: "https://shop.example.com", domain: "shop.example.com" },
      { user_id: OTHER.id, key: "theirs", name: "Theirs", live_url: "https://theirs.example.com" },
    ],
    monitor_targets: [],
    monitor_probes: [],
    monitor_incidents: [],
    monitor_heartbeat: [],
  }, user);
  db.unique.monitor_targets = [{ cols: ["user_id", "project_key"] }];
  db.unique.monitor_incidents = [{ cols: ["user_id", "project_key", "kind"], when: (r) => r.status === "open" }];
  const answers: Record<string, { ok: boolean; status: number | null; reason: string | null; tlsExpiresAt?: string | null }> = {};
  const probed: string[] = [];
  let clock = new Date("2026-10-01T10:00:00Z");
  // the SQL functions (retention, rate limits) run on the same clock as the handler
  db.clock = () => clock.getTime();
  const handle = createMonitorHandler({
    ...fakeDeps(db),
    cronSecret: "cron-secret",
    now: () => clock,
    probe: (url) => {
      probed.push(url);
      const a = answers[url] ?? answers["*"] ?? { ok: true, status: 200, reason: null };
      return Promise.resolve({ ok: a.ok, url, finalUrl: url, status: a.status, ms: 12, reason: a.reason, ip: "93.184.216.34", redirects: 0, title: a.ok ? "t" : null, tlsExpiresAt: a.tlsExpiresAt ?? null, bytes: 10 });
    },
  });
  const run = () => handle(new Request("http://functions.local/monitor", { method: "POST", headers: { "content-type": "application/json", "x-monitor-secret": "cron-secret" }, body: JSON.stringify({ action: "run" }) }));
  const tick = (min: number) => {
    clock = new Date(clock.getTime() + min * 60_000);
  };
  return { db, handle, answers, probed, run, tick };
}

Deno.test("monitor: register needs a session, a synced project and the project's own live host; the other tenant cannot register it", async () => {
  const w = world();
  assert.equal((await w.handle(post("monitor", { action: "register", projectKey: "shop", url: "https://shop.example.com/" }, null))).status, 401);
  const notSynced = await w.handle(post("monitor", { action: "register", projectKey: "ghost", url: "https://ghost.example.com/" }));
  assert.equal(notSynced.status, 404);
  const notOwner = await w.handle(post("monitor", { action: "register", projectKey: "shop", url: "https://other-host.example.com/" }));
  assert.equal(notOwner.status, 403);
  assert.equal((await notOwner.json()).code, "not_owner");
  const bad = await w.handle(post("monitor", { action: "register", projectKey: "shop", url: "https://127.0.0.1/" }));
  assert.equal(bad.status, 400);
  const badJ = await bad.json();
  assert.equal(badJ.code, "url_rejected");
  assert.equal(badJ.reason, "ip_literal");
  const ok = await w.handle(post("monitor", { action: "register", projectKey: "shop", url: "https://www.shop.example.com/", intervalMin: 1, checks: ["down", "ssl", "page", "bogus"], paths: ["/contact", "bad", "/x y"] }));
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.equal(j.target.interval_min, LIMITS.minIntervalMin, "interval is clamped to the minimum");
  assert.deepEqual(j.target.checks, { kinds: ["down", "ssl", "page"], paths: ["/contact"] });
  // re-register updates the same row
  await w.handle(post("monitor", { action: "register", projectKey: "shop", url: "https://shop.example.com/", intervalMin: 30 }));
  assert.equal(w.db.rows("monitor_targets").length, 1);
  assert.equal(w.db.rows("monitor_targets")[0].interval_min, 30);
  // the other tenant sees nothing and cannot touch it
  const theirs = world(OTHER);
  const st = await theirs.handle(post("monitor", { action: "status" }));
  assert.deepEqual((await st.json()).targets, []);
  const cross = await theirs.handle(post("monitor", { action: "register", projectKey: "shop", url: "https://shop.example.com/" }));
  assert.equal(cross.status, 404, "the other tenant has no such project");
});

Deno.test("monitor: the scheduler needs the secret, probes only due targets, confirms after 2 failures, one incident per kind, recovers, heartbeats", async () => {
  const w = world();
  await w.handle(post("monitor", { action: "register", projectKey: "shop", url: "https://shop.example.com/", intervalMin: 10 }));
  const noSecret = await w.handle(post("monitor", { action: "run" }, null));
  assert.equal(noSecret.status, 401);
  const wrong = await w.handle(new Request("http://functions.local/monitor", { method: "POST", headers: { "content-type": "application/json", "x-monitor-secret": "nope" }, body: JSON.stringify({ action: "run" }) }));
  assert.equal(wrong.status, 401);

  let r = await (await w.run()).json();
  assert.equal(r.checked, 1);
  assert.deepEqual(r.events, []);
  assert.equal(w.db.rows("monitor_heartbeat").length, 1);
  assert.equal(w.db.rows("monitor_targets")[0].last_ok, true);

  // not due yet → nothing probed, heartbeat still written
  r = await (await w.run()).json();
  assert.equal(r.checked, 0);
  assert.equal(w.db.rows("monitor_heartbeat").length, 2);

  // first failure: no incident (confirmation)
  w.answers["*"] = { ok: false, status: 503, reason: "http_503" };
  w.tick(10);
  r = await (await w.run()).json();
  assert.equal(r.checked, 1);
  assert.deepEqual(r.events, []);
  assert.equal(w.db.rows("monitor_incidents").length, 0, "a single failed probe is not an incident");
  // second failure: confirmed → new incident
  w.tick(10);
  r = await (await w.run()).json();
  assert.deepEqual(r.events, [{ projectKey: "shop", kind: "down", type: "new" }]);
  assert.equal(w.db.rows("monitor_incidents").length, 1);
  // third: ongoing, still one incident, count 2
  w.tick(10);
  r = await (await w.run()).json();
  assert.deepEqual(r.events, [{ projectKey: "shop", kind: "down", type: "ongoing" }]);
  assert.equal(w.db.rows("monitor_incidents").length, 1);
  assert.equal(w.db.rows("monitor_incidents")[0].count, 2);
  // status shows it, with the scheduler healthy
  let st = await (await w.handle(post("monitor", { action: "status" }))).json();
  assert.equal(st.runsOn, "cloud");
  assert.equal(st.serverSide, true);
  assert.equal(st.active, true);
  assert.equal(st.scheduler.state, "running");
  assert.equal(st.openIncidents.length, 1);
  assert.equal(st.openIncidents[0].source, "cloud");
  assert.equal(st.targets[0].failures, 3);
  // recovery
  w.answers["*"] = { ok: true, status: 200, reason: null };
  w.tick(10);
  r = await (await w.run()).json();
  assert.deepEqual(r.events, [{ projectKey: "shop", kind: "down", type: "recovered" }]);
  assert.equal(w.db.rows("monitor_incidents")[0].status, "resolved");
  assert.equal(w.db.rows("monitor_targets")[0].failures, 0);
  const inc = await (await w.handle(post("monitor", { action: "incidents" }))).json();
  assert.equal(inc.incidents.length, 1);
  assert.equal(inc.incidents[0].status, "resolved");
  // a stale heartbeat is reported, never hidden
  w.tick(60);
  st = await (await w.handle(post("monitor", { action: "status" }))).json();
  assert.equal(st.scheduler.state, "stale");
  assert.equal(st.active, false, "no heartbeat → not active, whatever the targets say");
});

Deno.test("monitor: page checks and TLS expiry open their own incidents; the batch is bounded; retention removes old rows", async () => {
  const w = world();
  await w.handle(post("monitor", { action: "register", projectKey: "shop", url: "https://shop.example.com/", intervalMin: 10, checks: ["down", "ssl", "page"], paths: ["/contact"] }));
  w.answers["https://shop.example.com/"] = { ok: true, status: 200, reason: null, tlsExpiresAt: new Date(Date.parse("2026-10-01T10:00:00Z") + 5 * 86400_000).toISOString() };
  w.answers["https://shop.example.com/contact"] = { ok: false, status: 404, reason: "http_404" };
  let r = await (await w.run()).json();
  assert.deepEqual(r.events.map((e: { kind: string; type: string }) => `${e.kind}:${e.type}`).sort(), ["page:new", "ssl:new"]);
  assert.equal(w.db.rows("monitor_incidents").find((i) => i.kind === "ssl")?.severity, "warning");
  assert.equal(w.db.rows("monitor_probes").filter((p) => p.kind === "page").length, 1);
  // fixed page → recovered; certificate renewed → recovered
  w.answers["https://shop.example.com/contact"] = { ok: true, status: 200, reason: null };
  w.answers["https://shop.example.com/"].tlsExpiresAt = new Date(Date.parse("2026-10-01T10:00:00Z") + 80 * 86400_000).toISOString();
  w.tick(10);
  r = await (await w.run()).json();
  assert.deepEqual(r.events.map((e: { kind: string; type: string }) => `${e.kind}:${e.type}`).sort(), ["page:recovered", "ssl:recovered"]);
  // retention
  w.db.rows("monitor_probes")[0].at = "2020-01-01T00:00:00Z";
  w.db.rows("monitor_incidents")[0].resolved_at = "2020-01-01T00:00:00Z";
  const before = w.db.rows("monitor_probes").length;
  w.tick(10);
  await w.run();
  assert.equal(w.db.rows("monitor_probes").length, before - 1 + 2, "one old probe removed, two new ones added");
  assert.equal(w.db.rows("monitor_incidents").length, 1, "the old resolved incident is gone");
  // bounded batch: more due targets than the batch size → the rest wait for the next pass
  for (let i = 0; i < LIMITS.batch + 5; i++) {
    w.db.rows("bid_projects").push({ user_id: ME.id, key: `p${i}`, live_url: `https://p${i}.example.com` });
    await w.handle(post("monitor", { action: "register", projectKey: `p${i}`, url: `https://p${i}.example.com/` }));
  }
  r = await (await w.run()).json();
  assert.equal(r.checked, LIMITS.batch);
  assert.equal(r.targets, LIMITS.batch + 6);
  assert.equal(r.due, LIMITS.batch, "due is what this pass took; the rest wait for the next pass");
  r = await (await w.run()).json();
  assert.equal(r.checked, 5, "the remaining targets are probed on the next pass");
});

Deno.test("monitor (WP03): retention runs in the database in batches — over 1000 old probes, open incidents kept, heartbeat pruned", async () => {
  const w = world();
  const old = "2026-05-01T00:00:00Z"; // > 90 days before the world's clock
  for (let i = 0; i < 1500; i++) w.db.rows("monitor_probes").push({ id: `old-${i}`, user_id: ME.id, project_key: "shop", at: old, kind: "uptime", ok: true });
  for (let i = 0; i < 10; i++) w.db.rows("monitor_probes").push({ id: `new-${i}`, user_id: ME.id, project_key: "shop", at: "2026-09-30T00:00:00Z", kind: "uptime", ok: true });
  w.db.rows("monitor_incidents").push({ id: "gone", user_id: ME.id, project_key: "shop", kind: "down", status: "resolved", opened_at: old, resolved_at: old });
  w.db.rows("monitor_incidents").push({ id: "still", user_id: ME.id, project_key: "shop", kind: "ssl", status: "open", opened_at: old });
  for (let i = 0; i < 300; i++) w.db.rows("monitor_heartbeat").push({ at: "2026-09-01T00:00:00Z", checked: 0 });
  const r = await (await w.run()).json();
  assert.equal(r.pruned.monitor_probes, 1500, "every old probe in one pass (batch 5000), not just the first 1000");
  assert.equal(r.pruned.monitor_heartbeat, 300);
  assert.equal(w.db.rows("monitor_probes").filter((p) => String(p.id).startsWith("old-")).length, 0);
  assert.equal(w.db.rows("monitor_probes").filter((p) => String(p.id).startsWith("new-")).length, 10, "recent probes kept");
  assert.deepEqual(w.db.rows("monitor_incidents").map((i) => i.id), ["still"], "an open incident is never pruned");
  assert.equal(w.db.rows("monitor_heartbeat").length, 1, "only this pass's heartbeat remains");
});

Deno.test("monitor (WP03): an on-demand test probe is rate limited per user", async () => {
  const w = world();
  await w.handle(post("monitor", { action: "register", projectKey: "shop", url: "https://shop.example.com/" }));
  const codes: number[] = [];
  for (let i = 0; i < 11; i++) codes.push((await w.handle(post("monitor", { action: "test", projectKey: "shop" }))).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(200));
  assert.equal(codes[10], 429, "the 11th probe within a minute is refused");
  w.tick(2);
  assert.equal((await w.handle(post("monitor", { action: "test", projectKey: "shop" }))).status, 200, "the window moves on");
});
