/**
 * Hand-written domain types.
 *
 * Replace with generated types once the database is live:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/domain/database.ts
 *
 * Until then these are the contract. They are deliberately narrower than the
 * SQL — they cover what the app actually reads.
 */

export type UserRole = "admin" | "sales_rep" | "supervisor";

export type JobStatus =
  | "DRAFT"
  | "ASSIGNED"
  | "CHECKED_IN"
  | "EN_ROUTE"
  | "ON_SITE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

export type CheckinStatus = "ON_TIME" | "LATE" | "WAIVED" | "VOIDED";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type PhotoKind =
  | "EQUIPMENT" // legacy morning photo, replaced by ODOMETER
  | "PPE_SELFIE" // morning selfie
  | "ODOMETER" // morning scooter km reading
  | "CHECKOUT_SELFIE"
  | "CHECKOUT_ODOMETER"
  | "SITE_BEFORE"
  | "SITE_AFTER"
  | "ISSUE";
export type PaymentMode = "cash" | "upi" | "bank" | "pending";
export type SchemaScope = "job" | "line_item";
export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "integer"
  | "boolean"
  | "select"
  | "multiselect"
  | "date"
  | "time"
  | "currency";

export type FieldOption = { value: string; label: string };

export type FieldConfig = {
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: FieldOption[];
  maxLength?: number;
  default?: unknown;
  placeholder?: string;
};

export type VisibilityRule = {
  field: string;
  op?: "eq" | "ne" | "in" | "gt" | "lt" | "truthy";
  value?: unknown;
};

export type ServiceField = {
  id: string;
  schema_id: string;
  key: string;
  label: string;
  help_text: string | null;
  field_type: FieldType;
  is_required: boolean;
  is_reportable: boolean;
  sort_order: number;
  config: FieldConfig;
  visibility_rule: VisibilityRule | null;
  archived_at: string | null;
};

export type Service = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  is_active: boolean;
  has_line_items: boolean;
  line_item_singular: string | null;
  line_item_plural: string | null;
  default_duration_min: number;
  default_policy_key: string | null;
  sort_order: number;
};

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  locale: string;
  base_address: string | null;
  /** Depot point (hex EWKB). Admin-only by RLS; see parseEwkbPoint(). */
  base_location?: string | null;
};

export type StaffDocKind = "AADHAAR_FRONT" | "AADHAAR_BACK" | "DRIVING_LICENCE";

/** A new worker's self sign-up, waiting for (or decided by) an admin. */
export type StaffApplication = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  address: string;
  has_licence: boolean;
  status: ApprovalStatus;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
};

export type StaffDocument = {
  id: string;
  application_id: string;
  kind: StaffDocKind;
  storage_path: string;
  mime_type: string;
  bytes: number;
  uploaded_at: string;
};

export type Client = {
  id: string;
  name: string;
  phone: string | null;
  alt_phone: string | null;
  address_line: string;
  landmark: string | null;
  locality: string | null;
  city: string | null;
  pincode: string | null;
};

export type Job = {
  id: string;
  job_number: string;
  client_id: string;
  service_id: string;
  job_field_schema_id: string;
  line_item_schema_id: string | null;
  service_details: Record<string, unknown>;
  /** PostGIS point; PostgREST returns it as hex EWKB. See parseEwkbPoint(). */
  site_location: string | null;
  site_address: string;
  site_landmark: string | null;
  scheduled_start: string;
  estimated_duration_min: number;
  service_date: string;
  assigned_supervisor_id: string | null;
  created_by_sales_rep_id: string;
  status: JobStatus;
  sequence_in_day: number | null;
  travel_minutes: number | null;
  travel_minutes_override: number | null;
  travel_source: "base" | "previous_job" | "manual" | "none" | null;
  expected_departure_at: string | null;
  required_arrival_at: string | null;
  deadline_state: "pending" | "ok" | "failed" | "manual";
  itinerary_flags: string[];
  is_late: boolean;
  late_blameless: boolean;
  quoted_amount: string | null;
  actual_departure_at: string | null;
  arrived_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  completed_at: string | null;
  /** Where the supervisor was when they tapped "I've reached", and how far from the pin. */
  arrived_location: string | null;
  arrived_accuracy_m: string | null;
  arrived_distance_m: string | null;
  /** null until the before photos are sent; then PENDING / APPROVED / REJECTED. */
  before_review: ApprovalStatus | null;
  before_submitted_at: string | null;
  before_reviewed_by: string | null;
  before_reviewed_at: string | null;
  before_rejection_reason: string | null;
  /** Same for the after photos. Approving them completes the job. */
  after_review: ApprovalStatus | null;
  after_submitted_at: string | null;
  after_reviewed_by: string | null;
  after_reviewed_at: string | null;
  after_rejection_reason: string | null;
  completion_note: string | null;
  checkin_policy_key: string | null;
};

export type JobLineItem = {
  id: string;
  job_id: string;
  position: number;
  schema_id: string;
  label: string | null;
  details: Record<string, unknown>;
  is_done: boolean;
  done_at: string | null;
};

export type DayRoster = {
  id: string;
  supervisor_id: string;
  roster_date: string;
  first_job_id: string | null;
  checkin_policy_key: string | null;
  depart_by: string | null;
  required_checkin_at: string | null;
  reminder_at: string | null;
  submitted_at: string | null;
  client_reported_at: string | null;
  clock_skew_seconds: number | null;
  accuracy_m: string | null;
  distance_from_expected_m: string | null;
  checkin_status: CheckinStatus | null;
  flags: string[];
  risk_score: number;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  /** Scooter odometer typed at check-in and check-out; the difference is km driven. */
  start_odometer_km: string | null;
  end_odometer_km: string | null;
  checked_out_at: string | null;
};

export type Photo = {
  id: string;
  kind: PhotoKind;
  roster_id: string | null;
  job_id: string | null;
  job_line_item_id: string | null;
  storage_path: string;
  sha256: string;
  captured_at_server: string;
  /** Set when a retake replaced this photo. Kept for the audit trail. */
  replaced_at: string | null;
  accuracy_m: string | null;
  distance_from_expected_m: string | null;
  flagged: boolean;
  flag_reason: string | null;
};

export type CaptureToken = {
  id: string;
  user_id: string;
  kind: PhotoKind;
  roster_id: string | null;
  job_id: string | null;
  job_line_item_id: string | null;
  expires_at: string;
  consumed_at: string | null;
  storage_path: string;
};

export type Reason = {
  id: string;
  category: "reschedule" | "cancellation" | "late" | "no_show" | "rejection";
  code: string;
  label: string;
  requires_note: boolean;
  is_active: boolean;
  sort_order: number;
};

export type CheckinPolicyParams = {
  include_travel?: boolean;
  lead_minutes?: number;
  reminder_lead_minutes?: number;
  clock_time?: string;
  origin?: "chain" | "base" | "none";
  expected_location?: "origin" | "site";
  origin_radius_m?: number;
  prev_site_radius_m?: number;
  site_radius_m?: number;
};

export type CheckinPolicy = {
  key: string;
  name: string;
  description: string | null;
  params: CheckinPolicyParams;
  is_default: boolean;
};

/* ==========================================================================
 * supabase-js generics
 *
 * Hand-written stand-in for `supabase gen types`. Every table the client
 * actually queries must appear here or its rows resolve to `never`, and every
 * RPC must appear under Functions or its arguments resolve to `undefined`.
 * ======================================================================== */

type Tbl<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type AppSetting = { key: string; value: unknown; description: string | null };

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  platform: Platform | null;
  is_standalone: boolean | null;
  last_seen_at: string;
  last_ack_at: string | null;
  last_success_at?: string | null;
  failure_count?: number;
  disabled_at: string | null;
};

export type Platform = "ios" | "android" | "desktop" | "other";

export type NotificationRow = {
  id: string;
  job_id: string | null;
  roster_id: string | null;
  recipient_id: string;
  template_key: string;
  channel: "web_push" | "whatsapp" | "sms" | "email" | "in_app";
  payload: Record<string, unknown>;
  due_at: string;
  state: string;
  stale_after_min: number;
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
  failed_at?: string | null;
  last_error?: string | null;
  lease_expires_at?: string | null;
};

export type Payment = {
  id: string;
  job_id: string;
  amount: string;
  mode: PaymentMode;
  reference: string | null;
  collected_at: string | null;
  recorded_by: string;
};

export type JobEvent = {
  id: number;
  job_id: string | null;
  roster_id: string | null;
  event_type: string;
  actor_id: string | null;
  actor_role: UserRole | null;
  from_status: JobStatus | null;
  to_status: JobStatus | null;
  payload: Record<string, unknown>;
  occurred_at: string;
};

export type ServiceFieldSchema = {
  id: string;
  service_id: string;
  scope: SchemaScope;
  version: number;
  status: "draft" | "published" | "archived";
  published_at: string | null;
};

export type StaffDirectoryRow = {
  id: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
};

export type Database = {
  public: {
    Tables: {
      app_settings: Tbl<AppSetting>;
      profiles: Tbl<Profile>;
      staff_applications: Tbl<StaffApplication>;
      staff_documents: Tbl<StaffDocument>;
      services: Tbl<Service>;
      service_field_schemas: Tbl<ServiceFieldSchema>;
      service_fields: Tbl<ServiceField>;
      clients: Tbl<Client>;
      jobs: Tbl<Job>;
      job_line_items: Tbl<JobLineItem>;
      day_rosters: Tbl<DayRoster>;
      photos: Tbl<Photo>;
      capture_tokens: Tbl<CaptureToken>;
      payments: Tbl<Payment>;
      job_events: Tbl<JobEvent>;
      reasons: Tbl<Reason>;
      checkin_policies: Tbl<CheckinPolicy>;
      notifications: Tbl<NotificationRow>;
      push_subscriptions: Tbl<PushSubscriptionRow>;
    };
    Views: {
      staff_directory: Tbl<StaffDirectoryRow>;
      my_notifications: Tbl<NotificationRow>;
    };
    Functions: {
      create_job: { Args: { p_payload: unknown }; Returns: Job };
      reschedule_job: {
        Args: {
          p_job_id: string;
          p_new_start: string;
          p_reason_id: string;
          p_reason_note?: string | null;
          p_new_supervisor?: string | null;
          p_client_informed?: boolean;
        };
        Returns: Job;
      };
      cancel_job: {
        Args: {
          p_job_id: string;
          p_reason_id: string;
          p_reason_note?: string | null;
          p_client_informed?: boolean;
        };
        Returns: Job;
      };
      advance_job_status: {
        Args: { p_job_id: string; p_to: JobStatus; p_meta?: unknown };
        Returns: Job;
      };
      issue_capture_token: {
        Args: {
          p_kind: PhotoKind;
          p_roster_id?: string | null;
          p_job_id?: string | null;
          p_job_line_item_id?: string | null;
        };
        Returns: CaptureToken;
      };
      record_photo: {
        Args: {
          p_token_id: string;
          p_sha256: string;
          p_mime_type: string;
          p_bytes: number;
          p_width?: number | null;
          p_height?: number | null;
          p_camera_facing?: string | null;
          p_capture_latency_ms?: number | null;
          p_client_clock?: string | null;
          p_lat?: number | null;
          p_lng?: number | null;
          p_accuracy_m?: number | null;
        };
        Returns: Photo;
      };
      submit_checkin: {
        Args: {
          p_roster_date: string;
          p_lat?: number | null;
          p_lng?: number | null;
          p_accuracy_m?: number | null;
          p_client_clock?: string | null;
          p_device_fingerprint?: string | null;
          p_user_agent?: string | null;
          p_offline_queued_at?: string | null;
          p_note?: string | null;
          p_odometer_km?: number | null;
        };
        Returns: DayRoster;
      };
      claim_notifications: {
        Args: { p_worker: string; p_limit?: number };
        Returns: NotificationRow[];
      };
      mark_notification_sent: {
        Args: { p_id: string; p_provider_msg_id?: string | null };
        Returns: undefined;
      };
      mark_notification_failed: {
        Args: { p_id: string; p_error: string };
        Returns: undefined;
      };
      admin_upsert_staff: {
        Args: {
          p_user_id: string;
          p_full_name: string;
          p_role: UserRole;
          p_phone?: string | null;
          p_base_lat?: number | null;
          p_base_lng?: number | null;
          p_base_address?: string | null;
          p_is_active?: boolean;
        };
        Returns: Profile;
      };
      admin_review_staff_application: {
        Args: {
          p_application_id: string;
          p_approve: boolean;
          p_reason?: string | null;
          p_depot_lat?: number | null;
          p_depot_lng?: number | null;
          p_depot_address?: string | null;
        };
        Returns: StaffApplication;
      };
      submit_checkout: {
        Args: {
          p_roster_date: string;
          p_odometer_km: number;
          p_lat?: number | null;
          p_lng?: number | null;
          p_accuracy_m?: number | null;
          p_client_clock?: string | null;
        };
        Returns: DayRoster;
      };
      review_roster: {
        Args: { p_roster_id: string; p_approve: boolean; p_reason?: string | null };
        Returns: DayRoster;
      };
      waive_late: { Args: { p_job_id: string; p_reason: string }; Returns: Job };
      update_unit_details: {
        Args: { p_item_id: string; p_details: Record<string, unknown> };
        Returns: JobLineItem;
      };
      submit_site_photos: {
        Args: { p_job_id: string; p_stage: "before" | "after"; p_note?: string | null };
        Returns: Job;
      };
      review_site_photos: {
        Args: { p_job_id: string; p_stage: "before" | "after"; p_approve: boolean; p_reason?: string | null };
        Returns: Job;
      };
      recompute_for_job: { Args: { p_job_id: string }; Returns: unknown };
      record_payment: {
        Args: {
          p_job_id: string;
          p_amount: number;
          p_mode: PaymentMode;
          p_reference?: string | null;
        };
        Returns: Payment;
      };
    };
    Enums: {
      user_role: UserRole;
      job_status: JobStatus;
      photo_kind: PhotoKind;
      payment_mode: PaymentMode;
      schema_scope: SchemaScope;
      field_type: FieldType;
    };
    CompositeTypes: Record<string, never>;
  };
};
