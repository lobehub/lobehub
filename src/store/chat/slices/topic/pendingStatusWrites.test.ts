import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatTopic } from '@/types/topic';

import { PendingTopicStatusWrites } from './pendingStatusWrites';

const row = (status: ChatTopic['status']) => ({ id: 'topic-1', status }) as ChatTopic;

describe('PendingTopicStatusWrites', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-applies a pinned status over a fetched row that predates it', () => {
    const writes = new PendingTopicStatusWrites();
    writes.pin('topic-1', 'unread');

    expect(writes.apply(row('running'), 'server').status).toBe('unread');
  });

  it('drops the pin once a server row confirms it', () => {
    const writes = new PendingTopicStatusWrites();
    writes.pin('topic-1', 'unread');

    writes.apply(row('unread'), 'server');

    expect(writes.apply(row('running'), 'server').status).toBe('running');
  });

  it('stops overriding fetched rows after the pin expires', () => {
    vi.useFakeTimers();
    const writes = new PendingTopicStatusWrites();
    writes.pin('topic-1', 'unread');

    vi.advanceTimersByTime(15_001);

    expect(writes.apply(row('running'), 'server').status).toBe('running');
  });

  describe('settle', () => {
    /** @example A clear that landed must not let the old unread pin bring the dot back. */
    it('drops the pin the compare-and-set replaced', () => {
      const writes = new PendingTopicStatusWrites();
      writes.pin('topic-1', 'unread');

      expect(writes.settle('topic-1', 'unread')).toBe(true);
      expect(writes.apply(row('active'), 'server').status).toBe('active');
    });

    /** @example A run started while the clear was in flight keeps its own pin. */
    it('yields to a newer pending write', () => {
      const writes = new PendingTopicStatusWrites();
      writes.pin('topic-1', 'running');

      expect(writes.settle('topic-1', 'unread')).toBe(false);
      expect(writes.apply(row('active'), 'server').status).toBe('running');
    });

    it('adds no pin of its own, so a later fetch stays authoritative', () => {
      const writes = new PendingTopicStatusWrites();

      expect(writes.settle('topic-1', 'unread')).toBe(true);
      expect(writes.apply(row('running'), 'server').status).toBe('running');
    });

    it('ignores an expired newer write', () => {
      vi.useFakeTimers();
      const writes = new PendingTopicStatusWrites();
      writes.pin('topic-1', 'running');
      vi.advanceTimersByTime(15_001);

      expect(writes.settle('topic-1', 'unread')).toBe(true);
    });
  });
});
