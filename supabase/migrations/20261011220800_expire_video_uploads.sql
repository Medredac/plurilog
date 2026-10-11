-- Video-only cleanup for the preview feature. No document/message rows are removed.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create schema if not exists video_cleanup_private;
revoke all on schema video_cleanup_private from public, anon, authenticated;
grant usage on schema video_cleanup_private to service_role;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'video_cleanup_token') then
    perform vault.create_secret(gen_random_uuid()::text || gen_random_uuid()::text, 'video_cleanup_token');
  end if;
end $$;

create function video_cleanup_private.expired_paths(p_token text)
returns text[] language plpgsql security definer set search_path = '' as $$
begin
  -- Only the internal worker can call this; it also supplies the cron secret.
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' or p_token is null or
     not exists (select 1 from vault.decrypted_secrets where name = 'video_cleanup_token' and decrypted_secret = p_token) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  return array(select o.name from storage.objects o
    where o.bucket_id = 'message-images'
      and o.name ~* '^[0-9a-f-]{36}/video-ephemeral-v1/[^/]+\.(mp4|mov|webm)$'
      and o.created_at <= now() - interval '1 hour'
    order by o.created_at limit 500);
end $$;
revoke all on function video_cleanup_private.expired_paths(text) from public, anon, authenticated;
grant execute on function video_cleanup_private.expired_paths(text) to service_role;

create function public.expired_video_upload_paths(p_token text)
returns text[] language sql security invoker set search_path = '' as $$
  select video_cleanup_private.expired_paths(p_token);
$$;
revoke all on function public.expired_video_upload_paths(text) from public, anon, authenticated;
grant execute on function public.expired_video_upload_paths(text) to service_role;

select cron.schedule('expire-preview-video-uploads', '* * * * *', $cron$
  select net.http_post(
    url := 'https://qhqiwyuezvmpcqpmoacs.supabase.co/functions/v1/expire-video-uploads',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-video-cleanup-token', (select decrypted_secret from vault.decrypted_secrets where name = 'video_cleanup_token')),
    body := '{}'::jsonb, timeout_milliseconds := 30000
  );
$cron$);
