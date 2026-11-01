// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { serializeStepResult } from '@/server/workflows/testing/stepContext';

import {
  failRunningDetailedUnderstandingPersona,
  processDetailedUnderstandingPersona,
} from './processDetailedPersona';

const telemetry = vi.hoisted(() => ({
  recordSessionDuration: vi.fn(),
}));

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
vi.mock('@lobechat/observability-otel/modules/onboarding-understanding', () => ({
  observeOnboardingUnderstandingOperation: async <Result>(
    _attributes: unknown,
    operation: () => Promise<Result>,
  ) => operation(),
  recordOnboardingUnderstandingEndToEndDuration: telemetry.recordSessionDuration,
}));

const payload = {
  responseLanguage: 'zh-CN',
  sessionId: 'session-1',
  sourceFingerprint: 'github@1',
  startedAt: 1000,
  topicId: 'topic-1',
  userId: 'user-1',
};

describe('processDetailedUnderstandingPersona', () => {
  /** @example expect(result.published).toBe(true); */
  it('runs the detailed writer as one durable operation', async () => {
    const processDetailedPersona = vi.fn(async () => ({
      published: true,
      sourceFingerprint: 'github@1',
    }));
    const steps: string[] = [];
    const context = {
      requestPayload: payload,
      run: async <T>(stepName: string, action: () => Promise<T>) => {
        steps.push(stepName);
        return serializeStepResult(await action());
      },
    };

    await expect(
      processDetailedUnderstandingPersona(context, {
        createService: async () => ({ processDetailedPersona }) as never,
      }),
    ).resolves.toEqual({ published: true, sourceFingerprint: 'github@1' });
    expect(steps).toEqual(['detailed-persona:process']);
    /** @example expect(recordSessionDuration).toHaveBeenCalledWith(startedAt); */
    expect(telemetry.recordSessionDuration).toHaveBeenCalledWith(1000);
  });
});

describe('failRunningDetailedUnderstandingPersona', () => {
  /** @example expect(result.failed).toBe(true); */
  it('terminalizes only the detailed pass for the current fingerprint', async () => {
    const failDetailedPersona = vi.fn(async () => ({
      writing: { detailed: { status: 'failed' } },
    }));

    await expect(
      failRunningDetailedUnderstandingPersona(payload, {
        createService: async () => ({ failDetailedPersona }) as never,
      }),
    ).resolves.toEqual({ failed: true });
    expect(failDetailedPersona).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sourceFingerprint: 'github@1',
      topicId: 'topic-1',
    });
  });
});
