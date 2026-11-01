import type { AssistantContentBlock } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { accumulateUsage } from './utils';

describe('accumulateUsage', () => {
  it('carries CLI subscription credits into the task footer total', () => {
    // Regression: Qoder reports every token field as 0 and bills in credits;
    // the task rollup dropped them, so the footer showed no consumption.
    const blocks = [
      { content: '', id: 'a', usage: { credits: 0.25, totalTokens: 0 } },
      { content: 'done', id: 'b', usage: { credits: 0.5, totalTokens: 0 } },
    ] as AssistantContentBlock[];

    expect(accumulateUsage(blocks)).toMatchObject({ credits: 0.75, totalTokens: 0 });
  });

  it('adds no credits field for token-billed runs', () => {
    const blocks = [
      { content: 'x', id: 'a', usage: { cost: 0.01, totalTokens: 30 } },
    ] as AssistantContentBlock[];

    expect(accumulateUsage(blocks)).not.toHaveProperty('credits');
  });
});
