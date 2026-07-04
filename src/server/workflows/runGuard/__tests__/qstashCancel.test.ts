import { describe, expect, it, vi } from 'vitest';

import { cancelWorkflowRunsByGuardPolicy } from '../qstashCancel';

describe('workflow run guard qstash cancel', () => {
  /**
   * @example
   * cancelWorkflowRunsByGuardPolicy(client, {
   *   appUrl: 'https://app.lobehub.com',
   *   workflowPath: 'api/workflows/memory-user-memory',
   * })
   * // cancels pending and active workflows whose URL starts with the workflow prefix
   */
  it('cancels workflows using the SDK url prefix API', async () => {
    const client = {
      cancel: vi.fn().mockResolvedValue({ cancelled: 12 }),
    };

    await expect(
      cancelWorkflowRunsByGuardPolicy(
        client as unknown as Parameters<typeof cancelWorkflowRunsByGuardPolicy>[0],
        {
          appUrl: 'https://app.lobehub.com',
          workflowPath: 'api/workflows/memory-user-memory',
        },
      ),
    ).resolves.toEqual({
      cancelled: 12,
      workflowUrlPrefix: 'https://app.lobehub.com/api/workflows/memory-user-memory',
    });

    expect(client.cancel).toHaveBeenCalledWith({
      urlStartingWith: 'https://app.lobehub.com/api/workflows/memory-user-memory',
    });
  });

  /**
   * @example
   * cancelWorkflowRunsByGuardPolicy(client, {
   *   appUrl: 'https://app.lobehub.com/',
   *   workflowPath: '/api/workflows/memory-user-memory/?cursor=1#hash',
   * })
   * // normalizes the URL prefix before cancellation
   */
  it('normalizes the workflow URL prefix before cancellation', async () => {
    const client = {
      cancel: vi.fn().mockResolvedValue({ cancelled: 1 }),
    };

    await expect(
      cancelWorkflowRunsByGuardPolicy(
        client as unknown as Parameters<typeof cancelWorkflowRunsByGuardPolicy>[0],
        {
          appUrl: 'https://app.lobehub.com/',
          workflowPath: '/api/workflows/memory-user-memory/?cursor=1#hash',
        },
      ),
    ).resolves.toEqual({
      cancelled: 1,
      workflowUrlPrefix: 'https://app.lobehub.com/api/workflows/memory-user-memory',
    });

    expect(client.cancel).toHaveBeenCalledWith({
      urlStartingWith: 'https://app.lobehub.com/api/workflows/memory-user-memory',
    });
  });

  /**
   * @example
   * cancelWorkflowRunsByGuardPolicy(client, {
   *   appUrl: 'https://app.lobehub.com',
   *   workflowPath: 'api/workflows/memory-user-memory',
   * })
   * // returns the SDK cancellation count, including zero
   */
  it('returns zero when QStash reports no cancelled workflows', async () => {
    const client = {
      cancel: vi.fn().mockResolvedValue({ cancelled: 0 }),
    };

    await expect(
      cancelWorkflowRunsByGuardPolicy(
        client as unknown as Parameters<typeof cancelWorkflowRunsByGuardPolicy>[0],
        {
          appUrl: 'https://app.lobehub.com',
          workflowPath: 'api/workflows/memory-user-memory',
        },
      ),
    ).resolves.toEqual({
      cancelled: 0,
      workflowUrlPrefix: 'https://app.lobehub.com/api/workflows/memory-user-memory',
    });
  });
});
