import { describe, expect, it } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import { devinDriver } from './devin';

describe('devinDriver', () => {
  it('is registered and routes prompts through the native ACP session', async () => {
    expect(getHeterogeneousAgentDriver('devin')).toBe(devinDriver);
    await expect(devinDriver.buildSpawnPlan({} as never)).rejects.toThrow('native ACP session');
  });
});
