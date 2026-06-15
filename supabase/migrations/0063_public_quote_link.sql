-- =========================================================================
-- 0063_public_quote_link.sql
-- Public (no-login) quote view + auto-send the link into the chat.
-- =========================================================================
-- Customers who never registered can't open the portal "/account" link, so:
--   1. each quote gets an unguessable public_token,
--   2. get_quote_by_token() lets a public page render it (anon-callable;
--      the token is the secret — same model as survey links),
--   3. when the bot creates a quote from chat, a trigger drops a message with
--      the public link into the conversation and pushes it to the customer on
--      LINE — so they can view + download the PDF without logging in.
-- =========================================================================

-- 1) per-quote public token -------------------------------------------------
alter table public.quotes add column if not exists public_token uuid not null default gen_random_uuid();
create unique index if not exists quotes_public_token_idx on public.quotes(public_token);

-- 2) public reader ----------------------------------------------------------
create or replace function public.get_quote_by_token(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  if p_token is null then return null; end if;
  select jsonb_build_object(
    'code', q.code,
    'created_at', q.created_at,
    'valid_until', q.valid_until,
    'status', q.status,
    'customer_name', coalesce(c.name, ''),
    'customer_billing_address', c.billing_address,
    'customer_tax_id', c.tax_id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku', qi.sku, 'product_name', qi.product_name,
        'quantity', qi.quantity, 'unit_price', qi.unit_price, 'total', qi.total) order by qi.id)
      from public.quote_items qi where qi.quote_id = q.id), '[]'::jsonb),
    'subtotal', q.subtotal, 'discount', q.discount, 'vat', q.vat, 'total', q.total,
    'notes', q.notes
  )
  into v
  from public.quotes q
  left join public.customers c on c.id = q.customer_id
  where q.public_token = p_token;
  return v; -- null when not found
end;
$$;
revoke execute on function public.get_quote_by_token(uuid) from public;
grant  execute on function public.get_quote_by_token(uuid) to anon, authenticated;

-- 3) send the public link into the chat when the bot creates a quote --------
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

  v_msg := '📄 ใบเสนอราคา ' || coalesce(v_code, '') || E'\nดูรายละเอียดและดาวน์โหลด PDF ได้เลย (ไม่ต้องล็อกอิน):' ||
           E'\nhttps://www.jnac.online/center/q/' || v_qtoken::text;

  -- record in the conversation (admin inbox + web widget customer)
  insert into public.chat_messages (conversation_id, sender_type, content, content_type, metadata)
  values (v_conv_id, 'bot', v_msg, 'text', jsonb_build_object('quote_link', true, 'quote_id', v_quote_id));
  update public.chat_conversations
     set last_message_at = now(), last_message_preview = left(v_msg, 140)
   where id = v_conv_id;

  -- push to the customer on LINE (web widget already shows the inserted row)
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
revoke execute on function public.tg_send_quote_link() from public, anon, authenticated;
grant  execute on function public.tg_send_quote_link() to service_role;

drop trigger if exists trg_send_quote_link on public.agent_tasks;
create trigger trg_send_quote_link
  after insert on public.agent_tasks
  for each row execute function public.tg_send_quote_link();
