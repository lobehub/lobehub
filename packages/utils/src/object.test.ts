import { describe, expect, it } from 'vitest';

import {
  cleanObject,
  isNonEmptyString,
  isObjectLike,
  isPlainRecord,
  isRecord,
  isTrimmedNonEmptyString,
  pickNonEmptyString,
  pickString,
  pickTrimmedString,
  toRecord,
} from './object';

describe('cleanObject', () => {
  it('should remove null, undefined and empty string fields', () => {
    const input = {
      a: 1,
      b: null,
      c: undefined,
      d: '',
      e: 0,
      f: false,
      abc: { d: undefined },
    } as const;
    const res = cleanObject({ ...input });
    expect(res).toEqual({ a: 1, e: 0, f: false, abc: {} });
  });
});

describe('record guards', () => {
  class Example {}

  const nullPrototypeObject = Object.create(null) as Record<string, unknown>;
  nullPrototypeObject.value = true;

  it('should detect non-null objects including arrays as object-like values', () => {
    expect(isObjectLike({ value: true })).toBe(true);
    expect(isObjectLike([1, 2, 3])).toBe(true);
    expect(isObjectLike(nullPrototypeObject)).toBe(true);
    expect(isObjectLike(new Example())).toBe(true);
    expect(isObjectLike(null)).toBe(false);
    expect(isObjectLike('value')).toBe(false);
  });

  it('should detect non-null non-array objects as records', () => {
    expect(isRecord({ value: true })).toBe(true);
    expect(isRecord(nullPrototypeObject)).toBe(true);
    expect(isRecord(new Example())).toBe(true);
    expect(isRecord(new Error('error'))).toBe(true);
    expect(isRecord(new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('should reject primitives, nullish values, and arrays as records', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord('value')).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  it('should detect only prototype-plain records', () => {
    expect(isPlainRecord({ value: true })).toBe(true);
    expect(isPlainRecord(nullPrototypeObject)).toBe(true);

    expect(isPlainRecord(new Example())).toBe(false);
    expect(isPlainRecord(new Error('error'))).toBe(false);
    expect(isPlainRecord(new Date('2026-01-01T00:00:00.000Z'))).toBe(false);
    expect(isPlainRecord([1, 2, 3])).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
  });

  it('should return records or undefined', () => {
    const record = { value: true };

    expect(toRecord(record)).toBe(record);
    expect(toRecord([record])).toBeUndefined();
    expect(toRecord(null)).toBeUndefined();
  });
});

describe('string guards', () => {
  it('should pick strings without filtering empty values', () => {
    expect(pickString('')).toBe('');
    expect(pickString('  ')).toBe('  ');
    expect(pickString('value')).toBe('value');
    expect(pickString(1)).toBeUndefined();
  });

  it('should detect and pick raw non-empty strings', () => {
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('  ')).toBe(true);
    expect(isNonEmptyString('value')).toBe(true);
    expect(isNonEmptyString(null)).toBe(false);

    expect(pickNonEmptyString('')).toBeUndefined();
    expect(pickNonEmptyString('  ')).toBe('  ');
    expect(pickNonEmptyString('value')).toBe('value');
  });

  it('should detect trimmed non-empty strings while preserving predicate input', () => {
    const value = '  value  ' as unknown;

    expect(isTrimmedNonEmptyString('')).toBe(false);
    expect(isTrimmedNonEmptyString('  ')).toBe(false);
    expect(isTrimmedNonEmptyString(value)).toBe(true);
    expect(isTrimmedNonEmptyString(null)).toBe(false);

    if (isTrimmedNonEmptyString(value)) {
      expect(value).toBe('  value  ');
    }
  });

  it('should pick trimmed strings', () => {
    expect(pickTrimmedString('')).toBeUndefined();
    expect(pickTrimmedString('  ')).toBeUndefined();
    expect(pickTrimmedString('  value  ')).toBe('value');
    expect(pickTrimmedString(1)).toBeUndefined();
  });
});
