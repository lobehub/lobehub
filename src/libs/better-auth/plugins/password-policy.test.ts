import { describe, expect, it } from 'vitest';

import { meetsPasswordComplexity, PASSWORD_MIN_LENGTH } from './password-policy';

describe('meetsPasswordComplexity', () => {
  it('exports the server min length used by Better Auth config', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
  });

  it('requires at least one letter and one digit', () => {
    expect(meetsPasswordComplexity('abcdefghij')).toBe(false);
    expect(meetsPasswordComplexity('1234567890')).toBe(false);
    expect(meetsPasswordComplexity('Password1')).toBe(true);
    expect(meetsPasswordComplexity('Password123!')).toBe(true);
  });
});
