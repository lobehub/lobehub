import { describe, expect, it } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import { traeDriver } from './trae';

describe('traeDriver', () => {
  it('is registered and builds the ACP server command', async () => {
    expect(getHeterogeneousAgentDriver('trae')).toBe(traeDriver);

    await expect(
      traeDriver.buildSpawnPlan({
        args: ['--feature=test'],
        helpers: { buildAgentInput: async () => ({ args: [], stdin: '' }) },
        promptInput: 'hello',
      }),
    ).resolves.toEqual({ args: ['acp', 'serve', '--yolo', '--feature=test'] });
  });
});
