// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

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
        return action();
      },
    },
    steps,
  };
};

describe('processCollectedUnderstanding', () => {
  it('uses one idempotent durable operation with the expected fingerprint', async () => {
    const service = {
      processCollected: vi.fn(async () => ({
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
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
  });

  it('replays commit-before-ack without adding workflow state and lets transient errors retry', async () => {
    const result = { published: true, resultId: 'message-1', sourceFingerprint: 'github@1' };
    const service = { processCollected: vi.fn(async () => result) };
    const dependencies = { createService: async () => service as never };

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
    const stale = { failWriting: vi.fn(async () => undefined) };
    await expect(
      failRunningUnderstandingWriting(payload, { createService: async () => stale as never }),
    ).resolves.toEqual({ failed: false });

    const reset = {
      failWriting: vi.fn(async () => {
        throw new errors.DomainError();
      }),
    };
    await expect(
      failRunningUnderstandingWriting(payload, { createService: async () => reset as never }),
    ).resolves.toEqual({ failed: false });
  });
});
