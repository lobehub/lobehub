import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetRedisConfig, redis, redisLib, workflowClient } = vi.hoisted(() => ({
  mockGetRedisConfig: vi.fn(),
  redis: {
    set: vi.fn(),
  },
  redisLib: {
    initializeRedis: vi.fn(),
    isRedisEnabled: vi.fn(),
  },
  workflowClient: {
    cancel: vi.fn(),
    logs: vi.fn(),
  },
}));

vi.mock('@/envs/redis', () => ({
  getRedisConfig: mockGetRedisConfig,
}));

vi.mock('@/libs/redis', () => ({
  initializeRedis: redisLib.initializeRedis,
  isRedisEnabled: redisLib.isRedisEnabled,
}));

vi.mock('@/libs/qstash', () => ({
  workflowClient,
}));

const { POST } = await import('./route');

const originalEnv = {
  APP_URL: process.env.APP_URL,
  INTERNAL_APP_URL: process.env.INTERNAL_APP_URL,
  MEMORY_USER_MEMORY_WEBHOOK_BASE_URL: process.env.MEMORY_USER_MEMORY_WEBHOOK_BASE_URL,
  WORKFLOW_RUN_GUARD_WEBHOOK_HEADERS: process.env.WORKFLOW_RUN_GUARD_WEBHOOK_HEADERS,
};

const restoreEnv = () => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

describe('workflow run guard webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedisConfig.mockReturnValue({ enabled: true, url: 'redis://test' });
    redisLib.isRedisEnabled.mockReturnValue(true);
    redisLib.initializeRedis.mockReturnValue(redis);
    process.env.APP_URL = 'https://app.lobehub.com';
    process.env.INTERNAL_APP_URL = '';
    process.env.MEMORY_USER_MEMORY_WEBHOOK_BASE_URL = '';
    process.env.WORKFLOW_RUN_GUARD_WEBHOOK_HEADERS = 'Authorization=Bearer webhook-secret';
  });

  afterEach(() => {
    restoreEnv();
  });

  /**
   * @example
   * POST(requestWithWrongAuthorizationHeader) returns 401 and does not read Redis.
   */
  it('rejects invalid webhook headers', async () => {
    const response = await POST(
      new Request('https://app.lobehub.com/api/webhooks/workflows/run-guard', {
        body: JSON.stringify({ scope: { type: 'global' } }),
        headers: { Authorization: 'Bearer wrong-secret' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(redisLib.initializeRedis).not.toHaveBeenCalled();
  });

  /**
   * @example
   * POST(requestWhenEnvHeadersMissing) returns 401 and leaves guard state untouched.
   */
  it('rejects when webhook header env is missing', async () => {
    delete process.env.WORKFLOW_RUN_GUARD_WEBHOOK_HEADERS;

    const response = await POST(
      new Request('https://app.lobehub.com/api/webhooks/workflows/run-guard', {
        body: JSON.stringify({ scope: { type: 'global' } }),
        headers: { Authorization: 'Bearer webhook-secret' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(401);
    expect(redisLib.initializeRedis).not.toHaveBeenCalled();
  });

  /**
   * @example
   * POST({ scope: { type: 'global' }, ttlSeconds: 60 }) with Authorization header stores a global guard.
   */
  it('sets a guard from webhook payload', async () => {
    redis.set.mockResolvedValue('OK');

    const response = await POST(
      new Request('https://app.lobehub.com/api/webhooks/workflows/run-guard', {
        body: JSON.stringify({
          reason: 'external stop',
          scope: { type: 'global' },
          ttlSeconds: 60,
        }),
        headers: { Authorization: 'Bearer webhook-secret' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      guard: {
        key: 'workflow:run-guard:global',
        ttlSeconds: 60,
        value: { reason: 'external stop' },
      },
      success: true,
    });
    expect(redis.set).toHaveBeenCalledWith(
      'workflow:run-guard:global',
      expect.stringContaining('external stop'),
      { ex: 60 },
    );
  });

  /**
   * @example
   * POST(validPayloadWithAllConfiguredHeaders) accepts every configured header pair.
   */
  it('accepts multiple configured webhook headers', async () => {
    process.env.WORKFLOW_RUN_GUARD_WEBHOOK_HEADERS =
      'Authorization=Bearer webhook-secret,x-workflow-source=ops-console';
    redis.set.mockResolvedValue('OK');

    const response = await POST(
      new Request('https://app.lobehub.com/api/webhooks/workflows/run-guard', {
        body: JSON.stringify({ scope: { type: 'global' } }),
        headers: {
          'Authorization': 'Bearer webhook-secret',
          'x-workflow-source': 'ops-console',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  /**
   * @example
   * POST(pathGuardWithCancelPolicy) stores the guard and cancels matching workflow runs.
   */
  it('cancels qstash runs for path guards when policy requests it', async () => {
    process.env.MEMORY_USER_MEMORY_WEBHOOK_BASE_URL = 'https://internal.lobehub.com';
    redis.set.mockResolvedValue('OK');
    workflowClient.cancel.mockResolvedValue({ cancelled: 1 });

    const response = await POST(
      new Request('https://app.lobehub.com/api/webhooks/workflows/run-guard', {
        body: JSON.stringify({
          policy: { cancelQstash: true },
          scope: { type: 'path', workflowPath: 'api/workflows/memory-user-memory' },
        }),
        headers: { Authorization: 'Bearer webhook-secret' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      guard: {
        key: 'workflow:run-guard:path:api/workflows/memory-user-memory',
        value: { policy: { cancelQstash: true } },
      },
      qstash: {
        cancelled: 1,
        workflowUrlPrefix: 'https://internal.lobehub.com/api/workflows/memory-user-memory',
      },
      success: true,
    });
    expect(workflowClient.logs).not.toHaveBeenCalled();
    expect(workflowClient.cancel).toHaveBeenCalledWith({
      urlStartingWith: 'https://internal.lobehub.com/api/workflows/memory-user-memory',
    });
  });

  /**
   * @example
   * POST({ scope: { type: 'path' } }) returns 400 because workflowPath is required.
   */
  it('rejects invalid bodies before reading redis', async () => {
    const response = await POST(
      new Request('https://app.lobehub.com/api/webhooks/workflows/run-guard', {
        body: JSON.stringify({ scope: { type: 'path' } }),
        headers: { Authorization: 'Bearer webhook-secret' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(400);
    expect(redisLib.initializeRedis).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid request' });
  });

  /**
   * @example
   * POST('{broken') returns an explicit invalid JSON response.
   */
  it('rejects malformed json bodies', async () => {
    const response = await POST(
      new Request('https://app.lobehub.com/api/webhooks/workflows/run-guard', {
        body: '{broken',
        headers: { Authorization: 'Bearer webhook-secret' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(400);
    expect(redisLib.initializeRedis).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON' });
  });

  /**
   * @example
   * POST(validPayload) returns 500 when Redis is unavailable.
   */
  it('fails closed when redis is not configured', async () => {
    redisLib.isRedisEnabled.mockReturnValue(false);

    const response = await POST(
      new Request('https://app.lobehub.com/api/webhooks/workflows/run-guard', {
        body: JSON.stringify({ scope: { type: 'global' } }),
        headers: { Authorization: 'Bearer webhook-secret' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Redis is not configured' });
  });
});
