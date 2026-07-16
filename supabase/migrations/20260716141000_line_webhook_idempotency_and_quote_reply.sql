-- Keep LINE replies single and idempotent.
--
-- LINE receives the public quote link through the webhook reply token. The
-- database trigger remains responsible for web-widget quote links, but must
-- not also push/store a separate LINE link or the customer sees duplicates.

create unique index if not exists chat_messages_conversation_external_msg_uidx
  on public.chat_messages (conversation_id, external_msg_id)
  where external_msg_id is not null;

create or replace function public.tg_send_quote_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_quote_id uuid; v_conv_id uuid; v_qtoken uuid; v_code text;
  v_channel text; v_msg text;
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

  -- Shipping is idempotent; retain the existing behavior for every channel.
  perform public.apply_quote_shipping(v_quote_id);

  select channel into v_channel from public.chat_conversations where id = v_conv_id;
  -- line-webhook sends one combined reply (status + public link) using the
  -- reply token. Do not insert or push a second link from this database trigger.
  if v_channel = 'line' then return new; end if;

  v_msg := '📄 ใบเสนอราคา ' || coalesce(v_code, '') || E'\nดูรายละเอียดและดาวน์โหลด PDF ได้เลย (ไม่ต้องล็อกอิน):' ||
           E'\nhttps://www.jnac.online/center/q/' || v_qtoken::text;

  insert into public.chat_messages (conversation_id, sender_type, content, content_type, metadata)
  values (v_conv_id, 'bot', v_msg, 'text', jsonb_build_object('quote_link', true, 'quote_id', v_quote_id));
  update public.chat_conversations
     set last_message_at = now(), last_message_preview = left(v_msg, 140)
   where id = v_conv_id;
  return new;
exception when others then
  return new;
end;
$$;
