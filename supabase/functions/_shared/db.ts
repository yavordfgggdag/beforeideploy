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
  in(column: string, values: unknown[]): Query;
  or(filters: string): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  limit(n: number): Query;
  maybeSingle(): PromiseLike<Result<Row>>;
  insert(rows: Row | Row[]): Query;
  update(patch: Row): Query;
  upsert(rows: Row[], opts?: { onConflict?: string }): Query;
}

export interface AuthUser {
  id: string;
  email?: string;
  created_at?: string;
}

export interface DbClient {
  from(table: string): Query;
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
