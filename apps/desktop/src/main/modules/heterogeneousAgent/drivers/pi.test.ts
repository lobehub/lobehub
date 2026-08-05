import { describe, expect, it, vi } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import type {
  HeterogeneousAgentBuildPlanHelpers,
  HeterogeneousAgentBuildPlanParams,
} from '../types';
import { piDriver } from './pi';

const buildAgentInput = vi.fn(async () => ({
  args: ['@/tmp/image.png'],
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

describe('piDriver', () => {
  it('is registered and composes base, resume, configured, and input args in order', async () => {
    expect(getHeterogeneousAgentDriver('pi')).toBe(piDriver);

    const plan = await piDriver.buildSpawnPlan(
      buildParams({ args: ['--provider', 'anthropic'], resumeSessionId: 'pi-session-exact' }),
    );

    expect(buildAgentInput).toHaveBeenCalledWith('pi', 'raw prompt');
    expect(plan).toEqual({
      args: [
        '--mode',
        'json',
        '--session-id',
        'pi-session-exact',
        '--provider',
        'anthropic',
        '@/tmp/image.png',
      ],
      stdinPayload: 'raw prompt',
    });
  });
});
