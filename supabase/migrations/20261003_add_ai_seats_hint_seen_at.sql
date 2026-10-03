alter table public.profiles
  add column if not exists ai_seats_hint_seen_at timestamptz;
