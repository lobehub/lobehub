import type { FieldSchema } from './types';

export interface FieldFormatViolation {
  /** Regex source the value failed against — echoed so API callers can self-correct. */
  expected: string;
  /** Dotted path of the offending field, e.g. `credentials.publicKey`. */
  field: string;
}

/**
 * Values submitted for a bot provider, shaped the way the form and the TRPC
 * input carry them. Only the sections that declare `pattern` constraints today
 * are inspected; `settings` is accepted so callers can pass the whole payload.
 */
export interface BotProviderFieldValues {
  applicationId?: string;
  credentials?: Record<string, string>;
  settings?: Record<string, unknown>;
}

const testPattern = (pattern: string, value: unknown): boolean => {
  // Only strings carry format constraints, and an empty value is `required`'s
  // business — a blank optional field must not trip the format check.
  if (typeof value !== 'string' || value === '') return true;

  return new RegExp(pattern).test(value);
};

const collectSection = (
  fields: FieldSchema[] | undefined,
  values: Record<string, unknown> | undefined,
  prefix: string,
  violations: FieldFormatViolation[],
): void => {
  if (!fields || !values) return;

  for (const field of fields) {
    if (field.type === 'object' && field.properties) {
      collectSection(
        field.properties,
        values[field.key] as Record<string, unknown> | undefined,
        `${prefix}${field.key}.`,
        violations,
      );
      continue;
    }

    if (!field.pattern) continue;
    if (testPattern(field.pattern, values[field.key])) continue;

    violations.push({ expected: field.pattern, field: `${prefix}${field.key}` });
  }
};

/**
 * Check a bot provider payload against the `pattern` constraints declared in
 * its platform schema.
 *
 * The form applies the same patterns as antd rules, so this is the guard for
 * everything that doesn't go through the form. Fields the caller omitted are
 * skipped, which keeps partial updates working.
 */
export function collectFieldFormatViolations(
  schema: FieldSchema[] | undefined,
  values: BotProviderFieldValues,
): FieldFormatViolation[] {
  if (!schema) return [];

  const violations: FieldFormatViolation[] = [];

  for (const section of schema) {
    switch (section.key) {
      case 'applicationId': {
        // Top-level scalar rather than a nested section — the form binds it to
        // a bare `applicationId` name, so the value sits alongside the sections.
        if (values.applicationId === undefined) break;
        collectSection([section], { applicationId: values.applicationId }, '', violations);
        break;
      }
      case 'credentials': {
        if (values.credentials === undefined) break;
        collectSection(section.properties, values.credentials, 'credentials.', violations);
        break;
      }
      default: {
        break;
      }
    }
  }

  return violations;
}

/** Render violations as a single human-readable line for error messages. */
export function formatFieldFormatViolations(violations: FieldFormatViolation[]): string {
  return violations.map((v) => `"${v.field}" (expected /${v.expected}/)`).join(', ');
}
