import { isNil, omitBy } from 'es-toolkit/compat';

export type UnknownRecord = Record<PropertyKey, unknown>;

/**
 * Checks for any non-null object, including arrays.
 *
 * Prefer `isRecord` for normal object maps. Use this only when unknown object-shaped payloads
 * must be preserved instead of being classified as empty or invalid.
 */
export const isObjectLike = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

/**
 * Checks for non-null, non-array objects.
 *
 * This intentionally accepts class instances, `Error`, `Date`, and null-prototype objects. Use
 * `isPlainRecord` when prototype-strict plain object semantics are required.
 */
export const isRecord = (value: unknown): value is UnknownRecord =>
  isObjectLike(value) && !Array.isArray(value);

export const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (!isRecord(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const toRecord = (value: unknown): UnknownRecord | undefined =>
  isRecord(value) ? value : undefined;

export const pickString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

export const pickNonEmptyString = (value: unknown): string | undefined =>
  isNonEmptyString(value) ? value : undefined;

export const isTrimmedNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const pickTrimmedString = (value: unknown): string | undefined => {
  const stringValue = pickString(value);
  if (stringValue === undefined) return undefined;

  const trimmed = stringValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Clean empty values (undefined, null, empty string) from an object
 * @param obj The object to clean
 * @returns The cleaned object
 */
export const cleanObject = <T extends Record<string, any>>(obj: T): T => {
  return omitBy(obj, (value) => isNil(value) || value === '') as T;
};
