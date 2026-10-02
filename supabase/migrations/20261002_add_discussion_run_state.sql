create table if not exists public.discussion_run_state (
  discussion_id uuid primary key references public.discussions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  active_run_id uuid not null,
  active_started_at bigint not null,
  status text not null default 'active'
    check (status in ('active','cancelled','completed')),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz
);

alter table public.discussion_run_state enable row level security;

create or replace function public.claim_debate_run(
  p_discussion_id uuid,
  p_user_id uuid,
  p_run_id uuid,
  p_started_at bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  insert into public.discussion_run_state (
    discussion_id,
    user_id,
    active_run_id,
    active_started_at,
    status,
    updated_at,
    cancelled_at,
    completed_at
  )
  values (
    p_discussion_id,
    p_user_id,
    p_run_id,
    p_started_at,
    'active',
    now(),
    null,
    null
  )
  on conflict (discussion_id) do update
  set
    user_id = excluded.user_id,
    active_run_id = excluded.active_run_id,
    active_started_at = excluded.active_started_at,
    status = 'active',
    updated_at = now(),
    cancelled_at = null,
    completed_at = null
  where
    public.discussion_run_state.user_id = excluded.user_id
    and public.discussion_run_state.active_started_at < excluded.active_started_at;

  select exists (
    select 1
    from public.discussion_run_state
    where discussion_id = p_discussion_id
      and user_id = p_user_id
      and active_run_id = p_run_id
      and active_started_at = p_started_at
      and status = 'active'
  )
  into v_claimed;

  return v_claimed;
end;
$$;

revoke all on function public.claim_debate_run(uuid, uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.claim_debate_run(uuid, uuid, uuid, bigint)
  to service_role;

create or replace function public.cancel_debate_run(
  p_discussion_id uuid,
  p_user_id uuid,
  p_run_id uuid,
  p_started_at bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancelled boolean;
begin
  insert into public.discussion_run_state (
    discussion_id,
    user_id,
    active_run_id,
    active_started_at,
    status,
    updated_at,
    cancelled_at,
    completed_at
  )
  values (
    p_discussion_id,
    p_user_id,
    p_run_id,
    p_started_at,
    'cancelled',
    now(),
    now(),
    null
  )
  on conflict (discussion_id) do update
  set
    user_id = excluded.user_id,
    active_run_id = excluded.active_run_id,
    active_started_at = excluded.active_started_at,
    status = 'cancelled',
    updated_at = now(),
    cancelled_at = now(),
    completed_at = null
  where
    public.discussion_run_state.user_id = excluded.user_id
    and (
      public.discussion_run_state.active_started_at < excluded.active_started_at
      or (
        public.discussion_run_state.active_started_at = excluded.active_started_at
        and public.discussion_run_state.active_run_id = excluded.active_run_id
      )
    );

  select exists (
    select 1
    from public.discussion_run_state
    where discussion_id = p_discussion_id
      and user_id = p_user_id
      and active_run_id = p_run_id
      and active_started_at = p_started_at
      and status = 'cancelled'
  )
  into v_cancelled;

  return v_cancelled;
end;
$$;

revoke all on function public.cancel_debate_run(uuid, uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.cancel_debate_run(uuid, uuid, uuid, bigint)
  to service_role;

create index if not exists discussion_run_state_user_idx
  on public.discussion_run_state(user_id, updated_at desc);
