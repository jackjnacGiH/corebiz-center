-- Company logo for quotation/bill headers, uploaded via Settings → ข้อมูลธุรกิจ.
alter table public.org_settings add column if not exists logo_url text;
