-- ============================================================================
-- Cleanify Ops — 17. Validate the map pin before anything is written
--
-- The pin check sat below the client insert, so a job submitted without one
-- failed on a NOT NULL violation deep inside clients.location — an error a
-- sales rep cannot act on. The check now runs first, so the message is the
-- actionable "A map pin is required" and no half-created client is attempted.
-- ============================================================================
set search_path = public, extensions;

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

  -- A map pin is mandatory. Free-text Indian addresses do not geocode
  -- reliably, and the pin is what the supervisor actually navigates to.
  if (p_payload -> 'site' ->> 'lat') is null or (p_payload -> 'site' ->> 'lng') is null then
    raise exception 'A map pin is required' using errcode = 'check_violation';
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
