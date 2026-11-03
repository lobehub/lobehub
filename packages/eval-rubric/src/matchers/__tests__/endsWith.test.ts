import { describe, expect, it } from 'vitest';

import { matchEndsWith } from '../endsWith';

describe('matchEndsWith', () => {
  it('should pass when ends with expected', () => {
    expect(matchEndsWith('Hello world', 'world').passed).toBe(true);
  });

  it('should fail when not ending with expected', () => {
    expect(matchEndsWith('Hello world', 'hello').passed).toBe(false);
  });
});
