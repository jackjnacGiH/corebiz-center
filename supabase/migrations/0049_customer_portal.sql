-- =========================================================================
-- 0049_customer_portal.sql — customer self-service portal (shop "บัญชีของฉัน")
-- =========================================================================
-- Logged-in customers (role 'customer') can see THEIR OWN data on the
-- storefront: tier + benefits, company profile, quote & order history.
--
-- Design: NO new broad RLS policies. Everything goes through narrow
-- security-definer RPCs that (a) scope rows to the caller's linked customer
-- (customers.user_id = auth.uid()) and (b) return only safe columns — staff
-- internals like customers.notes / orders.internal_notes are never exposed.
-- =========================================================================

-- Current user's linked customer id (or null).
create or replace function public.my_customer_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.customers where user_id = auth.uid() limit 1;
$$;

-- One-time auto-link: bind the logged-in user to the CRM customer row whose
-- email matches their verified auth email. Links only on an exact, UNIQUE,
-- not-yet-linked match — ambiguous emails are left for staff to link manually.
create or replace function public.link_my_customer_by_email()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_email text; v_id uuid; v_cnt int;
begin
  if auth.uid() is null then return null; end if;
  select id into v_id from public.customers where user_id = auth.uid() limit 1;
  if v_id is not null then return v_id; end if;

  select lower(trim(u.email)) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null or v_email = '' then return null; end if;

  select count(*) into v_cnt
  from public.customers c
  where lower(trim(c.email)) = v_email and c.user_id is null;
  if v_cnt <> 1 then return null; end if;

  update public.customers c
     set user_id = auth.uid()
   where lower(trim(c.email)) = v_email and c.user_id is null
  returning c.id into v_id;
  return v_id;
end;
$$;

-- Profile + tier card for the portal (safe columns only).
create or replace function public.my_customer_profile()
returns table (
  customer_id uuid, code text, name text, customer_type text,
  email text, phone text, tax_id text,
  billing_address jsonb, shipping_address jsonb,
  tier text, tier_label text, discount_percent numeric, point_multiplier numeric,
  loyalty_points int, total_spent numeric, total_orders int
) language sql stable security definer set search_path = public as $$
  select c.id, c.code, c.name, c.customer_type,
         c.email, c.phone, c.tax_id,
         c.billing_address, c.shipping_address,
         c.tier, tb.label, tb.discount_percent, tb.point_multiplier,
         c.loyalty_points, c.total_spent, c.total_orders
  from public.customers c
  join public.tier_benefits tb on tb.tier = c.tier
  where c.user_id = auth.uid()
  limit 1;
$$;

-- Order history (safe columns; no internal_notes).
create or replace function public.my_orders()
returns table (id uuid, code text, status text, payment_status text,
               subtotal numeric, discount numeric, vat numeric, total numeric,
               created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.code, o.status, o.payment_status,
         o.subtotal, o.discount, o.vat, o.total, o.created_at
  from public.orders o
  where o.customer_id = public.my_customer_id()
  order by o.created_at desc
  limit 100;
$$;

create or replace function public.my_order_items(p_order_id uuid)
returns table (sku text, product_name text, quantity int, unit_price numeric, total numeric)
language sql stable security definer set search_path = public as $$
  select oi.sku, oi.product_name, oi.quantity, oi.unit_price, oi.total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.order_id = p_order_id
    and o.customer_id = public.my_customer_id()
  order by oi.created_at;
$$;

-- Quote history.
create or replace function public.my_quotes()
returns table (id uuid, code text, status text,
               subtotal numeric, discount numeric, vat numeric, total numeric,
               valid_until date, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select q.id, q.code, q.status,
         q.subtotal, q.discount, q.vat, q.total, q.valid_until, q.created_at
  from public.quotes q
  where q.customer_id = public.my_customer_id()
  order by q.created_at desc
  limit 100;
$$;

create or replace function public.my_quote_items(p_quote_id uuid)
returns table (sku text, product_name text, quantity int, unit_price numeric, total numeric)
language sql stable security definer set search_path = public as $$
  select qi.sku, qi.product_name, qi.quantity, qi.unit_price, qi.total
  from public.quote_items qi
  join public.quotes q on q.id = qi.quote_id
  where qi.quote_id = p_quote_id
    and q.customer_id = public.my_customer_id()
  order by qi.id;
$$;

-- Portal RPCs are for logged-in users only (anon gets nothing).
revoke execute on function public.my_customer_id() from public, anon;
revoke execute on function public.link_my_customer_by_email() from public, anon;
revoke execute on function public.my_customer_profile() from public, anon;
revoke execute on function public.my_orders() from public, anon;
revoke execute on function public.my_order_items(uuid) from public, anon;
revoke execute on function public.my_quotes() from public, anon;
revoke execute on function public.my_quote_items(uuid) from public, anon;

grant execute on function public.my_customer_id() to authenticated;
grant execute on function public.link_my_customer_by_email() to authenticated;
grant execute on function public.my_customer_profile() to authenticated;
grant execute on function public.my_orders() to authenticated;
grant execute on function public.my_order_items(uuid) to authenticated;
grant execute on function public.my_quotes() to authenticated;
grant execute on function public.my_quote_items(uuid) to authenticated;
