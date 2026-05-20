import { WebBrowsingApiName, WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { type SearchQuery, type UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import after mocks
import { useChatStore } from '@/store/chat';
import { dbMessageSelectors } from '@/store/chat/selectors';

// Mock the tools module to avoid importing the problematic dependencies
vi.mock('@lobechat/builtin-tool-web-browsing', () => ({
  WebBrowsingApiName: {
    search: 'search',
    crawlSinglePage: 'crawlSinglePage',
    crawlMultiPages: 'crawlMultiPages',
  },
  WebBrowsingManifest: {
    identifier: 'lobe-web-browsing',
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  dbMessageSelectors: {
    getDbMessageById: vi.fn(),
  },
}));

describe('search actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      activeAgentId: 'session-id',
      activeTopicId: 'topic-id',
      messageOperationMap: {},
      optimisticUpdatePluginArguments: vi.fn(),
      invokeBuiltinTool: vi.fn(),
    });

    // Default mock for dbMessageSelectors - returns undefined to use activeAgentId/activeTopicId
    vi.spyOn(dbMessageSelectors, 'getDbMessageById').mockImplementation(() => () => undefined);
  });

  describe('triggerSearchAgain', () => {
    it('should update arguments and call invokeBuiltinTool', async () => {
      const messageId = 'test-message-id';
      const operationId = 'op_test';
      const toolCallId = 'tool_call_123';

      // Mock message with tool_call_id
      const mockMessage: Partial<UIChatMessage> = {
        id: messageId,
        tool_call_id: toolCallId,
        role: 'tool',
        content: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.spyOn(dbMessageSelectors, 'getDbMessageById').mockImplementation(
        () => () => mockMessage as UIChatMessage,
      );

      const { result } = renderHook(() => useChatStore());

      // Set up messageOperationMap so triggerSearchAgain can get operationId
      useChatStore.setState({
        messageOperationMap: {
          [messageId]: operationId,
        },
      });

      const query: SearchQuery = {
        query: 'test query',
      };

      await act(async () => {
        await result.current.triggerSearchAgain(messageId, query);
      });

      // Should update plugin arguments first
      expect(result.current.optimisticUpdatePluginArguments).toHaveBeenCalledWith(
        messageId,
        query,
        false,
        { operationId },
      );

      // Should call invokeBuiltinTool with correct payload
      expect(result.current.invokeBuiltinTool).toHaveBeenCalledWith(messageId, {
        apiName: WebBrowsingApiName.search,
        arguments: JSON.stringify(query),
        id: toolCallId,
        identifier: WebBrowsingManifest.identifier,
        type: 'builtin',
      });
    });

    it('should work without operationId', async () => {
      const messageId = 'test-message-id-2';
      const toolCallId = 'tool_call_456';

      // Mock message with tool_call_id
      const mockMessage: Partial<UIChatMessage> = {
        id: messageId,
        tool_call_id: toolCallId,
        role: 'tool',
        content: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.spyOn(dbMessageSelectors, 'getDbMessageById').mockImplementation(
        () => () => mockMessage as UIChatMessage,
      );

      const { result } = renderHook(() => useChatStore());

      // Ensure no operationId is set for this message
      useChatStore.setState({
        messageOperationMap: {},
      });

      const query: SearchQuery = {
        query: 'test query',
      };

      await act(async () => {
        await result.current.triggerSearchAgain(messageId, query);
      });

      // Should update plugin arguments with undefined context
      expect(result.current.optimisticUpdatePluginArguments).toHaveBeenCalledWith(
        messageId,
        query,
        false,
        undefined,
      );

      // Should still call invokeBuiltinTool
      expect(result.current.invokeBuiltinTool).toHaveBeenCalledWith(messageId, {
        apiName: WebBrowsingApiName.search,
        arguments: JSON.stringify(query),
        id: toolCallId,
        identifier: WebBrowsingManifest.identifier,
        type: 'builtin',
      });
    });

    it('should not proceed if message not found', async () => {
      vi.spyOn(dbMessageSelectors, 'getDbMessageById').mockImplementation(() => () => undefined);

      const { result } = renderHook(() => useChatStore());

      const query: SearchQuery = {
        query: 'test query',
      };

      await act(async () => {
        await result.current.triggerSearchAgain('non-existent-id', query);
      });

      // Should not call any methods if message not found
      expect(result.current.optimisticUpdatePluginArguments).not.toHaveBeenCalled();
      expect(result.current.invokeBuiltinTool).not.toHaveBeenCalled();
    });
  });

  describe('togglePageContent', () => {
    it('should set activePageContentUrl', () => {
      const { result } = renderHook(() => useChatStore());
      const url = 'https://example.com';

      act(() => {
        result.current.togglePageContent(url);
      });

      expect(useChatStore.getState().activePageContentUrl).toBe(url);
    });
  });
});
