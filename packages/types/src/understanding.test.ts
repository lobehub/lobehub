import { describe, expect, expectTypeOf, it } from 'vitest';

import { threadMetadataSchema } from './topic/thread';
import type {
  CollectionDiagnostics,
  ConfirmOnboardingUnderstandingInput,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingPollingResult,
  OnboardingUnderstandingSession,
  RetryOnboardingUnderstandingProviderInput,
  UnderstandingAnalysis,
  UnderstandingProviderState,
  UnderstandingWritingState,
} from './understanding';
import {
  MAX_COLLECTION_ERRORS,
  OnboardingUnderstandingMessageMetadataSchema,
  OnboardingUnderstandingSessionSchema,
  OnboardingUnderstandingThreadMarkerSchema,
  projectOnboardingUnderstandingSessionStatus,
} from './understanding';

type KnownForbiddenDurableKey =
  | 'accessToken'
  | 'apiKey'
  | 'authorization'
  | 'credential'
  | 'credentials'
  | 'externalAccountId'
  | 'inputThreadIds'
  | 'operationId'
  | 'rawContent'
  | 'refreshToken'
  | 'schemaVersion'
  | 'secret'
  | 'token';

type DurableKeys<Value> = Value extends readonly (infer Item)[]
  ? DurableKeys<Item>
  : Value extends object
    ? keyof Value | { [Key in keyof Value]: DurableKeys<Value[Key]> }[keyof Value]
    : never;

type HasNoForbiddenKeys<Value> =
  Extract<DurableKeys<Value>, KnownForbiddenDurableKey> extends never ? true : false;

const error = {
  code: 'COLLECTION_FAILED',
  message: 'GitHub was unavailable',
  operation: 'collection',
  provider: 'github',
  retryable: true,
};

const providerState: UnderstandingProviderState = {
  errors: [],
  failedCount: 0,
  revision: 1,
  status: 'completed',
  succeededCount: 2,
};

const analysis: UnderstandingAnalysis = {
  composition: { identities: [], interests: [], lifeStyle: [], social: [], working: [] },
  personaProposal: {
    content: 'You build developer tools.',
    reasoning: 'Repeated evidence.',
    tagline: 'Builder',
  },
  profile: {
    description: 'Builds developer tools.',
    domains: ['developer tools'],
    name: 'Neko',
    pronoun: 'non-specific',
    roles: ['engineer'],
    summary: 'Developer-tools engineer.',
    tagline: 'Builder',
  },
};

const proposal: OnboardingUnderstandingMessageMetadata = {
  analysis,
  diagnostics: { errors: [], evidenceCount: 2, failedCount: 0, succeededCount: 2 },
  kind: 'proposal',
  providers: ['github'],
  resultId: 'result',
  sourceFingerprint: 'fingerprint',
};

describe('Understanding durable contracts', () => {
  it('stores only the writing marker on Understanding threads', () => {
    const marker = { kind: 'writing' as const };
    expect(OnboardingUnderstandingThreadMarkerSchema.parse(marker)).toEqual(marker);
    expect(
      threadMetadataSchema.parse({ onboardingUnderstanding: marker }).onboardingUnderstanding,
    ).toEqual(marker);

    expect(OnboardingUnderstandingThreadMarkerSchema.safeParse({ kind: 'source' }).success).toBe(
      false,
    );
    expect(OnboardingUnderstandingThreadMarkerSchema.safeParse({ kind: 'merged' }).success).toBe(
      false,
    );
    expect(
      OnboardingUnderstandingThreadMarkerSchema.safeParse({ kind: 'writing', operationId: 'op' })
        .success,
    ).toBe(false);
  });

  it('excludes credentials, raw context, external account IDs, operation IDs, and schema versions', () => {
    const contractAssertions: [
      HasNoForbiddenKeys<CollectionDiagnostics>,
      HasNoForbiddenKeys<UnderstandingAnalysis>,
      HasNoForbiddenKeys<OnboardingUnderstandingMessageMetadata>,
      HasNoForbiddenKeys<UnderstandingProviderState>,
      HasNoForbiddenKeys<UnderstandingWritingState>,
      HasNoForbiddenKeys<OnboardingUnderstandingSession>,
      HasNoForbiddenKeys<OnboardingUnderstandingPollingResult>,
    ] = [true, true, true, true, true, true, true];

    expect(contractAssertions.every(Boolean)).toBe(true);
  });

  it('accepts strict provider and writing state without a duplicated session status', () => {
    expect(
      OnboardingUnderstandingSessionSchema.parse({
        confirmedAt: '2026-07-20T08:30:00.000Z',
        id: 'session',
        sources: {
          github: { ...providerState, completedAt: '2026-07-20T08:00:00.000Z' },
          linear: {
            errors: [error],
            failedCount: 1,
            revision: 2,
            status: 'failed',
            succeededCount: 0,
          },
        },
        writing: {
          resultMessageId: 'message',
          sourceFingerprint: 'fingerprint',
          status: 'completed',
          updatedAt: '2026-07-20T08:10:00.000Z',
        },
      }),
    ).toBeDefined();

    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        id: 'session',
        sources: {},
        status: 'completed',
      }).success,
    ).toBe(false);
  });

  it('bounds provider errors and rejects runtime or source identity fields', () => {
    const session = { id: 'session', sources: { github: providerState } };

    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        sources: {
          github: {
            ...providerState,
            errors: Array.from({ length: MAX_COLLECTION_ERRORS + 1 }, () => error),
          },
        },
      }).success,
    ).toBe(false);

    for (const [field, value] of [
      ['externalAccountId', 'account'],
      ['operationId', 'operation'],
      ['rawContent', 'private context'],
      ['schemaVersion', 1],
      ['inputThreadIds', ['thread']],
    ] as const) {
      expect(
        OnboardingUnderstandingSessionSchema.safeParse({ ...session, [field]: value }).success,
        field,
      ).toBe(false);
    }

    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        sources: { github: { ...providerState, operationId: 'operation' } },
      }).success,
    ).toBe(false);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        writing: {
          inputThreadIds: ['thread'],
          sourceFingerprint: 'fingerprint',
          status: 'running',
          updatedAt: '2026-07-20T08:10:00.000Z',
        },
      }).success,
    ).toBe(false);
  });

  it('accepts only strict proposal metadata', () => {
    expect(OnboardingUnderstandingMessageMetadataSchema.parse(proposal)).toEqual(proposal);

    for (const legacyKind of ['source', 'source_error', 'merged', 'merge_error']) {
      expect(
        OnboardingUnderstandingMessageMetadataSchema.safeParse({ ...proposal, kind: legacyKind })
          .success,
      ).toBe(false);
    }

    for (const [field, value] of [
      ['inputThreadIds', ['thread']],
      ['externalAccountId', 'account'],
      ['rawContent', 'private context'],
      ['operationId', 'operation'],
      ['schemaVersion', 1],
    ] as const) {
      expect(
        OnboardingUnderstandingMessageMetadataSchema.safeParse({ ...proposal, [field]: value })
          .success,
        field,
      ).toBe(false);
    }
  });

  it('uses providerId in retry input', () => {
    expectTypeOf<{
      providerId: string;
      sessionId: string;
      topicId: string;
    }>().toMatchTypeOf<RetryOnboardingUnderstandingProviderInput>();
    expectTypeOf<{
      sessionId: string;
      sourceId: string;
      topicId: string;
    }>().not.toMatchTypeOf<RetryOnboardingUnderstandingProviderInput>();
  });

  it('uses resultId as the confirmation stale-display guard', () => {
    expectTypeOf<{
      resultId: string;
      sessionId: string;
      topicId: string;
    }>().toMatchTypeOf<ConfirmOnboardingUnderstandingInput>();
    expectTypeOf<{
      sessionId: string;
      sourceFingerprint: string;
      topicId: string;
    }>().not.toMatchTypeOf<ConfirmOnboardingUnderstandingInput>();
  });

  it('projects polling status from provider and writing state', () => {
    expect(projectOnboardingUnderstandingSessionStatus({ id: 'session', sources: {} })).toBe(
      'pending',
    );
    expect(
      projectOnboardingUnderstandingSessionStatus({
        id: 'session',
        sources: { github: { ...providerState, status: 'running' } },
      }),
    ).toBe('processing');
    expect(
      projectOnboardingUnderstandingSessionStatus({
        id: 'session',
        sources: { github: providerState },
        writing: {
          sourceFingerprint: 'fingerprint',
          status: 'running',
          updatedAt: '2026-07-20T08:10:00.000Z',
        },
      }),
    ).toBe('processing');
    expect(
      projectOnboardingUnderstandingSessionStatus({
        id: 'session',
        sources: { github: providerState },
        writing: {
          sourceFingerprint: 'fingerprint',
          status: 'completed',
          updatedAt: '2026-07-20T08:10:00.000Z',
        },
      }),
    ).toBe('completed');
    expect(
      projectOnboardingUnderstandingSessionStatus({
        id: 'session',
        sources: {
          github: providerState,
          linear: { ...providerState, errors: [error], failedCount: 1, status: 'failed' },
        },
        writing: {
          sourceFingerprint: 'fingerprint',
          status: 'completed',
          updatedAt: '2026-07-20T08:10:00.000Z',
        },
      }),
    ).toBe('partial');
    expect(
      projectOnboardingUnderstandingSessionStatus({
        id: 'session',
        sources: { github: { ...providerState, errors: [error], status: 'failed' } },
      }),
    ).toBe('failed');
  });

  it('projects provider, writing, and proposal state for polling', () => {
    const polling: OnboardingUnderstandingPollingResult = {
      id: 'session',
      proposal,
      sources: { github: providerState },
      status: 'completed',
      writing: {
        resultMessageId: 'message',
        sourceFingerprint: 'fingerprint',
        status: 'completed',
        updatedAt: '2026-07-20T08:10:00.000Z',
      },
    };

    expect(polling.proposal?.kind).toBe('proposal');
  });
});
