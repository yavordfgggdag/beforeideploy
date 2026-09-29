-- Before I Deploy — server-side monitoring scheduler (V11 RC). Run once in Supabase → SQL Editor AFTER
-- schema.sql and after `supabase functions deploy monitor --no-verify-jwt`.
--
-- The scheduler is pg_cron calling the `monitor` Edge Function through pg_net every 5 minutes. The function
-- probes only the targets that are due (each target has its own interval, ≥ 5 min) and at most 25 per call.
-- Until the first heartbeat row appears, `bid monitor cloud status` reports the scheduler as "never" and
-- the app says monitoring is not active server-side — nothing pretends to run.
--
-- Replace the two placeholders. The secret must equal the function secret:
--   supabase secrets set MONITOR_CRON_SECRET=<long random string>

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- keep the URL and secret out of the cron command text: Vault
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/monitor', 'bid_monitor_url');
select vault.create_secret('<MONITOR_CRON_SECRET>', 'bid_monitor_secret');

-- idempotent: re-running replaces the job
select cron.unschedule('bid-monitor') where exists (select 1 from cron.job where jobname = 'bid-monitor');
select cron.schedule(
  'bid-monitor',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'bid_monitor_url'),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-monitor-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bid_monitor_secret')
    ),
    body := '{"action":"run"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Health check (after 5–10 minutes): a heartbeat row must exist and keep advancing.
--   select at, checked, due, targets from public.monitor_heartbeat order by at desc limit 3;
--   select jobid, status, return_message, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'bid-monitor') order by start_time desc limit 5;
