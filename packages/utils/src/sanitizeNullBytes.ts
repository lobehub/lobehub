/**
 * Sanitize null bytes (\u0000) from values before PostgreSQL insertion.
 * PostgreSQL cannot store \u0000 in text/jsonb columns.
 *
 * For strings: directly removes null bytes.
 * For objects: serializes to JSON, recovers corrupted Unicode escapes
 * (e.g. \u0000e9 → \u00e9 = é), strips remaining null escapes, then parses back.
 */
export const sanitizeNullBytes = <T>(val: T): T => {
  if (val == null) return val;

  if (typeof val === 'string') {
    return val.replaceAll('\0', '') as T;
  }

  if (typeof val === 'object') {
    const json = JSON.stringify(val);
    // Recover corrupted Unicode: \u0000XX → \u00XX, then strip remaining \u0000
    const fixed = json.replaceAll(/\\u0000([0-9a-fA-F]{2})/g, '\\u00$1').replaceAll('\\u0000', '');
    return JSON.parse(fixed);
  }

  return val;
};
