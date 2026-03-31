import { describe, expect, it } from 'vitest';

import type { ChatTopic } from '@/types/topic';

import { getOnboardingHistoryTopics } from './history';

const createTopic = (id: string, title: string, updatedAt: number): ChatTopic => ({
  createdAt: updatedAt,
  id,
  title,
  updatedAt,
});

describe('getOnboardingHistoryTopics', () => {
  it('sorts topics by updatedAt in descending order', () => {
    const topics = [
      createTopic('topic-1', 'First', 100),
      createTopic('topic-3', 'Third', 300),
      createTopic('topic-2', 'Second', 200),
    ];

    const result = getOnboardingHistoryTopics(topics);

    expect(result.map((topic) => topic.id)).toEqual(['topic-3', 'topic-2', 'topic-1']);
  });

  it('does not mutate the input array', () => {
    const topics = [createTopic('topic-1', 'First', 100), createTopic('topic-2', 'Second', 200)];

    void getOnboardingHistoryTopics(topics);

    expect(topics.map((topic) => topic.id)).toEqual(['topic-1', 'topic-2']);
  });
});
