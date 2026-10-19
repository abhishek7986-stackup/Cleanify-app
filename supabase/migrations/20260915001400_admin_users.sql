-- ============================================================================
-- Cleanify Ops — 14. Staff administration
--
-- Creating the auth user itself must go through Supabase's Admin API (it
-- handles password hashing and the identities row). These RPCs cover the
-- half that lives in our schema: the profile, the role, and the depot
-- location that the whole check-in deadline is derived from.
-- ============================================================================
set search_path = public, extensions;

-- A service-role key carries no app_metadata.role, so is_admin() is false for
-- it. Seeding and back-office scripts need an explicit way through.
create or replace function public.is_service_role()
returns boolean
language sql stable
set search_path = ''
as $fn$
  select coalesce(auth.role() = 'service_role', false)
$fn$;

create or replace function public.admin_upsert_staff(
  p_user_id      uuid,
  p_full_name    text,
  p_role         public.user_role,
  p_phone        text default null,
  p_base_lat     double precision default null,
  p_base_lng     double precision default null,
  p_base_address text default null,
  p_is_active    boolean default true
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_profile public.profiles;
  v_point   extensions.geography;
begin
  if not (public.is_admin() or public.is_service_role()) then
    raise exception 'Only an admin can manage staff' using errcode = 'insufficient_privilege';
  end if;

  if p_base_lat is not null and p_base_lng is not null then
    v_point := extensions.st_setsrid(
                 extensions.st_makepoint(p_base_lng, p_base_lat), 4326)::extensions.geography;
  end if;

  -- An active supervisor with no depot location would produce no deadline at
  -- all, so the schema refuses it. Fail with something a human can act on
  -- rather than a raw constraint violation.
  if p_role = 'supervisor' and p_is_active and v_point is null
     and not exists (select 1 from public.profiles
                      where id = p_user_id and base_location is not null) then
    raise exception 'A supervisor needs a depot location — their check-in deadline is derived from it'
      using errcode = 'check_violation';
  end if;

  insert into public.profiles (
    id, full_name, phone, role, is_active,
    base_location, base_address, base_location_updated_at
  )
  values (
    p_user_id, p_full_name, p_phone, p_role, p_is_active,
    v_point, p_base_address,
    case when v_point is null then null else now() end
  )
  on conflict (id) do update
    set full_name   = excluded.full_name,
        phone       = coalesce(excluded.phone, profiles.phone),
        role        = excluded.role,
        is_active   = excluded.is_active,
        base_location = coalesce(excluded.base_location, profiles.base_location),
        base_address  = coalesce(excluded.base_address, profiles.base_address),
        base_location_updated_at = case
          when excluded.base_location is null then profiles.base_location_updated_at
          else now() end
  returning * into v_profile;

  return v_profile;
end;
$fn$;

-- Moving a depot shifts every future first-job deadline for that supervisor,
-- so the affected days are re-queued rather than silently left stale.
create or replace function public.admin_set_base_location(
  p_user_id uuid,
  p_lat     double precision,
  p_lng     double precision,
  p_address text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_profile public.profiles;
  v_day     date;
begin
  if not (public.is_admin() or public.is_service_role()) then
    raise exception 'Only an admin can move a depot location' using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
     set base_location = extensions.st_setsrid(
                           extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
         base_address = coalesce(p_address, base_address),
         base_location_updated_at = now()
   where id = p_user_id
   returning * into v_profile;

  if not found then
    raise exception 'No such staff member' using errcode = 'no_data_found';
  end if;

  -- Bounded to 30 days: re-chaining every future day forever would be a lot of
  -- Maps calls for jobs that will probably be rescheduled anyway.
  for v_day in
    select distinct service_date from public.jobs
     where assigned_supervisor_id = p_user_id
       and service_date >= (now() at time zone 'Asia/Kolkata')::date
       and service_date <= ((now() at time zone 'Asia/Kolkata')::date + 30)
       and status not in ('CANCELLED','COMPLETED','NO_SHOW')
  loop
    perform public.enqueue_recompute(p_user_id, v_day);
  end loop;

  return v_profile;
end;
$fn$;

create or replace function public.admin_set_active(p_user_id uuid, p_active boolean)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_profile public.profiles;
begin
  if not (public.is_admin() or public.is_service_role()) then
    raise exception 'Only an admin can deactivate staff' using errcode = 'insufficient_privilege';
  end if;

  update public.profiles set is_active = p_active where id = p_user_id
  returning * into v_profile;
  return v_profile;
end;
$fn$;

grant execute on function
  public.admin_upsert_staff(uuid, text, public.user_role, text,
                            double precision, double precision, text, boolean),
  public.admin_set_base_location(uuid, double precision, double precision, text),
  public.admin_set_active(uuid, boolean),
  public.is_service_role()
to authenticated;
