import { describe, expect, it } from 'vitest';

import { filterMyInboxTopics } from './scopeTogglePlacement';

describe('filterMyInboxTopics', () => {
  it('keeps only the rows the viewer started', () => {
    const topics = [
      { id: 'mine', userId: 'me' },
      { id: 'theirs', userId: 'teammate' },
    ];

    expect(filterMyInboxTopics(topics, 'me')).toEqual([topics[0]]);
  });
});
