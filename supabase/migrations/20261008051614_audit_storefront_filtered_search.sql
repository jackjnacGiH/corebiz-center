-- Audit group 3: structured public catalog search with proven keyword aliases.
-- No brand/model substitutions: explicit models/SKUs/sizes/grits/backings must
-- match. Only matching rows cross the network; pagination remains deterministic.

create or replace function public.storefront_search_normalize(p_text text)
returns text language plpgsql immutable set search_path=public as $$
declare t text := lower(coalesce(p_text,''));
begin
  t := regexp_replace(t,'[“”″]','"','g');
  t := regexp_replace(t,'สก๊อตไบรท์|สก๊อตไบร์ท|scotch\s*-?\s*brite','scotchbrite','g');
  t := regexp_replace(t,'ใย(?:ขัด)?\s*สังเคราะห์|ใยขัด|non[-\s]*woven',' nonwoven ','g');
  t := regexp_replace(t,'ม้วน',' roll ','g');
  t := regexp_replace(t,'(เบอร์|grit)\s*[:=]?\s*#?\s*p?\s*([0-9]{1,5}[a-z]?)',' #\2 ','g');
  t := regexp_replace(t,'(^|[^a-z0-9])p\s*([0-9]{1,5}[a-z]?)(?=$|[^a-z0-9])','\1 #\2 ','g');
  t := regexp_replace(t,'\m([0-9]{1,5}[a-z]?)\s+grit\M',' #\1 ','g');
  t := regexp_replace(t,'\mno(?:[.]|\s+)\s*([0-9]{1,5}[a-z]?)',' #\1 ','g');
  -- Normalize tuple units first, then scalar widths (including mixed-unit rolls).
  t := regexp_replace(t,'[×*]','x','g');
  t := regexp_replace(t,'(^|[^a-z0-9])([0-9]+(?:[.][0-9]+)?(?:\s*x\s*[0-9]+(?:[.][0-9]+)?){1,3})\s*(?:นิ้ว|inch(?:es)?|in\M|")','\1\2inch','g');
  t := regexp_replace(t,'(^|[^a-z0-9])([0-9]+(?:[.][0-9]+)?(?:\s*x\s*[0-9]+(?:[.][0-9]+)?){1,3})\s*(?:มม[.]?|mm\M)','\1\2mm','g');
  t := regexp_replace(t,'(^|[^a-z0-9])([0-9]+(?:[.][0-9]+)?)\s*(?:นิ้ว|inch(?:es)?|in\M|")','\1\2inch','g');
  t := regexp_replace(t,'(^|[^a-z0-9])([0-9]+(?:[.][0-9]+)?)\s*(?:มม[.]?|mm\M)','\1\2mm','g');
  t := regexp_replace(t,'([0-9])\s*(?:เมตร|meters?|m\M)','\1m','g');
  t := regexp_replace(t,'\s*x\s*','x','g');
  t := regexp_replace(t,'(inch|mm|m)[.](?=$|[^a-z])','\1','g');
  t := regexp_replace(t,'([0-9]+)[.]0+(?=inch|mm|m|x|$|\s)','\1','g');
  t := regexp_replace(t,'\msku\s*[:：]?\s*(?=[a-z0-9])',' ','g');
  return trim(regexp_replace(t,'\s+',' ','g'));
end;
$$;

create or replace function public.storefront_product_kinds(p_text text)
returns text[] language sql immutable set search_path=public as $$
  select coalesce(array_agg(kind), '{}'::text[]) from (values
    ('sanding_paper',p_text~*'กระดาษทราย|sand\s*paper|abrasive\s*paper|sanding\s*disc'),
    ('abrasive_cloth',p_text~*'ผ้าทราย|abrasive\s*cloth'),
    ('sanding_belt',p_text~*'(ผ้าทราย.*สายพาน|สายพาน.*ผ้าทราย)|(?:sanding|abrasive)\s*belt'),
    ('sanding_disc',p_text~*'กระดาษทราย(?:\s*กลม|\s*สักหลาด|\s*หลังกาว)|(?:velcro|adhesive)\s*(?:sanding\s*)?disc|sanding\s*disc'),
    ('flap_disc',p_text~*'จานทราย|flap\s*disc'),
    ('nonwoven',p_text~*'ใย(?:ขัด)?\s*สังเคราะห์|ใยขัด|non[-\s]*woven|scotch\s*-?\s*brite|สก๊อตไบรท์|สก๊อตไบร์ท'),
    ('nonwoven_roll',p_text~*'ใย(?:ขัด)?\s*สังเคราะห์|ใยขัด|non[-\s]*woven|scotch\s*-?\s*brite|สก๊อตไบรท์|สก๊อตไบร์ท'
      and p_text~*'ม้วน|\mroll\M' and p_text!~*'ล้อ(?:ขัด|ทราย)|ลูกขัด|แผ่น(?:ใย|ขัด|สก๊อต)|ใบขัด|จานทราย|\mwheel\M'),
    ('nonwoven_wheel',p_text~*'ใย(?:ขัด)?\s*สังเคราะห์|ใยขัด|non[-\s]*woven|scotch\s*-?\s*brite|สก๊อตไบรท์|สก๊อตไบร์ท' and p_text~*'ล้อ|ลูกขัด|\mwheel\M'),
    ('pva_disc',p_text~*'ใบขัดกระจก|pva\s*(?:spongy\s*)?disc')
  ) kinds(kind,matches) where matches;
$$;

create or replace function public.storefront_search_facets(p_text text,p_is_query boolean default false)
returns jsonb language plpgsql immutable set search_path=public as $$
declare t text := public.storefront_search_normalize(p_text); identity_text text;
  kinds text[]; models text[]; sizes text[]; grits text[]; backings text[]; skus text[];
  size_re text := '(^|[^a-z0-9])([0-9]+(?:[.][0-9]+)?(?:(?:inch|mm|m)?x[0-9]+(?:[.][0-9]+)?){1,3}(?:inch|mm|m)|[0-9]+(?:[.][0-9]+)?(?:inch|mm))(?=$|[^a-z0-9])';
  model_re text := '(^|[^a-z0-9])([a-z]{1,6})[\s._/-]*([0-9]{2,}[a-z0-9-]*)(?=$|[^a-z0-9])';
begin
  if p_is_query then
    -- Normalize explicit grit=120 before stripping an order's =4 tail.
    if t!~'(?:เบอร์|grit|ขนาด|size|diameter|width|length|holes?|รู)\s*=\s*[0-9]+\s*$' then
      t := regexp_replace(t,'\s*(?:=|จำนวน|qty|quantity)\s*[0-9]{1,6}\s*(?:ชิ้น|เส้น|ใบ|กล่อง|roll|pcs?)?(?:ครับ|ค่ะ|คะ)?\s*$','');
    end if;
    t := regexp_replace(t,'^(?:(?:ขอ|ต้องการ|อยากได้|ทำ|ทํา|ออก|ส่ง)\s*)?ใบเสนอราคา\s*(?:ค่ะ|คะ|ครับ)?\s*[:：-]?\s*','');
    t := regexp_replace(t,'^(?:(?:ผม|ฉัน|หนู|เรา|ลูกค้า)\s*)?(?:(?:มี|สนใจ|ต้องการ|อยากได้|กำลังหา|ขอ(?:ราคา)?|สอบถาม(?:ราคา)?|รบกวน(?:ช่วย)?|ช่วยหา|หา|สินค้า)\s*)+','');
    t := regexp_replace(t,'\s*(?:จำหน่าย)?(?:มี)?(?:ไหม|มั้ย|หรือเปล่า)?\s*(?:หน่อย)?\s*(?:ครับ|ค่ะ|คะ|นะครับ|นะคะ|นะ)?\s*$','');
    t := regexp_replace(t,'ราคา\s*(?:เท่าไหร่|เท่าไร|กี่บาท)?',' ','g');
    t := regexp_replace(t,'(?:ขนาด|ไซซ์|size)\s*[:=]?\s*',' ','g');
  end if;
  kinds := public.storefront_product_kinds(t);
  select coalesce(array_agg(distinct m[2]),'{}') into sizes from regexp_matches(t,size_re,'g') m;
  select coalesce(array_agg(distinct '#'||m[1]),'{}') into grits from regexp_matches(t,'#\s*([0-9]{1,5}[a-z]?)','g') m;
  identity_text := regexp_replace(t,size_re,'\1 ','g');
  identity_text := regexp_replace(identity_text,'#\s*[0-9]{1,5}[a-z]?',' ','g');
  select coalesce(array_agg(distinct m[1]),'{}') into skus from regexp_matches(identity_text,'\m([0-9]{7,})\M','g') m;
  identity_text := regexp_replace(identity_text,'\m[0-9]{7,}\M',' ','g');
  select coalesce(array_agg(distinct m[2]||regexp_replace(m[3],'[^a-z0-9]','','g')),'{}') into models
    from regexp_matches(identity_text,model_re,'g') m where m[2] not in ('grit','size','sku');
  identity_text := regexp_replace(identity_text,model_re,'\1 ','g');
  select coalesce(array_agg(key),'{}') into backings from (values
    ('velcro',t~*'สักหลาด|velcro|hook\s*(?:and|&)\s*loop'),
    ('adhesive',t~*'หลังกาว|adhesive|\mpsa\M'),
    ('soft',t~*'หลังอ่อน'),('hard',t~*'หลังแข็ง')
  ) b(key,matches) where matches;
  identity_text := regexp_replace(identity_text,'สักหลาด|velcro|hook\s*(?:and|&)\s*loop|หลังกาว|adhesive|\mpsa\M|หลังอ่อน|หลังแข็ง',' ','g');
  if cardinality(kinds)>0 then
    identity_text := regexp_replace(identity_text,'แบบ|กระดาษทราย(?:\s*กลม)?|ผ้าทราย|สายพาน|จานทราย(?:\s*ซ้อน)?|roll|nonwoven|scotchbrite|sanding\s*(?:disc|belt|paper)|abrasive\s*(?:paper|belt|cloth)|flap\s*disc|ใบขัดกระจก|pva\s*(?:spongy\s*)?disc|ล้อ(?:ขัด)?|ลูกขัด|wheel',' ','g');
  end if;
  identity_text := regexp_replace(identity_text,'(?:^|\s)(?:รุ่น|model)\s*[:=]?\s*',' ','g');
  identity_text := trim(regexp_replace(identity_text,'\s+',' ','g'));
  return jsonb_build_object('kinds',kinds,'models',models,'sizes',sizes,'grits',grits,'backings',backings,'skus',skus,
    'identity',identity_text,'tokens',case when identity_text='' then '{}'::text[] else regexp_split_to_array(identity_text,'\s+') end);
end;
$$;

create or replace function public.search_storefront_products(p_query text,p_offset integer default 0,p_limit integer default 1000)
returns setof public.storefront_products
language sql stable security invoker set search_path=public as $$
  with query_facts as materialized (select public.storefront_search_facets(p_query,true) facts where length(trim(p_query)) between 1 and 256),
  requested as materialized (select * from query_facts where facts->'kinds'<>'[]'::jsonb or facts->'models'<>'[]'::jsonb
    or facts->'sizes'<>'[]'::jsonb or facts->'grits'<>'[]'::jsonb or facts->'backings'<>'[]'::jsonb
    or facts->'skus'<>'[]'::jsonb or facts->'tokens'<>'[]'::jsonb),
  candidates as materialized (
    select p.* from public.storefront_products p cross join requested q
    where ((q.facts->'skus')='[]'::jsonb or (q.facts->'skus') @> to_jsonb(array[trim(p.sku)]))
      and to_jsonb(public.storefront_product_kinds(concat_ws(' ',p.name_th,p.name_en,p.category_name_th))) @> (q.facts->'kinds')
      and not exists(select 1 from jsonb_array_elements_text((q.facts->'models')) model
        where position(model in regexp_replace(lower(concat_ws(' ',p.name_th,p.name_en,p.brand)),'[^a-z0-9]','','g'))=0)
      and not exists(select 1 from jsonb_array_elements_text((q.facts->'tokens')) word
        where position(word in lower(concat_ws(' ',p.name_th,p.name_en,p.brand,p.sku,p.group_name,p.category_name_th,array_to_string(p.tags,' '),array_to_string(p.feature_tags,' '))))=0)
  ), computed as materialized (
    select p.id,case when q.facts->'models'='[]'::jsonb and q.facts->'sizes'='[]'::jsonb
      and q.facts->'grits'='[]'::jsonb and q.facts->'backings'='[]'::jsonb
      and q.facts->'skus'='[]'::jsonb and q.facts->'tokens'='[]'::jsonb then q.facts
      -- Group ranges/tags are discovery evidence only, never SKU variant facts.
      -- Otherwise a group '#80-#500' would make its #400 SKU match #500.
      else public.storefront_search_facets(concat_ws(' ',p.name_th,p.name_en,p.sku,p.brand))
        || jsonb_build_object('identity',public.storefront_search_facets(concat_ws(' ',p.name_th,p.name_en,p.sku,p.brand,p.group_name,p.category_name_th,array_to_string(p.tags,' '),array_to_string(p.feature_tags,' ')))->>'identity') end facts
    from candidates p cross join requested q
  )
  select p.* from candidates p join computed c on c.id=p.id cross join requested q
  where (c.facts->'models') @> (q.facts->'models') and (c.facts->'sizes') @> (q.facts->'sizes')
    and (c.facts->'grits') @> (q.facts->'grits') and (c.facts->'backings') @> (q.facts->'backings')
    and (c.facts->'skus') @> (q.facts->'skus')
    and not exists(select 1 from jsonb_array_elements_text((q.facts->'tokens')) word where position(word in (c.facts->>'identity'))=0)
  order by p.is_featured desc,p.name_th,p.id
  offset greatest(0,coalesce(p_offset,0)) limit least(1000,greatest(1,coalesce(p_limit,1000)));
$$;
revoke all on function public.storefront_search_normalize(text),public.storefront_product_kinds(text),public.storefront_search_facets(text,boolean),public.search_storefront_products(text,integer,integer) from public;
grant execute on function public.storefront_search_normalize(text),public.storefront_product_kinds(text),public.storefront_search_facets(text,boolean),public.search_storefront_products(text,integer,integer) to anon,authenticated;
