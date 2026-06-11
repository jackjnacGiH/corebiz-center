-- =========================================================================
-- 0055_reject_cleanup_and_portal_contacts.sql
-- =========================================================================
-- A4: rejecting a link request now DELETES the agent-queue task (instead of
--     dismissing it) so a re-registration creates a fresh notification; the
--     audit_logs row remains as the permanent record.
-- A5: staff RPC for the Customer 360° drawer — list the portal login
--     contacts of a customer (name + mobile per login, login e-mail from
--     auth.users, verification state).
-- =========================================================================

create or replace function public.reject_customer_link(p_contact_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text; v_user uuid; v_cust uuid;
begin
  select role into v_role from public.profiles where id = auth.uid() and is_active;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'forbidden: owner/admin only';
  end if;

  delete from public.customer_contacts
   where id = p_contact_id and not verified
  returning user_id, customer_id into v_user, v_cust;
  if v_user is null then raise exception 'not_found'; end if;

  -- Remove the queue task entirely — audit_logs keeps the history, and a
  -- future re-registration can then raise a brand-new notification.
  delete from public.agent_tasks
   where dedupe_key = 'verify_link:' || v_user::text;

  insert into public.audit_logs (actor_id, action, target_type, target_id, detail)
  values (auth.uid(), 'customer.link_rejected', 'customer', v_cust::text,
          jsonb_build_object('contact_id', p_contact_id, 'user_id', v_user));
end;
$$;

-- Portal contacts of a customer, for the back-office 360° profile.
create or replace function public.list_customer_portal_contacts(p_customer_id uuid)
returns table (contact_id uuid, contact_name text, phone text, login_email text,
               verified boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select cc.id, cc.contact_name, cc.phone, u.email, cc.verified, cc.created_at
  from public.customer_contacts cc
  join auth.users u on u.id = cc.user_id
  where cc.customer_id = p_customer_id
    and public.is_staff()
  order by cc.created_at;
$$;

revoke execute on function public.list_customer_portal_contacts(uuid) from public, anon;
grant execute on function public.list_customer_portal_contacts(uuid) to authenticated;
