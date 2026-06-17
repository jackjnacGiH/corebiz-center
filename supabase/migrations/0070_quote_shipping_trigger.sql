-- =========================================================================
-- 0070_quote_shipping_trigger.sql
-- One trigger to auto-append the shipping line to EVERY bot/system quote,
-- both LINE and web. The agent_task (kind='sales.quote_request') is inserted by
-- rag-chat right after the quote + quote_items, and its payload carries the
-- quote_id for both channels — so a trigger here covers both. apply_quote_shipping
-- is idempotent, so the redundant call from tg_send_quote_link (web) is a no-op.
-- =========================================================================

create or replace function public.tg_agent_task_shipping()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'sales.quote_request' then
    perform public.apply_quote_shipping(nullif(new.payload->>'quote_id', '')::uuid);
  end if;
  return new;
exception when others then
  return new; -- never block the task insert
end;
$$;

drop trigger if exists trg_quote_auto_shipping on public.agent_tasks;
create trigger trg_quote_auto_shipping
  after insert on public.agent_tasks
  for each row execute function public.tg_agent_task_shipping();
