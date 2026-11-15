-- Unpaid training days for new workers.
--
-- A worker's first N working days (default 2, set by an admin on Pay rates)
-- earn 0%. A "working day" is a day they were ticked on at least one paid job;
-- several jobs on one day count once. The job still records the worker with
-- 0%, so the office can see they were there, and the percentage is frozen on
-- the job as always, so changing N later never rewrites past pay.
-- Supervisors are not affected.

insert into public.app_settings (key, value, description)
values ('pay.training_days', '2'::jsonb, 'Unpaid training days at the start of a new worker''s work')
on conflict (key) do nothing;

-- Days a person had worked before a given day.
create or replace function public.days_worked_before(p_staff_id uuid, p_before date)
returns int
language sql stable
security definer
set search_path = ''
as $fn$
  select count(distinct j.service_date)::int
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
  select case
    when s.kind = 'worker'
     and s.fixed_percent is null
     and public.days_worked_before(s.id, p_on) < public.setting_num('pay.training_days', 2)
      then 0
    else coalesce(
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
  end
    from public.pay_staff s
   where s.id = p_staff_id
$fn$;

-- Admin sets how many training days.
create or replace function public.set_training_days(p_days int)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change training days' using errcode = 'insufficient_privilege';
  end if;
  if p_days is null or p_days < 0 or p_days > 30 then
    raise exception 'Training days must be between 0 and 30';
  end if;
  insert into public.app_settings (key, value, description, updated_by, updated_at)
  values ('pay.training_days', to_jsonb(p_days), 'Unpaid training days at the start of a new worker''s work', auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.job_events (actor_id, actor_role, event_type, payload)
  values (auth.uid(), public.app_role(), 'pay.training_days_changed', jsonb_build_object('days', p_days));
end;
$fn$;

revoke execute on function public.set_training_days(int) from public, anon;
grant execute on function public.set_training_days(int) to authenticated;
revoke execute on function public.days_worked_before(uuid, date) from public, anon;
grant execute on function public.days_worked_before(uuid, date) to authenticated;
