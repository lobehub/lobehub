import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScrollToUserMessage } from './useScrollToUserMessage';

describe('useScrollToUserMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('when user sends a new message', () => {
    it('should retry scrolling to user message when 2 new messages are added and spacer is active', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser, spacerActive }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
            spacerActive,
          }),
        {
          initialProps: {
            dataSourceLength: 2,
            isSecondLastMessageFromUser: false,
            spacerActive: false,
          },
        },
      );

      // User sends a new message (2 messages added: user + assistant, second-to-last is user)
      // spacerActive is already true (e.g. from previous message)
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(scrollToIndex).toHaveBeenCalledTimes(3);
      expect(scrollToIndex).toHaveBeenNthCalledWith(1, 2, { align: 'start', smooth: true });
      expect(scrollToIndex).toHaveBeenNthCalledWith(2, 2, { align: 'start', smooth: true });
      expect(scrollToIndex).toHaveBeenNthCalledWith(3, 2, { align: 'start', smooth: true });
    });

    it('should scroll immediately and re-scroll when spacer becomes active', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser, spacerActive }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
            spacerActive,
          }),
        {
          initialProps: {
            dataSourceLength: 2,
            isSecondLastMessageFromUser: false,
            spacerActive: false,
          },
        },
      );

      // User sends a new message, spacer not yet active
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: false,
      });

      act(() => {
        vi.runAllTimers();
      });

      // Should scroll immediately even without spacer (content may fill viewport)
      expect(scrollToIndex).toHaveBeenCalledTimes(3);
      expect(scrollToIndex).toHaveBeenNthCalledWith(1, 2, { align: 'start', smooth: true });

      scrollToIndex.mockClear();

      // Spacer becomes active – should re-scroll with correct fill height
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
      });

      act(() => {
        vi.runAllTimers();
      });

      // Follow-up scroll after spacer mounted
      expect(scrollToIndex).toHaveBeenCalledTimes(3);
      expect(scrollToIndex).toHaveBeenNthCalledWith(1, 2, { align: 'start', smooth: true });
    });

    it('should scroll without spacer when spacer never mounts (content fills viewport)', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser, spacerActive }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
            spacerActive,
          }),
        {
          initialProps: {
            dataSourceLength: 2,
            isSecondLastMessageFromUser: false,
            spacerActive: false,
          },
        },
      );

      // User sends a new message, spacer will never mount (height = 0)
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: false,
      });

      act(() => {
        vi.runAllTimers();
      });

      // Should still scroll – no spacer needed when content fills viewport
      expect(scrollToIndex).toHaveBeenCalledTimes(3);
      expect(scrollToIndex).toHaveBeenNthCalledWith(1, 2, { align: 'start', smooth: true });
    });

    it('should scroll to correct index when multiple user messages are sent', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser, spacerActive }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
            spacerActive,
          }),
        {
          initialProps: {
            dataSourceLength: 4,
            isSecondLastMessageFromUser: false,
            spacerActive: false,
          },
        },
      );

      // User sends a new message (2 messages added)
      rerender({
        dataSourceLength: 6,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(scrollToIndex).toHaveBeenNthCalledWith(1, 4, { align: 'start', smooth: true });
    });
  });

  describe('when AI/agent responds', () => {
    it('should NOT scroll when only 1 new message is added (AI response)', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser, spacerActive }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
            spacerActive,
          }),
        {
          initialProps: {
            dataSourceLength: 4,
            isSecondLastMessageFromUser: true,
            spacerActive: false,
          },
        },
      );

      // AI adds another message (only 1 message added, not 2)
      rerender({
        dataSourceLength: 5,
        isSecondLastMessageFromUser: false,
        spacerActive: true,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should NOT scroll when multiple agents respond in group chat', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser, spacerActive }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
            spacerActive,
          }),
        {
          initialProps: {
            dataSourceLength: 4,
            isSecondLastMessageFromUser: true,
            spacerActive: false,
          },
        },
      );

      // First agent responds (1 message added)
      rerender({
        dataSourceLength: 5,
        isSecondLastMessageFromUser: false,
        spacerActive: true,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();

      // Second agent responds (1 message added)
      rerender({
        dataSourceLength: 6,
        isSecondLastMessageFromUser: false,
        spacerActive: true,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should NOT scroll when 2 messages added but second-to-last is not user', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser, spacerActive }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
            spacerActive,
          }),
        {
          initialProps: {
            dataSourceLength: 4,
            isSecondLastMessageFromUser: false,
            spacerActive: false,
          },
        },
      );

      // 2 messages added but both are from AI (e.g., system messages)
      rerender({
        dataSourceLength: 6,
        isSecondLastMessageFromUser: false,
        spacerActive: true,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should NOT scroll when length decreases (message deleted)', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser, spacerActive }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
            spacerActive,
          }),
        {
          initialProps: {
            dataSourceLength: 6,
            isSecondLastMessageFromUser: true,
            spacerActive: false,
          },
        },
      );

      // Message deleted (length decreases)
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should NOT scroll when length stays the same', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser, spacerActive }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
            spacerActive,
          }),
        {
          initialProps: {
            dataSourceLength: 4,
            isSecondLastMessageFromUser: true,
            spacerActive: false,
          },
        },
      );

      // Length stays the same (content update, not new message)
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should handle null scrollToIndex gracefully', () => {
      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser, spacerActive }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex: null,
            spacerActive,
          }),
        {
          initialProps: {
            dataSourceLength: 2,
            isSecondLastMessageFromUser: false,
            spacerActive: false,
          },
        },
      );

      // Should not throw when scrollToIndex is null
      expect(() => {
        rerender({
          dataSourceLength: 4,
          isSecondLastMessageFromUser: true,
          spacerActive: true,
        });
      }).not.toThrow();
    });

    it('should NOT scroll on initial render', () => {
      const scrollToIndex = vi.fn();

      renderHook(() =>
        useScrollToUserMessage({
          dataSourceLength: 6,
          isSecondLastMessageFromUser: true,
          scrollToIndex,
          spacerActive: true,
        }),
      );

      // Should not scroll on initial render even if second-to-last message is from user
      expect(scrollToIndex).not.toHaveBeenCalled();
    });
  });
});
