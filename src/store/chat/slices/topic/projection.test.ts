import { describe, expect, it } from 'vitest';

import type { TopicData } from './initialState';
import { normalizeTopicListParams, topicListFilterOf } from './projection';

const bucket = (data: Partial<TopicData>): TopicData => ({
  currentPage: 0,
  hasMore: false,
  items: [],
  pageSize: 20,
  total: 0,
  ...data,
});

describe('topicListFilterOf', () => {
  it('returns nothing for an unloaded or unfiltered bucket', () => {
    expect(topicListFilterOf(undefined)).toBeUndefined();
    expect(topicListFilterOf(bucket({}))).toBeUndefined();
  });

  /** @example A send in a workspace must not echo other members' topics back into the filtered list. */
  it('forwards the only-mine filter alongside the status and trigger filters', () => {
    expect(
      topicListFilterOf(
        bucket({ excludeStatuses: ['completed'], excludeTriggers: ['cron'], onlyMine: true }),
      ),
    ).toEqual({ excludeStatuses: ['completed'], excludeTriggers: ['cron'], onlyMine: true });
    expect(topicListFilterOf(bucket({ onlyMine: true }))).toEqual({ onlyMine: true });
  });
});

describe('normalizeTopicListParams onlyMine', () => {
  it('drops a disabled only-mine filter so the request identity stays unchanged', () => {
    expect(normalizeTopicListParams({ agentId: 'a', onlyMine: false })?.onlyMine).toBeUndefined();
    expect(normalizeTopicListParams({ agentId: 'a', onlyMine: true })?.onlyMine).toBe(true);
  });
});
