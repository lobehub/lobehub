import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { topicService } from '@/services/topic';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { type ChatTopic } from '@/types/topic';

import { useChatStore } from '../../store';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Seed a loaded topic row whose local status is `active`. */
const seedActiveTopic = (topicId: string) => {
  const key = topicMapKey({ agentId: 'agent-1' });
  useChatStore.setState({
    topicDataMap: {
      [key]: { items: [{ id: topicId, status: 'active' } as ChatTopic] } as any,
    },
  });
};

describe('updateTopicStatus', () => {
  // ROOT CAUSE:
  //
  // A paused run that ends while its topic is open pins the local row `active`
  // without persisting it, so the server can still read `waitingForHuman`.
  // Stopping the run an approval resumed then wrote `active`, which the
  // same-status shortcut swallowed: the sidebar kept "waiting for you".
  //
  // Before: a write matching the local row never reached the server.
  // After: `force` persists it anyway.
  it('skips a write that matches the local row', async () => {
    // Unique ids: pending status writes outlive the store state between tests.
    seedActiveTopic('status-skip-topic');
    const updateSpy = vi.spyOn(topicService, 'updateTopic').mockResolvedValue(undefined as any);

    await act(() =>
      useChatStore
        .getState()
        .updateTopicStatus({ agentId: 'agent-1', status: 'active', topicId: 'status-skip-topic' }),
    );

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('persists a forced write even when the local row already matches', async () => {
    seedActiveTopic('status-force-topic');
    const updateSpy = vi.spyOn(topicService, 'updateTopic').mockResolvedValue(undefined as any);

    await act(() =>
      useChatStore.getState().updateTopicStatus({
        agentId: 'agent-1',
        force: true,
        status: 'active',
        topicId: 'status-force-topic',
      }),
    );

    expect(updateSpy).toHaveBeenCalledWith('status-force-topic', { status: 'active' });
  });
});
