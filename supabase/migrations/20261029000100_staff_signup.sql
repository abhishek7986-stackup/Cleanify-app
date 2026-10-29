-- ============================================================================
-- Cleanify Ops — 30. New staff sign up themselves, with ID documents
-- ============================================================================
-- A new worker opens the app, taps "New staff? Create your account", and
-- gives their name, mobile number, address, a password and two documents:
-- Aadhaar (always) plus a driving licence, or the back of the Aadhaar when
-- they have no licence. The account exists straight away but is INACTIVE:
-- they can sign in only to see "waiting for approval" until an admin checks
-- the documents and approves, assigning the depot they start from.
--
-- Documents are kept permanently in a private bucket, readable only through
-- the admin screens. A rejection keeps them too, as the record of what was
-- submitted.
--
-- Also closes an older gap: roles came from the JWT with no regard to
-- is_active, so a deactivated member of staff kept every permission. app_role()
-- now returns null for an inactive account, which disables every role check.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- An inactive account has no role.
-- ---------------------------------------------------------------------------
create or replace function public.app_role()
returns public.user_role
language sql stable
set search_path = ''
as $fn$
  select case
           when (auth.jwt() -> 'app_metadata' ->> 'is_active') = 'false' then null
           else nullif(auth.jwt() -> 'app_metadata' ->> 'role', '')::public.user_role
         end
$fn$;

-- ---------------------------------------------------------------------------
-- Applications and their documents
-- ---------------------------------------------------------------------------
create type public.staff_doc_kind as enum ('AADHAAR_FRONT', 'AADHAAR_BACK', 'DRIVING_LICENCE');

create table public.staff_applications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references public.profiles(id) on delete cascade,
  full_name        text not null,
  phone            text not null,
  address          text not null,
  has_licence      boolean not null,
  status           public.approval_status not null default 'PENDING',
  submitted_at     timestamptz not null default now(),
  reviewed_by      uuid references public.profiles(id),
  reviewed_at      timestamptz,
  rejection_reason text
);

create index staff_applications_pending_idx on public.staff_applications (submitted_at)
  where status = 'PENDING';

create table public.staff_documents (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.staff_applications(id) on delete cascade,
  kind           public.staff_doc_kind not null,
  storage_path   text not null unique,
  mime_type      text not null,
  bytes          int not null,
  uploaded_at    timestamptz not null default now(),
  unique (application_id, kind)
);

alter table public.staff_applications enable row level security;
alter table public.staff_documents    enable row level security;

grant select on public.staff_applications, public.staff_documents to authenticated;

-- The applicant can see their own application (for the status screen),
-- never anyone else's; documents are admin only. All writes go through the
-- signup route (service role) or admin_review_staff_application().
create policy staff_applications_read on public.staff_applications
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy staff_documents_admin_read on public.staff_documents
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Private bucket for ID documents. No client policies at all: uploads come
-- from the signup route with the service role, and reads are signed URLs the
-- server mints after checking the caller is an admin.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-documents', 'staff-documents', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- admin_review_staff_application
-- Approving activates the account and sets the depot, which every check-in
-- deadline is measured from, so a depot is required to approve.
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_staff_application(
  p_application_id uuid,
  p_approve        boolean,
  p_reason         text default null,
  p_depot_lat      double precision default null,
  p_depot_lng      double precision default null,
  p_depot_address  text default null
)
returns public.staff_applications
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_app public.staff_applications;
  v_docs int;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can approve new staff' using errcode = 'insufficient_privilege';
  end if;

  select * into v_app from public.staff_applications where id = p_application_id for update;
  if not found then
    raise exception 'Application not found' using errcode = 'no_data_found';
  end if;
  if v_app.status <> 'PENDING' then
    raise exception 'This application was already %', lower(v_app.status::text)
      using errcode = 'check_violation';
  end if;

  if not p_approve then
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'A rejection needs a reason' using errcode = 'check_violation';
    end if;
    update public.staff_applications
       set status = 'REJECTED', reviewed_by = v_uid, reviewed_at = now(),
           rejection_reason = trim(p_reason)
     where id = p_application_id
     returning * into v_app;
    return v_app;
  end if;

  select count(*) into v_docs from public.staff_documents where application_id = p_application_id;
  if v_docs < 2 then
    raise exception 'This application has only % document(s); two are required', v_docs
      using errcode = 'check_violation';
  end if;
  if p_depot_lat is null or p_depot_lng is null then
    raise exception 'Choose the depot this person starts from' using errcode = 'check_violation';
  end if;

  update public.profiles
     set is_active = true,
         full_name = v_app.full_name,
         phone = v_app.phone,
         base_location = extensions.st_setsrid(
                           extensions.st_makepoint(p_depot_lng, p_depot_lat), 4326)::extensions.geography,
         base_address = p_depot_address,
         base_location_updated_at = now()
   where id = v_app.user_id;

  update public.staff_applications
     set status = 'APPROVED', reviewed_by = v_uid, reviewed_at = now(), rejection_reason = null
   where id = p_application_id
   returning * into v_app;

  return v_app;
end;
$fn$;

revoke all on function public.admin_review_staff_application(uuid, boolean, text,
  double precision, double precision, text) from public, anon;
grant execute on function public.admin_review_staff_application(uuid, boolean, text,
  double precision, double precision, text) to authenticated;
