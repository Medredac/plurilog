-- Preview-only records; no changes to existing application tables or policies.
create table public.preview_google_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null check (app in ('gmail', 'google-drive')),
  version uuid not null,
  encrypted_tokens text not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, app)
);
create table public.preview_google_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null check (app in ('gmail', 'google-drive')),
  browser_hash text not null,
  encrypted_verifier text not null,
  expires_at timestamptz not null
);
create index preview_google_oauth_states_user on public.preview_google_oauth_states(user_id);
create index preview_google_oauth_states_expiry on public.preview_google_oauth_states(expires_at);
create table public.preview_google_action_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  fingerprint text not null,
  encrypted_result text,
  created_at timestamptz not null default now(),
  primary key (user_id, run_id, fingerprint)
);
alter table public.preview_google_connections enable row level security;
alter table public.preview_google_oauth_states enable row level security;
alter table public.preview_google_action_receipts enable row level security;
revoke all on public.preview_google_connections, public.preview_google_oauth_states, public.preview_google_action_receipts from public, anon, authenticated;
grant select, insert, update, delete on public.preview_google_connections, public.preview_google_oauth_states, public.preview_google_action_receipts to service_role;
comment on table public.preview_google_connections is 'Preview-only encrypted Google grants; server service role only. No public policies.';
comment on table public.preview_google_action_receipts is 'Preview-only durable duplicate suppression; result payloads encrypted at application layer.';
