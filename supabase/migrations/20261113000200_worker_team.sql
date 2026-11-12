-- Calling staff own the worker list: every worker is added to one
-- supervisor's team, and a supervisor can only tick their own team when
-- marking a payment. Stops a supervisor from paying someone who is not theirs
-- (each ticked worker earns their own share of the job).
--
-- A worker with no team appears to no supervisor until calling staff choose
-- one. Moving a worker to another team is a normal edit, logged like every
-- other change on Team %.

alter table public.pay_staff
  add column team_supervisor_id uuid references public.profiles(id);

comment on column public.pay_staff.team_supervisor_id is
  'For workers: the supervisor whose team they are on. Set by calling staff on Team %.';

create index pay_staff_team_idx on public.pay_staff (team_supervisor_id) where kind = 'worker';

-- ---------------------------------------------------------------------------
-- upsert_pay_staff gains the team. The old seven-argument form is replaced.
-- ---------------------------------------------------------------------------
drop function public.upsert_pay_staff(uuid, text, text, date, numeric, numeric, boolean);

create or replace function public.upsert_pay_staff(
  p_id                 uuid,
  p_full_name          text,
  p_phone              text,
  p_joined_on          date,
  p_start_percent      numeric,
  p_fixed_percent      numeric,
  p_is_active          boolean default true,
  p_team_supervisor_id uuid default null
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

  -- An active worker needs a team; someone who has left can be saved without one.
  if (p_id is null or v_old.kind = 'worker') and coalesce(p_is_active, true) then
    if p_team_supervisor_id is null then
      raise exception 'Choose which supervisor this worker goes out with';
    end if;
    if not exists (select 1 from public.profiles
                    where id = p_team_supervisor_id and role = 'supervisor' and is_active) then
      raise exception 'That supervisor is not active';
    end if;
  end if;

  if p_id is null then
    if nullif(trim(coalesce(p_full_name, '')), '') is null then
      raise exception 'Enter the name';
    end if;
    insert into public.pay_staff (kind, full_name, phone, joined_on, start_percent, fixed_percent, is_active, created_by, team_supervisor_id)
    values ('worker', trim(p_full_name), v_phone, p_joined_on,
            p_start_percent, p_fixed_percent, coalesce(p_is_active, true), auth.uid(), p_team_supervisor_id)
    returning * into v_new;
  else
    update public.pay_staff
       set full_name          = case when kind = 'worker' then coalesce(nullif(trim(coalesce(p_full_name, '')), ''), full_name) else full_name end,
           phone              = case when kind = 'worker' then v_phone else phone end,
           is_active          = case when kind = 'worker' then coalesce(p_is_active, is_active) else is_active end,
           team_supervisor_id = case when kind = 'worker' then p_team_supervisor_id else team_supervisor_id end,
           joined_on          = p_joined_on,
           start_percent      = p_start_percent,
           fixed_percent      = p_fixed_percent
     where id = p_id
    returning * into v_new;
  end if;

  insert into public.job_events (actor_id, actor_role, event_type, payload)
  values (auth.uid(), public.app_role(), 'pay_staff.changed',
          jsonb_build_object('staff_id', v_new.id, 'before', to_jsonb(v_old), 'after', to_jsonb(v_new)));
  return v_new;
end;
$fn$;

revoke execute on function public.upsert_pay_staff(uuid, text, text, date, numeric, numeric, boolean, uuid) from public, anon;
grant execute on function public.upsert_pay_staff(uuid, text, text, date, numeric, numeric, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A supervisor sees only their own team. Office staff see everyone.
-- ---------------------------------------------------------------------------
create or replace function public.list_workers()
returns table (id uuid, full_name text)
language sql stable
security definer
set search_path = ''
as $fn$
  select s.id, s.full_name
    from public.pay_staff s
   where s.kind = 'worker' and s.is_active and auth.uid() is not null
     and (public.is_admin() or public.is_sales_rep() or s.team_supervisor_id = auth.uid())
   order by s.full_name
$fn$;

-- ---------------------------------------------------------------------------
-- record_job_payment: unchanged apart from the team check.
-- ---------------------------------------------------------------------------
create or replace function public.record_job_payment(
  p_job_id     uuid,
  p_upi_amount numeric,
  p_cash_amount numeric,
  p_worker_ids uuid[] default '{}',
  p_note       text default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_job     public.jobs;
  v_upi     numeric := coalesce(p_upi_amount, 0);
  v_cash    numeric := coalesce(p_cash_amount, 0);
  v_total   numeric;
  v_week    date := public.ist_week_start();
  v_sup     uuid;
  v_staff   uuid;
  v_percent numeric;
  v_note    text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job not found' using errcode = 'no_data_found';
  end if;
  if not (public.is_admin() or v_job.assigned_supervisor_id = v_uid) then
    raise exception 'Not your job' using errcode = 'insufficient_privilege';
  end if;
  if not (v_job.status = 'COMPLETED'
          or (v_job.status = 'IN_PROGRESS' and v_job.after_review is not null)) then
    raise exception 'Payment can be marked once the after photos are sent';
  end if;
  if exists (select 1 from public.payments where job_id = p_job_id and voided_at is null) then
    raise exception 'Payment is already marked for this job';
  end if;
  if v_upi < 0 or v_cash < 0 then
    raise exception 'Amounts cannot be negative';
  end if;
  v_total := v_upi + v_cash;
  if v_total <= 0 then
    raise exception 'Enter the amount received';
  end if;
  if v_job.quoted_amount is not null and v_total <> v_job.quoted_amount and v_note is null then
    raise exception 'The amount is different from the quote (₹%). Add a note saying why.', v_job.quoted_amount;
  end if;

  select id into v_sup from public.pay_staff where profile_id = v_job.assigned_supervisor_id;
  if v_sup is null then
    raise exception 'This job has no supervisor on the staff list';
  end if;
  if exists (select 1 from unnest(coalesce(p_worker_ids, '{}')) w
              where not exists (select 1 from public.pay_staff s
                                 where s.id = w and s.kind = 'worker' and s.is_active)) then
    raise exception 'Choose workers from the staff list';
  end if;
  -- Only workers on this supervisor's team, as calling staff set it.
  if exists (select 1 from unnest(coalesce(p_worker_ids, '{}')) w
              join public.pay_staff s on s.id = w
             where s.team_supervisor_id is distinct from v_job.assigned_supervisor_id) then
    raise exception 'A worker you ticked is not on this supervisor''s team. Ask calling staff to add them to the team.';
  end if;

  if v_upi > 0 then
    insert into public.payments (job_id, amount, mode, collected_at, recorded_by, note, week_start)
    values (p_job_id, v_upi, 'upi', now(), v_uid, v_note, v_week);
  end if;
  if v_cash > 0 then
    insert into public.payments (job_id, amount, mode, collected_at, recorded_by, note, week_start, held_by_staff_id)
    values (p_job_id, v_cash, 'cash', now(), v_uid, v_note, v_week, v_sup);
  end if;

  for v_staff in
    select v_sup union select distinct w from unnest(coalesce(p_worker_ids, '{}')) w
  loop
    v_percent := public.pay_percent(v_staff, v_job.service_date);
    insert into public.job_earnings (job_id, staff_id, percent, base_amount, amount, week_start)
    values (p_job_id, v_staff, v_percent, v_total, round(v_total * v_percent / 100, 2), v_week);
  end loop;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (p_job_id, v_uid, public.app_role(), 'payment.recorded',
          jsonb_build_object('upi', v_upi, 'cash', v_cash, 'note', v_note));

  return v_total;
end;
$fn$;

