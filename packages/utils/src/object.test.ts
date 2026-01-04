import { describe, expect, it } from 'vitest';

import { cleanObject } from './object';

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
