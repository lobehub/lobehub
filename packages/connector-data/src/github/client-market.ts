import { toRecord } from '@lobechat/utils/object';

import { createRecoverableMemo } from '../memo';
import { createGitHubConnectorClient, type GitHubConnectorClient } from './client';
import type { GitHubConnectorTransport } from './graphql/client';

/** A query or header parameter accepted by Market OAuth proxy execution. */
export interface GitHubMarketProxyParameter {
  /** Where Market should add the parameter. */
  in: 'header' | 'query';
  /** HTTP parameter name. */
  name: string;
  /** HTTP parameter value. */
  value: number | string;
}

/** Request shape used to proxy an authenticated GitHub API call through Market. */
export interface GitHubMarketProxyRequest {
  /** Optional JSON request body. */
  body?: unknown;
  /** Relative GitHub API endpoint. */
  endpoint: string;
  /** HTTP method supported by Market proxy execution. */
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  /** Optional query and header parameters. */
  parameters?: GitHubMarketProxyParameter[];
  /** Market provider identifier. */
  provider: 'github';
}

/** Minimal Market client interface required by the GitHub adapter. */
export interface GitHubMarketClient {
  /** Proxies one authenticated provider HTTP request. */
  proxyOAuthRequest: (input: GitHubMarketProxyRequest) => Promise<unknown>;
}

/** Configuration shared by the Market transport and connector factories. */
export interface CreateGitHubMarketConnectorClientOptions {
  /** Authenticated Market client or compatible test adapter. */
  market: GitHubMarketClient;
}

interface MarketProxyResponse {
  data: unknown;
  status: number;
}

const parseProxyResponse = (value: unknown): MarketProxyResponse => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('GitHub Market proxy response is invalid');
  }

  const response = value as { data?: unknown; status?: unknown };
  if (typeof response.status !== 'number' || !Number.isFinite(response.status)) {
    throw new Error('GitHub Market proxy status is invalid');
  }
  if (response.status < 200 || response.status >= 300) {
    throw Object.assign(new Error('GitHub Market proxy request failed'), {
      status: response.status,
    });
  }

  return { data: response.data, status: response.status };
};

/**
 * Creates a GitHub transport backed by Market's OAuth proxy.
 *
 * Use when:
 * - Market owns the user's GitHub OAuth connection
 * - Existing GitHub loaders should run unchanged across REST and GraphQL
 *
 * Expects:
 * - The Market client is scoped to the authenticated LobeHub user
 * - Market resolves relative endpoints against GitHub's API base URL
 *
 * Returns:
 * - A transport compatible with the native OAuth GitHub connector
 */
export const createGitHubMarketTransport = ({
  market,
}: CreateGitHubMarketConnectorClientOptions): GitHubConnectorTransport => {
  const proxy = async (input: Omit<GitHubMarketProxyRequest, 'provider'>): Promise<unknown> => {
    const response = await market.proxyOAuthRequest({ ...input, provider: 'github' });
    return parseProxyResponse(response).data;
  };
  const getAuthenticatedUser = createRecoverableMemo(async () => {
    const user = toRecord(await proxy({ endpoint: '/user', method: 'GET' }));
    const id = user?.id;
    const login = user?.login;
    if ((typeof id !== 'number' && typeof id !== 'string') || typeof login !== 'string') {
      throw new Error('GitHub Market authenticated user response is invalid');
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
        throw new Error('GitHub Market contributor response is invalid');
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
        throw new Error('GitHub Market organization response is invalid');
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
        throw Object.assign(new Error('GitHub Market GraphQL request failed'), {
          errors: envelope.errors,
        });
      }
      if (!envelope || !('data' in envelope)) {
        throw new Error('GitHub Market GraphQL response is invalid');
      }
      return envelope.data;
    },
  };
};

/**
 * Creates the Market-backed implementation of the shared GitHub connector interface.
 *
 * Use when:
 * - A caller needs structured GitHub data through a LobeHub-managed OAuth connection
 *
 * Expects:
 * - An authenticated Market proxy client
 *
 * Returns:
 * - The stable domain-level GitHub connector interface
 */
export const createGitHubMarketConnectorClient = (
  options: CreateGitHubMarketConnectorClientOptions,
): GitHubConnectorClient =>
  createGitHubConnectorClient({ transport: createGitHubMarketTransport(options) });
