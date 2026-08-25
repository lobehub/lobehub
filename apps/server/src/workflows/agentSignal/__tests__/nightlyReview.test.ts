// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSignalNightlyReviewWorkflow } from '../nightlyReview';

const mocks = vi.hoisted(() => ({
  injectActiveTraceHeaders: vi.fn((headers: Headers) => {
    headers.set('traceparent', '00-trace-parent');
  }),
  publishJSON: vi.fn(),
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
  qstashClient: {
    publishJSON: mocks.publishJSON,
  },
  workflowClient: {
    trigger: mocks.trigger,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.trigger.mockResolvedValue({ workflowRunId: 'workflow-1' });
  mocks.publishJSON.mockResolvedValue({ messageId: 'message-1' });
});

describe('AgentSignalNightlyReviewWorkflow cron entry', () => {
  const payload = {
    pageSize: 50,
    requestedAt: '2026-05-03T18:30:00.000Z',
    targetLimit: 20,
  };

  it('publishes the cron entry through the qstash client', async () => {
    /**
     * @example
     * expect(publishJSON).toHaveBeenCalledWith(expect.objectContaining({ flowControl }));
     */
    await expect(
      AgentSignalNightlyReviewWorkflow.publishPaginateUsersEntry(payload),
    ).resolves.toEqual({ messageId: 'message-1' });

    expect(mocks.publishJSON).toHaveBeenCalledWith({
      body: payload,
      flowControl: {
        key: 'agent-signal.nightly-review.paginate-users',
        parallelism: 1,
      },
      headers: { traceparent: '00-trace-parent' },
      url: 'https://internal.example.com/api/workflows/agent-signal/paginate-nightly-review-users',
    });
  });

  it('fails fast instead of hanging when the outbound publish stalls', async () => {
    /**
     * Regression: a stalled publish used to keep the handler open until Cloudflare returned 524,
     * which left no error anywhere and silently killed nightly review for months.
     *
     * @example
     * await expect(publishPaginateUsersEntry(payload)).rejects.toThrow('timed out');
     */
    vi.useFakeTimers();
    mocks.publishJSON.mockReturnValue(new Promise(() => {}));

    try {
      const assertion = expect(
        AgentSignalNightlyReviewWorkflow.publishPaginateUsersEntry(payload),
      ).rejects.toThrow('nightly review cron publish timed out after 10000ms');

      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a late failure on the abandoned publish from going unhandled', async () => {
    /**
     * `Promise.race` cannot cancel the publish, so the orphan needs its own rejection handler.
     *
     * @example
     * expect(unhandled).not.toHaveBeenCalled();
     */
    vi.useFakeTimers();

    let rejectPublish: ((error: Error) => void) | undefined;
    mocks.publishJSON.mockReturnValue(
      new Promise((_, reject) => {
        rejectPublish = reject;
      }),
    );

    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    try {
      const assertion = expect(
        AgentSignalNightlyReviewWorkflow.publishPaginateUsersEntry(payload),
      ).rejects.toThrow('timed out');

      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;

      rejectPublish?.(new Error('late qstash failure'));
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      vi.useRealTimers();
    }
  });
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
