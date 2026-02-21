/**
 * Tests for Lobe Web Browsing Executor
 */
import { WebBrowsingApiName } from '@lobechat/builtin-tool-web-browsing';
import { SEARCH_SEARXNG_NOT_CONFIG } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type BuiltinToolContext } from '../../types';
import { webBrowsing } from '../lobe-web-browsing';

// Mock searchService
const mockSearch = vi.fn();
const mockCrawlPages = vi.fn();

vi.mock('@/services/search', () => ({
  searchService: {
    crawlPages: (...args: any[]) => mockCrawlPages(...args),
    webSearch: (...args: any[]) => mockSearch(...args),
  },
}));

describe('WebBrowsingExecutor', () => {
  const createContext = (overrides?: Partial<BuiltinToolContext>): BuiltinToolContext => ({
    messageId: 'test-message-id',
    operationId: 'test-operation-id',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('identifier', () => {
    it('should have correct identifier', () => {
      expect(webBrowsing.identifier).toBe('lobe-web-browsing');
    });
  });

  describe('hasApi', () => {
    it('should return true for supported APIs', () => {
      expect(webBrowsing.hasApi(WebBrowsingApiName.search)).toBe(true);
      expect(webBrowsing.hasApi(WebBrowsingApiName.crawlSinglePage)).toBe(true);
      expect(webBrowsing.hasApi(WebBrowsingApiName.crawlMultiPages)).toBe(true);
    });

    it('should return false for unsupported APIs', () => {
      expect(webBrowsing.hasApi('unknownApi')).toBe(false);
    });
  });

  describe('getApiNames', () => {
    it('should return all supported API names', () => {
      const apiNames = webBrowsing.getApiNames();
      expect(apiNames).toContain(WebBrowsingApiName.search);
      expect(apiNames).toContain(WebBrowsingApiName.crawlSinglePage);
      expect(apiNames).toContain(WebBrowsingApiName.crawlMultiPages);
    });
  });

  describe('search', () => {
    it('should return search results on success', async () => {
      const mockResults = {
        results: [{ title: 'Test Result', url: 'https://example.com', content: 'Test content' }],
      };
      mockSearch.mockResolvedValue(mockResults);

      const result = await webBrowsing.invoke(
        WebBrowsingApiName.search,
        { query: 'test query' },
        createContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.state).toEqual(mockResults);
    });

    it('should return stop when signal is aborted', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const result = await webBrowsing.invoke(
        WebBrowsingApiName.search,
        { query: 'test query' },
        createContext({ signal: abortController.signal }),
      );

      expect(result.success).toBe(false);
      expect(result.stop).toBe(true);
    });

    it('should handle SearXNG not configured error', async () => {
      mockSearch.mockRejectedValue(new Error(SEARCH_SEARXNG_NOT_CONFIG));

      const result = await webBrowsing.invoke(
        WebBrowsingApiName.search,
        { query: 'test query' },
        createContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('PluginSettingsInvalid');
      expect(result.error?.body?.provider).toBe('searxng');
    });

    it('should handle generic search errors', async () => {
      mockSearch.mockRejectedValue(new Error('Search failed'));

      const result = await webBrowsing.invoke(
        WebBrowsingApiName.search,
        { query: 'test query' },
        createContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('PluginServerError');
      expect(result.error?.message).toBe('Search failed');
    });

    it('should handle runtime error that returns success false', async () => {
      // When runtime catches error, it returns success: false with error message
      mockSearch.mockRejectedValue(new Error('Internal error'));

      const result = await webBrowsing.invoke(
        WebBrowsingApiName.search,
        { query: 'test query' },
        createContext(),
      );

      expect(result.success).toBe(false);
      // Runtime catches and returns error object, executor treats it as generic error
      expect(result.error?.type).toBe('PluginServerError');
    });
  });

  describe('crawlSinglePage', () => {
    it('should call crawlMultiPages with single URL', async () => {
      const mockResponse = {
        results: [
          { data: { title: 'Test Page', content: 'Test content', url: 'https://example.com' } },
        ],
      };
      mockCrawlPages.mockResolvedValue(mockResponse);

      const result = await webBrowsing.invoke(
        WebBrowsingApiName.crawlSinglePage,
        { url: 'https://example.com' },
        createContext(),
      );

      expect(result.success).toBe(true);
      expect(mockCrawlPages).toHaveBeenCalledWith({ urls: ['https://example.com'] });
    });
  });

  describe('crawlMultiPages', () => {
    it('should return crawl results on success', async () => {
      const mockResponse = {
        results: [
          { data: { title: 'Page 1', content: 'Content 1', url: 'https://example1.com' } },
          { data: { title: 'Page 2', content: 'Content 2', url: 'https://example2.com' } },
        ],
        savedDocuments: [],
      };
      mockCrawlPages.mockResolvedValue(mockResponse);

      const result = await webBrowsing.invoke(
        WebBrowsingApiName.crawlMultiPages,
        { urls: ['https://example1.com', 'https://example2.com'] },
        createContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.state).toEqual(mockResponse);
    });

    it('should return stop when signal is aborted', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const result = await webBrowsing.invoke(
        WebBrowsingApiName.crawlMultiPages,
        { urls: ['https://example.com'] },
        createContext({ signal: abortController.signal }),
      );

      expect(result.success).toBe(false);
      expect(result.stop).toBe(true);
    });

    it('should handle crawl errors', async () => {
      mockCrawlPages.mockRejectedValue(new Error('Crawl failed'));

      const result = await webBrowsing.invoke(
        WebBrowsingApiName.crawlMultiPages,
        { urls: ['https://example.com'] },
        createContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('PluginServerError');
      expect(result.error?.message).toBe('Crawl failed');
    });

    it('should handle abort error in catch block via DOMException', async () => {
      // DOMException AbortError goes to catch block
      const abortError = new DOMException('The user aborted a request.', 'AbortError');
      mockCrawlPages.mockRejectedValue(abortError);

      const result = await webBrowsing.invoke(
        WebBrowsingApiName.crawlMultiPages,
        { urls: ['https://example.com'] },
        createContext(),
      );

      expect(result.success).toBe(false);
      expect(result.stop).toBe(true);
    });

    it('should handle abort error via message contains abort text', async () => {
      // Error with abort message goes to catch block
      const abortError = new Error('The user aborted a request.');
      mockCrawlPages.mockRejectedValue(abortError);

      const result = await webBrowsing.invoke(
        WebBrowsingApiName.crawlMultiPages,
        { urls: ['https://example.com'] },
        createContext(),
      );

      expect(result.success).toBe(false);
      expect(result.stop).toBe(true);
    });

    it('should handle error items in crawl results', async () => {
      const mockResponse = {
        results: [
          { data: { title: 'Page 1', content: 'Content 1', url: 'https://example1.com' } },
          { errorMessage: 'Failed to crawl' },
        ],
      };
      mockCrawlPages.mockResolvedValue(mockResponse);

      const result = await webBrowsing.invoke(
        WebBrowsingApiName.crawlMultiPages,
        { urls: ['https://example1.com', 'https://invalid.com'] },
        createContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
    });
  });

  describe('invoke', () => {
    it('should return error for unknown API', async () => {
      const result = await webBrowsing.invoke('unknownApi', {}, createContext());

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('ApiNotFound');
      expect(result.error?.message).toBe('Unknown API: unknownApi');
    });
  });
});
