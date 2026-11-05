-- ============================================================================
-- Payments, staff percentages and the Monday payout
-- ============================================================================
-- After a job the supervisor shows the customer a UPI QR or takes cash, and
-- marks it. The office checks UPI against the bank. Each person on the job earns
-- their own percentage of the amount collected. Every Monday the office settles
-- last week per person:
--
--   due = brought forward + earned - cash they are holding
--   due > 0: the company pays them. due < 0: they return it to the company.
--
-- Whatever is not settled carries into the next week. Nothing here is ever
-- deleted: a mistake is voided with a reason and the row stays.
--
-- Super admin is an admin with one extra permission, not a new role, so every
-- existing admin rule keeps working unchanged.
-- ============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Super admin
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column is_super_admin boolean not null default false;

create or replace function public.is_super_admin()
returns boolean
language sql stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select p.is_super_admin and p.is_active
       from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'),
    false)
$fn$;

-- profiles_admin_write lets an admin update any profile, so without this an
-- admin could simply promote themselves.
create or replace function public.guard_super_admin_flag()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.is_super_admin is distinct from (case when tg_op = 'UPDATE' then old.is_super_admin else false end)
     and auth.uid() is not null
     and not public.is_super_admin() then
    raise exception 'Only a super admin can change this' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$fn$;

create trigger profiles_guard_super_admin
  before insert or update of is_super_admin on public.profiles
  for each row execute function public.guard_super_admin_flag();

-- ---------------------------------------------------------------------------
-- pay_staff: everyone who earns a percentage. A worker has no login, so this
-- cannot hang off profiles; a supervisor's row links to their profile.
-- ---------------------------------------------------------------------------
create table public.pay_staff (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid unique references public.profiles(id),
  kind          text not null check (kind in ('supervisor', 'worker')),
  full_name     text not null check (length(trim(full_name)) > 0),
  phone         text,
  joined_on     date not null default ((now() at time zone 'Asia/Kolkata')::date),
  start_percent numeric(5,2) not null default 14 check (start_percent between 0 and 100),
  max_percent   numeric(5,2) not null default 17 check (max_percent between 0 and 100),
  -- Set by the office to stop the monthly rise and use this figure instead.
  fixed_percent numeric(5,2) check (fixed_percent between 0 and 100),
  is_active     boolean not null default true,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint supervisor_has_profile check (kind <> 'supervisor' or profile_id is not null)
);

create trigger pay_staff_touch before update on public.pay_staff
  for each row execute function public.touch_updated_at();

comment on table public.pay_staff is
  'Who earns a percentage. Worker rows have no login. Supervisor rows follow profiles.';

-- Month 1 is the start percentage, then one point more each full month, up to
-- the maximum: 14, 15, 16, then 17 from the fourth month.
create or replace function public.pay_percent(p_staff_id uuid, p_on date)
returns numeric
language sql stable
security definer
set search_path = ''
as $fn$
  select coalesce(
           s.fixed_percent,
           greatest(s.start_percent,
             least(s.max_percent,
               s.start_percent + greatest(0,
                 (extract(year  from age(p_on::timestamp, s.joined_on::timestamp)) * 12
                + extract(month from age(p_on::timestamp, s.joined_on::timestamp)))::int))))
    from public.pay_staff s
   where s.id = p_staff_id
$fn$;

-- A supervisor approved in Users appears here on their own, at 14%, for the
-- calling staff to check.
create or replace function public.sync_pay_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.role = 'supervisor' and new.is_active then
    insert into public.pay_staff (profile_id, kind, full_name, phone)
    values (new.id, 'supervisor', new.full_name, new.phone)
    on conflict (profile_id) do update
      set full_name = excluded.full_name, phone = excluded.phone, is_active = true;
  else
    update public.pay_staff set is_active = false where profile_id = new.id;
  end if;
  return new;
end;
$fn$;

create trigger profiles_sync_pay_staff
  after insert or update of role, is_active, full_name, phone on public.profiles
  for each row execute function public.sync_pay_staff();

insert into public.pay_staff (profile_id, kind, full_name, phone, joined_on)
select id, 'supervisor', full_name, phone, (created_at at time zone 'Asia/Kolkata')::date
  from public.profiles
 where role = 'supervisor' and is_active;

-- ---------------------------------------------------------------------------
-- payments: a job can now be part UPI and part cash, so one active row per mode.
-- The table is empty and record_payment() was never called from a screen.
-- ---------------------------------------------------------------------------
drop function public.record_payment(uuid, numeric, public.payment_mode, text);

alter table public.payments
  drop constraint payments_job_id_key,
  add column note             text,
  -- Monday of the IST week the money came in. The payout is keyed on this.
  add column week_start       date,
  -- Cash is in this person's hand until the Monday payout.
  add column held_by_staff_id uuid references public.pay_staff(id),
  add column verified_at      timestamptz,
  add column verified_by      uuid references public.profiles(id),
  add column voided_at        timestamptz,
  add column voided_by        uuid references public.profiles(id),
  add column void_reason      text,
  add constraint collected_has_week check (mode = 'pending' or week_start is not null),
  add constraint cash_has_holder check (mode <> 'cash' or held_by_staff_id is not null);

create unique index payments_one_active_per_mode
  on public.payments (job_id, mode) where voided_at is null;
create index payments_week_idx on public.payments (week_start) where voided_at is null;
create index payments_holder_idx on public.payments (held_by_staff_id, week_start) where voided_at is null;

-- ---------------------------------------------------------------------------
-- job_earnings: the percentage and amount as they stood at payment time, so a
-- later change to someone's percentage never rewrites history.
-- ---------------------------------------------------------------------------
create table public.job_earnings (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id),
  staff_id    uuid not null references public.pay_staff(id),
  percent     numeric(5,2) not null,
  base_amount numeric(10,2) not null,
  amount      numeric(10,2) not null,
  week_start  date not null,
  created_at  timestamptz not null default now(),
  voided_at   timestamptz
);

create unique index job_earnings_one_active
  on public.job_earnings (job_id, staff_id) where voided_at is null;
create index job_earnings_week_idx on public.job_earnings (staff_id, week_start) where voided_at is null;

-- ---------------------------------------------------------------------------
-- payouts: what actually happened on a Monday, frozen. settled_amount is
-- positive when the company paid the person, negative when they returned money.
-- ---------------------------------------------------------------------------
create table public.payouts (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null references public.pay_staff(id),
  week_start      date not null,
  brought_forward numeric(10,2) not null,
  earned          numeric(10,2) not null,
  cash_held       numeric(10,2) not null,
  net_due         numeric(10,2) not null,
  settled_amount  numeric(10,2) not null,
  carry_forward   numeric(10,2) not null,
  method          text not null check (method in ('cash', 'upi', 'bank', 'none')),
  note            text,
  settled_by      uuid not null references public.profiles(id),
  settled_at      timestamptz not null default now(),
  reversed_at     timestamptz,
  reversed_by     uuid references public.profiles(id),
  reverse_reason  text
);

create unique index payouts_one_active
  on public.payouts (staff_id, week_start) where reversed_at is null;

-- ---------------------------------------------------------------------------
-- Access. All writes go through the functions below.
-- ---------------------------------------------------------------------------
alter table public.pay_staff    enable row level security;
alter table public.job_earnings enable row level security;
alter table public.payouts      enable row level security;

-- Supabase grants new tables to everyone by default; these are read-only.
revoke all on public.pay_staff, public.job_earnings, public.payouts from public, anon, authenticated;
grant select on public.pay_staff, public.job_earnings, public.payouts to authenticated;

create policy pay_staff_read on public.pay_staff
  for select to authenticated
  using (public.is_admin() or public.is_sales_rep() or profile_id = (select auth.uid()));

create policy job_earnings_read on public.job_earnings
  for select to authenticated
  using (
    public.is_admin() or public.is_sales_rep()
    or exists (select 1 from public.pay_staff s
                where s.id = staff_id and s.profile_id = (select auth.uid()))
  );

create policy payouts_read on public.payouts
  for select to authenticated
  using (
    public.is_admin() or public.is_sales_rep()
    or exists (select 1 from public.pay_staff s
                where s.id = staff_id and s.profile_id = (select auth.uid()))
  );

-- The UPI details decide where customers' money goes: super admin only.
drop policy settings_write on public.app_settings;
create policy settings_write on public.app_settings for all to authenticated
  using (public.is_admin() and key not like 'payments.%')
  with check (public.is_admin() and key not like 'payments.%');

-- ---------------------------------------------------------------------------
-- Small shared pieces
-- ---------------------------------------------------------------------------
create or replace function public.ist_week_start(p_at timestamptz default now())
returns date
language sql stable
set search_path = ''
as $fn$
  select date_trunc('week', p_at at time zone 'Asia/Kolkata')::date
$fn$;

-- Everyone before p_week: earned, minus cash held, minus what was already
-- settled. Working it out from the full history means a skipped Monday simply
-- rolls forward instead of losing money.
create or replace function public.pay_brought_forward(p_staff_id uuid, p_week date)
returns numeric
language sql stable
security definer
set search_path = ''
as $fn$
  select
    coalesce((select sum(e.amount) from public.job_earnings e
               where e.staff_id = p_staff_id and e.week_start < p_week and e.voided_at is null), 0)
  - coalesce((select sum(p.amount) from public.payments p
               where p.held_by_staff_id = p_staff_id and p.mode = 'cash'
                 and p.week_start < p_week and p.voided_at is null), 0)
  - coalesce((select sum(o.settled_amount) from public.payouts o
               where o.staff_id = p_staff_id and o.week_start < p_week and o.reversed_at is null), 0)
$fn$;

-- ---------------------------------------------------------------------------
-- record_job_payment: the supervisor's "Paid" button
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

-- ---------------------------------------------------------------------------
-- The office confirms a UPI payment reached the bank
-- ---------------------------------------------------------------------------
create or replace function public.verify_upi_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can check payments' using errcode = 'insufficient_privilege';
  end if;
  update public.payments
     set verified_at = now(), verified_by = auth.uid()
   where id = p_payment_id and mode = 'upi' and voided_at is null and verified_at is null
  returning job_id into v_job;
  if v_job is null then
    raise exception 'This payment is already checked or cancelled';
  end if;
  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (v_job, auth.uid(), public.app_role(), 'payment.verified',
          jsonb_build_object('payment_id', p_payment_id));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Cancel a wrong payment. The job goes back to "not collected" so it can be
-- marked again. Refused once that week is paid out, because the Monday figures
-- were built on it: reverse the payout first.
-- ---------------------------------------------------------------------------
create or replace function public.void_job_payment(p_job_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only an admin can cancel a payment' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for cancelling';
  end if;
  if not exists (select 1 from public.payments where job_id = p_job_id and voided_at is null) then
    raise exception 'There is no payment to cancel on this job';
  end if;
  if exists (
    select 1
      from public.job_earnings e
      join public.payouts o on o.staff_id = e.staff_id
                           and o.week_start >= e.week_start
                           and o.reversed_at is null
     where e.job_id = p_job_id and e.voided_at is null
  ) then
    raise exception 'That week is already paid out. Reverse the payout first.';
  end if;

  update public.payments
     set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
   where job_id = p_job_id and voided_at is null;
  update public.job_earnings
     set voided_at = now()
   where job_id = p_job_id and voided_at is null;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (p_job_id, auth.uid(), public.app_role(), 'payment.voided',
          jsonb_build_object('reason', v_reason));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Reports. Security invoker: payments_read decides whose rows are counted.
-- ---------------------------------------------------------------------------
create or replace function public.payment_totals(p_from date, p_to date)
returns table (
  supervisor_id   uuid,
  supervisor_name text,
  job_count       bigint,
  upi_total       numeric,
  cash_total      numeric,
  upi_unchecked   numeric
)
language sql stable
set search_path = ''
as $fn$
  select j.assigned_supervisor_id,
         d.full_name,
         count(distinct p.job_id),
         coalesce(sum(p.amount) filter (where p.mode = 'upi'), 0),
         coalesce(sum(p.amount) filter (where p.mode = 'cash'), 0),
         coalesce(sum(p.amount) filter (where p.mode = 'upi' and p.verified_at is null), 0)
    from public.payments p
    join public.jobs j on j.id = p.job_id
    left join public.staff_directory d on d.id = j.assigned_supervisor_id
   where p.voided_at is null
     and p.mode in ('upi', 'cash')
     and (p.collected_at at time zone 'Asia/Kolkata')::date between p_from and p_to
   group by 1, 2
   order by 2
$fn$;

-- Jobs from before this feature went live have no payment and never will.
create or replace function public.jobs_awaiting_payment()
returns table (
  job_id          uuid,
  job_number      text,
  client_name     text,
  supervisor_name text,
  quoted_amount   numeric,
  service_date    date,
  status          public.job_status
)
language sql stable
set search_path = ''
as $fn$
  select j.id, j.job_number, c.name, d.full_name, j.quoted_amount, j.service_date, j.status
    from public.jobs j
    left join public.clients c on c.id = j.client_id
    left join public.staff_directory d on d.id = j.assigned_supervisor_id
   where j.service_date >= date '2026-11-05'
     and (j.status = 'COMPLETED' or (j.status = 'IN_PROGRESS' and j.after_review is not null))
     and not exists (select 1 from public.payments p where p.job_id = j.id and p.voided_at is null)
   order by j.service_date, j.job_number
$fn$;

-- ---------------------------------------------------------------------------
-- The Monday statement: one row per person for one week. Office sees everyone;
-- a supervisor gets only their own row.
-- ---------------------------------------------------------------------------
create or replace function public.payout_statement(p_week date)
returns table (
  staff_id        uuid,
  full_name       text,
  kind            text,
  percent_now     numeric,
  job_count       bigint,
  earned          numeric,
  cash_held       numeric,
  brought_forward numeric,
  net_due         numeric,
  payout_id       uuid,
  settled_amount  numeric,
  carry_forward   numeric,
  method          text,
  note            text,
  settled_at      timestamptz
)
language sql stable
security definer
set search_path = ''
as $fn$
  with w as (select date_trunc('week', p_week::timestamp)::date as monday),
  base as (
    select s.*,
           (select coalesce(sum(e.amount), 0) from public.job_earnings e, w
             where e.staff_id = s.id and e.week_start = w.monday and e.voided_at is null) as v_earned,
           (select count(*) from public.job_earnings e, w
             where e.staff_id = s.id and e.week_start = w.monday and e.voided_at is null) as v_jobs,
           (select coalesce(sum(p.amount), 0) from public.payments p, w
             where p.held_by_staff_id = s.id and p.mode = 'cash'
               and p.week_start = w.monday and p.voided_at is null) as v_cash,
           public.pay_brought_forward(s.id, (select monday from w)) as v_bf
      from public.pay_staff s
     where public.is_admin() or public.is_sales_rep() or s.profile_id = (select auth.uid())
  )
  select b.id, b.full_name, b.kind,
         public.pay_percent(b.id, (now() at time zone 'Asia/Kolkata')::date),
         b.v_jobs, b.v_earned, b.v_cash, b.v_bf,
         b.v_bf + b.v_earned - b.v_cash,
         o.id, o.settled_amount, o.carry_forward, o.method, o.note, o.settled_at
    from base b
    left join public.payouts o
      on o.staff_id = b.id and o.reversed_at is null
     and o.week_start = (select monday from w)
   where b.is_active or b.v_jobs > 0 or b.v_bf <> 0
   order by b.kind, b.full_name
$fn$;

-- ---------------------------------------------------------------------------
-- settle_payout: the money changed hands. p_amount is what was actually paid or
-- returned; anything left over carries into next week.
-- ---------------------------------------------------------------------------
create or replace function public.settle_payout(
  p_staff_id uuid,
  p_week     date,
  p_amount   numeric,
  p_method   text,
  p_note     text default null
)
returns public.payouts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_week   date := date_trunc('week', p_week::timestamp)::date;
  v_earned numeric;
  v_cash   numeric;
  v_bf     numeric;
  v_net    numeric;
  v_signed numeric;
  v_row    public.payouts;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can settle a payout' using errcode = 'insufficient_privilege';
  end if;
  if v_week >= public.ist_week_start() then
    raise exception 'This week is not over yet. Payouts are for finished weeks.';
  end if;
  if p_method not in ('cash', 'upi', 'bank', 'none') then
    raise exception 'Choose how the money was handed over';
  end if;

  -- Serialises two admins settling the same person at once.
  perform 1 from public.pay_staff where id = p_staff_id for update;
  if not found then
    raise exception 'Staff member not found';
  end if;
  if exists (select 1 from public.payouts
              where staff_id = p_staff_id and week_start >= v_week and reversed_at is null) then
    raise exception 'This week or a later one is already settled for this person';
  end if;

  select coalesce(sum(amount), 0) into v_earned from public.job_earnings
   where staff_id = p_staff_id and week_start = v_week and voided_at is null;
  select coalesce(sum(amount), 0) into v_cash from public.payments
   where held_by_staff_id = p_staff_id and mode = 'cash' and week_start = v_week and voided_at is null;
  v_bf  := public.pay_brought_forward(p_staff_id, v_week);
  v_net := v_bf + v_earned - v_cash;

  if p_amount is null or p_amount < 0 then
    raise exception 'Enter the amount handed over';
  end if;
  if p_amount > abs(v_net) then
    raise exception 'That is more than the ₹% due', abs(v_net);
  end if;
  if p_amount = 0 and p_method <> 'none' then
    raise exception 'Enter the amount handed over';
  end if;

  v_signed := case when v_net < 0 then -p_amount else p_amount end;

  insert into public.payouts (staff_id, week_start, brought_forward, earned, cash_held, net_due,
                              settled_amount, carry_forward, method, note, settled_by)
  values (p_staff_id, v_week, v_bf, v_earned, v_cash, v_net,
          v_signed, v_net - v_signed, p_method, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_row;
  return v_row;
end;
$fn$;

-- Only the latest payout can be undone, and only by a super admin.
create or replace function public.reverse_payout(p_payout_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.payouts;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can reverse a payout' using errcode = 'insufficient_privilege';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason for reversing';
  end if;
  select * into v_row from public.payouts where id = p_payout_id and reversed_at is null for update;
  if not found then
    raise exception 'This payout is already reversed';
  end if;
  if exists (select 1 from public.payouts
              where staff_id = v_row.staff_id and week_start > v_row.week_start and reversed_at is null) then
    raise exception 'A later week is settled for this person. Reverse that one first.';
  end if;
  update public.payouts
     set reversed_at = now(), reversed_by = auth.uid(), reverse_reason = trim(p_reason)
   where id = p_payout_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Staff list. Calling staff and admins add workers and set percentages; every
-- change is written to job_events so "who changed my percentage" has an answer.
-- ---------------------------------------------------------------------------
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
  v_old public.pay_staff;
  v_new public.pay_staff;
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

  if p_id is null then
    if nullif(trim(coalesce(p_full_name, '')), '') is null then
      raise exception 'Enter the name';
    end if;
    insert into public.pay_staff (kind, full_name, phone, joined_on, start_percent, fixed_percent, is_active, created_by)
    values ('worker', trim(p_full_name), nullif(trim(coalesce(p_phone, '')), ''), p_joined_on,
            p_start_percent, p_fixed_percent, coalesce(p_is_active, true), auth.uid())
    returning * into v_new;
  else
    select * into v_old from public.pay_staff where id = p_id for update;
    if not found then
      raise exception 'Staff member not found';
    end if;
    -- A supervisor's name, phone and active state belong to their login.
    update public.pay_staff
       set full_name     = case when kind = 'worker' then coalesce(nullif(trim(coalesce(p_full_name, '')), ''), full_name) else full_name end,
           phone         = case when kind = 'worker' then nullif(trim(coalesce(p_phone, '')), '') else phone end,
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

-- A supervisor needs the names of workers to pick from, not their percentages.
create or replace function public.list_workers()
returns table (id uuid, full_name text)
language sql stable
security definer
set search_path = ''
as $fn$
  select s.id, s.full_name
    from public.pay_staff s
   where s.kind = 'worker' and s.is_active and auth.uid() is not null
   order by s.full_name
$fn$;

create or replace function public.set_upi_details(p_upi_id text, p_payee_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can change the UPI details' using errcode = 'insufficient_privilege';
  end if;
  if trim(coalesce(p_upi_id, '')) !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'That does not look like a UPI ID. It should look like name@bank.';
  end if;
  if nullif(trim(coalesce(p_payee_name, '')), '') is null then
    raise exception 'Enter the name customers should see';
  end if;
  insert into public.app_settings (key, value, description, updated_by, updated_at)
  values ('payments.upi', jsonb_build_object('id', trim(p_upi_id), 'name', trim(p_payee_name)),
          'UPI ID and name shown in the customer QR.', auth.uid(), now())
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$fn$;

revoke execute on function
  public.record_job_payment(uuid, numeric, numeric, uuid[], text),
  public.verify_upi_payment(uuid),
  public.void_job_payment(uuid, text),
  public.payment_totals(date, date),
  public.jobs_awaiting_payment(),
  public.payout_statement(date),
  public.settle_payout(uuid, date, numeric, text, text),
  public.reverse_payout(uuid, text),
  public.upsert_pay_staff(uuid, text, text, date, numeric, numeric, boolean),
  public.list_workers(),
  public.set_upi_details(text, text),
  public.pay_percent(uuid, date),
  public.pay_brought_forward(uuid, date)
from public, anon;

grant execute on function
  public.record_job_payment(uuid, numeric, numeric, uuid[], text),
  public.verify_upi_payment(uuid),
  public.void_job_payment(uuid, text),
  public.payment_totals(date, date),
  public.jobs_awaiting_payment(),
  public.payout_statement(date),
  public.settle_payout(uuid, date, numeric, text, text),
  public.reverse_payout(uuid, text),
  public.upsert_pay_staff(uuid, text, text, date, numeric, numeric, boolean),
  public.list_workers(),
  public.set_upi_details(text, text),
  public.pay_percent(uuid, date)
to authenticated;

revoke execute on function public.pay_brought_forward(uuid, date) from authenticated;
