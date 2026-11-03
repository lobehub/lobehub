import { describe, expect, it } from 'vitest';

import { matchAnyOf } from '../anyOf';

describe('matchAnyOf', () => {
  it('should pass when matching any candidate', () => {
    expect(matchAnyOf('Dog', { values: ['cat', 'dog', 'bird'] } as any).passed).toBe(true);
  });

  it('should fail when none match', () => {
    expect(matchAnyOf('fish', { values: ['cat', 'dog'] } as any).passed).toBe(false);
  });

  it('should respect caseSensitive flag', () => {
    const config = { caseSensitive: true, values: ['Dog'] } as any;
    expect(matchAnyOf('dog', config).passed).toBe(false);
    expect(matchAnyOf('Dog', config).passed).toBe(true);
  });
});
