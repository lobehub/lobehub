import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetVisibleTopicPrefetchQueue, useVisibleTopicPrefetch } from './useVisibleTopicPrefetch';

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  prefetchTopicMessagesBatch: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => mocks.getState() },
}));

const Row = ({ topicId }: { topicId?: string }) => {
  const ref = useVisibleTopicPrefetch(topicId);
  return createElement('div', { 'data-testid': 'row', ref });
};

let callbacks: IntersectionObserverCallback[] = [];
const disconnect = vi.fn();

const flushQueue = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
};

const intersect = async (index: number, isIntersecting = true) => {
  await act(async () => {
    callbacks[index]?.(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
};

describe('useVisibleTopicPrefetch', () => {
  beforeEach(() => {
    callbacks = [];
    disconnect.mockClear();
    vi.useFakeTimers();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          callbacks.push(callback);
        }

        disconnect = disconnect;
        observe = vi.fn();
        takeRecords = () => [];
        unobserve = vi.fn();
      },
    );
    mocks.getState.mockReturnValue({
      activeAgentId: 'agent-1',
      activeGroupId: null,
      prefetchTopicMessagesBatch: mocks.prefetchTopicMessagesBatch,
    });
    mocks.prefetchTopicMessagesBatch.mockClear();
    resetVisibleTopicPrefetchQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('coalesces the rows visible in one paint into a single batch call', async () => {
    render(
      <>
        <Row topicId="topic-a" />
        <Row topicId="topic-b" />
      </>,
    );

    await intersect(0);
    await intersect(1);
    await flushQueue();

    expect(mocks.prefetchTopicMessagesBatch).toHaveBeenCalledTimes(1);
    expect(mocks.prefetchTopicMessagesBatch).toHaveBeenCalledWith({
      agentId: 'agent-1',
      groupId: null,
      topicIds: ['topic-a', 'topic-b'],
    });
  });

  it('stops observing a row once it has been queued', async () => {
    render(<Row topicId="topic-c" />);

    await intersect(0);

    expect(disconnect).toHaveBeenCalled();
  });

  it('ignores rows that never enter the viewport', async () => {
    render(<Row topicId="topic-d" />);

    await intersect(0, false);
    await flushQueue();

    expect(mocks.prefetchTopicMessagesBatch).not.toHaveBeenCalled();
  });

  it('does not observe the default (id-less) topic row', () => {
    render(<Row />);

    expect(callbacks).toHaveLength(0);
  });
});
