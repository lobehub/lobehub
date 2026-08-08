import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useChatStore } from '../../store';

vi.mock('@/services/message', () => ({
  messageService: {
    updateMessageTTS: vi.fn(),
    updateMessageTranslate: vi.fn(),
    updateMessage: vi.fn(),
  },
}));

const agentId = 'agent-id';
const messageId = 'message-id';
const messagesKey = messageMapKey({ agentId });

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({
    activeAgentId: agentId,
    dbMessagesMap: {
      [messagesKey]: [
        {
          content: 'Message content',
          createdAt: Date.now(),
          id: messageId,
          role: 'assistant',
          updatedAt: Date.now(),
        },
      ],
    },
    messagesMap: {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatTTSAction', () => {
  describe('startMessageTTS', () => {
    it('should start TTS locally without persisting an empty payload', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.startMessageTTS(messageId);
      });

      const message = useChatStore.getState().dbMessagesMap[messagesKey][0];
      expect(message.extra?.tts).toEqual({});
      expect(messageService.updateMessageTTS).not.toHaveBeenCalled();
    });
  });

  describe('saveMessageTTS', () => {
    it('should update local state and persist complete TTS metadata', async () => {
      const { result } = renderHook(() => useChatStore());
      const data = { contentMd5: 'content-md5', file: 'file-id', voice: 'voice-id' };

      await act(async () => {
        await result.current.saveMessageTTS(messageId, data);
      });

      const message = useChatStore.getState().dbMessagesMap[messagesKey][0];
      expect(message.extra?.tts).toEqual(data);
      expect(messageService.updateMessageTTS).toHaveBeenCalledWith(messageId, data);
    });
  });

  describe('clearMessageTTS', () => {
    it('should clear local TTS state and persist the deletion', async () => {
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.clearMessageTTS(messageId);
      });

      const message = useChatStore.getState().dbMessagesMap[messagesKey][0];
      expect(message.extra?.tts).toBeUndefined();
      expect(messageService.updateMessageTTS).toHaveBeenCalledWith(messageId, false);
    });
  });
});
