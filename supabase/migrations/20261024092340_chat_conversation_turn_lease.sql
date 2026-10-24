-- Per-conversation processing lease. No master values, policies or grants change.
alter table public.chat_conversations
  add column if not exists bot_turn_token uuid,
  add column if not exists bot_turn_until timestamptz,
  add column if not exists bot_turn_revision bigint not null default 0;

comment on column public.chat_conversations.bot_turn_token is
  'Short-lived service-side lease, compared atomically before customer-event tools and replies. Never a customer authentication token.';
