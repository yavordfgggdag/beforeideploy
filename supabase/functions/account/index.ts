// Before I Deploy — `account` Edge Function entry point (V10 WP5): GDPR export and account deletion.
// Logic lives in handler.ts so `deno test` can run it against an in-memory database.
// Deploy: supabase functions deploy account
import { createClient } from "npm:@supabase/supabase-js@2";
import type { DbClient } from "../_shared/db.ts";
import { createAccountHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const paddleKey = Deno.env.get("PADDLE_API_KEY") ?? "";
const paddleBase = Deno.env.get("PADDLE_ENV") === "live" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";

Deno.serve(createAccountHandler({
  asUser: (auth) => createClient(url, anonKey, { global: { headers: { Authorization: auth } } }) as unknown as DbClient,
  service: () => createClient(url, serviceKey, { auth: { persistSession: false } }) as unknown as DbClient,
  cancelPaddleSubscription: paddleKey
    ? async (id) => {
      const res = await fetch(`${paddleBase}/subscriptions/${id}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${paddleKey}`, "content-type": "application/json" },
        body: JSON.stringify({ effective_from: "immediately" }),
      });
      if (!res.ok && res.status !== 404) throw new Error(`Paddle cancel failed (${res.status})`);
    }
    : undefined,
}));
