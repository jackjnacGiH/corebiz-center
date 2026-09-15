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
  staff: "00000000-0000-4000-8000-000000000002",
  agent: "00000000-0000-4000-8000-000000000005",
  viewer: "00000000-0000-4000-8000-000000000006",
  customerUser: "00000000-0000-4000-8000-000000000003",
  verifiedUser: "00000000-0000-4000-8000-000000000004",
  vip: "00000000-0000-4000-8000-000000000101",
  general: "00000000-0000-4000-8000-000000000102",
  product: "00000000-0000-4000-8000-000000000201",
  minProduct: "00000000-0000-4000-8000-000000000202",
  zeroProduct: "00000000-0000-4000-8000-000000000203",
  manualConversation: "00000000-0000-4000-8000-000000000301",
  taxConversation: "00000000-0000-4000-8000-000000000302",
  missingConversation: "00000000-0000-4000-8000-000000000303",
};

async function bootstrap(db) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

    create table public.profiles (
      id uuid primary key,
      role text not null,
      is_active boolean not null default true,
      line_user_id text
    );
    create function public.is_staff() returns boolean
      language sql stable security definer set search_path = public as $$
      select exists(select 1 from public.profiles p where p.id=auth.uid()
        and p.is_active and p.role in ('owner','admin','staff'))
    $$;
    create function public.can_read() returns boolean
      language sql stable security definer set search_path = public as $$
      select exists(select 1 from public.profiles p where p.id=auth.uid()
        and p.is_active and p.role in ('owner','admin','staff','agent','viewer'))
    $$;
    create function public.can_delete() returns boolean
      language sql stable security definer set search_path = public as $$
      select exists(select 1 from public.profiles p where p.id=auth.uid()
        and p.is_active and p.role in ('owner','admin'))
    $$;

    create table public.customers (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      tier text not null default 'general',
      tax_id text,
      created_at timestamptz not null default now()
    );
    create table public.customer_contacts (
      id uuid primary key default gen_random_uuid(),
      customer_id uuid not null references public.customers(id),
      user_id uuid not null references public.profiles(id),
      verified boolean not null default false
    );
    create table public.products (
      id uuid primary key default gen_random_uuid(),
      sku text not null unique,
      name_th text not null,
      unit text not null default 'pcs',
      price numeric(12,2) not null default 0,
      discount_value numeric(12,2) not null default 0,
      discount_type text not null default 'fixed',
      min_order_qty integer not null default 1,
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.tier_benefits (
      tier text primary key,
      discount_percent numeric(5,2) not null default 0,
      updated_at timestamptz not null default now()
    );
    create sequence public.quote_code_seq;
    create table public.quotes (
      id uuid primary key default gen_random_uuid(),
      code text not null unique default ('QT-' || lpad(nextval('public.quote_code_seq')::text, 8, '0')),
      customer_id uuid references public.customers(id),
      status text not null default 'draft',
      subtotal numeric(14,2) not null default 0,
      discount numeric(14,2) not null default 0,
      vat numeric(14,2) not null default 0,
      total numeric(14,2) not null default 0,
      valid_until date,
      converted_to_order_id uuid,
      notes text,
      created_at timestamptz not null default now()
    );
    create table public.quote_items (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null references public.quotes(id) on delete cascade,
      product_id uuid references public.products(id),
      sku text not null,
      product_name text not null,
      quantity integer not null,
      unit_price numeric(14,2) not null,
      unit text,
      discount numeric(14,2) not null default 0,
      total numeric(14,2) not null
    );
    create table public.chat_conversations (
      id uuid primary key default gen_random_uuid(),
      channel text not null,
      external_id text,
      customer_id uuid references public.customers(id),
      metadata jsonb not null default '{}'::jsonb
    );
    create table public.agent_tasks (
      id uuid primary key default gen_random_uuid(),
      category text not null,
      kind text not null,
      title text not null,
      summary text,
      recommendation text,
      payload jsonb not null default '{}'::jsonb,
      action_kind text not null default 'none',
      requires_approval boolean not null default true,
      priority smallint not null default 2,
      related_type text,
      related_id text,
      dedupe_key text unique,
      source text,
      status text not null default 'proposed',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
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
    create function public.agent_propose(
      p_category text, p_kind text, p_title text,
      p_summary text default null, p_recommendation text default null,
      p_payload jsonb default '{}'::jsonb, p_action_kind text default 'none',
      p_requires_approval boolean default true, p_priority smallint default 2,
      p_related_type text default null, p_related_id text default null,
      p_dedupe_key text default null, p_source text default 'agent'
    ) returns uuid language plpgsql security definer set search_path=public as $$
    declare v_id uuid;
    begin
      insert into public.agent_tasks(
        category,kind,title,summary,recommendation,payload,action_kind,
        requires_approval,priority,related_type,related_id,dedupe_key,source
      ) values (
        p_category,p_kind,p_title,p_summary,p_recommendation,p_payload,p_action_kind,
        p_requires_approval,p_priority,p_related_type,p_related_id,p_dedupe_key,p_source
      ) returning id into v_id;
      return v_id;
    end $$;
    create function public.apply_quote_shipping(
      p_quote_id uuid, p_fee numeric default 100
    ) returns void language plpgsql security definer set search_path=public as $$
    declare v_subtotal numeric; v_disc numeric; v_net numeric; v_vat numeric;
    begin
      if p_quote_id is null then return; end if;
      if exists (
        select 1 from public.quote_items where quote_id=p_quote_id and sku='SHIPPING'
      ) then return; end if;
      if not exists (
        select 1 from public.quote_items where quote_id=p_quote_id
      ) then return; end if;
      insert into public.quote_items(
        quote_id,product_id,sku,product_name,quantity,unit_price,discount,total,unit
      ) values (
        p_quote_id,null,'SHIPPING','ค่าจัดส่งสินค้า',1,p_fee,0,p_fee,null
      );
      select coalesce(sum(total),0) into v_subtotal
      from public.quote_items where quote_id=p_quote_id;
      select coalesce(discount,0) into v_disc
      from public.quotes where id=p_quote_id;
      v_net := greatest(0,v_subtotal-v_disc);
      v_vat := round(v_net*0.07,2);
      update public.quotes
      set subtotal=v_subtotal,vat=v_vat,total=v_net+v_vat
      where id=p_quote_id;
    end $$;
    create function public.tg_agent_task_shipping()
    returns trigger language plpgsql security definer set search_path=public as $$
    begin
      if new.kind='sales.quote_request' then
        perform public.apply_quote_shipping(nullif(new.payload->>'quote_id','')::uuid);
      end if;
      return new;
    exception when others then
      return new;
    end $$;
    create trigger trg_quote_auto_shipping
      after insert on public.agent_tasks
      for each row execute function public.tg_agent_task_shipping();
  `);

  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260913090000_customer_pricing_phase1.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);

  await db.exec(`
    insert into public.profiles(id,role,line_user_id) values
      ('${IDS.owner}','owner',null),
      ('${IDS.staff}','staff',null),
      ('${IDS.agent}','agent',null),
      ('${IDS.viewer}','viewer',null),
      ('${IDS.customerUser}','customer',null),
      ('${IDS.verifiedUser}','customer','LINE-VERIFIED');
    insert into public.customers(id,name,tier,tax_id) values
      ('${IDS.vip}','VIP Factory','vip','0105555000001'),
      ('${IDS.general}','General Factory','general','0105555000002');
    insert into public.tier_benefits(tier,discount_percent) values
      ('general',0),('silver',2),('gold',3),('vip',5);
    insert into public.products(
      id,sku,name_th,unit,price,discount_value,discount_type,min_order_qty,status
    ) values
      ('${IDS.product}','SKU-PRICE','สินค้าทดสอบ','pcs',100,10,'percent',1,'active'),
      ('${IDS.minProduct}','SKU-MIN','สินค้าขั้นต่ำ','pcs',100,10,'fixed',2,'active'),
      ('${IDS.zeroProduct}','SKU-ZERO','สินค้ารอเจ้าหน้าที่ตีราคา','pcs',0,0,'fixed',1,'active');
    insert into public.chat_conversations(id,channel,external_id,customer_id,metadata) values
      ('${IDS.manualConversation}','line','LINE-MANUAL','${IDS.vip}','{}'),
      ('${IDS.taxConversation}','line','LINE-UNVERIFIED','${IDS.vip}',
        '{"quote_customer_link_method":"tax_id"}'),
      ('${IDS.missingConversation}','line','LINE-MISSING',null,'{}');
  `);
}

async function asJwt(db, role, userId, sql) {
  await db.exec(`reset role;
    select set_config('request.jwt.claim.sub','${userId ?? ""}',false);
    select set_config('request.jwt.claim.role','${role}',false);
    set role ${role};`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role;");
  }
}

function one(result) {
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

test("customer pricing migration resolves precedence, privacy, provenance and bot idempotency", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);

    const vipInput = `'[{"sku":"SKU-PRICE","qty":1}]'::jsonb`;

    // Cache data alone is inert. A successful, explicitly enabled sync state is
    // required before FlowAccount history can affect a price.
    await db.exec(`
      insert into pricing_private.flowaccount_quote_price_cache(
        company_key,sync_run_id,document_record_id,line_key,document_serial,document_status,
        published_on,source_updated_at,source_contact_id,customer_id,product_id,
        source_sku,source_unit,source_quantity,net_unit_price,currency,eligible,
        source_hash
      ) values (
        'jnac','30000000-0000-4000-8000-000000000001',1001,'1','QT-TEST-1',3,current_date,clock_timestamp(),501,
        '${IDS.vip}','${IDS.product}','SKU-PRICE','pcs',1,82,'THB',true,'hash-1'
      ), (
        'jnac','30000000-0000-4000-8000-000000000001',1002,'1','QT-TEST-2',3,current_date,clock_timestamp(),501,
        '${IDS.vip}','${IDS.product}','WRONG-SKU','pcs',1,70,'THB',true,'hash-2'
      );
    `);
    await assert.rejects(
      () => db.exec(`
        insert into pricing_private.flowaccount_quote_price_cache(
          company_key,sync_run_id,document_record_id,line_key,document_status,published_on,
          source_updated_at,customer_id,product_id,source_sku,source_unit,
          source_quantity,net_unit_price,currency,eligible,source_hash
        ) values (
          'jnac','30000000-0000-4000-8000-000000000001',1003,'1',3,current_date,clock_timestamp(),'${IDS.vip}',
          '${IDS.product}','SKU-PRICE','pcs',1,0,'THB',true,'hash-3'
        )
      `),
      /check constraint|violates/i,
      "zero-value external history must be ineligible at the storage boundary",
    );

    let price = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select final_price::text,price_source,tier,tier_percent::text
       from public.resolve_customer_quote_prices('${IDS.vip}',${vipInput})`,
    ));
    assert.deepEqual(price, {
      final_price: "85.50",
      price_source: "tier",
      tier: "vip",
      tier_percent: "5.00",
    });
    const uiStylePrice = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select product_id,final_price::text,price_source
       from public.resolve_customer_quote_prices(
         '${IDS.vip}',
         '[{"product_id":"${IDS.product}","unit":"pcs","quantity":1}]'::jsonb
       )`,
    ));
    assert.deepEqual(uiStylePrice, {
      product_id: IDS.product,
      final_price: "85.50",
      price_source: "tier",
    });

    await db.exec(`
      insert into pricing_private.flowaccount_price_sync_state(
        company_key,enabled,last_success_at,last_success_run_id
      ) values (
        'jnac',true,clock_timestamp(),'30000000-0000-4000-8000-000000000001'
      );
    `);
    price = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select final_price::text,price_source
       from public.resolve_customer_quote_prices('${IDS.vip}',${vipInput})`,
    ));
    assert.deepEqual(
      price,
      { final_price: "82.00", price_source: "flowaccount_quote" },
      "a newer/lower cache row with a mismatched source SKU must be ignored",
    );

    // Provider document IDs are not a proven chronology across document kinds.
    // Conflicting prices on the newest date must fail closed; identical prices
    // may safely use any deterministic representative row.
    await db.exec(`
      insert into pricing_private.flowaccount_quote_price_cache(
        company_key,sync_run_id,document_record_id,line_key,document_serial,document_status,
        published_on,source_updated_at,source_contact_id,customer_id,product_id,
        source_sku,source_unit,source_quantity,net_unit_price,currency,eligible,
        source_hash
      ) values (
        'jnac','30000000-0000-4000-8000-000000000001',7,'tax_invoice:1','INV-SAME-DAY',5,
        current_date,clock_timestamp(),501,'${IDS.vip}','${IDS.product}',
        'SKU-PRICE','pcs',1,81,'THB',true,'hash-same-day-conflict'
      )
    `);
    price = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select final_price::text,price_source
       from public.resolve_customer_quote_prices('${IDS.vip}',${vipInput})`,
    ));
    assert.deepEqual(
      price,
      { final_price: "85.50", price_source: "tier" },
      "different prices across document kinds on the latest date must fail closed",
    );
    await db.exec(`
      update pricing_private.flowaccount_quote_price_cache
      set net_unit_price=82,source_hash='hash-same-day-equal'
      where sync_run_id='30000000-0000-4000-8000-000000000001'
        and document_record_id=7 and line_key='tax_invoice:1'
    `);
    price = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select final_price::text,price_source
       from public.resolve_customer_quote_prices('${IDS.vip}',${vipInput})`,
    ));
    assert.deepEqual(
      price,
      { final_price: "82.00", price_source: "flowaccount_quote" },
      "matching prices across document kinds on the latest date remain usable",
    );
    await db.exec(`
      delete from pricing_private.flowaccount_quote_price_cache
      where sync_run_id='30000000-0000-4000-8000-000000000001'
        and document_record_id=7 and line_key='tax_invoice:1'
    `);
    const flowRunOneQuote = one(await asJwt(
      db,
      "service_role",
      null,
      `select * from public.create_or_reuse_bot_quote(
        '${IDS.manualConversation}','line',${vipInput},null,null,null
      )`,
    ));
    assert.equal(flowRunOneQuote.quote_created, true);
    assert.equal(flowRunOneQuote.quote_reused, false);

    // A retry in a new immutable generation can stage the same source line
    // without mutating the currently published generation. A retry within the
    // same generation uses its generation-scoped conflict key.
    await db.exec(`
      insert into pricing_private.flowaccount_quote_price_cache(
        company_key,sync_run_id,document_record_id,line_key,document_serial,document_status,
        published_on,source_updated_at,source_contact_id,customer_id,product_id,
        source_sku,source_unit,source_quantity,net_unit_price,currency,eligible,source_hash
      ) values (
        'jnac','30000000-0000-4000-8000-000000000002',1001,'1','QT-TEST-1',3,
        current_date,clock_timestamp(),501,'${IDS.vip}','${IDS.product}',
        'SKU-PRICE','pcs',1,82,'THB',true,'hash-1'
      );
      insert into pricing_private.flowaccount_quote_price_cache(
        company_key,sync_run_id,document_record_id,line_key,document_serial,document_status,
        published_on,source_updated_at,source_contact_id,customer_id,product_id,
        source_sku,source_unit,source_quantity,net_unit_price,currency,eligible,source_hash
      ) values (
        'jnac','30000000-0000-4000-8000-000000000002',1001,'1','QT-TEST-1',3,
        current_date,clock_timestamp(),501,'${IDS.vip}','${IDS.product}',
        'SKU-PRICE','pcs',1,82,'THB',true,'hash-1'
      )
      on conflict (company_key,sync_run_id,document_record_id,line_key)
      do update set
        net_unit_price=excluded.net_unit_price,
        source_hash=excluded.source_hash,
        last_seen_at=clock_timestamp();

      update pricing_private.flowaccount_price_sync_state
      set last_success_at=clock_timestamp(),
          last_success_run_id='30000000-0000-4000-8000-000000000002'
      where company_key='jnac'
    `);
    price = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select final_price::text,price_source
       from public.resolve_customer_quote_prices('${IDS.vip}',${vipInput})`,
    ));
    assert.deepEqual(
      price,
      { final_price: "82.00", price_source: "flowaccount_quote" },
      "only the latest fully published generation may provide a history price",
    );
    const flowRunTwoQuote = one(await asJwt(
      db,
      "service_role",
      null,
      `select * from public.create_or_reuse_bot_quote(
        '${IDS.manualConversation}','line',${vipInput},null,null,null
      )`,
    ));
    assert.equal(flowRunTwoQuote.quote_created, false);
    assert.equal(flowRunTwoQuote.quote_reused, true);
    assert.equal(
      flowRunTwoQuote.quote_id,
      flowRunOneQuote.quote_id,
      "an identical price in a new sync generation must reuse the existing draft",
    );
    await db.exec(`
      delete from public.audit_logs
      where action='quote.pricing_resolved'
        and target_id='${flowRunOneQuote.quote_id}';
      delete from public.agent_tasks
      where payload->>'quote_id'='${flowRunOneQuote.quote_id}';
      delete from public.quotes where id='${flowRunOneQuote.quote_id}';
    `);

    // Publishing a generation where the line disappeared makes the older rows
    // inert immediately, even while they remain stored for audit.
    await db.exec(`
      update pricing_private.flowaccount_price_sync_state
      set last_success_at=clock_timestamp(),
          last_success_run_id='30000000-0000-4000-8000-000000000003'
      where company_key='jnac'
    `);
    price = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select final_price::text,price_source
       from public.resolve_customer_quote_prices('${IDS.vip}',${vipInput})`,
    ));
    assert.deepEqual(
      price,
      { final_price: "85.50", price_source: "tier" },
      "rows absent from the latest successful sync generation must fail closed",
    );
    await db.exec(`
      update pricing_private.flowaccount_price_sync_state
      set last_success_at=clock_timestamp(),
          last_success_run_id='30000000-0000-4000-8000-000000000001'
      where company_key='jnac'
    `);

    await db.exec(`
      update pricing_private.flowaccount_quote_price_cache
      set eligible=false where document_record_id=1001
    `);
    price = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select final_price::text,price_source
       from public.resolve_customer_quote_prices('${IDS.vip}',${vipInput})`,
    ));
    assert.deepEqual(
      price,
      { final_price: "85.50", price_source: "tier" },
      "a mismatched source SKU must fail closed when it is the only eligible cache row",
    );
    await db.exec(`
      update pricing_private.flowaccount_quote_price_cache
      set eligible=true where document_record_id=1001
    `);

    // Manual CoreBiz net price wins even when it is higher than history.
    await asJwt(
      db,
      "authenticated",
      IDS.owner,
      `insert into public.customer_product_net_prices(
        customer_id,product_id,unit,net_price,note,created_by,updated_by,created_at
      ) values (
        '${IDS.vip}','${IDS.product}','PCS',95,'agreed sell price',
        '${IDS.staff}','${IDS.staff}','2000-01-01T00:00:00Z'
      )`,
    );
    const stampedRule = one(await db.query(`
      select unit,created_by,updated_by,created_at > '2000-01-02'::timestamptz as created_now
      from public.customer_product_net_prices
      where customer_id='${IDS.vip}' and product_id='${IDS.product}'
    `));
    assert.deepEqual(stampedRule, {
      unit: "pcs",
      created_by: IDS.owner,
      updated_by: IDS.owner,
      created_now: true,
    });
    price = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select final_price::text,net_price::text,price_source
       from public.resolve_customer_quote_prices('${IDS.vip}',${vipInput})`,
    ));
    assert.deepEqual(price, {
      final_price: "95.00",
      net_price: "95.00",
      price_source: "customer_net",
    });
    await assert.rejects(
      () => asJwt(
        db,
        "authenticated",
        IDS.owner,
        `insert into public.customer_product_net_prices(
          customer_id,product_id,unit,net_price
        ) values ('${IDS.vip}','${IDS.product}','pcs',80)`,
      ),
      /unique|duplicate/i,
      "two concurrent/current manual rules for the same customer-product-unit must be impossible",
    );
    await assert.rejects(
      () => asJwt(
        db,
        "authenticated",
        IDS.owner,
        `update public.customer_product_net_prices set net_price=0
         where customer_id='${IDS.vip}'`,
      ),
      /check constraint|violates/i,
      "an accidental zero sell price must be rejected",
    );

    // An expired rule remains administratively active until an owner deactivates
    // it. The list RPC must expose it, including the product minimum, so the UI
    // can resolve the partial-unique conflict before inserting a successor.
    await asJwt(
      db,
      "authenticated",
      IDS.owner,
      `insert into public.customer_product_net_prices(
        customer_id,product_id,unit,net_price,valid_from,valid_until
      ) values (
        '${IDS.general}','${IDS.minProduct}','wrong-unit-is-canonicalized',88,
        now()-interval '2 days',now()-interval '1 day'
      )`,
    );
    const expiredRule = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select id,unit,min_order_qty,active,valid_until < now() as expired
       from public.list_customer_product_net_prices('${IDS.general}')`,
    ));
    assert.deepEqual(
      {
        unit: expiredRule.unit,
        min_order_qty: expiredRule.min_order_qty,
        active: expiredRule.active,
        expired: expiredRule.expired,
      },
      { unit: "pcs", min_order_qty: 2, active: true, expired: true },
    );
    await assert.rejects(
      () => asJwt(
        db,
        "authenticated",
        IDS.owner,
        `insert into public.customer_product_net_prices(
          customer_id,product_id,unit,net_price
        ) values ('${IDS.general}','${IDS.minProduct}','pcs',89)`,
      ),
      /unique|duplicate/i,
    );
    await asJwt(
      db,
      "authenticated",
      IDS.owner,
      `update public.customer_product_net_prices set active=false where id='${expiredRule.id}'`,
    );
    await asJwt(
      db,
      "authenticated",
      IDS.owner,
      `insert into public.customer_product_net_prices(
        customer_id,product_id,unit,net_price
      ) values ('${IDS.general}','${IDS.minProduct}','pcs',89)`,
    );

    // Manual rules apply at every quantity; FlowAccount history remains exact
    // quantity only once the manual rule is inactive.
    price = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select final_price::text,price_source
       from public.resolve_customer_quote_prices(
         '${IDS.vip}','[{"sku":"SKU-PRICE","qty":2}]'::jsonb
       )`,
    ));
    assert.deepEqual(price, { final_price: "95.00", price_source: "customer_net" });

    await asJwt(
      db,
      "authenticated",
      IDS.owner,
      `update public.customer_product_net_prices set active=false
       where customer_id='${IDS.vip}' and product_id='${IDS.product}'`,
    );
    price = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select final_price::text,price_source
       from public.resolve_customer_quote_prices(
         '${IDS.vip}','[{"sku":"SKU-PRICE","qty":2}]'::jsonb
       )`,
    ));
    assert.deepEqual(price, { final_price: "85.50", price_source: "tier" });

    const base = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select final_price::text,price_source
       from public.resolve_customer_quote_prices('${IDS.general}',${vipInput})`,
    ));
    assert.deepEqual(base, { final_price: "90.00", price_source: "base" });

    const invalidUnit = await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select * from public.resolve_customer_quote_prices(
        '${IDS.vip}','[{"sku":"SKU-PRICE","qty":1,"unit":"box"}]'::jsonb
      )`,
    );
    assert.equal(invalidUnit.rows.length, 0);
    const fractional = await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select * from public.resolve_customer_quote_prices(
        '${IDS.vip}','[{"sku":"SKU-PRICE","qty":1.5}]'::jsonb
      )`,
    );
    assert.equal(fractional.rows.length, 0);
    const belowMinimum = await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select * from public.resolve_customer_quote_prices(
        '${IDS.vip}','[{"sku":"SKU-MIN","qty":1}]'::jsonb
      )`,
    );
    assert.equal(belowMinimum.rows.length, 0);

    const tooManyItems = JSON.stringify(
      Array.from({ length: 101 }, () => ({ sku: "SKU-PRICE", qty: 1 })),
    ).replaceAll("'", "''");
    const tooMany = await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select * from public.resolve_customer_quote_prices(
        '${IDS.vip}','${tooManyItems}'::jsonb
      )`,
    );
    assert.equal(tooMany.rows.length, 0);
    const overAggregate = await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select * from public.resolve_customer_quote_prices(
        '${IDS.vip}',
        '[{"sku":"SKU-PRICE","qty":600000},{"sku":"SKU-PRICE","qty":600000}]'::jsonb
      )`,
    );
    assert.equal(overAggregate.rows.length, 0);

    // A later catalogue price revision makes older FlowAccount history
    // ineligible. The quote then falls back to Tier on the new base price.
    await db.exec(`update public.products set price=110 where id='${IDS.product}'`);
    price = one(await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select final_price::text,price_source
       from public.resolve_customer_quote_prices('${IDS.vip}',${vipInput})`,
    ));
    assert.deepEqual(price, { final_price: "94.05", price_source: "tier" });

    // Re-enable the manual price for bot provenance and idempotency checks.
    await asJwt(
      db,
      "authenticated",
      IDS.owner,
      `update public.customer_product_net_prices set active=true,net_price=95
       where customer_id='${IDS.vip}' and product_id='${IDS.product}'`,
    );

    let botPrice = one(await asJwt(
      db,
      "service_role",
      null,
      `select final_price::text,price_source,tier,personalized_allowed,
              pricing_context_reason
       from public.resolve_bot_quote_prices('${IDS.taxConversation}',${vipInput})`,
    ));
    assert.deepEqual(botPrice, {
      final_price: "99.00",
      price_source: "base",
      tier: "general",
      personalized_allowed: false,
      pricing_context_reason: "tax_link_pending_verification",
    });

    botPrice = one(await asJwt(
      db,
      "service_role",
      null,
      `select final_price::text,price_source,tier,personalized_allowed,
              pricing_context_reason
       from public.resolve_bot_quote_prices(null,${vipInput})`,
    ));
    assert.deepEqual(botPrice, {
      final_price: "99.00",
      price_source: "base",
      tier: "general",
      personalized_allowed: false,
      pricing_context_reason: "no_verified_customer_context",
    });

    await db.exec(`
      update public.chat_conversations
      set metadata = metadata || '{"price_history_verified_at":"2026-09-13T09:00:00Z"}'::jsonb
      where id='${IDS.taxConversation}';
    `);
    botPrice = one(await asJwt(
      db,
      "service_role",
      null,
      `select final_price::text,price_source,personalized_allowed,pricing_context_reason
       from public.resolve_bot_quote_prices('${IDS.taxConversation}',${vipInput})`,
    ));
    assert.deepEqual(botPrice, {
      final_price: "95.00",
      price_source: "customer_net",
      personalized_allowed: true,
      pricing_context_reason: "price_history_verified",
    });

    // Exact verified LINE membership is another accepted provenance path.
    await db.exec(`
      update public.chat_conversations
      set external_id='LINE-VERIFIED', metadata='{"quote_customer_link_method":"tax_id"}'
      where id='${IDS.taxConversation}';
      insert into public.customer_contacts(customer_id,user_id,verified)
      values ('${IDS.vip}','${IDS.verifiedUser}',true);
    `);
    botPrice = one(await asJwt(
      db,
      "service_role",
      null,
      `select personalized_allowed,pricing_context_reason
       from public.resolve_bot_quote_prices('${IDS.taxConversation}',${vipInput})`,
    ));
    assert.deepEqual(botPrice, {
      personalized_allowed: true,
      pricing_context_reason: "verified_customer_contact",
    });

    const beforeGuardedCreates = Number(
      (await db.query("select count(*)::int as n from public.quotes")).rows[0].n,
    );
    for (const guardedInput of [
      `'${tooManyItems}'::jsonb`,
      `'[{"sku":"SKU-PRICE","qty":600000},{"sku":"SKU-PRICE","qty":600000}]'::jsonb`,
    ]) {
      const guarded = one(await asJwt(
        db,
        "service_role",
        null,
        `select * from public.create_or_reuse_bot_quote(
          '${IDS.manualConversation}','line',${guardedInput},null,null,null
        )`,
      ));
      assert.equal(guarded.items_resolved, false);
    }
    assert.equal(
      Number((await db.query("select count(*)::int as n from public.quotes")).rows[0].n),
      beforeGuardedCreates,
      "oversized bot requests must not create partial quotes",
    );

    const zeroInput = `'[{"sku":"SKU-ZERO","qty":1}]'::jsonb`;
    const zeroResolved = await asJwt(
      db,
      "authenticated",
      IDS.staff,
      `select * from public.resolve_customer_quote_prices('${IDS.vip}',${zeroInput})`,
    );
    assert.equal(
      zeroResolved.rows.length,
      0,
      "a zero effective catalogue price must not be exposed as an automatic sell price",
    );
    const beforeZeroCreate = Number(
      (await db.query("select count(*)::int as n from public.quotes")).rows[0].n,
    );
    const zeroQuote = one(await asJwt(
      db,
      "service_role",
      null,
      `select * from public.create_or_reuse_bot_quote(
        '${IDS.manualConversation}','line',${zeroInput},null,null,null
      )`,
    ));
    assert.equal(zeroQuote.items_resolved, false);
    assert.equal(
      Number((await db.query("select count(*)::int as n from public.quotes")).rows[0].n),
      beforeZeroCreate,
      "a zero effective catalogue price must not create a bot quote",
    );

    const first = one(await asJwt(
      db,
      "service_role",
      null,
      `select * from public.create_or_reuse_bot_quote(
        '${IDS.manualConversation}','line',${vipInput},null,null,null
      )`,
    ));
    assert.equal(first.quote_created, true);
    assert.equal(first.quote_reused, false);
    assert.equal(first.items_resolved, true);
    assert.equal(first.quote_total, "208.65");
    const firstStoredTotal = one(await db.query(
      `select total::text from public.quotes where id='${first.quote_id}'`,
    ));
    assert.equal(
      first.quote_total,
      firstStoredTotal.total,
      "the first response must return the stored total after SHIPPING/VAT triggers",
    );

    const repeated = one(await asJwt(
      db,
      "service_role",
      null,
      `select * from public.create_or_reuse_bot_quote(
        '${IDS.manualConversation}','line',${vipInput},null,null,null
      )`,
    ));
    assert.equal(repeated.quote_created, false);
    assert.equal(repeated.quote_reused, true);
    assert.equal(repeated.quote_id, first.quote_id);
    assert.equal(repeated.quote_total, first.quote_total);

    await asJwt(
      db,
      "authenticated",
      IDS.owner,
      `update public.customer_product_net_prices set net_price=94
       where customer_id='${IDS.vip}' and product_id='${IDS.product}' and active`,
    );
    const repriced = one(await asJwt(
      db,
      "service_role",
      null,
      `select * from public.create_or_reuse_bot_quote(
        '${IDS.manualConversation}','line',${vipInput},null,null,null
      )`,
    ));
    assert.equal(repriced.quote_created, true);
    assert.notEqual(repriced.quote_id, first.quote_id);
    assert.equal(repriced.quote_total, "207.58");

    const snapshots = await db.query(`
      select q.id,qi.unit_price::text,qi.base_unit_price::text,qi.price_source,
             qi.price_fingerprint,q.pricing_fingerprint
      from public.quotes q join public.quote_items qi on qi.quote_id=q.id
      where qi.sku <> 'SHIPPING'
      order by q.created_at,q.id
    `);
    assert.deepEqual(
      snapshots.rows.map((row) => row.unit_price),
      ["95.00", "94.00"],
      "old quote must keep its original price snapshot",
    );
    assert.ok(snapshots.rows.every((row) => row.price_source === "customer_net"));
    assert.ok(snapshots.rows.every((row) => row.price_fingerprint));
    assert.ok(snapshots.rows.every((row) => row.pricing_fingerprint));

    const tasks = await db.query(`
      select requires_approval,dedupe_key,payload->>'pricing_fingerprint' as fingerprint
      from public.agent_tasks order by created_at,id
    `);
    assert.equal(tasks.rows.length, 2);
    assert.ok(tasks.rows.every((row) => row.requires_approval === false));
    assert.notEqual(tasks.rows[0].dedupe_key, tasks.rows[1].dedupe_key);
    assert.notEqual(tasks.rows[0].fingerprint, tasks.rows[1].fingerprint);

    // The create RPC uses the same provenance gate as the read-only bot price
    // resolver: a tax-only link is attached to the quote but gets base price.
    await db.exec(`
      update public.chat_conversations
      set external_id='LINE-UNVERIFIED', metadata='{"quote_customer_link_method":"tax_id"}'
      where id='${IDS.taxConversation}';
    `);
    const taxLinkedQuote = one(await asJwt(
      db,
      "service_role",
      null,
      `select * from public.create_or_reuse_bot_quote(
        '${IDS.taxConversation}','line',${vipInput},null,null,null
      )`,
    ));
    assert.equal(taxLinkedQuote.quote_created, true);
    const taxLinkedSnapshot = one(await db.query(`
      select q.customer_id,qi.unit_price::text,qi.price_source,
             qi.pricing_snapshot->>'tier' as snapshot_tier,
             qi.pricing_snapshot ? 'flowaccount_price_cache_id' as leaks_flow_cache
      from public.quotes q join public.quote_items qi on qi.quote_id=q.id
      where q.id='${taxLinkedQuote.quote_id}' and qi.sku <> 'SHIPPING'
    `));
    assert.deepEqual(taxLinkedSnapshot, {
      customer_id: IDS.vip,
      unit_price: "99.00",
      price_source: "base",
      snapshot_tier: "general",
      leaks_flow_cache: false,
    });

    assert.equal(
      Number((await db.query(`
        select count(*)::int as n from information_schema.columns
        where table_schema='public' and table_name='quote_items'
          and column_name='flowaccount_price_cache_id'
      `)).rows[0].n),
      0,
    );

    const beforeMissing = Number((await db.query("select count(*)::int as n from public.quotes")).rows[0].n);
    const missing = one(await asJwt(
      db,
      "service_role",
      null,
      `select * from public.create_or_reuse_bot_quote(
        '${IDS.missingConversation}','line',${vipInput},null,null,null
      )`,
    ));
    assert.equal(missing.items_resolved, false);
    assert.equal(
      Number((await db.query("select count(*)::int as n from public.quotes")).rows[0].n),
      beforeMissing,
      "an unverified/missing customer must not create a partial quote",
    );

    // Raw rules remain owner/admin-only. Staff, agent and viewer consume the
    // sanitized RPCs; customer and anon callers cannot inspect them.
    assert.equal(
      (await asJwt(db, "authenticated", IDS.staff, "select * from public.customer_product_net_prices")).rows.length,
      0,
    );
    assert.equal(
      (await asJwt(db, "authenticated", IDS.owner, "select * from public.customer_product_net_prices")).rows.length,
      3,
    );
    assert.equal(
      (await asJwt(
        db,
        "authenticated",
        IDS.staff,
        `select * from public.list_customer_product_net_prices('${IDS.vip}')`,
      )).rows.length,
      1,
    );
    for (const readOnlyId of [IDS.agent, IDS.viewer]) {
      assert.equal(
        (await asJwt(
          db,
          "authenticated",
          readOnlyId,
          `select * from public.list_customer_product_net_prices('${IDS.vip}')`,
        )).rows.length,
        1,
      );
      assert.equal(
        (await asJwt(
          db,
          "authenticated",
          readOnlyId,
          `select final_price from public.resolve_customer_quote_prices('${IDS.vip}',${vipInput})`,
        )).rows.length,
        1,
      );
      await assert.rejects(
        () => asJwt(
          db,
          "authenticated",
          readOnlyId,
          `insert into public.customer_product_net_prices(
             customer_id,product_id,unit,net_price,valid_from
           ) values (
             '${IDS.general}','${IDS.product}','pcs',77,clock_timestamp()
           )`,
        ),
        /row-level security|violates/i,
      );
    }
    await assert.rejects(
      () => asJwt(
        db,
        "authenticated",
        IDS.customerUser,
        `select * from public.list_customer_product_net_prices('${IDS.vip}')`,
      ),
      /forbidden/,
    );
    await assert.rejects(
      () => asJwt(
        db,
        "anon",
        null,
        `select * from public.resolve_customer_quote_prices('${IDS.vip}',${vipInput})`,
      ),
      /permission denied/,
    );

    // SECURITY DEFINER building blocks stay backend-only. Browser roles must
    // not be able to forge agent tasks or mutate quote totals by UUID.
    await assert.rejects(
      () => asJwt(
        db,
        "anon",
        null,
        "select public.agent_propose('sales','sales.quote_request','forged task')",
      ),
      /permission denied/,
    );
    await assert.rejects(
      () => asJwt(
        db,
        "authenticated",
        IDS.staff,
        "select public.agent_propose('sales','sales.quote_request','forged staff task')",
      ),
      /permission denied/,
    );
    await assert.rejects(
      () => asJwt(
        db,
        "authenticated",
        IDS.staff,
        `select public.apply_quote_shipping('${first.quote_id}', 1)`,
      ),
      /permission denied/,
    );

    const audit = await db.query(`
      select action,count(*)::int as n from public.audit_logs
      where action like 'customer_pricing.%' or action='quote.pricing_resolved'
      group by action order by action
    `);
    assert.ok(audit.rows.some((row) => row.action === "customer_pricing.insert"));
    assert.ok(audit.rows.some((row) => row.action === "customer_pricing.update"));
    assert.equal(
      audit.rows.find((row) => row.action === "quote.pricing_resolved")?.n,
      3,
    );
  } finally {
    await db.close();
  }
});

test("bot quote reuse is limited to an exact short-lived request", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);

    const callQuote = async ({
      qty,
      channel = "line",
      name = "คุณสมชาย",
      phone = "0812345678",
      note = "ส่งที่โรงงาน",
    }) => one(await asJwt(
      db,
      "service_role",
      null,
      `select * from public.create_or_reuse_bot_quote(
        '${IDS.manualConversation}',
        '${channel.replaceAll("'", "''")}',
        '[{"sku":"SKU-PRICE","qty":${qty}}]'::jsonb,
        '${name.replaceAll("'", "''")}',
        '${phone.replaceAll("'", "''")}',
        '${note.replaceAll("'", "''")}'
      )`,
    ));

    const first = await callQuote({ qty: 2 });
    const immediateRetry = await callQuote({
      qty: 2,
      channel: " line ",
      name: " คุณสมชาย ",
      phone: " 0812345678 ",
      note: " ส่งที่โรงงาน ",
    });
    assert.equal(first.quote_created, true);
    assert.equal(immediateRetry.quote_reused, true);
    assert.equal(immediateRetry.quote_id, first.quote_id);

    for (const changedRequest of [
      { qty: 2, name: "คุณสมหญิง" },
      { qty: 2, phone: "0899999999" },
      { qty: 2, note: "รับหน้าร้าน" },
      { qty: 2, channel: "web" },
    ]) {
      const changed = await callQuote(changedRequest);
      assert.equal(changed.quote_created, true, JSON.stringify(changedRequest));
      assert.notEqual(changed.quote_id, first.quote_id, JSON.stringify(changedRequest));
    }

    const expiring = await callQuote({ qty: 3 });
    await db.query(
      "update public.quotes set valid_until=current_date-1 where id=$1",
      [expiring.quote_id],
    );
    const afterExpiry = await callQuote({ qty: 3 });
    assert.equal(afterExpiry.quote_created, true);
    assert.notEqual(afterExpiry.quote_id, expiring.quote_id);

    const oldRequest = await callQuote({ qty: 4 });
    await db.query(
      "update public.quotes set created_at=now()-interval '11 minutes' where id=$1",
      [oldRequest.quote_id],
    );
    await db.query(
      `update public.agent_tasks
       set created_at=now()-interval '11 minutes'
       where payload->>'quote_id'=$1`,
      [oldRequest.quote_id],
    );
    const afterRetryWindow = await callQuote({ qty: 4 });
    assert.equal(afterRetryWindow.quote_created, true);
    assert.notEqual(afterRetryWindow.quote_id, oldRequest.quote_id);

    await db.exec(`reset role;
      select set_config('request.jwt.claim.sub','',false);
      select set_config('request.jwt.claim.role','service_role',false);
      set role service_role;`);
    const concurrentSql = `select * from public.create_or_reuse_bot_quote(
      '${IDS.manualConversation}','line',
      '[{"sku":"SKU-PRICE","qty":5}]'::jsonb,
      'คุณสมชาย','0812345678','ส่งที่โรงงาน'
    )`;
    let concurrentResults;
    try {
      concurrentResults = await Promise.all([
        db.query(concurrentSql),
        db.query(concurrentSql),
      ]);
    } finally {
      await db.exec("reset role");
    }
    const concurrent = concurrentResults.map(one);
    assert.equal(new Set(concurrent.map((row) => row.quote_id)).size, 1);
    assert.deepEqual(
      concurrent.map((row) => row.quote_created).sort(),
      [false, true],
    );
    assert.deepEqual(
      concurrent.map((row) => row.quote_reused).sort(),
      [false, true],
    );
  } finally {
    await db.close();
  }
});
