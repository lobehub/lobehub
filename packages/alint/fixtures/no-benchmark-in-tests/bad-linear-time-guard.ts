// Fixture: a complexity guard proven with a stopwatch instead of a deterministic signal.
import { describe, expect, it } from 'vitest';

import { parseGoalCommand } from '../goalCommand';

describe('parseGoalCommand', () => {
  it('scans adversarial separator runs in linear time', () => {
    const input = `lh goal create "${'a;'.repeat(20_000)}`;

    const startedAt = performance.now();
    const result = parseGoalCommand(input);
    // alint-expect
    expect(performance.now() - startedAt).toBeLessThan(1000);
    expect(result).toBeUndefined();
  });
});
