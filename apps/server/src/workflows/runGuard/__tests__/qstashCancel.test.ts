import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelWorkflowRunsByGuardPolicy } from '../qstashCancel';

describe('workflow run guard qstash cancel', () => {
  const originalQstashToken = process.env.QSTASH_TOKEN;
  const originalQstashUrl = process.env.QSTASH_URL;

  beforeEach(() => {
    process.env.QSTASH_TOKEN = 'test-token';
    delete process.env.QSTASH_URL;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ cancelled: 12 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
  });

  afterEach(() => {
    if (originalQstashToken === undefined) delete process.env.QSTASH_TOKEN;
    else process.env.QSTASH_TOKEN = originalQstashToken;

    if (originalQstashUrl === undefined) delete process.env.QSTASH_URL;
    else process.env.QSTASH_URL = originalQstashUrl;

    vi.restoreAllMocks();
  });

  /**
   * @example
   * cancelWorkflowRunsByGuardPolicy({
   *   appUrl: 'https://app.lobehub.com',
   *   workflowPath: 'api/workflows/memory-user-memory',
   * })
   * // cancels pending and active workflows whose URL starts with the workflow prefix
   */
  it('cancels workflows using the REST URL-prefix body shape expected by QStash', async () => {
    await expect(
      cancelWorkflowRunsByGuardPolicy({
        appUrl: 'https://app.lobehub.com',
        workflowPath: 'api/workflows/memory-user-memory',
      }),
    ).resolves.toEqual({
      cancelled: 12,
      workflowUrlPrefix: 'https://app.lobehub.com/api/workflows/memory-user-memory',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL('/v2/workflows/runs', 'https://qstash.upstash.io'),
      {
        body: JSON.stringify({
          workflowUrl: ['https://app.lobehub.com/api/workflows/memory-user-memory'],
        }),
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        method: 'DELETE',
      },
    );
  });

  /**
   * @example
   * cancelWorkflowRunsByGuardPolicy({
   *   appUrl: 'https://app.lobehub.com/',
   *   workflowPath: '/api/workflows/memory-user-memory/?cursor=1#hash',
   * })
   * // normalizes the URL prefix before cancellation
   */
  it('normalizes the workflow URL prefix before cancellation', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ cancelled: 1 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );

    await expect(
      cancelWorkflowRunsByGuardPolicy({
        appUrl: 'https://app.lobehub.com/',
        workflowPath: '/api/workflows/memory-user-memory/?cursor=1#hash',
      }),
    ).resolves.toEqual({
      cancelled: 1,
      workflowUrlPrefix: 'https://app.lobehub.com/api/workflows/memory-user-memory',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL('/v2/workflows/runs', 'https://qstash.upstash.io'),
      expect.objectContaining({
        body: JSON.stringify({
          workflowUrl: ['https://app.lobehub.com/api/workflows/memory-user-memory'],
        }),
      }),
    );
  });

  /**
   * @example
   * cancelWorkflowRunsByGuardPolicy({
   *   appUrl: 'https://app.lobehub.com',
   *   workflowPath: 'api/workflows/memory-user-memory',
   * })
   * // returns the SDK cancellation count, including zero
   */
  it('returns zero when QStash reports no cancelled workflows', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ cancelled: 0 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );

    await expect(
      cancelWorkflowRunsByGuardPolicy({
        appUrl: 'https://app.lobehub.com',
        workflowPath: 'api/workflows/memory-user-memory',
      }),
    ).resolves.toEqual({
      cancelled: 0,
      workflowUrlPrefix: 'https://app.lobehub.com/api/workflows/memory-user-memory',
    });
  });

  /**
   * @example
   * cancelWorkflowRunsByGuardPolicy({
   *   appUrl: 'https://app.lobehub.com',
   *   workflowPath: 'api/workflows/memory-user-memory',
   * })
   * // throws when QSTASH_TOKEN is not configured
   */
  it('throws when QSTASH_TOKEN is missing', async () => {
    delete process.env.QSTASH_TOKEN;

    await expect(
      cancelWorkflowRunsByGuardPolicy({
        appUrl: 'https://app.lobehub.com',
        workflowPath: 'api/workflows/memory-user-memory',
      }),
    ).rejects.toThrow('QSTASH_TOKEN is required to cancel workflow runs');
  });
});
