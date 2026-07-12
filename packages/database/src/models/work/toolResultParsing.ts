import { toRecord } from '@lobechat/utils';

/**
 * Parsing primitives shared by the provider tool-result normalizers
 * (githubToolResult.ts / linearToolResult.ts). Keep provider-specific
 * variants (e.g. github's digit-string-aware numberValue) in their own files.
 */

export { toRecord };

export const parseMaybeJSON = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const stringValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed || null;
};

export const hasOwn = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

export const fromRecord = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }

  return null;
};

export const isApplicationError = (data: unknown) => {
  const record = toRecord(parseMaybeJSON(data));
  return record?.isError === true;
};
