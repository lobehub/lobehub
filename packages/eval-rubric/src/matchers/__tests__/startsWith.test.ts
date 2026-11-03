import { describe, expect, it } from 'vitest';

import { matchStartsWith } from '../startsWith';

describe('matchStartsWith', () => {
  it('should pass when starts with expected', () => {
    expect(matchStartsWith('Hello world', 'hello').passed).toBe(true);
  });

  it('should fail when not starting with expected', () => {
    expect(matchStartsWith('Hello world', 'world').passed).toBe(false);
  });
});
