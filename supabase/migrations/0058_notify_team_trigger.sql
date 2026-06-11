-- =========================================================================
-- 0058_notify_team_trigger.sql — LINE push to the team on important tasks
-- =========================================================================
-- After an important agent-queue task is inserted (new quote request, lead,
-- customer-link verification, customer quote response), fire-and-forget a
-- pg_net POST to the notify-team edge function, which pushes a LINE message
-- to every active owner/admin whose profile is linked to LINE
-- (profiles.line_user_id — i.e. they logged in with LINE at least once).
-- =========================================================================

create or replace function public.notify_team_on_agent_task()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'proposed' and new.kind in
     ('sales.quote_request', 'sales.lead', 'ops.verify_customer_link', 'sales.quote_response')
  then
    perform net.http_post(
      url := 'https://owoedccmuqnzdtxvywgt.supabase.co/functions/v1/notify-team',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-notify-key', 'corebiz_notify_team_2026_x7k9'),
      body := jsonb_build_object('task_id', new.id)
    );
  end if;
  return new;
exception when others then
  -- notification must never block the task insert
  return new;
end;
$$;

revoke execute on function public.notify_team_on_agent_task() from public, anon, authenticated;
grant execute on function public.notify_team_on_agent_task() to service_role;

drop trigger if exists trg_notify_team on public.agent_tasks;
create trigger trg_notify_team
  after insert on public.agent_tasks
  for each row execute function public.notify_team_on_agent_task();
