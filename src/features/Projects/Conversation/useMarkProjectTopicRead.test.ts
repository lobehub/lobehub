import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { type ProjectTopic } from '@/store/projectWorkingDirectory/projection';

import { useMarkProjectTopicRead } from './useMarkProjectTopicRead';

const revalidateReplica = vi.hoisted(() => vi.fn());
vi.mock('@/libs/replica', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidateReplica,
}));

const topic = (status: ProjectTopic['status']) =>
  ({ agentId: 'agent-1', id: 'topic-1', status }) as ProjectTopic;

describe('useMarkProjectTopicRead', () => {
  const markTopicRead = vi.fn();

  beforeEach(() => {
    markTopicRead.mockReset().mockResolvedValue(undefined);
    revalidateReplica.mockReset();
    useChatStore.setState({ markTopicRead });
  });

  afterEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
  });

  /** @example A run that finished while unwatched must leave "pending" once the project conversation is opened. */
  it('marks the open unread conversation read and refreshes the project rows', async () => {
    renderHook(() => useMarkProjectTopicRead('prj-1', topic('unread')));

    expect(markTopicRead).toHaveBeenCalledWith({
      agentId: 'agent-1',
      status: 'unread',
      topicId: 'topic-1',
    });
    await waitFor(() =>
      expect(revalidateReplica).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'projectTopics' }),
        'prj-1',
      ),
    );
  });

  it('clears a conversation that turns unread while it is open', () => {
    const { rerender } = renderHook(
      ({ status }) => useMarkProjectTopicRead('prj-1', topic(status)),
      {
        initialProps: { status: 'running' as ProjectTopic['status'] },
      },
    );
    expect(markTopicRead).not.toHaveBeenCalled();

    rerender({ status: 'unread' });

    expect(markTopicRead).toHaveBeenCalledTimes(1);
  });

  it('leaves a read conversation alone', () => {
    renderHook(() => useMarkProjectTopicRead('prj-1', topic('active')));

    expect(markTopicRead).not.toHaveBeenCalled();
  });
});
