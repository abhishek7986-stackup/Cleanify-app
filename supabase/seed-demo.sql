-- ============================================================================
-- Cleanify Ops — DEMO DATA (not a migration; run by hand when you want it)
--
--   Run AFTER `npm run seed:users`, in Supabase → SQL Editor.
--
-- Creates two clients and three jobs for tomorrow and the day after, so there
-- is something on every screen: a chained two-job day for the supervisor (which
-- exercises travel chaining from the previous site rather than the depot), and
-- one solar job to prove the dynamic schema renders a completely different
-- field set with no code change.
--
-- Safe to re-run: it removes its own demo rows first.
-- ============================================================================
set search_path = public, extensions;

do $demo$
declare
  v_rep       uuid;
  v_sup       uuid;
  v_water     uuid;
  v_solar     uuid;
  v_w_job_sch uuid;
  v_w_itm_sch uuid;
  v_s_job_sch uuid;
  v_s_itm_sch uuid;
  v_client_a  uuid;
  v_client_b  uuid;
  v_job       uuid;
  v_tomorrow  date;
  v_job1_at   timestamptz;
  v_job2_at   timestamptz;
begin
  select id into v_rep from auth.users where email ilike 'priya@%';
  select id into v_sup from auth.users where email ilike 'ravi@%';

  if v_rep is null or v_sup is null then
    raise exception 'Run `npm run seed:users` first — priya and ravi must exist.';
  end if;

  v_tomorrow := (now() at time zone 'Asia/Kolkata')::date + 1;

  -- Put the first two jobs a few hours out rather than on a fixed clock time,
  -- so the Today screen has a live countdown the moment you sign in instead of
  -- an empty day.
  v_job1_at := date_trunc('hour', now()) + interval '3 hours';
  v_job2_at := date_trunc('hour', now()) + interval '6 hours';

  select id into v_water from public.services where key = 'water_tank_cleaning';
  select id into v_solar from public.services where key = 'solar_panel_cleaning';

  select id into v_w_job_sch from public.service_field_schemas
   where service_id = v_water and scope = 'job' and status = 'published';
  select id into v_w_itm_sch from public.service_field_schemas
   where service_id = v_water and scope = 'line_item' and status = 'published';
  select id into v_s_job_sch from public.service_field_schemas
   where service_id = v_solar and scope = 'job' and status = 'published';
  select id into v_s_itm_sch from public.service_field_schemas
   where service_id = v_solar and scope = 'line_item' and status = 'published';

  -- clear previous demo rows (cascades to line items, photos, events)
  delete from public.jobs
   where client_id in (select id from public.clients where notes = 'DEMO DATA');
  delete from public.clients where notes = 'DEMO DATA';

  -- ----------------------------------------------------------------- clients
  insert into public.clients (name, phone, address_line, landmark, locality, city,
                              pincode, location, notes, created_by)
  values ('Sai Residency (Demo)', '+919812345678',
          'Plot 42, Sai Residency Apartments', 'Opposite the water tank',
          'Kondapur', 'Hyderabad', '500084',
          st_setsrid(st_makepoint(78.3600, 17.4620), 4326)::geography,
          'DEMO DATA', v_rep)
  returning id into v_client_a;

  insert into public.clients (name, phone, address_line, landmark, locality, city,
                              pincode, location, notes, created_by)
  values ('Green Meadows Society (Demo)', '+919887654321',
          'Block C, Green Meadows', 'Next to the community hall',
          'Gachibowli', 'Hyderabad', '500032',
          st_setsrid(st_makepoint(78.3480, 17.4400), 4326)::geography,
          'DEMO DATA', v_rep)
  returning id into v_client_b;

  -- ------------------------------------------------- job 1: three tanks, 9am
  insert into public.jobs (
    client_id, service_id, job_field_schema_id, line_item_schema_id,
    service_details, site_location, site_address, site_landmark,
    scheduled_start, estimated_duration_min,
    assigned_supervisor_id, created_by_sales_rep_id,
    checkin_policy_key, quoted_amount, status, internal_notes)
  values (
    v_client_a, v_water, v_w_job_sch, v_w_itm_sch,
    jsonb_build_object(
      'water_source_available', true,
      'access_notes', 'Terrace access via the back stairs. Watchman has the key.',
      'extra_notes', 'Secretary wants a call 30 minutes before arrival.'),
    st_setsrid(st_makepoint(78.3600, 17.4620), 4326)::geography,
    'Plot 42, Sai Residency Apartments, Kondapur', 'Opposite the water tank',
    v_job1_at, 120,
    v_sup, v_rep, 'once_per_day_base', 4500.00, 'ASSIGNED',
    'Repeat customer — third clean this year.')
  returning id into v_job;

  insert into public.job_line_items (job_id, position, schema_id, label, details) values
  (v_job, 1, v_w_itm_sch, 'Tank 1 (terrace)',
   '{"capacity_litres": 5000, "tank_type": "concrete", "location_on_site": "overhead",
     "notes": "Heavy sediment last time."}'::jsonb),
  (v_job, 2, v_w_itm_sch, 'Tank 2 (terrace)',
   '{"capacity_litres": 2000, "tank_type": "synthetic", "location_on_site": "overhead"}'::jsonb),
  (v_job, 3, v_w_itm_sch, 'Tank 3 (sump)',
   '{"capacity_litres": 10000, "tank_type": "concrete", "location_on_site": "underground",
     "notes": "Ladder required. Confined space — two people minimum."}'::jsonb);

  -- ------------------------- job 2: same day, chains from job 1's site, 1pm
  insert into public.jobs (
    client_id, service_id, job_field_schema_id, line_item_schema_id,
    service_details, site_location, site_address,
    scheduled_start, estimated_duration_min,
    assigned_supervisor_id, created_by_sales_rep_id,
    checkin_policy_key, quoted_amount, status)
  values (
    v_client_b, v_water, v_w_job_sch, v_w_itm_sch,
    '{"water_source_available": false,
      "access_notes": "Bring your own water. Borewell is dry."}'::jsonb,
    st_setsrid(st_makepoint(78.3480, 17.4400), 4326)::geography,
    'Block C, Green Meadows, Gachibowli',
    v_job2_at, 90,
    v_sup, v_rep, 'once_per_day_base', 2800.00, 'ASSIGNED')
  returning id into v_job;

  insert into public.job_line_items (job_id, position, schema_id, label, details) values
  (v_job, 1, v_w_itm_sch, 'Tank 1',
   '{"capacity_litres": 3000, "tank_type": "synthetic", "location_on_site": "overhead"}'::jsonb),
  (v_job, 2, v_w_itm_sch, 'Tank 2',
   '{"capacity_litres": 3000, "tank_type": "synthetic", "location_on_site": "overhead"}'::jsonb);

  -- ------------------- job 3: solar, day after — a different field set entirely
  insert into public.jobs (
    client_id, service_id, job_field_schema_id, line_item_schema_id,
    service_details, site_location, site_address,
    scheduled_start, estimated_duration_min,
    assigned_supervisor_id, created_by_sales_rep_id,
    checkin_policy_key, quoted_amount, status)
  values (
    v_client_b, v_solar, v_s_job_sch, v_s_itm_sch,
    '{"roof_access": "ladder", "water_source_available": true,
      "extra_notes": "Panels were last cleaned six months ago."}'::jsonb,
    st_setsrid(st_makepoint(78.3480, 17.4400), 4326)::geography,
    'Block C, Green Meadows, Gachibowli',
    (((v_tomorrow + 1) + time '08:30') at time zone 'Asia/Kolkata'), 60,
    v_sup, v_rep, 'once_per_day_base', 3200.00, 'ASSIGNED')
  returning id into v_job;

  insert into public.job_line_items (job_id, position, schema_id, label, details) values
  (v_job, 1, v_s_itm_sch, 'Array A (east roof)',
   '{"panel_count": 24, "mounting": "rooftop", "height_m": 9}'::jsonb),
  (v_job, 2, v_s_itm_sch, 'Array B (west roof)',
   '{"panel_count": 18, "mounting": "rooftop", "height_m": 9}'::jsonb);

  raise notice 'Demo jobs at %, % and tomorrow 08:30 IST',
    to_char(v_job1_at at time zone 'Asia/Kolkata', 'Mon DD HH24:MI'),
    to_char(v_job2_at at time zone 'Asia/Kolkata', 'Mon DD HH24:MI');
end
$demo$;

-- The inserts above fire the recompute fan-out trigger, which queues the
-- affected days. pg_cron drains that queue every minute; this just does it now
-- so the deadlines are visible immediately.
select public.drain_recompute_queue(50);

select j.job_number,
       j.service_date,
       j.sequence_in_day                              as seq,
       to_char(j.scheduled_start at time zone 'Asia/Kolkata', 'HH24:MI') as starts_ist,
       j.travel_minutes,
       j.travel_source,
       j.deadline_state,
       to_char(r.required_checkin_at at time zone 'Asia/Kolkata', 'HH24:MI') as checkin_by_ist
  from public.jobs j
  left join public.day_rosters r
    on r.supervisor_id = j.assigned_supervisor_id and r.roster_date = j.service_date
 where j.client_id in (select id from public.clients where notes = 'DEMO DATA')
 order by j.service_date, j.sequence_in_day;
