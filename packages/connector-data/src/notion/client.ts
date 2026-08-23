import { ConnectorDataError, getConnectorErrorMessage } from '../errors';
import { createRecoverableMemo } from '../memo';
import { withConnectorRetry } from '../retry';
import { parseNotionItems, parseNotionPageMarkdown } from './parser';
import type { NotionConnectorClient } from './types';

const DEFAULT_MAX_RESULTS = 50;
const MAX_QUERY_LENGTH = 500;
const MAX_TOOL_VERSION_LENGTH = 64;
const SAFE_TOOL_VERSION = /^[a-z0-9][\w.-]*$/i;
const FETCH_DATA_TOOL_SLUG = 'NOTION_FETCH_DATA';
const GET_PAGE_MARKDOWN_TOOL_SLUG = 'NOTION_GET_PAGE_MARKDOWN';

/** Minimal Composio tools client needed by the read-only Notion connector. */
export interface NotionComposioTools {
  /** Executes a version-pinned Composio tool for one connected account. */
  execute: (
    toolSlug: string,
    input: {
      arguments: Record<string, unknown>;
      connectedAccountId: string;
      userId: string;
      version: string;
    },
  ) => Promise<unknown>;
  /** Resolves raw tool metadata when no explicit version was injected. */
  getRawComposioToolBySlug?: (toolSlug: string) => Promise<unknown>;
}

/** Minimal Composio client accepted by {@link createNotionConnectorClient}. */
export interface NotionComposioClient {
  tools: NotionComposioTools;
}

/** Options for creating a user-scoped Notion connector client. */
export interface CreateNotionConnectorClientOptions {
  /** Composio SDK client used for version discovery and tool execution. */
  composio: NotionComposioClient;
  /** Connected account authorized for the target Notion workspace. */
  connectedAccountId: string;
  /** Optional pinned toolkit version, primarily useful in deterministic tests. */
  toolVersion?: string;
  /** Composio entity that owns the connected account. */
  userId: string;
}

const readToolVersion = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return;
  if (
    value.length > MAX_TOOL_VERSION_LENGTH ||
    !SAFE_TOOL_VERSION.test(value) ||
    value.toLowerCase() === 'latest'
  ) {
    return;
  }
  return value;
};

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
export const createNotionConnectorClient = ({
  composio,
  connectedAccountId,
  toolVersion,
  userId,
}: CreateNotionConnectorClientOptions): NotionConnectorClient => {
  const toolVersions = new Map<string, () => Promise<string>>();
  const getToolVersion = (toolSlug: string) => {
    const existing = toolVersions.get(toolSlug);
    if (existing) return existing();
    const resolver = createRecoverableMemo(async () => {
      const configured = readToolVersion(toolVersion);
      if (configured) return configured;
      const tool = await composio.tools.getRawComposioToolBySlug?.(toolSlug);
      const discovered =
        typeof tool === 'object' && tool !== null && 'version' in tool
          ? readToolVersion(tool.version)
          : undefined;
      if (discovered) return discovered;
      throw new ConnectorDataError({
        cause: tool,
        code: 'notion_tool_version_unavailable',
        operation: 'resolveToolVersion',
        provider: 'notion',
        retryable: false,
      });
    });
    toolVersions.set(toolSlug, resolver);
    return resolver();
  };

  const execute = async (
    toolSlug: string,
    operation: string,
    arguments_: Record<string, unknown>,
  ) =>
    withConnectorRetry(async () => {
      const response = await composio.tools.execute(toolSlug, {
        arguments: arguments_,
        connectedAccountId,
        userId,
        version: await getToolVersion(toolSlug),
      });
      if (
        typeof response !== 'object' ||
        response === null ||
        !('successful' in response) ||
        response.successful !== true
      ) {
        throw new ConnectorDataError({
          cause: response,
          code: `notion_${operation}_failed`,
          message: getConnectorErrorMessage(response),
          operation,
          provider: 'notion',
          retryable: false,
        });
      }
      return response;
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
