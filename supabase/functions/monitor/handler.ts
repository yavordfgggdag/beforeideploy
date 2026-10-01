// Before I Deploy — `monitor` Edge Function (V11 RC): server-side monitoring that keeps running when the
// app is closed and the Mac sleeps.
//
//   JWT actions (POST, the caller's session):
//     { action: "register", projectKey, url, intervalMin?, checks? } → one target per (user, project); the
//         URL's host must be the project's live host as the cloud already knows it from the user's own
//         `bid_projects` row (tenant-scoped ownership, no cross-tenant registration), public hostname only.
//     { action: "unregister", projectKey }
//     { action: "status" }        → targets, open incidents, scheduler heartbeat (present / stale), retention
//     { action: "incidents", limit?, projectKey? }
//     { action: "test", url }     → one immediate probe of a registered target (same guard), for the app
//
//   Scheduler action (POST, no JWT; header `x-monitor-secret` must equal MONITOR_CRON_SECRET):
//     { action: "run" }           → probes the due targets (bounded batch), updates streaks, opens /
//                                   continues / resolves incidents once per (target, kind), writes a heartbeat
//
// Probes go through `_shared/netguard.ts`: DNS → public-address check → connect to the validated address
// (TLS verified for the hostname) → ≤3 same-site redirects, re-validated per hop → 5 s timeout, 256 KB cap.
// A failure becomes an incident only after `confirmFailures` consecutive failed runs; one open incident per
// (target, kind); recovery closes it. Nothing here scans a project or touches a deployment.
import {creditRpc,expireDue} from "../_shared/credits.ts";
import { allRows, callerOf, type Deps, internalError, json, must, readJson, type Row } from "../_shared/db.ts";
import { rateLimited } from "../_shared/ratelimit.ts";
import { type ProbeOptions, type ProbeResult, probe as netProbe, validateTargetUrl } from "../_shared/netguard.ts";

export interface MonitorDeps extends Deps {
  cronSecret: string;
  /** Injected probe (tests); default: netguard.probe with the production options (no private addresses). */
  probe?: (url: string, opts: ProbeOptions) => Promise<ProbeResult>;
  /** Local-only mode for `supabase functions serve` on a laptop; index.ts never sets it. */
  allowPrivate?: boolean;
  now?: () => Date;
}

export const LIMITS = {
  minIntervalMin: 5,
  maxIntervalMin: 1440,
  batch: 25, // targets per scheduler call
  confirmFailures: 2,
  retentionDays: 90, // probes and resolved incidents
  heartbeatStaleMin: 15, // no scheduler run for this long → "scheduler not running"
  timeoutMs: 5000,
};

const CHECK_KINDS = ["down", "ssl", "page"] as const;

function clampInterval(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 10;
  return Math.min(LIMITS.maxIntervalMin, Math.max(LIMITS.minIntervalMin, v));
}

function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

export function createMonitorHandler(deps: MonitorDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const probe = deps.probe ?? ((url, opts) => netProbe(url, opts));
  const probeOpts = (): ProbeOptions => ({ timeoutMs: LIMITS.timeoutMs, allowPrivate: !!deps.allowPrivate, method: "GET" });

  return async (req) => {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const body = await readJson<Row>(req);
    if (!body) return json(400, { error: "invalid JSON" });

    try {
      // ---------------------------------------------------------------- scheduler
      if (body.action === "run") {
        const secret = req.headers.get("x-monitor-secret") ?? "";
        if (!deps.cronSecret || secret !== deps.cronSecret) return json(401, { error: "bad secret", code: "bad_secret" });
        return json(200, await runDue(deps, probe, probeOpts(), now()));
      }

      const who = await callerOf(req, deps);
      if (!who) return json(401, { error: "no session" });
      const user = who.user;
      const db = deps.service();
      // an on-demand probe and a registration cost outbound requests: limited per user (WP03)
      if (body.action === "test" || body.action === "register") {
        const limited = await rateLimited(db, user.id, `monitor.${body.action}`);
        if (limited) return limited;
      }

      switch (body.action) {
        case "register": {
          const key = String(body.projectKey ?? "").trim();
          if (!key) return json(400, { error: "projectKey required", code: "usage" });
          const v = validateTargetUrl(String(body.url ?? ""));
          if (!v.ok) return json(400, { error: `url rejected: ${v.reason}`, code: "url_rejected", reason: v.reason });
          // ownership: the host must be the project's live host as the cloud knows it from THIS user's row
          const { data: project } = await db.from("bid_projects").select("key,live_url,domain").eq("user_id", user.id).eq("key", key).maybeSingle();
          if (!project) return json(404, { error: "project is not synced to the cloud", code: "project_not_synced" });
          const wanted = hostOf(v.url.toString());
          const known = [hostOf(project.live_url), project.domain ? String(project.domain).toLowerCase().replace(/^www\./, "") : null].filter(Boolean);
          if (!known.includes(wanted)) return json(403, { error: "url host is not this project's live host", code: "not_owner", known });
          const checks = Array.isArray(body.checks) ? body.checks.filter((c: unknown) => (CHECK_KINDS as readonly string[]).includes(String(c))) : ["down", "ssl"];
          const paths = Array.isArray(body.paths) ? body.paths.filter((p: unknown) => typeof p === "string" && /^\/[^\s]{0,200}$/.test(p)).slice(0, 10) : [];
          const at=now();
          await expireDue(db,user.id,at);
          const receipt=await creditRpc(db,"bid_monitor_register",{p_user:user.id,p_project:key,p_url:v.url.toString(),p_interval:clampInterval(body.intervalMin??10),p_checks:{kinds:checks,paths},p_now:at.toISOString()});
          return json(receipt.ok===false ? receipt.code==="quota_exhausted"?402:403 : 200,receipt);
        }
        case "unregister": {
          const key = String(body.projectKey ?? "").trim();
          must(await db.from("monitor_targets").delete().eq("user_id", user.id).eq("project_key", key));
          return json(200, { registered: false });
        }
        case "status": {
          await expireDue(db,user.id,now());
          const [targets, open, beat, sites] = await Promise.all([
            allRows(()=>db.from("monitor_targets").select("*").eq("user_id", user.id).order("id")),
            db.from("monitor_incidents").select("*").eq("user_id", user.id).eq("status", "open").then((r) => r.data ?? []),
            db.from("monitor_heartbeat").select("*").order("at", { ascending: false }).limit(1).maybeSingle().then((r) => r.data),
            allRows(()=>db.from("sites").select("id,state").eq("user_id",user.id).order("id")),
          ]);
          const activeIds=new Set(sites.filter(s=>s.state==="active").map(s=>s.id));
          const t = now().getTime();
          const beatAt = beat?.at ? Date.parse(String(beat.at)) : null;
          const scheduler = {
            lastRunAt: beat?.at ?? null,
            healthy: beatAt !== null && t - beatAt < LIMITS.heartbeatStaleMin * 60_000,
            state: beatAt === null ? "never" : t - beatAt < LIMITS.heartbeatStaleMin * 60_000 ? "running" : "stale",
            checked: beat?.checked ?? null,
          };
          return json(200, {
            runsOn: "cloud",
            serverSide: true,
            active: scheduler.healthy && targets.some((x) => x.enabled && activeIds.has(x.site_id)),
            scheduler,
            limits: LIMITS,
            targets: targets.map((x) => ({
              projectKey: x.project_key,
              url: x.url,
              enabled: x.enabled && activeIds.has(x.site_id),
              intervalMin: x.interval_min,
              checks: x.checks,
              lastRunAt: x.last_run_at ?? null,
              nextRunAt: x.next_run_at ?? null,
              lastOk: x.last_ok ?? null,
              lastStatus: x.last_status ?? null,
              failures: x.failures ?? 0,
            })),
            openIncidents: open.map(publicIncident),
          });
        }
        case "incidents": {
          const limit = Math.min(200, Math.max(1, Number(body.limit ?? 50)));
          let q = db.from("monitor_incidents").select("*").eq("user_id", user.id);
          if (body.projectKey) q = q.eq("project_key", String(body.projectKey));
          const { data } = await q.order("opened_at", { ascending: false }).limit(limit);
          return json(200, { incidents: (data ?? []).map(publicIncident) });
        }
        case "test": {
          const { data: target } = await db.from("monitor_targets").select("*").eq("user_id", user.id).eq("project_key", String(body.projectKey ?? "")).maybeSingle();
          if (!target) return json(404, { error: "not registered", code: "not_registered" });
          await expireDue(db,user.id,now());
          const {data:site}=await db.from("sites").select("state").eq("user_id",user.id).eq("id",target.site_id??"").maybeSingle();
          if(site?.state!=="active")return json(403,{error:"Site is paused",code:"site_paused"});
          const r = await probe(String(target.url), probeOpts());
          return json(200, { probe: publicProbe(r) });
        }
        default:
          return json(400, { error: `unknown action: ${body.action}` });
      }
    } catch (e) {
      const err=e as Error & {status?:number;code?:string};
      if(err.status)return json(err.status,{error:"Monitoring is temporarily unavailable",code:err.code});
      return internalError("monitor", e);
    }
  };
}

function publicIncident(i: Row) {
  return { id: i.id, projectKey: i.project_key, kind: i.kind, status: i.status, severity: i.severity, openedAt: i.opened_at, resolvedAt: i.resolved_at ?? null, lastSeenAt: i.last_seen_at ?? null, count: i.count ?? 1, detail: i.detail ?? null, url: i.url ?? null, source: "cloud" };
}

function publicProbe(r: ProbeResult) {
  return { ok: r.ok, status: r.status, ms: r.ms, reason: r.reason, finalUrl: r.finalUrl, redirects: r.redirects, title: r.title, tlsExpiresAt: r.tlsExpiresAt };
}

// ---------------------------------------------------------------- scheduler pass

async function runDue(deps: MonitorDeps, probe: NonNullable<MonitorDeps["probe"]>, opts: ProbeOptions, now: Date) {
  const db = deps.service();
  const t = now.getTime();
  const {data:pruned,error:pruneError}=await db.rpc("bid_prune",{p_batch:5000});
  if(pruneError)console.error(`monitor: retention skipped — ${pruneError.message}`);
  await creditRpc(db,"bid_scheduler_credits",{p_batch:1000,p_now:now.toISOString()});
  const burn=await creditRpc(db,"bid_site_burn",{p_day:now.toISOString().slice(0,10),p_batch:1000,p_now:now.toISOString()});
  const [all,sites]=await Promise.all([
    allRows(()=>db.from("monitor_targets").select("*").eq("enabled",true).order("id")),
    allRows(()=>db.from("sites").select("id,state").eq("state","active").order("id")),
  ]);
  const activeIds=new Set(sites.map(s=>s.id));
  const due = (all ?? [])
    .filter((x) => activeIds.has(x.site_id) && (!x.next_run_at || Date.parse(String(x.next_run_at)) <= t))
    .sort((a, b) => String(a.next_run_at ?? "").localeCompare(String(b.next_run_at ?? "")))
    .slice(0, LIMITS.batch);
  const events: Row[] = [];
  let checked = 0;
  for (const target of due) {
    checked++;
    const r = await probe(String(target.url), opts);
    const kinds: string[] = target.checks?.kinds ?? ["down", "ssl"];
    const paths: string[] = target.checks?.paths ?? [];
    const failures = r.ok ? 0 : Number(target.failures ?? 0) + 1;
    const at = now.toISOString();
    must(await db.from("monitor_probes").insert({ user_id: target.user_id, project_key: target.project_key, at, kind: "down", ok: r.ok, status: r.status, ms: r.ms, detail: r.reason ?? null, ip: r.ip }));
    must(await db.from("monitor_targets").update({
      last_run_at: at,
      next_run_at: new Date(t + Number(target.interval_min ?? 10) * 60_000).toISOString(),
      last_ok: r.ok,
      last_status: r.status,
      last_ms: r.ms,
      last_reason: r.reason,
      failures,
      updated_at: at,
    }).eq("id", target.id));

    // availability: confirm before opening; ongoing increments; recovery resolves
    if (kinds.includes("down")) {
      events.push(...await incidentStep(db, target, "down", !r.ok && failures >= LIMITS.confirmFailures, r.ok, r.reason ? `${r.reason}${r.status ? ` (${r.status})` : ""}` : `http ${r.status}`, r.ok ? "critical" : "critical", at));
    }
    // TLS expiry when the runtime exposes the certificate
    if (kinds.includes("ssl") && r.tlsExpiresAt) {
      const days = Math.floor((Date.parse(r.tlsExpiresAt) - t) / 86400_000);
      events.push(...await incidentStep(db, target, "ssl", days < 14, days >= 14, `${days}d`, days < 0 ? "critical" : "warning", at));
    }
    // important pages, same guard, only when the home page answers
    if (kinds.includes("page") && r.ok && paths.length) {
      let bad: string | null = null;
      for (const p of paths) {
        const pr = await probe(new URL(p, String(target.url)).toString(), opts);
        must(await db.from("monitor_probes").insert({ user_id: target.user_id, project_key: target.project_key, at, kind: "page", ok: pr.ok, status: pr.status, ms: pr.ms, detail: pr.ok ? p : `${p}: ${pr.reason}`, ip: pr.ip }));
        if (!pr.ok && !bad) bad = `${p}: ${pr.reason}`;
      }
      events.push(...await incidentStep(db, target, "page", !!bad, !bad, bad ?? "", "warning", at));
    }
  }
  must(await db.from("monitor_heartbeat").insert({ at: now.toISOString(), checked, due: due.length, targets: (all ?? []).length }));
  return { at: now.toISOString(), checked, due: due.length, targets: (all ?? []).length, events, pruned: pruned ?? null, burn };
}

/** One incident per (target, kind): open when confirmed, count while it lasts, resolve on recovery. */
async function incidentStep(db: ReturnType<MonitorDeps["service"]>, target: Row, kind: string, confirmedProblem: boolean, healthy: boolean, detail: string, severity: string, at: string): Promise<Row[]> {
  const { data: open } = await db.from("monitor_incidents").select("*").eq("user_id", target.user_id).eq("project_key", target.project_key).eq("kind", kind).eq("status", "open").maybeSingle();
  if (confirmedProblem) {
    if (open) {
      must(await db.from("monitor_incidents").update({ count: Number(open.count ?? 1) + 1, last_seen_at: at, detail }).eq("id", open.id));
      return [{ projectKey: target.project_key, kind, type: "ongoing" }];
    }
    must(await db.from("monitor_incidents").insert({ user_id: target.user_id, project_key: target.project_key, kind, status: "open", severity, opened_at: at, last_seen_at: at, count: 1, detail, url: target.url, source: "cloud" }));
    return [{ projectKey: target.project_key, kind, type: "new" }];
  }
  if (healthy && open) {
    must(await db.from("monitor_incidents").update({ status: "resolved", resolved_at: at }).eq("id", open.id));
    return [{ projectKey: target.project_key, kind, type: "recovered" }];
  }
  return [];
}
