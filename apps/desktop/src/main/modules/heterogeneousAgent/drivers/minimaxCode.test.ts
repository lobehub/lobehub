import { describe, expect, it } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import { minimaxCodeDriver } from './minimaxCode';

describe('minimaxCodeDriver', () => {
  it('is registered and builds the ACP command', async () => {
    expect(getHeterogeneousAgentDriver('minimax-code')).toBe(minimaxCodeDriver);

    await expect(
      minimaxCodeDriver.buildSpawnPlan({
        args: ['--feature=test'],
        helpers: { buildAgentInput: async () => ({ args: [], stdin: '' }) },
        promptInput: 'hello',
      }),
    ).resolves.toEqual({ args: ['acp', '--feature=test'] });
  });
});
