import { describe, expect, it } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import { copilotDriver } from './copilot';

const helpers = { buildAgentInput: async () => ({ args: [], stdin: '' }) };

describe('copilotDriver', () => {
  it('is registered and builds the fixed ACP server command', async () => {
    expect(getHeterogeneousAgentDriver('copilot')).toBe(copilotDriver);

    await expect(
      copilotDriver.buildSpawnPlan({
        args: ['--add-dir', '/repo'],
        helpers,
        promptInput: 'hello',
      }),
    ).resolves.toEqual({ args: ['--acp', '--add-dir', '/repo'] });
  });

  it.each(['--yolo', '--allow-all-tools', '--resume=abc', '-p'])(
    'rejects %s, which would bypass the host-owned ACP lifecycle or permission prompts',
    async (argument) => {
      await expect(
        copilotDriver.buildSpawnPlan({ args: [argument], helpers, promptInput: 'hello' }),
      ).rejects.toThrow('does not support CLI argument');
    },
  );
});
