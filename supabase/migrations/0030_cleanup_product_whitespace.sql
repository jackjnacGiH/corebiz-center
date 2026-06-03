-- Data hygiene: collapse irregular/double spaces in product names and trim
-- stray whitespace from SKUs. Only touches rows that actually need it (≈29).
-- Verified no SKU collisions result from trimming (172 distinct → 172 distinct).
update public.products
set sku     = btrim(sku),
    name_th = btrim(regexp_replace(name_th, '\s+', ' ', 'g')),
    name_en = nullif(btrim(regexp_replace(coalesce(name_en, ''), '\s+', ' ', 'g')), ''),
    brand   = nullif(btrim(regexp_replace(coalesce(brand, ''), '\s+', ' ', 'g')), '')
where sku     is distinct from btrim(sku)
   or name_th is distinct from btrim(regexp_replace(name_th, '\s+', ' ', 'g'))
   or coalesce(name_en, '') is distinct from coalesce(nullif(btrim(regexp_replace(coalesce(name_en, ''), '\s+', ' ', 'g')), ''), '')
   or coalesce(brand, '')   is distinct from coalesce(nullif(btrim(regexp_replace(coalesce(brand, ''), '\s+', ' ', 'g')), ''), '');
