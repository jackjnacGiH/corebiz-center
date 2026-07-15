-- The browser calls bot-learning-admin instead of PostgREST for these
-- tables. Keep RLS as defence in depth, but remove authenticated table grants
-- so non-staff accounts cannot discover the learning schema through GraphQL.
revoke all on table public.bot_learning_settings from authenticated;
revoke all on table public.bot_conversation_memory from authenticated;
revoke all on table public.bot_learning_candidates from authenticated;

grant all on table public.bot_learning_settings to service_role;
grant all on table public.bot_conversation_memory to service_role;
grant all on table public.bot_learning_candidates to service_role;
