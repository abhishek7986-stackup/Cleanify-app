-- Real travel times from Google Routes, filled into the cache that
-- travel_lookup() already reads. Until now nothing filled travel_estimates, so
-- every leg fell back to a straight-line guess ('fallback_haversine').
--
-- The server (service role) asks travel_legs() which legs of a supervisor's
-- day have no fresh estimate, asks Google for each, stores the answer with
-- store_travel_estimate(), then runs recompute_day(). Cell rounding and the IST
-- weekday/hour come from the same helpers travel_lookup() uses, so a stored
-- answer is always found again.

-- The legs exactly as recompute_day() chains them: depot -> first job, then
-- previous site -> next job. depart_at matches the time recompute_day() looks
-- up (scheduled start minus the travel time it currently holds).
create or replace function public.travel_legs(p_supervisor uuid, p_date date)
returns table (
  job_id       uuid,
  origin_lat   double precision,
  origin_lng   double precision,
  dest_lat     double precision,
  dest_lng     double precision,
  arrive_at    timestamptz,
  seed_minutes int,
  cached       boolean
)
language plpgsql stable
security definer
set search_path = ''
as $fn$
declare
  v_origin extensions.geography;
  v_job    record;
  v_depart timestamptz;
begin
  select base_location into v_origin from public.profiles where id = p_supervisor;

  for v_job in
    select j.id, j.site_location, j.scheduled_start, j.travel_minutes, j.travel_minutes_override
      from public.jobs j
     where j.assigned_supervisor_id = p_supervisor
       and j.service_date = p_date
       and j.status not in ('CANCELLED','COMPLETED','NO_SHOW')
     order by j.scheduled_start, j.created_at
  loop
    if v_origin is not null and v_job.site_location is not null
       and v_job.travel_minutes_override is null then
      v_depart := v_job.scheduled_start
                  - pg_catalog.make_interval(mins => coalesce(v_job.travel_minutes, 30));
      job_id       := v_job.id;
      origin_lat   := extensions.st_y(v_origin::extensions.geometry);
      origin_lng   := extensions.st_x(v_origin::extensions.geometry);
      dest_lat     := extensions.st_y(v_job.site_location::extensions.geometry);
      dest_lng     := extensions.st_x(v_job.site_location::extensions.geometry);
      arrive_at    := v_job.scheduled_start;
      seed_minutes := coalesce(v_job.travel_minutes, 30);
      cached := exists (
        select 1 from public.travel_estimates te
         where te.origin_cell = public.geo_cell(v_origin)
           and te.dest_cell   = public.geo_cell(v_job.site_location)
           and te.dow  = extract(dow  from (v_depart at time zone 'Asia/Kolkata'))::smallint
           and te.depart_hour_bucket = extract(hour from (v_depart at time zone 'Asia/Kolkata'))::smallint
           and te.provider <> 'fallback_haversine'
           and te.expires_at > now());
      return next;
    end if;
    -- The next leg starts where this job is, whatever its override.
    if v_job.site_location is not null then
      v_origin := v_job.site_location;
    end if;
  end loop;
end;
$fn$;

-- Stores one Google answer. It is saved under the departure hour recompute_day
-- will look up now (arrival minus the travel time it holds) AND the hour it
-- will look up next time (arrival minus this new travel time), so the job does
-- not flip back to the straight-line guess on the following recompute.
create or replace function public.store_travel_estimate(
  p_origin_lat  double precision,
  p_origin_lng  double precision,
  p_dest_lat    double precision,
  p_dest_lng    double precision,
  p_arrive_at   timestamptz,
  p_seed_minutes int,
  p_seconds     int,
  p_meters      int,
  p_raw         jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_origin extensions.geography := extensions.st_setsrid(extensions.st_makepoint(p_origin_lng, p_origin_lat), 4326)::extensions.geography;
  v_dest   extensions.geography := extensions.st_setsrid(extensions.st_makepoint(p_dest_lng, p_dest_lat), 4326)::extensions.geography;
  v_mult   numeric := public.setting_num('travel.buffer_multiplier', 1.15);
  v_floor  numeric := public.setting_num('travel.min_minutes', 10);
  v_new    int     := greatest(round((p_seconds / 60.0) * v_mult), v_floor)::int;
  v_depart timestamptz;
begin
  foreach v_depart in array array[
    p_arrive_at - pg_catalog.make_interval(mins => p_seed_minutes),
    p_arrive_at - pg_catalog.make_interval(mins => v_new)
  ] loop
    insert into public.travel_estimates
      (origin_cell, dest_cell, dow, depart_hour_bucket, provider,
       duration_seconds, distance_meters, raw, fetched_at, expires_at)
    values
      (public.geo_cell(v_origin), public.geo_cell(v_dest),
       extract(dow  from (v_depart at time zone 'Asia/Kolkata'))::smallint,
       extract(hour from (v_depart at time zone 'Asia/Kolkata'))::smallint,
       'google_routes', p_seconds, p_meters, p_raw, now(), now() + interval '30 days')
    on conflict (origin_cell, dest_cell, dow, depart_hour_bucket, provider) do update
      set duration_seconds = excluded.duration_seconds,
          distance_meters  = excluded.distance_meters,
          raw              = excluded.raw,
          fetched_at       = excluded.fetched_at,
          expires_at       = excluded.expires_at;
  end loop;
end;
$fn$;

revoke execute on function public.travel_legs(uuid, date) from public, anon, authenticated;
revoke execute on function public.store_travel_estimate(double precision, double precision, double precision, double precision, timestamptz, int, int, int, jsonb) from public, anon, authenticated;
grant execute on function public.travel_legs(uuid, date) to service_role;
grant execute on function public.store_travel_estimate(double precision, double precision, double precision, double precision, timestamptz, int, int, int, jsonb) to service_role;
