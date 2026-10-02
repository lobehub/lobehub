import { describe, expect, it } from 'vitest';

import { getThreadListHeadingKey, SUBAGENT_LIST_HEADING, THREAD_LIST_HEADING } from './heading';

describe('getThreadListHeadingKey', () => {
  it('labels a list made only of subagent threads as Subagents', () => {
    expect(getThreadListHeadingKey([{ type: 'isolation' }, { type: 'isolation' }])).toBe(
      SUBAGENT_LIST_HEADING,
    );
  });

  // Regression: the heading called every row a subagent while
  // `getThreadsByTopic` also returns user forks (continuation / standalone).
  it('uses the inclusive heading when subagent threads are mixed with forks', () => {
    expect(getThreadListHeadingKey([{ type: 'isolation' }, { type: 'continuation' }])).toBe(
      THREAD_LIST_HEADING,
    );
    expect(getThreadListHeadingKey([{ type: 'standalone' }])).toBe(THREAD_LIST_HEADING);
  });
});
