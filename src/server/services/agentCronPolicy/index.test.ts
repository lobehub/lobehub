import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateCronPatternByDeployment } from './index';

describe('agentCronPolicy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should allow standard cron expressions in self-hosting mode', () => {
    vi.stubEnv('VERCEL', undefined);

    const result = validateCronPatternByDeployment('*/15 * * * *');

    expect(result.valid).toBe(true);
  });

  it('should enforce minimum interval in cloud mode', () => {
    vi.stubEnv('VERCEL', '1');

    const result = validateCronPatternByDeployment('*/15 * * * *');

    expect(result.valid).toBe(false);
    expect(result.message).toContain('minimum execution interval of 30 minutes');
  });

  it('should pass cloud validation for 30-minute interval', () => {
    vi.stubEnv('VERCEL', '1');

    const result = validateCronPatternByDeployment('*/30 * * * *');

    expect(result.valid).toBe(true);
  });
});
