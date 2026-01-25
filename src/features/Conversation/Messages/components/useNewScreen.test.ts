import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNewScreen } from './useNewScreen';

// Mock useConversationStore
const mockGetViewportSize = vi.fn();
vi.mock('../../store', () => ({
  useConversationStore: vi.fn((selector) =>
    selector({
      virtuaScrollMethods: {
        getViewportSize: mockGetViewportSize,
      },
    }),
  ),
}));

describe('useNewScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetViewportSize.mockReturnValue(800);
  });

  describe('when not the latest item', () => {
    it('should return undefined minHeight', () => {
      const { result } = renderHook(() =>
        useNewScreen({
          creating: true,
          isLatestItem: false,
          messageId: 'msg-1',
        }),
      );

      expect(result.current.minHeight).toBeUndefined();
    });

    it('should clear minHeight when becoming not the latest item', () => {
      const { result, rerender } = renderHook(
        ({ isLatestItem }) =>
          useNewScreen({
            creating: true,
            isLatestItem,
            messageId: 'msg-1',
          }),
        {
          initialProps: { isLatestItem: true },
        },
      );

      // Initially, it will use fallback since no DOM elements exist
      expect(result.current.minHeight).toBeDefined();

      // When it's no longer the latest item
      rerender({ isLatestItem: false });

      expect(result.current.minHeight).toBeUndefined();
    });
  });

  describe('when latest item but not creating', () => {
    it('should not update minHeight (preserve existing value)', () => {
      const { result, rerender } = renderHook(
        ({ creating }) =>
          useNewScreen({
            creating,
            isLatestItem: true,
            messageId: 'msg-1',
          }),
        {
          initialProps: { creating: true },
        },
      );

      // Initially sets minHeight (fallback)
      const initialMinHeight = result.current.minHeight;
      expect(initialMinHeight).toBeDefined();

      // When creating ends, should preserve the minHeight
      rerender({ creating: false });

      expect(result.current.minHeight).toBe(initialMinHeight);
    });
  });

  describe('when latest item and creating', () => {
    it('should calculate minHeight based on viewport and previous message height', () => {
      // Setup DOM mocks
      const mockPrevMessageEl = {
        getBoundingClientRect: () => ({ height: 150 }),
      };
      const mockPrevWrapper = {
        querySelector: vi.fn().mockReturnValue(mockPrevMessageEl),
        getBoundingClientRect: () => ({ height: 150 }),
      };
      const mockCurrentWrapper = {
        dataset: { index: '1' },
      };
      const mockMessageEl = {
        closest: vi.fn().mockReturnValue(mockCurrentWrapper),
      };

      vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
        if (selector === '[data-message-id="msg-1"]') {
          return mockMessageEl as unknown as Element;
        }
        if (selector === '[data-index="0"]') {
          return mockPrevWrapper as unknown as Element;
        }
        return null;
      });

      mockGetViewportSize.mockReturnValue(800);

      const { result } = renderHook(() =>
        useNewScreen({
          creating: true,
          isLatestItem: true,
          messageId: 'msg-1',
        }),
      );

      // minHeight = viewportHeight - prevHeight - EXTRA_PADDING = 800 - 150 - 0 = 650
      expect(result.current.minHeight).toBe('650px');
    });

    it('should use fallback height when previous message element not found', () => {
      // Setup DOM mocks - no previous element
      const mockCurrentWrapper = {
        dataset: { index: '0' },
        querySelector: vi.fn().mockReturnValue(null),
      };
      const mockMessageEl = {
        closest: vi.fn().mockReturnValue(mockCurrentWrapper),
      };

      vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
        if (selector === '[data-message-id="msg-1"]') {
          return mockMessageEl as unknown as Element;
        }
        return null;
      });

      mockGetViewportSize.mockReturnValue(800);

      const { result } = renderHook(() =>
        useNewScreen({
          creating: true,
          isLatestItem: true,
          messageId: 'msg-1',
        }),
      );

      // fallback: viewportHeight - DEFAULT_USER_MESSAGE_HEIGHT - EXTRA_PADDING = 800 - 200 - 0 = 600
      expect(result.current.minHeight).toBe('600px');
    });

    it('should return undefined when calculated height is less than or equal to 0', () => {
      // Setup DOM mocks with very large previous message
      const mockPrevMessageEl = {
        getBoundingClientRect: () => ({ height: 900 }), // Larger than viewport
      };
      const mockPrevWrapper = {
        querySelector: vi.fn().mockReturnValue(mockPrevMessageEl),
        getBoundingClientRect: () => ({ height: 900 }),
      };
      const mockCurrentWrapper = {
        dataset: { index: '1' },
      };
      const mockMessageEl = {
        closest: vi.fn().mockReturnValue(mockCurrentWrapper),
      };

      vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
        if (selector === '[data-message-id="msg-1"]') {
          return mockMessageEl as unknown as Element;
        }
        if (selector === '[data-index="0"]') {
          return mockPrevWrapper as unknown as Element;
        }
        return null;
      });

      mockGetViewportSize.mockReturnValue(800);

      const { result } = renderHook(() =>
        useNewScreen({
          creating: true,
          isLatestItem: true,
          messageId: 'msg-1',
        }),
      );

      // minHeight = 800 - 900 - 0 = -100, should be undefined
      expect(result.current.minHeight).toBeUndefined();
    });

    it('should use window.innerHeight when virtuaScrollMethods is not available', () => {
      // Reset mock to return undefined for virtuaScrollMethods
      vi.mocked(mockGetViewportSize).mockReturnValue(undefined as unknown as number);

      // Mock window.innerHeight
      Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });

      // Setup DOM mocks - no previous element (fallback case)
      const mockCurrentWrapper = {
        dataset: { index: '0' },
        querySelector: vi.fn().mockReturnValue(null),
      };
      const mockMessageEl = {
        closest: vi.fn().mockReturnValue(mockCurrentWrapper),
      };

      vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
        if (selector === '[data-message-id="msg-1"]') {
          return mockMessageEl as unknown as Element;
        }
        return null;
      });

      const { result } = renderHook(() =>
        useNewScreen({
          creating: true,
          isLatestItem: true,
          messageId: 'msg-1',
        }),
      );

      // fallback: window.innerHeight - DEFAULT_USER_MESSAGE_HEIGHT = 768 - 200 = 568
      expect(result.current.minHeight).toBe('568px');
    });
  });

  describe('edge cases', () => {
    it('should handle message element not found', () => {
      vi.spyOn(document, 'querySelector').mockReturnValue(null);

      const { result } = renderHook(() =>
        useNewScreen({
          creating: true,
          isLatestItem: true,
          messageId: 'non-existent',
        }),
      );

      // Should use fallback
      expect(result.current.minHeight).toBeDefined();
    });

    it('should handle negative prevIndex', () => {
      const mockCurrentWrapper = {
        dataset: { index: '0' }, // First item, prevIndex would be -1
        querySelector: vi.fn().mockReturnValue(null),
      };
      const mockMessageEl = {
        closest: vi.fn().mockReturnValue(mockCurrentWrapper),
      };

      vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
        if (selector === '[data-message-id="msg-1"]') {
          return mockMessageEl as unknown as Element;
        }
        // Should not query for [data-index="-1"]
        if (selector === '[data-index="-1"]') {
          throw new Error('Should not query for negative index');
        }
        return null;
      });

      mockGetViewportSize.mockReturnValue(800);

      const { result } = renderHook(() =>
        useNewScreen({
          creating: true,
          isLatestItem: true,
          messageId: 'msg-1',
        }),
      );

      // Should use fallback without throwing
      expect(result.current.minHeight).toBe('600px');
    });

    it('should recalculate when messageId changes', () => {
      const mockPrevMessageEl = {
        getBoundingClientRect: () => ({ height: 150 }),
      };
      const mockPrevWrapper = {
        querySelector: vi.fn().mockReturnValue(mockPrevMessageEl),
        getBoundingClientRect: () => ({ height: 150 }),
      };
      const mockCurrentWrapper = {
        dataset: { index: '1' },
      };
      const mockMessageEl = {
        closest: vi.fn().mockReturnValue(mockCurrentWrapper),
      };

      vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
        if (selector.includes('data-message-id')) {
          return mockMessageEl as unknown as Element;
        }
        if (selector === '[data-index="0"]') {
          return mockPrevWrapper as unknown as Element;
        }
        return null;
      });

      mockGetViewportSize.mockReturnValue(800);

      const { result, rerender } = renderHook(
        ({ messageId }) =>
          useNewScreen({
            creating: true,
            isLatestItem: true,
            messageId,
          }),
        {
          initialProps: { messageId: 'msg-1' },
        },
      );

      expect(result.current.minHeight).toBe('650px');

      // Change messageId - should recalculate
      rerender({ messageId: 'msg-2' });

      // Still the same value since mocks return same values
      expect(result.current.minHeight).toBe('650px');
    });
  });
});
