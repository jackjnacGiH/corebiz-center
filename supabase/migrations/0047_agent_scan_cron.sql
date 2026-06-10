-- =========================================================================
-- 0047_agent_scan_cron.sql — schedule the Ops agent to run automatically
-- =========================================================================
-- Runs the (safe, read-only, no-LLM) ops scanner every 3 hours so the AI Agent
-- queue stays fresh without anyone clicking "สแกนใหม่". Falls back gracefully
-- if pg_cron is not available on the instance (the manual button still works).
-- =========================================================================

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not available, skipping schedule: %', sqlerrm;
  end;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'agent-ops-scan') then
      perform cron.unschedule('agent-ops-scan');
    end if;
    perform cron.schedule('agent-ops-scan', '0 */3 * * *', 'select public.agent_run_ops_scan();');
  end if;
end $$;
