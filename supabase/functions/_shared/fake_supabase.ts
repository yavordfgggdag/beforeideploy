// In-memory stand-in for the Supabase client used by the Edge Function tests (V10 L6).
// It implements exactly the query surface in `db.ts`: rows live in plain arrays, RLS is not simulated
// (the tests decide who the caller is through `user`). Only `deno test` imports this file.
import type { AuthUser, DbClient, DbError, Query, Result, Row } from "./db.ts";

type Filter = (row: Row) => boolean;

function ilike(pattern: string): (value: unknown) => boolean {
  const re = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i");
  return (v) => re.test(String(v ?? ""));
}

class FakeQuery implements Query {
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
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
    const fail = this.db.failures[this.table];
    if (fail) return { data: null, error: fail };
    const rows = (this.db.tables[this.table] ??= []);
    this.db.log.push({ table: this.table, op: this.op });
    switch (this.op) {
      case "select": {
        let out = rows.filter((r) => this.filters.every((f) => f(r)));
        if (this.orderBy) {
          const { column, ascending } = this.orderBy;
          out = [...out].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : String(a[column]) > String(b[column]) ? 1 : 0) * (ascending ? 1 : -1));
        }
        if (this.limitN != null) out = out.slice(0, this.limitN);
        if (this.counting && this.head) return { data: null, error: null, count: out.length };
        return this.finish(out);
      }
      case "insert": {
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
  log: { table: string; op: string }[] = [];
  deletedUsers: string[] = [];
  user: AuthUser | null;

  constructor(tables: Record<string, Row[]> = {}, user: AuthUser | null = null) {
    this.tables = tables;
    this.user = user;
  }

  from(table: string): Query {
    return new FakeQuery(this, table);
  }

  auth = {
    getUser: () =>
      Promise.resolve(
        this.user ? { data: { user: this.user }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } },
      ),
    admin: {
      deleteUser: (id: string) => {
        this.deletedUsers.push(id);
        for (const t of Object.keys(this.tables)) this.tables[t] = this.tables[t].filter((r) => r.user_id !== id);
        return Promise.resolve({ error: null });
      },
    },
  };

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
