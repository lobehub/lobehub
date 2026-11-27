import { EMPTY_SEARCH_RESULTS_PROMPT } from '@lobechat/prompts';
import { describe, expect, it, vi } from 'vitest';

import { WebBrowsingExecutionRuntime } from './index';

describe('WebBrowsingExecutionRuntime', () => {
  describe('search', () => {
    it('should return success with search results', async () => {
      const mockSearchService = {
        crawlPages: vi.fn(),
        webSearch: vi.fn().mockResolvedValue({
          costTime: 100,
          query: 'test',
          resultNumbers: 1,
          results: [
            {
              content: 'Test content',
              engines: ['google'],
              parsedUrl: 'example.com',
              score: 1,
              title: 'Test',
              url: 'https://example.com',
            },
          ],
        }),
      };

      const runtime = new WebBrowsingExecutionRuntime({ searchService: mockSearchService });
      const result = await runtime.search({ query: 'test' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('searchResults');
      expect(result.content).toContain('Test');
    });

    it('should return success: false when response has errorDetail', async () => {
      const mockSearchService = {
        crawlPages: vi.fn(),
        webSearch: vi.fn().mockResolvedValue({
          costTime: 0,
          errorDetail: 'Failed to search: 500 Internal Server Error',
          query: 'test',
          resultNumbers: 0,
          results: [],
        }),
      };

      const runtime = new WebBrowsingExecutionRuntime({ searchService: mockSearchService });
      const result = await runtime.search({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.content).toBe('Failed to search: 500 Internal Server Error');
      expect(result.error).toEqual({ message: 'Failed to search: 500 Internal Server Error' });
    });

    it('should return success: true with empty results when no errorDetail', async () => {
      const mockSearchService = {
        crawlPages: vi.fn(),
        webSearch: vi.fn().mockResolvedValue({
          costTime: 50,
          query: 'test',
          resultNumbers: 0,
          results: [],
        }),
      };

      const runtime = new WebBrowsingExecutionRuntime({ searchService: mockSearchService });
      const result = await runtime.search({ query: 'test' });

      expect(result.success).toBe(true);
      expect(result.content).toBe(EMPTY_SEARCH_RESULTS_PROMPT);
      expect(result.content).toContain('do not resend the same query');
    });

    it('should return success: false when webSearch throws', async () => {
      const mockSearchService = {
        crawlPages: vi.fn(),
        webSearch: vi.fn().mockRejectedValue(new Error('Network error')),
      };

      const runtime = new WebBrowsingExecutionRuntime({ searchService: mockSearchService });
      const result = await runtime.search({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.content).toBe('Network error');
    });
  });

  describe('crawlMultiPages', () => {
    it('should keep the failing url and guidance visible for error items', async () => {
      const mockSearchService = {
        crawlPages: vi.fn().mockResolvedValue({
          results: [
            {
              crawler: 'naive',
              data: {
                content: 'x'.repeat(20),
                contentType: 'text',
                title: 'OK page',
                url: 'https://ok.example.com/',
              },
              originalUrl: 'https://ok.example.com/',
            },
            {
              crawler: 'search1api',
              data: {
                content:
                  'Dead link: the server confirmed this page does not exist (HTTP 404). Do not retry this URL.',
                errorMessage: 'Not Found',
                errorType: 'PageNotFoundError',
                retryable: false,
              },
              originalUrl: 'https://raw.githubusercontent.com/foo/bar/main/env.release',
            },
          ],
        }),
        webSearch: vi.fn(),
      };

      const runtime = new WebBrowsingExecutionRuntime({ searchService: mockSearchService });
      const result = await runtime.crawlMultiPages({
        urls: [
          'https://ok.example.com/',
          'https://raw.githubusercontent.com/foo/bar/main/env.release',
        ],
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('<page url="https://ok.example.com/" title="OK page"');
      expect(result.content).toContain(
        '<error errorType="PageNotFoundError" errorMessage="Not Found" url="https://raw.githubusercontent.com/foo/bar/main/env.release">Dead link: the server confirmed this page does not exist (HTTP 404). Do not retry this URL.</error>',
      );
    });
  });

  describe('crawlMultiPages', () => {
    const longPage = Array.from({ length: 5000 }, (_, i) => `paragraph ${i + 1}`).join('\n');
    const createSearchService = () => ({
      crawlPages: vi.fn().mockResolvedValue({
        results: [
          {
            data: { content: longPage, title: 'Long', url: 'https://example.com/long' },
            originalUrl: 'https://example.com/long',
          },
        ],
      }),
      webSearch: vi.fn(),
    });

    it('pages a long crawled page through its saved agent document', async () => {
      const runtime = new WebBrowsingExecutionRuntime({
        canReadSavedDocuments: true,
        documentService: {
          associateDocument: vi.fn().mockResolvedValue({ id: 'agent-doc-1' }),
          createDocument: vi.fn().mockResolvedValue({ id: 'docs-1' }),
        },
        searchService: createSearchService() as any,
      });

      const result = await runtime.crawlMultiPages({ urls: ['https://example.com/long'] });

      expect(result.content).not.toContain('paragraph 5000');
      expect(result.content).toMatch(
        /\[Showing lines 1-\d+ of 5000 lines, \d+ characters\. To continue, call lobe-agent-documents readDocument with id="agent-doc-1", format="markdown" and offset=\d+\.\]/,
      );
    });

    // T-14186: the saved document stores a normalized Markdown snapshot (blank-line runs and
    // loose lists collapse), so offsets counted on the raw page pointed past its end.
    it('windows the stored document text so the continuation offset lands in it', async () => {
      const rawPage = Array.from({ length: 3000 }, (_, i) => `paragraph ${i + 1}\n\n\n`).join('');
      const storedPage = Array.from({ length: 3000 }, (_, i) => `paragraph ${i + 1}`).join('\n\n');
      const runtime = new WebBrowsingExecutionRuntime({
        canReadSavedDocuments: true,
        documentService: {
          associateDocument: vi.fn().mockResolvedValue({ id: 'agent-doc-1' }),
          createDocument: vi.fn().mockResolvedValue({ content: storedPage, id: 'docs-1' }),
        },
        searchService: {
          crawlPages: vi.fn().mockResolvedValue({
            results: [
              {
                data: { content: rawPage, title: 'Paper', url: 'https://example.com/paper' },
                originalUrl: 'https://example.com/paper',
              },
            ],
          }),
          webSearch: vi.fn(),
        } as any,
      });

      const result = await runtime.crawlMultiPages({ urls: ['https://example.com/paper'] });

      const notice = result.content.match(
        /\[Showing lines 1-(\d+) of (\d+) lines, (\d+) characters\. To continue, call lobe-agent-documents readDocument with id="agent-doc-1", format="markdown" and offset=(\d+)\.\]/,
      );
      expect(notice).not.toBeNull();
      const [, endLine, totalLines, totalChars, offset] = notice!.map(Number);
      const storedLines = storedPage.split('\n');
      expect(totalLines).toBe(storedLines.length);
      expect(totalChars).toBe(storedPage.length);
      expect(offset).toBe(endLine + 1);
      expect(result.content).toContain(storedLines.slice(0, endLine).join('\n'));
    });

    it('keeps each page on its own saved document when saves finish out of order', async () => {
      const page = (name: string) =>
        Array.from({ length: 2000 }, (_, i) => `${name} line ${i + 1}`).join('\n');
      const pages = { fowler: page('fowler'), paper: page('paper') };
      const createDocument = vi.fn(async ({ content, url }: { content: string; url: string }) => {
        // The first page's save resolves last, as when two crawls archive concurrently.
        if (url.endsWith('/paper')) await new Promise((resolve) => setTimeout(resolve, 20));
        return { content, id: `docs-${url.split('/').pop()}` };
      });
      const runtime = new WebBrowsingExecutionRuntime({
        canReadSavedDocuments: true,
        documentService: {
          associateDocument: vi.fn(async (documentId: string) => ({
            id: `agent-${documentId}`,
          })),
          createDocument,
        },
        searchService: {
          crawlPages: vi.fn().mockResolvedValue({
            results: Object.entries(pages)
              .reverse()
              .map(([name, content]) => ({
                data: { content, title: name, url: `https://example.com/${name}` },
                originalUrl: `https://example.com/${name}`,
              })),
          }),
          webSearch: vi.fn(),
        } as any,
      });

      const result = await runtime.crawlMultiPages({
        urls: ['https://example.com/paper', 'https://example.com/fowler'],
      });

      for (const name of Object.keys(pages)) {
        const section = result.content.match(
          new RegExp(`<page url="https://example.com/${name}"[\\s\\S]*?</page>`),
        )?.[0];
        expect(section).toContain(`${name} line 1\n`);
        expect(section).toContain(`readDocument with id="agent-docs-${name}"`);
        expect(section).not.toMatch(name === 'paper' ? /fowler/ : /paper/);
      }
    });

    it('does not name readDocument when the run cannot call it', async () => {
      // Chat mode, or a custom tool set with browsing alone, has no lobe-agent-documents.
      const createDocument = vi.fn().mockResolvedValue({ id: 'docs-1' });
      const runtime = new WebBrowsingExecutionRuntime({
        documentService: {
          associateDocument: vi.fn().mockResolvedValue({ id: 'agent-doc-1' }),
          createDocument,
        },
        searchService: createSearchService() as any,
      });

      const result = await runtime.crawlMultiPages({ urls: ['https://example.com/long'] });

      expect(createDocument).toHaveBeenCalled();
      expect(result.content).toMatch(/Lines \d+-5000 were left out\./);
      expect(result.content).not.toContain('readDocument');
    });

    it('reports what was left out when the page was not saved', async () => {
      const runtime = new WebBrowsingExecutionRuntime({
        searchService: createSearchService() as any,
      });

      const result = await runtime.crawlMultiPages({ urls: ['https://example.com/long'] });

      expect(result.content).toMatch(/Lines \d+-5000 were left out\./);
    });

    it('returns an oversized crawl result without saving it as a document', async () => {
      // A 13 MB JS bundle served from a CDN was snapshotted into a document on the
      // main thread and kept the event loop busy until the liveness probe killed the pod.
      const hugeBody = 'const a = 1;\n'.repeat(100_000);
      const createDocument = vi.fn().mockResolvedValue({ id: 'docs-1' });
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const runtime = new WebBrowsingExecutionRuntime({
        canReadSavedDocuments: true,
        documentService: {
          associateDocument: vi.fn().mockResolvedValue({ id: 'agent-doc-1' }),
          createDocument,
        },
        searchService: {
          crawlPages: vi.fn().mockResolvedValue({
            results: [
              {
                data: { content: hugeBody, title: 'Bundle', url: 'https://example.com/index.js' },
                originalUrl: 'https://example.com/index.js',
              },
            ],
          }),
          webSearch: vi.fn(),
        } as any,
      });

      try {
        const result = await runtime.crawlMultiPages({ urls: ['https://example.com/index.js'] });

        expect(createDocument).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
        expect(result.content).toContain('const a = 1;');
        expect(result.content).toMatch(/Lines \d+-\d+ were left out\./);
        expect(result.content).not.toContain('readDocument');
      } finally {
        consoleWarn.mockRestore();
      }
    });

    it('logs a save failure by its driver cause instead of the query parameters', async () => {
      // Drizzle's "Failed query" wrapper embeds every bound parameter, here the whole
      // page and its editor JSON; logging it whole wrote about 30 MB to stderr per failure.
      const queryError = new Error(
        `Failed query: insert into "documents" ...\nparams: ${'page body '.repeat(10_000)}`,
        {
          cause: Object.assign(new Error('unsupported Unicode escape sequence'), { code: '22P05' }),
        },
      );
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const runtime = new WebBrowsingExecutionRuntime({
        documentService: {
          associateDocument: vi.fn(),
          createDocument: vi.fn().mockRejectedValue(queryError),
        },
        searchService: createSearchService() as any,
      });

      try {
        const result = await runtime.crawlMultiPages({ urls: ['https://example.com/long'] });

        expect(result.success).toBe(true);
        expect(consoleError).toHaveBeenCalledTimes(1);
        const logged = consoleError.mock.calls[0].map(String).join(' ');
        expect(logged).toContain('22P05 unsupported Unicode escape sequence');
        expect(logged).toContain('https://example.com/long');
        expect(logged).not.toContain('page body');
      } finally {
        consoleError.mockRestore();
      }
    });

    it('appends browser escalation guidance once for multiple retryable failures without mutating state', async () => {
      const response = {
        results: [
          {
            crawler: 'browserless',
            data: {
              content: 'Fail to crawl the page. Error type: TimeoutError, error message: timed out',
              errorMessage: 'timed out',
              errorType: 'TimeoutError',
            },
            originalUrl: 'https://blocked1.example.com',
          },
          {
            crawler: 'browserless',
            data: {
              content: 'Fail to crawl the page. Error type: CrawlError, error message: 403',
              errorMessage: '403',
              errorType: 'CrawlError',
            },
            originalUrl: 'https://blocked2.example.com',
          },
        ],
      };
      const runtime = new WebBrowsingExecutionRuntime({
        canUseBrowserSkill: true,
        searchService: { crawlPages: vi.fn().mockResolvedValue(response), webSearch: vi.fn() },
      });

      const result = await runtime.crawlMultiPages({
        urls: ['https://blocked1.example.com', 'https://blocked2.example.com'],
      });

      expect(result.content.match(/<guidance>/g)).toHaveLength(1);
      expect(result.content).toContain('activate the `agent-browser` skill');
      // Portal UI reads raw `state.results[i].data.content` and must never see model guidance.
      expect(response.results[0].data.content).not.toContain('agent-browser');
      expect(response.results[1].data.content).not.toContain('agent-browser');
    });

    it('appends browser escalation guidance for a page blocked by anti-bot verification and saves nothing', async () => {
      const documentService = { associateDocument: vi.fn(), createDocument: vi.fn() };
      const runtime = new WebBrowsingExecutionRuntime({
        canUseBrowserSkill: true,
        documentService,
        searchService: {
          crawlPages: vi.fn().mockResolvedValue({
            results: [
              {
                crawler: 'jina',
                data: {
                  content:
                    'Blocked by anti-bot verification: the site answered with a challenge page instead of its content, so nothing was read. Crawling this URL again will meet the same wall.',
                  errorMessage: 'The site served an anti-bot verification page',
                  errorType: 'BlockedPageError',
                  retryable: false,
                },
                originalUrl: 'https://blocked.example.com',
              },
            ],
          }),
          webSearch: vi.fn(),
        },
      });

      const result = await runtime.crawlMultiPages({ urls: ['https://blocked.example.com'] });

      expect(result.content).toContain('Blocked by anti-bot verification');
      expect(result.content).toContain('activate the `agent-browser` skill');
      expect(documentService.createDocument).not.toHaveBeenCalled();
    });

    it('omits agent-browser guidance when canUseBrowserSkill is false', async () => {
      const runtime = new WebBrowsingExecutionRuntime({
        canUseBrowserSkill: false,
        searchService: {
          crawlPages: vi.fn().mockResolvedValue({
            results: [
              {
                crawler: 'browserless',
                data: {
                  content:
                    'Fail to crawl the page. Error type: TimeoutError, error message: timeout',
                  errorMessage: 'timeout',
                  errorType: 'TimeoutError',
                },
                originalUrl: 'https://blocked.example.com',
              },
            ],
          }),
          webSearch: vi.fn(),
        },
      });

      const result = await runtime.crawlMultiPages({ urls: ['https://blocked.example.com'] });

      expect(result.content).toContain('<guidance>');
      expect(result.content).not.toContain('agent-browser');
      expect(result.content).toContain('no browser fallback is available');
    });

    it('does not append escalation guidance for non-retryable 404 or non-existent domain DNS errors', async () => {
      const runtime = new WebBrowsingExecutionRuntime({
        canUseBrowserSkill: true,
        searchService: {
          crawlPages: vi.fn().mockResolvedValue({
            results: [
              {
                crawler: 'naive',
                data: {
                  content: 'Dead link (HTTP 404)',
                  errorMessage: 'Not Found',
                  errorType: 'PageNotFoundError',
                  retryable: false,
                },
                originalUrl: 'https://example.com/missing',
              },
              {
                crawler: 'naive',
                data: {
                  content:
                    'Fail to crawl the page. Error type: NetworkConnectionError, error message: getaddrinfo ENOTFOUND nope.invalid',
                  errorMessage: 'getaddrinfo ENOTFOUND nope.invalid',
                  errorType: 'NetworkConnectionError',
                },
                originalUrl: 'https://nope.invalid/',
              },
              {
                crawler: 'search1api',
                data: {
                  content:
                    'Fail to crawl the page. Error type: HTTPStatusError, error message: Failed to crawl URL: Domain does not exist: www.nope.invalid (DNS NXDOMAIN)',
                  errorMessage:
                    'Failed to crawl URL: Domain does not exist: www.nope.invalid (DNS NXDOMAIN)',
                  errorType: 'HTTPStatusError',
                },
                originalUrl: 'https://www.nope.invalid/',
              },
            ],
          }),
          webSearch: vi.fn(),
        },
      });

      const result = await runtime.crawlMultiPages({
        urls: ['https://example.com/missing', 'https://nope.invalid/'],
      });

      expect(result.content).not.toContain('<guidance>');
      expect(result.content).not.toContain('agent-browser');
    });
  });
});
