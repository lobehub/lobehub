import { describe, expect, it } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import { droidDriver } from './droid';

describe('droidDriver', () => {
  it('is registered and builds the fixed safe ACP command', async () => {
    expect(getHeterogeneousAgentDriver('droid')).toBe(droidDriver);

    await expect(
      droidDriver.buildSpawnPlan({
        args: ['--tag', 'lobe'],
        helpers: { buildAgentInput: async () => ({ args: [], stdin: '' }) },
        promptInput: 'hello',
      }),
    ).resolves.toEqual({
      args: ['exec', '--output-format', 'acp', '--tag', 'lobe'],
    });

    await expect(
      droidDriver.buildSpawnPlan({
        args: ['--skip-permissions-unsafe'],
        helpers: { buildAgentInput: async () => ({ args: [], stdin: '' }) },
        promptInput: 'hello',
      }),
    ).rejects.toThrow('does not support CLI argument');
  });
});
