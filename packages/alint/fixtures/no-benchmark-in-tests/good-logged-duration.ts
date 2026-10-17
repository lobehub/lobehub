// Fixture carve-out: a clock read that is reported, never asserted on.
import { describe, expect, it, vi } from 'vitest';

import { warmCache } from '../warmCache';

describe('warmCache', () => {
  it('reports the entries it loaded', async () => {
    const report = vi.fn();

    const started = performance.now();
    const result = await warmCache();
    report({ elapsedMs: performance.now() - started, loaded: result.length });

    expect(result).toHaveLength(3);
    expect(report).toHaveBeenCalledOnce();
  });
});
