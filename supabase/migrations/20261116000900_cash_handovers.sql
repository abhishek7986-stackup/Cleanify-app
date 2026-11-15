-- Cash handed back to the office during the week, not only on Monday.
--
-- A supervisor who collected cash from customers can hand it in any day. They
-- say so in the app ("I handed back Rs 3,000"); it stays PENDING until calling
-- staff or an admin confirms they received it (or rejects it with a reason).
-- The office can also record money it received directly, confirmed at once.
-- Nothing is deleted: a confirmed handover can be voided with a reason while
-- its week is not paid out.
--
-- A confirmed handover counts in the person's favour exactly like Monday's
-- settlement does: it lowers what they still hold. The weekly balance is now
--   brought forward + salary - cash collected + cash handed back.

create table if not exists public.cash_handovers (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references public.pay_staff(id),
  amount        numeric(12,2) not null check (amount > 0),
  method        text not null check (method in ('cash', 'upi', 'bank')),
  note          text,
  week_start    date not null,
  status        text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'REJECTED')),
  declared_by   uuid references public.profiles(id),
  declared_at   timestamptz not null default now(),
  reviewed_by   uuid references public.profiles(id),
  reviewed_at   timestamptz,
  reject_reason text,
  voided_at     timestamptz,
  voided_by     uuid references public.profiles(id),
  void_reason   text
);

create index if not exists cash_handovers_staff_idx on public.cash_handovers (staff_id, week_start);
create index if not exists cash_handovers_pending_idx on public.cash_handovers (status) where status = 'PENDING';

alter table public.cash_handovers enable row level security;
drop policy if exists cash_handovers_read on public.cash_handovers;
create policy cash_handovers_read on public.cash_handovers
  for select to authenticated
  using (
    public.is_admin() or public.is_sales_rep()
    or exists (select 1 from public.pay_staff s where s.id = staff_id and s.profile_id = auth.uid())
  );
revoke all on public.cash_handovers from anon, authenticated;
grant select on public.cash_handovers to authenticated;

-- Confirmed handovers for one person in one week (or every week before one).
create or replace function public.handed_back(p_staff_id uuid, p_week date, p_before boolean default false)
returns numeric
language sql stable
security definer
set search_path = ''
as $fn$
  select coalesce(sum(h.amount), 0)
    from public.cash_handovers h
   where h.staff_id = p_staff_id and h.status = 'CONFIRMED' and h.voided_at is null
     and case when p_before then h.week_start < p_week else h.week_start = p_week end
$fn$;

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
  + public.handed_back(p_staff_id, p_week, true)
$fn$;

-- The weekly statement gains the handovers (a new last column).
drop function if exists public.payout_statement(date);
create function public.payout_statement(p_week date)
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
  settled_at      timestamptz,
  handed_back     numeric
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
           public.pay_brought_forward(s.id, (select monday from w)) as v_bf,
           public.handed_back(s.id, (select monday from w)) as v_back
      from public.pay_staff s
     where public.is_admin() or public.is_sales_rep() or s.profile_id = (select auth.uid())
  )
  select b.id, b.full_name, b.kind,
         public.pay_percent(b.id, (now() at time zone 'Asia/Kolkata')::date),
         b.v_jobs, b.v_earned, b.v_cash, b.v_bf,
         b.v_bf + b.v_earned - b.v_cash + b.v_back,
         o.id, o.settled_amount, o.carry_forward, o.method, o.note, o.settled_at,
         b.v_back
    from base b
    left join public.payouts o
      on o.staff_id = b.id and o.reversed_at is null
     and o.week_start = (select monday from w)
   where b.is_active or b.v_jobs > 0 or b.v_bf <> 0 or b.v_back <> 0
   order by b.kind, b.full_name
$fn$;
revoke execute on function public.payout_statement(date) from public, anon;
grant execute on function public.payout_statement(date) to authenticated;

-- Monday's settlement counts the week's handovers too.
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
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can settle a payout' using errcode = 'insufficient_privilege';
  end if;
  if v_week >= public.ist_week_start() then
    raise exception 'This week is not over yet. Payouts are for finished weeks.';
  end if;
  if p_method not in ('cash', 'upi', 'bank', 'none') then
    raise exception 'Choose how the money was handed over';
  end if;

  -- Serialises two people settling the same person at once.
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
  v_net := v_bf + v_earned - v_cash + public.handed_back(p_staff_id, v_week);

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

-- The supervisor says they handed cash back. Waits for the office.
create or replace function public.declare_cash_handover(p_amount numeric, p_method text, p_note text default null)
returns public.cash_handovers
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff public.pay_staff;
  v_row   public.cash_handovers;
begin
  if public.app_role() is distinct from 'supervisor' then
    raise exception 'Only a supervisor declares a handover; the office records it directly' using errcode = 'insufficient_privilege';
  end if;
  select * into v_staff from public.pay_staff where profile_id = auth.uid();
  if not found then
    raise exception 'You are not on the pay list yet';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount you handed back';
  end if;
  if p_method not in ('cash', 'upi', 'bank') then
    raise exception 'Choose how you handed it back';
  end if;
  if exists (select 1 from public.cash_handovers
              where staff_id = v_staff.id and status = 'PENDING' and voided_at is null) then
    raise exception 'Your last handover is still waiting for the office to confirm';
  end if;

  insert into public.cash_handovers (staff_id, amount, method, note, week_start, declared_by)
  values (v_staff.id, round(p_amount, 2), p_method, nullif(trim(coalesce(p_note, '')), ''),
          public.ist_week_start(), auth.uid())
  returning * into v_row;

  insert into public.job_events (actor_id, actor_role, event_type, payload)
  values (auth.uid(), 'supervisor', 'cash_handover.declared',
          jsonb_build_object('handover_id', v_row.id, 'amount', v_row.amount, 'method', p_method));
  return v_row;
end;
$fn$;

-- The office confirms or rejects what a supervisor declared.
create or replace function public.review_cash_handover(p_id uuid, p_confirm boolean, p_reason text default null)
returns public.cash_handovers
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.cash_handovers;
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can confirm a handover' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.cash_handovers where id = p_id for update;
  if not found or v_row.status <> 'PENDING' or v_row.voided_at is not null then
    raise exception 'This handover is not waiting for review';
  end if;
  if not p_confirm and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why it is rejected';
  end if;
  if p_confirm and exists (select 1 from public.payouts
                            where staff_id = v_row.staff_id and week_start >= v_row.week_start and reversed_at is null) then
    raise exception 'That week is already paid out. Reverse the payout first.';
  end if;

  update public.cash_handovers
     set status = case when p_confirm then 'CONFIRMED' else 'REJECTED' end,
         reviewed_by = auth.uid(), reviewed_at = now(),
         reject_reason = case when p_confirm then null else trim(p_reason) end
   where id = p_id
   returning * into v_row;

  insert into public.job_events (actor_id, actor_role, event_type, payload)
  values (auth.uid(), public.app_role(),
          case when p_confirm then 'cash_handover.confirmed' else 'cash_handover.rejected' end,
          jsonb_build_object('handover_id', p_id, 'amount', v_row.amount, 'reason', v_row.reject_reason));
  return v_row;
end;
$fn$;

-- The office records cash it received directly (confirmed at once).
create or replace function public.record_cash_handover(p_staff_id uuid, p_amount numeric, p_method text, p_note text default null)
returns public.cash_handovers
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.cash_handovers;
  v_week date := public.ist_week_start();
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can record a handover' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.pay_staff where id = p_staff_id) then
    raise exception 'Choose who handed the money back';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount received';
  end if;
  if p_method not in ('cash', 'upi', 'bank') then
    raise exception 'Choose how it was received';
  end if;
  if exists (select 1 from public.payouts
              where staff_id = p_staff_id and week_start >= v_week and reversed_at is null) then
    raise exception 'This week is already paid out for them. Reverse the payout first.';
  end if;

  insert into public.cash_handovers (staff_id, amount, method, note, week_start, status, declared_by,
                                     reviewed_by, reviewed_at)
  values (p_staff_id, round(p_amount, 2), p_method, nullif(trim(coalesce(p_note, '')), ''), v_week,
          'CONFIRMED', auth.uid(), auth.uid(), now())
  returning * into v_row;

  insert into public.job_events (actor_id, actor_role, event_type, payload)
  values (auth.uid(), public.app_role(), 'cash_handover.recorded',
          jsonb_build_object('handover_id', v_row.id, 'staff_id', p_staff_id, 'amount', v_row.amount, 'method', p_method));
  return v_row;
end;
$fn$;

-- Undo a confirmed handover (kept on record) while its week is not paid out.
create or replace function public.void_cash_handover(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.cash_handovers;
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can cancel a handover' using errcode = 'insufficient_privilege';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why it is being cancelled';
  end if;
  select * into v_row from public.cash_handovers where id = p_id and voided_at is null for update;
  if not found then
    raise exception 'This handover is already cancelled';
  end if;
  if exists (select 1 from public.payouts
              where staff_id = v_row.staff_id and week_start >= v_row.week_start and reversed_at is null) then
    raise exception 'That week is already paid out. Reverse the payout first.';
  end if;
  update public.cash_handovers
     set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_id;
  insert into public.job_events (actor_id, actor_role, event_type, payload)
  values (auth.uid(), public.app_role(), 'cash_handover.voided',
          jsonb_build_object('handover_id', p_id, 'reason', trim(p_reason)));
end;
$fn$;

revoke execute on function public.declare_cash_handover(numeric, text, text) from public, anon;
revoke execute on function public.review_cash_handover(uuid, boolean, text) from public, anon;
revoke execute on function public.record_cash_handover(uuid, numeric, text, text) from public, anon;
revoke execute on function public.void_cash_handover(uuid, text) from public, anon;
revoke execute on function public.handed_back(uuid, date, boolean) from public, anon;
grant execute on function public.declare_cash_handover(numeric, text, text) to authenticated;
grant execute on function public.review_cash_handover(uuid, boolean, text) to authenticated;
grant execute on function public.record_cash_handover(uuid, numeric, text, text) to authenticated;
grant execute on function public.void_cash_handover(uuid, text) to authenticated;
grant execute on function public.handed_back(uuid, date, boolean) to authenticated;

-- The supervisor's own summary gains this week's handovers and any pending one.
drop function if exists public.my_pay_summary();
create function public.my_pay_summary()
returns table (
  staff_id            uuid,
  percent_now         numeric,
  lifetime_earned     numeric,
  next_from_earned    numeric,
  next_percent        numeric,
  today_earned        numeric,
  today_jobs_paid     int,
  today_expected      numeric,
  today_jobs_left     int,
  week_start          date,
  payout_day          date,
  week_earned         numeric,
  week_jobs           int,
  week_cash_collected numeric,
  brought_forward     numeric,
  week_net            numeric,
  week_settled        numeric,
  last7_earned        numeric,
  month_earned        numeric,
  last_month_earned   numeric,
  cash_collected_month numeric,
  cash_returned_total numeric,
  paid_to_me_total    numeric,
  week_handed_back    numeric,
  handover_pending    numeric
)
language plpgsql stable
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_s      public.pay_staff;
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_monday date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date;
  v_month  date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
  v_pct    numeric;
  v_life   numeric;
  v_bf     numeric;
begin
  select * into v_s from public.pay_staff where profile_id = auth.uid();
  if not found then
    return;
  end if;

  v_pct  := public.pay_percent(v_s.id, v_today);
  v_life := public.lifetime_earned(v_s.id, v_today + 1);
  v_bf   := public.pay_brought_forward(v_s.id, v_monday);

  return query
  with earn as (
    select e.amount, e.week_start, j.service_date
      from public.job_earnings e
      join public.jobs j on j.id = e.job_id
     where e.staff_id = v_s.id and e.voided_at is null
  ),
  left_today as (
    select j.quoted_amount
      from public.jobs j
     where j.assigned_supervisor_id = auth.uid()
       and j.service_date = v_today
       and j.status not in ('CANCELLED', 'NO_SHOW', 'DRAFT')
       and not exists (select 1 from public.job_earnings e
                        where e.job_id = j.id and e.staff_id = v_s.id and e.voided_at is null)
  ),
  nxt as (
    select t.from_earned, t.percent from public.pay_tiers t
     where t.kind = v_s.kind and t.from_earned > v_life
     order by t.from_earned limit 1
  ),
  wk as (
    select coalesce(sum(amount) filter (where week_start = v_monday), 0) as earned,
           count(*) filter (where week_start = v_monday)::int as jobs
      from earn
  ),
  cash as (
    select coalesce(sum(p.amount) filter (where p.week_start = v_monday), 0) as week_cash,
           coalesce(sum(p.amount) filter (where p.collected_at >= v_month), 0) as month_cash
      from public.payments p
     where p.held_by_staff_id = v_s.id and p.mode = 'cash' and p.voided_at is null
  ),
  hand as (
    select coalesce(sum(h.amount) filter (where h.status = 'CONFIRMED' and h.week_start = v_monday), 0) as week_back,
           coalesce(sum(h.amount) filter (where h.status = 'CONFIRMED'), 0) as all_back,
           coalesce(sum(h.amount) filter (where h.status = 'PENDING'), 0) as pending
      from public.cash_handovers h
     where h.staff_id = v_s.id and h.voided_at is null
  ),
  settled as (
    select coalesce(sum(-o.settled_amount) filter (where o.settled_amount < 0), 0) as returned,
           coalesce(sum(o.settled_amount) filter (where o.settled_amount > 0), 0) as paid,
           coalesce(sum(o.settled_amount) filter (where o.week_start = v_monday), 0) as this_week
      from public.payouts o
     where o.staff_id = v_s.id and o.reversed_at is null
  )
  select v_s.id, v_pct, v_life,
         (select from_earned from nxt), (select percent from nxt),
         coalesce((select sum(amount) from earn where service_date = v_today), 0),
         (select count(*)::int from earn where service_date = v_today),
         coalesce((select round(sum(coalesce(quoted_amount, 0)) * v_pct / 100, 2) from left_today), 0),
         (select count(*)::int from left_today),
         v_monday, v_monday + 7,
         wk.earned, wk.jobs, cash.week_cash, v_bf,
         v_bf + wk.earned - cash.week_cash + hand.week_back,
         settled.this_week,
         coalesce((select sum(amount) from earn where service_date > v_today - 7), 0),
         coalesce((select sum(amount) from earn where service_date >= v_month), 0),
         coalesce((select sum(amount) from earn
                    where service_date >= (v_month - interval '1 month')::date and service_date < v_month), 0),
         cash.month_cash, settled.returned + hand.all_back, settled.paid,
         hand.week_back, hand.pending
    from wk, cash, settled, hand;
end;
$fn$;

revoke execute on function public.my_pay_summary() from public, anon;
grant execute on function public.my_pay_summary() to authenticated;
