import { describe, expect, it, vi } from 'vitest';

import { cancelWorkflowRunsByGuardPolicy } from '../qstashCancel';

describe('workflow run guard qstash cancel', () => {
  /**
   * @example
   * cancelWorkflowRunsByGuardPolicy(client, {
   *   appUrl: 'https://app.lobehub.com',
   *   workflowPath: 'api/workflows/memory-user-memory',
   * })
   * // cancels RUN_STARTED workflow ids whose URL starts with the workflow prefix
   */
  it('resolves matching run ids from logs and cancels by id', async () => {
    const client = {
      cancel: vi.fn().mockResolvedValue({ cancelled: 2 }),
      logs: vi.fn().mockResolvedValue({
        runs: [
          {
            workflowRunId: 'wfr_1',
            workflowState: 'RUN_STARTED',
            workflowUrl:
              'https://app.lobehub.com/api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
          },
          {
            workflowRunId: 'wfr_2',
            workflowState: 'RUN_STARTED',
            workflowUrl:
              'https://app.lobehub.com/api/workflows/memory-user-memory/pipelines/chat-topic/process-topics',
          },
          {
            workflowRunId: 'wfr_other',
            workflowState: 'RUN_STARTED',
            workflowUrl: 'https://app.lobehub.com/api/workflows/agent-eval-run/execute-test-case',
          },
        ],
      }),
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
      cancelled: 2,
      matchedRunIds: ['wfr_1', 'wfr_2'],
      workflowUrlPrefix: 'https://app.lobehub.com/api/workflows/memory-user-memory',
    });

    expect(client.logs).toHaveBeenCalledWith({ count: 100, state: 'RUN_STARTED' });
    expect(client.cancel).toHaveBeenCalledWith({ ids: ['wfr_1', 'wfr_2'] });
  });

  /**
   * @example
   * cancelWorkflowRunsByGuardPolicy(client, {
   *   appUrl: 'https://app.lobehub.com/',
   *   workflowPath: '/api/workflows/memory-user-memory/',
   * })
   * // deduplicates matching workflow run ids before cancellation
   */
  it('normalizes the URL prefix and deduplicates matched run ids', async () => {
    const client = {
      cancel: vi.fn().mockResolvedValue({ cancelled: 1 }),
      logs: vi.fn().mockResolvedValue({
        runs: [
          {
            workflowRunId: 'wfr_1',
            workflowState: 'RUN_STARTED',
            workflowUrl:
              'https://app.lobehub.com/api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
          },
          {
            workflowRunId: 'wfr_1',
            workflowState: 'RUN_STARTED',
            workflowUrl:
              'https://app.lobehub.com/api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
          },
          {
            workflowRunId: 'wfr_other',
            workflowState: 'RUN_STARTED',
            workflowUrl: 'https://app.lobehub.com/api/workflows/agent-eval-run/execute-test-case',
          },
        ],
      }),
    };

    await expect(
      cancelWorkflowRunsByGuardPolicy(
        client as unknown as Parameters<typeof cancelWorkflowRunsByGuardPolicy>[0],
        {
          appUrl: 'https://app.lobehub.com/',
          workflowPath: '/api/workflows/memory-user-memory/',
        },
      ),
    ).resolves.toEqual({
      cancelled: 1,
      matchedRunIds: ['wfr_1'],
      workflowUrlPrefix: 'https://app.lobehub.com/api/workflows/memory-user-memory',
    });

    expect(client.cancel).toHaveBeenCalledWith({ ids: ['wfr_1'] });
  });

  /**
   * @example
   * cancelWorkflowRunsByGuardPolicy(client, {
   *   appUrl: 'https://app.lobehub.com',
   *   workflowPath: 'api/workflows/memory-user-memory/pipelines/process-topic',
   * })
   * // does not cancel sibling routes with the same string prefix
   */
  it('matches workflow URL prefixes on path segment boundaries', async () => {
    const client = {
      cancel: vi.fn().mockResolvedValue({ cancelled: 2 }),
      logs: vi.fn().mockResolvedValue({
        runs: [
          {
            workflowRunId: 'wfr_exact',
            workflowState: 'RUN_STARTED',
            workflowUrl:
              'https://app.lobehub.com/api/workflows/memory-user-memory/pipelines/process-topic',
          },
          {
            workflowRunId: 'wfr_child',
            workflowState: 'RUN_STARTED',
            workflowUrl:
              'https://app.lobehub.com/api/workflows/memory-user-memory/pipelines/process-topic/child',
          },
          {
            workflowRunId: 'wfr_query',
            workflowState: 'RUN_STARTED',
            workflowUrl:
              'https://app.lobehub.com/api/workflows/memory-user-memory/pipelines/process-topic?cursor=1',
          },
          {
            workflowRunId: 'wfr_sibling',
            workflowState: 'RUN_STARTED',
            workflowUrl:
              'https://app.lobehub.com/api/workflows/memory-user-memory/pipelines/process-topics',
          },
          {
            workflowRunId: 'wfr_v2',
            workflowState: 'RUN_STARTED',
            workflowUrl:
              'https://app.lobehub.com/api/workflows/memory-user-memory-v2/pipelines/process-topic',
          },
        ],
      }),
    };

    await expect(
      cancelWorkflowRunsByGuardPolicy(
        client as unknown as Parameters<typeof cancelWorkflowRunsByGuardPolicy>[0],
        {
          appUrl: 'https://app.lobehub.com',
          workflowPath: 'api/workflows/memory-user-memory/pipelines/process-topic',
        },
      ),
    ).resolves.toEqual({
      cancelled: 2,
      matchedRunIds: ['wfr_exact', 'wfr_child', 'wfr_query'],
      workflowUrlPrefix:
        'https://app.lobehub.com/api/workflows/memory-user-memory/pipelines/process-topic',
    });

    expect(client.cancel).toHaveBeenCalledWith({
      ids: ['wfr_exact', 'wfr_child', 'wfr_query'],
    });
  });

  /**
   * @example
   * cancelWorkflowRunsByGuardPolicy(client, {
   *   appUrl: 'https://app.lobehub.com',
   *   workflowPath: 'api/workflows/memory-user-memory',
   * })
   * // returns zero and does not call cancel when logs have no matches
   */
  it('returns zero when no started runs match', async () => {
    const client = {
      cancel: vi.fn(),
      logs: vi.fn().mockResolvedValue({ runs: [] }),
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
      matchedRunIds: [],
      workflowUrlPrefix: 'https://app.lobehub.com/api/workflows/memory-user-memory',
    });

    expect(client.cancel).not.toHaveBeenCalled();
  });
});
