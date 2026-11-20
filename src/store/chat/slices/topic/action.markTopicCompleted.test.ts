import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { topicService } from '@/services/topic';
import { initialState } from '@/store/chat/initialState';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { type ChatTopic } from '@/types/topic';

import { useChatStore } from '../../store';

const seed = (activeTopicId: string) =>
  useChatStore.setState({
    activeAgentId: 'agent-1',
    activeTopicId,
    topicDataMap: {
      [topicMapKey({ agentId: 'agent-1' })]: {
        items: [
          { id: 'current', status: 'active', title: 'current' },
          { id: 'other', status: 'active', title: 'other' },
        ] as ChatTopic[],
      } as any,
    },
  });

describe('markTopicCompleted', () => {
  beforeEach(() => {
    vi.spyOn(topicService, 'updateTopic').mockResolvedValue(undefined as any);
    vi.spyOn(useChatStore.getState(), 'refreshTopic').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.setState(initialState);
  });

  // Before: archiving the open topic left the user on it, unlike deleting it.
  // After: it opens a new topic, the same way `removeTopic` does.
  it('opens a new topic after archiving the active one', async () => {
    seed('current');
    const switchTopicSpy = vi.spyOn(useChatStore.getState(), 'switchTopic');

    await act(() => useChatStore.getState().markTopicCompleted('current'));

    expect(topicService.updateTopic).toHaveBeenCalledWith(
      'current',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(switchTopicSpy).toHaveBeenCalledWith(null);
  });

  it('stays on the active topic when archiving another one', async () => {
    seed('current');
    const switchTopicSpy = vi.spyOn(useChatStore.getState(), 'switchTopic');

    await act(() => useChatStore.getState().markTopicCompleted('other'));

    expect(switchTopicSpy).not.toHaveBeenCalled();
    expect(useChatStore.getState().activeTopicId).toBe('current');
  });

  it('stays on the topic when the archive fails', async () => {
    seed('current');
    vi.mocked(topicService.updateTopic).mockRejectedValue(new Error('network'));
    const switchTopicSpy = vi.spyOn(useChatStore.getState(), 'switchTopic');

    await expect(
      act(() => useChatStore.getState().markTopicCompleted('current')),
    ).rejects.toThrow();

    expect(switchTopicSpy).not.toHaveBeenCalled();
  });
});
