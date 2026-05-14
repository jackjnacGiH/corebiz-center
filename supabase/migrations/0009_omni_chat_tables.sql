-- =========================================================================
-- 0009_omni_chat_tables.sql
-- chat_conversations + chat_messages — for LINE / Messenger / IG / WhatsApp / livechat / email
-- =========================================================================

create table public.chat_conversations (
  id              uuid primary key default uuid_generate_v4(),
  channel         text not null check (channel in ('line','messenger','instagram','whatsapp','livechat','email')),
  external_id     text,
  customer_id     uuid references public.customers on delete set null,
  display_name    text not null,
  avatar_url      text,
  status          text not null default 'open' check (status in ('open','assigned','resolved','archived')),
  assigned_to     uuid references auth.users on delete set null,
  tags            text[] not null default '{}',
  sentiment       text check (sentiment in ('positive','neutral','negative')),
  unread_count    int not null default 0,
  last_message_preview text,
  last_message_at timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (channel, external_id)
);

create index chat_conv_channel_idx      on public.chat_conversations(channel, status);
create index chat_conv_last_message_idx on public.chat_conversations(last_message_at desc);
create index chat_conv_assigned_idx     on public.chat_conversations(assigned_to);

create table public.chat_messages (
  id              uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.chat_conversations on delete cascade,
  sender_type     text not null check (sender_type in ('customer','agent','bot','system')),
  sender_name     text,
  sender_id       uuid references auth.users on delete set null,
  content         text not null,
  content_type    text not null default 'text' check (content_type in ('text','image','sticker','file','quick_reply','template')),
  attachments     jsonb not null default '[]'::jsonb,
  metadata        jsonb not null default '{}'::jsonb,
  read_at         timestamptz,
  external_msg_id text,
  created_at      timestamptz not null default now()
);

create index chat_msg_conv_idx   on public.chat_messages(conversation_id, created_at);
create index chat_msg_sender_idx on public.chat_messages(sender_type, created_at desc);

create trigger set_updated_at_chat_conversations before update on public.chat_conversations
  for each row execute function public.set_updated_at();

create or replace function public.tg_chat_message_inserted()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.chat_conversations
  set last_message_at = NEW.created_at,
      last_message_preview = left(NEW.content, 200),
      unread_count = case when NEW.sender_type = 'customer' then unread_count + 1 else unread_count end
  where id = NEW.conversation_id;
  return NEW;
end;
$$;

drop trigger if exists chat_message_inserted_trigger on public.chat_messages;
create trigger chat_message_inserted_trigger
  after insert on public.chat_messages
  for each row execute function public.tg_chat_message_inserted();

alter table public.chat_conversations enable row level security;
alter table public.chat_messages      enable row level security;

create policy chat_conv_staff_all on public.chat_conversations
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy chat_msg_staff_all on public.chat_messages
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter publication supabase_realtime add table public.chat_conversations;
alter publication supabase_realtime add table public.chat_messages;
