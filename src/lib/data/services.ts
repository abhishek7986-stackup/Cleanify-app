import { createClient } from "@/lib/supabase/server";
import type { Service, ServiceField, SchemaScope } from "@/lib/domain/database";

export type ServiceWithSchema = Service & {
  jobSchemaId: string | null;
  lineItemSchemaId: string | null;
  jobFields: ServiceField[];
  lineItemFields: ServiceField[];
};

/**
 * Loads every active service together with its PUBLISHED field schemas.
 *
 * Only published schemas are returned, so a half-built draft can never leak
 * into a job form. The schema id travels with the service because the job
 * pins it at creation — that pin is what lets a job created today still render
 * correctly after an admin republishes the service in six months.
 */
export async function getServicesWithSchemas(): Promise<ServiceWithSchema[]> {
  const supabase = await createClient();

  const [servicesRes, schemasRes, fieldsRes] = await Promise.all([
    supabase.from("services").select("*").eq("is_active", true).order("sort_order"),
    supabase
      .from("service_field_schemas")
      .select("id, service_id, scope, version, status, published_at")
      .eq("status", "published"),
    supabase
      .from("service_fields")
      .select("*")
      .is("archived_at", null)
      .order("sort_order"),
  ]);

  const services = (servicesRes.data ?? []) as Service[];
  const schemas = schemasRes.data ?? [];
  const fields = (fieldsRes.data ?? []) as ServiceField[];

  const schemaFor = (serviceId: string, scope: SchemaScope) =>
    schemas.find((s) => s.service_id === serviceId && s.scope === scope)?.id ?? null;

  return services.map((svc) => {
    const jobSchemaId = schemaFor(svc.id, "job");
    const lineItemSchemaId = schemaFor(svc.id, "line_item");
    return {
      ...svc,
      jobSchemaId,
      lineItemSchemaId,
      jobFields: fields.filter((f) => f.schema_id === jobSchemaId),
      lineItemFields: fields.filter((f) => f.schema_id === lineItemSchemaId),
    };
  });
}

export async function getSupervisors() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_directory")
    .select("id, full_name, role")
    .eq("role", "supervisor")
    .order("full_name");
  return (data ?? []) as { id: string; full_name: string; role: string }[];
}

export async function getReasons(category: "reschedule" | "cancellation") {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reasons")
    .select("id, code, label, requires_note")
    .eq("category", category)
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as {
    id: string;
    code: string;
    label: string;
    requires_note: boolean;
  }[];
}
