import { describe, expect, it } from 'vitest';

import type {
  OnboardingUnderstandingSession,
  OnboardingUnderstandingSessionStatus,
  UnderstandingProviderState,
} from './understanding';
import { projectOnboardingUnderstandingSessionStatus } from './understanding';

const completedProvider: UnderstandingProviderState = {
  errors: [],
  failedCount: 0,
  revision: 1,
  status: 'completed',
  succeededCount: 2,
};

const collectionError = {
  code: 'COLLECTION_FAILED',
  message: 'Provider unavailable',
  operation: 'collection',
  provider: 'github',
  retryable: true,
};

const failedProvider: UnderstandingProviderState = {
  errors: [collectionError],
  failedCount: 1,
  revision: 1,
  status: 'failed',
  succeededCount: 0,
};

const cases: Array<[string, OnboardingUnderstandingSession, OnboardingUnderstandingSessionStatus]> =
  [
    ['no providers', { id: 'session', sources: {} }, 'pending'],
    [
      'a provider is running',
      {
        id: 'session',
        sources: { github: { ...completedProvider, status: 'running' } },
      },
      'processing',
    ],
    [
      'collection finished before writing',
      { id: 'session', sources: { github: completedProvider } },
      'processing',
    ],
    [
      'writing completed',
      {
        id: 'session',
        sources: { github: completedProvider },
        writing: {
          resultMessageId: 'message',
          sourceFingerprint: 'github@1',
          status: 'completed',
          updatedAt: '2026-07-20T08:10:00.000Z',
        },
      },
      'completed',
    ],
    [
      'one provider failed after a proposal was written',
      {
        id: 'session',
        sources: { github: completedProvider, gmail: failedProvider },
        writing: {
          resultMessageId: 'message',
          sourceFingerprint: 'github@1,gmail@1',
          status: 'completed',
          updatedAt: '2026-07-20T08:10:00.000Z',
        },
      },
      'partial',
    ],
    ['all providers failed', { id: 'session', sources: { github: failedProvider } }, 'failed'],
    [
      'writing failed without a retained proposal',
      {
        id: 'session',
        sources: { github: completedProvider },
        writing: {
          error: collectionError,
          sourceFingerprint: 'github@1',
          status: 'failed',
          updatedAt: '2026-07-20T08:10:00.000Z',
        },
      },
      'failed',
    ],
    [
      'writing failed with a retained proposal',
      {
        id: 'session',
        sources: { github: completedProvider, gmail: failedProvider },
        writing: {
          error: collectionError,
          resultMessageId: 'older-message',
          sourceFingerprint: 'github@1,gmail@1',
          status: 'failed',
          updatedAt: '2026-07-20T08:10:00.000Z',
        },
      },
      'partial',
    ],
  ];

describe('projectOnboardingUnderstandingSessionStatus', () => {
  it.each(cases)('projects %s', (_, session, expected) => {
    expect(projectOnboardingUnderstandingSessionStatus(session)).toBe(expected);
  });
});
