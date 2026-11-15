-- A supervisor sees the current percentage of the workers on their own team,
-- so the job details can show what each would earn from the job. Names and
-- rates only, nothing else about their pay, and only their own team.

create or replace function public.my_team_rates()
returns table (staff_id uuid, full_name text, percent numeric, in_training boolean)
language sql stable
security definer
set search_path = ''
as $fn$
  select s.id, s.full_name,
         public.pay_percent(s.id, (now() at time zone 'Asia/Kolkata')::date),
         s.fixed_percent is null
           and public.days_worked_before(s.id, (now() at time zone 'Asia/Kolkata')::date)
               < public.setting_num('pay.training_days', 2)
    from public.pay_staff s
   where s.kind = 'worker' and s.is_active
     and s.team_supervisor_id = auth.uid()
   order by s.full_name
$fn$;

revoke execute on function public.my_team_rates() from public, anon;
grant execute on function public.my_team_rates() to authenticated;
