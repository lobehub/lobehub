import { describe, expect, it } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import { piDriver } from './pi';

describe('piDriver', () => {
  it('is registered but rejects the legacy CLI spawn plan — pi is RPC-only', async () => {
    expect(getHeterogeneousAgentDriver('pi')).toBe(piDriver);

    await expect(piDriver.buildSpawnPlan({} as any)).rejects.toThrow(/RPC transport only/);
  });
});
