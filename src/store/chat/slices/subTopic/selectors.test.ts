import { describe, expect, it } from 'vitest';

import { subTopicSelectors } from './selectors';

const state = (map: Record<string, any[]>) => ({ subTopicTreeMap: map }) as any;

describe('subTopicSelectors.hasSubTopics', () => {
  it('is true for a topic that opened a sub-topic on screen', () => {
    const s = state({ 'tpc_a,tpc_b': [{ id: 'tpc_c', openedBy: { topicId: 'tpc_a' } }] });

    expect(subTopicSelectors.hasSubTopics('tpc_a')(s)).toBe(true);
    expect(subTopicSelectors.hasSubTopics('tpc_b')(s)).toBe(false);
    expect(subTopicSelectors.hasSubTopics(undefined)(s)).toBe(false);
  });
});
