-- =========================================================================
-- 0062_search_note_conversations.sql
-- Inbox search that also covers contact notes (ใบกำกับภาษี / โน้ต):
-- company name, tax id, address, phone, and free-text content.
-- Returns the conversation ids whose notes match a term; the inbox query
-- ORs these into its display_name / preview search. Staff-only.
-- =========================================================================

create or replace function public.search_note_conversation_ids(p_term text)
returns table(conversation_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return; end if;
  if p_term is null or length(btrim(p_term)) = 0 then return; end if;

  return query
    select distinct n.conversation_id
    from public.chat_contact_notes n
    where n.content ilike '%' || p_term || '%'
       or n.title   ilike '%' || p_term || '%'
       or coalesce(n.address->>'company','')     ilike '%' || p_term || '%'
       or coalesce(n.address->>'name','')        ilike '%' || p_term || '%'
       or coalesce(n.address->>'tax_id','')      ilike '%' || p_term || '%'
       or coalesce(n.address->>'phone','')       ilike '%' || p_term || '%'
       or coalesce(n.address->>'line1','')       ilike '%' || p_term || '%'
       or coalesce(n.address->>'subdistrict','') ilike '%' || p_term || '%'
       or coalesce(n.address->>'district','')    ilike '%' || p_term || '%'
       or coalesce(n.address->>'province','')    ilike '%' || p_term || '%'
       or coalesce(n.address->>'postcode','')    ilike '%' || p_term || '%';
end;
$$;

revoke execute on function public.search_note_conversation_ids(text) from public, anon;
grant  execute on function public.search_note_conversation_ids(text) to authenticated;
