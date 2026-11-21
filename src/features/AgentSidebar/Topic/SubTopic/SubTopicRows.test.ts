import { describe, expect, it } from 'vitest';

import { SUB_TOPIC_PAGE_SIZE, visibleSubTopicCount } from './SubTopicRows';

describe('visibleSubTopicCount', () => {
  it('draws one page at first and never more rows than there are', () => {
    expect(visibleSubTopicCount(SUB_TOPIC_PAGE_SIZE * 3, 1, -1)).toBe(SUB_TOPIC_PAGE_SIZE);
    expect(visibleSubTopicCount(5, 1, -1)).toBe(5);
  });

  it('adds a page per "show more"', () => {
    expect(visibleSubTopicCount(SUB_TOPIC_PAGE_SIZE * 3, 2, -1)).toBe(SUB_TOPIC_PAGE_SIZE * 2);
  });

  it('keeps the open conversation drawn however far down it is', () => {
    expect(visibleSubTopicCount(100, 1, 57)).toBe(58);
  });
});
