-- Fix for 20261116001000: the "only yourself" check compared a worker's empty
-- profile_id with the caller, which is NULL rather than false, so it let a
-- supervisor read a worker's money. Treat "no login" as "not you".

create or replace function public.staff_pay_summary(p_staff_id uuid)
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
  select * into v_s from public.pay_staff where id = p_staff_id;
  if not found then
    return;
  end if;
  if not (public.is_admin() or public.is_sales_rep() or v_s.profile_id is not distinct from auth.uid() and v_s.profile_id is not null) then
    raise exception 'You can only see your own money' using errcode = 'insufficient_privilege';
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
     where j.assigned_supervisor_id = v_s.profile_id
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

revoke execute on function public.staff_pay_summary(uuid) from public, anon;
grant execute on function public.staff_pay_summary(uuid) to authenticated;


create or replace function public.staff_daily(p_staff_id uuid, p_days int default 7)
returns table (
  day            date,
  jobs           int,
  cash_collected numeric,
  upi_collected  numeric,
  earned         numeric
)
language plpgsql stable
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_s     public.pay_staff;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into v_s from public.pay_staff where id = p_staff_id;
  if not found then
    return;
  end if;
  if not (public.is_admin() or public.is_sales_rep() or v_s.profile_id is not distinct from auth.uid() and v_s.profile_id is not null) then
    raise exception 'You can only see your own money' using errcode = 'insufficient_privilege';
  end if;

  return query
  with days as (
    select (v_today - g)::date as d from generate_series(0, greatest(least(p_days, 62), 1) - 1) g
  )
  select d.d,
         (select count(*)::int from public.job_earnings e join public.jobs j on j.id = e.job_id
           where e.staff_id = v_s.id and e.voided_at is null and j.service_date = d.d),
         coalesce((select sum(p.amount) from public.payments p
                    where p.held_by_staff_id = v_s.id and p.mode = 'cash' and p.voided_at is null
                      and (p.collected_at at time zone 'Asia/Kolkata')::date = d.d), 0),
         coalesce((select sum(p.amount) from public.payments p join public.jobs j on j.id = p.job_id
                    where v_s.profile_id is not null and j.assigned_supervisor_id = v_s.profile_id
                      and p.mode = 'upi' and p.voided_at is null
                      and (p.collected_at at time zone 'Asia/Kolkata')::date = d.d), 0),
         coalesce((select sum(e.amount) from public.job_earnings e join public.jobs j on j.id = e.job_id
                    where e.staff_id = v_s.id and e.voided_at is null and j.service_date = d.d), 0)
    from days d
   order by d.d desc;
end;
$fn$;

revoke execute on function public.staff_daily(uuid, int) from public, anon;
grant execute on function public.staff_daily(uuid, int) to authenticated;
