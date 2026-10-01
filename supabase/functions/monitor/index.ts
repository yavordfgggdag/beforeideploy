// Before I Deploy — `monitor` Edge Function entry point (V11 RC): server-side monitoring.
// Logic lives in handler.ts so `deno test` can run it against an in-memory database and a local server.
// Deploy: supabase functions deploy monitor --no-verify-jwt   (the scheduler call carries no JWT; user
// actions are checked inside). Schedule: supabase/monitor-cron.sql. Secret: MONITOR_CRON_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";
import type { DbClient } from "../_shared/db.ts";
import { createMonitorHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createMonitorHandler({
  asUser: (auth) => createClient(url, anonKey, { global: { headers: { Authorization: auth } } }) as unknown as DbClient,
  service: () => createClient(url, serviceKey, { auth: { persistSession: false } }) as unknown as DbClient,
  cronSecret: Deno.env.get("MONITOR_CRON_SECRET") ?? "",
  // allowPrivate is deliberately absent: a deployed worker never probes private address space
}));
