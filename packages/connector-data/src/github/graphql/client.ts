import debug from 'debug';
import { Octokit } from 'octokit';
import type { z } from 'zod';

import { ConnectorDataError } from '../../errors';
import { withConnectorRetry } from '../../retry';

const log = debug('lobe-server:connector-data:github');
const MAX_ISSUES = 8;
const MAX_PATH_SEGMENTS = 8;
const SAFE_ERROR_NAME = /^[a-z][a-z0-9]{0,63}$/i;
const SAFE_GRAPHQL_ERROR_TYPE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_PATH_SEGMENT = /^[a-z_$][\w$]{0,63}$/i;
const declineOctokitRetry = () => false;

export interface GitHubGraphQLRequest<Variables extends Record<string, unknown>> {
  operation: string;
  query: string;
  variables: Variables;
}

/** @internal Test seam and protocol adapter. */
export interface GitHubConnectorTransport {
  getAuthenticatedUser: () => Promise<{ id: number | string; login: string }>;
  listRepositoryContributors: (input: {
    owner: string;
    perPage: number;
    repository: string;
  }) => Promise<Array<{ contributions?: number; login?: string | null }>>;
  request: <Variables extends Record<string, unknown>>(
    input: GitHubGraphQLRequest<Variables>,
  ) => Promise<unknown>;
}

export interface GitHubGraphQLClient {
  execute: <Response, Variables extends Record<string, unknown>>(input: {
    operation: string;
    query: string;
    schema: z.ZodType<Response>;
    variables: Variables;
  }) => Promise<Response>;
}

interface ExecuteOptions<Response, Variables extends Record<string, unknown>> {
  operation: string;
  query: string;
  schema: z.ZodType<Response>;
  transport: GitHubConnectorTransport;
  variables: Variables;
}

const getErrorName = (error: unknown): string => {
  if (!(error instanceof Error) || !SAFE_ERROR_NAME.test(error.name)) return 'Error';

  return error.name;
};

const getErrorStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return;

  const { response, status, statusCode } = error as {
    response?: { status?: unknown };
    status?: unknown;
    statusCode?: unknown;
  };
  const candidate = status ?? statusCode ?? response?.status;

  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
};

const getIssuePath = (path: readonly unknown[]): Array<number | string> =>
  path.slice(0, MAX_PATH_SEGMENTS).map((segment) => {
    if (typeof segment === 'number' && Number.isSafeInteger(segment)) return segment;
    if (typeof segment === 'string' && SAFE_PATH_SEGMENT.test(segment)) return segment;

    return '[redacted]';
  });

const getGraphQLErrors = (
  error: unknown,
): Array<{ path?: Array<number | string>; type?: string }> | undefined => {
  if (typeof error !== 'object' || error === null || !('errors' in error)) return;

  const { errors } = error as { errors?: unknown };
  if (!Array.isArray(errors)) return;

  return errors.slice(0, MAX_ISSUES).flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];

    const { path, type } = entry as { path?: unknown; type?: unknown };
    const diagnostic = {
      ...(Array.isArray(path) ? { path: getIssuePath(path) } : {}),
      ...(typeof type === 'string' && SAFE_GRAPHQL_ERROR_TYPE.test(type) ? { type } : {}),
    };

    return Object.keys(diagnostic).length > 0 ? [diagnostic] : [];
  });
};

/** @internal GraphQL protocol execution with retry and strict response validation. */
export const execute = async <Response, Variables extends Record<string, unknown>>({
  operation,
  query,
  schema,
  transport,
  variables,
}: ExecuteOptions<Response, Variables>): Promise<Response> =>
  withConnectorRetry(
    async () => {
      let response: unknown;

      try {
        response = await transport.request({ operation, query, variables });
      } catch (error) {
        const errors = getGraphQLErrors(error);
        const status = getErrorStatus(error);
        log('GraphQL request failed: %O', {
          errorName: getErrorName(error),
          ...(errors === undefined ? {} : { errors }),
          operation,
          ...(status === undefined ? {} : { status }),
        });
        throw error;
      }

      const result = schema.safeParse(response);
      if (result.success) return result.data;

      log('GraphQL response validation failed: %O', {
        issues: result.error.issues.slice(0, MAX_ISSUES).map(({ code, path }) => ({
          code,
          path: getIssuePath(path),
        })),
        operation,
      });
      throw new ConnectorDataError({
        code: 'github_response_invalid',
        operation,
        provider: 'github',
        retryable: false,
      });
    },
    {
      code: 'github_request_failed',
      operation,
      provider: 'github',
    },
  );

/** @internal */
export const createOctokitTransport = (accessToken: string): GitHubConnectorTransport => {
  const octokit = new Octokit({
    auth: accessToken,
    retry: { enabled: false },
    throttle: {
      onRateLimit: declineOctokitRetry,
      onSecondaryRateLimit: declineOctokitRetry,
    },
  });

  return {
    getAuthenticatedUser: async () => {
      const response = await octokit.rest.users.getAuthenticated();
      return { id: response.data.id, login: response.data.login };
    },
    listRepositoryContributors: async ({ owner, perPage, repository }) => {
      const response = await octokit.rest.repos.listContributors({
        owner,
        per_page: perPage,
        repo: repository,
      });
      return response.data.map(({ contributions, login }) => ({
        contributions,
        login,
      }));
    },
    request: ({ query, variables }) => octokit.graphql(query, variables),
  };
};

export const createGitHubGraphQLClient = (
  transport: GitHubConnectorTransport,
): GitHubGraphQLClient => ({
  execute: (input) => execute({ ...input, transport }),
});
