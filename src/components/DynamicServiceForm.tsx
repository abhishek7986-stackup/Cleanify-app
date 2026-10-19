"use client";

import type { ServiceField, VisibilityRule } from "@/lib/domain/database";

/**
 * ============================================================================
 * Schema-driven form
 * ============================================================================
 *
 * Every field on this form comes from `service_fields` rows, never from code.
 * That is the whole point: adding "Sump cleaning" with a different field set
 * must be an admin action, not a deploy.
 *
 * Validation here mirrors `public.validate_service_details()`, which runs as a
 * trigger and is AUTHORITATIVE. This copy exists to give a fast, inline error
 * instead of a round trip — never as the only check.
 */

export type FieldValues = Record<string, unknown>;

export function isVisible(rule: VisibilityRule | null, values: FieldValues): boolean {
  if (!rule) return true;
  const actual = values[rule.field];
  const expected = rule.value;
  switch (rule.op ?? "eq") {
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "gt":
      return Number(actual) > Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "truthy":
      return Boolean(actual);
    default:
      return true;
  }
}

/** Mirrors the database trigger. Returns a message per field key. */
export function validateFields(
  fields: ServiceField[],
  values: FieldValues,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const f of fields) {
    if (!isVisible(f.visibility_rule, values)) continue;

    const v = values[f.key];
    const empty =
      v === undefined || v === null || (typeof v === "string" && v.trim() === "");

    if (empty) {
      if (f.is_required) errors[f.key] = `${f.label} is required`;
      continue;
    }

    if (["number", "integer", "currency"].includes(f.field_type)) {
      const n = Number(v);
      if (Number.isNaN(n)) errors[f.key] = `${f.label} must be a number`;
      else if (f.field_type === "integer" && !Number.isInteger(n))
        errors[f.key] = `${f.label} must be a whole number`;
      else if (f.config?.min != null && n < f.config.min)
        errors[f.key] = `${f.label} must be at least ${f.config.min}`;
      else if (f.config?.max != null && n > f.config.max)
        errors[f.key] = `${f.label} must be at most ${f.config.max}`;
    }

    if (f.field_type === "select") {
      const allowed = (f.config?.options ?? []).map((o) => o.value);
      if (!allowed.includes(String(v)))
        errors[f.key] = `${f.label}: pick one of the options`;
    }

    if (f.config?.maxLength && typeof v === "string" && v.length > f.config.maxLength) {
      errors[f.key] = `${f.label} must be at most ${f.config.maxLength} characters`;
    }
  }

  return errors;
}

/**
 * Drops answers to fields that are now hidden, e.g. "stand or terrace" after
 * the tank was changed from overhead to underground, so a stale answer is
 * never saved against a question the rep can no longer see.
 */
export function visibleValues(fields: ServiceField[], values: FieldValues): FieldValues {
  const out: FieldValues = { ...values };
  for (const f of fields) {
    if (!isVisible(f.visibility_rule, values)) delete out[f.key];
  }
  return out;
}

/** Sensible starting values, honouring each field's configured default. */
export function initialValues(fields: ServiceField[]): FieldValues {
  const out: FieldValues = {};
  for (const f of fields) {
    if (f.config?.default !== undefined) out[f.key] = f.config.default;
    else if (f.field_type === "boolean") out[f.key] = false;
  }
  return out;
}

const inputBase =
  "w-full tap rounded-xl border-2 border-slate-200 bg-white px-3 text-base " +
  "outline-none focus:border-brand-600 disabled:bg-slate-50";

export function DynamicServiceForm({
  fields,
  values,
  errors = {},
  onChange,
  idPrefix = "f",
}: {
  fields: ServiceField[];
  values: FieldValues;
  errors?: Record<string, string>;
  onChange: (next: FieldValues) => void;
  idPrefix?: string;
}) {
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-4">
      {fields.map((f) => {
        if (!isVisible(f.visibility_rule, values)) return null;

        const id = `${idPrefix}-${f.key}`;
        const err = errors[f.key];
        const raw = values[f.key];
        const value = raw === undefined || raw === null ? "" : String(raw);

        return (
          <div key={f.id}>
            {f.field_type === "boolean" ? (
              <label
                htmlFor={id}
                className="flex tap items-center justify-between gap-3 rounded-xl border-2 border-slate-200 bg-white px-3"
              >
                <span className="text-base font-medium text-slate-800">{f.label}</span>
                <input
                  id={id}
                  type="checkbox"
                  className="size-6 accent-[var(--color-brand-700)]"
                  checked={Boolean(raw)}
                  onChange={(e) => set(f.key, e.target.checked)}
                />
              </label>
            ) : (
              <>
                <label
                  htmlFor={id}
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                >
                  {f.label}
                  {f.is_required ? <span className="text-danger-600"> *</span> : null}
                  {f.config?.unit ? (
                    <span className="font-normal text-slate-400"> ({f.config.unit})</span>
                  ) : null}
                </label>

                {f.field_type === "textarea" ? (
                  <textarea
                    id={id}
                    rows={3}
                    className={`${inputBase} py-2`}
                    placeholder={f.config?.placeholder}
                    maxLength={f.config?.maxLength}
                    value={value}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : f.field_type === "select" ? (
                  <select
                    id={id}
                    className={inputBase}
                    value={value}
                    onChange={(e) => set(f.key, e.target.value || undefined)}
                  >
                    <option value="">Choose…</option>
                    {(f.config?.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    className={inputBase}
                    type={
                      f.field_type === "date"
                        ? "date"
                        : f.field_type === "time"
                          ? "time"
                          : ["number", "integer", "currency"].includes(f.field_type)
                            ? "number"
                            : "text"
                    }
                    // Numeric keypad on phones — supervisors and reps are on mobile.
                    inputMode={
                      f.field_type === "integer"
                        ? "numeric"
                        : ["number", "currency"].includes(f.field_type)
                          ? "decimal"
                          : undefined
                    }
                    step={f.config?.step ?? (f.field_type === "integer" ? 1 : undefined)}
                    min={f.config?.min}
                    max={f.config?.max}
                    placeholder={f.config?.placeholder}
                    maxLength={f.config?.maxLength}
                    value={value}
                    onChange={(e) => {
                      const t = e.target.value;
                      if (["number", "integer", "currency"].includes(f.field_type)) {
                        set(f.key, t === "" ? undefined : Number(t));
                      } else {
                        set(f.key, t === "" ? undefined : t);
                      }
                    }}
                  />
                )}
              </>
            )}

            {f.help_text ? (
              <p className="mt-1 text-xs text-slate-500">{f.help_text}</p>
            ) : null}
            {err ? <p className="mt-1 text-sm text-danger-600">{err}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
