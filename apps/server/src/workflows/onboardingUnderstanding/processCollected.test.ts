// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { serializeStepResult } from '@/server/workflows/testing/stepContext';

import { failRunningUnderstandingWriting, processCollectedUnderstanding } from './processCollected';

const errors = vi.hoisted(() => {
  class DomainError extends Error {}
  return { DomainError };
});

vi.mock('@lobechat/database', () => ({
  StaleUnderstandingRevisionError: errors.DomainError,
  StaleUnderstandingSessionError: errors.DomainError,
  UnderstandingResourceNotFoundError: errors.DomainError,
  UnderstandingSessionNotFoundError: errors.DomainError,
}));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));
vi.mock('@/server/services/understanding/service', () => ({
  createUnderstandingService: vi.fn(),
}));

const payload = {
  responseLanguage: 'zh-CN',
  sessionId: 'session-1',
  sourceFingerprint: 'github@1',
  topicId: 'topic-1',
  userId: 'user-1',
};

const createContext = () => {
  const steps: string[] = [];
  return {
    context: {
      requestPayload: payload,
      run: async <T>(stepName: string, action: () => Promise<T>) => {
        steps.push(stepName);
        return serializeStepResult(await action());
      },
    },
    steps,
  };
};

describe('processCollectedUnderstanding', () => {
  it('uses one idempotent durable operation with the expected fingerprint', async () => {
    const service = {
      processCollected: vi.fn(async () => ({
        feedbackRevision: 0,
        generationRevision: 1,
        personaVersion: 3,
        published: true,
        resultId: 'message-1',
        sourceFingerprint: 'github@1',
      })),
    };
    const { context, steps } = createContext();
    await expect(
      processCollectedUnderstanding(context as never, {
        createService: async () => service as never,
      }),
    ).resolves.toMatchObject({ published: true, resultId: 'message-1' });
    expect(steps).toEqual(['collected:process']);
    expect(service.processCollected).toHaveBeenCalledWith({
      expectedSourceFingerprint: 'github@1',
      responseLanguage: 'zh-CN',
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
  });

  it('starts the full persona workflow only after the quick proposal is published', async () => {
    const triggerDetailedPersona = vi.fn(
      async (_input: unknown, _options: { workflowRunId: string }) => ({
        workflowRunId: 'detailed-1',
      }),
    );
    const service = {
      processCollected: vi.fn(async () => ({
        feedbackRevision: 0,
        generationRevision: 2,
        published: true,
        resultId: 'message-1',
        sourceFingerprint: 'github@1',
      })),
    };
    const { context, steps } = createContext();

    await processCollectedUnderstanding(context as never, {
      createService: async () => service as never,
      triggerDetailedPersona,
    });

    expect(steps).toEqual(['collected:process', 'collected:trigger-detailed-persona']);
    expect(triggerDetailedPersona).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({
        workflowRunId: expect.stringMatching(/^onboarding-understanding-detailed-/),
      }),
    );
  });

  it('uses a distinct detailed workflow id for each generated proposal revision', async () => {
    const triggerDetailedPersona = vi.fn(
      async (_input: unknown, _options: { workflowRunId: string }) => ({
        workflowRunId: 'detailed-1',
      }),
    );
    const service = {
      processCollected: vi
        .fn()
        .mockResolvedValueOnce({
          feedbackRevision: 0,
          generationRevision: 1,
          published: true,
          resultId: 'message-1',
          sourceFingerprint: 'github@1',
        })
        .mockResolvedValueOnce({
          feedbackRevision: 1,
          generationRevision: 2,
          published: true,
          resultId: 'message-2',
          sourceFingerprint: 'github@1',
        }),
    };

    await processCollectedUnderstanding(createContext().context as never, {
      createService: async () => service as never,
      triggerDetailedPersona,
    });
    await processCollectedUnderstanding(createContext().context as never, {
      createService: async () => service as never,
      triggerDetailedPersona,
    });

    expect(triggerDetailedPersona).toHaveBeenCalledTimes(2);
    expect(triggerDetailedPersona.mock.calls.at(0)?.[1].workflowRunId).not.toBe(
      triggerDetailedPersona.mock.calls.at(1)?.[1].workflowRunId,
    );
  });

  it('replays commit-before-ack without adding workflow state and lets transient errors retry', async () => {
    const result = {
      feedbackRevision: 0,
      generationRevision: 1,
      published: true,
      resultId: 'message-1',
      sourceFingerprint: 'github@1',
    };
    const service = { processCollected: vi.fn(async () => result) };
    const dependencies = {
      createService: async () => service as never,
    };

    await processCollectedUnderstanding(createContext().context as never, dependencies);
    await processCollectedUnderstanding(createContext().context as never, dependencies);
    expect(service.processCollected).toHaveBeenCalledTimes(2);

    const transient = new Error('writer unavailable');
    service.processCollected.mockRejectedValueOnce(transient);
    await expect(
      processCollectedUnderstanding(createContext().context as never, dependencies),
    ).rejects.toBe(transient);
  });
});

describe('failRunningUnderstandingWriting', () => {
  it('terminalizes the payload fingerprint even when failure happens before preparation', async () => {
    const service = {
      failWriting: vi.fn(async () => ({ writing: { sourceFingerprint: 'github@1' } })),
    };

    await expect(
      failRunningUnderstandingWriting(payload, { createService: async () => service as never }),
    ).resolves.toEqual({ failed: true, sourceFingerprint: 'github@1' });
    expect(service.failWriting).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sourceFingerprint: 'github@1',
      topicId: 'topic-1',
    });
    expect(service).not.toHaveProperty('get');
  });

  it('treats stale fingerprint and reset races as safe no-ops', async () => {
    const stale = {
      failDetailedPersona: vi.fn(async () => undefined),
      failWriting: vi.fn(async () => undefined),
    };
    await expect(
      failRunningUnderstandingWriting(payload, { createService: async () => stale as never }),
    ).resolves.toEqual({ failed: false });

    const reset = {
      failDetailedPersona: vi.fn(async () => undefined),
      failWriting: vi.fn(async () => {
        throw new errors.DomainError();
      }),
    };
    await expect(
      failRunningUnderstandingWriting(payload, { createService: async () => reset as never }),
    ).resolves.toEqual({ failed: false });
  });
});
