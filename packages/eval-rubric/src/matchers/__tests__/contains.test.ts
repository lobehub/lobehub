import { describe, expect, it } from 'vitest';

import { matchContains } from '../contains';

describe('matchContains', () => {
  it('should pass when actual contains expected', () => {
    expect(matchContains('The answer is 42', '42').passed).toBe(true);
  });

  it('should fail when not contained', () => {
    expect(matchContains('no match', '42').passed).toBe(false);
  });
});
