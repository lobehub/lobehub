import { describe, expect, it } from 'vitest';

import { deviceMetricsBacklogFileName } from './backlogFileName';

describe('deviceMetricsBacklogFileName', () => {
  it('keeps ids that sanitize to the same prefix in different files', () => {
    const names = ['prod/api', 'prod:api', 'prod_api', 'Prod_api'].map(
      deviceMetricsBacklogFileName,
    );
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
  });

  it('is stable and a safe single path segment', () => {
    const name = deviceMetricsBacklogFileName('../../etc/passwd');
    expect(name).toBe(deviceMetricsBacklogFileName('../../etc/passwd'));
    expect(name).toMatch(/^[\w-]+\.json$/);
  });

  it('bounds the length for very long ids', () => {
    expect(deviceMetricsBacklogFileName('x'.repeat(1000)).length).toBeLessThanOrEqual(64 + 22);
  });
});
