-- Proof for UPI payments, and the company UPI ID locked to admins.
--
-- After the customer pays by UPI, the supervisor proves it one of three ways:
--   camera      a live photo of the customer's "payment successful" screen
--   screenshot  an image the customer sent (e.g. on WhatsApp)
--   call        no image possible: the office confirms by phone with the
--               customer and taps "Confirmed on call"
-- The office still checks the bank ("Found in bank") as before.
--
-- The UPI ID customers pay into can now be changed only by an admin, and each
-- change is logged with the old and new ID: a swapped UPI ID would quietly
-- divert every customer payment.

alter table public.payments
  add column if not exists proof_kind text check (proof_kind in ('camera', 'screenshot', 'call')),
  add column if not exists proof_path text,
  add column if not exists proof_confirmed_at timestamptz,
  add column if not exists proof_confirmed_by uuid references public.profiles(id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists payment_proof_upload on storage.objects;
create policy payment_proof_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists payment_proof_read on storage.objects;
create policy payment_proof_read on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin() or public.is_sales_rep()));

-- The supervisor attaches proof to the job's UPI payment right after marking it.
create or replace function public.attach_payment_proof(p_job_id uuid, p_kind text, p_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job public.jobs;
  v_n   int;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    raise exception 'Job not found';
  end if;
  if v_job.assigned_supervisor_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Only this job''s supervisor can add the payment proof' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('camera', 'screenshot', 'call') then
    raise exception 'Choose how the payment is proved';
  end if;
  if p_kind <> 'call' then
    if nullif(trim(coalesce(p_path, '')), '') is null then
      raise exception 'Add the photo of the payment';
    end if;
    if split_part(p_path, '/', 1) <> auth.uid()::text then
      raise exception 'That photo is not yours';
    end if;
  end if;

  update public.payments
     set proof_kind = p_kind,
         proof_path = case when p_kind = 'call' then null else p_path end
   where job_id = p_job_id and mode = 'upi' and voided_at is null and proof_kind is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'There is no UPI payment on this job waiting for proof';
  end if;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (p_job_id, auth.uid(), public.app_role(), 'payment.proof_added', jsonb_build_object('kind', p_kind));
end;
$fn$;

-- The office confirms a "call to confirm" payment after speaking to the customer.
create or replace function public.confirm_payment_call(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job uuid;
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can confirm a payment' using errcode = 'insufficient_privilege';
  end if;
  update public.payments
     set proof_confirmed_at = now(), proof_confirmed_by = auth.uid()
   where id = p_payment_id and proof_kind = 'call' and proof_confirmed_at is null and voided_at is null
  returning job_id into v_job;
  if v_job is null then
    raise exception 'This payment is not waiting for a call confirmation';
  end if;
  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (v_job, auth.uid(), public.app_role(), 'payment.call_confirmed', jsonb_build_object('payment_id', p_payment_id));
end;
$fn$;

-- Only an admin may set the UPI ID customers pay into; every change is logged.
create or replace function public.set_upi_details(p_upi_id text, p_payee_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_old jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change the company UPI ID' using errcode = 'insufficient_privilege';
  end if;
  if trim(coalesce(p_upi_id, '')) !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'That does not look like a UPI ID. It should look like name@bank.';
  end if;
  if nullif(trim(coalesce(p_payee_name, '')), '') is null then
    raise exception 'Enter the name customers should see';
  end if;
  select value into v_old from public.app_settings where key = 'payments.upi';
  insert into public.app_settings (key, value, description, updated_by, updated_at)
  values ('payments.upi', jsonb_build_object('id', trim(p_upi_id), 'name', trim(p_payee_name)),
          'UPI ID and name shown in the customer QR.', auth.uid(), now())
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  insert into public.job_events (actor_id, actor_role, event_type, payload)
  values (auth.uid(), public.app_role(), 'upi.changed',
          jsonb_build_object('from', v_old, 'to', jsonb_build_object('id', trim(p_upi_id), 'name', trim(p_payee_name))));
end;
$fn$;

revoke execute on function public.attach_payment_proof(uuid, text, text) from public, anon;
revoke execute on function public.confirm_payment_call(uuid) from public, anon;
grant execute on function public.attach_payment_proof(uuid, text, text) to authenticated;
grant execute on function public.confirm_payment_call(uuid) to authenticated;
