import { ConnectorDataError } from '@lobechat/connector-data';
import type { NotionItem } from '@lobechat/connector-data/notion';
import { describe, expect, it, vi } from 'vitest';

import { notionUnderstandingProvider } from './notion';

const items: NotionItem[] = [
  {
    id: 'page-1',
    kind: 'page',
    lastEditedAt: '2026-08-01T00:00:00.000Z',
    propertyNames: ['Name', 'Status'],
    sourceUrl: 'https://www.notion.so/page-1',
    title: 'Launch plan',
  },
  {
    id: 'database-1',
    kind: 'database',
    propertyNames: ['Project', 'Owner'],
    sourceUrl: 'https://www.notion.so/database-1',
    title: 'Projects',
  },
];

/** @example Notion workspace evidence enriches Understanding without requiring every page fetch. */
describe('notionUnderstandingProvider', () => {
  /** @example Directory metadata and successful page Markdown become one bounded source brief. */
  it('collects workspace structure and recent page content', async () => {
    const result = await notionUnderstandingProvider.collect({
      connectorData: {
        getNotionClient: vi.fn(async () => ({
          getPageMarkdown: vi.fn(async () => '# Launch plan\n- [ ] Ship'),
          listItems: vi.fn(async () => items),
        })),
      } as never,
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      diagnostics: { evidenceCount: 3, failedCount: 0, succeededCount: 2 },
      sourceCount: 3,
    });
    expect(result.context).toContain('Launch plan');
    expect(result.context).toContain('- [ ] Ship');
  });

  /** @example A failed page enrichment remains partial while directory evidence stays usable. */
  it('retains workspace metadata when page content enrichment fails', async () => {
    const result = await notionUnderstandingProvider.collect({
      connectorData: {
        getNotionClient: vi.fn(async () => ({
          getPageMarkdown: vi.fn(async () => {
            throw new ConnectorDataError({
              code: 'notion_page_failed',
              operation: 'getPageMarkdown',
              provider: 'notion',
              retryable: true,
            });
          }),
          listItems: vi.fn(async () => items),
        })),
      } as never,
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      diagnostics: {
        errors: [{ code: 'NOTION_PAGE_CONTENT_FAILED', retryable: true }],
        evidenceCount: 2,
        failedCount: 1,
      },
      sourceCount: 2,
    });
  });
});
