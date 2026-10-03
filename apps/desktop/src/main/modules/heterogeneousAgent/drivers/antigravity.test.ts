import { buildAgentInput } from '@lobechat/heterogeneous-agents/spawn';
import { describe, expect, it } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import { antigravityDriver } from './antigravity';

describe('antigravityDriver', () => {
  it('registers the native driver and resumes using text on stdin', async () => {
    expect(getHeterogeneousAgentDriver('antigravity')).toBe(antigravityDriver);
    const plan = await antigravityDriver.buildSpawnPlan({
      args: ['--effort', 'high'],
      helpers: { buildAgentInput },
      promptInput: 'hello\nworld',
      resumeSessionId: 'conv-1',
    });
    expect(plan.args).toEqual([
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--conversation',
      'conv-1',
      '--effort',
      'high',
    ]);
    expect(JSON.parse(plan.stdinPayload!)).toEqual({
      event: 'user',
      message: { content: 'hello\nworld' },
    });
  });
});
