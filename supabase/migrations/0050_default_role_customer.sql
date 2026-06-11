-- =========================================================================
-- 0050_default_role_customer.sql — SECURITY FIX: new signups are customers
-- =========================================================================
-- profiles.role defaulted to 'staff' (0001), so ANY new Google/email signup
-- became back-office staff with full operational access. New accounts must be
-- 'customer' (shop-only); staff roles are granted explicitly by Owner/Admin
-- via the User Management page.
-- =========================================================================

alter table public.profiles alter column role set default 'customer';

-- Recreate the signup trigger with the role set explicitly (belt & braces —
-- doesn't rely on the column default).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, provider, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_app_meta_data->>'provider', 'email'),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
