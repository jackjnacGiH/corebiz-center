-- =========================================================================
-- 0069_auto_shipping_on_bot_quotes.sql
-- Auto-append a shipping line (ค่าจัดส่งสินค้า) as the LAST line of every
-- quote the bot/system creates automatically. Default 100 THB, editable later
-- in the quote editor. The line has product_id = null (no stock / Inventory).
-- =========================================================================
-- Free-shipping exceptions (promo / customer tier) are handled manually for now
-- — the admin removes the line in the editor. (tier_benefits has no free-shipping
-- flag yet; can be automated later by skipping this call for those tiers.)
-- =========================================================================

create or replace function public.apply_quote_shipping(p_quote_id uuid, p_fee numeric default 100)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_subtotal numeric; v_disc numeric; v_net numeric; v_vat numeric;
begin
  if p_quote_id is null then return; end if;
  -- already has a shipping line → no-op (idempotent)
  if exists (select 1 from public.quote_items where quote_id = p_quote_id and sku = 'SHIPPING') then return; end if;
  -- only add when the quote actually has product lines
  if not exists (select 1 from public.quote_items where quote_id = p_quote_id) then return; end if;

  insert into public.quote_items (quote_id, product_id, sku, product_name, quantity, unit_price, discount, total, unit)
  values (p_quote_id, null, 'SHIPPING', 'ค่าจัดส่งสินค้า', 1, p_fee, 0, p_fee, null);

  select coalesce(sum(total), 0) into v_subtotal from public.quote_items where quote_id = p_quote_id;
  select coalesce(discount, 0) into v_disc from public.quotes where id = p_quote_id;
  v_net := greatest(0, v_subtotal - v_disc);
  v_vat := round(v_net * 0.07, 2);
  update public.quotes set subtotal = v_subtotal, vat = v_vat, total = (v_net + v_vat) where id = p_quote_id;
end;
$$;
revoke execute on function public.apply_quote_shipping(uuid, numeric) from public, anon;
grant  execute on function public.apply_quote_shipping(uuid, numeric) to authenticated, service_role;

-- Web bot quotes: trg_send_quote_link fires on the agent_task (after quote_items
-- exist) and only for conversation-bound (web) quotes. Add the shipping call
-- there. (LINE quotes early-return here — line-webhook handles them.)
create or replace function public.tg_send_quote_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_quote_id uuid; v_conv_id uuid; v_qtoken uuid; v_code text;
  v_channel text; v_ext text; v_line_token text; v_msg text;
begin
  if new.kind <> 'sales.quote_request' then return new; end if;
  v_quote_id := nullif(new.payload->>'quote_id', '')::uuid;
  v_conv_id  := nullif(new.payload->>'conversation_id', '')::uuid;
  if v_quote_id is null or v_conv_id is null then return new; end if;

  select public_token, code into v_qtoken, v_code from public.quotes where id = v_quote_id;
  if v_qtoken is null then return new; end if;

  update public.quotes q
     set customer_id = cc.customer_id
    from public.chat_conversations cc
   where cc.id = v_conv_id and q.id = v_quote_id
     and q.customer_id is null and cc.customer_id is not null;

  -- auto-append the shipping line (idempotent)
  perform public.apply_quote_shipping(v_quote_id);

  v_msg := '📄 ใบเสนอราคา ' || coalesce(v_code, '') || E'\nดูรายละเอียดและดาวน์โหลด PDF ได้เลย (ไม่ต้องล็อกอิน):' ||
           E'\nhttps://www.jnac.online/center/q/' || v_qtoken::text;

  insert into public.chat_messages (conversation_id, sender_type, content, content_type, metadata)
  values (v_conv_id, 'bot', v_msg, 'text', jsonb_build_object('quote_link', true, 'quote_id', v_quote_id));
  update public.chat_conversations
     set last_message_at = now(), last_message_preview = left(v_msg, 140)
   where id = v_conv_id;

  select channel, external_id into v_channel, v_ext from public.chat_conversations where id = v_conv_id;
  if v_channel = 'line' and v_ext is not null then
    select channel_access_token into v_line_token from public.line_channels where is_active = true limit 1;
    if v_line_token is not null then
      perform net.http_post(
        url := 'https://api.line.me/v2/bot/message/push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_line_token),
        body := jsonb_build_object('to', v_ext,
          'messages', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_msg)))
      );
    end if;
  end if;
  return new;
exception when others then
  return new;
end;
$$;
