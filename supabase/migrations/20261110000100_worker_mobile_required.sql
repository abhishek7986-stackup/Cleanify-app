-- ============================================================================
-- Workers have no login, so their weekly salary slip goes to WhatsApp. That
-- needs a mobile number, so it is now required for workers and stored as
-- +91XXXXXXXXXX, the same way supervisors' numbers are kept in profiles.
-- ============================================================================
create or replace function public.normalise_in_mobile(p_phone text)
returns text
language sql immutable
set search_path = ''
as $fn$
  select case
    when d ~ '^[6-9][0-9]{9}$'      then '+91' || d
    when d ~ '^91[6-9][0-9]{9}$'    then '+' || d
    when d ~ '^0[6-9][0-9]{9}$'     then '+91' || substr(d, 2)
  end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) x
$fn$;

create or replace function public.upsert_pay_staff(
  p_id            uuid,
  p_full_name     text,
  p_phone         text,
  p_joined_on     date,
  p_start_percent numeric,
  p_fixed_percent numeric,
  p_is_active     boolean default true
)
returns public.pay_staff
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_old   public.pay_staff;
  v_new   public.pay_staff;
  v_phone text := public.normalise_in_mobile(p_phone);
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can change this' using errcode = 'insufficient_privilege';
  end if;
  if p_joined_on is null then
    raise exception 'Enter the joining date';
  end if;
  if p_start_percent is null or p_start_percent not between 0 and 100
     or (p_fixed_percent is not null and p_fixed_percent not between 0 and 100) then
    raise exception 'Percentages must be between 0 and 100';
  end if;

  if p_id is not null then
    select * into v_old from public.pay_staff where id = p_id for update;
    if not found then
      raise exception 'Staff member not found';
    end if;
  end if;

  -- A supervisor's number belongs to their login and is not edited here.
  if (p_id is null or v_old.kind = 'worker') and v_phone is null then
    raise exception 'Enter a 10-digit mobile number. The weekly salary slip is sent to it on WhatsApp.';
  end if;

  if p_id is null then
    if nullif(trim(coalesce(p_full_name, '')), '') is null then
      raise exception 'Enter the name';
    end if;
    insert into public.pay_staff (kind, full_name, phone, joined_on, start_percent, fixed_percent, is_active, created_by)
    values ('worker', trim(p_full_name), v_phone, p_joined_on,
            p_start_percent, p_fixed_percent, coalesce(p_is_active, true), auth.uid())
    returning * into v_new;
  else
    update public.pay_staff
       set full_name     = case when kind = 'worker' then coalesce(nullif(trim(coalesce(p_full_name, '')), ''), full_name) else full_name end,
           phone         = case when kind = 'worker' then v_phone else phone end,
           is_active     = case when kind = 'worker' then coalesce(p_is_active, is_active) else is_active end,
           joined_on     = p_joined_on,
           start_percent = p_start_percent,
           fixed_percent = p_fixed_percent
     where id = p_id
    returning * into v_new;
  end if;

  insert into public.job_events (actor_id, actor_role, event_type, payload)
  values (auth.uid(), public.app_role(), 'pay_staff.changed',
          jsonb_build_object('staff_id', v_new.id, 'before', to_jsonb(v_old), 'after', to_jsonb(v_new)));
  return v_new;
end;
$fn$;
