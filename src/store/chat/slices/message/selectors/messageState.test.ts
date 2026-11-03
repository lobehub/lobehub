import { describe, expect, it } from 'vitest';

import { type ChatStore } from '@/store/chat';

import { messageStateSelectors } from './messageState';

describe('messageStateSelectors', () => {
  describe('isToolCallStreaming', () => {
    it('should return true when tool call is streaming for given message and index', () => {
      const state: Partial<ChatStore> = {
        toolCallingStreamIds: {
          'msg-1': [true, false, true],
        },
      };
      expect(messageStateSelectors.isToolCallStreaming('msg-1', 0)(state as ChatStore)).toBe(true);
      expect(messageStateSelectors.isToolCallStreaming('msg-1', 2)(state as ChatStore)).toBe(true);
    });

    it('should return false when tool call is not streaming for given message and index', () => {
      const state: Partial<ChatStore> = {
        toolCallingStreamIds: {
          'msg-1': [true, false, true],
        },
      };
      expect(messageStateSelectors.isToolCallStreaming('msg-1', 1)(state as ChatStore)).toBe(false);
      expect(messageStateSelectors.isToolCallStreaming('msg-2', 0)(state as ChatStore)).toBe(false);
    });

    it('should return false when no streaming data exists for the message', () => {
      const state: Partial<ChatStore> = {
        toolCallingStreamIds: {},
      };
      expect(messageStateSelectors.isToolCallStreaming('msg-1', 0)(state as ChatStore)).toBe(false);
    });
  });
});
