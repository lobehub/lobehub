import { describe, expect, it } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import { antigravityDriver } from './antigravity';

describe('antigravityDriver', () => {
  it('is registered and routes prompts through the native ACP session', async () => {
    expect(getHeterogeneousAgentDriver('antigravity')).toBe(antigravityDriver);
    await expect(antigravityDriver.buildSpawnPlan({} as never)).rejects.toThrow(
      'native ACP session',
    );
  });
});
