// Before I Deploy — `admin` Edge Function entry point (V10 WP2). Logic lives in handler.ts so
// `deno test` can run it against an in-memory database (_shared/fake_supabase.ts).
//
// Deploy:  supabase functions deploy admin
// Secrets: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";
import type { DbClient } from "../_shared/db.ts";
import { createAdminHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createAdminHandler({
  asUser: (auth) => createClient(url, anonKey, { global: { headers: { Authorization: auth } } }) as unknown as DbClient,
  service: () => createClient(url, serviceKey, { auth: { persistSession: false } }) as unknown as DbClient,
  // diagnostics: set or not — the value never leaves the function
  hasSecret: (name) => !!Deno.env.get(name),
}));
