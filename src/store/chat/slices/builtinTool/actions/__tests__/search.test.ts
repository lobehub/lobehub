import { crawlResultsPrompt, searchResultsPrompt } from '@lobechat/prompts';
import { SearchContent, SearchQuery, UniformSearchResponse } from '@lobechat/types';
import { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { searchService } from '@/services/search';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { CRAWL_CONTENT_LIMITED_COUNT } from '@/tools/web-browsing/const';

// Mock services
vi.mock('@/services/search', () => ({
  searchService: {
    webSearch: vi.fn(),
    crawlPages: vi.fn(),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    getMessageById: vi.fn(),
  },
}));

describe('search actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: 'topic-id',
      searchLoading: {},
      internal_updateMessageContent: vi.fn(),
      internal_updateMessagePluginError: vi.fn(),
      updatePluginArguments: vi.fn(),
      updatePluginState: vi.fn(),
      internal_createMessage: vi.fn(),
      internal_addToolToAssistantMessage: vi.fn(),
      openToolUI: vi.fn(),
    });
  });

  describe('search', () => {
    it('should handle successful search', async () => {
      const mockResponse: UniformSearchResponse = {
        results: [
          {
            title: 'Test Result',
            content: 'Test Content',
            url: 'https://test.com',
            category: 'general',
            engines: ['google'],
            parsedUrl: 'test.com',
            score: 1,
          },
        ],
        costTime: 1,
        resultNumbers: 1,
        query: 'test',
      };

      (searchService.webSearch as Mock).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useChatStore());
      const { search } = result.current;

      const messageId = 'test-message-id';
      const query: SearchQuery = {
        searchEngines: ['google'],
        query: 'test query',
      };

      await act(async () => {
        await search(messageId, query);
      });

      const expectedContent: SearchContent[] = [
        {
          title: 'Test Result',
          url: 'https://test.com',
          content: 'Test Content',
        },
      ];

      expect(searchService.webSearch).toHaveBeenCalledWith({
        searchEngines: ['google'],
        query: 'test query',
      });
      expect(result.current.searchLoading[messageId]).toBe(false);
      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        searchResultsPrompt(expectedContent),
      );
    });

    it('should handle empty search results', async () => {
      const emptyResponse: UniformSearchResponse = {
        results: [],
        costTime: 1,
        resultNumbers: 0,
        query: 'test',
      };

      (searchService.webSearch as Mock).mockResolvedValue(emptyResponse);

      const { result } = renderHook(() => useChatStore());
      const { search } = result.current;

      const messageId = 'test-message-id';
      const query: SearchQuery = {
        searchEngines: ['custom-engine'],
        searchTimeRange: 'year',
        query: 'test query',
      };

      await act(async () => {
        await search(messageId, query);
      });

      expect(searchService.webSearch).toHaveBeenCalledWith({
        searchEngines: ['custom-engine'],
        searchTimeRange: 'year',
        query: 'test query',
      });
      expect(result.current.searchLoading[messageId]).toBe(false);
      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        searchResultsPrompt([]),
      );
    });

    it('should handle search error', async () => {
      const error = new Error('Search failed');
      (searchService.webSearch as Mock).mockRejectedValue(error);

      const { result } = renderHook(() => useChatStore());
      const { search } = result.current;

      const messageId = 'test-message-id';
      const query: SearchQuery = {
        query: 'test query',
      };

      await act(async () => {
        await search(messageId, query);
      });

      expect(result.current.internal_updateMessagePluginError).toHaveBeenCalledWith(messageId, {
        body: error,
        message: 'Search failed',
        type: 'PluginServerError',
      });
      expect(result.current.searchLoading[messageId]).toBe(false);
      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        'Search failed',
      );
    });
  });

  describe('crawlMultiPages', () => {
    it('should truncate content that exceeds limit', async () => {
      const longContent = 'a'.repeat(CRAWL_CONTENT_LIMITED_COUNT + 1000);
      const mockResponse = {
        results: [
          {
            data: {
              content: longContent,
              title: 'Test Page',
            },
            crawler: 'naive',
            originalUrl: 'https://test.com',
          },
        ],
      };

      (searchService.crawlPages as Mock).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useChatStore());
      const messageId = 'test-message-id';

      await act(async () => {
        await result.current.crawlMultiPages(messageId, { urls: ['https://test.com'] });
      });

      const expectedContent = [
        {
          content: longContent.slice(0, CRAWL_CONTENT_LIMITED_COUNT),
          title: 'Test Page',
        },
      ];

      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        crawlResultsPrompt(expectedContent as any),
      );
    });

    it('should handle crawl errors', async () => {
      const mockResponse = {
        results: [
          {
            errorMessage: 'Failed to crawl',
            errorType: 'CRAWL_ERROR',
            originalUrl: 'https://test.com',
          },
        ],
      };

      (searchService.crawlPages as Mock).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useChatStore());
      const messageId = 'test-message-id';

      await act(async () => {
        await result.current.crawlMultiPages(messageId, { urls: ['https://test.com'] });
      });

      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        crawlResultsPrompt(mockResponse.results),
      );
    });
  });

  describe('reSearchWithSearXNG', () => {
    it('should update arguments and perform search', async () => {
      const { result } = renderHook(() => useChatStore());
      const spy = vi.spyOn(result.current, 'search');
      const { triggerSearchAgain } = result.current;

      const messageId = 'test-message-id';
      const query: SearchQuery = {
        query: 'test query',
      };

      await act(async () => {
        await triggerSearchAgain(messageId, query, { aiSummary: true });
      });

      expect(result.current.updatePluginArguments).toHaveBeenCalledWith(messageId, query);
      expect(spy).toHaveBeenCalledWith(messageId, query, true);
    });
  });

  describe('saveSearXNGSearchResult', () => {
    it('should save search result as tool message', async () => {
      const messageId = 'test-message-id';
      const parentId = 'parent-message-id';
      const mockMessage: Partial<UIChatMessage> = {
        id: messageId,
        parentId,
        content: 'test content',
        plugin: {
          identifier: 'search',
          arguments: '{}',
          apiName: 'search',
          type: 'default',
        },
        pluginState: {},
        role: 'assistant',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        meta: {},
      };

      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        () => () => mockMessage as UIChatMessage,
      );

      const { result } = renderHook(() => useChatStore());
      const { saveSearchResult } = result.current;

      await act(async () => {
        await saveSearchResult(messageId);
      });

      expect(result.current.internal_createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'test content',
          parentId,
          plugin: mockMessage.plugin,
          pluginState: mockMessage.pluginState,
          role: 'tool',
        }),
      );

      expect(result.current.internal_addToolToAssistantMessage).toHaveBeenCalledWith(
        parentId,
        expect.objectContaining({
          identifier: 'search',
          type: 'default',
        }),
      );
    });

    it('should not save if message not found', async () => {
      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(() => () => undefined);

      const { result } = renderHook(() => useChatStore());
      const { saveSearchResult } = result.current;

      await act(async () => {
        await saveSearchResult('non-existent-id');
      });

      expect(result.current.internal_createMessage).not.toHaveBeenCalled();
      expect(result.current.internal_addToolToAssistantMessage).not.toHaveBeenCalled();
    });
  });

  describe('toggleSearchLoading', () => {
    it('should toggle search loading state', () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'test-message-id';

      act(() => {
        result.current.toggleSearchLoading(messageId, true);
      });

      expect(result.current.searchLoading[messageId]).toBe(true);

      act(() => {
        result.current.toggleSearchLoading(messageId, false);
      });

      expect(result.current.searchLoading[messageId]).toBe(false);
    });
  });
});
