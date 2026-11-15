-- Daily expenses with a photo of the bill, and the business's profit.
--
-- A supervisor records money spent on the work (fuel, chemicals, tools, ...):
-- amount, category, whether it came out of customers' cash or their own
-- pocket, a bill photo and a note. Calling staff or an admin approve or reject
-- it. Nothing is deleted; an approved one can be cancelled with a reason while
-- its week is not paid out.
--
-- An approved expense counts in the person's favour like a cash handover:
-- paid from customers' cash it lowers what they still hold; paid from their
-- own money the company owes it back on Monday. Either way the weekly balance
-- gains the amount, so handed_back() now covers both.
--
-- business_profit(from, to): per day, money collected for that day's jobs,
-- the salaries on those jobs, approved expenses, and profit. Office only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-bills', 'expense-bills', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Upload only into your own folder: expense-bills/<your user id>/...
drop policy if exists expense_bill_upload on storage.objects;
create policy expense_bill_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'expense-bills' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists expense_bill_read on storage.objects;
create policy expense_bill_read on storage.objects
  for select to authenticated
  using (bucket_id = 'expense-bills'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin() or public.is_sales_rep()));

create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references public.pay_staff(id),
  spent_on      date not null default ((now() at time zone 'Asia/Kolkata')::date),
  week_start    date not null,
  category      text not null check (category in ('fuel', 'chemicals', 'tools', 'food', 'travel', 'other')),
  amount        numeric(12,2) not null check (amount > 0),
  paid_from     text not null check (paid_from in ('customer_cash', 'own_money')),
  bill_path     text,
  note          text,
  status        text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  reviewed_by   uuid references public.profiles(id),
  reviewed_at   timestamptz,
  reject_reason text,
  voided_at     timestamptz,
  voided_by     uuid references public.profiles(id),
  void_reason   text
);
create index if not exists expenses_staff_idx on public.expenses (staff_id, week_start);
create index if not exists expenses_day_idx on public.expenses (spent_on);

alter table public.expenses enable row level security;
drop policy if exists expenses_read on public.expenses;
create policy expenses_read on public.expenses
  for select to authenticated
  using (
    public.is_admin() or public.is_sales_rep()
    or exists (select 1 from public.pay_staff s where s.id = staff_id and s.profile_id = auth.uid())
  );
revoke all on public.expenses from anon, authenticated;
grant select on public.expenses to authenticated;

-- Confirmed handovers plus approved expenses, for one week or every week before.
create or replace function public.handed_back(p_staff_id uuid, p_week date, p_before boolean default false)
returns numeric
language sql stable
security definer
set search_path = ''
as $fn$
  select
    coalesce((select sum(h.amount) from public.cash_handovers h
               where h.staff_id = p_staff_id and h.status = 'CONFIRMED' and h.voided_at is null
                 and case when p_before then h.week_start < p_week else h.week_start = p_week end), 0)
  + coalesce((select sum(e.amount) from public.expenses e
               where e.staff_id = p_staff_id and e.status = 'APPROVED' and e.voided_at is null
                 and case when p_before then e.week_start < p_week else e.week_start = p_week end), 0)
$fn$;

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
         v_bf + wk.earned - cash.week_cash + public.handed_back(v_s.id, v_monday),
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
         v_bf + wk.earned - cash.week_cash + public.handed_back(v_s.id, v_monday),
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

create or replace function public.add_expense(
  p_amount    numeric,
  p_category  text,
  p_paid_from text,
  p_bill_path text,
  p_note      text default null,
  p_spent_on  date default null
)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff public.pay_staff;
  v_day   date := coalesce(p_spent_on, (now() at time zone 'Asia/Kolkata')::date);
  v_row   public.expenses;
begin
  select * into v_staff from public.pay_staff where profile_id = auth.uid();
  if not found then
    raise exception 'You are not on the pay list yet';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount spent';
  end if;
  if p_category not in ('fuel', 'chemicals', 'tools', 'food', 'travel', 'other') then
    raise exception 'Choose what it was for';
  end if;
  if p_paid_from not in ('customer_cash', 'own_money') then
    raise exception 'Say whose money paid for it';
  end if;
  if nullif(trim(coalesce(p_bill_path, '')), '') is null then
    raise exception 'Add a photo of the bill';
  end if;
  if split_part(p_bill_path, '/', 1) <> auth.uid()::text then
    raise exception 'That bill photo is not yours';
  end if;
  if v_day > (now() at time zone 'Asia/Kolkata')::date or v_day < (now() at time zone 'Asia/Kolkata')::date - 7 then
    raise exception 'Expenses can be added for today or the last 7 days';
  end if;

  insert into public.expenses (staff_id, spent_on, week_start, category, amount, paid_from, bill_path, note, created_by)
  values (v_staff.id, v_day, date_trunc('week', v_day::timestamp)::date, p_category, round(p_amount, 2),
          p_paid_from, p_bill_path, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_row;

  insert into public.job_events (actor_id, actor_role, event_type, payload)
  values (auth.uid(), public.app_role(), 'expense.added',
          jsonb_build_object('expense_id', v_row.id, 'amount', v_row.amount, 'category', p_category, 'paid_from', p_paid_from));
  return v_row;
end;
$fn$;

create or replace function public.review_expense(p_id uuid, p_approve boolean, p_reason text default null)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.expenses;
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can approve expenses' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.expenses where id = p_id for update;
  if not found or v_row.status <> 'PENDING' or v_row.voided_at is not null then
    raise exception 'This expense is not waiting for review';
  end if;
  if not p_approve and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why it is rejected';
  end if;
  if p_approve and exists (select 1 from public.payouts
                            where staff_id = v_row.staff_id and week_start >= v_row.week_start and reversed_at is null) then
    raise exception 'That week is already paid out. Reverse the payout first.';
  end if;
  update public.expenses
     set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
         reviewed_by = auth.uid(), reviewed_at = now(),
         reject_reason = case when p_approve then null else trim(p_reason) end
   where id = p_id
   returning * into v_row;
  insert into public.job_events (actor_id, actor_role, event_type, payload)
  values (auth.uid(), public.app_role(), case when p_approve then 'expense.approved' else 'expense.rejected' end,
          jsonb_build_object('expense_id', p_id, 'amount', v_row.amount, 'reason', v_row.reject_reason));
  return v_row;
end;
$fn$;

create or replace function public.void_expense(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.expenses;
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can cancel an expense' using errcode = 'insufficient_privilege';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why it is being cancelled';
  end if;
  select * into v_row from public.expenses where id = p_id and voided_at is null for update;
  if not found then
    raise exception 'This expense is already cancelled';
  end if;
  if exists (select 1 from public.payouts
              where staff_id = v_row.staff_id and week_start >= v_row.week_start and reversed_at is null) then
    raise exception 'That week is already paid out. Reverse the payout first.';
  end if;
  update public.expenses set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason) where id = p_id;
  insert into public.job_events (actor_id, actor_role, event_type, payload)
  values (auth.uid(), public.app_role(), 'expense.voided', jsonb_build_object('expense_id', p_id, 'reason', trim(p_reason)));
end;
$fn$;

-- Profit per day: what the jobs of that day brought in, less their salaries,
-- less that day's approved expenses.
create or replace function public.business_profit(p_from date, p_to date)
returns table (day date, jobs int, revenue numeric, salaries numeric, expenses numeric, profit numeric)
language plpgsql stable
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can see profit' using errcode = 'insufficient_privilege';
  end if;
  if p_to < p_from or p_to - p_from > 370 then
    raise exception 'Choose a range of up to a year';
  end if;
  return query
  with d as (select generate_series(p_from, p_to, interval '1 day')::date as day),
  rev as (
    select j.service_date as day, count(distinct j.id)::int as jobs, sum(p.amount) as revenue
      from public.payments p join public.jobs j on j.id = p.job_id
     where p.voided_at is null and j.service_date between p_from and p_to
     group by 1
  ),
  sal as (
    select j.service_date as day, sum(e.amount) as salaries
      from public.job_earnings e join public.jobs j on j.id = e.job_id
     where e.voided_at is null and j.service_date between p_from and p_to
     group by 1
  ),
  ex as (
    select x.spent_on as day, sum(x.amount) as expenses
      from public.expenses x
     where x.status = 'APPROVED' and x.voided_at is null and x.spent_on between p_from and p_to
     group by 1
  )
  select d.day,
         coalesce(rev.jobs, 0),
         coalesce(rev.revenue, 0),
         coalesce(sal.salaries, 0),
         coalesce(ex.expenses, 0),
         coalesce(rev.revenue, 0) - coalesce(sal.salaries, 0) - coalesce(ex.expenses, 0)
    from d
    left join rev on rev.day = d.day
    left join sal on sal.day = d.day
    left join ex on ex.day = d.day
   order by d.day desc;
end;
$fn$;

revoke execute on function public.add_expense(numeric, text, text, text, text, date) from public, anon;
revoke execute on function public.review_expense(uuid, boolean, text) from public, anon;
revoke execute on function public.void_expense(uuid, text) from public, anon;
revoke execute on function public.business_profit(date, date) from public, anon;
grant execute on function public.add_expense(numeric, text, text, text, text, date) to authenticated;
grant execute on function public.review_expense(uuid, boolean, text) to authenticated;
grant execute on function public.void_expense(uuid, text) to authenticated;
grant execute on function public.business_profit(date, date) to authenticated;
