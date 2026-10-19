-- Production signup defaults remain unchanged. Only the designated preview
-- calls this service-only function for a newly created account's first visit.
alter table public.profiles add column if not exists preview_credits_initialized_at timestamptz;
create or replace function public.initialize_preview_credits(p_user_id uuid, p_cutoff timestamptz)
returns void language sql security definer set search_path = '' as $$
  update public.profiles p set
    credits_cents = case when p.plan = 'free' then 0 else p.credits_cents end,
    remaining_cents = case when p.plan = 'free' then 0 else p.remaining_cents end,
    preview_credits_initialized_at = now()
  where p.id = p_user_id and p.preview_credits_initialized_at is null
    and exists (select 1 from auth.users u where u.id = p.id and u.created_at >= p_cutoff);
$$;
revoke all on function public.initialize_preview_credits(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.initialize_preview_credits(uuid,timestamptz) to service_role;
