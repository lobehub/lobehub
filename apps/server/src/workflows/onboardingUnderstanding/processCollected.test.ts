// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { failRunningUnderstandingWriting, processCollectedUnderstanding } from './processCollected';

const errors = vi.hoisted(() => {
  class DomainError extends Error {}
  class ContextUnavailableError extends Error {}
  class ResourceNotFoundError extends Error {}
  return { ContextUnavailableError, DomainError, ResourceNotFoundError };
});

vi.mock('@lobechat/database', () => ({
  StaleUnderstandingRevisionError: errors.DomainError,
  StaleUnderstandingSessionError: errors.DomainError,
  UnderstandingResourceNotFoundError: errors.ResourceNotFoundError,
  UnderstandingSessionNotFoundError: errors.DomainError,
}));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));
vi.mock('@/server/services/understanding/service', () => ({
  createUnderstandingService: vi.fn(),
  UnderstandingProviderContextUnavailableError: errors.ContextUnavailableError,
}));

const payload = { sessionId: 'session-1', topicId: 'topic-1', userId: 'user-1' };

const createContext = (requestPayload: unknown) => {
  const steps: string[] = [];
  return {
    requestPayload,
    run: async <T>(stepName: string, action: () => Promise<T>) => {
      steps.push(stepName);
      return action();
    },
    steps,
  };
};

describe('processCollectedUnderstanding', () => {
  it('durably claims then writes the current provider fingerprint', async () => {
    const service = {
      claimWriting: vi.fn(async () => ({
        claimed: true,
        sourceFingerprint: 'fingerprint-1',
        threadId: 'thread-1',
      })),
      writeCollected: vi.fn(async () => ({
        personaVersion: 3,
        published: true,
        resultId: 'message-1',
        sourceFingerprint: 'fingerprint-1',
      })),
    };
    const context = createContext(payload);

    await expect(
      processCollectedUnderstanding(context as never, {
        createService: async () => service as never,
      }),
    ).resolves.toEqual({
      personaVersion: 3,
      published: true,
      resultId: 'message-1',
      sourceFingerprint: 'fingerprint-1',
    });
    expect(context.steps).toEqual(['collected:claim', 'collected:write']);
    expect(service.writeCollected).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sourceFingerprint: 'fingerprint-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });
  });

  it('does not write when the fingerprint was already claimed', async () => {
    const service = {
      claimWriting: vi.fn(async () => ({
        claimed: false,
        sourceFingerprint: 'fingerprint-1',
        threadId: 'thread-1',
      })),
      writeCollected: vi.fn(),
    };

    await expect(
      processCollectedUnderstanding(createContext(payload) as never, {
        createService: async () => service as never,
      }),
    ).resolves.toEqual({ published: false, sourceFingerprint: 'fingerprint-1' });
    expect(service.writeCollected).not.toHaveBeenCalled();
  });

  it('treats stale or unavailable collected state as a safe no-op', async () => {
    const service = {
      claimWriting: vi.fn(async () => {
        throw new errors.ContextUnavailableError();
      }),
      writeCollected: vi.fn(),
    };

    await expect(
      processCollectedUnderstanding(createContext(payload) as never, {
        createService: async () => service as never,
      }),
    ).resolves.toEqual({ published: false });
  });

  it('lets transient writer failures escape without leaking their message into output', async () => {
    const transient = new Error('secret token in upstream failure');
    const service = {
      claimWriting: vi.fn(async () => ({
        claimed: true,
        sourceFingerprint: 'fingerprint-1',
        threadId: 'thread-1',
      })),
      writeCollected: vi.fn(async () => {
        throw transient;
      }),
    };

    await expect(
      processCollectedUnderstanding(createContext(payload) as never, {
        createService: async () => service as never,
      }),
    ).rejects.toBe(transient);
  });

  it('retries when claimed provider context has expired before writing', async () => {
    const unavailable = new errors.ContextUnavailableError();
    const service = {
      claimWriting: vi.fn(async () => ({
        claimed: true,
        sourceFingerprint: 'fingerprint-1',
        threadId: 'thread-1',
      })),
      writeCollected: vi.fn(async () => {
        throw unavailable;
      }),
    };

    await expect(
      processCollectedUnderstanding(createContext(payload) as never, {
        createService: async () => service as never,
      }),
    ).rejects.toBe(unavailable);
  });
});

describe('failRunningUnderstandingWriting', () => {
  it('fails only the current running fingerprint and preserves completed or absent writing', async () => {
    const service = {
      failWriting: vi.fn(async () => ({})),
      get: vi.fn(async () => ({
        id: 'session-1',
        sources: {},
        status: 'processing',
        writing: { sourceFingerprint: 'fingerprint-2', status: 'running' },
      })),
    };

    await expect(
      failRunningUnderstandingWriting(payload, { createService: async () => service as never }),
    ).resolves.toEqual({ failed: true, sourceFingerprint: 'fingerprint-2' });
    expect(service.failWriting).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sourceFingerprint: 'fingerprint-2',
      topicId: 'topic-1',
    });

    service.get.mockResolvedValueOnce({
      id: 'session-1',
      sources: {},
      status: 'completed',
      writing: { sourceFingerprint: 'fingerprint-2', status: 'completed' },
    });
    await expect(
      failRunningUnderstandingWriting(payload, { createService: async () => service as never }),
    ).resolves.toEqual({ failed: false });
    expect(service.failWriting).toHaveBeenCalledOnce();
  });

  it('leaves writing from a newer session untouched', async () => {
    const service = {
      failWriting: vi.fn(),
      get: vi.fn(async () => ({
        id: 'session-new',
        sources: {},
        status: 'processing',
        writing: { sourceFingerprint: 'fingerprint-new', status: 'running' },
      })),
    };

    await expect(
      failRunningUnderstandingWriting(payload, { createService: async () => service as never }),
    ).resolves.toEqual({ failed: false });
    expect(service.failWriting).not.toHaveBeenCalled();
  });

  it('treats a reset or deleted onboarding topic as an already-terminal no-op', async () => {
    const service = {
      failWriting: vi.fn(),
      get: vi.fn(async () => {
        throw new errors.ResourceNotFoundError();
      }),
    };

    await expect(
      failRunningUnderstandingWriting(payload, { createService: async () => service as never }),
    ).resolves.toEqual({ failed: false });
    expect(service.failWriting).not.toHaveBeenCalled();
  });

  it('treats a reset racing after polling as an already-terminal no-op', async () => {
    const service = {
      failWriting: vi.fn(async () => {
        throw new errors.ResourceNotFoundError();
      }),
      get: vi.fn(async () => ({
        id: 'session-1',
        sources: {},
        status: 'processing',
        writing: { sourceFingerprint: 'fingerprint-2', status: 'running' },
      })),
    };

    await expect(
      failRunningUnderstandingWriting(payload, { createService: async () => service as never }),
    ).resolves.toEqual({ failed: false });
  });
});
