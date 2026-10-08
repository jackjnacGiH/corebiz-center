import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/20261008051453_atomic_sales_stock_loyalty.sql', import.meta.url), 'utf8');
const paginationMigration = await readFile(new URL('../supabase/migrations/20261008052337_sales_document_pagination.sql', import.meta.url), 'utf8');
const ids = {
  owner: '00000000-0000-4000-8000-000000000001', staff: '00000000-0000-4000-8000-000000000002',
  customer: '00000000-0000-4000-8000-000000000003', inactive: '00000000-0000-4000-8000-000000000004',
  viewer: '00000000-0000-4000-8000-000000000005', warehouse: '00000000-0000-4000-8000-000000000010',
  secondWarehouse: '00000000-0000-4000-8000-000000000011', product: '00000000-0000-4000-8000-000000000020',
  madeToOrder: '00000000-0000-4000-8000-000000000021', variant: '00000000-0000-4000-8000-000000000022',
  legacy: '00000000-0000-4000-8000-000000000030',
};

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    create table public.profiles(id uuid primary key,role text,is_active boolean);
    create function public.is_staff() returns boolean language sql stable security definer as $$
      select exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('owner','admin','staff')) $$;
    create table public.products(id uuid primary key);
    create table public.product_variants(id uuid primary key,product_id uuid references public.products);
    create table public.warehouses(id uuid primary key,is_default boolean);
    create table public.customers(id uuid primary key,user_id uuid,name text default 'Test customer',code text default 'C-TEST',tax_id text,billing_address jsonb,tier text default 'general',loyalty_points int default 0,total_spent numeric default 0,total_orders int default 0);
    create function public.can_read() returns boolean language sql stable security definer as $$
      select exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('owner','admin','staff','agent','viewer')) $$;
    create table public.tier_benefits(tier text primary key,point_multiplier numeric);
    create table public.orders(id uuid primary key default gen_random_uuid(),code text unique not null,customer_id uuid references public.customers,
      status text default 'processing' check(status in ('pending','processing','shipped','delivered','cancelled','returned')),
      payment_status text default 'unpaid' check(payment_status in ('unpaid','partial','paid','refunded')),
      subtotal numeric default 0,discount numeric default 0,vat numeric default 0,shipping_fee numeric default 0,total numeric default 0,
      notes text,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
    create sequence quote_code_seq start with 1000001;
    create table public.quotes(id uuid primary key default gen_random_uuid(),code text unique default ('QT-'||lpad(nextval('quote_code_seq')::text,8,'0')),
      customer_id uuid references public.customers,status text default 'draft',subtotal numeric default 0,discount numeric default 0,vat numeric default 0,
      total numeric default 0,valid_until date,notes text,created_by uuid,converted_to_order_id uuid references public.orders,
      created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.order_items(id uuid primary key default gen_random_uuid(),order_id uuid references public.orders on delete cascade,
      product_id uuid references public.products,variant_id uuid references public.product_variants,sku text,product_name text,
      quantity int check(quantity>0),unit_price numeric,unit text,discount numeric default 0,total numeric,created_at timestamptz default now());
    create table public.quote_items(id uuid primary key default gen_random_uuid(),quote_id uuid references public.quotes on delete cascade,
      product_id uuid references public.products,variant_id uuid references public.product_variants,sku text,product_name text,
      quantity int check(quantity>0),unit_price numeric,unit text,discount numeric default 0,total numeric,
      base_unit_price numeric,price_source text default 'unspecified',tier_percent numeric,net_rule_id uuid,
      pricing_snapshot jsonb,price_fingerprint text,price_resolved_at timestamptz);
    create table public.inventory(id uuid primary key default gen_random_uuid(),product_id uuid references public.products,
      variant_id uuid references public.product_variants,warehouse_id uuid references public.warehouses,
      quantity int default 0 check(quantity>=0),reserved int default 0,unique(product_id,variant_id,warehouse_id));
    create table public.inventory_movements(id uuid primary key default gen_random_uuid(),product_id uuid references public.products,
      variant_id uuid,warehouse_id uuid,movement_type text,quantity int,reference_type text,reference_id uuid,note text,created_by uuid);
    create table public.loyalty_transactions(id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers,
      points int,reason text check(reason in ('earn_order','redeem','adjust','expire','signup_bonus','referral')),
      note text,reference_type text,reference_id uuid,created_at timestamptz default now());
    create table public.audit_logs(id uuid default gen_random_uuid(),actor_id uuid,action text,target_type text,target_id text,detail jsonb);
    create table public.agent_tasks(id uuid default gen_random_uuid(),category text,kind text,action_kind text,title text,summary text,recommendation text,
      payload jsonb,status text,requires_approval boolean,priority int,related_type text,related_id text,dedupe_key text unique,source text);
    create function public.my_customer_id() returns uuid language sql stable security definer as $$select id from public.customers where user_id=auth.uid() limit 1$$;
    create function public.recalculate_customer_totals(p_customer_id uuid) returns void language sql security definer as $$
      update public.customers set total_spent=(select coalesce(sum(total),0) from public.orders where customer_id=p_customer_id and payment_status='paid' and status not in ('cancelled','returned')) where id=p_customer_id $$;
    create function public.apply_quote_shipping(p_quote_id uuid,p_fee numeric default 100) returns void language plpgsql as $$ begin
      insert into public.quote_items(quote_id,sku,product_name,quantity,unit_price,total) values(p_quote_id,'SHIPPING','Shipping',1,p_fee,p_fee);
      update public.quotes set subtotal=subtotal+p_fee,vat=round((subtotal+p_fee-discount)*0.07,2),total=round((subtotal+p_fee-discount)*1.07,2) where id=p_quote_id;
    end $$;
    grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
    grant usage on all sequences in schema public to authenticated,service_role;
    insert into public.profiles values('${ids.owner}','owner',true),('${ids.staff}','staff',true),('${ids.customer}','customer',true),('${ids.inactive}','staff',false),('${ids.viewer}','viewer',true);
    insert into public.products values('${ids.product}'),('${ids.madeToOrder}');
    insert into public.product_variants values('${ids.variant}','${ids.product}');
    insert into public.warehouses values('${ids.warehouse}',true),('${ids.secondWarehouse}',false);
    insert into public.inventory(product_id,warehouse_id,quantity) values('${ids.product}','${ids.warehouse}',100),('${ids.product}','${ids.secondWarehouse}',500),('${ids.madeToOrder}','${ids.warehouse}',0);
    insert into public.inventory(product_id,variant_id,warehouse_id,quantity) values('${ids.product}','${ids.variant}','${ids.warehouse}',25);
    insert into public.customers(id,user_id,tier) values('${ids.customer}','${ids.customer}','gold');
    insert into public.tier_benefits values('gold',2);
    insert into public.orders(id,code,status) values('${ids.legacy}','SO-LEGACY','processing');
    insert into public.order_items(order_id,product_id,sku,product_name,quantity,unit_price,total) values('${ids.legacy}','${ids.product}','A','Legacy',10,10,100);
    create function public.old_noop() returns trigger language plpgsql as $$begin return NEW; end$$;
    create trigger order_paid_loyalty_trigger after update on public.orders for each row execute function public.old_noop();
    create trigger order_status_inventory_trigger after update of status on public.orders for each row execute function public.old_noop();
  `);
  try {
    await db.exec(migration);
    await db.exec('create unique index quotes_code_unique_idx on public.quotes(code)');
    await db.exec(paginationMigration);
  } catch (error) {
    await db.close();
    throw error;
  }
  await db.exec(`select set_config('request.jwt.claim.sub','${ids.staff}',false);`);
  return db;
}
const line = (quantity = 10, overrides = {}) => ({ product_id: ids.product, sku: 'A', product_name: 'Product A', quantity, unit_price: 10, discount: 0, unit: 'ชิ้น', ...overrides });
async function createQuote(db, lines = [line()], discount = 0, customer = null) {
  return (await db.query('select public.create_sales_quote($1::jsonb,$2::uuid,$3::numeric) result',[JSON.stringify(lines),customer,discount])).rows[0].result;
}
async function approve(db, quoteId) {
  return (await db.query('select public.approve_quote_as_order($1::uuid) result',[quoteId])).rows[0].result;
}
async function value(db, sql, params = []) { return Object.values((await db.query(sql,params)).rows[0])[0]; }
async function stock(db, product = ids.product, variant = null, warehouse = ids.warehouse) {
  return value(db,'select quantity from public.inventory where product_id=$1 and variant_id is not distinct from $2::uuid and warehouse_id=$3',[product,variant,warehouse]);
}
async function asUser(db, id, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`);
  try { return await db.query(sql,params); }
  finally { await db.exec('reset role'); }
}

test('sales RPCs deny anon, customer, viewer and inactive staff; direct stock metadata cannot bypass review', async () => {
  const db=await fixture();
  try {
    for (const user of [ids.customer,ids.viewer,ids.inactive]) {
      await assert.rejects(asUser(db,user,'select public.create_sales_quote($1::jsonb)',[JSON.stringify([line()])]),/forbidden/);
      await assert.rejects(asUser(db,user,'select public.approve_quote_as_order($1::uuid)',[ids.legacy]),/forbidden/);
      await assert.rejects(asUser(db,user,'select public.replace_sales_document_items($1,$2,$3::jsonb,$4,$5,$6)',['order',ids.legacy,JSON.stringify([line()]),0,0,1]),/forbidden/);
    }
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.create_sales_quote($1::jsonb)',[JSON.stringify([line()])]),/permission denied/);
    await db.exec('reset role');
    await assert.rejects(asUser(db,ids.staff,`update public.orders set stock_ledger_version=1 where id='${ids.legacy}'`),/stock_metadata_managed_by_server/);
    await assert.rejects(asUser(db,ids.staff,`insert into public.orders(code,stock_ledger_version) values('SO-BYPASS',0)`),/stock_metadata_managed_by_server/);
    await assert.rejects(asUser(db,ids.staff,'select public.sales_stock_review_queue()'),/forbidden/);
    assert.equal((await asUser(db,ids.owner,'select * from public.sales_stock_review_queue()')).rows.length,1);
  } finally { await db.close(); }
});

test('atomic approval deduplicates retries and duplicate SKU quantities; cancel restores exact default-warehouse deduction', async () => {
  const db=await fixture();
  try {
    const q=await createQuote(db,[line(6),line(4),line(2,{product_id:null,sku:'SHIPPING',product_name:'Shipping'})]);
    const [one,two]=await Promise.all([approve(db,q.id),approve(db,q.id)]);
    assert.equal(one.id,two.id);
    assert.equal(await value(db,'select count(*)::int from public.orders where source_quote_id=$1',[q.id]),1);
    assert.equal(await value(db,'select count(*)::int from public.order_items where order_id=$1',[one.id]),3);
    assert.equal(await stock(db),90);
    assert.equal(await stock(db,ids.product,null,ids.secondWarehouse),500);
    assert.deepEqual((await db.query('select requested,deducted,backorder from public.order_stock_allocations where order_id=$1',[one.id])).rows,[{requested:10,deducted:10,backorder:0}]);
    await db.query('update public.orders set status=$1 where id=$2',['shipped',one.id]);
    assert.equal(await stock(db),90);
    await db.query('update public.orders set status=$1 where id=$2',['cancelled',one.id]);
    await db.query('update public.orders set status=$1 where id=$2',['cancelled',one.id]);
    assert.equal(await stock(db),100);
    assert.equal(await value(db,'select count(*)::int from public.inventory_movements where reference_id=$1',[one.id]),2);
  } finally { await db.close(); }
});

test('zero-stock made-to-order cancellation never manufactures stock and variant demand uses the matching inventory', async () => {
  const db=await fixture();
  try {
    const q=await createQuote(db,[line(100,{product_id:ids.madeToOrder,sku:'MTO'}),line(10,{variant_id:ids.variant})]);
    const o=await approve(db,q.id);
    assert.equal(await stock(db,ids.madeToOrder),0);
    assert.equal(await stock(db,ids.product,ids.variant),15);
    assert.equal(await stock(db),100);
    assert.equal(await value(db,'select backorder from public.order_stock_allocations where order_id=$1 and product_id=$2',[o.id,ids.madeToOrder]),100);
    await db.query('update public.orders set status=$1 where id=$2',['cancelled',o.id]);
    assert.equal(await stock(db,ids.madeToOrder),0);
    assert.equal(await stock(db,ids.product,ids.variant),25);
  } finally { await db.close(); }
});

test('processing INSERT followed by items is reconciled; shortfall returns only quantities actually deducted', async () => {
  const db=await fixture();
  try {
    await db.exec(`update public.inventory set quantity=5 where product_id='${ids.product}' and variant_id is null and warehouse_id='${ids.warehouse}'`);
    const o=await db.transaction(async tx => {
      const id=(await tx.query("insert into public.orders(code,status) values('SO-DIRECT','processing') returning id")).rows[0].id;
      await tx.query('insert into public.order_items(order_id,product_id,sku,product_name,quantity,unit_price,total) values($1,$2,$3,$4,$5,$6,$7)',[id,ids.product,'A','Product',10,10,100]);
      return id;
    });
    assert.equal(await stock(db),0);
    await db.query('update public.orders set status=$1 where id=$2',['cancelled',o]);
    assert.equal(await stock(db),5);
    assert.deepEqual((await db.query('select quantity from public.inventory_movements where reference_id=$1 order by quantity',[o])).rows,[{quantity:-5},{quantity:5}]);
  } finally { await db.close(); }
});

test('stock allocation respects existing reservations and restores the original warehouse after default changes', async () => {
  const db=await fixture();
  try {
    await db.query('update public.inventory set reserved=10 where product_id=$1 and variant_id is null and warehouse_id=$2',[ids.product,ids.warehouse]);
    const q=await createQuote(db,[line(95)]); const o=await approve(db,q.id);
    assert.equal(await stock(db),10);
    assert.equal(await value(db,'select backorder from public.order_stock_allocations where order_id=$1',[o.id]),5);
    await db.exec(`update public.warehouses set is_default=(id='${ids.secondWarehouse}');`);
    await db.query('update public.orders set status=$1 where id=$2',['cancelled',o.id]);
    assert.equal(await stock(db),100);
    assert.equal(await stock(db,ids.product,null,ids.secondWarehouse),500);
    assert.equal(await value(db,'select reserved from public.inventory where product_id=$1 and variant_id is null and warehouse_id=$2',[ids.product,ids.warehouse]),10);
  } finally { await db.close(); }
});

test('invalid product-variant pair and missing warehouse roll back the entire approval', async () => {
  const db=await fixture();
  try {
    const bad=await createQuote(db,[line(10,{product_id:ids.madeToOrder,variant_id:ids.variant})]);
    await assert.rejects(approve(db,bad.id),/invalid_item_product_variant/);
    assert.equal(await value(db,'select count(*)::int from public.orders where source_quote_id=$1',[bad.id]),0);
    const q=await createQuote(db);
    await db.exec('update public.warehouses set is_default=false');
    await assert.rejects(approve(db,q.id),/default_warehouse_required/);
    assert.equal(await value(db,'select count(*)::int from public.orders where source_quote_id=$1',[q.id]),0);
    assert.equal(await stock(db),100);
  } finally { await db.close(); }
});

test('order edits reconcile final quantities and header/line discounts while stale versions and faults roll back', async () => {
  const db=await fixture();
  try {
    const q=await createQuote(db,[line(10)]); const o=await approve(db,q.id);
    const version=await value(db,'select version from public.orders where id=$1',[o.id]);
    const replacement=[line(15,{discount:10})];
    await db.query('select public.replace_sales_document_items($1,$2,$3::jsonb,$4,$5,$6)',['order',o.id,JSON.stringify(replacement),5,100,version]);
    assert.equal(await stock(db),85);
    assert.deepEqual((await db.query('select subtotal::text,discount::text,vat::text,shipping_fee::text,total::text from public.orders where id=$1',[o.id])).rows[0],{subtotal:'140.00',discount:'5.00',vat:'9.45',shipping_fee:'100.00',total:'244.45'});
    await assert.rejects(db.query('select public.replace_sales_document_items($1,$2,$3::jsonb,$4,$5,$6)',['order',o.id,JSON.stringify([line(3)]),0,0,version]),/document_version_conflict/);
    const latest=await value(db,'select version from public.orders where id=$1',[o.id]);
    const bad=[line(2,{product_id:'00000000-0000-4000-8000-000000009999'})];
    await assert.rejects(db.query('select public.replace_sales_document_items($1,$2,$3::jsonb,$4,$5,$6)',['order',o.id,JSON.stringify(bad),0,0,latest]),/foreign key/);
    assert.equal(await value(db,'select quantity from public.order_items where order_id=$1',[o.id]),15);
    assert.equal(await stock(db),85);
    assert.equal(await value(db,'select version from public.orders where id=$1',[o.id]),latest);
    await db.exec(`create function fail_total() returns trigger language plpgsql as $$begin if NEW.total=21.40 then raise exception 'fault_total'; end if; return NEW; end$$;
      create trigger fault_total before update on public.orders for each row execute function fail_total();`);
    await assert.rejects(db.query('select public.replace_sales_document_items($1,$2,$3::jsonb,$4,$5,$6)',['order',o.id,JSON.stringify([line(2)]),0,0,latest]),/fault_total/);
    assert.equal(await stock(db),85);
    assert.equal(await value(db,'select quantity from public.order_items where order_id=$1',[o.id]),15);
    await db.query('update public.orders set status=$1 where id=$2',['cancelled',o.id]);
    assert.equal(await stock(db),100);
  } finally { await db.close(); }
});

test('create/replace quote rolls back partial failures and keeps pricing provenance; converted quote cannot diverge', async () => {
  const db=await fixture();
  try {
    await assert.rejects(createQuote(db,[line(10,{product_id:'00000000-0000-4000-8000-000000009999'})]),/foreign key/);
    assert.equal(await value(db,'select count(*)::int from public.quotes'),0);
    const q=await createQuote(db,[line(10,{discount:10})],5);
    const oldLine=(await db.query('select * from public.quote_items where quote_id=$1',[q.id])).rows[0];
    await db.query("update public.quote_items set price_source='customer_net',pricing_snapshot=$1::jsonb where id=$2",['{"rule":"original"}',oldLine.id]);
    let version=await value(db,'select version from public.quotes where id=$1',[q.id]);
    await assert.rejects(db.query('select public.replace_sales_document_items($1,$2,$3::jsonb,$4,$5,$6)',['quote',q.id,JSON.stringify([line(10,{product_id:'00000000-0000-4000-8000-000000009999'})]),0,0,version]),/foreign key/);
    assert.equal(await value(db,'select quantity from public.quote_items where quote_id=$1',[q.id]),10);
    await db.query('select public.replace_sales_document_items($1,$2,$3::jsonb,$4,$5,$6)',['quote',q.id,JSON.stringify([line(10,{id:oldLine.id,discount:10,price_source:'forged'})]),5,0,version]);
    assert.equal(await value(db,'select total::text from public.quotes where id=$1',[q.id]),'90.95');
    assert.equal(await value(db,'select price_source from public.quote_items where quote_id=$1',[q.id]),'customer_net');
    assert.deepEqual(await value(db,'select pricing_snapshot from public.quote_items where quote_id=$1',[q.id]),{rule:'original'});
    version=await value(db,'select version from public.quotes where id=$1',[q.id]);
    await approve(db,q.id);
    await assert.rejects(db.query('select public.replace_sales_document_items($1,$2,$3::jsonb,$4,$5,$6)',['quote',q.id,JSON.stringify([line()]),0,0,version]),/converted_quote_cannot_edit/);
  } finally { await db.close(); }
});

test('approval failures at final link roll back order, stock and items; legacy code collision needs explicit review', async () => {
  const db=await fixture();
  try {
    const q=await createQuote(db);
    await db.exec(`create function fail_quote_link() returns trigger language plpgsql as $$begin if NEW.converted_to_order_id is not null then raise exception 'fault_link'; end if; return NEW; end$$;
      create trigger fault_link before update on public.quotes for each row execute function fail_quote_link();`);
    await assert.rejects(approve(db,q.id),/fault_link/);
    assert.equal(await stock(db),100);
    assert.equal(await value(db,'select count(*)::int from public.orders where source_quote_id=$1',[q.id]),0);
    assert.equal(await value(db,'select count(*)::int from public.inventory_movements'),0);
    await db.exec('drop trigger fault_link on public.quotes');
    await db.query('update public.quotes set total=999 where id=$1',[q.id]);
    await assert.rejects(approve(db,q.id),/quote_totals_review_required/);
    assert.equal(await stock(db),100);
    await db.query('update public.quotes set total=107 where id=$1',[q.id]);
    await db.query('insert into public.orders(code) values($1)',[q.code.replace(/^QT-/,'SO-')]);
    await assert.rejects(approve(db,q.id),/legacy_order_code_collision_review_required/);
    assert.equal(await value(db,'select converted_to_order_id from public.quotes where id=$1',[q.id]),null);
  } finally { await db.close(); }
});

test('historical balances are unchanged until reviewed baseline; only known deduction is restored', async () => {
  const db=await fixture();
  try {
    assert.equal(await stock(db),100);
    await assert.rejects(db.query('update public.orders set status=$1 where id=$2',['cancelled',ids.legacy]),/stock_legacy_review_required/);
    await assert.rejects(db.query('delete from public.order_items where order_id=$1',[ids.legacy]),/stock_legacy_review_required/);
    await db.exec(`select set_config('request.jwt.claim.sub','${ids.owner}',false)`);
    await db.query('select public.baseline_order_stock($1,$2::jsonb,$3,$4)',[ids.legacy,JSON.stringify([{product_id:ids.product,deducted:0}]),'Reviewed: old approval never deducted stock',1]);
    assert.equal(await stock(db),100);
    await db.query('update public.orders set status=$1 where id=$2',['cancelled',ids.legacy]);
    assert.equal(await stock(db),100);
  } finally { await db.close(); }
});

test('reviewed legacy deduction can use its historical warehouse and migration reruns preserve balances', async () => {
  const db=await fixture();
  try {
    await db.query('update public.inventory set quantity=90 where product_id=$1 and variant_id is null and warehouse_id=$2',[ids.product,ids.warehouse]);
    await db.exec(`update public.warehouses set is_default=(id='${ids.secondWarehouse}'); select set_config('request.jwt.claim.sub','${ids.owner}',false);`);
    await db.query('update public.orders set status=$1 where id=$2',['shipped',ids.legacy]);
    await db.query('select public.baseline_order_stock($1,$2::jsonb,$3,$4,$5)',[ids.legacy,JSON.stringify([{product_id:ids.product,deducted:10}]),'Reviewed historical actual deduction in original warehouse',2,ids.warehouse]);
    assert.equal(await stock(db),90);
    await db.exec(migration); await db.exec(paginationMigration);
    assert.equal(await stock(db),90);
    await db.query('update public.orders set status=$1 where id=$2',['cancelled',ids.legacy]);
    assert.equal(await stock(db),100);
    assert.equal(await stock(db,ids.product,null,ids.secondWarehouse),500);
  } finally { await db.close(); }
});

test('migration preflight refuses ambiguous inventory/loyalty history without deleting or correcting balances', async () => {
  const db=await fixture();
  try {
    await db.exec('drop index public.inventory_product_variant_warehouse_once_idx');
    const duplicate=(await db.query('insert into public.inventory(product_id,warehouse_id,quantity) values($1,$2,100) returning id',[ids.product,ids.warehouse])).rows[0].id;
    await assert.rejects(db.exec(migration),/inventory_duplicate_rows_review_required/);
    assert.equal(await value(db,'select sum(quantity)::int from public.inventory where product_id=$1 and variant_id is null and warehouse_id=$2',[ids.product,ids.warehouse]),200);
    await db.query('delete from public.inventory where id=$1',[duplicate]);
    await db.exec('drop index public.loyalty_earn_order_once_idx');
    await db.query("insert into public.loyalty_transactions(customer_id,points,reason,reference_type,reference_id) values($1,10,'earn_order','order',$2),($1,10,'earn_order','order',$2)",[ids.customer,ids.legacy]);
    await db.query('update public.customers set loyalty_points=20 where id=$1',[ids.customer]);
    await assert.rejects(db.exec(migration),/loyalty_duplicate_awards_review_required/);
    assert.equal(await value(db,'select loyalty_points from public.customers where id=$1',[ids.customer]),20);
    assert.equal(await value(db,"select count(*)::int from public.loyalty_transactions where reason='earn_order'"),2);
  } finally { await db.close(); }
});

test('loyalty tier awards once; exact automatic cancellation/full-refund reversals allow spent-point debt', async () => {
  const db=await fixture();
  try {
    const unpaidQuote=await createQuote(db,[line(2)],0,ids.customer); const unpaidOrder=await approve(db,unpaidQuote.id);
    await db.query("update public.orders set status='cancelled' where id=$1",[unpaidOrder.id]);
    assert.equal(await value(db,'select loyalty_points from public.customers where id=$1',[ids.customer]),0);
    const q=await createQuote(db,[line(100)],0,ids.customer); const o=await approve(db,q.id);
    await db.query("update public.orders set payment_status='paid' where id=$1",[o.id]);
    await db.query("update public.orders set payment_status='paid' where id=$1",[o.id]);
    await db.query("update public.orders set payment_status='partial' where id=$1",[o.id]);
    await db.query("update public.orders set payment_status='paid' where id=$1",[o.id]);
    assert.equal(await value(db,'select loyalty_points from public.customers where id=$1',[ids.customer]),20);
    assert.equal(await value(db,"select count(*)::int from public.loyalty_transactions where reason='earn_order'"),1);
    await db.query('update public.customers set loyalty_points=3 where id=$1',[ids.customer]);
    await db.query("update public.orders set status='cancelled' where id=$1",[o.id]);
    await db.query("update public.orders set payment_status='refunded' where id=$1",[o.id]);
    assert.equal(await value(db,'select loyalty_points from public.customers where id=$1',[ids.customer]),-17);
    assert.equal(await value(db,"select count(*)::int from public.loyalty_transactions where reference_type='order_reversal'"),1);
    await db.query("update public.orders set status='processing',payment_status='paid' where id=$1",[o.id]);
    assert.equal(await value(db,'select loyalty_points from public.customers where id=$1',[ids.customer]),-17);
    const q2=await createQuote(db,[line(100)],0,ids.customer); const o2=await approve(db,q2.id);
    await db.query("update public.orders set payment_status='paid' where id=$1",[o2.id]);
    assert.equal(await value(db,'select loyalty_points from public.customers where id=$1',[ids.customer]),3);
    await db.query("update public.orders set status='returned' where id=$1",[o2.id]);
    assert.equal(await value(db,'select loyalty_points from public.customers where id=$1',[ids.customer]),3);
    await db.query("update public.orders set payment_status='refunded' where id=$1",[o2.id]);
    assert.equal(await value(db,'select loyalty_points from public.customers where id=$1',[ids.customer]),-17);
    assert.equal(await value(db,'select total_spent from public.customers where id=$1',[ids.customer]),'1070.00');
  } finally { await db.close(); }
});

test('opposing customer quote responses choose one state/task/audit; retries are idempotent and unauthorized links fail', async () => {
  const db=await fixture();
  try {
    const q=await createQuote(db,[line()],0,ids.customer);
    await db.exec(`select set_config('request.jwt.claim.sub','${ids.customer}',false)`);
    const outcomes=await Promise.allSettled([db.query('select public.respond_my_quote($1,true)',[q.id]),db.query('select public.respond_my_quote($1,false)',[q.id])]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    const status=await value(db,'select status from public.quotes where id=$1',[q.id]);
    const accepted=await value(db,"select (payload->>'accepted')::boolean from public.agent_tasks where related_id=$1",[q.id]);
    assert.equal(status,accepted?'accepted':'rejected');
    await db.query('select public.respond_my_quote($1,$2)',[q.id,accepted]);
    assert.equal(await value(db,'select count(*)::int from public.agent_tasks'),1);
    assert.equal(await value(db,"select count(*)::int from public.audit_logs where action like 'quote.customer_%'"),1);
    await assert.rejects(db.query('select public.respond_my_quote($1,null)',[q.id]),/invalid_response/);
    await db.query('update public.profiles set is_active=false where id=$1',[ids.customer]);
    await assert.rejects(db.query('select public.respond_my_quote($1,true)',[q.id]),/forbidden/);
    await db.exec(`select set_config('request.jwt.claim.sub','${ids.viewer}',false)`);
    await assert.rejects(db.query('select public.respond_my_quote($1,true)',[q.id]),/not_linked/);
  } finally { await db.close(); }
});

test('storefront service-only RPC commits shipping atomically, and shipping faults keep no partial quote', async () => {
  const db=await fixture();
  try {
    await assert.rejects(asUser(db,ids.staff,'select public.create_storefront_quote_atomic($1::jsonb)',[JSON.stringify([line()])]),/permission denied/);
    await assert.rejects(asUser(db,ids.customer,'select public.apply_quote_shipping($1::uuid)',[ids.legacy]),/permission denied/);
    await db.exec('set role service_role');
    const q=(await db.query('select public.create_storefront_quote_atomic($1::jsonb) result',[JSON.stringify([line()])])).rows[0].result;
    await db.exec('reset role');
    assert.equal(await value(db,'select count(*)::int from public.quote_items where quote_id=$1',[q.id]),2);
    assert.equal(await value(db,'select total::text from public.quotes where id=$1',[q.id]),'214.00');
    await db.exec("create or replace function public.apply_quote_shipping(p_quote_id uuid,p_fee numeric default 100) returns void language plpgsql as $$begin raise exception 'fault_shipping'; end$$;");
    await db.exec('set role service_role');
    await assert.rejects(db.query('select public.create_storefront_quote_atomic($1::jsonb)',[JSON.stringify([line()])]),/fault_shipping/);
    await db.exec('reset role');
    assert.equal(await value(db,'select count(*)::int from public.quotes'),1);
    assert.equal(await value(db,'select count(*)::int from public.quote_items'),2);
  } finally { await db.close(); }
});

test('sales keyset pages include over 1000 equal-timestamp documents, server search/status counts and verified roles', async () => {
  const db=await fixture();
  try {
    await db.exec("insert into public.quotes(code,created_at,status,customer_id) select 'QT-PAGE-'||lpad(n::text,5,'0'),'2026-01-01 00:00:00Z',case when n%2=0 then 'sent' else 'rejected' end,null from generate_series(1,1005) n;");
    const idsSeen=new Set(); let cursor=null; let counts; let pages=0;
    do {
      const page=(await db.query('select public.list_sales_documents($1,$2,$3,$4,$5,$6,$7) result',[100,'','all',null,cursor?.created_at??null,cursor?.id??null,cursor?.kind??null])).rows[0].result;
      counts=page.counts;
      assert.ok(page.items.length<=100);
      for (const item of page.items) { assert.ok(!idsSeen.has(item.document.id)); idsSeen.add(item.document.id); }
      cursor=page.next_cursor; pages+=1;
    } while(cursor);
    assert.equal(idsSeen.size,1006); assert.equal(pages,11);
    assert.deepEqual(counts,{all:1006,pending:502,cancelled:503,processing:1});
    const search=(await db.query('select public.list_sales_documents($1,$2,$3)',[100,'QT-PAGE-01005','all'])).rows[0].list_sales_documents;
    assert.equal(search.items.length,1);
    assert.equal(search.items[0].document.code,'QT-PAGE-01005');
    const sent=(await db.query('select public.list_sales_documents($1,$2,$3)',[100,'','pending'])).rows[0].list_sales_documents;
    assert.equal(sent.items.length,100); assert.equal(sent.counts.pending,502);
    assert.ok(sent.items.every(item=>item.kind==='quote'&&item.document.status==='sent'));
    const oldPayload=(await db.query('select id,code,status,subtotal,discount,vat,total,valid_until,notes,created_at,converted_to_order_id from public.quotes order by created_at desc limit 1000')).rows;
    const newPayload=(await db.query("select public.list_sales_documents(100,'','all','quote') result")).rows[0].result;
    assert.ok(Buffer.byteLength(JSON.stringify(newPayload))<Buffer.byteLength(JSON.stringify(oldPayload))*0.2,'bounded payload is under 20% of the old capped 1000-row list on the same fixture');
    await assert.rejects(asUser(db,ids.customer,'select public.list_sales_documents()'),/forbidden/);
    await assert.rejects(asUser(db,ids.inactive,'select public.list_sales_documents()'),/forbidden/);
    assert.equal((await asUser(db,ids.viewer,'select public.list_sales_documents() result')).rows[0].result.items.length,100);
  } finally { await db.close(); }
});

test('EXPLAIN fixture justifies stable page indexes by reducing scanned rows from 50000 to 100', async (t) => {
  const db=new PGlite();
  try {
    await db.exec("create table public.orders(id uuid primary key,created_at timestamptz not null); create table public.quotes(like public.orders including all); create index orders_created_idx on public.orders(created_at desc); insert into public.orders select gen_random_uuid(),'2026-01-01 00:00:00Z' from generate_series(1,50000); insert into public.quotes select * from public.orders; analyze public.orders; analyze public.quotes;");
    const explain=async(table)=> (await db.query(`explain (analyze,buffers,format json) select id,created_at from public.${table} order by created_at desc,id desc limit 100`)).rows[0]['QUERY PLAN'][0];
    const before={orders:await explain('orders'),quotes:await explain('quotes')};
    await db.exec(paginationMigration.split('create or replace function')[0]);
    const after={orders:await explain('orders'),quotes:await explain('quotes')};
    const nodes=(plan)=>[plan,...(plan.Plans??[]).flatMap(nodes)];
    for (const table of ['orders','quotes']) {
      const beforeRows=Math.max(...nodes(before[table].Plan).map(node=>node['Actual Rows']));
      const afterRows=Math.max(...nodes(after[table].Plan).map(node=>node['Actual Rows']));
      assert.equal(beforeRows,50000); assert.equal(afterRows,100);
      assert.ok(nodes(after[table].Plan).some(node=>node['Index Name']===`${table}_created_id_page_idx`));
      t.diagnostic(JSON.stringify({table,fixture:'50000 equal timestamps; LIMIT 100',before:{scannedRows:beforeRows,timeMs:before[table]['Execution Time'],sharedHits:before[table].Plan['Shared Hit Blocks']},after:{scannedRows:afterRows,timeMs:after[table]['Execution Time'],sharedHits:after[table].Plan['Shared Hit Blocks']}}));
    }
  } finally { await db.close(); }
});

test('guarded quote-index deduplication keeps the unique constraint and refuses a changed definition', async () => {
  const db=await fixture();
  try {
    assert.equal(await value(db,"select to_regclass('public.quotes_code_unique_idx')::text"),null);
    assert.equal(await value(db,"select to_regclass('public.quotes_code_key')::text"),'quotes_code_key');
    const q=await createQuote(db);
    await assert.rejects(db.query('insert into public.quotes(code) values($1)',[q.code]),/duplicate key/);
    await db.exec(paginationMigration);
    await db.exec('create unique index quotes_code_unique_idx on public.quotes(code desc)');
    await assert.rejects(db.exec(paginationMigration),/quote_duplicate_index_review_required/);
    assert.equal(await value(db,"select to_regclass('public.quotes_code_unique_idx')::text"),'quotes_code_unique_idx');
    await assert.rejects(db.query('insert into public.quotes(code) values($1)',[q.code]),/duplicate key/);
    await db.exec('drop index public.quotes_code_unique_idx; create unique index quotes_code_unique_idx on public.quotes(code); alter table public.quotes drop constraint quotes_code_key; create table public.quote_code_test_reference(code text references public.quotes(code)); alter table public.quotes add constraint quotes_code_key unique(code);');
    await assert.rejects(db.exec(paginationMigration),/quote_duplicate_index_review_required/);
    assert.equal(await value(db,"select to_regclass('public.quotes_code_unique_idx')::text"),'quotes_code_unique_idx');
    await db.query('insert into public.quote_code_test_reference(code) values($1)',[q.code]);
    await assert.rejects(db.query('insert into public.quote_code_test_reference(code) values($1)',['QT-NOT-FOUND']),/foreign key/);
  } finally { await db.close(); }
});
