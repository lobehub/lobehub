import { describe, expect, it } from 'vitest';

import { createMemorySearchParams } from './searchParams';

describe('createMemorySearchParams', () => {
  it('returns queries array using the highest-priority non-empty source', () => {
    expect(
      createMemorySearchParams({
        latestUserMessage: 'latest',
        sendingMessage: 'sending',
        topic: { historySummary: '  summary query  ' },
      }),
    ).toEqual({
      queries: ['summary query'],
      topK: {
        activities: 3,
        contexts: 0,
        experiences: 0,
        preferences: 3,
      },
    });
  });

  it('returns undefined when every source is empty', () => {
    expect(
      createMemorySearchParams({
        agent: { description: '   ' },
        latestUserMessage: '',
        sendingMessage: '   ',
        topic: { historySummary: null },
      }),
    ).toBeUndefined();
  });
});
