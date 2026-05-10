import { describe, expect, it } from 'vitest';

import { normalizeInterestsForStorage, resolveInterestAreaKey } from './interests';

describe('interests', () => {
  it('resolves canonical keys only', () => {
    expect(resolveInterestAreaKey('coding')).toBe('coding');
    expect(resolveInterestAreaKey(' coding ')).toBe('coding');
    expect(resolveInterestAreaKey('编程与开发')).toBeUndefined();
    expect(resolveInterestAreaKey('interests.area.personal')).toBeUndefined();
  });

  it('dedupes predefined keys while preserving freeform values', () => {
    expect(normalizeInterestsForStorage([' coding ', '金融', 'coding', ' 金融 '])).toEqual([
      'coding',
      '金融',
    ]);
  });
});
