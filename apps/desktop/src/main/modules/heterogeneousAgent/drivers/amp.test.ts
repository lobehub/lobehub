import { describe, expect, it, vi } from 'vitest';

import type {
  HeterogeneousAgentBuildPlanHelpers,
  HeterogeneousAgentBuildPlanParams,
} from '../types';
import { ampDriver } from './amp';

const buildAgentInput = vi.fn(async () => ({
  args: [],
  stdin: '{"type":"user","message":{"content":[]}}\n',
}));

const stubHelpers: HeterogeneousAgentBuildPlanHelpers = { buildAgentInput };

const buildParams = (
  overrides: Partial<HeterogeneousAgentBuildPlanParams> = {},
): HeterogeneousAgentBuildPlanParams => ({
  args: [],
  helpers: stubHelpers,
  promptInput: 'hi',
  ...overrides,
});

describe('ampDriver', () => {
  it('uses AMP private headless stream-json flags and input plan', async () => {
    const plan = await ampDriver.buildSpawnPlan(buildParams({ args: ['--mode', 'high'] }));

    expect(buildAgentInput).toHaveBeenCalledWith('amp', 'hi');
    expect(plan.stdinPayload).toContain('"type":"user"');
    expect(plan.args).toEqual([
      '--execute',
      '--stream-json-thinking',
      '--stream-json-input',
      '--visibility',
      'private',
      '--no-ide',
      '--no-notifications',
      '--no-archive-after-execute',
      '--mode',
      'high',
    ]);
  });

  it('uses AMP thread continuation syntax without changing other drivers', async () => {
    const plan = await ampDriver.buildSpawnPlan(
      buildParams({ resumeSessionId: 'T-existing-thread' }),
    );

    expect(plan.args.slice(0, 4)).toEqual([
      'threads',
      'continue',
      'T-existing-thread',
      '--execute',
    ]);
  });
});
