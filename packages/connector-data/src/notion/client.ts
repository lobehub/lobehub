import {
  type ComposioClient,
  type ComposioConnectorOptions,
  type ComposioTools,
  createComposioToolRunner,
} from '../composio';
import { ConnectorDataError, getConnectorErrorMessage } from '../errors';
import { parseNotionItems, parseNotionPageMarkdown } from './parser';
import type { NotionConnectorClient } from './types';

const DEFAULT_MAX_RESULTS = 50;
const MAX_QUERY_LENGTH = 500;
const FETCH_DATA_TOOL_SLUG = 'NOTION_FETCH_DATA';
const GET_PAGE_MARKDOWN_TOOL_SLUG = 'NOTION_GET_PAGE_MARKDOWN';

/** Minimal Composio tools client needed by the read-only Notion connector. */
export type NotionComposioTools = ComposioTools;

/** Minimal Composio client accepted by {@link createNotionConnectorClient}. */
export type NotionComposioClient = ComposioClient;

/** Options for creating a user-scoped Notion connector client. */
export type CreateNotionConnectorClientOptions = ComposioConnectorOptions;

/**
 * Creates a bounded, read-only Notion client over Composio tools.
 *
 * Use when:
 * - Understanding needs workspace structure and selected page content
 * - Task recommendation needs trusted Notion page evidence
 *
 * Expects:
 * - An ACTIVE connected account owned by `userId`
 * - Composio tool metadata exposes explicit versions when `toolVersion` is omitted
 *
 * Returns:
 * - A client that normalizes SDK response variants and retains provider failure messages
 */
export const createNotionConnectorClient = (
  options: CreateNotionConnectorClientOptions,
): NotionConnectorClient => {
  const run = createComposioToolRunner('notion', options);
  // The parsers read the tool result in its Composio envelope (`{ data }`), as before.
  const execute = async (
    toolSlug: string,
    operation: string,
    arguments_: Record<string, unknown>,
  ) => ({
    data: await run(toolSlug, operation, arguments_),
  });

  return {
    getPageMarkdown: async (pageId) => {
      const response = await execute(GET_PAGE_MARKDOWN_TOOL_SLUG, 'getPageMarkdown', {
        page_id: pageId.slice(0, 128),
      });
      return parseNotionPageMarkdown(response);
    },
    listItems: async ({ maxResults = DEFAULT_MAX_RESULTS, query } = {}) => {
      const finiteMaxResults = Number.isFinite(maxResults) ? maxResults : DEFAULT_MAX_RESULTS;
      const boundedMaxResults = Math.min(
        Math.max(1, Math.floor(finiteMaxResults)),
        DEFAULT_MAX_RESULTS,
      );
      const normalizedQuery = query?.trim().slice(0, MAX_QUERY_LENGTH);
      const response = await execute(FETCH_DATA_TOOL_SLUG, 'listItems', {
        get_all: true,
        get_databases: true,
        get_pages: true,
        page_size: boundedMaxResults,
        ...(normalizedQuery ? { query: normalizedQuery } : {}),
      });
      const items = parseNotionItems(response, boundedMaxResults);
      if (!items) {
        throw new ConnectorDataError({
          cause: response,
          code: 'notion_response_invalid',
          message: getConnectorErrorMessage(response),
          operation: 'listItems',
          provider: 'notion',
          retryable: false,
        });
      }
      return items;
    },
  };
};
