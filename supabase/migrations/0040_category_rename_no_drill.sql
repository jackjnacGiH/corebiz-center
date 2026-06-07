-- Category label tweak: "ขัด ตัด เจาะ เจียร" → "ขัด ตัด เจียร" (drop เจาะ).
update public.categories
  set name_th = 'ขัด ตัด เจียร', name_en = 'Abrasives, Cutting & Grinding'
  where slug = 'abrasives';
