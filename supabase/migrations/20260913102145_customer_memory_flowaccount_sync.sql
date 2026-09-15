-- Customer-aware conversation memory and safe FlowAccount MCP synchronization.
--
-- Conversation continuity is bounded, redacted, customer-scoped and updated by
-- a monotonic service RPC. FlowAccount OAuth metadata and normalized price
-- generations live in the private pricing schema. OAuth/access credentials
-- never live in application tables: the four fixed credential names are read
-- and written only through service-role Vault RPCs.

create schema if not exists pricing_private;

revoke all on schema pricing_private from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- Bounded conversation memory
-- -------------------------------------------------------------------------

alter table public.bot_learning_settings
  add column if not exists structured_memory_enabled boolean not null default false;

create or replace function pricing_private.memory_text_is_safe(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null
    and p_value !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}'
    and p_value !~ '(^|[^0-9])((\+|00)?66|0)([[:space:]./()-]*[0-9]){8,9}([^0-9]|$)'
    and p_value !~ '(^|[^0-9])([0-9][[:space:]./()_-]*){12}[0-9]([^0-9]|$)'
    and p_value !~* '(฿[[:space:]]*[0-9]|[0-9][0-9,.]*[[:space:]]*(บาท|THB))'
    and p_value !~ '^[[:space:]]*((คุณ|นาย|นาง|นางสาว)[[:space:]]*)?[ก-๙]{2,30}[[:space:]]+[ก-๙]{2,30}[[:space:]]*$'
    and p_value !~* '(^|[[:space:],])([0-9]{1,5}(/[0-9]{1,5})?[[:space:]]+)?[^,[:cntrl:]]{0,80}(สุขุมวิท|กรุงเทพ(มหานคร|ฯ)?|บางนา|ลาดพร้าว|รามอินทรา|พหลโยธิน|แจ้งวัฒนะ|พระราม)[^,[:cntrl:]]{0,80}';
$$;

create or replace function pricing_private.memory_topics_are_safe(p_topics text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_topics is not null
    and cardinality(p_topics) <= 8
    and not exists (
      select 1
      from unnest(p_topics) as topic
      where topic is null
          or topic <> btrim(topic)
          or char_length(topic) not between 1 and 80
          or topic ~ '[[:cntrl:]]'
          or not pricing_private.memory_text_is_safe(topic)
    )
    and cardinality(p_topics) = (
      select count(distinct lower(topic))
      from unnest(p_topics) as topic
    );
$$;

create or replace function pricing_private.memory_locked_fields_are_safe(p_fields text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_fields is not null
    and cardinality(p_fields) <= 32
    and not exists (
      select 1
      from unnest(p_fields) as field_name
      where field_name is null
         or field_name !~ '^[a-z][a-z0-9_]{0,63}$'
    )
    and cardinality(p_fields) = (
      select count(distinct field_name)
      from unnest(p_fields) as field_name
    );
$$;

create or replace function pricing_private.memory_json_value_is_safe(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_child jsonb;
  v_forbidden constant text[] := array[
    'token', 'access_token', 'refresh_token', 'secret', 'password',
    'tax_id', 'email', 'phone', 'address', 'billing_address',
    'shipping_address', 'bank_account', 'cost', 'margin', 'buying_price',
    'unit_price', 'price', 'transcript', 'raw_transcript', 'messages'
  ];
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in
      select key, value from jsonb_each(p_value)
    loop
      if lower(v_key) = any(v_forbidden) or v_key ~ '[[:cntrl:]]' then
        return false;
      end if;
      if not pricing_private.memory_json_value_is_safe(v_child) then
        return false;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if not pricing_private.memory_json_value_is_safe(v_child) then
        return false;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'string' then
    return pricing_private.memory_text_is_safe(p_value #>> '{}');
  end if;

  return true;
end;
$$;

create or replace function pricing_private.memory_state_is_safe(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_child jsonb;
  v_text text;
begin
  if p_value is null
     or jsonb_typeof(p_value) <> 'object'
     or octet_length(p_value::text) > 16384
     or not pricing_private.memory_json_value_is_safe(p_value) then
    return false;
  end if;

  if p_value ? 'confirmed_facts' then
    if jsonb_typeof(p_value->'confirmed_facts') is distinct from 'array' then
      return false;
    end if;
    if jsonb_array_length(p_value->'confirmed_facts') > 12 then
      return false;
    end if;
    for v_child in select value from jsonb_array_elements(p_value->'confirmed_facts')
    loop
      if jsonb_typeof(v_child) is distinct from 'string' then
        return false;
      end if;
      v_text := v_child #>> '{}';
      if v_text !~* '^(product|sku|size|grit|unit|quantity|application|machine|material|holes|backing)=[^=[:cntrl:]]{1,120}$'
         or not pricing_private.memory_text_is_safe(v_text)
         or not pricing_private.memory_text_is_safe(split_part(v_text, '=', 2)) then
        return false;
      end if;
    end loop;
  end if;

  if p_value ? 'pending_questions' then
    if jsonb_typeof(p_value->'pending_questions') is distinct from 'array' then
      return false;
    end if;
    if jsonb_array_length(p_value->'pending_questions') > 8 then
      return false;
    end if;
    for v_child in select value from jsonb_array_elements(p_value->'pending_questions')
    loop
      if jsonb_typeof(v_child) is distinct from 'string'
         or lower(v_child #>> '{}') <> all(array[
           'product','sku','size','grit','unit','quantity','application','machine',
           'material','holes','backing'
         ]) then
        return false;
      end if;
    end loop;
  end if;

  if p_value ? 'preferences' then
    if jsonb_typeof(p_value->'preferences') is distinct from 'array' then
      return false;
    end if;
    if jsonb_array_length(p_value->'preferences') > 8 then
      return false;
    end if;
    for v_child in select value from jsonb_array_elements(p_value->'preferences')
    loop
      if jsonb_typeof(v_child) is distinct from 'string'
         or lower(v_child #>> '{}') <> all(array[
           'ตอบสั้น','ตอบกระชับ','ภาษาไทย','ภาษาอังกฤษ',
           'thai','english','brief','concise'
         ]) then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$$;

alter table public.bot_conversation_memory
  add column if not exists customer_id uuid
    references public.customers(id) on delete set null,
  add column if not exists structured_state jsonb not null default '{}'::jsonb,
  add column if not exists locked_fields text[] not null default '{}',
  add column if not exists last_turn_at timestamptz,
  add column if not exists staff_note text,
  add column if not exists staff_locked boolean not null default false;

-- Existing summaries are transient context. Scrub any legacy row that would
-- violate the new no-PII/no-price memory boundary before constraints apply.
update public.bot_conversation_memory
set summary = 'บริบทเดิมถูกล้างเพื่อความปลอดภัย',
    topics = '{}'::text[],
    structured_state = '{}'::jsonb,
    locked_fields = '{}'::text[],
    staff_note = null,
    staff_locked = false,
    updated_at = statement_timestamp()
where not pricing_private.memory_text_is_safe(summary)
   or not pricing_private.memory_topics_are_safe(topics)
   or not pricing_private.memory_state_is_safe(structured_state)
   or (staff_note is not null and not pricing_private.memory_text_is_safe(staff_note));

-- Bind legacy summary-only rows to their current conversation identity and
-- establish a monotonic baseline before the new RPC becomes the sole writer.
update public.bot_conversation_memory as memory
set customer_id = conversation.customer_id,
    last_turn_at = coalesce(memory.last_turn_at, memory.updated_at)
from public.chat_conversations as conversation
where conversation.id = memory.conversation_id
  and (
    memory.customer_id is distinct from conversation.customer_id
    or memory.last_turn_at is null
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bot_conversation_memory_summary_content_check'
      and conrelid = 'public.bot_conversation_memory'::regclass
  ) then
    alter table public.bot_conversation_memory
      add constraint bot_conversation_memory_summary_content_check
      check (pricing_private.memory_text_is_safe(summary));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'bot_conversation_memory_topics_content_check'
      and conrelid = 'public.bot_conversation_memory'::regclass
  ) then
    alter table public.bot_conversation_memory
      add constraint bot_conversation_memory_topics_content_check
      check (pricing_private.memory_topics_are_safe(topics));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'bot_conversation_memory_structured_state_check'
      and conrelid = 'public.bot_conversation_memory'::regclass
  ) then
    alter table public.bot_conversation_memory
      add constraint bot_conversation_memory_structured_state_check
      check (pricing_private.memory_state_is_safe(structured_state));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'bot_conversation_memory_locked_fields_check'
      and conrelid = 'public.bot_conversation_memory'::regclass
  ) then
    alter table public.bot_conversation_memory
      add constraint bot_conversation_memory_locked_fields_check
      check (pricing_private.memory_locked_fields_are_safe(locked_fields));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'bot_conversation_memory_staff_note_check'
      and conrelid = 'public.bot_conversation_memory'::regclass
  ) then
    alter table public.bot_conversation_memory
      add constraint bot_conversation_memory_staff_note_check
      check (
        staff_note is null
        or (
           char_length(staff_note) between 1 and 1000
           and staff_note = btrim(staff_note)
           and staff_note !~ '[[:cntrl:]]'
           and pricing_private.memory_text_is_safe(staff_note)
        )
      );
  end if;
end;
$$;

create index if not exists bot_conversation_memory_customer_turn_idx
  on public.bot_conversation_memory (customer_id, last_turn_at desc)
  where customer_id is not null;

create index if not exists customers_flowaccount_normalized_tax_idx
  on public.customers (
    (regexp_replace(coalesce(tax_id, ''), '[^0-9]', '', 'g'))
  )
  where length(regexp_replace(coalesce(tax_id, ''), '[^0-9]', '', 'g')) = 13;

create index if not exists products_flowaccount_sku_unit_idx
  on public.products (upper(btrim(sku)), lower(btrim(unit)))
  where status = 'active';

-- Keep unmatched FlowAccount product codes as explicitly rejected generation
-- rows. They become eligible on a later sync after the product is added to
-- CoreBiz, while every source row remains accounted for in this generation.
alter table pricing_private.flowaccount_quote_price_cache
  alter column product_id drop not null;

create index if not exists flowaccount_price_cache_customer_history_idx
  on pricing_private.flowaccount_quote_price_cache
    (customer_id, sync_run_id, source_updated_at desc, id)
  where eligible and currency = 'THB';

create table if not exists pricing_private.bot_conversation_identity_epochs (
  conversation_id uuid primary key
    references public.chat_conversations(id) on delete cascade,
  identity_changed_at timestamptz not null default statement_timestamp()
);
alter table pricing_private.bot_conversation_identity_epochs enable row level security;
revoke all on table pricing_private.bot_conversation_identity_epochs
  from public, anon, authenticated, service_role;

create or replace function public.clear_bot_conversation_memory_on_identity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.external_id is distinct from new.external_id
     or old.channel is distinct from new.channel then
    -- A conversation row may be reused by an ingestion repair or channel
    -- migration. Its previous CRM link and verification markers belong to the
    -- old external identity and must be proven again for the new one.
    new.customer_id := null;
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      - 'quote_customer_link_method'
      - 'quote_customer_linked_at'
      - 'price_history_verified_at';
  end if;

  if old.customer_id is distinct from new.customer_id
     or old.external_id is distinct from new.external_id
     or old.channel is distinct from new.channel then
    insert into pricing_private.bot_conversation_identity_epochs (
      conversation_id, identity_changed_at
    ) values (
      new.id, statement_timestamp()
    )
    on conflict (conversation_id) do update
    set identity_changed_at = excluded.identity_changed_at;

    delete from public.bot_conversation_memory
    where conversation_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_bot_memory_on_identity_change
  on public.chat_conversations;
create trigger clear_bot_memory_on_identity_change
before update of customer_id, external_id, channel on public.chat_conversations
for each row execute function public.clear_bot_conversation_memory_on_identity_change();

revoke all on function public.clear_bot_conversation_memory_on_identity_change()
  from public, anon, authenticated, service_role;

create or replace function public.upsert_bot_conversation_memory_state(
  p_conversation_id uuid,
  p_summary text,
  p_topics text[],
  p_structured_state jsonb,
  p_source_channel text,
  p_expires_at timestamptz,
  p_turn_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_channel text;
  v_existing public.bot_conversation_memory%rowtype;
  v_merged_state jsonb;
  v_locked_key text;
  v_identity_changed_at timestamptz;
begin
  if p_conversation_id is null
     or p_summary is null
     or p_summary <> btrim(p_summary)
     or char_length(p_summary) not between 1 and 600
     or p_summary ~ '[[:cntrl:]]'
     or not pricing_private.memory_text_is_safe(p_summary)
     or p_topics is null
     or not pricing_private.memory_topics_are_safe(p_topics)
     or p_structured_state is null
     or not pricing_private.memory_state_is_safe(p_structured_state)
     or p_source_channel is null
     or p_source_channel <> btrim(p_source_channel)
     or char_length(p_source_channel) not between 1 and 32
     or p_turn_at is null
     or p_expires_at is null
     or p_expires_at <= p_turn_at
     or p_expires_at <= statement_timestamp()
     or p_expires_at > p_turn_at + interval '365 days'
     or p_turn_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'invalid_conversation_memory_state'
      using errcode = '22023';
  end if;

  select conversation.customer_id, conversation.channel
    into v_customer_id, v_channel
  from public.chat_conversations as conversation
  where conversation.id = p_conversation_id
  for update;

  if not found or v_channel is distinct from p_source_channel then
    return false;
  end if;

  select epoch.identity_changed_at into v_identity_changed_at
  from pricing_private.bot_conversation_identity_epochs as epoch
  where epoch.conversation_id = p_conversation_id;
  if found and p_turn_at <= v_identity_changed_at then
    return false;
  end if;

  select memory.* into v_existing
  from public.bot_conversation_memory as memory
  where memory.conversation_id = p_conversation_id
  for update;

  if found then
    if v_existing.expires_at <= statement_timestamp() then
      delete from public.bot_conversation_memory
      where conversation_id = p_conversation_id;
      insert into public.bot_conversation_memory (
        conversation_id, customer_id, summary, topics, structured_state,
        source_channel, expires_at, last_turn_at
      ) values (
        p_conversation_id, v_customer_id, p_summary, p_topics,
        p_structured_state, p_source_channel, p_expires_at, p_turn_at
      );
      return true;
    end if;

    if v_existing.customer_id is distinct from v_customer_id
       and v_existing.last_turn_at is not null
       and p_turn_at <= v_existing.last_turn_at then
      -- A reassigned conversation must never retain the previous customer's
      -- summary, state, staff note, or locks, even when a delayed turn arrives.
      delete from public.bot_conversation_memory
      where conversation_id = p_conversation_id;
      return false;
    end if;

    if v_existing.last_turn_at is not null
       and p_turn_at <= v_existing.last_turn_at then
      return false;
    end if;

    if v_existing.customer_id is not distinct from v_customer_id
       and v_existing.staff_locked then
      return false;
    end if;

    if v_existing.customer_id is distinct from v_customer_id then
      update public.bot_conversation_memory
      set customer_id = v_customer_id,
          summary = p_summary,
          topics = p_topics,
          structured_state = p_structured_state,
          locked_fields = '{}',
          last_turn_at = p_turn_at,
          staff_note = null,
          staff_locked = false,
          source_channel = p_source_channel,
          expires_at = p_expires_at,
          updated_at = statement_timestamp()
      where conversation_id = p_conversation_id;
      return true;
    end if;

    v_merged_state := p_structured_state;
    foreach v_locked_key in array v_existing.locked_fields
    loop
      if v_existing.structured_state ? v_locked_key then
        v_merged_state := jsonb_set(
          v_merged_state,
          array[v_locked_key],
          v_existing.structured_state -> v_locked_key,
          true
        );
      else
        v_merged_state := v_merged_state - v_locked_key;
      end if;
    end loop;

    update public.bot_conversation_memory
    set summary = p_summary,
        topics = p_topics,
        structured_state = v_merged_state,
        source_channel = p_source_channel,
        expires_at = p_expires_at,
        last_turn_at = p_turn_at,
        updated_at = statement_timestamp()
    where conversation_id = p_conversation_id;
    return true;
  end if;

  insert into public.bot_conversation_memory (
    conversation_id, customer_id, summary, topics, structured_state,
    source_channel, expires_at, last_turn_at
  ) values (
    p_conversation_id, v_customer_id, p_summary, p_topics,
    p_structured_state, p_source_channel, p_expires_at, p_turn_at
  );
  return true;
end;
$$;

create or replace function public.set_bot_conversation_memory_staff_control(
  p_conversation_id uuid,
  p_locked_fields text[],
  p_staff_note text,
  p_staff_locked boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_source_channel text;
  v_ttl_days integer;
begin
  if p_conversation_id is null
     or p_locked_fields is null
     or not pricing_private.memory_locked_fields_are_safe(p_locked_fields)
     or p_staff_locked is null
     or (
       p_staff_note is not null
       and (
         p_staff_note <> btrim(p_staff_note)
          or char_length(p_staff_note) not between 1 and 1000
          or p_staff_note ~ '[[:cntrl:]]'
          or not pricing_private.memory_text_is_safe(p_staff_note)
       )
     ) then
    raise exception 'invalid_memory_staff_control'
      using errcode = '22023';
  end if;

  select conversation.customer_id, conversation.channel
    into v_customer_id, v_source_channel
  from public.chat_conversations as conversation
  where conversation.id = p_conversation_id
  for update;

  if not found then
    return false;
  end if;

  perform 1
  from public.bot_conversation_memory as memory
  where memory.conversation_id = p_conversation_id
    and memory.expires_at <= statement_timestamp()
  for update;
  if found then
    return false;
  end if;

  select coalesce(settings.memory_ttl_days, 90)
    into v_ttl_days
  from public.bot_learning_settings as settings
  where settings.id;
  v_ttl_days := coalesce(v_ttl_days, 90);

  insert into public.bot_conversation_memory (
    conversation_id, customer_id, summary, topics, structured_state,
    locked_fields, source_channel, expires_at, staff_note, staff_locked
  ) values (
    p_conversation_id,
    v_customer_id,
    'ยังไม่มีสรุปการสนทนา',
    '{}',
    '{}'::jsonb,
    p_locked_fields,
    v_source_channel,
    statement_timestamp() + make_interval(days => v_ttl_days),
    p_staff_note,
    p_staff_locked
  )
  on conflict (conversation_id) do update
  set customer_id = excluded.customer_id,
      summary = case
        when public.bot_conversation_memory.customer_id
               is distinct from excluded.customer_id
          or public.bot_conversation_memory.source_channel
               is distinct from excluded.source_channel
        then excluded.summary
        else public.bot_conversation_memory.summary
      end,
      topics = case
        when public.bot_conversation_memory.customer_id
               is distinct from excluded.customer_id
          or public.bot_conversation_memory.source_channel
               is distinct from excluded.source_channel
        then excluded.topics
        else public.bot_conversation_memory.topics
      end,
      structured_state = case
        when public.bot_conversation_memory.customer_id
               is distinct from excluded.customer_id
          or public.bot_conversation_memory.source_channel
               is distinct from excluded.source_channel
        then excluded.structured_state
        else public.bot_conversation_memory.structured_state
      end,
      last_turn_at = case
        when public.bot_conversation_memory.customer_id
               is distinct from excluded.customer_id
          or public.bot_conversation_memory.source_channel
               is distinct from excluded.source_channel
        then null
        else public.bot_conversation_memory.last_turn_at
      end,
      locked_fields = excluded.locked_fields,
      source_channel = excluded.source_channel,
      expires_at = excluded.expires_at,
      staff_note = excluded.staff_note,
      staff_locked = excluded.staff_locked,
      updated_at = statement_timestamp();
  return true;
end;
$$;

create or replace function public.cleanup_expired_bot_conversation_memory()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.bot_conversation_memory
  where expires_at <= statement_timestamp();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.get_bot_customer_context(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_company_name text;
  v_contact_name text;
  v_tax_id text;
  v_tax_matches integer;
  v_history jsonb;
  v_pricing_customer_id uuid;
  v_personalized_allowed boolean;
begin
  select context.customer_id, context.personalized_allowed
    into v_pricing_customer_id, v_personalized_allowed
  from pricing_private.bot_pricing_context(p_conversation_id) as context;

  if not coalesce(v_personalized_allowed, false) then
    return '{}'::jsonb;
  end if;

  select conversation.customer_id,
         customer.name,
         coalesce(
           (
             select nullif(btrim(contact.contact_name), '')
             from public.customer_contacts as contact
             join public.profiles as profile on profile.id = contact.user_id
             where contact.customer_id = conversation.customer_id
               and contact.verified
               and conversation.channel = 'line'
               and profile.line_user_id = conversation.external_id
             order by contact.verified_at desc nulls last, contact.created_at desc
             limit 1
           ),
           nullif(btrim(conversation.display_name), ''),
           customer.name
         ),
         regexp_replace(coalesce(customer.tax_id, ''), '[^0-9]', '', 'g')
    into v_customer_id, v_company_name, v_contact_name, v_tax_id
  from public.chat_conversations as conversation
  join public.customers as customer on customer.id = conversation.customer_id
  where conversation.id = p_conversation_id;

  if not found
     or v_customer_id is distinct from v_pricing_customer_id
     or v_tax_id !~ '^[0-9]{13}$' then
    return '{}'::jsonb;
  end if;

  select count(*) into v_tax_matches
  from public.customers as customer
  where regexp_replace(coalesce(customer.tax_id, ''), '[^0-9]', '', 'g') = v_tax_id;

  if v_tax_matches <> 1 then
    return '{}'::jsonb;
  end if;

  with recent_history as (
    select
      'order'::text as document_type,
      item.sku,
      item.product_name,
      item.quantity::numeric as quantity,
      product.unit,
      orders.status,
      orders.created_at::date as document_date,
      orders.created_at as sort_at,
      item.id as line_id,
      1::integer as source_priority
    from public.orders as orders
    join public.order_items as item on item.order_id = orders.id
    join public.products as product on product.id = item.product_id
    where orders.customer_id = v_customer_id
      and orders.created_at >= statement_timestamp() - interval '180 days'
      and orders.status not in ('cancelled', 'canceled')
      and item.product_id is not null
      and upper(btrim(item.sku)) <> 'SHIPPING'

    union all

    select
      'quote'::text,
      item.sku,
      item.product_name,
      item.quantity::numeric,
      coalesce(nullif(btrim(item.unit), ''), product.unit),
      quotes.status,
      quotes.created_at::date,
      quotes.created_at,
      item.id,
      1::integer
    from public.quotes as quotes
    join public.quote_items as item on item.quote_id = quotes.id
    join public.products as product on product.id = item.product_id
    where quotes.customer_id = v_customer_id
      and quotes.created_at >= statement_timestamp() - interval '180 days'
      and quotes.status not in ('draft', 'cancelled', 'canceled')
      and item.product_id is not null
      and upper(btrim(item.sku)) <> 'SHIPPING'

    union all

    select
      case
        when lower(cache.line_key) like 'tax_invoice:%' then 'order'::text
        when lower(cache.line_key) like 'cash_invoice:%' then 'order'::text
        when lower(cache.line_key) like 'quotation:%' then 'quote'::text
      end,
      cache.source_sku,
      product.name_th,
      cache.source_quantity,
      cache.source_unit,
      cache.document_status::text,
      cache.published_on,
      cache.source_updated_at,
      cache.id,
      2::integer
    from pricing_private.flowaccount_quote_price_cache as cache
    join pricing_private.flowaccount_price_sync_state as state
      on state.company_key = cache.company_key
     and state.last_success_run_id = cache.sync_run_id
     and state.enabled
     and state.last_success_at >= statement_timestamp()
       - make_interval(mins => state.stale_after_minutes)
    join pricing_private.flowaccount_price_sync_runs as sync_run
      on sync_run.id = cache.sync_run_id
     and sync_run.company_key = cache.company_key
     and sync_run.status = 'succeeded'
    join public.products as product on product.id = cache.product_id
    where cache.customer_id = v_customer_id
      and cache.eligible
      and cache.currency = 'THB'
      and cache.published_on >= current_date - 180
      and cache.published_on >= current_date - state.max_document_age_days
      and (
        lower(cache.line_key) like 'tax_invoice:%'
        or lower(cache.line_key) like 'cash_invoice:%'
        or lower(cache.line_key) like 'quotation:%'
      )
  ), deduplicated as (
    select recent_history.*,
           row_number() over (
             partition by document_type, sku, product_name, quantity,
                          unit, status, document_date
             order by source_priority, sort_at desc, line_id
           ) as duplicate_rank
    from recent_history
  ), bounded as (
    select *
    from deduplicated
    where duplicate_rank = 1
    order by sort_at desc, source_priority, document_type, line_id
    limit 60
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'document_type', document_type,
        'sku', sku,
        'product_name', product_name,
        'quantity', quantity,
        'unit', unit,
        'status', status,
        'document_date', document_date
      ) order by sort_at desc, source_priority, document_type, line_id
    ),
    '[]'::jsonb
  ) into v_history
  from bounded;

  return jsonb_build_object(
    'customer_id', v_customer_id,
    'company_name', v_company_name,
    'contact_name', v_contact_name,
    'history', v_history
  );
end;
$$;

create index if not exists chat_conv_flowaccount_active_customer_idx
  on public.chat_conversations (last_customer_message_at desc, customer_id, id)
  where channel = 'line' and customer_id is not null;

create or replace function public.get_flowaccount_active_customer_targets(
  p_days integer default 180,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_targets jsonb;
  v_target_count integer;
begin
  if p_days is null or p_days not between 1 and 180
     or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid_flowaccount_active_customer_request'
      using errcode = '22023';
  end if;

  with eligible as (
    select distinct on (conversation.customer_id)
      conversation.customer_id,
      regexp_replace(coalesce(customer.tax_id, ''), '[^0-9]', '', 'g') as tax_id,
      conversation.last_customer_message_at
    from public.chat_conversations as conversation
    join public.customers as customer on customer.id = conversation.customer_id
    cross join lateral pricing_private.bot_pricing_context(conversation.id) as context
    where conversation.channel = 'line'
      and conversation.last_customer_message_at is not null
      and conversation.last_customer_message_at >=
        statement_timestamp() - make_interval(days => p_days)
      and context.customer_id = conversation.customer_id
      and context.personalized_allowed
      and regexp_replace(coalesce(customer.tax_id, ''), '[^0-9]', '', 'g')
        ~ '^[0-9]{13}$'
      and (
        select count(*)
        from public.customers as duplicate
        where regexp_replace(coalesce(duplicate.tax_id, ''), '[^0-9]', '', 'g')
          = regexp_replace(coalesce(customer.tax_id, ''), '[^0-9]', '', 'g')
      ) = 1
    order by conversation.customer_id,
      conversation.last_customer_message_at desc,
      conversation.id
  ), bounded as (
    select eligible.*
    from eligible
    order by last_customer_message_at desc, customer_id
    limit p_limit + 1
  )
  select count(*)::integer,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'customer_id', customer_id,
               'tax_id', tax_id
             ) order by last_customer_message_at desc, customer_id
           ),
           '[]'::jsonb
         )
    into v_target_count, v_targets
  from bounded;

  if v_target_count > p_limit then
    raise exception 'flowaccount_active_customer_limit_exceeded'
      using errcode = '54000';
  end if;

  return jsonb_build_object(
    'window_days', p_days,
    'target_count', v_target_count,
    'targets', v_targets
  );
end;
$$;

revoke all on function public.upsert_bot_conversation_memory_state(
  uuid, text, text[], jsonb, text, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.set_bot_conversation_memory_staff_control(
  uuid, text[], text, boolean
) from public, anon, authenticated;
revoke all on function public.get_bot_customer_context(uuid)
  from public, anon, authenticated;
revoke all on function public.get_flowaccount_active_customer_targets(integer, integer)
  from public, anon, authenticated;
revoke all on function public.cleanup_expired_bot_conversation_memory()
  from public, anon, authenticated;

grant execute on function public.upsert_bot_conversation_memory_state(
  uuid, text, text[], jsonb, text, timestamptz, timestamptz
) to service_role;
grant execute on function public.set_bot_conversation_memory_staff_control(
  uuid, text[], text, boolean
) to service_role;
grant execute on function public.get_bot_customer_context(uuid)
  to service_role;
grant execute on function public.get_flowaccount_active_customer_targets(integer, integer)
  to service_role;
grant execute on function public.cleanup_expired_bot_conversation_memory()
  to service_role;

revoke all on table public.bot_conversation_memory
  from public, anon, authenticated, service_role;
grant select on table public.bot_conversation_memory to service_role;

-- -------------------------------------------------------------------------
-- Private OAuth state and connection metadata
-- -------------------------------------------------------------------------

create or replace function pricing_private.flowaccount_scopes_are_safe(p_scopes text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_scopes is not null
    and cardinality(p_scopes) <= 32
    and not exists (
      select 1
      from unnest(p_scopes) as scope_name
      where scope_name is null
         or scope_name <> btrim(scope_name)
         or char_length(scope_name) not between 1 and 120
         or scope_name !~ '^[A-Za-z0-9:._/-]+$'
    )
    and cardinality(p_scopes) = (
      select count(distinct scope_name)
      from unnest(p_scopes) as scope_name
    );
$$;

create table if not exists pricing_private.flowaccount_mcp_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique
    check (state_hash ~ '^[0-9a-f]{64}$'),
  code_verifier text not null
    check (
      char_length(code_verifier) between 43 and 128
      and code_verifier ~ '^[A-Za-z0-9._~-]+$'
    ),
  company_key text not null
    check (
      company_key = btrim(company_key)
      and char_length(company_key) between 1 and 80
      and company_key ~ '^[A-Za-z0-9._-]+$'
    ),
  redirect_uri text not null
    check (
      char_length(redirect_uri) between 12 and 1000
      and redirect_uri ~ '^https://[^[:space:]]+$'
    ),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  check (consumed_at is null or consumed_at >= created_at)
);

create index if not exists flowaccount_mcp_oauth_states_expiry_idx
  on pricing_private.flowaccount_mcp_oauth_states (expires_at)
  where consumed_at is null;

create table if not exists pricing_private.flowaccount_mcp_connections (
  company_key text primary key
    check (
      company_key = btrim(company_key)
      and char_length(company_key) between 1 and 80
      and company_key ~ '^[A-Za-z0-9._-]+$'
    ),
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connecting', 'connected', 'error')),
  provider_company_id text
    check (
      provider_company_id is null
      or (
        provider_company_id = btrim(provider_company_id)
        and char_length(provider_company_id) between 1 and 200
        and provider_company_id !~ '[[:cntrl:]]'
      )
    ),
  provider_company_name text
    check (
      provider_company_name is null
      or (
        provider_company_name = btrim(provider_company_name)
        and char_length(provider_company_name) between 1 and 300
        and provider_company_name !~ '[[:cntrl:]]'
      )
    ),
  scopes text[] not null default '{}'
    check (pricing_private.flowaccount_scopes_are_safe(scopes)),
  token_expires_at timestamptz,
  connected_at timestamptz,
  refreshed_at timestamptz,
  last_error_code text
    check (
      last_error_code is null
      or (
        last_error_code = btrim(last_error_code)
        and char_length(last_error_code) between 1 and 120
        and last_error_code ~ '^[A-Za-z0-9:._-]+$'
      )
    ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (
    status <> 'connected'
    or (
      provider_company_id is not null
      and provider_company_name is not null
      and token_expires_at is not null
      and connected_at is not null
    )
  )
);

create unique index if not exists flowaccount_mcp_one_connected_idx
  on pricing_private.flowaccount_mcp_connections ((status))
  where status = 'connected';

alter table pricing_private.flowaccount_mcp_oauth_states enable row level security;
alter table pricing_private.flowaccount_mcp_connections enable row level security;

revoke all on table pricing_private.flowaccount_mcp_oauth_states,
  pricing_private.flowaccount_mcp_connections
  from public, anon, authenticated, service_role;

create or replace function public.create_flowaccount_mcp_oauth_state(
  p_state_hash text,
  p_code_verifier text,
  p_company_key text,
  p_redirect_uri text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_state_hash is null
     or p_state_hash !~ '^[0-9a-f]{64}$'
     or char_length(coalesce(p_code_verifier, '')) not between 43 and 128
     or p_code_verifier !~ '^[A-Za-z0-9._~-]+$'
     or p_company_key is null
     or p_company_key <> btrim(p_company_key)
     or char_length(p_company_key) not between 1 and 80
     or p_company_key !~ '^[A-Za-z0-9._-]+$'
     or p_redirect_uri is null
     or char_length(p_redirect_uri) not between 12 and 1000
     or p_redirect_uri !~ '^https://[^[:space:]]+$'
     or p_expires_at is null
     or p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '15 minutes' then
    raise exception 'invalid_flowaccount_oauth_state'
      using errcode = '22023';
  end if;

  delete from pricing_private.flowaccount_mcp_oauth_states
  where expires_at < statement_timestamp() - interval '1 day';

  insert into pricing_private.flowaccount_mcp_oauth_states (
    state_hash, code_verifier, company_key, redirect_uri, expires_at
  ) values (
    p_state_hash, p_code_verifier, p_company_key, p_redirect_uri, p_expires_at
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.consume_flowaccount_mcp_oauth_state(
  p_state_hash text,
  p_consumed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state pricing_private.flowaccount_mcp_oauth_states%rowtype;
begin
  if p_state_hash !~ '^[0-9a-f]{64}$'
     or p_consumed_at is null
     or p_consumed_at < statement_timestamp() - interval '5 minutes'
     or p_consumed_at > statement_timestamp() + interval '5 minutes' then
    return '{}'::jsonb;
  end if;

  select oauth_state.* into v_state
  from pricing_private.flowaccount_mcp_oauth_states as oauth_state
  where oauth_state.state_hash = p_state_hash
  for update;

  if not found
     or v_state.consumed_at is not null
     or v_state.expires_at < statement_timestamp() then
    return '{}'::jsonb;
  end if;

  update pricing_private.flowaccount_mcp_oauth_states
  set consumed_at = p_consumed_at,
      code_verifier = repeat('x', 43)
  where id = v_state.id;

  return jsonb_build_object(
    'state_id', v_state.id,
    'company_key', v_state.company_key,
    'code_verifier', v_state.code_verifier,
    'redirect_uri', v_state.redirect_uri
  );
end;
$$;

create or replace function public.upsert_flowaccount_mcp_connection(
  p_company_key text,
  p_status text,
  p_provider_company_id text,
  p_provider_company_name text,
  p_scopes text[],
  p_token_expires_at timestamptz,
  p_last_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_status text;
  v_existing_provider_company_id text;
  v_existing_provider_company_name text;
  v_invalidate_current_generation boolean := false;
begin
  if p_company_key is null
     or p_company_key <> btrim(p_company_key)
     or char_length(p_company_key) not between 1 and 80
     or p_company_key !~ '^[A-Za-z0-9._-]+$'
     or p_status is null
     or p_status not in ('disconnected', 'connecting', 'connected', 'error')
     or p_scopes is null
     or not pricing_private.flowaccount_scopes_are_safe(p_scopes)
     or (
       p_provider_company_id is not null
       and (
         p_provider_company_id <> btrim(p_provider_company_id)
         or char_length(p_provider_company_id) not between 1 and 200
         or p_provider_company_id ~ '[[:cntrl:]]'
       )
     )
     or (
       p_provider_company_name is not null
       and (
         p_provider_company_name <> btrim(p_provider_company_name)
         or char_length(p_provider_company_name) not between 1 and 300
         or p_provider_company_name ~ '[[:cntrl:]]'
       )
     )
     or (
       p_last_error_code is not null
       and (
         p_last_error_code <> btrim(p_last_error_code)
         or char_length(p_last_error_code) not between 1 and 120
         or p_last_error_code !~ '^[A-Za-z0-9:._-]+$'
       )
     )
     or (
       p_status = 'connected'
       and (
         p_provider_company_id is null
         or p_provider_company_name is null
         or p_token_expires_at is null
       )
     ) then
    raise exception 'invalid_flowaccount_connection'
      using errcode = '22023';
  end if;

  -- Serialize connection changes before taking any connection-row locks. This
  -- prevents two concurrent tenant switches from locking different rows in
  -- opposite order, while publish/disconnect continue to serialize on the
  -- concrete company row.
  perform pg_advisory_xact_lock(
    hashtextextended('flowaccount_mcp.connection_change', 0)
  );

  select connection.status,
         connection.provider_company_id,
         connection.provider_company_name
    into v_existing_status,
         v_existing_provider_company_id,
         v_existing_provider_company_name
  from pricing_private.flowaccount_mcp_connections as connection
  where connection.company_key = p_company_key
  for update;

  if found then
    v_invalidate_current_generation :=
      (
        v_existing_status = 'connected'
        and p_status <> 'connected'
      )
      or (
        p_status = 'connected'
        and (
          v_existing_provider_company_id is distinct from p_provider_company_id
          or v_existing_provider_company_name is distinct from p_provider_company_name
        )
      );
  end if;

  if v_invalidate_current_generation then
    update pricing_private.flowaccount_price_sync_runs
    set status = 'failed',
        error_code = 'provider_company_changed',
        completed_at = statement_timestamp()
    where company_key = p_company_key
      and status = 'running';

    update pricing_private.flowaccount_price_sync_state
    set enabled = false,
        updated_at = statement_timestamp()
    where company_key = p_company_key
      and enabled;
  end if;

  if p_status = 'connected' then
    update pricing_private.flowaccount_mcp_connections
    set status = 'disconnected',
        token_expires_at = null,
        last_error_code = null,
        updated_at = statement_timestamp()
    where company_key <> p_company_key
      and status = 'connected';

    update pricing_private.flowaccount_price_sync_runs
    set status = 'failed',
        error_code = 'provider_company_changed',
        completed_at = statement_timestamp()
    where company_key <> p_company_key
      and status = 'running';

    update pricing_private.flowaccount_price_sync_state
    set enabled = false,
        updated_at = statement_timestamp()
    where company_key <> p_company_key
      and enabled;
  end if;

  insert into pricing_private.flowaccount_mcp_connections (
    company_key, status, provider_company_id, provider_company_name, scopes,
    token_expires_at, connected_at, refreshed_at, last_error_code
  ) values (
    p_company_key,
    p_status,
    p_provider_company_id,
    p_provider_company_name,
    p_scopes,
    p_token_expires_at,
    case when p_status = 'connected' then statement_timestamp() end,
    case when p_status = 'connected' then statement_timestamp() end,
    p_last_error_code
  )
  on conflict (company_key) do update
  set status = excluded.status,
      provider_company_id = excluded.provider_company_id,
      provider_company_name = excluded.provider_company_name,
      scopes = excluded.scopes,
      token_expires_at = excluded.token_expires_at,
      connected_at = case
        when excluded.status = 'connected'
          then coalesce(pricing_private.flowaccount_mcp_connections.connected_at,
                        statement_timestamp())
        else pricing_private.flowaccount_mcp_connections.connected_at
      end,
      refreshed_at = case
        when excluded.status = 'connected' then statement_timestamp()
        else pricing_private.flowaccount_mcp_connections.refreshed_at
      end,
      last_error_code = excluded.last_error_code,
      updated_at = statement_timestamp();

  return true;
end;
$$;

revoke all on function public.create_flowaccount_mcp_oauth_state(
  text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.consume_flowaccount_mcp_oauth_state(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.upsert_flowaccount_mcp_connection(
  text, text, text, text, text[], timestamptz, text
) from public, anon, authenticated;

grant execute on function public.create_flowaccount_mcp_oauth_state(
  text, text, text, text, timestamptz
) to service_role;
grant execute on function public.consume_flowaccount_mcp_oauth_state(text, timestamptz)
  to service_role;
grant execute on function public.upsert_flowaccount_mcp_connection(
  text, text, text, text, text[], timestamptz, text
) to service_role;

-- -------------------------------------------------------------------------
-- Vault boundary
-- -------------------------------------------------------------------------

create or replace function pricing_private.flowaccount_public_secret_name_is_allowed(
  p_name text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name = any(array[
    'FLOWACCOUNT_MCP_CLIENT_ID',
    'FLOWACCOUNT_MCP_CLIENT_SECRET',
    'FLOWACCOUNT_MCP_ACCESS_TOKEN',
    'FLOWACCOUNT_MCP_REFRESH_TOKEN'
  ]::text[]);
$$;

create or replace function public.set_flowaccount_mcp_secret(
  p_name text,
  p_value text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if p_name is null
     or not pricing_private.flowaccount_public_secret_name_is_allowed(p_name)
     or p_value is null
     or char_length(p_value) not between 1 and 8192 then
    raise exception 'invalid_flowaccount_secret'
      using errcode = '22023';
  end if;

  select secret.id into v_secret_id
  from vault.secrets as secret
  where secret.name = p_name
  order by secret.created_at desc
  limit 1
  for update;

  if v_secret_id is null then
    perform vault.create_secret(p_value, p_name, 'CoreBiz FlowAccount MCP credential');
  else
    perform vault.update_secret(
      v_secret_id,
      p_value,
      p_name,
      'CoreBiz FlowAccount MCP credential'
    );
  end if;
  return true;
end;
$$;

create or replace function public.get_flowaccount_mcp_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value text;
begin
  if p_name is null
     or not pricing_private.flowaccount_public_secret_name_is_allowed(p_name) then
    raise exception 'invalid_flowaccount_secret_name'
      using errcode = '22023';
  end if;

  select secret.decrypted_secret into v_value
  from vault.decrypted_secrets as secret
  where secret.name = p_name
  order by secret.created_at desc
  limit 1;
  return v_value;
end;
$$;

create or replace function public.delete_flowaccount_mcp_secret(p_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_name is null
     or not pricing_private.flowaccount_public_secret_name_is_allowed(p_name) then
    raise exception 'invalid_flowaccount_secret_name'
      using errcode = '22023';
  end if;

  delete from vault.secrets where name = p_name;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

-- This fifth secret authenticates the hourly database-to-Edge call. It is
-- generated inside Vault and deliberately excluded from the public fixed-name
-- credential RPCs above.
do $$
begin
  if not exists (
    select 1 from vault.secrets
    where name = 'FLOWACCOUNT_MCP_SYNC_KEY'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'FLOWACCOUNT_MCP_SYNC_KEY',
      'Internal CoreBiz hourly FlowAccount sync authentication key'
    );
  end if;
end;
$$;

create or replace function public.get_flowaccount_mcp_sync_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'FLOWACCOUNT_MCP_SYNC_KEY'
  order by created_at desc
  limit 1;
$$;

revoke all on function public.set_flowaccount_mcp_secret(text, text)
  from public, anon, authenticated;
revoke all on function public.get_flowaccount_mcp_secret(text)
  from public, anon, authenticated;
revoke all on function public.delete_flowaccount_mcp_secret(text)
  from public, anon, authenticated;
revoke all on function public.get_flowaccount_mcp_sync_key()
  from public, anon, authenticated;

grant execute on function public.set_flowaccount_mcp_secret(text, text)
  to service_role;
grant execute on function public.get_flowaccount_mcp_secret(text)
  to service_role;
grant execute on function public.delete_flowaccount_mcp_secret(text)
  to service_role;
grant execute on function public.get_flowaccount_mcp_sync_key()
  to service_role;

-- -------------------------------------------------------------------------
-- Audited, all-or-nothing normalized price generations
-- -------------------------------------------------------------------------

create table if not exists pricing_private.flowaccount_price_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_key text not null
    references pricing_private.flowaccount_mcp_connections(company_key),
  source text not null check (source in ('mcp', 'manual_export')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  window_start date not null,
  window_end date not null,
  source_hash text check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),
  row_count integer not null default 0 check (row_count between 0 and 20000),
  document_count integer not null default 0 check (document_count between 0 and 20000),
  eligible_count integer not null default 0 check (eligible_count between 0 and 20000),
  rejected_count integer not null default 0 check (rejected_count between 0 and 20000),
  omitted_count integer not null default 0 check (omitted_count between 0 and 50000),
  error_code text check (
    error_code is null
    or (
      error_code = btrim(error_code)
      and char_length(error_code) between 1 and 120
      and error_code ~ '^[A-Za-z0-9:._-]+$'
    )
  ),
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  check (window_end >= window_start and window_end - window_start <= 180),
  check (completed_at is null or completed_at >= started_at),
  check (
    (status = 'running' and completed_at is null and source_hash is null and error_code is null)
    or (status = 'succeeded' and completed_at is not null and source_hash is not null and error_code is null)
    or (status = 'failed' and completed_at is not null and error_code is not null)
  ),
  check (eligible_count + rejected_count = row_count)
);

create unique index if not exists flowaccount_price_sync_one_running_idx
  on pricing_private.flowaccount_price_sync_runs (company_key)
  where status = 'running';
create index if not exists flowaccount_price_sync_runs_history_idx
  on pricing_private.flowaccount_price_sync_runs
    (company_key, completed_at desc, started_at desc);

alter table pricing_private.flowaccount_price_sync_runs enable row level security;
revoke all on table pricing_private.flowaccount_price_sync_runs
  from public, anon, authenticated, service_role;

create or replace function pricing_private.flowaccount_publish_row_is_structurally_valid(
  p_row jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_published_on date;
  v_updated_at timestamptz;
  v_allowed constant text[] := array[
    'document_record_id', 'line_key', 'document_serial', 'document_status',
    'published_on', 'source_updated_at', 'source_contact_id',
    'source_contact_tax_id', 'source_sku', 'source_unit', 'source_quantity',
    'net_unit_price', 'currency', 'eligible', 'eligibility_reason', 'source_hash'
  ];
begin
  if p_row is null
     or jsonb_typeof(p_row) <> 'object'
     or octet_length(p_row::text) > 4096
     or not (p_row ?& array[
       'document_record_id', 'line_key', 'document_status', 'published_on',
       'source_updated_at', 'source_contact_tax_id', 'source_sku',
       'source_unit', 'source_quantity', 'net_unit_price', 'currency',
       'eligible', 'source_hash'
     ]) then
    return false;
  end if;

  for v_key in select jsonb_object_keys(p_row)
  loop
    if not (v_key = any(v_allowed)) then
      return false;
    end if;
  end loop;

  if coalesce(p_row->>'document_record_id', '') !~ '^[1-9][0-9]{0,18}$'
     or (p_row->>'document_record_id')::numeric > 9223372036854775807
     or coalesce(p_row->>'line_key', '') <> btrim(coalesce(p_row->>'line_key', ''))
     or char_length(coalesce(p_row->>'line_key', '')) not between 1 and 200
     or coalesce(p_row->>'line_key', '') ~ '[[:cntrl:]]'
     or coalesce(p_row->>'document_status', '') !~ '^[0-9]{1,10}$'
     or (p_row->>'document_status')::numeric > 2147483647
     or coalesce(p_row->>'source_contact_tax_id', '') !~ '^[0-9]{13}$'
     or coalesce(p_row->>'source_sku', '') <> btrim(coalesce(p_row->>'source_sku', ''))
     or char_length(coalesce(p_row->>'source_sku', '')) not between 1 and 200
     or coalesce(p_row->>'source_sku', '') ~ '[[:cntrl:]]'
     or coalesce(p_row->>'source_unit', '') <> btrim(coalesce(p_row->>'source_unit', ''))
     or char_length(coalesce(p_row->>'source_unit', '')) not between 1 and 80
     or coalesce(p_row->>'source_unit', '') ~ '[[:cntrl:]]'
     or coalesce(p_row->>'source_quantity', '') !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$'
     or (p_row->>'source_quantity')::numeric <= 0
     or coalesce(p_row->>'net_unit_price', '') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
     or coalesce(p_row->>'currency', '') !~ '^[A-Z]{3}$'
     or jsonb_typeof(p_row->'eligible') <> 'boolean'
     or coalesce(p_row->>'source_hash', '') !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  if p_row ? 'document_serial'
     and p_row->>'document_serial' is not null
     and (
       coalesce(p_row->>'document_serial', '') <> btrim(coalesce(p_row->>'document_serial', ''))
       or char_length(coalesce(p_row->>'document_serial', '')) not between 1 and 120
       or coalesce(p_row->>'document_serial', '') ~ '[[:cntrl:]]'
     ) then
    return false;
  end if;

  if p_row ? 'source_contact_id'
     and p_row->>'source_contact_id' is not null
     and (
       coalesce(p_row->>'source_contact_id', '') !~ '^[1-9][0-9]{0,18}$'
       or (p_row->>'source_contact_id')::numeric > 9223372036854775807
     ) then
    return false;
  end if;

  if p_row ? 'eligibility_reason'
     and p_row->>'eligibility_reason' is not null
     and (
       coalesce(p_row->>'eligibility_reason', '') <> btrim(coalesce(p_row->>'eligibility_reason', ''))
       or char_length(coalesce(p_row->>'eligibility_reason', '')) not between 1 and 200
       or coalesce(p_row->>'eligibility_reason', '') ~ '[[:cntrl:]]'
     ) then
    return false;
  end if;

  if not (p_row->>'eligible')::boolean
     and nullif(p_row->>'eligibility_reason', '') is null then
    return false;
  end if;

  begin
    if coalesce(p_row->>'published_on', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      return false;
    end if;
    v_published_on := (p_row->>'published_on')::date;
    v_updated_at := (p_row->>'source_updated_at')::timestamptz;
  exception when others then
    return false;
  end;

  return v_published_on is not null and v_updated_at is not null;
exception when others then
  return false;
end;
$$;

create or replace function public.start_flowaccount_price_sync_run(
  p_company_key text,
  p_source text,
  p_window_start date,
  p_window_end date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if p_company_key is null
     or p_company_key <> btrim(p_company_key)
     or char_length(p_company_key) not between 1 and 80
     or p_company_key !~ '^[A-Za-z0-9._-]+$'
     or p_source is null
     or p_source not in ('mcp', 'manual_export')
     or p_window_start is null
     or p_window_end is null
     or p_window_end < p_window_start
     or p_window_end - p_window_start > 180
     or p_window_start < current_date - 180
     or p_window_end > current_date then
    raise exception 'invalid_flowaccount_sync_window'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from pricing_private.flowaccount_mcp_connections as connection
    where connection.company_key = p_company_key
      and connection.status = 'connected'
  ) then
    raise exception 'flowaccount_not_connected'
      using errcode = '55000';
  end if;

  -- A worker can be terminated after creating the run but before its catch
  -- handler records failure. Recover only runs older than the maximum expected
  -- MCP traversal time so a single orphan cannot block every later schedule.
  update pricing_private.flowaccount_price_sync_runs as stale_run
  set status = 'failed',
      error_code = 'sync_worker_timeout',
      completed_at = statement_timestamp()
  where stale_run.company_key = p_company_key
    and stale_run.status = 'running'
    and stale_run.started_at < statement_timestamp() - interval '30 minutes';

  select sync_run.id into v_run_id
  from pricing_private.flowaccount_price_sync_runs as sync_run
  where sync_run.company_key = p_company_key
    and sync_run.status = 'running'
  for update;

  if found then
    raise exception 'flowaccount_sync_in_progress'
      using errcode = '55000';
  end if;

  begin
    insert into pricing_private.flowaccount_price_sync_runs (
      company_key, source, window_start, window_end
    ) values (
      p_company_key, p_source, p_window_start, p_window_end
    )
    returning id into v_run_id;
  exception when unique_violation then
    raise exception 'flowaccount_sync_in_progress'
      using errcode = '55000';
  end;
  return v_run_id;
end;
$$;

create or replace function public.prune_flowaccount_price_cache(
  p_company_key text,
  p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_run_id uuid;
  v_previous_run_id uuid;
  v_deleted integer;
begin
  if p_company_key is null or p_now is null then
    raise exception 'invalid_flowaccount_prune_request'
      using errcode = '22023';
  end if;

  select state.last_success_run_id into v_current_run_id
  from pricing_private.flowaccount_price_sync_state as state
  where state.company_key = p_company_key;

  if v_current_run_id is null then
    select sync_run.id into v_current_run_id
    from pricing_private.flowaccount_price_sync_runs as sync_run
    where sync_run.company_key = p_company_key
      and sync_run.status = 'succeeded'
    order by sync_run.completed_at desc, sync_run.id
    limit 1;
  end if;

  select sync_run.id into v_previous_run_id
  from pricing_private.flowaccount_price_sync_runs as sync_run
  where sync_run.company_key = p_company_key
    and sync_run.status = 'succeeded'
    and sync_run.id is distinct from v_current_run_id
  order by sync_run.completed_at desc, sync_run.id
  limit 1;

  delete from pricing_private.flowaccount_quote_price_cache as cache
  where cache.company_key = p_company_key
    and (
      cache.published_on < p_now::date - 180
      or cache.sync_run_id is distinct from v_current_run_id
         and cache.sync_run_id is distinct from v_previous_run_id
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.publish_flowaccount_price_sync_run(
  p_run_id uuid,
  p_company_key text,
  p_rows jsonb,
  p_source_hash text,
  p_omitted_count integer,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run pricing_private.flowaccount_price_sync_runs%rowtype;
  v_row_count integer;
  v_document_count integer;
  v_eligible_count integer;
  v_rejected_count integer;
  v_deleted_count integer;
  v_inserted_count integer;
  v_all_valid boolean;
  v_connection_status text;
begin
  if p_run_id is null
     or p_company_key is null
     or p_company_key <> btrim(p_company_key)
     or char_length(p_company_key) not between 1 and 80
     or p_company_key !~ '^[A-Za-z0-9._-]+$'
     or p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 20000
     or p_source_hash is null
     or p_source_hash !~ '^[0-9a-f]{64}$'
     or p_omitted_count is null
     or p_omitted_count < 0
     or p_omitted_count > 50000
     or p_completed_at is null
     or p_completed_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'invalid_flowaccount_publish_request'
      using errcode = '22023';
  end if;

  -- Lock the connection before the run, matching disconnect's lock order.
  -- This serializes publish with disconnect and tenant switching without a
  -- publish/run-vs-connection deadlock.
  select connection.status into v_connection_status
  from pricing_private.flowaccount_mcp_connections as connection
  where connection.company_key = p_company_key
  for update;

  if not found or v_connection_status <> 'connected' then
    raise exception 'flowaccount_not_connected'
      using errcode = '55000';
  end if;

  select sync_run.* into v_run
  from pricing_private.flowaccount_price_sync_runs as sync_run
  where sync_run.id = p_run_id
  for update;

  if not found
     or v_run.company_key <> p_company_key
     or v_run.status <> 'running'
     or p_completed_at < v_run.started_at then
    raise exception 'flowaccount_sync_run_not_publishable'
      using errcode = '55000';
  end if;

  select count(*)::integer,
         coalesce(bool_and(
           pricing_private.flowaccount_publish_row_is_structurally_valid(item)
         ), true)
    into v_row_count, v_all_valid
  from jsonb_array_elements(p_rows) as input(item);

  if not v_all_valid then
    raise exception 'invalid_flowaccount_publish_row'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as input(item)
    group by item->>'document_record_id', item->>'line_key'
    having count(*) > 1
  ) then
    raise exception 'duplicate_flowaccount_publish_row'
      using errcode = '22023';
  end if;

  select count(distinct (
           case
             when lower(item->>'line_key') like 'quotation:%' then 'quotation'
             when lower(item->>'line_key') like 'tax_invoice:%' then 'tax_invoice'
             when lower(item->>'line_key') like 'cash_invoice:%' then 'cash_invoice'
             else 'unknown'
           end,
           item->>'document_record_id'
         ))::integer
    into v_document_count
  from jsonb_array_elements(p_rows) as input(item);

  with raw_rows as (
    select
      (item->>'document_record_id')::bigint as document_record_id,
      item->>'line_key' as line_key,
      nullif(item->>'document_serial', '') as document_serial,
      (item->>'document_status')::integer as document_status,
      (item->>'published_on')::date as published_on,
      (item->>'source_updated_at')::timestamptz as source_updated_at,
      case when nullif(item->>'source_contact_id', '') is not null
        then (item->>'source_contact_id')::bigint
      end as source_contact_id,
      item->>'source_contact_tax_id' as source_contact_tax_id,
      item->>'source_sku' as source_sku,
      item->>'source_unit' as source_unit,
      (item->>'source_quantity')::numeric as source_quantity,
      (item->>'net_unit_price')::numeric as net_unit_price,
      item->>'currency' as currency,
      (item->>'eligible')::boolean as source_eligible,
      nullif(item->>'eligibility_reason', '') as source_eligibility_reason,
      item->>'source_hash' as source_hash
    from jsonb_array_elements(p_rows) as input(item)
  ), resolved_rows as (
    select raw_rows.*,
           customer_match.customer_id,
           customer_match.match_count as customer_match_count,
           product_match.product_id,
           product_match.match_count as product_match_count
    from raw_rows
    cross join lateral (
      select case when count(*) = 1 then min(customer.id::text)::uuid end as customer_id,
             count(*)::integer as match_count
      from public.customers as customer
      where regexp_replace(coalesce(customer.tax_id, ''), '[^0-9]', '', 'g')
        = raw_rows.source_contact_tax_id
    ) as customer_match
    cross join lateral (
      select case when count(*) = 1 then min(product.id::text)::uuid end as product_id,
             count(*)::integer as match_count
      from public.products as product
      where upper(btrim(product.sku)) = upper(btrim(raw_rows.source_sku))
        and lower(btrim(product.unit)) = lower(btrim(raw_rows.source_unit))
        and product.status = 'active'
    ) as product_match
  ), publishable_rows as (
    select resolved_rows.*,
      (
        source_eligible
        and product_match_count = 1
        and currency = 'THB'
        and net_unit_price > 0
        and published_on between v_run.window_start and v_run.window_end
        and published_on >= p_completed_at::date - 180
        and source_updated_at <= p_completed_at + interval '5 minutes'
      ) as final_eligible,
      case
        when product_match_count = 0 then 'product_not_in_corebiz'
        when product_match_count <> 1 then 'product_mapping_ambiguous'
        when not source_eligible then
          coalesce(source_eligibility_reason, 'source_marked_ineligible')
        when currency <> 'THB' then 'currency_not_thb'
        when net_unit_price <= 0 then 'non_positive_price'
        when published_on not between v_run.window_start and v_run.window_end
          then 'outside_sync_window'
        when published_on < p_completed_at::date - 180 then 'older_than_180_days'
        when source_updated_at > p_completed_at + interval '5 minutes'
          then 'source_timestamp_in_future'
        else null
      end as final_eligibility_reason
    from resolved_rows
    where customer_match_count = 1
  )
  insert into pricing_private.flowaccount_quote_price_cache (
    company_key, sync_run_id, document_record_id, line_key, document_serial,
    document_status, published_on, source_updated_at, source_contact_id,
    customer_id, product_id, source_sku, source_unit, source_quantity,
    net_unit_price, currency, eligible, eligibility_reason, source_hash
  )
  select
    p_company_key, p_run_id, document_record_id, line_key, document_serial,
    document_status, published_on, source_updated_at, source_contact_id,
    customer_id, product_id, source_sku, source_unit, source_quantity,
    net_unit_price, currency, final_eligible, final_eligibility_reason, source_hash
  from publishable_rows;

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_row_count then
    raise exception 'flowaccount_sync_generation_incomplete'
      using errcode = '55000';
  end if;

  select count(*)::integer into v_eligible_count
  from pricing_private.flowaccount_quote_price_cache as cache
  where cache.company_key = p_company_key
    and cache.sync_run_id = p_run_id
    and cache.eligible;
  v_rejected_count := v_row_count - v_eligible_count;

  update pricing_private.flowaccount_price_sync_runs
  set status = 'succeeded',
      source_hash = p_source_hash,
      row_count = v_row_count,
      document_count = v_document_count,
      eligible_count = v_eligible_count,
      rejected_count = v_rejected_count,
      omitted_count = p_omitted_count,
      completed_at = p_completed_at
  where id = p_run_id;

  -- The connection row lock is still held. Recheck immediately before making
  -- this generation visible so a disconnected or replaced tenant can never
  -- have its cache re-enabled by a late publisher.
  if not exists (
    select 1
    from pricing_private.flowaccount_mcp_connections as connection
    where connection.company_key = p_company_key
      and connection.status = 'connected'
  ) then
    raise exception 'flowaccount_not_connected'
      using errcode = '55000';
  end if;

  insert into pricing_private.flowaccount_price_sync_state (
    company_key, enabled, last_success_at, last_success_run_id,
    last_source_hash, updated_at
  ) values (
    p_company_key, true, p_completed_at, p_run_id,
    p_source_hash, statement_timestamp()
  )
  on conflict (company_key) do update
  set enabled = true,
      last_success_at = excluded.last_success_at,
      last_success_run_id = excluded.last_success_run_id,
      last_source_hash = excluded.last_source_hash,
      updated_at = statement_timestamp();

  v_deleted_count := public.prune_flowaccount_price_cache(
    p_company_key, p_completed_at
  );

  return jsonb_build_object(
    'published', true,
    'run_id', p_run_id,
    'row_count', v_row_count,
    'document_count', v_document_count,
    'eligible_count', v_eligible_count,
    'rejected_count', v_rejected_count,
    'omitted_count', p_omitted_count,
    'deleted_count', v_deleted_count
  );
end;
$$;

create or replace function public.fail_flowaccount_price_sync_run(
  p_run_id uuid,
  p_error_code text,
  p_completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_key text;
begin
  if p_run_id is null
     or p_error_code is null
     or p_error_code <> btrim(p_error_code)
     or char_length(p_error_code) not between 1 and 120
     or p_error_code !~ '^[A-Za-z0-9:._-]+$'
     or p_completed_at is null
     or p_completed_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'invalid_flowaccount_sync_failure'
      using errcode = '22023';
  end if;

  update pricing_private.flowaccount_price_sync_runs
  set status = 'failed',
      error_code = p_error_code,
      completed_at = p_completed_at
  where id = p_run_id
    and status = 'running'
    and p_completed_at >= started_at
  returning company_key into v_company_key;

  if v_company_key is null then
    return false;
  end if;

  update pricing_private.flowaccount_mcp_connections
  set last_error_code = p_error_code,
      updated_at = statement_timestamp()
  where company_key = v_company_key;
  return true;
end;
$$;

revoke all on function public.start_flowaccount_price_sync_run(text, text, date, date)
  from public, anon, authenticated;
revoke all on function public.publish_flowaccount_price_sync_run(
  uuid, text, jsonb, text, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.fail_flowaccount_price_sync_run(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.prune_flowaccount_price_cache(text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.start_flowaccount_price_sync_run(text, text, date, date)
  to service_role;
grant execute on function public.publish_flowaccount_price_sync_run(
  uuid, text, jsonb, text, integer, timestamptz
) to service_role;
grant execute on function public.fail_flowaccount_price_sync_run(uuid, text, timestamptz)
  to service_role;
grant execute on function public.prune_flowaccount_price_cache(text, timestamptz)
  to service_role;

-- Remove the broad Phase-1 grants. Complete generations can now be mutated
-- only through the transactional functions above.
revoke all on table pricing_private.flowaccount_quote_price_cache,
  pricing_private.flowaccount_price_sync_state
  from public, anon, authenticated, service_role;

-- -------------------------------------------------------------------------
-- Owner/admin status, disconnect, and hourly trigger
-- -------------------------------------------------------------------------

create or replace function pricing_private.mask_flowaccount_identifier(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    when char_length(p_value) <= 4 then repeat('*', char_length(p_value))
    else repeat('*', least(char_length(p_value) - 4, 12)) || right(p_value, 4)
  end;
$$;

create or replace function public.get_flowaccount_mcp_status(p_company_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_connection pricing_private.flowaccount_mcp_connections%rowtype;
  v_sync_state pricing_private.flowaccount_price_sync_state%rowtype;
  v_latest_run pricing_private.flowaccount_price_sync_runs%rowtype;
  v_has_client_id boolean;
  v_has_client_secret boolean;
  v_has_access_token boolean;
  v_has_refresh_token boolean;
begin
  if not public.can_delete() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company_key is null
     or p_company_key <> btrim(p_company_key)
     or char_length(p_company_key) not between 1 and 80
     or p_company_key !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'invalid_flowaccount_company_key'
      using errcode = '22023';
  end if;

  select connection.* into v_connection
  from pricing_private.flowaccount_mcp_connections as connection
  where connection.company_key = p_company_key;

  select state.* into v_sync_state
  from pricing_private.flowaccount_price_sync_state as state
  where state.company_key = p_company_key;

  select sync_run.* into v_latest_run
  from pricing_private.flowaccount_price_sync_runs as sync_run
  where sync_run.company_key = p_company_key
  order by sync_run.started_at desc, sync_run.id
  limit 1;

  select
    bool_or(secret.name = 'FLOWACCOUNT_MCP_CLIENT_ID'),
    bool_or(secret.name = 'FLOWACCOUNT_MCP_CLIENT_SECRET'),
    bool_or(secret.name = 'FLOWACCOUNT_MCP_ACCESS_TOKEN'),
    bool_or(secret.name = 'FLOWACCOUNT_MCP_REFRESH_TOKEN')
  into v_has_client_id, v_has_client_secret, v_has_access_token, v_has_refresh_token
  from vault.secrets as secret
  where secret.name = any(array[
    'FLOWACCOUNT_MCP_CLIENT_ID',
    'FLOWACCOUNT_MCP_CLIENT_SECRET',
    'FLOWACCOUNT_MCP_ACCESS_TOKEN',
    'FLOWACCOUNT_MCP_REFRESH_TOKEN'
  ]::text[]);

  return jsonb_build_object(
    'company_key', p_company_key,
    'status', coalesce(v_connection.status, 'disconnected'),
    'connected', coalesce(v_connection.status = 'connected', false),
    'provider_company_id_masked',
      pricing_private.mask_flowaccount_identifier(v_connection.provider_company_id),
    'provider_company_name', v_connection.provider_company_name,
    'scopes', coalesce(v_connection.scopes, '{}'),
    'token_expires_at', v_connection.token_expires_at,
    'connected_at', v_connection.connected_at,
    'refreshed_at', v_connection.refreshed_at,
    'last_error_code', v_connection.last_error_code,
    'credentials', jsonb_build_object(
      'client_id_configured', coalesce(v_has_client_id, false),
      'client_secret_configured', coalesce(v_has_client_secret, false),
      'access_token_present', coalesce(v_has_access_token, false),
      'refresh_token_present', coalesce(v_has_refresh_token, false)
    ),
    'sync', jsonb_build_object(
      'enabled', coalesce(v_sync_state.enabled, false),
      'last_success_at', v_sync_state.last_success_at,
      'stale_after_minutes', v_sync_state.stale_after_minutes,
      'max_document_age_days', v_sync_state.max_document_age_days,
      'latest_run', case when v_latest_run.id is null then null else
        jsonb_build_object(
          'run_id', v_latest_run.id,
          'status', v_latest_run.status,
          'source', v_latest_run.source,
          'started_at', v_latest_run.started_at,
          'completed_at', v_latest_run.completed_at,
          'row_count', v_latest_run.row_count,
          'document_count', v_latest_run.document_count,
          'eligible_count', v_latest_run.eligible_count,
          'rejected_count', v_latest_run.rejected_count,
          'omitted_count', v_latest_run.omitted_count,
          'error_code', v_latest_run.error_code
        ) end
    )
  );
end;
$$;

create or replace function public.get_flowaccount_mcp_sync_context(
  p_company_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_connected boolean;
  v_provider_company_id text;
  v_provider_company_name text;
  v_last_success_at timestamptz;
  v_refresh_token_present boolean;
begin
  if p_company_key is null
     or p_company_key <> btrim(p_company_key)
     or char_length(p_company_key) not between 1 and 80
     or p_company_key !~ '^[A-Za-z0-9._-]+$' then
    return '{}'::jsonb;
  end if;

  select connection.status = 'connected',
         connection.provider_company_id,
         connection.provider_company_name
    into v_connected, v_provider_company_id, v_provider_company_name
  from pricing_private.flowaccount_mcp_connections as connection
  where connection.company_key = p_company_key;

  select state.last_success_at into v_last_success_at
  from pricing_private.flowaccount_price_sync_state as state
  where state.company_key = p_company_key;

  select exists (
    select 1 from vault.secrets as secret
    where secret.name = 'FLOWACCOUNT_MCP_REFRESH_TOKEN'
  ) into v_refresh_token_present;

  return jsonb_build_object(
    'connected', coalesce(v_connected, false),
    'provider_company_id', v_provider_company_id,
    'provider_company_name', v_provider_company_name,
    'refresh_token_present', coalesce(v_refresh_token_present, false),
    'last_success_at', v_last_success_at
  );
end;
$$;

create or replace function public.disconnect_flowaccount_mcp(p_company_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_tokens integer;
begin
  if not public.can_delete() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company_key is null
     or p_company_key <> btrim(p_company_key)
     or char_length(p_company_key) not between 1 and 80
     or p_company_key !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'invalid_flowaccount_company_key'
      using errcode = '22023';
  end if;

  perform 1
  from pricing_private.flowaccount_mcp_connections as connection
  where connection.company_key = p_company_key
  for update;
  if not found then
    return false;
  end if;

  delete from vault.secrets
  where name in (
    'FLOWACCOUNT_MCP_ACCESS_TOKEN',
    'FLOWACCOUNT_MCP_REFRESH_TOKEN'
  );
  get diagnostics v_deleted_tokens = row_count;

  delete from pricing_private.flowaccount_mcp_oauth_states
  where company_key = p_company_key;

  update pricing_private.flowaccount_price_sync_runs
  set status = 'failed',
      error_code = 'manual_disconnect',
      completed_at = statement_timestamp()
  where company_key = p_company_key
    and status = 'running';

  update pricing_private.flowaccount_price_sync_state
  set enabled = false,
      updated_at = statement_timestamp()
  where company_key = p_company_key;

  update pricing_private.flowaccount_mcp_connections
  set status = 'disconnected',
      token_expires_at = null,
      last_error_code = null,
      updated_at = statement_timestamp()
  where company_key = p_company_key;

  insert into public.audit_logs (
    actor_id, action, target_type, target_id, detail
  ) values (
    auth.uid(),
    'flowaccount_mcp.disconnect',
    'flowaccount_mcp_connection',
    p_company_key,
    jsonb_build_object(
      'tokens_deleted', v_deleted_tokens > 0,
      'deleted_token_count', v_deleted_tokens,
      'sync_disabled', true,
      'disconnected_at', statement_timestamp()
    )
  );

  return true;
end;
$$;

revoke all on function public.get_flowaccount_mcp_status(text)
  from public, anon, service_role;
revoke all on function public.get_flowaccount_mcp_sync_context(text)
  from public, anon, authenticated;
revoke all on function public.disconnect_flowaccount_mcp(text)
  from public, anon, service_role;
grant execute on function public.get_flowaccount_mcp_status(text)
  to authenticated;
grant execute on function public.get_flowaccount_mcp_sync_context(text)
  to service_role;
grant execute on function public.disconnect_flowaccount_mcp(text)
  to authenticated;

create or replace function public.run_flowaccount_price_sync_internal()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sync_key text;
  v_request_id bigint;
begin
  if not exists (
    select 1
    from pricing_private.flowaccount_mcp_connections as connection
    where connection.status = 'connected'
  ) or not exists (
    select 1
    from vault.secrets as secret
    where secret.name = 'FLOWACCOUNT_MCP_REFRESH_TOKEN'
  ) then
    return null;
  end if;

  select secret.decrypted_secret into v_sync_key
  from vault.decrypted_secrets as secret
  where secret.name = 'FLOWACCOUNT_MCP_SYNC_KEY'
  order by secret.created_at desc
  limit 1;

  if nullif(v_sync_key, '') is null then
    return null;
  end if;

  select net.http_post(
    url := 'https://owoedccmuqnzdtxvywgt.supabase.co/functions/v1/flowaccount-price-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-flowaccount-sync-key', v_sync_key
    ),
    body := '{}'::jsonb
  ) into v_request_id;
  return v_request_id;
exception when others then
  return null;
end;
$$;

revoke all on function public.run_flowaccount_price_sync_internal()
  from public, anon, authenticated;
grant execute on function public.run_flowaccount_price_sync_internal()
  to service_role;

-- Schedule only on installations where both extensions already exist. The
-- non-zero minute avoids contention with other top-of-hour jobs.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    if exists (select 1 from cron.job where jobname = 'flowaccount-price-sync-hourly') then
      perform cron.unschedule('flowaccount-price-sync-hourly');
    end if;
    perform cron.schedule(
      'flowaccount-price-sync-hourly',
      '17 * * * *',
      'select public.run_flowaccount_price_sync_internal();'
    );
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'bot-conversation-memory-cleanup-hourly') then
      perform cron.unschedule('bot-conversation-memory-cleanup-hourly');
    end if;
    perform cron.schedule(
      'bot-conversation-memory-cleanup-hourly',
      '41 * * * *',
      'select public.cleanup_expired_bot_conversation_memory();'
    );
  end if;
exception when others then
  raise notice 'FlowAccount hourly schedule skipped: %', sqlerrm;
end;
$$;

comment on table pricing_private.flowaccount_mcp_oauth_states is
  'Private, short-lived, single-use OAuth state. Contains PKCE verifier but never provider access or refresh tokens.';
comment on table pricing_private.flowaccount_mcp_connections is
  'Private FlowAccount connection metadata only; provider credentials remain in Vault.';
comment on table pricing_private.flowaccount_price_sync_runs is
  'Audit record for complete FlowAccount normalized price generations.';

revoke all on function pricing_private.memory_topics_are_safe(text[])
  from public, anon, authenticated, service_role;
revoke all on function pricing_private.memory_text_is_safe(text)
  from public, anon, authenticated, service_role;
revoke all on function pricing_private.memory_locked_fields_are_safe(text[])
  from public, anon, authenticated, service_role;
revoke all on function pricing_private.memory_json_value_is_safe(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function pricing_private.memory_state_is_safe(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function pricing_private.flowaccount_scopes_are_safe(text[])
  from public, anon, authenticated, service_role;
revoke all on function pricing_private.flowaccount_public_secret_name_is_allowed(text)
  from public, anon, authenticated, service_role;
revoke all on function pricing_private.flowaccount_publish_row_is_structurally_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function pricing_private.mask_flowaccount_identifier(text)
  from public, anon, authenticated, service_role;
