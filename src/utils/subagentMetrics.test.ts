import { describe, expect, it } from 'vitest';

import { aggregateSubagentMetrics } from './subagentMetrics';

describe('aggregateSubagentMetrics', () => {
  it('counts role=tool messages and sums every assistant turn usage', () => {
    const result = aggregateSubagentMetrics([
      { role: 'user' },
      { metadata: { usage: { totalTokens: 1000 } }, model: 'claude-opus-4-8', role: 'assistant' },
      { role: 'tool' },
      { metadata: { usage: { totalTokens: 1800 } }, model: 'claude-opus-4-8', role: 'assistant' },
      { role: 'tool' },
      { metadata: { usage: { totalTokens: 2600 } }, role: 'assistant' },
    ]);

    // SUM, not last-turn: 1000 + 1800 + 2600
    expect(result.totalTokens).toBe(5400);
    expect(result.toolCalls).toBe(2);
    expect(result.model).toBe('claude-opus-4-8');
  });

  it('reads usage from the promoted top-level field too', () => {
    const result = aggregateSubagentMetrics([
      { role: 'assistant', usage: { totalTokens: 300 } },
      { metadata: { usage: { totalTokens: 700 } }, role: 'assistant' },
    ]);

    expect(result.totalTokens).toBe(1000);
  });

  it('returns zeros / undefined model for an empty or usage-less set', () => {
    expect(aggregateSubagentMetrics([])).toEqual({
      model: undefined,
      toolCalls: 0,
      totalTokens: 0,
    });
    expect(aggregateSubagentMetrics([{ role: 'assistant' }, { role: 'user' }])).toEqual({
      model: undefined,
      toolCalls: 0,
      totalTokens: 0,
    });
  });

  it('pins the first assistant model and ignores user/tool rows for tokens', () => {
    const result = aggregateSubagentMetrics([
      { model: 'model-a', role: 'assistant', usage: { totalTokens: 10 } },
      { model: 'model-b', role: 'assistant', usage: { totalTokens: 20 } },
      // user/tool rows never contribute tokens even if they carried a usage blob
      { role: 'user', usage: { totalTokens: 999 } },
    ]);

    expect(result.model).toBe('model-a');
    expect(result.totalTokens).toBe(30);
  });
});
