-- ============================================================================
-- Cleanify Ops — 21. Retaking a check-in photo
-- ============================================================================
-- one_photo_per_roster_kind allowed exactly one equipment and one PPE photo
-- per roster, ever, so a retake (before submitting, or after a rejection) was
-- refused. Now there is exactly one CURRENT photo per kind; replaced photos
-- stay in the table, marked, so the audit trail keeps every capture.
set search_path = public, extensions;

alter table public.photos add column if not exists replaced_at timestamptz;

drop index if exists public.one_photo_per_roster_kind;
create unique index one_photo_per_roster_kind
  on public.photos (roster_id, kind)
  where roster_id is not null and replaced_at is null;

-- record_photo: unchanged except for marking the previous photo replaced.
create or replace function public.record_photo(
  p_token_id       uuid,
  p_sha256         text,
  p_mime_type      text,
  p_bytes          int,
  p_width          int default null,
  p_height         int default null,
  p_camera_facing  text default null,
  p_capture_latency_ms int default null,
  p_client_clock   timestamptz default null,
  p_lat            double precision default null,
  p_lng            double precision default null,
  p_accuracy_m     numeric default null
)
returns public.photos
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_tok       public.capture_tokens;
  v_photo     public.photos;
  v_expected  extensions.geography;
  v_dist      numeric;
  v_flag      boolean := false;
  v_reason    text;
  v_dupe      boolean;
  v_max_acc   numeric := public.setting_num('geofence.max_accuracy_m', 150);
begin
  select * into v_tok from public.capture_tokens where id = p_token_id for update;
  if not found then
    raise exception 'Unknown capture token' using errcode = 'insufficient_privilege';
  end if;
  if v_tok.user_id is distinct from v_uid then
    raise exception 'That capture token is not yours' using errcode = 'insufficient_privilege';
  end if;
  if v_tok.consumed_at is not null then
    raise exception 'That capture token has already been used' using errcode = 'insufficient_privilege';
  end if;
  if v_tok.expires_at < now() then
    raise exception 'That capture token has expired — retake the photo'
      using errcode = 'insufficient_privilege';
  end if;

  -- The cheapest anti-fraud win available: the same bytes submitted twice,
  -- anywhere, ever.
  select exists (select 1 from public.photos where sha256 = p_sha256) into v_dupe;
  if v_dupe then
    v_flag := true;
    v_reason := 'duplicate_photo';
  end if;

  -- Where should they have been standing?
  if v_tok.roster_id is not null then
    select p.base_location into v_expected
      from public.day_rosters r join public.profiles p on p.id = r.supervisor_id
     where r.id = v_tok.roster_id;
  elsif v_tok.job_line_item_id is not null or v_tok.job_id is not null then
    select j.site_location into v_expected
      from public.jobs j
     where j.id = coalesce(v_tok.job_id,
             (select job_id from public.job_line_items where id = v_tok.job_line_item_id));
  end if;

  if p_lat is not null and p_lng is not null and v_expected is not null then
    v_dist := extensions.st_distance(
                extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
                v_expected);
  end if;

  -- An unusable GPS reading and a suspicious location are very different
  -- accusations. Never conflate them.
  if p_accuracy_m is not null and p_accuracy_m > v_max_acc then
    v_flag := true;
    v_reason := coalesce(v_reason || ',', '') || 'low_accuracy';
  end if;

  -- A retake replaces the current roster photo of this kind. The old row is
  -- kept for the audit trail, just no longer current.
  if v_tok.roster_id is not null then
    update public.photos
       set replaced_at = now()
     where roster_id = v_tok.roster_id and kind = v_tok.kind and replaced_at is null;
  end if;

  insert into public.photos (
    kind, roster_id, job_id, job_line_item_id,
    storage_path, mime_type, bytes, width, height, sha256,
    captured_via, camera_facing, capture_latency_ms, capture_token_id,
    captured_at_server, client_clock_at,
    lat, lng, accuracy_m, distance_from_expected_m,
    flagged, flag_reason, uploaded_by
  )
  values (
    v_tok.kind, v_tok.roster_id,
    coalesce(v_tok.job_id, (select job_id from public.job_line_items where id = v_tok.job_line_item_id)),
    v_tok.job_line_item_id,
    v_tok.storage_path, p_mime_type, p_bytes, p_width, p_height, p_sha256,
    'getusermedia', p_camera_facing, p_capture_latency_ms, p_token_id,
    now(), p_client_clock,
    p_lat, p_lng, p_accuracy_m, v_dist,
    v_flag, v_reason, v_uid
  )
  returning * into v_photo;

  update public.capture_tokens set consumed_at = now() where id = p_token_id;

  return v_photo;
end;
$fn$;
