-- Consolidate to the 3 selling categories. All active products are in
-- 'abrasives' (renamed) so nothing is orphaned. Repurpose two empty categories
-- for the new ones; remove the remaining empty categories (0 products each).
delete from public.categories where slug in ('grinding', 'polishing', 'safety');

update public.categories
  set name_th = 'ขัด ตัด เจาะ เจียร', name_en = 'Abrasives, Cutting & Drilling', sort_order = 10
  where slug = 'abrasives';

update public.categories
  set slug = 'tools', name_th = 'เครื่องมือ Tool', name_en = 'Tools', sort_order = 20
  where slug = 'pneumatic-tools';

update public.categories
  set slug = 'engineering-plastics', name_th = 'พลาสติกวิศวกรรม', name_en = 'Engineering Plastics', sort_order = 30
  where slug = 'cutting';
