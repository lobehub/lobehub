import { describe, expect, it } from 'vitest';

import { remainingTopicIds } from './useAssociateTopicsRun';

describe('remainingTopicIds', () => {
  it('keeps only the topics a failed run never reached, in their original order', () => {
    expect(
      remainingTopicIds(['a', 'b', 'c', 'd'], {
        error: new Error('boom'),
        movedTopicIds: ['a'],
        skippedTopics: [{ id: 'c', reason: 'running' }],
      }),
    ).toEqual(['b', 'd']);
  });
});
