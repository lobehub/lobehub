// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const triggerMock = vi.fn();
const appEnv = {
  APP_URL: 'http://localhost:3011',
  INTERNAL_APP_URL: 'http://internal:3011',
};

vi.mock('@/envs/app', () => ({ appEnv }));
vi.mock('@/libs/observability/traceparent', () => ({
  injectActiveTraceHeaders: (headers: Headers) => headers.set('traceparent', 'trace-1'),
}));
vi.mock('@/libs/qstash', () => ({ workflowClient: { trigger: triggerMock } }));

describe('OnboardingUnderstandingWorkflow', () => {
  const originalToken = process.env.QSTASH_TOKEN;

  beforeEach(() => {
    process.env.QSTASH_TOKEN = 'qstash-test';
    appEnv.APP_URL = 'http://localhost:3011';
    appEnv.INTERNAL_APP_URL = 'http://internal:3011';
    triggerMock.mockReset();
    triggerMock.mockResolvedValue({ workflowRunId: 'workflow-result' });
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.QSTASH_TOKEN;
    else process.env.QSTASH_TOKEN = originalToken;
  });

  it('triggers provider processing with a safe payload, trace headers, and session flow control', async () => {
    const { OnboardingUnderstandingWorkflow } = await import('.');
    const payload = {
      providerIds: ['github'],
      sessionId: 'session:1',
      topicId: 'topic-1',
      userId: 'user-1',
    };

    await OnboardingUnderstandingWorkflow.triggerProviders(payload);

    expect(triggerMock).toHaveBeenCalledWith({
      body: payload,
      flowControl: {
        key: 'onboarding-understanding.providers.session_1',
        parallelism: 1,
      },
      headers: { traceparent: 'trace-1' },
      url: 'http://internal:3011/api/workflows/onboarding-understanding/process-providers',
    });
  });

  it('allows an explicit deterministic workflow run id for initial and retry triggers', async () => {
    const { OnboardingUnderstandingWorkflow } = await import('.');

    await OnboardingUnderstandingWorkflow.triggerProviders(
      {
        providerIds: ['gmail', 'github'],
        sessionId: 'session-1',
        topicId: 'topic-1',
        userId: 'user-1',
      },
      { workflowRunId: 'initial-session-1' },
    );

    expect(triggerMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowRunId: 'initial-session-1' }),
    );
  });

  it('rejects triggering when workflow configuration is unavailable', async () => {
    delete process.env.QSTASH_TOKEN;
    const { OnboardingUnderstandingWorkflow, UnderstandingWorkflowUnavailableError } =
      await import('.');

    expect(() => OnboardingUnderstandingWorkflow.assertAvailable()).toThrow(
      UnderstandingWorkflowUnavailableError,
    );
    await expect(
      OnboardingUnderstandingWorkflow.triggerProviders({
        providerIds: ['github'],
        sessionId: 'session-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(UnderstandingWorkflowUnavailableError);
    expect(triggerMock).not.toHaveBeenCalled();
  });
});
