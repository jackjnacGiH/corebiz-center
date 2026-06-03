-- SECURITY FIX.
-- (1) get_active_line_channel() returns the LINE channel access token + secret
--     and was executable by anon/public (the anon key is shipped in the public
--     frontend JS, so this exposed the credentials to the whole internet).
--     Restrict to service_role only (edge functions). The frontend never calls it.
--     NOTE: the LINE channel access token + secret must be rotated in the LINE
--     Developers console — they may have been captured while exposed.
revoke execute on function public.get_active_line_channel() from public;
revoke execute on function public.get_active_line_channel() from anon;
revoke execute on function public.get_active_line_channel() from authenticated;
grant  execute on function public.get_active_line_channel() to service_role;

-- (2) Defense-in-depth: these staff RPCs are is_staff()-gated (so anon already
--     got 'forbidden'), but EXECUTE was granted to PUBLIC by default. Ensure the
--     explicit authenticated grant exists, then revoke anon + public.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'adjust_loyalty_points','redeem_loyalty_points','issue_coupon','grant_purchase_points',
        'apply_customer_tier','crm_dashboard_stats','create_referral','get_or_create_referral_code',
        'link_referral_customer','reward_referral','create_survey'
      )
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('revoke execute on function %s from public', r.sig);
  end loop;
end $$;
