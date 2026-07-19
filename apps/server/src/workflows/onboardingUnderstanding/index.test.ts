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

  it('triggers the session-scoped workflow with an explicit run id', async () => {
    const { OnboardingUnderstandingWorkflow } = await import('.');
    const payload = {
      mode: 'initial' as const,
      sessionId: 'session:1',
      topicId: 'topic-1',
      userId: 'user-1',
    };

    await OnboardingUnderstandingWorkflow.trigger(payload, { workflowRunId: 'workflow-1' });

    expect(triggerMock).toHaveBeenCalledWith({
      body: payload,
      flowControl: {
        key: 'onboarding-understanding.session.session_1',
        parallelism: 1,
      },
      headers: { traceparent: 'trace-1' },
      url: 'http://internal:3011/api/workflows/onboarding-understanding',
      workflowRunId: 'workflow-1',
    });
  });

  it('rejects triggering when QStash is unavailable', async () => {
    delete process.env.QSTASH_TOKEN;
    const { OnboardingUnderstandingWorkflow, UnderstandingWorkflowUnavailableError } =
      await import('.');

    await expect(
      OnboardingUnderstandingWorkflow.trigger({
        mode: 'initial',
        sessionId: 'session-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(UnderstandingWorkflowUnavailableError);
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it('can check availability before session initialization', async () => {
    delete process.env.QSTASH_TOKEN;
    const { OnboardingUnderstandingWorkflow, UnderstandingWorkflowUnavailableError } =
      await import('.');

    expect(() => OnboardingUnderstandingWorkflow.assertAvailable()).toThrow(
      UnderstandingWorkflowUnavailableError,
    );
  });

  it('rejects triggering when the application URL is unavailable', async () => {
    appEnv.APP_URL = '';
    appEnv.INTERNAL_APP_URL = '';
    const { OnboardingUnderstandingWorkflow, UnderstandingWorkflowUnavailableError } =
      await import('.');

    await expect(
      OnboardingUnderstandingWorkflow.trigger({
        mode: 'initial',
        sessionId: 'session-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(UnderstandingWorkflowUnavailableError);
    expect(triggerMock).not.toHaveBeenCalled();
  });
});
