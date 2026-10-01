// In-memory stand-in for the Supabase client used by the Edge Function tests (V10 L6).
// It implements exactly the query surface in `db.ts`: rows live in plain arrays, RLS is not simulated
// (the tests decide who the caller is through `user`). Only `deno test` imports this file.
import { fakeCreditRpc } from "./fake_credits.ts";
import type { AuthUser, DbClient, DbError, Query, Result, Row } from "./db.ts";

type Filter = (row: Row) => boolean;

/** Ledger reasons that must happen once per ref (unique index credit_ledger_once in schema.sql). */
export const GRANT_REASONS = ["plan_grant", "trial_grant", "topup", "refund", "expiry"];

function ilike(pattern: string): (value: unknown) => boolean {
  const re = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i");
  return (v) => re.test(String(v ?? ""));
}

class FakeQuery implements Query {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private head = false;
  private counting = false;
  private single = false;
  private payload: Row[] = [];
  private patch: Row = {};
  private conflictKey = "id";

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select(_columns?: string, opts?: { count?: string; head?: boolean }): Query {
    if (this.op === "select") {
      this.head = !!opts?.head;
      this.counting = !!opts?.count;
    }
    return this;
  }
  eq(column: string, value: unknown): Query {
    this.filters.push((r) => String(r[column]) === String(value));
    return this;
  }
  gte(column: string, value: unknown): Query {
    this.filters.push((r) => (typeof value === "number" ? Number(r[column]) >= value : String(r[column]) >= String(value)));
    return this;
  }
  lt(column: string, value: unknown): Query {
    this.filters.push((r) => (typeof value === "number" ? Number(r[column]) < value : String(r[column]) < String(value)));
    return this;
  }
  range(from: number, to: number): Query {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  in(column: string, values: unknown[]): Query {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  /** PostgREST `or`: "email.ilike.%x%,display_name.ilike.%x%" */
  or(expr: string): Query {
    const parts = expr.split(",").map((p) => {
      const [column, operator, ...rest] = p.split(".");
      const value = rest.join(".");
      if (operator === "ilike") {
        const m = ilike(value);
        return (r: Row) => m(r[column]);
      }
      if (operator === "eq") return (r: Row) => String(r[column]) === value;
      throw new Error(`fake_supabase: unsupported or() operator ${operator}`);
    });
    this.filters.push((r) => parts.some((p) => p(r)));
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }): Query {
    this.orderBy = { column, ascending: opts?.ascending ?? true };
    return this;
  }
  limit(n: number): Query {
    this.limitN = n;
    return this;
  }
  maybeSingle(): PromiseLike<Result<Row>> {
    this.single = true;
    return this as unknown as PromiseLike<Result<Row>>;
  }
  insert(rows: Row | Row[]): Query {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row): Query {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete(): Query {
    this.op = "delete";
    return this;
  }
  upsert(rows: Row[], opts?: { onConflict?: string }): Query {
    this.op = "upsert";
    this.payload = rows;
    this.conflictKey = opts?.onConflict ?? "id";
    return this;
  }

  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve().then(() => this.run()).then(onfulfilled, onrejected);
  }

  private run(): Result {
    const fail = this.db.failures[this.table] ?? (this.op !== "select" ? this.db.writeFailures[this.table] : undefined);
    if (fail) return { data: null, error: fail };
    // credit_balance is a view over credit_ledger (schema.sql) unless a test seeds it directly
    const rows = this.table === "credit_balance" && !this.db.tables.credit_balance
      ? this.db.balances()
      : this.table === "credit_bucket_balance" ? this.db.balances(true) : (this.db.tables[this.table] ??= []);
    this.db.log.push({ table: this.table, op: this.op });
    switch (this.op) {
      case "select": {
        let out = rows.filter((r) => this.filters.every((f) => f(r)));
        if (this.orderBy) {
          const { column, ascending } = this.orderBy;
          out = [...out].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : String(a[column]) > String(b[column]) ? 1 : 0) * (ascending ? 1 : -1));
        }
        if (this.counting && this.head) return { data: null, error: null, count: out.length };
        if (this.rangeFrom != null) out = out.slice(this.rangeFrom, (this.rangeTo ?? this.rangeFrom) + 1);
        if (this.limitN != null) out = out.slice(0, this.limitN);
        // like PostgREST: an unranged select returns at most max-rows (1000) — code must page (WP03)
        out = out.slice(0, Math.min(out.length, this.db.maxRows));
        return this.finish(out);
      }
      case "delete": {
        const gone = rows.filter((r) => this.filters.every((f) => f(r)));
        this.db.tables[this.table] = rows.filter((r) => !gone.includes(r));
        return this.finish(gone);
      }
      case "insert": {
        // unique keys declared per table (like the real schema) → Postgres error 23505
        const uniq = this.db.unique[this.table] ?? [];
        for (const r of this.payload) {
          for (const u of uniq) {
            if (u.when && !u.when(r)) continue;
            const clash = rows.some((x) => (!u.when || u.when(x)) && u.cols.every((c) => x[c] !== undefined && x[c] === r[c]));
            if (clash) return { data: null, error: { message: `duplicate key (${u.cols.join(",")})`, code: "23505" } };
          }
        }
        const inserted = this.payload.map((r) => ({ id: crypto.randomUUID(), created_at: this.db.nextTimestamp(), ...r }));
        rows.push(...inserted);
        return this.finish(inserted);
      }
      case "update": {
        const matched = rows.filter((r) => this.filters.every((f) => f(r)));
        for (const r of matched) Object.assign(r, this.patch);
        return this.finish(matched);
      }
      case "upsert": {
        const out: Row[] = [];
        for (const r of this.payload) {
          const existing = rows.find((x) => x[this.conflictKey] === r[this.conflictKey]);
          if (existing) {
            Object.assign(existing, r);
            out.push(existing);
          } else {
            const created = { id: crypto.randomUUID(), ...r };
            rows.push(created);
            out.push(created);
          }
        }
        return this.finish(out);
      }
    }
  }

  private finish(out: Row[]): Result {
    if (this.single) return { data: (out[0] ?? null) as unknown as Row[], error: null };
    return { data: out, error: null };
  }
}

export class FakeDb implements DbClient {
  tables: Record<string, Row[]>;
  /** Table → error every query on it returns (to test the 500 path). */
  failures: Record<string, DbError> = {};
  /** Table → failing only writes (insert/update/upsert/delete). */
  writeFailures: Record<string, DbError> = {};
  /** Table → column sets that must be unique (mirrors the unique indexes in schema.sql). */
  unique: Record<string, { cols: string[]; when?: (r: Row) => boolean }[]> = {
    billing_events: [{ cols: ["id"] }],
    trial_claims: [{ cols: ["email_hash"] }],
    credit_ledger: [{ cols: ["user_id", "ref", "reason"], when: (r) => GRANT_REASONS.includes(String(r.reason)) && r.ref != null }],
    subscriptions: [{ cols: ["user_id", "provider"], when: (r) => r.provider === "trial" }],
  };
  log: { table: string; op: string }[] = [];
  /** PostgREST max-rows: an unranged select returns at most this many rows. */
  maxRows = 1000;
  /** Current time for the SQL functions (tests move it). */
  clock: () => number = () => Date.now();
  /** rpc names that fail as if the function were not deployed (schema not updated). */
  missingFunctions: string[] = [];
  /** rpc name → a database error (not "missing"). */
  rpcErrors: Record<string, DbError> = {};
  rpcResponses: Record<string, Row> = {};
  rpcCalls: {fn:string;args:Row}[] = [];
  deletedUsers: string[] = [];
  invited: { email: string; data: Row }[] = [];
  user: AuthUser | null;

  constructor(tables: Record<string, Row[]> = {}, user: AuthUser | null = null) {
    this.tables = tables;
    this.user = user;
  }

  from(table: string): Query {
    return new FakeQuery(this, table);
  }

  /** The Postgres functions of schema.sql, with the same semantics (tests/rls proves the SQL itself). */
  rpc(fn: string, args: Row = {}): PromiseLike<Result<unknown>> {
    return Promise.resolve().then(() => {
      if (this.missingFunctions.includes(fn)) return { data: null, error: { message: `Could not find the function public.${fn}`, code: "PGRST202" } };
      if (this.rpcErrors[fn]) return { data: null, error: this.rpcErrors[fn] };
      this.rpcCalls.push({fn,args});
      if(this.rpcResponses[fn]) return {data:structuredClone(this.rpcResponses[fn]),error:null};
      if(fn.startsWith("bid_") && !["bid_rate_hit","bid_prune"].includes(fn)) {
        if(this.writeFailures.credit_ledger || this.failures.credit_ledger) return {data:null,error:this.writeFailures.credit_ledger ?? this.failures.credit_ledger};
        const receipt=fakeCreditRpc(this,fn,args);
        if(receipt) return {data:receipt,error:null};
      }
      const t = this.tables;
      const now = this.clock();
      const iso = (ms: number) => new Date(ms).toISOString();
      if (fn === "bid_rate_hit") {
        const rows = (t.rate_events ??= []);
        const since = iso(now - Number(args.p_window_seconds) * 1000);
        const n = rows.filter((r) => r.user_id === args.p_user && r.action === args.p_action && String(r.at) > since).length;
        if (n >= Number(args.p_limit)) return { data: false, error: null };
        rows.push({ user_id: args.p_user, action: args.p_action, at: iso(now) });
        return { data: true, error: null };
      }
      if (fn === "bid_prune") {
        const batch = Number(args.p_batch ?? 5000);
        const day = 86400_000;
        const prune = (table: string, old: (r: Row) => boolean) => {
          const rows = t[table] ?? [];
          const gone = rows.filter(old).slice(0, batch);
          t[table] = rows.filter((r) => !gone.includes(r));
          return gone.length;
        };
        return {
          data: {
            monitor_probes: prune("monitor_probes", (r) => String(r.at) < iso(now - 90 * day)),
            monitor_incidents: prune("monitor_incidents", (r) => r.status === "resolved" && !!r.resolved_at && String(r.resolved_at) < iso(now - 90 * day)),
            monitor_heartbeat: prune("monitor_heartbeat", (r) => String(r.at) < iso(now - 7 * day)),
            rate_events: prune("rate_events", (r) => String(r.at) < iso(now - 2 * day)),
            ai_usage: prune("ai_usage", (r) => String(r.created_at) < iso(now - 395 * day)),
            admin_audit: prune("admin_audit", (r) => String(r.created_at) < iso(now - 730 * day)),
          },
          error: null,
        };
      }
      return { data: null, error: { message: `fake_supabase: unknown function ${fn}`, code: "PGRST202" } };
    });
  }

  auth = {
    getUser: () =>
      Promise.resolve(
        this.user ? { data: { user: this.user }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } },
      ),
    admin: {
      inviteUserByEmail: (email: string, opts?: { data?: Row }) => {
        if (this.rows("profiles").some((p) => p.email === email)) {
          return Promise.resolve({ data: { user: null }, error: { message: "A user with this email address has already been registered" } });
        }
        const id = `u-invited-${this.invited.length + 1}`;
        this.invited.push({ email, data: opts?.data ?? {} });
        // the handle_new_user trigger creates the profile
        (this.tables.profiles ??= []).push({ user_id: id, email, role: "normal", plan: "free", locale: opts?.data?.locale ?? "en", ai_disabled: false });
        return Promise.resolve({ data: { user: { id, email } }, error: null });
      },
      deleteUser: (id: string) => {
        this.deletedUsers.push(id);
        for (const t of Object.keys(this.tables)) this.tables[t] = this.tables[t].filter((r) => r.user_id !== id);
        return Promise.resolve({ error: null });
      },
    },
  };

  /** Same as the credit_balance view (per user, holds included) or credit_bucket_balance (per user and bucket). */
  balances(byBucket = false): Row[] {
    const sums = new Map<string, Row>();
    for (const r of this.rows("credit_ledger")) {
      const bucket = String(r.bucket ?? "plan");
      const k = byBucket ? `${r.user_id}\u0000${bucket}` : String(r.user_id);
      const row = sums.get(k) ?? { user_id: r.user_id, ...(byBucket ? { bucket } : {}), balance: 0 };
      row.balance += Number(r.delta ?? 0);
      sums.set(k, row);
    }
    return [...sums.values()];
  }

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  private lastTs = 0;
  /** Strictly increasing `created_at` values, so "order by created_at" is stable even within one millisecond. */
  nextTimestamp(): string {
    this.lastTs = Math.max(Date.now(), this.lastTs + 1);
    return new Date(this.lastTs).toISOString();
  }
}

/** Deps for a handler: the same in-memory database answers as the caller and as the service role. */
export function fakeDeps(db: FakeDb) {
  return { asUser: (_auth: string) => db, service: () => db };
}

export function post(path: string, body: unknown, token: string | null = "user-jwt"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`http://functions.local/${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

/** Parses a normalized SSE body (`data: {...}\n\n`) into objects. */
export function sseEvents(text: string): Row[] {
  return text.split("\n\n").map((chunk) => chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join(""))
    .filter(Boolean).map((d) => JSON.parse(d));
}
