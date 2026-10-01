// Before I Deploy — `ai-fix` Edge Function entry point (V10 WP3). Logic lives in handler.ts so
// `deno test` can run it against an in-memory database and a fake Anthropic stream.
//
// Deploy:  supabase functions deploy ai-fix
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-…   (SUPABASE_* are injected automatically)
import { createClient } from "npm:@supabase/supabase-js@2";
import type { DbClient } from "../_shared/db.ts";
import { createAiFixHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createAiFixHandler({
  asUser: (auth) => createClient(url, anonKey, { global: { headers: { Authorization: auth } } }) as unknown as DbClient,
  service: () => createClient(url, serviceKey, { auth: { persistSession: false } }) as unknown as DbClient,
  anthropicKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
  anthropicBase: Deno.env.get("ANTHROPIC_API_BASE") ?? "https://api.anthropic.com",
  fetch: globalThis.fetch,
}));
