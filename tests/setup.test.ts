import { describe, expect, it } from 'vitest';

describe('TestMemoryStorage', () => {
  it('should coerce non-string keys to strings on set, get, and remove', () => {
    const objKey = { toString: () => 'coercedKey' };

    localStorage.setItem(objKey as any, 'value');
    expect(localStorage.getItem('coercedKey')).toBe('value');
    expect(localStorage.getItem(objKey as any)).toBe('value');

    localStorage.removeItem(objKey as any);
    expect(localStorage.getItem('coercedKey')).toBeNull();
  });

  it('should return null for negative and out-of-range indices', () => {
    localStorage.setItem('a', '1');
    expect(localStorage.key(-1)).toBeNull();
    expect(localStorage.key(1)).toBeNull();
    expect(localStorage.key(999)).toBeNull();
  });

  it('should coerce values to strings', () => {
    localStorage.setItem('num', 123 as any);
    expect(localStorage.getItem('num')).toBe('123');

    localStorage.setItem('bool', true as any);
    expect(localStorage.getItem('bool')).toBe('true');
  });
});
