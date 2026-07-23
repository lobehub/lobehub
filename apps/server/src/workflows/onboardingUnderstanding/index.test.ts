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

  it('triggers provider processing without serializing parallel provider branches', async () => {
    const { OnboardingUnderstandingWorkflow } = await import('.');
    const payload = {
      providers: [{ id: 'github', revision: 1 }],
      sessionId: 'session:1',
      topicId: 'topic-1',
      userId: 'user-1',
    };

    await OnboardingUnderstandingWorkflow.triggerProviders(payload);

    expect(triggerMock).toHaveBeenCalledWith({
      body: payload,
      headers: { traceparent: 'trace-1' },
      url: 'http://internal:3011/api/workflows/onboarding/understanding/process-providers',
    });
  });

  it('allows an explicit deterministic workflow run id for initial and retry triggers', async () => {
    const { OnboardingUnderstandingWorkflow } = await import('.');

    await OnboardingUnderstandingWorkflow.triggerProviders(
      {
        providers: [
          { id: 'gmail', revision: 1 },
          { id: 'github', revision: 1 },
        ],
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

  /**
   * @example
   * expect(trigger.url).toContain('process-collected');
   */
  it('triggers a direct rewrite for feedback-only revisions', async () => {
    const { OnboardingUnderstandingWorkflow } = await import('.');
    const payload = {
      sessionId: 'session-1',
      sourceFingerprint: 'github@1',
      topicId: 'topic-1',
      userId: 'user-1',
    };

    await OnboardingUnderstandingWorkflow.triggerWriting(payload, {
      workflowRunId: 'feedback-session-1-revision-2',
    });

    expect(triggerMock).toHaveBeenCalledWith({
      body: payload,
      headers: { traceparent: 'trace-1' },
      url: 'http://internal:3011/api/workflows/onboarding/understanding/process-collected',
      workflowRunId: 'feedback-session-1-revision-2',
    });
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
        providers: [{ id: 'github', revision: 1 }],
        sessionId: 'session-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(UnderstandingWorkflowUnavailableError);
    expect(triggerMock).not.toHaveBeenCalled();
  });
});
