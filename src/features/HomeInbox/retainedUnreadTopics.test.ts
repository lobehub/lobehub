import { describe, expect, it } from 'vitest';

import { reconcileRetainedUnreadTopics, removeRetainedUnreadTopic } from './retainedUnreadTopics';

describe('retained unread topics', () => {
  it('keeps a locally opened row mounted until the authoritative feed is replaced', () => {
    const expanded = { ids: ['topic-1', 'topic-2'], indexObservedAt: 100 };

    expect(reconcileRetainedUnreadTopics(expanded, ['topic-2'], 100)).toEqual(expanded);
    expect(reconcileRetainedUnreadTopics(expanded, ['topic-2'], 200)).toEqual({
      ids: ['topic-2'],
      indexObservedAt: 200,
    });
  });

  it('removes a row immediately when a follow-up promotes it to running', () => {
    expect(
      removeRetainedUnreadTopic({ ids: ['topic-1', 'topic-2'], indexObservedAt: 100 }, 'topic-1'),
    ).toEqual({ ids: ['topic-2'], indexObservedAt: 100 });
  });
});
