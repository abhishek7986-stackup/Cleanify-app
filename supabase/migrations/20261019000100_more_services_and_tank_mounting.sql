-- ============================================================================
-- Cleanify Ops — 19. Three more services, and stand vs terrace for tanks
-- ============================================================================
-- Added as rows, the same way the launch services were, so the admin field
-- builder in M5 can edit them later without a code change.
set search_path = public, extensions;

do $seed$
declare
  v_water_items uuid;
  v_svc         uuid;
  v_sch         uuid;
begin
  -- ===================== water tank: stand or plain terrace ================
  -- Only asked when the tank is overhead. Added to the published v1 schema:
  -- inserting a field is allowed there, and the line-item trigger only
  -- re-validates details when they are edited, so existing tanks are untouched.
  select s.id into v_water_items
    from public.service_field_schemas s
    join public.services sv on sv.id = s.service_id
   where sv.key = 'water_tank_cleaning' and s.scope = 'line_item' and s.status = 'published';

  update public.service_fields set sort_order = 5
   where schema_id = v_water_items and key = 'notes';

  insert into public.service_fields
    (schema_id, key, label, help_text, field_type, is_required, is_reportable, sort_order, config, visibility_rule)
  values
    (v_water_items, 'tank_mounting', 'On a stand or on the terrace floor?', null,
     'select', true, true, 4,
     '{"options": [{"value": "stand",   "label": "On a stand"},
                   {"value": "terrace", "label": "Plain terrace"}]}'::jsonb,
     '{"field": "location_on_site", "op": "eq", "value": "overhead"}'::jsonb);

  -- ============================ bathroom cleaning ==========================
  insert into public.services
    (key, name, description, icon, has_line_items, line_item_singular, line_item_plural,
     default_duration_min, default_policy_key, sort_order)
  values
    ('bathroom_cleaning', 'Bathroom Cleaning',
     'Deep clean of tiles, fittings, floors and drains.',
     'bath', true, 'Bathroom', 'Bathrooms', 60, 'once_per_day_base', 3)
  returning id into v_svc;

  insert into public.service_field_schemas (service_id, scope, version, status, published_at)
  values (v_svc, 'job', 1, 'published', now()) returning id into v_sch;

  insert into public.service_fields
    (schema_id, key, label, help_text, field_type, is_required, sort_order, config) values
  (v_sch, 'water_source_available', 'Water supply available on site?', null,
   'boolean', false, 1, '{"default": true}'::jsonb),
  (v_sch, 'extra_notes', 'Extra notes', 'Anything else the supervisor should know.',
   'textarea', false, 2, '{"maxLength": 1000}'::jsonb);

  insert into public.service_field_schemas (service_id, scope, version, status, published_at)
  values (v_svc, 'line_item', 1, 'published', now()) returning id into v_sch;

  insert into public.service_fields
    (schema_id, key, label, help_text, field_type, is_required, is_reportable, sort_order, config) values
  (v_sch, 'notes', 'Notes for this bathroom', null,
   'textarea', false, false, 1,
   '{"maxLength": 300, "placeholder": "e.g. hard water stains, blocked drain"}'::jsonb);

  -- ============================ interlock cleaning =========================
  insert into public.services
    (key, name, description, icon, has_line_items,
     default_duration_min, default_policy_key, sort_order)
  values
    ('interlock_cleaning', 'Interlock Cleaning',
     'Clean interlock paving, driveways and courtyards.',
     'grid', false, 120, 'once_per_day_base', 4)
  returning id into v_svc;

  insert into public.service_field_schemas (service_id, scope, version, status, published_at)
  values (v_svc, 'job', 1, 'published', now()) returning id into v_sch;

  insert into public.service_fields
    (schema_id, key, label, help_text, field_type, is_required, is_reportable, sort_order, config) values
  (v_sch, 'area_sqft', 'Approximate area', 'Rough estimate is fine.',
   'integer', false, true, 1, '{"min": 1, "max": 1000000, "unit": "sq ft"}'::jsonb),
  (v_sch, 'water_source_available', 'Water supply available on site?', null,
   'boolean', false, false, 2, '{"default": true}'::jsonb),
  (v_sch, 'extra_notes', 'Extra notes', null,
   'textarea', false, false, 3, '{"maxLength": 1000}'::jsonb);

  -- ============================ pressure washing ===========================
  insert into public.services
    (key, name, description, icon, has_line_items,
     default_duration_min, default_policy_key, sort_order)
  values
    ('pressure_washing', 'Pressure Washing',
     'High-pressure wash of walls, floors, parking areas and compounds.',
     'spray', false, 120, 'once_per_day_base', 5)
  returning id into v_svc;

  insert into public.service_field_schemas (service_id, scope, version, status, published_at)
  values (v_svc, 'job', 1, 'published', now()) returning id into v_sch;

  insert into public.service_fields
    (schema_id, key, label, help_text, field_type, is_required, is_reportable, sort_order, config) values
  (v_sch, 'surface', 'What needs washing?', null,
   'select', false, true, 1,
   '{"options": [{"value": "floor",    "label": "Floor / parking"},
                 {"value": "walls",    "label": "Walls"},
                 {"value": "compound", "label": "Compound / driveway"},
                 {"value": "other",    "label": "Other"}]}'::jsonb),
  (v_sch, 'area_sqft', 'Approximate area', 'Rough estimate is fine.',
   'integer', false, true, 2, '{"min": 1, "max": 1000000, "unit": "sq ft"}'::jsonb),
  (v_sch, 'water_source_available', 'Water supply available on site?', null,
   'boolean', false, false, 3, '{"default": true}'::jsonb),
  (v_sch, 'extra_notes', 'Extra notes', null,
   'textarea', false, false, 4, '{"maxLength": 1000}'::jsonb);
end
$seed$;
