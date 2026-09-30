// Before I Deploy — the slice of the Supabase client the Edge Functions use (V10 L6).
// The handlers are written against this interface so tests can inject an in-memory database
// (`_shared/fake_supabase.ts`); `index.ts` of every function adapts the real supabase-js client to it.

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;

export interface DbError {
  message: string;
  code?: string;
}

export interface Result<T = Row[]> {
  data: T | null;
  error: DbError | null;
  count?: number | null;
}

/** A PostgREST query: filters and modifiers chain, `await` runs it. */
export interface Query extends PromiseLike<Result> {
  select(columns?: string, opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }): Query;
  eq(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  lt(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  or(filters: string): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  limit(n: number): Query;
  /** Rows from..to inclusive (PostgREST caps an unranged select at max-rows, 1000 by default). */
  range(from: number, to: number): Query;
  maybeSingle(): PromiseLike<Result<Row>>;
  insert(rows: Row | Row[]): Query;
  update(patch: Row): Query;
  upsert(rows: Row[], opts?: { onConflict?: string }): Query;
  delete(): Query;
}

export interface AuthUser {
  id: string;
  email?: string;
  created_at?: string;
}

export interface DbClient {
  from(table: string): Query;
  /** A Postgres function (schema.sql): bid_rate_hit, bid_prune … */
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args?: Row): PromiseLike<Result<any>>;
  auth: {
    getUser(): Promise<{ data: { user: AuthUser | null }; error: DbError | null }>;
    admin?: {
      deleteUser(id: string): Promise<{ error: DbError | null }>;
      inviteUserByEmail?(email: string, opts?: { data?: Row }): Promise<{ data: { user: AuthUser | null }; error: DbError | null }>;
    };
  };
}

/** What a handler needs from the outside world; `index.ts` builds it from env, tests from fakes. */
export interface Deps {
  /** Client that acts as the caller (RLS applies) — `auth` is the request's Authorization header. */
  asUser(auth: string): DbClient;
  /** Client with the service role (bypasses RLS). */
  service(): DbClient;
}

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Parses the JSON body, or returns null for invalid JSON. */
export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** Resolves the caller from the Authorization header, or null when there is no valid session. */
export async function callerOf(req: Request, deps: Deps): Promise<{ user: AuthUser; asUser: DbClient } | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const asUser = deps.asUser(auth);
  const { data: { user }, error } = await asUser.auth.getUser();
  if (error || !user) return null;
  return { user, asUser };
}

/** Throws when a write failed — supabase-js reports errors in the result instead of throwing (audit C3). */
export function must<T>(r: Result<T>): Result<T> {
  if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r;
}

/** Postgres unique violation: "already done" for idempotent writes. */
export const isDuplicate = (e: unknown) => (e as { code?: string })?.code === "23505";

/** Logs the details, answers with a generic message and a code (audit C13: no internal text to clients). */
export function internalError(where: string, e: unknown): Response {
  console.error(where, e);
  return json(500, { error: "internal error", code: "internal" });
}

export async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Every row of a select, page by page — never silently the first 1000 (PostgREST max-rows, WP03). */
export async function allRows(query: () => Query, page = 1000): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await query().range(from, from + page - 1);
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < page) return out;
  }
}
