-- ============================================================================
-- Cleanify Ops — 05. Core functions: identity, validation, immutability
-- ============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Identity helpers.
-- Role is read from the JWT, not looked up in profiles, so an RLS policy does
-- not cost a row lookup per row scanned.
-- ---------------------------------------------------------------------------
create or replace function public.app_role()
returns public.user_role
language sql stable
set search_path = ''
as $fn$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'role', '')::public.user_role
$fn$;

create or replace function public.is_admin()
returns boolean
language sql stable
set search_path = ''
as $fn$
  select coalesce(public.app_role() = 'admin', false)
$fn$;

create or replace function public.is_sales_rep()
returns boolean
language sql stable
set search_path = ''
as $fn$
  select coalesce(public.app_role() = 'sales_rep', false)
$fn$;

create or replace function public.is_supervisor()
returns boolean
language sql stable
set search_path = ''
as $fn$
  select coalesce(public.app_role() = 'supervisor', false)
$fn$;

-- ---------------------------------------------------------------------------
-- Supabase Auth hook: mirror profiles.role into the JWT's app_metadata.
-- Register at Dashboard → Authentication → Hooks → Custom Access Token.
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $fn$
declare
  claims    jsonb;
  meta      jsonb;
  v_role    public.user_role;
  v_active  boolean;
begin
  select p.role, p.is_active
    into v_role, v_active
    from public.profiles p
   where p.id = (event ->> 'user_id')::uuid;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  meta   := coalesce(claims -> 'app_metadata', '{}'::jsonb);

  if v_role is not null then
    meta := meta || jsonb_build_object('role', v_role::text,
                                       'is_active', coalesce(v_active, false));
  end if;

  claims := jsonb_set(claims, '{app_metadata}', meta);
  return jsonb_set(event, '{claims}', claims);
end;
$fn$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on table public.profiles to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

create trigger touch_profiles    before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger touch_services    before update on public.services
  for each row execute function public.touch_updated_at();
create trigger touch_clients     before update on public.clients
  for each row execute function public.touch_updated_at();
create trigger touch_jobs        before update on public.jobs
  for each row execute function public.touch_updated_at();
create trigger touch_day_rosters before update on public.day_rosters
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- job_events is append-only. Without this the audit log is only as trustworthy
-- as whoever last had a service-role key.
-- ---------------------------------------------------------------------------
create or replace function public.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'Table %.% is append-only', tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$fn$;

create trigger job_events_append_only
  before update or delete on public.job_events
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- A published field key is immutable. Answers are stored keyed by `key`, so
-- renaming one silently orphans every historical answer.
-- ---------------------------------------------------------------------------
create or replace function public.guard_published_field()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_status public.schema_status;
begin
  select s.status into v_status
    from public.service_field_schemas s
   where s.id = coalesce(new.schema_id, old.schema_id);

  if v_status <> 'published' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Cannot delete field "%" from a published schema — set archived_at instead', old.key
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'UPDATE' and new.key is distinct from old.key then
    raise exception 'Field key "%" is immutable once published (attempted rename to "%")', old.key, new.key
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'UPDATE' and new.field_type is distinct from old.field_type then
    raise exception 'Field type for "%" is immutable once published — publish a new schema version instead', old.key
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$fn$;

create trigger service_fields_guard
  before update or delete on public.service_fields
  for each row execute function public.guard_published_field();

-- ---------------------------------------------------------------------------
-- Visibility rule evaluation: {"field":"tank_type","op":"eq","value":"concrete"}
-- A field that is hidden is not required.
-- ---------------------------------------------------------------------------
create or replace function public.eval_visibility_rule(p_rule jsonb, p_payload jsonb)
returns boolean
language plpgsql immutable
set search_path = ''
as $fn$
declare
  v_op     text;
  v_actual jsonb;
  v_expect jsonb;
begin
  if p_rule is null or p_rule = 'null'::jsonb then
    return true;                                   -- no rule means always shown
  end if;

  v_op     := coalesce(p_rule ->> 'op', 'eq');
  v_actual := p_payload -> (p_rule ->> 'field');
  v_expect := p_rule -> 'value';

  return case v_op
    when 'eq' then v_actual is not distinct from v_expect
    when 'ne' then v_actual is distinct from v_expect
    when 'in' then v_expect @> coalesce(v_actual, 'null'::jsonb)
    when 'gt' then (v_actual #>> '{}')::numeric >  (v_expect #>> '{}')::numeric
    when 'lt' then (v_actual #>> '{}')::numeric <  (v_expect #>> '{}')::numeric
    when 'truthy' then coalesce((v_actual #>> '{}')::boolean, false)
    else true
  end;
exception when others then
  return true;    -- a malformed rule must never hide a field and lose an answer
end;
$fn$;

-- ---------------------------------------------------------------------------
-- validate_service_details — the database is authoritative.
-- The client generates a Zod schema from the same service_fields rows, but a
-- client cannot be trusted to be the only writer. Returns a list of human
-- readable errors; empty means valid.
-- ---------------------------------------------------------------------------
create or replace function public.validate_service_details(p_schema_id uuid, p_payload jsonb)
returns text[]
language plpgsql stable
set search_path = ''
as $fn$
declare
  errs    text[] := '{}';
  f       record;
  val     jsonb;
  vtype   text;
  known   text[] := '{}';
  extra   text;
  opts    jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return array['payload must be a JSON object'];
  end if;

  for f in
    select * from public.service_fields
     where schema_id = p_schema_id and archived_at is null
     order by sort_order
  loop
    known := known || f.key;
    val   := p_payload -> f.key;
    vtype := jsonb_typeof(val);

    -- a hidden field is neither required nor validated
    if not public.eval_visibility_rule(f.visibility_rule, p_payload) then
      continue;
    end if;

    if val is null or vtype = 'null'
       or (vtype = 'string' and length(trim(val #>> '{}')) = 0) then
      if f.is_required then
        errs := errs || format('%s is required', f.label);
      end if;
      continue;
    end if;

    case f.field_type
      when 'text', 'textarea', 'date', 'time' then
        if vtype <> 'string' then
          errs := errs || format('%s must be text', f.label);
        elsif f.config ? 'maxLength'
          and length(val #>> '{}') > (f.config ->> 'maxLength')::int then
          errs := errs || format('%s must be at most %s characters',
                                 f.label, f.config ->> 'maxLength');
        end if;

      when 'number', 'currency', 'integer' then
        if vtype <> 'number' then
          errs := errs || format('%s must be a number', f.label);
        else
          if f.field_type = 'integer'
             and (val #>> '{}')::numeric <> trunc((val #>> '{}')::numeric) then
            errs := errs || format('%s must be a whole number', f.label);
          end if;
          if f.config ? 'min' and (val #>> '{}')::numeric < (f.config ->> 'min')::numeric then
            errs := errs || format('%s must be at least %s', f.label, f.config ->> 'min');
          end if;
          if f.config ? 'max' and (val #>> '{}')::numeric > (f.config ->> 'max')::numeric then
            errs := errs || format('%s must be at most %s', f.label, f.config ->> 'max');
          end if;
        end if;

      when 'boolean' then
        if vtype <> 'boolean' then
          errs := errs || format('%s must be true or false', f.label);
        end if;

      when 'select' then
        opts := coalesce(f.config -> 'options', '[]'::jsonb);
        if vtype <> 'string' then
          errs := errs || format('%s must be one of the listed options', f.label);
        elsif not exists (
          select 1 from jsonb_array_elements(opts) o
           where o ->> 'value' = val #>> '{}'
        ) then
          errs := errs || format('%s: "%s" is not a valid option', f.label, val #>> '{}');
        end if;

      when 'multiselect' then
        opts := coalesce(f.config -> 'options', '[]'::jsonb);
        if vtype <> 'array' then
          errs := errs || format('%s must be a list', f.label);
        elsif exists (
          select 1 from jsonb_array_elements_text(val) sel
           where not exists (
             select 1 from jsonb_array_elements(opts) o where o ->> 'value' = sel
           )
        ) then
          errs := errs || format('%s contains an option that is not in the list', f.label);
        end if;

      else
        null;   -- a field_type added later must not blow up validation
    end case;
  end loop;

  -- Reject unknown keys outright. Silently accepting them is how a renamed
  -- field turns into two half-populated columns nobody can reconcile.
  for extra in select k from jsonb_object_keys(p_payload) k loop
    if not (extra = any (known)) then
      errs := errs || format('unknown field "%s" for this service', extra);
    end if;
  end loop;

  return errs;
end;
$fn$;

-- trigger wrappers -----------------------------------------------------------
create or replace function public.enforce_job_details()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare errs text[];
begin
  errs := public.validate_service_details(new.job_field_schema_id, new.service_details);
  if array_length(errs, 1) > 0 then
    raise exception 'Invalid service details: %', array_to_string(errs, '; ')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

create trigger jobs_validate_details
  before insert or update of service_details, job_field_schema_id on public.jobs
  for each row execute function public.enforce_job_details();

create or replace function public.enforce_line_item_details()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare errs text[];
begin
  errs := public.validate_service_details(new.schema_id, new.details);
  if array_length(errs, 1) > 0 then
    raise exception 'Invalid % details: %',
      coalesce(new.label, 'line item'), array_to_string(errs, '; ')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

create trigger job_line_items_validate_details
  before insert or update of details, schema_id on public.job_line_items
  for each row execute function public.enforce_line_item_details();
