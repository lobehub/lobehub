// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '.';

const { runWorkflowMock, serveMock } = vi.hoisted(() => ({
  runWorkflowMock: vi.fn(),
  serveMock: vi.fn(),
}));

vi.mock('@lobechat/observability-otel/modules/upstash-workflow', () => ({
  withOtelMetricsForUpstashWorkflows: (handler: unknown) => handler,
}));
vi.mock('@upstash/workflow/hono', () => ({ serve: serveMock }));
vi.mock('@/server/workflows/onboardingUnderstanding/run', () => ({
  createOnboardingUnderstandingWorkflowOptions: (sessionId: string) => ({
    flowControl: {
      key: `onboarding-understanding.session.${sessionId.replaceAll(/[^\w.-]/g, '_')}`,
      parallelism: 1,
    },
  }),
  runOnboardingUnderstandingWorkflow: runWorkflowMock,
}));
vi.mock('../qstashClient', () => ({ createWorkflowQstashClient: vi.fn(() => ({})) }));

describe('onboarding understanding workflow route', () => {
  beforeEach(() => {
    runWorkflowMock.mockReset();
    serveMock.mockReset();
    serveMock.mockImplementation(
      (_handler, options) => async (context: any) => context.json(options.flowControl),
    );
  });

  it('uses the decoded route session for continuation flow control', async () => {
    const response = await app.request('/session%3A1', { method: 'POST' });

    await expect(response.json()).resolves.toEqual({
      key: 'onboarding-understanding.session.session_1',
      parallelism: 1,
    });
    expect(serveMock).toHaveBeenCalledOnce();
  });

  it('does not decode percent characters in the session twice', async () => {
    const response = await app.request('/session%252F1', { method: 'POST' });

    await expect(response.json()).resolves.toEqual({
      key: 'onboarding-understanding.session.session_2F1',
      parallelism: 1,
    });
  });

  it('rejects a payload whose session does not match the route', async () => {
    serveMock.mockImplementation((handler) => async (context: any) => {
      try {
        await handler({
          requestPayload: {
            mode: 'initial',
            sessionId: 'session-2',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        });
        return context.json({ accepted: true });
      } catch (error) {
        return context.json({ error: (error as Error).message }, 400);
      }
    });

    const response = await app.request('/session-1', { method: 'POST' });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Onboarding understanding workflow session does not match its route',
    });
    expect(runWorkflowMock).not.toHaveBeenCalled();
  });
});
