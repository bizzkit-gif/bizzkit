-- Run once in Supabase SQL Editor after `db push` on a NEW project.
-- Replace YOUR_PROJECT_REF with the subdomain of your API URL (e.g. `abcd` from `https://abcd.supabase.co`).
-- Schedules pg_cron to call Edge Function `news-agent-auto` every 30 minutes.

do $$
declare
  ref text := 'YOUR_PROJECT_REF';
  fn_url text;
begin
  if ref = 'YOUR_PROJECT_REF' then
    raise exception 'Edit this file: set ref to your project subdomain, then run again.';
  end if;
  fn_url := 'https://' || ref || '.supabase.co/functions/v1/news-agent-auto';

  for j in (select jobid from cron.job where jobname = 'news-agent-auto-30m')
  loop
    perform cron.unschedule(j.jobid);
  end loop;

  perform cron.schedule(
    'news-agent-auto-30m',
    '*/30 * * * *',
    format(
      $cmd$select net.http_post(url := %L, headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);$cmd$,
      fn_url
    )
  );
end;
$$;
