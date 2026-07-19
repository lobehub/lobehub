import { ConnectorDataError } from '../errors';
import { createRecoverableMemo } from '../memo';
import { withConnectorRetry } from '../retry';
import type { GmailComposioConnectedAccounts } from './account';
import { loadGmailAccount } from './account';
import { parseGmailMessages } from './message';
import type { GmailAccount, GmailMessage } from './types';

const DEFAULT_MAX_RESULTS = 25;
const MAX_QUERY_LENGTH = 2048;
const MAX_TOOL_VERSION_LENGTH = 64;
const SAFE_TOOL_VERSION = /^[a-z0-9][\w.-]*$/i;
const SEARCH_TOOL_SLUG = 'GMAIL_FETCH_EMAILS';

const readToolVersion = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  if (
    value.length > MAX_TOOL_VERSION_LENGTH ||
    !SAFE_TOOL_VERSION.test(value) ||
    value.toLowerCase() === 'latest'
  ) {
    return undefined;
  }
  return value;
};

export interface GmailComposioTools {
  execute: (
    toolSlug: string,
    input: {
      arguments: { max_results: number; query: string };
      connectedAccountId: string;
      userId: string;
      version: string;
    },
  ) => Promise<unknown>;
  getRawComposioToolBySlug?: (toolSlug: string) => Promise<unknown>;
}

export interface GmailComposioClient {
  connectedAccounts: GmailComposioConnectedAccounts;
  tools: GmailComposioTools;
}

export interface GmailSearchMessagesInput {
  maxResults?: number;
  query: string;
}

export interface GmailConnectorClient {
  getAccount: () => Promise<GmailAccount>;
  searchMessages: (input: GmailSearchMessagesInput) => Promise<GmailMessage[]>;
}

export interface CreateGmailConnectorClientOptions {
  composio: GmailComposioClient;
  connectedAccountId: string;
  toolVersion?: string;
  userId: string;
}

export const createGmailConnectorClient = ({
  composio,
  connectedAccountId,
  toolVersion,
  userId,
}: CreateGmailConnectorClientOptions): GmailConnectorClient => {
  const getToolVersion = createRecoverableMemo(async () => {
    const configured = readToolVersion(toolVersion);
    if (configured) return configured;
    const tool = await composio.tools.getRawComposioToolBySlug?.(SEARCH_TOOL_SLUG);
    const discovered =
      typeof tool === 'object' && tool !== null && 'version' in tool
        ? readToolVersion(tool.version)
        : undefined;
    if (discovered) return discovered;
    throw new ConnectorDataError({
      code: 'gmail_tool_version_unavailable',
      operation: 'searchMessages',
      provider: 'gmail',
      retryable: false,
    });
  });

  return {
    getAccount: () =>
      loadGmailAccount({
        connectedAccountId,
        connectedAccounts: composio.connectedAccounts,
        userId,
      }),
    searchMessages: async ({ maxResults = DEFAULT_MAX_RESULTS, query }) => {
      const finiteMaxResults = Number.isFinite(maxResults) ? maxResults : DEFAULT_MAX_RESULTS;
      const boundedMaxResults = Math.min(
        Math.max(1, Math.floor(finiteMaxResults)),
        DEFAULT_MAX_RESULTS,
      );
      return withConnectorRetry(
        async () => {
          const version = await getToolVersion();
          const response = await composio.tools.execute(SEARCH_TOOL_SLUG, {
            arguments: {
              max_results: boundedMaxResults,
              query: query.slice(0, MAX_QUERY_LENGTH),
            },
            connectedAccountId,
            userId,
            version,
          });
          if (
            typeof response !== 'object' ||
            response === null ||
            !('successful' in response) ||
            response.successful !== true
          ) {
            throw new ConnectorDataError({
              code: 'gmail_search_failed',
              operation: 'searchMessages',
              provider: 'gmail',
              retryable: false,
            });
          }
          const messages = parseGmailMessages(response, { maxCandidates: boundedMaxResults });
          if (!messages) {
            throw new ConnectorDataError({
              code: 'gmail_response_invalid',
              operation: 'searchMessages',
              provider: 'gmail',
              retryable: false,
            });
          }
          return messages;
        },
        {
          code: 'gmail_search_failed',
          operation: 'searchMessages',
          provider: 'gmail',
        },
      );
    },
  };
};
