import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import type { WebBrowsingExecutionRuntime } from '@lobechat/builtin-tool-web-browsing/executionRuntime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

const mockAssociateDocument = vi.fn();
const mockUpsertCrawledDocument = vi.fn();

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn().mockImplementation(() => ({
    associateDocument: (...args: any[]) => mockAssociateDocument(...args),
  })),
}));

vi.mock('@/server/services/webBrowsing', () => ({
  WebBrowsingDocumentService: vi.fn().mockImplementation(() => ({
    upsertCrawledDocument: (...args: any[]) => mockUpsertCrawledDocument(...args),
  })),
}));

vi.mock('@/server/services/search', () => ({
  SearchService: vi.fn().mockImplementation(() => ({
    crawlPages: vi.fn().mockResolvedValue({
      results: [
        {
          data: {
            content: 'crawled page content',
            description: 'a crawled page',
            title: 'Crawled Page',
            url: 'https://example.com',
          },
        },
      ],
    }),
    webSearch: vi.fn(),
  })),
}));

const { webBrowsingRuntime } = await import('../webBrowsing');

describe('webBrowsingRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertCrawledDocument.mockResolvedValue({ id: 'doc-1' });
  });

  it('should have the correct identifier', () => {
    expect(webBrowsingRuntime.identifier).toBe(WebBrowsingManifest.identifier);
    expect(webBrowsingRuntime.identifier).toBe('lobe-web-browsing');
  });

  const buildContext = (agentShare?: ToolExecutionContext['agentShare']): ToolExecutionContext => ({
    agentId: 'agent-1',
    agentShare,
    serverDB: {} as any,
    toolManifestMap: {},
    userId: 'creator-1',
    workspaceId: 'workspace-1',
  });

  it('persists crawled pages as agent documents for an ordinary (non-share) run', async () => {
    const runtime = webBrowsingRuntime.factory(buildContext()) as WebBrowsingExecutionRuntime;

    await runtime.crawlSinglePage({ url: 'https://example.com' });

    expect(mockUpsertCrawledDocument).toHaveBeenCalledTimes(1);
    expect(mockAssociateDocument).toHaveBeenCalledWith('agent-1', 'doc-1');
  });

  it("does NOT persist crawled pages for a share visitor run — the creator's own credentials execute the run, and v1 share grants have no write grant to authorize it", async () => {
    const runtime = webBrowsingRuntime.factory(
      buildContext({ agentId: 'agent-1', shareId: 'share-1', visitorUserId: 'visitor-1' }),
    ) as WebBrowsingExecutionRuntime;

    const result = await runtime.crawlSinglePage({ url: 'https://example.com' });

    expect(mockUpsertCrawledDocument).not.toHaveBeenCalled();
    expect(mockAssociateDocument).not.toHaveBeenCalled();
    // The visitor still gets the crawled content inline — only the durable
    // persistence into the creator's Pages library is disabled.
    expect(result.success).toBe(true);
    expect(result.content).toContain('crawled page content');
  });
});
