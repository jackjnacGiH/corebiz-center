-- =========================================================================
-- 0066_quote_token_item_unit.sql
-- Add per-item `unit` (and `discount`) to the public quote payload so the
-- public page can render the same line format as the in-system quote document
-- (e.g. "100 ชิ้น" + per-line discount).
-- =========================================================================

create or replace function public.get_quote_by_token(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
  v_seller jsonb;
begin
  if p_token is null then return null; end if;

  select jsonb_build_object(
    'name', coalesce(business_name, ''),
    'tax_id', tax_id,
    'address', address,
    'phone', phone,
    'email', email,
    'website', website,
    'logo_url', logo_url
  ) into v_seller
  from public.org_settings where id = true;

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
        'sku', qi.sku, 'product_name', qi.product_name, 'unit', qi.unit,
        'quantity', qi.quantity, 'unit_price', qi.unit_price,
        'discount', qi.discount, 'total', qi.total) order by qi.id)
      from public.quote_items qi where qi.quote_id = q.id), '[]'::jsonb),
    'subtotal', q.subtotal, 'discount', q.discount, 'vat', q.vat, 'total', q.total,
    'notes', q.notes,
    'seller', v_seller
  )
  into v
  from public.quotes q
  left join public.customers c on c.id = q.customer_id
  where q.public_token = p_token;
  return v;
end;
$$;
revoke execute on function public.get_quote_by_token(uuid) from public;
grant  execute on function public.get_quote_by_token(uuid) to anon, authenticated;
