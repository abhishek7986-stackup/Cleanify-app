-- ============================================================================
-- Cleanify Ops — 06. Travel estimates and the deadline engine
-- ============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- travel_estimates — the cache that keeps the Maps bill near zero.
-- Same supervisor, same route, same weekday, same hour = one API call per TTL
-- window. This also makes recomputation cheap enough to run on every edit.
-- ---------------------------------------------------------------------------
create table public.travel_estimates (
  id                 uuid primary key default gen_random_uuid(),
  origin_cell        text not null,     -- lat/lng rounded to ~110 m
  dest_cell          text not null,
  dow                smallint not null check (dow between 0 and 6),   -- IST
  depart_hour_bucket smallint not null check (depart_hour_bucket between 0 and 23),
  provider           text not null,     -- google_routes | mappls | fallback_haversine | manual
  duration_seconds   int not null check (duration_seconds >= 0),
  distance_meters    int,
  raw                jsonb,
  fetched_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  unique (origin_cell, dest_cell, dow, depart_hour_bucket, provider)
);

-- expires_at is part of the KEY rather than a WHERE predicate: now() is only
-- STABLE, and Postgres refuses a non-IMMUTABLE function in an index predicate.
-- Carrying the column in the index still lets the freshness check on lookup be
-- answered from the index.
create index travel_estimates_lookup_idx
  on public.travel_estimates (origin_cell, dest_cell, dow, depart_hour_bucket, expires_at);

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create or replace function public.get_setting(p_key text, p_default jsonb default null)
returns jsonb
language sql stable
set search_path = ''
as $fn$
  select coalesce((select value from public.app_settings where key = p_key), p_default)
$fn$;

create or replace function public.setting_num(p_key text, p_default numeric)
returns numeric
language sql stable
set search_path = ''
as $fn$
  select coalesce((public.get_setting(p_key) #>> '{}')::numeric, p_default)
$fn$;

-- Bucket a point to roughly 110 m so nearby pickups share a cache entry.
create or replace function public.geo_cell(p geography)
returns text
language sql immutable
set search_path = ''
as $fn$
  select case when p is null then null else
    round(extensions.st_y(p::extensions.geometry)::numeric, 3)::text || ',' ||
    round(extensions.st_x(p::extensions.geometry)::numeric, 3)::text
  end
$fn$;

-- ---------------------------------------------------------------------------
-- travel_lookup — read-through cache with an honest fallback.
-- Returns minutes and the provider that supplied them. A caller that sees
-- 'fallback_haversine' must mark the job deadline_state = 'failed' so it lands
-- on the admin attention list rather than quietly producing a fictional ETA.
-- ---------------------------------------------------------------------------
create or replace function public.travel_lookup(
  p_origin    geography,
  p_dest      geography,
  p_depart_at timestamptz
)
returns table (minutes int, provider text)
language plpgsql stable
set search_path = ''
as $fn$
declare
  v_dow    smallint;
  v_hour   smallint;
  v_hit    record;
  v_meters numeric;
  v_mult   numeric := public.setting_num('travel.buffer_multiplier', 1.15);
  v_floor  numeric := public.setting_num('travel.min_minutes', 10);
begin
  if p_origin is null or p_dest is null then
    return query select 0, 'none'::text;
    return;
  end if;

  v_dow  := extract(dow  from (p_depart_at at time zone 'Asia/Kolkata'))::smallint;
  v_hour := extract(hour from (p_depart_at at time zone 'Asia/Kolkata'))::smallint;

  select te.duration_seconds, te.provider into v_hit
    from public.travel_estimates te
   where te.origin_cell = public.geo_cell(p_origin)
     and te.dest_cell   = public.geo_cell(p_dest)
     and te.dow = v_dow
     and te.depart_hour_bucket = v_hour
     and te.expires_at > now()
   order by te.fetched_at desc
   limit 1;

  if found then
    return query select
      greatest(round((v_hit.duration_seconds / 60.0) * v_mult), v_floor)::int,
      v_hit.provider;
    return;
  end if;

  -- No cached estimate. Great-circle distance at an urban-India average.
  -- Deliberately crude: it keeps the app working, and the 'fallback_haversine'
  -- provider tells the caller not to trust it.
  v_meters := extensions.st_distance(p_origin, p_dest);
  return query select
    greatest(round((v_meters / 6.111) / 60.0 * v_mult), v_floor)::int,
    'fallback_haversine'::text;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- compute_deadline — THE deadline function.
--
-- This arithmetic exists in exactly one place. Every consumer (the UI
-- countdown, the notification enqueue, the late sweep) reads the stored
-- result instead of recomputing it. That is what makes swapping the check-in
-- policy a config change rather than a three-day bug hunt.
-- ---------------------------------------------------------------------------
create or replace function public.compute_deadline(
  p_policy_key      text,
  p_scheduled_start timestamptz,
  p_travel_minutes  int,
  p_service_date    date
)
returns timestamptz
language plpgsql stable
set search_path = ''
as $fn$
declare
  v_params jsonb;
  v_lead   int;
begin
  select params into v_params from public.checkin_policies where key = p_policy_key;
  if v_params is null then
    raise exception 'Unknown check-in policy "%"', p_policy_key;
  end if;

  v_lead := coalesce((v_params ->> 'lead_minutes')::int, 30);

  -- fixed wall-clock policy ignores both travel and the scheduled start
  if coalesce(v_params ->> 'clock_time', '') <> '' then
    return ((p_service_date + (v_params ->> 'clock_time')::time)
              at time zone 'Asia/Kolkata');
  end if;

  return p_scheduled_start
       - (case when coalesce((v_params ->> 'include_travel')::boolean, false)
               then make_interval(mins => coalesce(p_travel_minutes, 0))
               else interval '0' end)
       - make_interval(mins => v_lead);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- enqueue_recompute — coalescing. A rep tweaking a time three times in ten
-- seconds must produce ONE recompute, not three fans-out of Maps lookups.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_recompute(p_supervisor uuid, p_date date)
returns void
language sql
set search_path = ''
as $fn$
  insert into public.recompute_queue (supervisor_id, service_date, due_at)
  select p_supervisor, p_date, now() + interval '5 seconds'
   where p_supervisor is not null and p_date is not null
  on conflict (supervisor_id, service_date)
  do update set due_at = least(recompute_queue.due_at, excluded.due_at),
                attempts = 0;
$fn$;

-- Fan-out on every change that can move a deadline. Cancelling or reassigning
-- a job moves the NEXT job's origin, so the whole day must be revisited — and
-- a reschedule touches two days, not one.
create or replace function public.jobs_enqueue_recompute()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    perform public.enqueue_recompute(new.assigned_supervisor_id, new.service_date);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.enqueue_recompute(old.assigned_supervisor_id, old.service_date);
    return old;
  end if;

  perform public.enqueue_recompute(new.assigned_supervisor_id, new.service_date);

  if old.assigned_supervisor_id is distinct from new.assigned_supervisor_id
     or old.service_date is distinct from new.service_date then
    perform public.enqueue_recompute(old.assigned_supervisor_id, old.service_date);
  end if;

  return new;
end;
$fn$;

create trigger jobs_recompute_fanout
  after insert or delete or update of
    assigned_supervisor_id, scheduled_start, site_location,
    estimated_duration_min, status, travel_minutes_override, checkin_policy_key
  on public.jobs
  for each row execute function public.jobs_enqueue_recompute();
