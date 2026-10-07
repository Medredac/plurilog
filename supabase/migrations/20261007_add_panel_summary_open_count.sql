alter table public.profiles
  add column if not exists panel_summary_open_count bigint not null default 0;

create or replace function public.increment_panel_summary_open_count(target_user_id uuid)
returns bigint
language sql
security invoker
set search_path = public
as $$
  update public.profiles
  set panel_summary_open_count = panel_summary_open_count + 1
  where id = target_user_id
  returning panel_summary_open_count;
$$;

revoke all on function public.increment_panel_summary_open_count(uuid)
  from public, anon, authenticated;

grant execute on function public.increment_panel_summary_open_count(uuid)
  to service_role;
