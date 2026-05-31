-- 0016_new_customer_message_reopens_unread.sql
--
-- Boss Jack: any NEW customer message must resurface the chat as "ยังไม่อ่าน"
-- (status 'open') regardless of its current status — especially when it was
-- already "เสร็จสิ้น" (resolved) — because it's a new message the admin hasn't
-- read yet. The trigger fires on every channel's chat_messages insert (LINE
-- webhook, web livechat via service role, etc.), so this single function is
-- the universal spot. Only customer messages re-open; bot/agent/system don't.
-- Recreated with the exact same context as the live function (no SECURITY
-- DEFINER, search_path=public) plus the new status line.
create or replace function public.tg_chat_message_inserted()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.chat_conversations
  set last_message_at = NEW.created_at,
      last_message_preview = left(NEW.content, 200),
      unread_count = case when NEW.sender_type = 'customer'
                          then unread_count + 1
                          else unread_count end,
      -- A new customer message always re-opens the chat as Unread.
      status = case when NEW.sender_type = 'customer'
                    then 'open'
                    else status end
  where id = NEW.conversation_id;
  return NEW;
end;
$$;
