import { describe, expect, it } from 'vitest';

import { type ChatTopic } from '@/types/topic';

import { getProjectTopicStatusCounts, hasProjectTopicStatusCounts } from './statusCounts';

const createTopic = (id: string, status?: ChatTopic['status']): ChatTopic =>
  ({
    createdAt: 0,
    favorite: false,
    id,
    status,
    title: id,
    updatedAt: 0,
  }) as ChatTopic;

describe('getProjectTopicStatusCounts', () => {
  it('counts loading, waiting-for-human, and failed topics by type', () => {
    const counts = getProjectTopicStatusCounts(
      [
        createTopic('running', 'running'),
        createTopic('client-loading'),
        createTopic('waiting', 'waitingForHuman'),
        createTopic('failed', 'failed'),
        createTopic('active', 'active'),
      ],
      new Set(['client-loading']),
    );

    expect(counts).toEqual({
      failed: 1,
      loading: 2,
      waitingForHuman: 1,
    });
    expect(hasProjectTopicStatusCounts(counts)).toBe(true);
  });

  it('uses the same precedence as topic row icons', () => {
    const counts = getProjectTopicStatusCounts(
      [createTopic('waiting', 'waitingForHuman'), createTopic('failed', 'failed')],
      new Set(['waiting', 'failed']),
    );

    expect(counts).toEqual({
      failed: 0,
      loading: 1,
      waitingForHuman: 1,
    });
  });

  it('reports empty counts when no actionable status exists', () => {
    const counts = getProjectTopicStatusCounts(
      [createTopic('active', 'active'), createTopic('completed', 'completed')],
      new Set(),
    );

    expect(counts).toEqual({
      failed: 0,
      loading: 0,
      waitingForHuman: 0,
    });
    expect(hasProjectTopicStatusCounts(counts)).toBe(false);
  });
});
