-- ============================================================================
-- Cleanify Ops — 13. Photo storage and the scheduler
-- ============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Private bucket. Never public: reads go through short-TTL signed URLs minted
-- server-side after an authz check.
--
-- Photo bytes go direct from the phone to Storage via a signed upload URL and
-- never transit a Vercel function — that path has a 4.5 MB body limit and you
-- would be paying for the transfer twice.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('checkin-photos', 'checkin-photos', false, 5242880,
        array['image/jpeg','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A supervisor may write exactly one object: the one his live capture token
-- names. No token, no upload — which is what stops someone POSTing a photo
-- from last week straight past the camera UI.
create policy checkin_photo_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'checkin-photos'
    and exists (
      select 1 from public.capture_tokens t
       where t.user_id = (select auth.uid())
         and t.storage_path = storage.objects.name
         and t.consumed_at is null
         and t.expires_at > now()
    )
  );

-- Reads are server-mediated. No direct client SELECT at all.
create policy checkin_photo_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'checkin-photos' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Scheduler.
--
-- pg_cron, not Vercel Cron: Vercel's Hobby plan caps cron at once per day and
-- even Pro's minutely crons are explicitly best-effort. pg_cron sits next to
-- the data, has no cold start, and costs nothing extra on Supabase.
--
-- The two sweeps below are pure SQL and need no secrets at all. Only the
-- dispatch step has to reach outside the database.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'cleanify-sweep-late',
  '* * * * *',
  $cron$ select public.sweep_late(); $cron$
);

select cron.schedule(
  'cleanify-drain-recompute',
  '* * * * *',
  $cron$ select public.drain_recompute_queue(50); $cron$
);

-- Expire abandoned capture tokens so the storage policy window stays tight.
select cron.schedule(
  'cleanify-expire-capture-tokens',
  '*/10 * * * *',
  $cron$ delete from public.capture_tokens
          where consumed_at is null and expires_at < now() - interval '1 hour'; $cron$
);

-- ---------------------------------------------------------------------------
-- Dispatch. This one needs to call out, so it reads its credentials from
-- Supabase Vault. Until both secrets exist the function is a no-op rather than
-- an error — the database keeps working, nothing is sent, and the staleness of
-- scheduler.last_tick is what tells you something is wrong.
--
--   select vault.create_secret('https://<ref>.supabase.co', 'cleanify_project_url');
--   select vault.create_secret('<service-role-key>',        'cleanify_service_key');
-- ---------------------------------------------------------------------------
create or replace function public.trigger_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'cleanify_project_url';
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'cleanify_service_key';

  if v_url is null or v_key is null then
    return;   -- not configured yet
  end if;

  perform extensions.net_http_post(
    url     := v_url || '/functions/v1/dispatch',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 8000
  );
end;
$fn$;

select cron.schedule(
  'cleanify-dispatch-notifications',
  '* * * * *',
  $cron$ select public.trigger_dispatch(); $cron$
);

-- The 05:30 IST silent heartbeat. By 06:00 an admin knows which devices are
-- actually reachable, instead of discovering it at 07:05 when someone is
-- already late. 00:00 UTC = 05:30 IST.
select cron.schedule(
  'cleanify-push-heartbeat',
  '0 0 * * *',
  $cron$ select public.trigger_dispatch(); $cron$
);

revoke execute on function public.trigger_dispatch() from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- Guard rail: fail loudly if a future migration adds a table without RLS.
-- One forgotten `enable row level security` makes a table readable by any
-- logged-in supervisor with a single curl.
-- ---------------------------------------------------------------------------
create or replace function public.assert_rls_everywhere()
returns table (schema_name text, table_name text)
language sql stable
set search_path = ''
as $fn$
  select n.nspname::text, c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity = false
   order by 2;
$fn$;

comment on function public.assert_rls_everywhere() is
  'CI must fail the build if this returns any row.';
