-- Omni-Chat performance Phase 0 + 1
-- Phase 0 adds privacy-safe latency telemetry to the existing staff-only table.
-- Phase 1 consolidates conversation-summary maintenance into one UPDATE/message.

alter table public.chat_ai_runs
  add column if not exists total_ms integer,
  add column if not exists first_token_ms integer,
  add column if not exists tool_ms integer,
  add column if not exists tool_iterations integer,
  add column if not exists line_reply_ms integer,
  add column if not exists end_to_end_ms integer,
  add column if not exists edge_region text,
  add column if not exists line_edge_region text,
  add column if not exists routing_variant text,
  add column if not exists content_kind text,
  add column if not exists phase_timings jsonb;

create unique index if not exists chat_ai_runs_request_id_uidx
  on public.chat_ai_runs (request_id);

-- Keep LINE webhook retries idempotent on restored/fresh environments too.
-- Production already has this index from a remote-only migration.
create unique index if not exists chat_messages_conversation_external_msg_uidx
  on public.chat_messages (conversation_id, external_msg_id)
  where external_msg_id is not null;

comment on column public.chat_ai_runs.total_ms is
  'Total rag-chat processing latency in milliseconds.';
comment on column public.chat_ai_runs.first_token_ms is
  'Latency until the first model text chunk in milliseconds.';
comment on column public.chat_ai_runs.tool_ms is
  'Cumulative tool execution latency in milliseconds.';
comment on column public.chat_ai_runs.tool_iterations is
  'Number of model rounds that executed one or more tools.';
comment on column public.chat_ai_runs.line_reply_ms is
  'LINE Reply API request latency in milliseconds; null for non-LINE runs.';
comment on column public.chat_ai_runs.end_to_end_ms is
  'LINE webhook processing latency through customer reply in milliseconds.';
comment on column public.chat_ai_runs.edge_region is
  'rag-chat Supabase Edge invocation region from SB_REGION.';
comment on column public.chat_ai_runs.line_edge_region is
  'line-webhook Supabase Edge invocation region from SB_REGION.';
comment on column public.chat_ai_runs.routing_variant is
  'Controlled rag-chat routing variant: direct, auto, or db_region.';
comment on column public.chat_ai_runs.content_kind is
  'Coarse request kind (text or image); contains no customer content.';
comment on column public.chat_ai_runs.phase_timings is
  'Privacy-safe phase timings only; never stores prompts or responses.';

create or replace function public.tg_chat_message_inserted()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.chat_conversations
  set
    last_message_at = case
      when last_message_at is null or NEW.created_at >= last_message_at
      then NEW.created_at
      else last_message_at
    end,
    last_message_preview = case
      when last_message_at is null or NEW.created_at >= last_message_at
      then left(NEW.content, 200)
      else last_message_preview
    end,
    unread_count = case
      when NEW.sender_type = 'customer' then unread_count + 1
      when NEW.sender_type = 'agent'
       and (
         last_customer_message_at is null
         or NEW.created_at >= last_customer_message_at
       )
      then 0
      else unread_count
    end,
    status = case
      when NEW.sender_type = 'customer' then 'open'
      else status
    end,
    last_customer_message_at = case
      when NEW.sender_type = 'customer'
       and (
         last_customer_message_at is null
         or last_customer_message_at < NEW.created_at
       )
      then NEW.created_at
      else last_customer_message_at
    end
  where id = NEW.conversation_id;

  return NEW;
end;
$$;

drop trigger if exists chat_message_inserted_trigger
  on public.chat_messages;
drop trigger if exists track_customer_message_trigger
  on public.chat_messages;

create trigger chat_message_inserted_trigger
  after insert on public.chat_messages
  for each row
  execute function public.tg_chat_message_inserted();

drop function if exists public.tg_track_customer_message();

comment on function public.tg_chat_message_inserted() is
  'Maintains the Omni-Chat conversation summary with one update per inserted message.';
