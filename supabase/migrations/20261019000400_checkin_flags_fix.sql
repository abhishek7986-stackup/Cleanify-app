-- ============================================================================
-- Cleanify Ops — 22. Check-in flags
-- ============================================================================
-- `v_flags || 'low_accuracy'` parses the right-hand side as an ARRAY literal
-- and fails with "malformed array literal", so any check-in that earned a
-- flag (weak GPS, far from the depot, clock skew, resubmission) was refused
-- outright. array_append() adds the element as intended.
set search_path = public, extensions;

create or replace function public.submit_checkin(
  p_roster_date        date,
  p_lat                double precision default null,
  p_lng                double precision default null,
  p_accuracy_m         numeric default null,
  p_client_clock       timestamptz default null,
  p_device_fingerprint text default null,
  p_user_agent         text default null,
  p_offline_queued_at  timestamptz default null,
  p_note               text default null
)
returns public.day_rosters
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_r        public.day_rosters;
  v_base     extensions.geography;
  v_point    extensions.geography;
  v_dist     numeric;
  v_flags    text[] := '{}';
  v_risk     int := 0;
  v_radius   numeric := public.setting_num('geofence.base_radius_m', 500);
  v_max_acc  numeric := public.setting_num('geofence.max_accuracy_m', 150);
  v_skew     int;
  v_kinds    int;
  v_resubmit boolean;
  v_since    timestamptz;
begin
  if not public.is_supervisor() then
    raise exception 'Only supervisors check in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_r from public.day_rosters
   where supervisor_id = v_uid and roster_date = p_roster_date and voided_at is null
   for update;
  if not found then
    raise exception 'No roster for % — you have no jobs scheduled that day', p_roster_date
      using errcode = 'no_data_found';
  end if;

  v_resubmit := v_r.submitted_at is not null and v_r.approval_status = 'REJECTED';
  if v_r.submitted_at is not null and not v_resubmit then
    raise exception 'You have already checked in today' using errcode = 'unique_violation';
  end if;

  -- approved_at is stamped on rejection too, so it marks when the old photos
  -- stopped counting.
  v_since := case when v_resubmit then v_r.approved_at else '-infinity'::timestamptz end;

  select count(distinct kind) into v_kinds from public.photos
   where roster_id = v_r.id
     and kind in ('EQUIPMENT','PPE_SELFIE')
     and captured_at_server > v_since;
  if v_kinds < 2 then
    raise exception 'Both the equipment photo and the PPE photo are required'
      using errcode = 'check_violation';
  end if;

  select base_location into v_base from public.profiles where id = v_uid;

  if p_lat is null or p_lng is null then
    v_flags := array_append(v_flags, 'no_geolocation');
    v_risk  := v_risk + 20;
  else
    v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
    if v_base is not null then
      v_dist := extensions.st_distance(v_point, v_base);
    end if;

    if p_accuracy_m is not null and p_accuracy_m > v_max_acc then
      v_flags := array_append(v_flags, 'low_accuracy');
      v_risk  := v_risk + 10;
    elsif v_dist is not null
      and (v_dist - coalesce(p_accuracy_m, 0)) > v_radius then
      v_flags := array_append(v_flags, 'far_from_expected');
      v_risk  := v_risk + 40;
    end if;
  end if;

  if p_client_clock is not null then
    v_skew := abs(extract(epoch from (p_client_clock - now()))::int);
    if v_skew > 120 then
      v_flags := array_append(v_flags, 'clock_skew');
      v_risk  := v_risk + 15;
    end if;
  end if;

  if p_offline_queued_at is not null then
    v_flags := array_append(v_flags, 'offline_submitted');
    v_risk  := v_risk + 5;
  end if;

  if exists (select 1 from public.photos
              where roster_id = v_r.id and flagged and captured_at_server > v_since) then
    v_flags := array_append(v_flags, 'photo_flagged');
    v_risk  := v_risk + 30;
  end if;

  if v_resubmit then
    v_flags := array_append(v_flags, 'resubmitted');

    update public.day_rosters
       set approval_status   = 'PENDING',
           approved_by       = null,
           approved_at       = null,
           rejection_reason  = null,
           location          = coalesce(v_point, location),
           accuracy_m        = coalesce(p_accuracy_m, accuracy_m),
           distance_from_expected_m = coalesce(v_dist, distance_from_expected_m),
           flags             = v_flags,
           risk_score        = v_risk,
           note              = coalesce(p_note, note)
     where id = v_r.id
     returning * into v_r;

    insert into public.job_events (roster_id, job_id, actor_id, actor_role, event_type, payload)
    values (v_r.id, v_r.first_job_id, v_uid, 'supervisor', 'checkin.resubmitted',
            jsonb_build_object('flags', v_flags, 'risk_score', v_risk, 'distance_m', v_dist));

    return v_r;
  end if;

  update public.day_rosters
     set submitted_at       = now(),
         client_reported_at = p_client_clock,
         location           = v_point,
         accuracy_m         = p_accuracy_m,
         distance_from_expected_m = v_dist,
         flags              = v_flags,
         risk_score         = v_risk,
         device_fingerprint = p_device_fingerprint,
         user_agent         = p_user_agent,
         offline_queued_at  = p_offline_queued_at,
         note               = p_note,
         checkin_status     = case
             when required_checkin_at is null then 'ON_TIME'::public.checkin_status
             when now() <= required_checkin_at then 'ON_TIME'::public.checkin_status
             else 'LATE'::public.checkin_status end
   where id = v_r.id
   returning * into v_r;

  perform public.cancel_pending_notifications(null, v_r.id, 'checkin.');

  insert into public.job_events (roster_id, job_id, actor_id, actor_role, event_type, payload)
  values (v_r.id, v_r.first_job_id, v_uid, 'supervisor', 'checkin.submitted',
          jsonb_build_object('status', v_r.checkin_status, 'flags', v_flags,
                             'risk_score', v_risk, 'distance_m', v_dist));

  return v_r;
end;
$fn$;
