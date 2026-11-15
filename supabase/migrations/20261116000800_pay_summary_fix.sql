-- Fix for 20261116000700: my_pay_summary's output columns (week_start, ...)
-- share names with table columns it reads, which PL/pgSQL rejects as
-- ambiguous. Prefer the table columns inside the query.

-- The signed-in supervisor's own money, in one row.
create or replace function public.my_pay_summary()
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
  paid_to_me_total    numeric
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
         v_bf + wk.earned - cash.week_cash,
         settled.this_week,
         coalesce((select sum(amount) from earn where service_date > v_today - 7), 0),
         coalesce((select sum(amount) from earn where service_date >= v_month), 0),
         coalesce((select sum(amount) from earn
                    where service_date >= (v_month - interval '1 month')::date and service_date < v_month), 0),
         cash.month_cash, settled.returned, settled.paid
    from wk, cash, settled;
end;
$fn$;

revoke execute on function public.my_pay_summary() from public, anon;
grant execute on function public.my_pay_summary() to authenticated;
