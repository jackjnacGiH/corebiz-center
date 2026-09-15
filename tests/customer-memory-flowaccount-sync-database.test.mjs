import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(
  join(
    process.env.CUSTOMER_PRICING_TEST_RUNTIME ||
      process.env.SHIPPING_TEST_RUNTIME ||
      join(tmpdir(), "corebiz-shipping-test-runtime"),
    "package.json",
  ),
);
const { PGlite } = require("@electric-sql/pglite");

const IDS = {
  owner: "00000000-0000-4000-8000-000000000001",
  viewer: "00000000-0000-4000-8000-000000000002",
  contact: "00000000-0000-4000-8000-000000000003",
  customerA: "00000000-0000-4000-8000-000000000101",
  customerB: "00000000-0000-4000-8000-000000000102",
  duplicateCustomer: "00000000-0000-4000-8000-000000000103",
  product: "00000000-0000-4000-8000-000000000201",
  otherProduct: "00000000-0000-4000-8000-000000000202",
  conversation: "00000000-0000-4000-8000-000000000301",
  invalidConversation: "00000000-0000-4000-8000-000000000302",
  pendingConversation: "00000000-0000-4000-8000-000000000303",
};

const MIGRATION_URLS = [
  new URL(
    "../supabase/migrations/20260913102145_customer_memory_flowaccount_sync.sql",
    import.meta.url,
  ),
  new URL(
    "../supabase/migrations/20260915024000_flowaccount_active_customer_cap.sql",
    import.meta.url,
  ),
];

function json(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function bootstrap() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;

    create function public.gen_random_bytes(byte_count integer)
    returns bytea language sql as $$
      select convert_to(repeat('a', byte_count), 'UTF8')
    $$;

    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid(), auth.role()
      to anon, authenticated, service_role;

    create table public.profiles (
      id uuid primary key,
      role text not null,
      is_active boolean not null default true,
      line_user_id text
    );
    create function public.can_delete() returns boolean
      language sql stable security definer set search_path = public as $$
      select exists (
        select 1 from public.profiles
        where id = auth.uid() and is_active and role in ('owner', 'admin')
      )
    $$;

    create table public.customers (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      tax_id text,
      created_at timestamptz not null default now()
    );
    create table public.customer_contacts (
      id uuid primary key default gen_random_uuid(),
      customer_id uuid not null references public.customers(id),
      user_id uuid not null references public.profiles(id),
      contact_name text,
      verified boolean not null default false,
      verified_at timestamptz,
      created_at timestamptz not null default now()
    );
    create table public.products (
      id uuid primary key default gen_random_uuid(),
      sku text not null,
      name_th text not null,
      unit text not null,
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.chat_conversations (
      id uuid primary key default gen_random_uuid(),
      channel text not null,
      external_id text,
      customer_id uuid references public.customers(id),
      display_name text not null,
      metadata jsonb not null default '{}'::jsonb,
      last_message_at timestamptz,
      last_customer_message_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.orders (
      id uuid primary key default gen_random_uuid(),
      code text not null,
      customer_id uuid references public.customers(id),
      status text not null,
      created_at timestamptz not null default now()
    );
    create table public.order_items (
      id uuid primary key default gen_random_uuid(),
      order_id uuid not null references public.orders(id),
      product_id uuid references public.products(id),
      sku text not null,
      product_name text not null,
      quantity integer not null
    );
    create table public.quotes (
      id uuid primary key default gen_random_uuid(),
      code text not null,
      customer_id uuid references public.customers(id),
      status text not null,
      created_at timestamptz not null default now()
    );
    create table public.quote_items (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null references public.quotes(id),
      product_id uuid references public.products(id),
      sku text not null,
      product_name text not null,
      quantity integer not null,
      unit text
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      actor_id uuid references public.profiles(id),
      action text not null,
      target_type text,
      target_id text,
      detail jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table public.bot_learning_settings (
      id boolean primary key default true check (id),
      enabled boolean not null default true,
      context_memory_enabled boolean not null default true,
      candidate_capture_enabled boolean not null default true,
      memory_ttl_days integer not null default 90,
      max_context_chars integer not null default 600,
      updated_at timestamptz not null default now(),
      updated_by uuid
    );
    insert into public.bot_learning_settings(id) values (true);
    create table public.bot_conversation_memory (
      conversation_id uuid primary key references public.chat_conversations(id),
      summary text not null check (char_length(summary) between 1 and 600),
      topics text[] not null default '{}',
      source_channel text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (cardinality(topics) <= 8)
    );
    alter table public.bot_conversation_memory enable row level security;
    grant all on public.bot_conversation_memory to service_role;

    create schema pricing_private;
    create function pricing_private.bot_pricing_context(p_conversation_id uuid)
    returns table (
      customer_id uuid,
      personalized_allowed boolean,
      pricing_context_reason text
    ) language plpgsql stable security definer set search_path = '' as $$
    declare
      v_customer_id uuid;
      v_tax_id text;
      v_metadata jsonb;
      v_channel text;
      v_external_id text;
    begin
      select conversation.customer_id,
             regexp_replace(coalesce(customer.tax_id,''),'[^0-9]','','g'),
             conversation.metadata, conversation.channel, conversation.external_id
        into v_customer_id, v_tax_id, v_metadata, v_channel, v_external_id
      from public.chat_conversations as conversation
      left join public.customers as customer on customer.id=conversation.customer_id
      where conversation.id=p_conversation_id;
      if not found or v_customer_id is null or length(v_tax_id) <> 13 then
        return query select v_customer_id, false, 'no_verified_customer_context'::text;
        return;
      end if;
      if coalesce(v_metadata->>'quote_customer_link_method','') <> 'tax_id' then
        return query select v_customer_id, true, 'manual_or_preexisting_link'::text;
        return;
      end if;
      if nullif(v_metadata->>'price_history_verified_at','') is not null
         or exists (
           select 1
           from public.customer_contacts as contact
           join public.profiles as profile on profile.id=contact.user_id
           where contact.customer_id=v_customer_id
             and contact.verified
             and v_channel='line'
             and profile.line_user_id=v_external_id
         ) then
        return query select v_customer_id, true, 'verified_customer_contact'::text;
        return;
      end if;
      return query select v_customer_id, false, 'tax_link_pending_verification'::text;
    end $$;
    create table pricing_private.flowaccount_quote_price_cache (
      id uuid primary key default gen_random_uuid(),
      company_key text not null check (btrim(company_key) <> ''),
      sync_run_id uuid not null,
      document_record_id bigint not null check (document_record_id > 0),
      line_key text not null check (btrim(line_key) <> ''),
      document_serial text,
      document_status integer not null,
      published_on date not null,
      source_updated_at timestamptz not null,
      source_contact_id bigint,
      customer_id uuid not null references public.customers(id),
      product_id uuid not null references public.products(id),
      source_sku text not null check (btrim(source_sku) <> ''),
      source_unit text not null check (btrim(source_unit) <> ''),
      unit_key text generated always as (lower(btrim(source_unit))) stored,
      source_quantity numeric(14,3) not null check (source_quantity > 0),
      net_unit_price numeric(14,2) not null check (net_unit_price > 0),
      currency text not null default 'THB'
        check (currency = upper(currency) and length(currency) = 3),
      eligible boolean not null default false,
      eligibility_reason text,
      source_hash text not null check (btrim(source_hash) <> ''),
      first_seen_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      unique (company_key, sync_run_id, document_record_id, line_key)
    );
    create table pricing_private.flowaccount_price_sync_state (
      company_key text primary key,
      enabled boolean not null default false,
      last_success_at timestamptz,
      last_success_run_id uuid,
      stale_after_minutes integer not null default 1440,
      max_document_age_days integer not null default 180,
      last_source_hash text,
      updated_at timestamptz not null default now()
    );
    alter table pricing_private.flowaccount_quote_price_cache enable row level security;
    alter table pricing_private.flowaccount_price_sync_state enable row level security;
    grant all on pricing_private.flowaccount_quote_price_cache,
      pricing_private.flowaccount_price_sync_state to service_role;

    create schema vault;
    create table vault.secrets (
      id uuid primary key default gen_random_uuid(),
      secret text not null,
      name text not null unique,
      description text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create view vault.decrypted_secrets as
      select id, secret as decrypted_secret, name, description,
             created_at, updated_at
      from vault.secrets;
    create function vault.create_secret(
      new_secret text, new_name text, new_description text
    ) returns uuid language plpgsql security definer set search_path = '' as $$
    declare v_id uuid;
    begin
      insert into vault.secrets(secret, name, description)
      values(new_secret, new_name, new_description)
      returning id into v_id;
      return v_id;
    end $$;
    create function vault.update_secret(
      secret_id uuid, new_secret text, new_name text, new_description text
    ) returns void language sql security definer set search_path = '' as $$
      update vault.secrets
      set secret = new_secret, name = new_name, description = new_description,
          updated_at = statement_timestamp()
      where id = secret_id
    $$;

    create schema net;
    create function net.http_post(url text, headers jsonb, body jsonb)
    returns bigint language sql as $$ select 1::bigint $$;

    insert into public.profiles(id, role, is_active, line_user_id) values
      ('${IDS.owner}', 'owner', true, 'U-OWNER'),
      ('${IDS.viewer}', 'viewer', true, null),
      ('${IDS.contact}', 'customer', true, 'U-CUSTOMER');
    insert into public.customers(id, name, tax_id) values
      ('${IDS.customerA}', 'J NAC Factory', '0105558123456'),
      ('${IDS.customerB}', 'Second Factory', '123');
    insert into public.products(id, sku, name_th, unit, status) values
      ('${IDS.product}', 'SKU-001', 'ใบเจียรอุตสาหกรรม', 'ชิ้น', 'active'),
      ('${IDS.otherProduct}', 'SKU-002', 'ใบตัดอุตสาหกรรม', 'กล่อง', 'active');
    insert into public.chat_conversations(
      id, channel, external_id, customer_id, display_name, metadata,
      last_message_at, last_customer_message_at
    ) values
      ('${IDS.conversation}', 'line', 'U-CUSTOMER', '${IDS.customerA}', 'คุณนัท',
       '{"quote_customer_link_method":"tax_id"}'::jsonb, now(), now()),
      ('${IDS.invalidConversation}', 'line', 'U-NO-TAX', '${IDS.customerB}', 'คุณบี',
       '{}'::jsonb, now(), now()),
      ('${IDS.pendingConversation}', 'line', 'U-PENDING', '${IDS.customerA}', 'คุณรอตรวจ',
       '{"quote_customer_link_method":"tax_id"}'::jsonb, now(), now());
    insert into public.customer_contacts(
      customer_id, user_id, contact_name, verified, verified_at
    ) values (
      '${IDS.customerA}', '${IDS.contact}', 'คุณสมชาย', true, now()
    );
  `);

  const migrations = await Promise.all(
    MIGRATION_URLS.map((migrationUrl) => readFile(migrationUrl, "utf8")),
  );
  for (const migration of migrations) await db.exec(migration);
  return { db, migration: migrations.join("\n") };
}

async function asRole(db, role, subject, callback) {
  await db.exec(`set role ${role}`);
  await db.query(
    `select set_config('request.jwt.claim.role', $1, false),
            set_config('request.jwt.claim.sub', $2, false)`,
    [role, subject || ""],
  );
  try {
    return await callback();
  } finally {
    await db.exec("reset role");
    await db.query(
      `select set_config('request.jwt.claim.role', '', false),
              set_config('request.jwt.claim.sub', '', false)`,
    );
  }
}

async function serviceQuery(db, sql, params = []) {
  return asRole(db, "service_role", "", () => db.query(sql, params));
}

async function authQuery(db, subject, sql, params = []) {
  return asRole(db, "authenticated", subject, () => db.query(sql, params));
}

async function callMemory(db, {
  summary,
  state,
  turnOffset = "0 seconds",
  conversationId = IDS.conversation,
  channel = "line",
}) {
  return serviceQuery(
    db,
    `select public.upsert_bot_conversation_memory_state(
       $1::uuid, $2, array['abrasive']::text[], $3::jsonb, $4,
       statement_timestamp() + interval '90 days',
       statement_timestamp() + $5::interval
     ) as accepted`,
    [conversationId, summary, JSON.stringify(state), channel, turnOffset],
  );
}

test("memory updates are monotonic, staff locks win, and remaps scrub state", async () => {
  const { db, migration } = await bootstrap();
  try {
    await db.exec(migration);
    const gate = await db.query(
      "select structured_memory_enabled from public.bot_learning_settings where id",
    );
    assert.equal(gate.rows[0].structured_memory_enabled, false);
    const lockDefinitions = await db.query(`
      select pg_get_functiondef(
        'public.upsert_bot_conversation_memory_state(uuid,text,text[],jsonb,text,timestamptz,timestamptz)'::regprocedure
      ) as upsert_definition,
      pg_get_functiondef(
        'public.set_bot_conversation_memory_staff_control(uuid,text[],text,boolean)'::regprocedure
      ) as staff_definition
    `);
    assert.match(
      lockDefinitions.rows[0].upsert_definition.toLowerCase(),
      /from public\.chat_conversations as conversation[\s\S]*?for update/,
    );
    assert.match(
      lockDefinitions.rows[0].staff_definition.toLowerCase(),
      /from public\.chat_conversations as conversation[\s\S]*?for update/,
    );

    let result = await callMemory(db, {
      summary: "ลูกค้าสนใจใบเจียร",
      state: { product_family: "grinding", quantity: 10 },
      turnOffset: "-10 seconds",
    });
    assert.equal(result.rows[0].accepted, true);

    result = await callMemory(db, {
      summary: "ข้อมูลเก่าที่มาช้า",
      state: { product_family: "wrong" },
      turnOffset: "-20 seconds",
    });
    assert.equal(result.rows[0].accepted, false);
    result = await serviceQuery(
      db,
      `select public.upsert_bot_conversation_memory_state(
        $1, 'ข้อมูลเวลาเท่ากัน', array['abrasive']::text[],
        '{"product_family":"wrong"}'::jsonb, 'line',
        memory.expires_at, memory.last_turn_at
      ) as accepted
      from public.bot_conversation_memory as memory
      where memory.conversation_id=$1`,
      [IDS.conversation],
    );
    assert.equal(result.rows[0].accepted, false);

    let stored = await db.query(
      "select summary, structured_state from public.bot_conversation_memory where conversation_id=$1",
      [IDS.conversation],
    );
    assert.equal(stored.rows[0].summary, "ลูกค้าสนใจใบเจียร");
    assert.equal(json(stored.rows[0].structured_state).product_family, "grinding");

    await db.exec("update public.bot_learning_settings set memory_ttl_days=30 where id");
    result = await serviceQuery(
      db,
      `select public.set_bot_conversation_memory_staff_control(
        $1, array['product_family']::text[], 'ยืนยันกลุ่มสินค้าแล้ว', false
      ) as updated`,
      [IDS.conversation],
    );
    assert.equal(result.rows[0].updated, true);
    const staffTtl = await db.query(
      `select expires_at between statement_timestamp() + interval '29 days'
                             and statement_timestamp() + interval '31 days' as bounded
       from public.bot_conversation_memory where conversation_id=$1`,
      [IDS.conversation],
    );
    assert.equal(staffTtl.rows[0].bounded, true);

    result = await callMemory(db, {
      summary: "ลูกค้าเพิ่มจำนวน",
      state: { product_family: "cutting", quantity: 20 },
      turnOffset: "10 seconds",
    });
    assert.equal(result.rows[0].accepted, true);
    stored = await db.query(
      `select summary, structured_state, locked_fields, staff_note, staff_locked
       from public.bot_conversation_memory where conversation_id=$1`,
      [IDS.conversation],
    );
    assert.deepEqual(json(stored.rows[0].structured_state), {
      product_family: "grinding",
      quantity: 20,
    });
    assert.deepEqual(stored.rows[0].locked_fields, ["product_family"]);
    assert.equal(stored.rows[0].staff_note, "ยืนยันกลุ่มสินค้าแล้ว");

    await serviceQuery(
      db,
      `select public.set_bot_conversation_memory_staff_control(
        $1, array['product_family']::text[], 'เจ้าหน้าที่ล็อกทั้งหมด', true
      )`,
      [IDS.conversation],
    );
    result = await callMemory(db, {
      summary: "พยายามเขียนทับหลังล็อก",
      state: { product_family: "wrong", quantity: 99 },
      turnOffset: "20 seconds",
    });
    assert.equal(result.rows[0].accepted, false);
    stored = await db.query(
      `select summary, structured_state, locked_fields, staff_note, staff_locked
       from public.bot_conversation_memory where conversation_id=$1`,
      [IDS.conversation],
    );
    assert.equal(stored.rows[0].summary, "ลูกค้าเพิ่มจำนวน");
    assert.deepEqual(json(stored.rows[0].structured_state), {
      product_family: "grinding",
      quantity: 20,
    });
    assert.equal(stored.rows[0].staff_note, "เจ้าหน้าที่ล็อกทั้งหมด");
    assert.equal(stored.rows[0].staff_locked, true);

    await db.query(
      "update public.chat_conversations set customer_id=$1 where id=$2",
      [IDS.customerB, IDS.conversation],
    );
    stored = await db.query(
      "select count(*)::int as count from public.bot_conversation_memory where conversation_id=$1",
      [IDS.conversation],
    );
    assert.equal(stored.rows[0].count, 0);
    const epochResult = await db.query(
      `select identity_changed_at
       from pricing_private.bot_conversation_identity_epochs
       where conversation_id=$1`,
      [IDS.conversation],
    );
    const identityEpoch = epochResult.rows[0].identity_changed_at instanceof Date
      ? epochResult.rows[0].identity_changed_at.toISOString()
      : String(epochResult.rows[0].identity_changed_at);
    result = await serviceQuery(
      db,
      `select public.upsert_bot_conversation_memory_state(
        $1, 'turn เวลาเท่ากับ identity epoch', array['abrasive']::text[],
        '{}'::jsonb, 'line', $2::timestamptz + interval '90 days',
        $2::timestamptz
      ) as accepted`,
      [IDS.conversation, identityEpoch],
    );
    assert.equal(result.rows[0].accepted, false);
    result = await callMemory(db, {
      summary: "turn เก่าหลังย้ายลูกค้า",
      state: { product_family: "wrong" },
      turnOffset: "-5 seconds",
    });
    assert.equal(result.rows[0].accepted, false);
    stored = await db.query(
      "select count(*)::int as count from public.bot_conversation_memory where conversation_id=$1",
      [IDS.conversation],
    );
    assert.equal(stored.rows[0].count, 0);

    result = await callMemory(db, {
      summary: "บริบทใหม่หลังย้ายลูกค้า",
      state: { product_family: "new_customer" },
      turnOffset: "30 seconds",
    });
    assert.equal(result.rows[0].accepted, true);
    stored = await db.query(
      `select customer_id, locked_fields, staff_note, staff_locked
       from public.bot_conversation_memory where conversation_id=$1`,
      [IDS.conversation],
    );
    assert.equal(stored.rows[0].customer_id, IDS.customerB);
    assert.deepEqual(stored.rows[0].locked_fields, []);
    assert.equal(stored.rows[0].staff_note, null);
    assert.equal(stored.rows[0].staff_locked, false);

    result = await callMemory(db, {
      summary: "ยืนยันข้อมูลสินค้า",
      state: {
        active_intent: "product_inquiry",
        products: [{ sku: "SKU-001", name: "ใบเจียรอุตสาหกรรม", size: "4 นิ้ว", grit: "120", unit: "ชิ้น", quantity: 10 }],
        application: "grinding",
        machine: "DEROS650",
        material: "steel",
        confirmed_facts: ["sku=SKU-001", "quantity=10"],
        pending_questions: ["holes"],
        preferences: ["ตอบกระชับ"],
        last_action: "product_search",
      },
      turnOffset: "35 seconds",
    });
    assert.equal(result.rows[0].accepted, true);

    for (const unsafeState of [
      { application: "สมชาย ใจดี" },
      { material: "84/2 สุขุมวิท 71 กรุงเทพฯ" },
      { confirmed_facts: ["สมชาย ใจดี"] },
      { confirmed_facts: ["machine=สมชาย ใจดี"] },
    ]) {
      await assert.rejects(
        () => callMemory(db, {
          summary: "ข้อมูลทั่วไป",
          state: unsafeState,
          turnOffset: "40 seconds",
        }),
        /invalid_conversation_memory_state/,
      );
    }

    await assert.rejects(
      () => callMemory(db, {
        summary: "ห้ามเก็บข้อมูลลับ",
        state: { nested: [[{ tax_id: "0105558123456" }]] },
        turnOffset: "40 seconds",
      }),
      /invalid_conversation_memory_state/,
    );
    for (const unsafeSummary of [
      "ติดต่อ buyer@example.com",
      "โทร +66 (81) 234-5678",
      "เลข 0-1055-58123-45-6",
      "ราคา 1,250บาทครับ",
      "สมชาย ใจดี",
      "84/2 สุขุมวิท 71 กรุงเทพฯ",
    ]) {
      await assert.rejects(
        () => callMemory(db, {
          summary: unsafeSummary,
          state: {},
          turnOffset: "41 seconds",
        }),
        /invalid_conversation_memory_state/,
      );
    }
    await assert.rejects(
      () => callMemory(db, {
        summary: "ข้อมูลทั่วไป",
        state: { note: "โทร 080-016-1700" },
        turnOffset: "42 seconds",
      }),
      /invalid_conversation_memory_state/,
    );
    await assert.rejects(
      () => serviceQuery(
        db,
        `select public.set_bot_conversation_memory_staff_control(
          $1, '{}'::text[], 'ส่งราคา 500 บาทให้ลูกค้า', false
        )`,
        [IDS.conversation],
      ),
      /invalid_memory_staff_control/,
    );
    await assert.rejects(
      () => callMemory(db, {
        summary: "state ใหญ่เกินขอบเขต",
        state: { detail: "x".repeat(17_000) },
        turnOffset: "40 seconds",
      }),
      /invalid_conversation_memory_state/,
    );
    result = await callMemory(db, {
      summary: "ช่องทางไม่ตรง",
      state: {},
      turnOffset: "40 seconds",
      channel: "livechat",
    });
    assert.equal(result.rows[0].accepted, false);

    await assert.rejects(
      () => serviceQuery(
        db,
        "update public.bot_conversation_memory set summary='bypass' where conversation_id=$1",
        [IDS.conversation],
      ),
      /permission denied/,
    );
    await assert.rejects(
      () => authQuery(
        db,
        IDS.owner,
        `select public.upsert_bot_conversation_memory_state(
          $1, 'x', '{}'::text[], '{}'::jsonb, 'line', now()+interval '1 day', now()
        )`,
        [IDS.conversation],
      ),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("expired memory cannot be revived by staff control and service cleanup removes only expired rows", async () => {
  const { db, migration } = await bootstrap();
  try {
    assert.match(migration, /bot-conversation-memory-cleanup-hourly/);
    await callMemory(db, {
      summary: "บริบทที่หมดอายุ",
      state: { products: [{ sku: "SKU-001" }] },
      conversationId: IDS.conversation,
    });
    await callMemory(db, {
      summary: "บริบทที่ยังใช้งาน",
      state: { products: [{ sku: "SKU-002" }] },
      conversationId: IDS.invalidConversation,
    });
    await db.query(
      "update public.bot_conversation_memory set expires_at=statement_timestamp()-interval '1 second' where conversation_id=$1",
      [IDS.conversation],
    );

    const staffAttempt = await serviceQuery(
      db,
      `select public.set_bot_conversation_memory_staff_control(
        $1, '{}'::text[], 'บันทึกทั่วไป', false
      ) as updated`,
      [IDS.conversation],
    );
    assert.equal(staffAttempt.rows[0].updated, false);
    await assert.rejects(
      () => authQuery(db, IDS.owner, "select public.cleanup_expired_bot_conversation_memory()"),
      /permission denied/,
    );

    const cleaned = await serviceQuery(
      db,
      "select public.cleanup_expired_bot_conversation_memory() as deleted",
    );
    assert.equal(cleaned.rows[0].deleted, 1);
    const remaining = await db.query(
      "select conversation_id from public.bot_conversation_memory order by conversation_id",
    );
    assert.deepEqual(remaining.rows.map((row) => row.conversation_id), [IDS.invalidConversation]);
  } finally {
    await db.close();
  }
});

test("customer context is service-only, tax-gated, bounded, and redacted", async () => {
  const { db } = await bootstrap();
  try {
    await db.exec(`
      insert into public.orders(id, code, customer_id, status, created_at)
      select gen_random_uuid(), 'ORD-' || n, '${IDS.customerA}', 'delivered',
             now() - make_interval(days => n)
      from generate_series(1, 65) n;
      insert into public.order_items(order_id, product_id, sku, product_name, quantity)
      select id, '${IDS.product}', 'SKU-001', 'ใบเจียรอุตสาหกรรม', 10
      from public.orders;
      insert into public.orders(code, customer_id, status, created_at)
      values ('ORD-OLD', '${IDS.customerA}', 'delivered', now()-interval '181 days');
      insert into public.order_items(order_id, product_id, sku, product_name, quantity)
      select id, '${IDS.product}', 'SKU-001', 'รายการเก่า', 1
      from public.orders where code='ORD-OLD';

      insert into public.orders(code, customer_id, status, created_at) values
        ('ORD-CANCELLED', '${IDS.customerA}', 'cancelled', now()),
        ('ORD-RETURNED', '${IDS.customerA}', 'returned', now());
      insert into public.order_items(order_id, product_id, sku, product_name, quantity)
      select id, '${IDS.product}', 'SKU-001',
             case status
               when 'cancelled' then 'รายการคำสั่งซื้อยกเลิก'
               else 'รายการคำสั่งซื้อคืนแล้ว'
             end,
             1
      from public.orders where code in ('ORD-CANCELLED', 'ORD-RETURNED');

      insert into public.quotes(code, customer_id, status, created_at) values
        ('QT-SENT', '${IDS.customerA}', 'sent', now()),
        ('QT-DRAFT', '${IDS.customerA}', 'draft', now()),
        ('QT-REJECTED', '${IDS.customerA}', 'rejected', now()),
        ('QT-EXPIRED', '${IDS.customerA}', 'expired', now()),
        ('QT-CANCELLED', '${IDS.customerA}', 'cancelled', now());
      insert into public.quote_items(quote_id, product_id, sku, product_name, quantity, unit)
      select id, '${IDS.product}', 'SKU-001',
             case status
               when 'sent' then 'รายการใบเสนอราคาที่ส่งแล้ว'
               when 'draft' then 'รายการใบเสนอราคาแบบร่าง'
               when 'rejected' then 'รายการใบเสนอราคาปฏิเสธ'
               when 'expired' then 'รายการใบเสนอราคาหมดอายุ'
               else 'รายการใบเสนอราคายกเลิก'
             end,
             1, 'ชิ้น'
      from public.quotes where code like 'QT-%';

      insert into pricing_private.flowaccount_mcp_connections(
        company_key,status,provider_company_id,provider_company_name,scopes,
        token_expires_at,connected_at
      ) values (
        'jnac','connected','FLOW-1','J NAC Thailand','{}',
        now()+interval '1 hour',now()
      );
      insert into pricing_private.flowaccount_price_sync_runs(
        id,company_key,source,status,window_start,window_end,source_hash,
        row_count,document_count,eligible_count,rejected_count,
        started_at,completed_at
      ) values (
        '00000000-0000-4000-8000-000000000901','jnac','mcp','succeeded',
        current_date-30,current_date,'${"d".repeat(64)}',
        2,2,2,0,now()-interval '1 second',now()
      );
      insert into pricing_private.flowaccount_price_sync_state(
        company_key,enabled,last_success_at,last_success_run_id,
        stale_after_minutes,max_document_age_days,last_source_hash
      ) values (
        'jnac',true,now(),'00000000-0000-4000-8000-000000000901',
        1440,180,'${"f".repeat(64)}'
      );
      insert into pricing_private.flowaccount_quote_price_cache(
        company_key,sync_run_id,document_record_id,line_key,document_serial,
        document_status,published_on,source_updated_at,source_contact_id,
        customer_id,product_id,source_sku,source_unit,source_quantity,
        net_unit_price,currency,eligible,source_hash
      ) values (
        'jnac','00000000-0000-4000-8000-000000000901',9001,
        'quotation:9001:1','QT-FLOW-9001',4,current_date,now(),7001,
        '${IDS.customerA}','${IDS.product}','SKU-001','ชิ้น',33,
        99,'THB',true,'${"e".repeat(64)}'
      ), (
        'jnac','00000000-0000-4000-8000-000000000901',9002,
        'cash_invoice:9002:1','CA-FLOW-9002',5,current_date,now(),7001,
        '${IDS.customerA}','${IDS.product}','SKU-001','ชิ้น',44,
        98,'THB',true,'${"a".repeat(64)}'
      );
    `);

    const result = await serviceQuery(
      db,
      "select public.get_bot_customer_context($1) as context",
      [IDS.conversation],
    );
    const context = json(result.rows[0].context);
    assert.deepEqual(Object.keys(context).sort(), [
      "company_name", "contact_name", "customer_id", "history",
    ]);
    assert.equal(context.customer_id, IDS.customerA);
    assert.equal(context.company_name, "J NAC Factory");
    assert.equal(context.contact_name, "คุณสมชาย");
    assert.equal(context.history.length, 60);
    for (const line of context.history) {
      assert.deepEqual(Object.keys(line).sort(), [
        "document_date", "document_type", "product_name", "quantity",
        "sku", "status", "unit",
      ]);
      assert.equal(["order", "quote"].includes(line.document_type), true);
      assert.notEqual(line.product_name, "รายการเก่า");
    }
    const flowHistory = context.history.find(
      (line) => line.document_type === "quote" && Number(line.quantity) === 33,
    );
    assert.ok(flowHistory);
    assert.equal(flowHistory.sku, "SKU-001");
    assert.equal(flowHistory.product_name, "ใบเจียรอุตสาหกรรม");
    assert.equal(flowHistory.unit, "ชิ้น");
    assert.equal(String(flowHistory.status), "4");
    const cashHistory = context.history.find(
      (line) => line.document_type === "order" && Number(line.quantity) === 44,
    );
    assert.ok(cashHistory);
    assert.equal(cashHistory.sku, "SKU-001");
    const serialized = JSON.stringify(context).toLowerCase();
    assert.equal(
      context.history.some((line) => line.product_name === "รายการใบเสนอราคาที่ส่งแล้ว"),
      true,
      "a sent quote remains useful recent customer context",
    );
    for (const includedProduct of [
      "รายการคำสั่งซื้อคืนแล้ว",
      "รายการใบเสนอราคาปฏิเสธ",
      "รายการใบเสนอราคาหมดอายุ",
    ]) {
      assert.equal(
        context.history.some((line) => line.product_name === includedProduct),
        true,
        includedProduct,
      );
    }
    for (const excludedProduct of [
      "รายการคำสั่งซื้อยกเลิก",
      "รายการใบเสนอราคาแบบร่าง",
      "รายการใบเสนอราคายกเลิก",
    ]) {
      assert.equal(
        context.history.some((line) => line.product_name === excludedProduct),
        false,
        excludedProduct,
      );
    }
    for (const banned of [
      "tax_id", "address", "phone", "email", "unit_price", "cost", "notes",
    ]) {
      assert.equal(serialized.includes(banned), false, banned);
    }

    const pending = await serviceQuery(
      db,
      "select public.get_bot_customer_context($1) as context",
      [IDS.pendingConversation],
    );
    assert.deepEqual(json(pending.rows[0].context), {});

    const invalid = await serviceQuery(
      db,
      "select public.get_bot_customer_context($1) as context",
      [IDS.invalidConversation],
    );
    assert.deepEqual(json(invalid.rows[0].context), {});

    // A manual/preexisting CRM link remains valid while the LINE identity is
    // unchanged, but must be removed when the external identity changes.
    await db.query(
      `update public.chat_conversations
       set metadata = jsonb_build_object(
         'quote_customer_linked_at', statement_timestamp(),
         'price_history_verified_at', statement_timestamp()
       )
       where id=$1`,
      [IDS.conversation],
    );
    const sameIdentity = await serviceQuery(
      db,
      "select public.get_bot_customer_context($1) as context",
      [IDS.conversation],
    );
    assert.equal(json(sameIdentity.rows[0].context).customer_id, IDS.customerA);
    await callMemory(db, {
      summary: "บริบทที่ผูกกับผู้ใช้เดิม",
      state: { product_family: "grinding" },
      turnOffset: "1 second",
    });
    await db.query(
      "update public.chat_conversations set external_id='U-REASSIGNED' where id=$1",
      [IDS.conversation],
    );
    const reassigned = await db.query(
      `select customer_id,
              metadata ? 'quote_customer_link_method' as has_link_method,
              metadata ? 'quote_customer_linked_at' as has_link_time,
              metadata ? 'price_history_verified_at' as has_price_verification,
              (select count(*)::integer
               from public.bot_conversation_memory as memory
               where memory.conversation_id=conversation.id) as memory_rows
       from public.chat_conversations as conversation
       where id=$1`,
      [IDS.conversation],
    );
    assert.deepEqual(reassigned.rows[0], {
      customer_id: null,
      has_link_method: false,
      has_link_time: false,
      has_price_verification: false,
      memory_rows: 0,
    });
    const reassignedContext = await serviceQuery(
      db,
      "select public.get_bot_customer_context($1) as context",
      [IDS.conversation],
    );
    assert.deepEqual(json(reassignedContext.rows[0].context), {});

    await db.query(
      "insert into public.customers(id,name,tax_id) values($1,'Duplicate','010-5558-123456')",
      [IDS.duplicateCustomer],
    );
    const ambiguous = await serviceQuery(
      db,
      "select public.get_bot_customer_context($1) as context",
      [IDS.conversation],
    );
    assert.deepEqual(json(ambiguous.rows[0].context), {});

    await assert.rejects(
      () => authQuery(
        db,
        IDS.owner,
        "select public.get_bot_customer_context($1)",
        [IDS.conversation],
      ),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("FlowAccount targets include only verified LINE customers who asked within 180 days", async () => {
  const { db } = await bootstrap();
  try {
    let result = await serviceQuery(
      db,
      "select public.get_flowaccount_active_customer_targets(180,100) as targets",
    );
    let payload = json(result.rows[0].targets);
    assert.equal(payload.window_days, 180);
    assert.equal(payload.target_count, 1);
    assert.deepEqual(payload.targets, [{
      customer_id: IDS.customerA,
      tax_id: "0105558123456",
    }]);

    await db.exec(`
      with customer_row as (
        insert into public.customers(name,tax_id)
        values ('Old customer','0200000000001')
        returning id
      )
      insert into public.chat_conversations(
        channel,external_id,customer_id,display_name,metadata,
        last_message_at,last_customer_message_at
      )
      select 'line','U-OLD',id,'Old customer','{}'::jsonb,
             now(),now()-interval '181 days'
      from customer_row;

      with duplicate_customers as (
        insert into public.customers(name,tax_id)
        values ('Duplicate A','0300000000001'),('Duplicate B','030-0000-000001')
        returning id,name
      )
      insert into public.chat_conversations(
        channel,external_id,customer_id,display_name,metadata,
        last_message_at,last_customer_message_at
      )
      select 'line','U-DUP-' || name,id,name,'{}'::jsonb,now(),now()
      from duplicate_customers;
    `);
    result = await serviceQuery(
      db,
      "select public.get_flowaccount_active_customer_targets(180,100) as targets",
    );
    payload = json(result.rows[0].targets);
    assert.equal(payload.target_count, 1);

    await db.exec(`
      with added as (
        insert into public.customers(name,tax_id)
        select 'Active ' || n, lpad((4000000000000::bigint+n)::text,13,'0')
        from generate_series(1,99) n
        returning id,name
      )
      insert into public.chat_conversations(
        channel,external_id,customer_id,display_name,metadata,
        last_message_at,last_customer_message_at
      )
      select 'line','U-' || id::text,id,name,'{}'::jsonb,now(),now()
      from added;
    `);
    result = await serviceQuery(
      db,
      "select public.get_flowaccount_active_customer_targets(180,100) as targets",
    );
    payload = json(result.rows[0].targets);
    assert.equal(payload.target_count, 100);
    assert.equal(payload.targets.length, 100);
    assert.equal(new Set(payload.targets.map((target) => target.tax_id)).size, 100);

    await db.exec(`
      with customer_row as (
        insert into public.customers(name,tax_id)
        values ('Customer 101','0500000000001')
        returning id
      )
      insert into public.chat_conversations(
        channel,external_id,customer_id,display_name,metadata,
        last_message_at,last_customer_message_at
      )
      select 'line','U-101',id,'Customer 101','{}'::jsonb,
             now()+interval '1 minute',now()+interval '1 minute'
      from customer_row;
    `);
    result = await serviceQuery(
      db,
      "select public.get_flowaccount_active_customer_targets(180,100) as targets",
    );
    payload = json(result.rows[0].targets);
    assert.equal(payload.target_count, 100);
    assert.equal(payload.targets.length, 100);
    assert.ok(payload.targets.some((target) => target.tax_id === "0500000000001"));
    await assert.rejects(
      () => authQuery(
        db,
        IDS.owner,
        "select public.get_flowaccount_active_customer_targets(180,100)",
      ),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("OAuth, Vault, masked status, and manual disconnect keep tokens private", async () => {
  const { db } = await bootstrap();
  try {
    const secretValues = {
      FLOWACCOUNT_MCP_CLIENT_ID: "client-id-value",
      FLOWACCOUNT_MCP_CLIENT_SECRET: "client-secret-value",
      FLOWACCOUNT_MCP_ACCESS_TOKEN: "access-token-value",
      FLOWACCOUNT_MCP_REFRESH_TOKEN: "refresh-token-value",
    };
    for (const [name, value] of Object.entries(secretValues)) {
      const result = await serviceQuery(
        db,
        "select public.set_flowaccount_mcp_secret($1,$2) as stored",
        [name, value],
      );
      assert.equal(result.rows[0].stored, true);
    }

    const syncKey = await serviceQuery(
      db,
      "select public.get_flowaccount_mcp_sync_key() as value",
    );
    assert.match(syncKey.rows[0].value, /^[0-9a-f]{64}$/);
    await assert.rejects(
      () => serviceQuery(
        db,
        "select public.get_flowaccount_mcp_secret('FLOWACCOUNT_MCP_SYNC_KEY')",
      ),
      /invalid_flowaccount_secret_name/,
    );
    await assert.rejects(
      () => serviceQuery(
        db,
        "select public.set_flowaccount_mcp_secret('FLOWACCOUNT_MCP_OTHER','x')",
      ),
      /invalid_flowaccount_secret/,
    );

    const stateHash = "a".repeat(64);
    const verifier = "v".repeat(43);
    const created = await serviceQuery(
      db,
      `select public.create_flowaccount_mcp_oauth_state(
        $1,$2,'jnac','https://example.com/callback',now()+interval '10 minutes'
      ) as state_id`,
      [stateHash, verifier],
    );
    assert.match(created.rows[0].state_id, /^[0-9a-f-]{36}$/);

    const consumed = await serviceQuery(
      db,
      "select public.consume_flowaccount_mcp_oauth_state($1,now()) as state",
      [stateHash],
    );
    assert.deepEqual(json(consumed.rows[0].state), {
      state_id: created.rows[0].state_id,
      company_key: "jnac",
      code_verifier: verifier,
      redirect_uri: "https://example.com/callback",
    });
    const replay = await serviceQuery(
      db,
      "select public.consume_flowaccount_mcp_oauth_state($1,now()) as state",
      [stateHash],
    );
    assert.deepEqual(json(replay.rows[0].state), {});
    await assert.rejects(
      () => serviceQuery(
        db,
        `select public.create_flowaccount_mcp_oauth_state(
          $1,$2,'jnac','https://example.com/callback',now()+interval '16 minutes'
        )`,
        ["b".repeat(64), verifier],
      ),
      /invalid_flowaccount_oauth_state/,
    );
    await assert.rejects(
      () => authQuery(
        db,
        IDS.owner,
        `select public.create_flowaccount_mcp_oauth_state(
          $1,$2,'jnac','https://example.com/callback',now()+interval '10 minutes'
        )`,
        ["b".repeat(64), verifier],
      ),
      /permission denied/,
    );

    await serviceQuery(
      db,
      `select public.upsert_flowaccount_mcp_connection(
        'jnac','connected','FLOW-COMPANY-123456789','J NAC Thailand',
        array['read:documents']::text[],now()-interval '1 hour',null
      )`,
    );
    const scheduled = await serviceQuery(
      db,
      "select public.run_flowaccount_price_sync_internal() as request_id",
    );
    assert.equal(Number(scheduled.rows[0].request_id), 1);
    const syncContextResult = await serviceQuery(
      db,
      "select public.get_flowaccount_mcp_sync_context('jnac') as context",
    );
    const syncContext = json(syncContextResult.rows[0].context);
    assert.deepEqual(Object.keys(syncContext).sort(), [
      "connected", "last_success_at", "provider_company_id",
      "provider_company_name", "refresh_token_present",
    ]);
    assert.equal(syncContext.connected, true);
    assert.equal(syncContext.provider_company_id, "FLOW-COMPANY-123456789");
    assert.equal(syncContext.provider_company_name, "J NAC Thailand");
    assert.equal(syncContext.refresh_token_present, true);

    const statusResult = await authQuery(
      db,
      IDS.owner,
      "select public.get_flowaccount_mcp_status('jnac') as status",
    );
    const status = json(statusResult.rows[0].status);
    assert.equal(status.connected, true);
    assert.equal(status.provider_company_name, "J NAC Thailand");
    assert.notEqual(status.provider_company_id_masked, "FLOW-COMPANY-123456789");
    assert.equal(status.provider_company_id_masked.endsWith("6789"), true);
    assert.deepEqual(status.credentials, {
      client_id_configured: true,
      client_secret_configured: true,
      access_token_present: true,
      refresh_token_present: true,
    });
    const serialized = JSON.stringify(status);
    for (const value of Object.values(secretValues)) {
      assert.equal(serialized.includes(value), false);
    }

    await assert.rejects(
      () => authQuery(
        db,
        IDS.viewer,
        "select public.get_flowaccount_mcp_status('jnac')",
      ),
      /forbidden/,
    );
    await assert.rejects(
      () => serviceQuery(
        db,
        "select public.get_flowaccount_mcp_status('jnac')",
      ),
      /permission denied/,
    );
    await assert.rejects(
      () => authQuery(
        db,
        IDS.owner,
        "select public.get_flowaccount_mcp_secret('FLOWACCOUNT_MCP_ACCESS_TOKEN')",
      ),
      /permission denied/,
    );
    await assert.rejects(
      () => authQuery(
        db,
        IDS.owner,
        "select public.get_flowaccount_mcp_sync_context('jnac')",
      ),
      /permission denied/,
    );
    for (const table of [
      "bot_conversation_identity_epochs",
      "flowaccount_mcp_oauth_states",
      "flowaccount_mcp_connections",
      "flowaccount_price_sync_runs",
      "flowaccount_quote_price_cache",
      "flowaccount_price_sync_state",
    ]) {
      await assert.rejects(
        () => serviceQuery(
          db,
          `select count(*) from pricing_private.${table}`,
        ),
        /permission denied/,
      );
    }
    const tokenColumns = await db.query(`
      select count(*)::int as count
      from information_schema.columns
      where table_schema='pricing_private'
        and table_name in ('flowaccount_mcp_connections','flowaccount_mcp_oauth_states')
        and column_name in ('access_token','refresh_token')
    `);
    assert.equal(tokenColumns.rows[0].count, 0);

    await serviceQuery(
      db,
      `select public.upsert_flowaccount_mcp_connection(
        'jnac','error','FLOW-COMPANY-123456789','J NAC Thailand',
        array['read:documents']::text[],now()-interval '1 hour','provider_timeout'
      )`,
    );
    const errorContext = await serviceQuery(
      db,
      "select public.get_flowaccount_mcp_sync_context('jnac') as context",
    );
    assert.equal(json(errorContext.rows[0].context).connected, false);
    assert.equal(json(errorContext.rows[0].context).refresh_token_present, true);

    const disconnected = await authQuery(
      db,
      IDS.owner,
      "select public.disconnect_flowaccount_mcp('jnac') as disconnected",
    );
    assert.equal(disconnected.rows[0].disconnected, true);
    const after = await authQuery(
      db,
      IDS.owner,
      "select public.get_flowaccount_mcp_status('jnac') as status",
    );
    const afterStatus = json(after.rows[0].status);
    assert.equal(afterStatus.connected, false);
    assert.equal(afterStatus.credentials.access_token_present, false);
    assert.equal(afterStatus.credentials.refresh_token_present, false);
    assert.equal(afterStatus.credentials.client_id_configured, true);
    assert.equal(afterStatus.credentials.client_secret_configured, true);

    const noRequest = await serviceQuery(
      db,
      "select public.run_flowaccount_price_sync_internal() as request_id",
    );
    assert.equal(noRequest.rows[0].request_id, null);
    const afterPreflight = await serviceQuery(
      db,
      "select public.get_flowaccount_mcp_sync_context('jnac') as context",
    );
    assert.equal(json(afterPreflight.rows[0].context).connected, false);
    const audit = await db.query(
      "select action,detail from public.audit_logs where action='flowaccount_mcp.disconnect'",
    );
    assert.equal(audit.rows.length, 1);
    assert.equal(json(audit.rows[0].detail).sync_disabled, true);
    assert.equal(json(audit.rows[0].detail).tokens_deleted, true);
    assert.equal(Number(json(audit.rows[0].detail).deleted_token_count), 2);
  } finally {
    await db.close();
  }
});

function flowRow(today, overrides = {}) {
  return {
    document_record_id: 1001,
    line_key: "1",
    document_serial: "QT-1001",
    document_status: 1,
    published_on: today,
    source_updated_at: new Date().toISOString(),
    source_contact_id: 7001,
    source_contact_tax_id: "0105558123456",
    source_sku: "SKU-001",
    source_unit: "ชิ้น",
    source_quantity: 10,
    net_unit_price: 125.5,
    currency: "THB",
    eligible: true,
    eligibility_reason: null,
    source_hash: "c".repeat(64),
    ...overrides,
  };
}

async function startRun(db) {
  const result = await serviceQuery(
    db,
    `select public.start_flowaccount_price_sync_run(
      'jnac','mcp',current_date-30,current_date
    ) as run_id`,
  );
  return result.rows[0].run_id;
}

async function publishRun(db, runId, rows, omittedCount = 0) {
  return serviceQuery(
    db,
    `select public.publish_flowaccount_price_sync_run(
      $1,'jnac',$2::jsonb,$3,$4,statement_timestamp()
    ) as result`,
    [runId, JSON.stringify(rows), "d".repeat(64), omittedCount],
  );
}

test("an orphaned FlowAccount run recovers after the bounded worker timeout", async () => {
  const { db } = await bootstrap();
  try {
    await serviceQuery(
      db,
      `select public.upsert_flowaccount_mcp_connection(
        'jnac','connected','FLOW-1','J NAC Thailand',
        array['read:documents']::text[],now()+interval '1 hour',null
      )`,
    );
    const orphanRunId = await startRun(db);
    await db.query(
      `update pricing_private.flowaccount_price_sync_runs
       set started_at=statement_timestamp()-interval '31 minutes'
       where id=$1`,
      [orphanRunId],
    );

    const replacementRunId = await startRun(db);
    assert.notEqual(replacementRunId, orphanRunId);
    const runs = await db.query(
      `select id,status,error_code,completed_at
       from pricing_private.flowaccount_price_sync_runs
       where id in ($1,$2)
       order by started_at`,
      [orphanRunId, replacementRunId],
    );
    const orphan = runs.rows.find((row) => row.id === orphanRunId);
    const replacement = runs.rows.find((row) => row.id === replacementRunId);
    assert.equal(orphan.status, "failed");
    assert.equal(orphan.error_code, "sync_worker_timeout");
    assert.ok(orphan.completed_at);
    assert.equal(replacement.status, "running");
  } finally {
    await db.close();
  }
});

test("disconnect and tenant switch keep late publishers from re-enabling cached prices", async () => {
  const { db } = await bootstrap();
  try {
    const connect = (companyKey, providerId) => serviceQuery(
      db,
      `select public.upsert_flowaccount_mcp_connection(
        $1,'connected',$2,$3,array['read:documents']::text[],
        now()+interval '1 hour',null
      )`,
      [companyKey, providerId, `${companyKey} company`],
    );
    await connect("jnac", "FLOW-1");
    const today = (await db.query("select current_date::text as today")).rows[0].today;
    const disconnectRun = await startRun(db);
    await authQuery(
      db,
      IDS.owner,
      "select public.disconnect_flowaccount_mcp('jnac')",
    );
    await assert.rejects(
      () => publishRun(db, disconnectRun, [flowRow(today)]),
      /flowaccount_not_connected|flowaccount_sync_run_not_publishable/,
    );

    await connect("jnac", "FLOW-1");
    const switchedRun = await startRun(db);
    await connect("other", "FLOW-2");
    await assert.rejects(
      () => publishRun(db, switchedRun, [flowRow(today)]),
      /flowaccount_not_connected/,
    );
    const state = await db.query(
      `select coalesce(enabled,false) as enabled
       from pricing_private.flowaccount_price_sync_state
       where company_key='jnac'`,
    );
    assert.equal(state.rows[0]?.enabled ?? false, false);

    // Reconnecting the configured company key to a different provider tenant
    // must invalidate the already-published generation and any in-flight run.
    await connect("jnac", "FLOW-1");
    const publishedRun = await startRun(db);
    await publishRun(db, publishedRun, [flowRow(today)]);
    const inFlightRun = await startRun(db);
    await connect("jnac", "FLOW-2");
    const sameKeySwitch = await db.query(
      `select connection.provider_company_id,
              coalesce(state.enabled,false) as enabled,
              run.status as run_status,
              run.error_code,
              count(cache.id) filter (
                where state.enabled
                  and state.last_success_run_id = cache.sync_run_id
              )::integer as active_cache_rows
       from pricing_private.flowaccount_mcp_connections as connection
       left join pricing_private.flowaccount_price_sync_state as state
         on state.company_key = connection.company_key
       left join pricing_private.flowaccount_price_sync_runs as run
         on run.id = '${inFlightRun}'
       left join pricing_private.flowaccount_quote_price_cache as cache
         on cache.company_key = connection.company_key
       where connection.company_key = 'jnac'
       group by connection.provider_company_id,state.enabled,
                state.last_success_run_id,run.status,run.error_code`,
    );
    assert.deepEqual(sameKeySwitch.rows[0], {
      provider_company_id: "FLOW-2",
      enabled: false,
      run_status: "failed",
      error_code: "provider_company_changed",
      active_cache_rows: 0,
    });
  } finally {
    await db.close();
  }
});

test("sync publish is atomic, exact-mapped, bounded, and retains two generations", async () => {
  const { db } = await bootstrap();
  try {
    await serviceQuery(
      db,
      `select public.upsert_flowaccount_mcp_connection(
        'jnac','connected','FLOW-1','J NAC Thailand',
        array['read:documents']::text[],now()+interval '1 hour',null
      )`,
    );
    const dateResult = await db.query("select current_date::text as today");
    const today = dateResult.rows[0].today;
    await assert.rejects(
      () => authQuery(
        db,
        IDS.owner,
        `select public.start_flowaccount_price_sync_run(
          'jnac','mcp',current_date-30,current_date
        )`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      () => serviceQuery(
        db,
        `select public.start_flowaccount_price_sync_run(
          'jnac','flowaccount_mcp',current_date-30,current_date
        )`,
      ),
      /invalid_flowaccount_sync_window/,
    );
    const run1 = await startRun(db);
    await assert.rejects(
      () => startRun(db),
      /flowaccount_sync_in_progress/,
    );
    const runningCount = await db.query(
      `select count(*)::int as count
       from pricing_private.flowaccount_price_sync_runs
       where company_key='jnac' and status='running'`,
    );
    assert.equal(runningCount.rows[0].count, 1);

    const invalidRow = {
      ...flowRow(today),
      raw_document: { address: "must never enter cache" },
    };
    await assert.rejects(
      () => publishRun(db, run1, [invalidRow]),
      /invalid_flowaccount_publish_row/,
    );
    let audit = await db.query(
      "select status from pricing_private.flowaccount_price_sync_runs where id=$1",
      [run1],
    );
    assert.equal(audit.rows[0].status, "running");
    let cache = await db.query(
      "select count(*)::int as count from pricing_private.flowaccount_quote_price_cache where sync_run_id=$1",
      [run1],
    );
    assert.equal(cache.rows[0].count, 0);

    const rowsWithChangedCustomerMapping = [
      flowRow(today),
      flowRow(today, {
        line_key: "2",
        eligible: false,
        eligibility_reason: "unknown_document_status",
      }),
      flowRow(today, {
        line_key: "3",
        source_contact_tax_id: "0105558000000",
      }),
      flowRow(today, {
        line_key: "4",
        source_unit: "กล่อง",
      }),
    ];
    await assert.rejects(
      () => publishRun(db, run1, rowsWithChangedCustomerMapping),
      /flowaccount_sync_generation_incomplete/,
    );
    cache = await db.query(
      "select count(*)::int as count from pricing_private.flowaccount_quote_price_cache where sync_run_id=$1",
      [run1],
    );
    assert.equal(cache.rows[0].count, 0);
    await serviceQuery(
      db,
      `select public.fail_flowaccount_price_sync_run(
        $1,'customer_mapping_changed',statement_timestamp()
      )`,
      [run1],
    );

    const completeRun = await startRun(db);
    const rows = rowsWithChangedCustomerMapping.filter((row) => row.line_key !== "3");
    const published = await publishRun(db, completeRun, rows, 4);
    assert.deepEqual(json(published.rows[0].result), {
      published: true,
      run_id: completeRun,
      row_count: 3,
      document_count: 1,
      eligible_count: 1,
      rejected_count: 2,
      omitted_count: 4,
      deleted_count: 0,
    });
    cache = await db.query(
      `select eligible,eligibility_reason,customer_id,product_id
       from pricing_private.flowaccount_quote_price_cache
       where sync_run_id=$1 order by line_key`,
      [completeRun],
    );
    assert.equal(cache.rows.length, 3);
    assert.equal(cache.rows[0].eligible, true);
    assert.equal(cache.rows[0].customer_id, IDS.customerA);
    assert.equal(cache.rows[0].product_id, IDS.product);
    assert.equal(cache.rows[1].eligible, false);
    assert.equal(cache.rows[1].eligibility_reason, "unknown_document_status");
    assert.equal(cache.rows[2].eligible, false);
    assert.equal(cache.rows[2].eligibility_reason, "product_not_in_corebiz");
    assert.equal(cache.rows[2].product_id, null);
    const completeRunAudit = await db.query(
      `select omitted_count
       from pricing_private.flowaccount_price_sync_runs where id=$1`,
      [completeRun],
    );
    assert.equal(completeRunAudit.rows[0].omitted_count, 4);

    const transientColumn = await db.query(
      `select count(*)::int as count from information_schema.columns
       where table_schema='pricing_private'
         and table_name='flowaccount_quote_price_cache'
         and column_name='source_contact_tax_id'`,
    );
    assert.equal(transientColumn.rows[0].count, 0);
    await assert.rejects(
      () => serviceQuery(
        db,
        "insert into pricing_private.flowaccount_quote_price_cache default values",
      ),
      /permission denied/,
    );

    const run2 = await startRun(db);
    const sharedProviderRecord = await publishRun(db, run2, [
      flowRow(today, {
        document_record_id: 1002,
        line_key: "quotation:1",
        document_serial: "QT-1002",
      }),
      flowRow(today, {
        document_record_id: 1002,
        line_key: "tax_invoice:1",
        document_serial: "INV-1002",
      }),
    ]);
    assert.equal(json(sharedProviderRecord.rows[0].result).document_count, 2);
    const run3 = await startRun(db);
    await publishRun(db, run3, [flowRow(today, {
      document_record_id: 1003,
      document_serial: "QT-1003",
    })]);

    const retained = await db.query(
      `select array_agg(distinct sync_run_id::text order by sync_run_id::text) as runs
       from pricing_private.flowaccount_quote_price_cache
       where company_key='jnac'`,
    );
    assert.equal(retained.rows[0].runs.length, 2);
    assert.equal(retained.rows[0].runs.includes(completeRun), false);
    assert.equal(retained.rows[0].runs.includes(run2), true);
    assert.equal(retained.rows[0].runs.includes(run3), true);

    const agePrune = await serviceQuery(
      db,
      `select public.prune_flowaccount_price_cache(
        'jnac',statement_timestamp()+interval '181 days'
      ) as deleted`,
    );
    assert.equal(Number(agePrune.rows[0].deleted) >= 2, true);
    cache = await db.query(
      "select count(*)::int as count from pricing_private.flowaccount_quote_price_cache where company_key='jnac'",
    );
    assert.equal(cache.rows[0].count, 0);

    const limitRun = await startRun(db);
    const tooMany = Array.from({ length: 20001 }, () => ({}));
    await assert.rejects(
      () => publishRun(db, limitRun, tooMany),
      /invalid_flowaccount_publish_request/,
    );
    audit = await db.query(
      "select status from pricing_private.flowaccount_price_sync_runs where id=$1",
      [limitRun],
    );
    assert.equal(audit.rows[0].status, "running");
    const failed = await serviceQuery(
      db,
      `select public.fail_flowaccount_price_sync_run(
        $1,'payload_too_large',statement_timestamp()
      ) as failed`,
      [limitRun],
    );
    assert.equal(failed.rows[0].failed, true);
  } finally {
    await db.close();
  }
});
