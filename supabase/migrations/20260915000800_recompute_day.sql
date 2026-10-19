-- ============================================================================
-- Cleanify Ops — 08. recompute_day
--
-- Recompute a WHOLE (supervisor, date) at once, never a single job: a
-- single-job recompute cannot see the chain. Cancelling job 2 changes job 3's
-- travel origin, and therefore job 3's deadline.
-- ============================================================================
set search_path = public, extensions;

create or replace function public.recompute_day(p_supervisor uuid, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sup          record;
  v_job          record;
  v_prev_site    extensions.geography := null;
  v_prev_end     timestamptz := null;
  v_prev_start   timestamptz := null;
  v_prev_id      uuid := null;
  v_origin       extensions.geography;
  v_origin_kind  public.travel_source;
  v_travel       int;
  v_provider     text;
  v_policy       text;
  v_default_pol  text;
  v_params       jsonb;
  v_deadline     timestamptz;
  v_reminder     timestamptz;
  v_flags        text[];
  v_i            int := 0;
  v_roster_id    uuid;
  v_first        record;
  v_depart       timestamptz;
  v_state        text;
  v_changed      int := 0;
  v_seed         int;
begin
  if p_supervisor is null or p_date is null then
    return jsonb_build_object('skipped', true);
  end if;

  -- Serialize. Two concurrent reschedules on the same day would otherwise
  -- interleave and leave the chain inconsistent.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_supervisor::text || ':' || p_date::text, 0));

  select * into v_sup from public.profiles where id = p_supervisor;
  if not found then
    return jsonb_build_object('skipped', 'no such supervisor');
  end if;

  select key into v_default_pol from public.checkin_policies where is_default limit 1;

  select j.* into v_first
    from public.jobs j
   where j.assigned_supervisor_id = p_supervisor
     and j.service_date = p_date
     and j.status not in ('CANCELLED','COMPLETED','NO_SHOW')
   order by j.scheduled_start, j.created_at
   limit 1;

  -- ------------------------------------------------------------------ roster
  if v_first.id is null then
    -- Nothing left to do that day. Clear the deadline and retire the alerts
    -- rather than leaving a roster demanding a check-in for no jobs.
    update public.day_rosters
       set first_job_id = null, depart_by = null,
           required_checkin_at = null, reminder_at = null,
           deadline_computed_at = now()
     where supervisor_id = p_supervisor and roster_date = p_date
       and submitted_at is null
     returning id into v_roster_id;

    if v_roster_id is not null then
      perform public.cancel_pending_notifications(null, v_roster_id, 'checkin.');
    end if;

    delete from public.recompute_queue
     where supervisor_id = p_supervisor and service_date = p_date;
    return jsonb_build_object('jobs', 0, 'roster_cleared', v_roster_id is not null);
  end if;

  v_policy := coalesce(
    v_first.checkin_policy_key,
    (select default_policy_key from public.services where id = v_first.service_id),
    v_default_pol);
  select params into v_params from public.checkin_policies where key = v_policy;

  -- Travel from the depot to the first job. The departure time used for a
  -- traffic-aware query is itself a guess, so seed it from the last known
  -- travel time; one pass is enough at this granularity.
  v_seed := coalesce(v_first.travel_minutes, 30);
  if v_first.travel_minutes_override is not null then
    v_travel   := v_first.travel_minutes_override;
    v_provider := 'manual';
  else
    select minutes, provider into v_travel, v_provider
      from public.travel_lookup(
        v_sup.base_location, v_first.site_location,
        v_first.scheduled_start - pg_catalog.make_interval(mins => v_seed));
  end if;

  v_depart   := v_first.scheduled_start - pg_catalog.make_interval(mins => v_travel);
  v_deadline := public.compute_deadline(v_policy, v_first.scheduled_start, v_travel, p_date);
  v_reminder := v_deadline - pg_catalog.make_interval(
                  mins => coalesce((v_params ->> 'reminder_lead_minutes')::int, 15));

  insert into public.day_rosters (
    supervisor_id, roster_date, first_job_id, checkin_policy_key,
    depart_by, required_checkin_at, reminder_at, deadline_computed_at
  )
  values (
    p_supervisor, p_date, v_first.id, v_policy,
    v_depart, v_deadline, v_reminder, now()
  )
  on conflict (supervisor_id, roster_date) do update
    set first_job_id         = excluded.first_job_id,
        checkin_policy_key   = excluded.checkin_policy_key,
        -- a submitted check-in freezes its own deadline; moving it afterwards
        -- would rewrite history the supervisor already acted on
        depart_by            = case when day_rosters.submitted_at is null
                                    then excluded.depart_by
                                    else day_rosters.depart_by end,
        required_checkin_at  = case when day_rosters.submitted_at is null
                                    then excluded.required_checkin_at
                                    else day_rosters.required_checkin_at end,
        reminder_at          = case when day_rosters.submitted_at is null
                                    then excluded.reminder_at
                                    else day_rosters.reminder_at end,
        deadline_computed_at = now()
  returning id into v_roster_id;

  perform public.reconcile_roster_notifications(v_roster_id);

  -- -------------------------------------------------------------- the chain
  for v_job in
    select j.* from public.jobs j
     where j.assigned_supervisor_id = p_supervisor
       and j.service_date = p_date
       and j.status not in ('CANCELLED','COMPLETED','NO_SHOW')
     order by j.scheduled_start, j.created_at
  loop
    v_i := v_i + 1;

    -- Travel origin: the depot for the first job, the PREVIOUS SITE after
    -- that. Chaining from the depot all day would badly understate the gap
    -- between two jobs on opposite sides of the city.
    if v_i = 1 then
      v_origin := v_sup.base_location;
      v_origin_kind := 'base';
      v_prev_id := null;
    else
      v_origin := v_prev_site;
      v_origin_kind := 'previous_job';
    end if;

    if v_job.travel_minutes_override is not null then
      v_travel   := v_job.travel_minutes_override;
      v_provider := 'manual';
    else
      v_seed := coalesce(v_job.travel_minutes, 30);
      select minutes, provider into v_travel, v_provider
        from public.travel_lookup(
          v_origin, v_job.site_location,
          v_job.scheduled_start - pg_catalog.make_interval(mins => v_seed));
    end if;

    v_state := case when v_provider = 'fallback_haversine' then 'failed'
                    when v_provider = 'manual' then 'manual'
                    else 'ok' end;

    -- Flag, never silently "fix". An impossible itinerary is a human problem.
    v_flags := '{}';
    if v_job.scheduled_start < now() and v_job.status = 'ASSIGNED' then
      v_flags := v_flags || 'deadline_in_past';
    end if;
    if v_prev_end is not null
       and (v_job.scheduled_start - pg_catalog.make_interval(mins => v_travel)) < v_prev_end then
      v_flags := v_flags || 'itinerary_conflict';
    end if;
    if v_travel > 120 then
      v_flags := v_flags || 'implausible_travel';
    end if;

    if v_job.required_arrival_at is distinct from v_job.scheduled_start
       or v_job.travel_minutes is distinct from v_travel then
      v_changed := v_changed + 1;
      insert into public.job_events (job_id, event_type, payload)
      values (v_job.id, 'deadline.recomputed', jsonb_build_object(
        'old_travel_minutes', v_job.travel_minutes,
        'new_travel_minutes', v_travel,
        'old_required_arrival_at', v_job.required_arrival_at,
        'new_required_arrival_at', v_job.scheduled_start,
        'origin', v_origin_kind,
        'provider', v_provider,
        'sequence_in_day', v_i));
    end if;

    update public.jobs
       set sequence_in_day       = v_i,
           travel_minutes        = v_travel,
           travel_source         = v_origin_kind,
           travel_origin_job_id  = v_prev_id,
           expected_departure_at = v_job.scheduled_start - pg_catalog.make_interval(mins => v_travel),
           required_arrival_at   = v_job.scheduled_start,
           deadline_computed_at  = now(),
           deadline_state        = v_state,
           itinerary_flags       = v_flags
     -- NB: deliberately does NOT set checkin_policy_key. That column is in the
     -- recompute fan-out trigger's UPDATE OF list, and `UPDATE OF col` fires on
     -- presence in the SET list, not on a changed value — setting it here would
     -- re-enqueue this same recompute forever and bill a Maps call each cycle.
     where id = v_job.id;

    v_prev_site  := v_job.site_location;
    v_prev_start := v_job.scheduled_start;
    v_prev_id    := v_job.id;
    v_prev_end   := coalesce(
                      v_job.actual_end_at,
                      v_job.scheduled_start
                        + pg_catalog.make_interval(mins => v_job.estimated_duration_min));
  end loop;

  delete from public.recompute_queue
   where supervisor_id = p_supervisor and service_date = p_date;

  return jsonb_build_object(
    'jobs', v_i,
    'roster_id', v_roster_id,
    'required_checkin_at', v_deadline,
    'deadlines_changed', v_changed);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- drain_recompute_queue — called by the worker after it has refreshed the
-- travel cache for any legs it was missing.
-- ---------------------------------------------------------------------------
create or replace function public.drain_recompute_queue(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row   record;
  v_done  int := 0;
begin
  for v_row in
    select * from public.recompute_queue
     where due_at <= now()
     order by due_at
     for update skip locked
     limit p_limit
  loop
    perform public.recompute_day(v_row.supervisor_id, v_row.service_date);
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('recomputed', v_done);
end;
$fn$;
