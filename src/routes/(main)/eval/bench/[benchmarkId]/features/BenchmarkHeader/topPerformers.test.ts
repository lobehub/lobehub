import type { AgentEvalRunListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { topPerformersOf } from './topPerformers';

const run = (fields: Record<string, unknown>) => fields as unknown as AgentEvalRunListItem;

describe('topPerformersOf', () => {
  it('names model runs by their contender instead of grouping them all as Unknown', () => {
    const top = topPerformersOf([
      run({
        config: { model: 'deepseek/deepseek-v4.1-flash', provider: 'openrouter' },
        name: 'DeepSeek V4.1 Flash',
        passRate: 0.8,
      }),
      run({
        config: { model: 'anthropic/claude-haiku-5.5', provider: 'openrouter' },
        name: 'Claude Haiku 5.5',
        passRate: 0.6,
      }),
      run({
        config: { model: 'deepseek/deepseek-v4.1-flash', provider: 'openrouter' },
        name: 'DeepSeek V4.1 Flash',
        passRate: 0.7,
      }),
    ]);
    expect(top.map((p) => p.name)).toEqual(['DeepSeek V4.1 Flash', 'Claude Haiku 5.5']);
    expect(top[0].avgPassRate).toBeCloseTo(0.75);
  });

  it("keeps grouping an Agent's runs under its title", () => {
    const top = topPerformersOf([
      run({ passRate: 0.5, targetAgent: { id: 'agt_1', title: 'Writer' }, targetAgentId: 'agt_1' }),
      run({ passRate: 1, targetAgent: { id: 'agt_1', title: 'Writer' }, targetAgentId: 'agt_1' }),
    ]);
    expect(top).toEqual([{ avgPassRate: 0.75, name: 'Writer' }]);
  });
});
