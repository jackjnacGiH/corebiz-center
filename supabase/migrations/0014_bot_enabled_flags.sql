-- 0014_bot_enabled_flags.sql
-- Three-level bot pause system (per-chat, per-channel, global)
-- Lets admin take over a single conversation, mute all of one channel
-- (LINE / web widget / future Facebook), or kill-switch every channel at once.
--
-- Decision logic (enforced in rag-chat + line-webhook):
--   bot_replies = org_settings.bot_enabled
--               AND ai_personas[channel].bot_enabled
--               AND chat_conversations[id].bot_enabled
-- All three must be true. Anything false → silent (no auto-reply).

-- 1. Per-conversation toggle
alter table public.chat_conversations
  add column if not exists bot_enabled boolean not null default true;

-- 2. Per-channel toggle on the existing persona row
alter table public.ai_personas
  add column if not exists bot_enabled boolean not null default true;

-- 3. Global kill-switch lives on the existing singleton org_settings table
--    (this table already exists for business profile; we just extend it).
alter table public.org_settings
  add column if not exists bot_enabled boolean not null default true;

-- Ensure singleton row exists. The existing convention uses id = true.
insert into public.org_settings (id) values (true)
  on conflict do nothing;

-- Anon read so the web widget (anon JWT) can check the global flag.
-- Staff already manage org_settings via the existing policy.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_settings'
      and policyname = 'public_read_org_settings'
  ) then
    create policy "public_read_org_settings" on public.org_settings
      for select to anon, authenticated using (true);
  end if;
end$$;
