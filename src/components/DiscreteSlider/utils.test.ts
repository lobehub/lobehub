import { describe, expect, it } from 'vitest';

import { findClosestOptionIndex } from './utils';

const options = [{ value: 10 }, { value: 50 }, { value: 100 }];

describe('findClosestOptionIndex', () => {
  it('maps an intermediate value to its nearest option', () => {
    expect(findClosestOptionIndex(options, 72)).toBe(1);
  });

  it('uses the first option for non-finite values', () => {
    expect(findClosestOptionIndex(options, Number.NaN)).toBe(0);
  });
});
