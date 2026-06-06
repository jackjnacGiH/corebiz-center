-- Sidebar "Link>>" quick links — staff-managed external bookmarks.
create table if not exists public.quick_links (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.quick_links enable row level security;

drop policy if exists quick_links_staff_all on public.quick_links;
create policy quick_links_staff_all on public.quick_links
  for all to authenticated using (true) with check (true);
