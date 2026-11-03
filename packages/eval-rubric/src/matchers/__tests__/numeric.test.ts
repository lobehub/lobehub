import { describe, expect, it } from 'vitest';

import { matchNumeric } from '../numeric';

describe('matchNumeric', () => {
  it('should pass within tolerance', () => {
    expect(matchNumeric('42.3', '42', { tolerance: 0.5, value: 42 } as any).passed).toBe(true);
  });

  it('should fail outside tolerance', () => {
    expect(matchNumeric('43', '42', { tolerance: 0.01, value: 42 } as any).passed).toBe(false);
  });

  it('should extract number from text', () => {
    expect(
      matchNumeric('The answer is $9.00', '9', { tolerance: 0.01, value: 9 } as any).passed,
    ).toBe(true);
  });

  it('should return error when cannot parse number', () => {
    const result = matchNumeric('no number here', undefined, { value: 42 } as any);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Could not parse number');
  });
});
