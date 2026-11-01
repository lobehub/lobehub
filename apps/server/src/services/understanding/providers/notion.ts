import { getConnectorErrorMessage, isConnectorErrorRetryable } from '@lobechat/connector-data';
import type { NotionItem, NotionItemContent } from '@lobechat/connector-data/notion';

import type { UnderstandingProvider } from '../types';

const MAX_CONTENT_PAGES = 8;
const MAX_CONTENT_PER_PAGE = 6000;
const MAX_WORKSPACE_ITEMS = 40;

const editTime = ({ lastEditedAt }: NotionItem): number => {
  if (!lastEditedAt) return 0;
  const milliseconds = new Date(lastEditedAt).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : 0;
};

const serializeContext = (items: NotionItemContent[]): string =>
  JSON.stringify(
    {
      items: items.map(({ item, markdown }) => ({
        ...item,
        ...(markdown ? { markdown: markdown.slice(0, MAX_CONTENT_PER_PAGE) } : {}),
      })),
      provider: 'notion',
    },
    null,
    2,
  );

/**
 * Collects workspace structure and recent page content for onboarding Understanding.
 *
 * Use when:
 * - A connected Notion workspace participates in the onboarding Understanding session
 *
 * Expects:
 * - Connector Data has resolved a read-only Notion account for the current user
 *
 * Returns:
 * - A bounded source brief that remains usable when individual page reads fail
 */
export const notionUnderstandingProvider: UnderstandingProvider = {
  connectionSource: 'composio',
  id: 'notion',
  collect: async ({ connectorData }) => {
    const client = await connectorData.getNotionClient();
    const items = await client.listItems({ maxResults: MAX_WORKSPACE_ITEMS });
    if (items.length === 0) {
      return {
        context: '',
        diagnostics: { errors: [], evidenceCount: 0, failedCount: 0, succeededCount: 1 },
        sourceCount: 0,
      };
    }

    const contentCandidates = items
      .filter(({ kind }) => kind === 'page')
      .toSorted(
        (left, right) => editTime(right) - editTime(left) || left.id.localeCompare(right.id),
      )
      .slice(0, MAX_CONTENT_PAGES);
    const settledContent = await Promise.allSettled(
      contentCandidates.map(({ id }) => client.getPageMarkdown(id)),
    );
    const contentById = new Map<string, string>();
    const errors = settledContent.flatMap((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value) contentById.set(contentCandidates[index].id, result.value);
        return [];
      }
      return [
        {
          code: 'NOTION_PAGE_CONTENT_FAILED',
          message:
            getConnectorErrorMessage(result.reason) ?? 'Notion page content enrichment failed',
          operation: 'page_content',
          provider: 'notion',
          retryable: isConnectorErrorRetryable(result.reason),
        },
      ];
    });
    const enrichedItems = items.map((item) => ({ item, markdown: contentById.get(item.id) }));
    const contentCount = contentById.size;
    const sourceCount = items.length + contentCount;

    return {
      context: [
        'Provider: notion',
        '# Source Brief',
        'Notion evidence policy:',
        '- Page and database titles describe accessible workspace structure, not necessarily the user’s ownership or authorship.',
        '- Unchecked boxes, TODO markers, and planning notes are evidence of candidate work, not proof of commitment or urgency.',
        '- Preserve page-level uncertainty and do not infer private organizational roles from a single document.',
        serializeContext(enrichedItems),
      ].join('\n\n'),
      diagnostics: {
        errors,
        evidenceCount: sourceCount,
        failedCount: errors.length,
        succeededCount: 1 + settledContent.filter(({ status }) => status === 'fulfilled').length,
      },
      sourceCount,
    };
  },
};
