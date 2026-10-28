import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { invalidateTopicPreview } from '@/services/message/topicPreview';
import { useChatStore } from '@/store/chat';

vi.mock('@/services/message/topicPreview', () => ({ invalidateTopicPreview: vi.fn() }));

describe('internal_dispatchMessage', () => {
  it("drops the topic's preview on a local message change", () => {
    act(() => {
      useChatStore.getState().internal_dispatchMessage(
        {
          id: 'msg_local',
          type: 'createMessage',
          value: { content: 'hi', role: 'user' },
        },
        { context: { agentId: 'agt_1', threadId: null, topicId: 'tpc_a' } },
      );
    });

    expect(invalidateTopicPreview).toHaveBeenCalledWith('tpc_a');
  });
});
