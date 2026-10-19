-- ============================================================================
-- Cleanify Ops — 12. Seed: policies, settings, transitions, reasons, services
-- ============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Check-in policies. Swapping the default is a config change, not a rewrite,
-- because the arithmetic lives only in public.compute_deadline().
-- ---------------------------------------------------------------------------
insert into public.checkin_policies (key, name, description, params, is_default) values
('once_per_day_base',
 'Depot check-in, 30 min before departure',
 'Deadline = first job start - travel time - 30 min. Equipment and PPE photos are taken at the depot, once per day.',
 '{"include_travel": true, "lead_minutes": 30, "reminder_lead_minutes": 15,
   "origin": "chain", "expected_location": "origin",
   "origin_radius_m": 500, "prev_site_radius_m": 250}'::jsonb,
 true),

('per_job_base',
 'Depot check-in before every job',
 'Same arithmetic, but a fresh equipment and PPE check-in for each job. Only sensible if supervisors return to the depot between jobs.',
 '{"include_travel": true, "lead_minutes": 30, "reminder_lead_minutes": 15,
   "origin": "chain", "expected_location": "origin",
   "origin_radius_m": 500, "prev_site_radius_m": 250}'::jsonb,
 false),

('onsite_minus_30',
 'On-site check-in, 30 min before start',
 'Deadline = job start - 30 min, geofenced to the client site. No travel term.',
 '{"include_travel": false, "lead_minutes": 30, "reminder_lead_minutes": 15,
   "origin": "none", "expected_location": "site", "site_radius_m": 200}'::jsonb,
 false),

('fixed_clock_time',
 'Fixed clock time',
 'Deadline = a fixed IST wall-clock time on the service date, regardless of travel.',
 '{"clock_time": "07:30", "lead_minutes": 0, "reminder_lead_minutes": 15,
   "include_travel": false, "origin": "none", "expected_location": "origin"}'::jsonb,
 false);

-- ---------------------------------------------------------------------------
-- Operational tunables
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
('checkin.default_policy',      '"once_per_day_base"'::jsonb, 'Policy used when a service does not name one.'),
('travel.buffer_multiplier',    '1.15'::jsonb,  'Applied to every ETA. Tune against actual_departure_at - expected_departure_at, not by anecdote.'),
('travel.min_minutes',          '10'::jsonb,    'Floor for any travel leg.'),
('travel.cache_ttl_days',       '7'::jsonb,     'How long a cached route estimate stays usable.'),
('geofence.base_radius_m',      '500'::jsonb,   'Depot check-in radius. Generous on purpose.'),
('geofence.site_radius_m',      '200'::jsonb,   'Client site radius.'),
('geofence.prev_site_radius_m', '250'::jsonb,   'Radius when chaining from the previous job.'),
('geofence.max_accuracy_m',     '150'::jsonb,   'Above this a GPS fix is unusable, which is NOT the same as suspicious.'),
('capture.token_ttl_seconds',   '300'::jsonb,   'Lifetime of a single-use camera capture token.'),
('photo.max_edge_px',           '1280'::jsonb,  'Client-side downscale before upload.'),
('photo.jpeg_quality',          '0.75'::jsonb,  'Client-side JPEG quality before upload.'),
('alerts.admin_recipients',     '[]'::jsonb,    'Named admin UUIDs for late alerts. Empty means every active admin.'),
('alerts.whatsapp_enabled',     'true'::jsonb,  'WhatsApp escalation for critical alerts.'),
('scheduler.heartbeat_hour_ist','5'::jsonb,     'Hour (IST) of the silent push that proves devices are reachable before the day starts.');

-- ---------------------------------------------------------------------------
-- The state machine, as data.
-- ---------------------------------------------------------------------------
insert into public.job_status_transitions
  (from_status, to_status, allowed_roles, requires_assignment, requires_ownership, guard, note) values
('DRAFT','ASSIGNED',       '{sales_rep,admin}',  false, true,  null,               'Needs a supervisor, a schedule and a map pin.'),
('DRAFT','CANCELLED',      '{sales_rep,admin}',  false, true,  null,               'Use cancel_job() so a reason is recorded.'),
('ASSIGNED','ASSIGNED',    '{sales_rep,admin}',  false, true,  null,               'Reschedule or reassign. Stays ASSIGNED so it cannot vanish from the timetable.'),
('ASSIGNED','CHECKED_IN',  '{supervisor,admin}', true,  false, 'checkin_complete', 'Requires a submitted roster with both photos.'),
('ASSIGNED','CANCELLED',   '{sales_rep,admin}',  false, true,  null,               null),
('ASSIGNED','NO_SHOW',     '{admin}',            false, false, null,               'Also set by the system sweep after a grace period.'),
('CHECKED_IN','EN_ROUTE',  '{supervisor,admin}', true,  false, null,               'Stamps actual_departure_at — the input to ETA tuning.'),
('CHECKED_IN','CANCELLED', '{admin}',            false, false, null,               'Admin only: equipment has already been loaded for this job.'),
('EN_ROUTE','ON_SITE',     '{supervisor,admin}', true,  false, null,               'Stamps arrived_at.'),
('EN_ROUTE','CANCELLED',   '{admin}',            false, false, null,               null),
('ON_SITE','IN_PROGRESS',  '{supervisor,admin}', true,  false, null,               null),
('ON_SITE','CANCELLED',    '{admin}',            false, false, null,               null),
('IN_PROGRESS','COMPLETED','{supervisor,admin}', true,  false, 'completion_ready', 'Needs a note, every unit ticked, and before+after photos on each unit.'),
('IN_PROGRESS','CANCELLED','{admin}',            false, false, null,               null),
('COMPLETED','ASSIGNED',   '{admin}',            false, false, null,               'Reopen. Logged loudly.'),
('CANCELLED','ASSIGNED',   '{admin}',            false, false, null,               'Revive. Needs a new schedule.'),
('NO_SHOW','ASSIGNED',     '{admin}',            false, false, null,               'Revive. Needs a new schedule.');

-- ---------------------------------------------------------------------------
-- Reasons
-- ---------------------------------------------------------------------------
insert into public.reasons (category, code, label, requires_note, sort_order) values
('reschedule','client_request',    'Client asked to reschedule',      false, 1),
('reschedule','client_unavailable','Client not available on site',    false, 2),
('reschedule','no_water',          'No water supply available',       false, 3),
('reschedule','tank_inaccessible', 'Tank could not be accessed',      true,  4),
('reschedule','weather',           'Weather',                         false, 5),
('reschedule','vehicle_breakdown', 'Vehicle or equipment breakdown',  true,  6),
('reschedule','staff_unavailable', 'Staff unavailable',               true,  7),
('reschedule','overrun',           'Previous job overran',            false, 8),
('reschedule','other',             'Other',                           true,  99),

('cancellation','client_cancelled','Client cancelled',                false, 1),
('cancellation','duplicate',       'Duplicate booking',               false, 2),
('cancellation','price_dispute',   'Price not agreed',                false, 3),
('cancellation','out_of_area',     'Outside service area',            false, 4),
('cancellation','wrong_service',   'Wrong service booked',            false, 5),
('cancellation','unreachable',     'Client unreachable',              false, 6),
('cancellation','other',           'Other',                           true,  99),

('late','traffic',        'Traffic',                     false, 1),
('late','vehicle',        'Vehicle trouble',             false, 2),
('late','equipment',      'Equipment loading delay',     false, 3),
('late','bad_eta',        'System ETA was wrong',        false, 4),
('late','upstream_job',   'Previous job overran',        false, 5),
('late','other',          'Other',                       true,  99),

('rejection','ppe_incomplete', 'PPE not complete in photo',      false, 1),
('rejection','photo_unclear',  'Photo unclear or unusable',      false, 2),
('rejection','wrong_equipment','Wrong or missing equipment',     true,  3),
('rejection','other',          'Other',                          true,  99);

-- ---------------------------------------------------------------------------
-- Launch services.
--
-- These are seeded as DATA, exercising exactly the same tables the admin
-- schema builder will write to in M5. If the model cannot express water tank
-- cleaning as rows, it cannot express service #3 either.
-- ---------------------------------------------------------------------------
do $seed$
declare
  v_water uuid;
  v_solar uuid;
  v_sch   uuid;
begin
  -- ============================ water tank cleaning ========================
  insert into public.services
    (key, name, description, icon, has_line_items, line_item_singular, line_item_plural,
     default_duration_min, default_policy_key, sort_order)
  values
    ('water_tank_cleaning', 'Water Tank Cleaning',
     'Drain, scrub, disinfect and refill overhead or underground tanks.',
     'droplet', true, 'Tank', 'Tanks', 90, 'once_per_day_base', 1)
  returning id into v_water;

  -- job-scope fields
  insert into public.service_field_schemas (service_id, scope, version, status, published_at)
  values (v_water, 'job', 1, 'published', now()) returning id into v_sch;

  insert into public.service_fields
    (schema_id, key, label, help_text, field_type, is_required, sort_order, config) values
  (v_sch, 'water_source_available', 'Water supply available on site?', null,
   'boolean', false, 1, '{"default": true}'::jsonb),
  (v_sch, 'access_notes', 'Access notes',
   'Gate codes, lift availability, whether a ladder is needed.',
   'textarea', false, 2, '{"maxLength": 500, "placeholder": "e.g. terrace access via back stairs, gate closes 1-3pm"}'::jsonb),
  (v_sch, 'extra_notes', 'Extra notes', 'Anything else the supervisor should know.',
   'textarea', false, 3, '{"maxLength": 1000}'::jsonb);

  -- per-tank fields. The NUMBER of tanks is the row count, never a field.
  insert into public.service_field_schemas (service_id, scope, version, status, published_at)
  values (v_water, 'line_item', 1, 'published', now()) returning id into v_sch;

  insert into public.service_fields
    (schema_id, key, label, help_text, field_type, is_required, is_reportable, sort_order, config) values
  (v_sch, 'capacity_litres', 'Capacity', 'Approximate, in litres.',
   'integer', true, true, 1,
   '{"min": 100, "max": 200000, "step": 100, "unit": "L", "placeholder": "5000"}'::jsonb),
  (v_sch, 'tank_type', 'Tank type', null,
   'select', true, true, 2,
   '{"options": [{"value": "synthetic", "label": "Synthetic"},
                 {"value": "concrete",  "label": "Concrete"}]}'::jsonb),
  (v_sch, 'location_on_site', 'Where is it?', null,
   'select', false, false, 3,
   '{"options": [{"value": "overhead", "label": "Overhead / terrace"},
                 {"value": "underground", "label": "Underground sump"},
                 {"value": "ground", "label": "Ground level"}]}'::jsonb),
  (v_sch, 'notes', 'Notes for this tank', null,
   'textarea', false, false, 4, '{"maxLength": 300}'::jsonb);

  -- ============================ solar panel cleaning =======================
  insert into public.services
    (key, name, description, icon, has_line_items, line_item_singular, line_item_plural,
     default_duration_min, default_policy_key, sort_order)
  values
    ('solar_panel_cleaning', 'Solar Panel Cleaning',
     'Dry-brush and rinse rooftop or ground-mounted solar arrays.',
     'sun', true, 'Array', 'Arrays', 60, 'once_per_day_base', 2)
  returning id into v_solar;

  insert into public.service_field_schemas (service_id, scope, version, status, published_at)
  values (v_solar, 'job', 1, 'published', now()) returning id into v_sch;

  insert into public.service_fields
    (schema_id, key, label, help_text, field_type, is_required, sort_order, config) values
  (v_sch, 'roof_access', 'Roof access', null,
   'select', true, 1,
   '{"options": [{"value": "stairs", "label": "Stairs"},
                 {"value": "ladder", "label": "Ladder needed"},
                 {"value": "lift",   "label": "Lift / hoist"}]}'::jsonb),
  (v_sch, 'water_source_available', 'Water supply available on site?', null,
   'boolean', false, 2, '{"default": true}'::jsonb),
  (v_sch, 'extra_notes', 'Extra notes', null,
   'textarea', false, 3, '{"maxLength": 1000}'::jsonb);

  insert into public.service_field_schemas (service_id, scope, version, status, published_at)
  values (v_solar, 'line_item', 1, 'published', now()) returning id into v_sch;

  insert into public.service_fields
    (schema_id, key, label, help_text, field_type, is_required, is_reportable, sort_order, config) values
  (v_sch, 'panel_count', 'Number of panels', null,
   'integer', true, true, 1, '{"min": 1, "max": 2000, "step": 1}'::jsonb),
  (v_sch, 'mounting', 'Mounting', null,
   'select', true, false, 2,
   '{"options": [{"value": "rooftop", "label": "Rooftop"},
                 {"value": "ground",  "label": "Ground mount"},
                 {"value": "carport", "label": "Carport"}]}'::jsonb),
  (v_sch, 'height_m', 'Height above ground', 'Metres. Drives the safety kit.',
   'number', false, false, 3, '{"min": 0, "max": 200, "unit": "m"}'::jsonb),
  (v_sch, 'notes', 'Notes for this array', null,
   'textarea', false, false, 4, '{"maxLength": 300}'::jsonb);
end
$seed$;
