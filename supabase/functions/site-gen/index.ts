// Before I Deploy — `site-gen` Edge Function entry point (Site Builder S3). Logic lives in handler.ts so
// `deno test` can run it against an in-memory database and a fake model.
//
// Deploy:  supabase functions deploy site-gen   (the cloud-deploy workflow does it)
// Secrets: ANTHROPIC_API_KEY (and ANTHROPIC_API_BASE for a proxy key) — the same ones ai-fix uses
import { createClient } from "npm:@supabase/supabase-js@2";
import type { DbClient } from "../_shared/db.ts";
import { createSiteGenHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createSiteGenHandler({
  asUser: (auth) => createClient(url, anonKey, { global: { headers: { Authorization: auth } } }) as unknown as DbClient,
  service: () => createClient(url, serviceKey, { auth: { persistSession: false } }) as unknown as DbClient,
  anthropicKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
  anthropicBase: Deno.env.get("ANTHROPIC_API_BASE") ?? "https://api.anthropic.com",
  // Codex (OpenAI): optional; the owner picks the engine in the app
  openaiKey: Deno.env.get("CODEX_API_KEY") ?? Deno.env.get("OPENAI_API_KEY") ?? "",
  openaiBase: Deno.env.get("OPENAI_API_BASE") ?? "https://api.openai.com",
  fetch: globalThis.fetch,
}));
