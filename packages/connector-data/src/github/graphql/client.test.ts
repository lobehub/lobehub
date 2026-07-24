import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ConnectorDataError } from '../../errors';
import type { GitHubConnectorTransport } from './client';
import { createOctokitTransport, execute } from './client';

const log = vi.hoisted(() => vi.fn());
const octokit = vi.hoisted(() =>
  vi.fn(function OctokitMock(_options: {
    auth: string;
    retry: { enabled: boolean };
    throttle: {
      onRateLimit: () => boolean;
      onSecondaryRateLimit: () => boolean;
    };
  }) {
    return {
      graphql: vi.fn(),
      rest: {
        repos: { listContributors: vi.fn() },
        users: { getAuthenticated: vi.fn() },
      },
    };
  }),
);

vi.mock('debug', () => ({
  default: vi.fn(() => log),
}));
vi.mock('octokit', () => ({ Octokit: octokit }));

const createTransport = (
  request: GitHubConnectorTransport['request'],
): GitHubConnectorTransport => ({
  getAuthenticatedUser: async () => ({ id: 1, login: 'neko' }),
  listRepositoryContributors: async () => [],
  request,
});

const schema = z.object({ viewer: z.object({ login: z.string() }).strict() }).strict();

describe('GitHub GraphQL execute', () => {
  afterEach(() => {
    log.mockClear();
    vi.useRealTimers();
  });

  it('disables Octokit retries because connector retry owns the policy', () => {
    createOctokitTransport('test-token');

    const [options] = octokit.mock.calls.at(-1)!;
    expect(options).toMatchObject({
      auth: 'test-token',
      retry: { enabled: false },
      throttle: {
        onRateLimit: expect.any(Function),
        onSecondaryRateLimit: expect.any(Function),
      },
    });
    expect(options.throttle.onRateLimit()).toBe(false);
    expect(options.throttle.onSecondaryRateLimit()).toBe(false);
  });

  it('retries a transient request and validates the successful response', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('temporary'), { status: 503 }))
      .mockResolvedValueOnce({ viewer: { login: 'neko' } });
    const result = execute({
      operation: 'TestProfile',
      query: 'query TestProfile { viewer { login } }',
      schema,
      transport: createTransport(request),
      variables: {},
    });

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ viewer: { login: 'neko' } });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('sanitizes strict schema failures', async () => {
    const transport = createTransport(
      vi.fn().mockResolvedValue({
        upstreamBody: 'token=secret-upstream-body',
        viewer: { login: 'neko' },
      }),
    );

    const error = await execute({
      operation: 'TestProfile',
      query: 'query TestProfile { viewer { login } }',
      schema,
      transport,
      variables: {},
    }).catch((reason) => reason);

    expect(error).toBeInstanceOf(ConnectorDataError);
    expect(error).toMatchObject({
      code: 'github_response_invalid',
      message: 'github TestProfile failed',
      operation: 'TestProfile',
      retryable: false,
    });
    const diagnostic = JSON.stringify({ error, logs: log.mock.calls });
    expect(diagnostic).not.toMatch(/secret-upstream-body|token=|upstreamBody/);
  });

  it('sanitizes terminal upstream failures', async () => {
    const transport = createTransport(
      vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('401 token=secret-upstream-body'), { status: 401 }),
        ),
    );

    const error = await execute({
      operation: 'TestProfile',
      query: 'query TestProfile { viewer { login } }',
      schema,
      transport,
      variables: {},
    }).catch((reason) => reason);

    expect(error).toMatchObject({
      code: 'github_request_failed',
      message: 'github TestProfile failed',
      retryable: false,
    });
    expect(log).toHaveBeenCalledWith('GraphQL request failed: %O', {
      errorName: 'Error',
      operation: 'TestProfile',
      status: 401,
    });
    expect(JSON.stringify({ error, logs: log.mock.calls })).not.toMatch(
      /secret-upstream-body|token=/,
    );
  });

  it('logs only safe GraphQL error types and paths', async () => {
    const errors = [
      {
        data: { token: 'secret-data' },
        extensions: { response: 'secret-extension' },
        message: 'token=secret-message',
        path: ['viewer', 'contributionsCollection', 0, 'secret path segment'],
        type: 'RESOURCE_LIMITS_EXCEEDED',
      },
      {
        message: 'secret-second-message',
        path: ['viewer', 'repositories'],
        type: 'unsafe type=secret',
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        message: `secret-overflow-${index}`,
        path: ['viewer', `field${index}`],
        type: 'NOT_FOUND',
      })),
    ];
    const upstreamError = Object.assign(new Error('token=secret-upstream-body'), {
      errors,
      name: 'GraphqlResponseError',
      status: 200,
    });
    const transport = createTransport(vi.fn().mockRejectedValue(upstreamError));

    const error = await execute({
      operation: 'TestProfile',
      query: 'query TestProfile { viewer { login } }',
      schema,
      transport,
      variables: { token: 'secret-variable' },
    }).catch((reason) => reason);

    expect(error).toMatchObject({
      code: 'github_request_failed',
      retryable: false,
    });
    expect(log).toHaveBeenCalledWith('GraphQL request failed: %O', {
      errorName: 'GraphqlResponseError',
      errors: [
        {
          path: ['viewer', 'contributionsCollection', 0, '[redacted]'],
          type: 'RESOURCE_LIMITS_EXCEEDED',
        },
        { path: ['viewer', 'repositories'] },
        ...Array.from({ length: 6 }, (_, index) => ({
          path: ['viewer', `field${index}`],
          type: 'NOT_FOUND',
        })),
      ],
      operation: 'TestProfile',
      status: 200,
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /secret-data|secret-extension|secret-message|secret-upstream-body|secret-variable|unsafe type/,
    );
  });
});
