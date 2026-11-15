-- Workers have no login, so their supervisor sees their pay: for each worker
-- on the caller's team, the rate, today's and this week's earnings, this
-- month's, and how last week was settled. Own team only.

create or replace function public.my_team_pay()
returns table (
  staff_id        uuid,
  full_name       text,
  percent         numeric,
  in_training     boolean,
  today_earned    numeric,
  week_earned     numeric,
  week_jobs       int,
  month_earned    numeric,
  last_week_due   numeric,
  last_week_paid  numeric,
  last_week_paid_at timestamptz,
  payout_day      date
)
language plpgsql stable
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_monday date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date;
  v_month  date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
begin
  return query
  select s.id, s.full_name,
         public.pay_percent(s.id, v_today),
         s.fixed_percent is null and public.days_worked_before(s.id, v_today) < public.setting_num('pay.training_days', 2),
         coalesce((select sum(e.amount) from public.job_earnings e join public.jobs j on j.id = e.job_id
                    where e.staff_id = s.id and e.voided_at is null and j.service_date = v_today), 0),
         coalesce((select sum(e.amount) from public.job_earnings e
                    where e.staff_id = s.id and e.voided_at is null and e.week_start = v_monday), 0),
         (select count(*)::int from public.job_earnings e
           where e.staff_id = s.id and e.voided_at is null and e.week_start = v_monday),
         coalesce((select sum(e.amount) from public.job_earnings e join public.jobs j on j.id = e.job_id
                    where e.staff_id = s.id and e.voided_at is null and j.service_date >= v_month), 0),
         public.pay_brought_forward(s.id, v_monday - 7)
           + coalesce((select sum(e.amount) from public.job_earnings e
                        where e.staff_id = s.id and e.voided_at is null and e.week_start = v_monday - 7), 0),
         (select o.settled_amount from public.payouts o
           where o.staff_id = s.id and o.week_start = v_monday - 7 and o.reversed_at is null),
         (select o.settled_at from public.payouts o
           where o.staff_id = s.id and o.week_start = v_monday - 7 and o.reversed_at is null),
         v_monday + 7
    from public.pay_staff s
   where s.kind = 'worker' and s.is_active and s.team_supervisor_id = auth.uid()
   order by s.full_name;
end;
$fn$;

revoke execute on function public.my_team_pay() from public, anon;
grant execute on function public.my_team_pay() to authenticated;
