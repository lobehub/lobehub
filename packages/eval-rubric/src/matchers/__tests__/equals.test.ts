import { describe, expect, it } from 'vitest';

import { matchEquals } from '../equals';

describe('matchEquals', () => {
  it('should pass on exact match (case-insensitive)', () => {
    expect(matchEquals('Hello', 'hello').passed).toBe(true);
  });

  it('should fail on mismatch', () => {
    expect(matchEquals('Hello', 'world').passed).toBe(false);
  });

  it('should trim whitespace', () => {
    expect(matchEquals('  answer  ', 'answer').passed).toBe(true);
  });
});
