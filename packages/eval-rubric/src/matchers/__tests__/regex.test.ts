import { describe, expect, it } from 'vitest';

import { matchRegex } from '../regex';

describe('matchRegex', () => {
  it('should pass when pattern matches', () => {
    expect(matchRegex('answer: 42', { pattern: '\\d+' } as any).passed).toBe(true);
  });

  it('should fail when no match', () => {
    expect(matchRegex('no numbers', { pattern: '\\d+' } as any).passed).toBe(false);
  });
});
