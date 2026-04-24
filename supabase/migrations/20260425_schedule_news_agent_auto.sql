create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'news-agent-auto-30m') then
    perform cron.schedule(
      'news-agent-auto-30m',
      '*/30 * * * *',
      $job$
      select
        net.http_post(
          url := 'https://ganberetmowmaidioryu.supabase.co/functions/v1/news-agent-auto',
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := '{}'::jsonb
        );
      $job$
    );
  end if;
end;
$$;
