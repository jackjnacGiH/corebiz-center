-- =========================================================================
-- 0064_quote_autolink_customer.sql
-- Auto-fill the customer on bot-created quotes.
-- =========================================================================
-- The bot's request_quote tool inserts a quote with customer_id = null, so the
-- quote (and its PDF / public link) showed no customer name/address and an
-- admin had to pick the customer by hand — even when the chat is already linked
-- to a CRM customer. When the bot creates a quote from a conversation that IS
-- linked (chat_conversations.customer_id), stamp that customer onto the quote.
--
-- This trigger covers the WEB-widget channel (its agent_task carries
-- conversation_id). The LINE channel — whose agent_task has no conversation_id —
-- is handled in the line-webhook edge function, which has the conversation in
-- hand right after the bot reply.
-- =========================================================================

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

  -- auto-link the quote to the conversation's CRM customer (only if the quote
  -- has none yet — never override a manual selection)
  update public.quotes q
     set customer_id = cc.customer_id
    from public.chat_conversations cc
   where cc.id = v_conv_id and q.id = v_quote_id
     and q.customer_id is null and cc.customer_id is not null;

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
  return new; -- never block task insert / notify
end;
$$;
