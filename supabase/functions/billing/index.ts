// Before I Deploy — `billing` Edge Function entry point (V10 WP4). Logic in handler.ts.
//
// Deploy:  supabase functions deploy billing --no-verify-jwt     (Paddle's webhook carries no JWT; user
//          actions are checked inside the handler with the caller's token)
// Secrets: supabase secrets set PADDLE_API_KEY=… PADDLE_WEBHOOK_SECRET=… PADDLE_ENV=sandbox|live
// Paddle:  Developer tools → Notifications → new destination: <SUPABASE_URL>/functions/v1/billing,
//          events subscription.* and transaction.completed.
import { createClient } from "npm:@supabase/supabase-js@2";
import type { DbClient } from "../_shared/db.ts";
import { createBillingHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createBillingHandler({
  asUser: (auth) => createClient(url, anonKey, { global: { headers: { Authorization: auth } } }) as unknown as DbClient,
  service: () => createClient(url, serviceKey, { auth: { persistSession: false } }) as unknown as DbClient,
  paddleApiKey: Deno.env.get("PADDLE_API_KEY") ?? "",
  paddleWebhookSecret: Deno.env.get("PADDLE_WEBHOOK_SECRET") ?? "",
  paddleApiBase: Deno.env.get("PADDLE_ENV") === "live" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com",
  fetch: globalThis.fetch,
}));
