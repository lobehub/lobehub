import { describe, expect, it, vi } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import type {
  HeterogeneousAgentBuildPlanHelpers,
  HeterogeneousAgentBuildPlanParams,
} from '../types';
import { opencodeDriver } from './opencode';

const buildAgentInput = vi.fn(async () => ({
  args: ['--file', '/tmp/image.png'],
  stdin: 'raw prompt',
}));
const helpers: HeterogeneousAgentBuildPlanHelpers = { buildAgentInput };

const buildParams = (
  overrides: Partial<HeterogeneousAgentBuildPlanParams> = {},
): HeterogeneousAgentBuildPlanParams => ({
  args: [],
  helpers,
  promptInput: 'raw prompt',
  ...overrides,
});

describe('opencodeDriver', () => {
  it('is registered and composes base, resume, configured, and input args in order', async () => {
    expect(getHeterogeneousAgentDriver('opencode')).toBe(opencodeDriver);

    const plan = await opencodeDriver.buildSpawnPlan(
      buildParams({ args: ['--model', 'provider/model'], resumeSessionId: 'session-exact' }),
    );

    expect(buildAgentInput).toHaveBeenCalledWith('opencode', 'raw prompt');
    expect(plan).toEqual({
      args: [
        'run',
        '--format',
        'json',
        '--thinking',
        '--auto',
        '--session',
        'session-exact',
        '--model',
        'provider/model',
        '--file',
        '/tmp/image.png',
      ],
      stdinPayload: 'raw prompt',
    });
  });
});
