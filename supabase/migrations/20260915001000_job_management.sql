-- ============================================================================
-- Cleanify Ops — 10. Job creation, rescheduling, cancellation
-- ============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- create_job — one transaction: client, job, pinned schema versions, units.
--
-- Pinning the schema version here is the whole reason this is an RPC and not
-- a plain insert: the job must render and validate against the schema as it
-- stood today, forever, even after an admin republishes the service in June.
-- ---------------------------------------------------------------------------
create or replace function public.create_job(p_payload jsonb)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_role      public.user_role := public.app_role();
  v_client_id uuid;
  v_service   public.services;
  v_job_sch   uuid;
  v_item_sch  uuid;
  v_job       public.jobs;
  v_item      jsonb;
  v_pos       int := 0;
  v_site      extensions.geography;
  v_start     timestamptz;
begin
  if not (v_role in ('sales_rep','admin')) then
    raise exception 'Only a sales rep or admin can create a job'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_service from public.services
   where id = (p_payload ->> 'service_id')::uuid and is_active;
  if not found then
    raise exception 'Unknown or inactive service' using errcode = 'no_data_found';
  end if;

  -- pin the currently published schema versions
  select id into v_job_sch from public.service_field_schemas
   where service_id = v_service.id and scope = 'job' and status = 'published';
  if v_job_sch is null then
    raise exception 'Service "%" has no published job schema', v_service.name
      using errcode = 'no_data_found';
  end if;

  if v_service.has_line_items then
    select id into v_item_sch from public.service_field_schemas
     where service_id = v_service.id and scope = 'line_item' and status = 'published';
    if v_item_sch is null then
      raise exception 'Service "%" has no published item schema', v_service.name
        using errcode = 'no_data_found';
    end if;
  end if;

  -- ----------------------------------------------------------------- client
  if (p_payload ? 'client_id') and (p_payload ->> 'client_id') is not null then
    v_client_id := (p_payload ->> 'client_id')::uuid;
  else
    insert into public.clients (
      name, phone, alt_phone, address_line, landmark, locality, city, pincode,
      location, location_source, google_place_id, notes, created_by
    )
    select
      p_payload -> 'client' ->> 'name',
      p_payload -> 'client' ->> 'phone',
      p_payload -> 'client' ->> 'alt_phone',
      p_payload -> 'client' ->> 'address_line',
      p_payload -> 'client' ->> 'landmark',
      p_payload -> 'client' ->> 'locality',
      p_payload -> 'client' ->> 'city',
      p_payload -> 'client' ->> 'pincode',
      extensions.st_setsrid(extensions.st_makepoint(
        (p_payload -> 'site' ->> 'lng')::double precision,
        (p_payload -> 'site' ->> 'lat')::double precision), 4326)::extensions.geography,
      coalesce(p_payload -> 'client' ->> 'location_source', 'map_pin'),
      p_payload -> 'client' ->> 'google_place_id',
      p_payload -> 'client' ->> 'notes',
      v_uid
    returning id into v_client_id;
  end if;

  -- ------------------------------------------------------------------- site
  -- A map pin is mandatory. Free-text Indian addresses do not geocode
  -- reliably, and the pin is what the supervisor actually navigates to.
  if (p_payload -> 'site' ->> 'lat') is null or (p_payload -> 'site' ->> 'lng') is null then
    raise exception 'A map pin is required' using errcode = 'check_violation';
  end if;

  v_site := extensions.st_setsrid(extensions.st_makepoint(
              (p_payload -> 'site' ->> 'lng')::double precision,
              (p_payload -> 'site' ->> 'lat')::double precision), 4326)::extensions.geography;
  v_start := (p_payload ->> 'scheduled_start')::timestamptz;

  insert into public.jobs (
    client_id, service_id, job_field_schema_id, line_item_schema_id,
    service_details, site_location, site_address, site_landmark,
    scheduled_start, estimated_duration_min,
    assigned_supervisor_id, created_by_sales_rep_id,
    checkin_policy_key, quoted_amount, internal_notes,
    status
  )
  values (
    v_client_id, v_service.id, v_job_sch, v_item_sch,
    coalesce(p_payload -> 'service_details', '{}'::jsonb),
    v_site,
    p_payload -> 'site' ->> 'address',
    p_payload -> 'site' ->> 'landmark',
    v_start,
    coalesce((p_payload ->> 'estimated_duration_min')::int, v_service.default_duration_min),
    nullif(p_payload ->> 'supervisor_id', '')::uuid,
    v_uid,
    coalesce(v_service.default_policy_key,
             (select key from public.checkin_policies where is_default limit 1)),
    nullif(p_payload ->> 'quoted_amount', '')::numeric,
    p_payload ->> 'internal_notes',
    case when nullif(p_payload ->> 'supervisor_id', '') is null then 'DRAFT' else 'ASSIGNED' end::public.job_status
  )
  returning * into v_job;

  -- -------------------------------------------------------------- the units
  -- The NUMBER of tanks is the count of these rows, never a field.
  if v_service.has_line_items then
    for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'line_items', '[]'::jsonb))
    loop
      v_pos := v_pos + 1;
      insert into public.job_line_items (job_id, position, schema_id, label, details)
      values (v_job.id, v_pos, v_item_sch,
              coalesce(v_item ->> 'label', v_service.line_item_singular || ' ' || v_pos),
              coalesce(v_item -> 'details', '{}'::jsonb));
    end loop;

    if v_pos = 0 then
      raise exception 'At least one % is required', lower(v_service.line_item_singular)
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, to_status, payload)
  values (v_job.id, v_uid, v_role, 'job.created', v_job.status,
          jsonb_build_object('service', v_service.key, 'units', v_pos));

  return v_job;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- reschedule_job
--
-- A rescheduled job is NOT a distinct status — it stays ASSIGNED so it cannot
-- quietly vanish from the day timetable. Both the old and the new day are
-- re-chained, because removing a job from a day moves the next job's origin.
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_job(
  p_job_id        uuid,
  p_new_start     timestamptz,
  p_reason_id     uuid,
  p_reason_note   text default null,
  p_new_supervisor uuid default null,
  p_client_informed boolean default false
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_role  public.user_role := public.app_role();
  v_job   public.jobs;
  v_old   public.jobs;
  v_reason public.reasons;
begin
  if not (v_role in ('sales_rep','admin')) then
    raise exception 'Only a sales rep or admin can reschedule' using errcode = 'insufficient_privilege';
  end if;

  select * into v_old from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job not found' using errcode = 'no_data_found';
  end if;
  if v_old.status in ('COMPLETED','CANCELLED') then
    raise exception 'Cannot reschedule a % job', v_old.status using errcode = 'check_violation';
  end if;

  select * into v_reason from public.reasons where id = p_reason_id and category = 'reschedule';
  if not found then
    raise exception 'A valid reschedule reason is required' using errcode = 'check_violation';
  end if;
  if v_reason.requires_note and coalesce(trim(p_reason_note), '') = '' then
    raise exception 'Reason "%" requires a note', v_reason.label using errcode = 'check_violation';
  end if;

  update public.jobs
     set scheduled_start = p_new_start,
         assigned_supervisor_id = coalesce(p_new_supervisor, assigned_supervisor_id),
         status = case when status = 'DRAFT' then 'DRAFT' else 'ASSIGNED' end::public.job_status,
         reschedule_count = reschedule_count + 1,
         -- the new day starts clean: no stale lateness, no stale deadline
         is_late = false, late_marked_at = null, late_blameless = false,
         deadline_state = 'pending'
   where id = p_job_id
   returning * into v_job;

  insert into public.job_reschedules (
    job_id, from_start, to_start, from_supervisor_id, to_supervisor_id,
    reason_id, reason_note, requested_by, client_informed)
  values (p_job_id, v_old.scheduled_start, p_new_start,
          v_old.assigned_supervisor_id, v_job.assigned_supervisor_id,
          p_reason_id, p_reason_note, v_uid, p_client_informed);

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (p_job_id, v_uid, v_role, 'job.rescheduled', jsonb_build_object(
    'from', v_old.scheduled_start, 'to', p_new_start,
    'reason', v_reason.code, 'note', p_reason_note));

  -- Stale alerts for the old slot must not fire.
  perform public.cancel_pending_notifications(p_job_id, null, null);

  -- Both days are re-chained by the fan-out trigger; this is belt and braces
  -- for the case where only the supervisor changed.
  perform public.enqueue_recompute(v_old.assigned_supervisor_id, v_old.service_date);
  perform public.enqueue_recompute(v_job.assigned_supervisor_id, v_job.service_date);

  return v_job;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- cancel_job
--
-- Once a job is past CHECKED_IN only an admin may cancel it: a rep should not
-- be able to cancel a job someone has already loaded equipment for.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_job(
  p_job_id          uuid,
  p_reason_id       uuid,
  p_reason_note     text default null,
  p_client_informed boolean default false
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_role   public.user_role := public.app_role();
  v_job    public.jobs;
  v_before public.job_status;
  v_reason public.reasons;
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job not found' using errcode = 'no_data_found';
  end if;
  v_before := v_job.status;

  if v_before in ('COMPLETED','CANCELLED') then
    raise exception 'Job is already %', v_before using errcode = 'check_violation';
  end if;

  if v_role = 'sales_rep' then
    if v_before not in ('DRAFT','ASSIGNED') then
      raise exception 'This job is already under way — ask an admin to cancel it'
        using errcode = 'insufficient_privilege';
    end if;
    if v_job.created_by_sales_rep_id is distinct from v_uid then
      raise exception 'You did not create this job' using errcode = 'insufficient_privilege';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  select * into v_reason from public.reasons where id = p_reason_id and category = 'cancellation';
  if not found then
    raise exception 'A valid cancellation reason is required' using errcode = 'check_violation';
  end if;
  if v_reason.requires_note and coalesce(trim(p_reason_note), '') = '' then
    raise exception 'Reason "%" requires a note', v_reason.label using errcode = 'check_violation';
  end if;

  update public.jobs set status = 'CANCELLED' where id = p_job_id returning * into v_job;

  insert into public.job_cancellations (
    job_id, reason_id, reason_note, status_before, cancelled_by, client_informed)
  values (p_job_id, p_reason_id, p_reason_note, v_before, v_uid, p_client_informed);

  insert into public.job_events (job_id, actor_id, actor_role, event_type,
                                 from_status, to_status, payload)
  values (p_job_id, v_uid, v_role, 'job.cancelled', v_before, 'CANCELLED',
          jsonb_build_object('reason', v_reason.code, 'note', p_reason_note));

  perform public.cancel_pending_notifications(p_job_id, null, null);
  return v_job;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- record_payment
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  p_job_id    uuid,
  p_amount    numeric,
  p_mode      public.payment_mode,
  p_reference text default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_p   public.payments;
begin
  if not exists (
    select 1 from public.jobs
     where id = p_job_id
       and (assigned_supervisor_id = v_uid or public.is_admin() or public.is_sales_rep())
  ) then
    raise exception 'Not your job' using errcode = 'insufficient_privilege';
  end if;

  insert into public.payments (job_id, amount, mode, reference, collected_at, recorded_by)
  values (p_job_id, p_amount, p_mode,
          p_reference,
          case when p_mode = 'pending' then null else now() end,
          v_uid)
  on conflict (job_id) do update
    set amount = excluded.amount, mode = excluded.mode,
        reference = excluded.reference, collected_at = excluded.collected_at,
        recorded_by = excluded.recorded_by
  returning * into v_p;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (p_job_id, v_uid, public.app_role(), 'payment.recorded',
          jsonb_build_object('amount', p_amount, 'mode', p_mode));

  return v_p;
end;
$fn$;
