import { describe, expect, it, vi } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import type {
  HeterogeneousAgentBuildPlanHelpers,
  HeterogeneousAgentBuildPlanParams,
} from '../types';
import { cursorDriver } from './cursor';

const buildAgentInput = vi.fn(async () => ({ args: [], stdin: '-inspect this repository' }));
const helpers: HeterogeneousAgentBuildPlanHelpers = { buildAgentInput };

const buildParams = (
  overrides: Partial<HeterogeneousAgentBuildPlanParams> = {},
): HeterogeneousAgentBuildPlanParams => ({
  args: [],
  helpers,
  promptInput: '-inspect this repository',
  ...overrides,
});

describe('cursorDriver', () => {
  it('is registered and composes headless, resume, model, and positional prompt args', async () => {
    expect(getHeterogeneousAgentDriver('cursor')).toBe(cursorDriver);

    const plan = await cursorDriver.buildSpawnPlan(
      buildParams({ args: ['--model', 'sonnet-4-thinking'], resumeSessionId: 'cursor-session' }),
    );

    expect(buildAgentInput).toHaveBeenCalledWith('cursor', '-inspect this repository');
    expect(plan).toEqual({
      args: [
        '-p',
        '--force',
        '--trust',
        '--output-format',
        'stream-json',
        '--stream-partial-output',
        '--resume',
        'cursor-session',
        '--model',
        'sonnet-4-thinking',
        '--',
      ],
      argvPayload: '-inspect this repository',
    });
  });
});
