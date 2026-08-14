// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSignalNightlyReviewWorkflow } from '../nightlyReview';

const mocks = vi.hoisted(() => ({
  injectActiveTraceHeaders: vi.fn((headers: Headers) => {
    headers.set('traceparent', '00-trace-parent');
  }),
  trigger: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://public.example.com',
    INTERNAL_APP_URL: 'https://internal.example.com',
  },
}));

vi.mock('@/libs/observability/traceparent', () => ({
  injectActiveTraceHeaders: mocks.injectActiveTraceHeaders,
}));

vi.mock('@/libs/qstash', () => ({
  workflowClient: {
    trigger: mocks.trigger,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.trigger.mockResolvedValue({ workflowRunId: 'workflow-1' });
});

describe('AgentSignalNightlyReviewWorkflow', () => {
  it('triggers serialized pagination with global single-run flow control', async () => {
    /**
     * @example
     * expect(trigger).toHaveBeenCalledWith(expect.objectContaining({ flowControl }));
     */
    const payload = {
      pageSize: 50,
      requestedAt: '2026-05-03T18:30:00.000Z',
      targetLimit: 20,
    };

    await expect(AgentSignalNightlyReviewWorkflow.triggerPaginateUsers(payload)).resolves.toEqual({
      workflowRunId: 'workflow-1',
    });
    expect(mocks.trigger).toHaveBeenCalledWith({
      body: payload,
      flowControl: {
        key: 'agent-signal.nightly-review.paginate-users',
        parallelism: 1,
      },
      headers: { traceparent: '00-trace-parent' },
      url: 'https://internal.example.com/api/workflows/agent-signal/paginate-nightly-review-users',
    });
  });

  it('triggers one user execution with bounded concurrency', async () => {
    /**
     * @example
     * expect(trigger).toHaveBeenCalledWith(expect.objectContaining({ flowControl }));
     */
    const payload = {
      requestedAt: '2026-05-03T18:30:00.000Z',
      targetLimit: 5,
      user: {
        createdAt: '2026-01-01T00:00:00.000Z',
        id: 'user-1',
        timezone: 'Asia/Shanghai',
      },
    };

    await expect(AgentSignalNightlyReviewWorkflow.triggerExecuteUser(payload)).resolves.toEqual({
      workflowRunId: 'workflow-1',
    });
    expect(mocks.trigger).toHaveBeenCalledWith({
      body: payload,
      flowControl: {
        key: 'agent-signal.nightly-review.execute-user',
        parallelism: 5,
      },
      headers: { traceparent: '00-trace-parent' },
      url: 'https://internal.example.com/api/workflows/agent-signal/execute-nightly-review-user',
    });
  });
});
