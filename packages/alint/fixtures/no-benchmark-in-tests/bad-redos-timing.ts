// Fixture: a ReDoS guard asserted with a wall-clock bound.
import { describe, expect, it } from 'vitest';

import { extractStatusCodeFromError } from '../googleErrorParser';

describe('extractStatusCodeFromError', () => {
  it('should not be vulnerable to ReDoS attacks', () => {
    const maliciousInput = `Error ${'a'.repeat(10_000)} [not matching]`;

    const startTime = Date.now();
    extractStatusCodeFromError(maliciousInput);
    const endTime = Date.now();

    // alint-expect
    expect(endTime - startTime).toBeLessThan(100);
  });
});
