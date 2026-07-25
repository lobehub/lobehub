import { describe, expect, it } from 'vitest';

import type {
  OnboardingUnderstandingSession,
  OnboardingUnderstandingSessionStatus,
  UnderstandingProviderState,
} from './understanding';
import {
  OnboardingUnderstandingMessageMetadataSchema,
  OnboardingUnderstandingSessionSchema,
  projectOnboardingUnderstandingSessionStatus,
} from './understanding';

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

describe('onboarding Understanding revision schemas', () => {
  /**
   * @example
   * expect(session.success).toBe(true);
   */
  it('accepts cumulative feedback and the current generation revision', () => {
    const session = OnboardingUnderstandingSessionSchema.safeParse({
      feedback: {
        revision: 2,
        turns: [
          {
            content: 'Focus on my open-source infrastructure work.',
            createdAt: '2026-07-24T00:00:00.000Z',
            revision: 1,
          },
          {
            content: 'Do not treat newsletters as durable interests.',
            createdAt: '2026-07-24T00:01:00.000Z',
            revision: 2,
          },
        ],
      },
      generationRevision: 3,
      id: 'session',
      sources: { github: completedProvider },
      writing: {
        feedbackRevision: 2,
        generationRevision: 3,
        resultMessageId: 'message',
        sourceFingerprint: 'github@1',
        status: 'completed',
        updatedAt: '2026-07-24T00:02:00.000Z',
      },
    });

    expect(session.success).toBe(true);
  });

  /**
   * @example
   * expect(proposal.success).toBe(true);
   */
  it('binds a proposal to the feedback and generation revisions that produced it', () => {
    const proposal = OnboardingUnderstandingMessageMetadataSchema.safeParse({
      analysis: {
        composition: {
          identities: [],
          interests: [],
          lifeStyle: [],
          social: [],
          working: [],
        },
        personaProposal: {
          content: 'You build open-source infrastructure.',
          reasoning: 'Your direct feedback clarifies the connected evidence.',
          tagline: 'Open-source infrastructure builder',
        },
        profile: {
          description: 'Builds open-source infrastructure.',
          domains: ['open source'],
          name: 'Neko',
          pronoun: 'non-specific',
          roles: ['engineer'],
          summary: 'Open-source infrastructure engineer.',
          tagline: 'Open-source infrastructure builder',
        },
      },
      diagnostics: {
        errors: [],
        evidenceCount: 1,
        failedCount: 0,
        succeededCount: 1,
      },
      feedbackRevision: 2,
      generationRevision: 3,
      kind: 'proposal',
      providers: ['github'],
      resultId: 'message',
      sourceFingerprint: 'github@1',
    });

    expect(proposal.success).toBe(true);
  });
});
