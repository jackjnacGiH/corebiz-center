-- =========================================================================
-- 0057_respond_my_quote.sql — portal: customer accepts / declines a quote
-- =========================================================================
-- A VERIFIED member can accept or decline their own quote from "บัญชีของฉัน".
-- Accept → status 'accepted' + a high-priority agent task telling staff to
-- convert it to a sales order (the existing อนุมัติ → สร้างคำสั่งซื้อ flow).
-- Decline → status 'rejected' + a normal-priority task for follow-up.
-- Both are audit-logged. Pending (unverified) links can't see quotes at all
-- (my_customer_id() is verified-only), so they can't respond either.
-- =========================================================================

create or replace function public.respond_my_quote(p_quote_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_cust uuid;
  v_code text;
  v_status text;
  v_total numeric;
  v_new text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  v_cust := public.my_customer_id();
  if v_cust is null then raise exception 'not_linked'; end if;

  select code, status, total into v_code, v_status, v_total
  from public.quotes where id = p_quote_id and customer_id = v_cust;
  if v_code is null then raise exception 'not_found'; end if;
  if v_status not in ('draft','sent') then raise exception 'not_actionable:%', v_status; end if;

  v_new := case when p_accept then 'accepted' else 'rejected' end;
  update public.quotes set status = v_new, updated_at = now() where id = p_quote_id;

  insert into public.agent_tasks
    (category, kind, action_kind, title, summary, recommendation,
     payload, status, requires_approval, priority, related_type, related_id,
     dedupe_key, source)
  values
    ('sales', 'sales.quote_response', 'none',
     case when p_accept
       then '✅ ลูกค้าตอบรับใบเสนอราคา ' || v_code
       else '❌ ลูกค้าปฏิเสธใบเสนอราคา ' || v_code end,
     'ลูกค้ากด' || (case when p_accept then 'ตอบรับ' else 'ปฏิเสธ' end) ||
       'จากหน้า บัญชีของฉัน · ยอดสุทธิ ' || coalesce(v_total::text, '-') || ' บาท',
     case when p_accept
       then 'เปิดใบเสนอราคา ' || v_code || ' แล้วกด อนุมัติ → สร้างคำสั่งซื้อ จากนั้นยืนยันการจัดส่ง/ชำระเงินกับลูกค้า'
       else 'ติดต่อลูกค้าเพื่อสอบถามเหตุผล/เสนอเงื่อนไขใหม่' end,
     jsonb_build_object('quote_id', p_quote_id, 'quote_code', v_code,
                        'accepted', p_accept, 'user_id', v_uid, 'customer_id', v_cust),
     'proposed', true, case when p_accept then 1 else 2 end,
     'quote', p_quote_id::text,
     'quote_response:' || p_quote_id::text, 'portal')
  on conflict (dedupe_key) do nothing;

  insert into public.audit_logs (actor_id, action, target_type, target_id, detail)
  values (v_uid,
          case when p_accept then 'quote.customer_accepted' else 'quote.customer_rejected' end,
          'quote', p_quote_id::text,
          jsonb_build_object('code', v_code, 'customer_id', v_cust));

  return v_new;
end;
$$;

revoke execute on function public.respond_my_quote(uuid, boolean) from public, anon;
grant execute on function public.respond_my_quote(uuid, boolean) to authenticated;
