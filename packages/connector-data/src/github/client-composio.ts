import { toRecord } from '@lobechat/utils/object';

import { createRecoverableMemo } from '../memo';
import { createGitHubConnectorClient, type GitHubConnectorClient } from './client';
import type { GitHubConnectorTransport } from './graphql/client';

/** A query or header parameter accepted by Composio proxy execution. */
export interface GitHubComposioProxyParameter {
  /** Where Composio should add the parameter. */
  in: 'header' | 'query';
  /** HTTP parameter name. */
  name: string;
  /** HTTP parameter value. */
  value: number | string;
}

/** Request shape used to proxy an authenticated GitHub API call through Composio. */
export interface GitHubComposioProxyRequest {
  /** Optional JSON request body. */
  body?: unknown;
  /** Server-resolved Composio connected account identifier. */
  connectedAccountId: string;
  /** Relative GitHub API endpoint. */
  endpoint: string;
  /** HTTP method supported by Composio proxy execution. */
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  /** Optional query and header parameters. */
  parameters?: GitHubComposioProxyParameter[];
}

/** Minimal Composio tools interface required by the GitHub adapter. */
export interface GitHubComposioTools {
  /** Proxies one authenticated GitHub HTTP request. */
  proxyExecute: (input: GitHubComposioProxyRequest) => Promise<unknown>;
}

/** Minimal Composio client interface required by the GitHub adapter. */
export interface GitHubComposioClient {
  /** Composio tool execution surface. */
  tools: GitHubComposioTools;
}

/** Configuration shared by the Composio transport and connector factories. */
export interface CreateGitHubComposioConnectorClientOptions {
  /** Composio SDK client or compatible test adapter. */
  composio: GitHubComposioClient;
  /** Connected account resolved from the authenticated user's connector row. */
  connectedAccountId: string;
}

interface ComposioProxyResponse {
  data: unknown;
  status: number;
}

const parseProxyResponse = (value: unknown): ComposioProxyResponse => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('GitHub Composio proxy response is invalid');
  }

  const response = value as { data?: unknown; status?: unknown };
  if (typeof response.status !== 'number' || !Number.isFinite(response.status)) {
    throw new Error('GitHub Composio proxy status is invalid');
  }
  if (response.status < 200 || response.status >= 300) {
    throw Object.assign(new Error('GitHub Composio proxy request failed'), {
      status: response.status,
    });
  }

  return { data: response.data, status: response.status };
};

/**
 * Creates a GitHub transport that keeps OAuth credentials inside Composio.
 *
 * Use when:
 * - A connector stores only a Composio connected-account identifier
 * - Existing GitHub loaders should run unchanged across REST and GraphQL
 *
 * Expects:
 * - The connected account belongs to the authenticated connector scope
 * - Composio resolves relative endpoints against GitHub's API base URL
 *
 * Returns:
 * - A transport compatible with the native OAuth GitHub connector
 */
export const createGitHubComposioTransport = ({
  composio,
  connectedAccountId,
}: CreateGitHubComposioConnectorClientOptions): GitHubConnectorTransport => {
  const proxy = async (
    input: Omit<GitHubComposioProxyRequest, 'connectedAccountId'>,
  ): Promise<unknown> => {
    // Composio injects the remote OAuth credential. The adapter sends only a
    // server-resolved account ID and never receives or logs the credential.
    const response = await composio.tools.proxyExecute({ ...input, connectedAccountId });
    return parseProxyResponse(response).data;
  };
  const getAuthenticatedUser = createRecoverableMemo(async () => {
    const user = toRecord(await proxy({ endpoint: '/user', method: 'GET' }));
    const id = user?.id;
    const login = user?.login;
    if ((typeof id !== 'number' && typeof id !== 'string') || typeof login !== 'string') {
      throw new Error('GitHub Composio authenticated user response is invalid');
    }
    return { id, login };
  });

  return {
    getAuthenticatedUser,
    listRepositoryContributors: async ({ owner, perPage, repository }) => {
      const data = await proxy({
        endpoint: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contributors`,
        method: 'GET',
        parameters: [{ in: 'query', name: 'per_page', value: perPage }],
      });
      if (!Array.isArray(data)) {
        throw new Error('GitHub Composio contributor response is invalid');
      }
      return data.map((item) => {
        const record = toRecord(item);
        return {
          contributions:
            typeof record?.contributions === 'number' ? record.contributions : undefined,
          login: typeof record?.login === 'string' ? record.login : null,
        };
      });
    },
    listUserOrganizations: async ({ perPage }) => {
      const data = await proxy({
        endpoint: '/user/orgs',
        method: 'GET',
        parameters: [{ in: 'query', name: 'per_page', value: perPage }],
      });
      if (!Array.isArray(data)) {
        throw new Error('GitHub Composio organization response is invalid');
      }
      return data.map((item) => {
        const record = toRecord(item);
        return {
          description: typeof record?.description === 'string' ? record.description : null,
          login: typeof record?.login === 'string' ? record.login : null,
        };
      });
    },
    request: async ({ query, variables }) => {
      const envelope = toRecord(
        await proxy({
          body: { query, variables },
          endpoint: '/graphql',
          method: 'POST',
          parameters: [{ in: 'header', name: 'Accept', value: 'application/vnd.github+json' }],
        }),
      );
      if (Array.isArray(envelope?.errors) && envelope.errors.length > 0) {
        throw Object.assign(new Error('GitHub Composio GraphQL request failed'), {
          errors: envelope.errors,
        });
      }
      if (!envelope || !('data' in envelope)) {
        throw new Error('GitHub Composio GraphQL response is invalid');
      }
      return envelope.data;
    },
  };
};

/**
 * Creates the Composio implementation of the shared GitHub connector interface.
 */
export const createGitHubComposioConnectorClient = (
  options: CreateGitHubComposioConnectorClientOptions,
): GitHubConnectorClient =>
  createGitHubConnectorClient({ transport: createGitHubComposioTransport(options) });
