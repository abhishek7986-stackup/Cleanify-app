-- Pay rates set by the admin, rising with what a person has earned, and one
-- summary of a supervisor's own money for the Payments screen.
--
-- 1. pay_tiers: for workers and for supervisors separately, the percentage
--    from each lifetime-earnings milestone ("14% from Rs 0, 15% once Rs 20,000
--    earned, 17% once Rs 50,000 earned"). Only an admin sets them.
-- 2. pay_percent() now decides, in order: the person's fixed percentage (set
--    on Team %) -> the milestone they have reached -> the old monthly rise
--    when no milestones exist yet for their kind, so nothing changes until the
--    admin saves some. Each job still freezes the percentage it was paid at.
-- 3. my_pay_summary(): today, this week (paid out on Monday), last 7 days,
--    this and last month, and the cash position, for the signed-in supervisor.

create table if not exists public.pay_tiers (
  kind        text not null check (kind in ('supervisor', 'worker')),
  from_earned numeric(12,2) not null check (from_earned >= 0),
  percent     numeric(5,2) not null check (percent between 0 and 100),
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  primary key (kind, from_earned)
);

alter table public.pay_tiers enable row level security;
drop policy if exists pay_tiers_read on public.pay_tiers;
create policy pay_tiers_read on public.pay_tiers for select to authenticated using (true);
revoke all on public.pay_tiers from anon, authenticated;
grant select on public.pay_tiers to authenticated;

-- What a person had earned before a given day (their own salary, not the job totals).
create or replace function public.lifetime_earned(p_staff_id uuid, p_before date)
returns numeric
language sql stable
security definer
set search_path = ''
as $fn$
  select coalesce(sum(e.amount), 0)
    from public.job_earnings e
    join public.jobs j on j.id = e.job_id
   where e.staff_id = p_staff_id and e.voided_at is null and j.service_date < p_before
$fn$;

create or replace function public.pay_percent(p_staff_id uuid, p_on date)
returns numeric
language sql stable
security definer
set search_path = ''
as $fn$
  select coalesce(
           s.fixed_percent,
           (select t.percent from public.pay_tiers t
             where t.kind = s.kind
               and t.from_earned <= public.lifetime_earned(s.id, p_on)
             order by t.from_earned desc
             limit 1),
           greatest(s.start_percent,
             least(s.max_percent,
               s.start_percent + greatest(0,
                 (extract(year  from age(p_on::timestamp, s.joined_on::timestamp)) * 12
                + extract(month from age(p_on::timestamp, s.joined_on::timestamp)))::int))))
    from public.pay_staff s
   where s.id = p_staff_id
$fn$;

-- Admin saves the whole ladder for one kind at once.
-- p_tiers: [{"from_earned": 0, "percent": 14}, {"from_earned": 20000, "percent": 15}, ...]
create or replace function public.set_pay_tiers(p_kind text, p_tiers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_t      jsonb;
  v_prev_e numeric := -1;
  v_from   numeric;
  v_pct    numeric;
  v_n      int := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change pay rates' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('supervisor', 'worker') then
    raise exception 'Choose workers or supervisors';
  end if;
  if jsonb_typeof(p_tiers) is distinct from 'array' then
    raise exception 'Send the rates as a list';
  end if;

  for v_t in select * from jsonb_array_elements(p_tiers) loop
    v_from := (v_t ->> 'from_earned')::numeric;
    v_pct  := (v_t ->> 'percent')::numeric;
    v_n := v_n + 1;
    if v_from is null or v_pct is null then
      raise exception 'Every row needs an amount and a percentage';
    end if;
    if v_n = 1 and v_from <> 0 then
      raise exception 'The first rate must start from Rs 0';
    end if;
    if v_from <= v_prev_e then
      raise exception 'Milestones must go up: each one larger than the one before';
    end if;
    if v_pct not between 0 and 100 then
      raise exception 'A percentage must be between 0 and 100';
    end if;
    v_prev_e := v_from;
  end loop;

  delete from public.pay_tiers where kind = p_kind;
  insert into public.pay_tiers (kind, from_earned, percent, updated_by)
  select p_kind, (t ->> 'from_earned')::numeric, (t ->> 'percent')::numeric, auth.uid()
    from jsonb_array_elements(p_tiers) t;

  insert into public.job_events (actor_id, actor_role, event_type, payload)
  values (auth.uid(), public.app_role(), 'pay_tiers.changed',
          jsonb_build_object('kind', p_kind, 'tiers', p_tiers));
end;
$fn$;

revoke execute on function public.set_pay_tiers(text, jsonb) from public, anon;
grant execute on function public.set_pay_tiers(text, jsonb) to authenticated;
revoke execute on function public.lifetime_earned(uuid, date) from public, anon;
grant execute on function public.lifetime_earned(uuid, date) to authenticated;

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
