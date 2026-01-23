import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useScrollToUserMessage } from './useScrollToUserMessage';

describe('useScrollToUserMessage', () => {
  describe('when user sends a new message', () => {
    it('should scroll to user message when new message is from user', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 2,
            isLastMessageFromUser: false,
          },
        },
      );

      // User sends a new message (length increases, last message is from user)
      rerender({
        dataSourceLength: 3,
        isLastMessageFromUser: true,
      });

      expect(scrollToIndex).toHaveBeenCalledTimes(1);
      expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'start', smooth: true });
    });

    it('should scroll to correct index when multiple user messages are sent', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 5,
            isLastMessageFromUser: false,
          },
        },
      );

      // User sends a new message
      rerender({
        dataSourceLength: 6,
        isLastMessageFromUser: true,
      });

      // Should scroll to index 4 (dataSourceLength - 2 = 6 - 2 = 4)
      expect(scrollToIndex).toHaveBeenCalledWith(4, { align: 'start', smooth: true });
    });
  });

  describe('when AI/agent responds', () => {
    it('should NOT scroll when new message is from AI', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 2,
            isLastMessageFromUser: true,
          },
        },
      );

      // AI responds (length increases, but last message is NOT from user)
      rerender({
        dataSourceLength: 3,
        isLastMessageFromUser: false,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should NOT scroll when multiple agents respond in group chat', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 3,
            isLastMessageFromUser: false,
          },
        },
      );

      // First agent responds
      rerender({
        dataSourceLength: 4,
        isLastMessageFromUser: false,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();

      // Second agent responds
      rerender({
        dataSourceLength: 5,
        isLastMessageFromUser: false,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should NOT scroll when length decreases (message deleted)', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 5,
            isLastMessageFromUser: true,
          },
        },
      );

      // Message deleted (length decreases)
      rerender({
        dataSourceLength: 4,
        isLastMessageFromUser: true,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should NOT scroll when length stays the same', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 3,
            isLastMessageFromUser: true,
          },
        },
      );

      // Length stays the same (content update, not new message)
      rerender({
        dataSourceLength: 3,
        isLastMessageFromUser: true,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should handle null scrollToIndex gracefully', () => {
      const { rerender } = renderHook(
        ({ dataSourceLength, isLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isLastMessageFromUser,
            scrollToIndex: null,
          }),
        {
          initialProps: {
            dataSourceLength: 2,
            isLastMessageFromUser: false,
          },
        },
      );

      // Should not throw when scrollToIndex is null
      expect(() => {
        rerender({
          dataSourceLength: 3,
          isLastMessageFromUser: true,
        });
      }).not.toThrow();
    });

    it('should NOT scroll on initial render', () => {
      const scrollToIndex = vi.fn();

      renderHook(() =>
        useScrollToUserMessage({
          dataSourceLength: 5,
          isLastMessageFromUser: true,
          scrollToIndex,
        }),
      );

      // Should not scroll on initial render even if last message is from user
      expect(scrollToIndex).not.toHaveBeenCalled();
    });
  });
});
