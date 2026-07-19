import { describe, expect, expectTypeOf, it } from 'vitest';

import { threadMetadataSchema } from './topic/thread';
import type {
  CollectionDiagnostics,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingPollingResult,
  OnboardingUnderstandingSession,
  UnderstandingAnalysis,
  UnderstandingSourceRef,
} from './understanding';
import {
  MAX_COLLECTION_ERRORS,
  OnboardingUnderstandingSessionSchema,
  OnboardingUnderstandingThreadMarkerSchema,
  projectOnboardingUnderstandingSessionStatus,
  UnderstandingSourceRefSchema,
} from './understanding';

type KnownForbiddenDurableKey =
  | 'accessToken'
  | 'apiKey'
  | 'authorization'
  | 'candidateId'
  | 'credential'
  | 'credentialOrigin'
  | 'credentialReference'
  | 'credentials'
  | 'oauthToken'
  | 'operationId'
  | 'rawContent'
  | 'refreshToken'
  | 'resolutionKey'
  | 'schemaVersion'
  | 'secret'
  | 'sourceBrief'
  | 'sourceLocator'
  | 'token';

type DurableKeys<Value> = Value extends readonly (infer Item)[]
  ? DurableKeys<Item>
  : Value extends object
    ? keyof Value | { [Key in keyof Value]: DurableKeys<Value[Key]> }[keyof Value]
    : never;

type HasNoForbiddenKeys<Value> =
  Extract<DurableKeys<Value>, KnownForbiddenDurableKey> extends never ? true : false;

const source = {
  externalAccountId: 'account',
  id: 'github:account',
  provider: 'github',
};

describe('Understanding durable contracts', () => {
  it('stores only the Understanding result kind on thread markers', () => {
    const marker = { kind: 'source' as const };
    expect(OnboardingUnderstandingThreadMarkerSchema.safeParse(marker).success).toBe(true);
    expect(
      threadMetadataSchema.parse({ onboardingUnderstanding: marker }).onboardingUnderstanding,
    ).toEqual(marker);
    expect(
      OnboardingUnderstandingThreadMarkerSchema.safeParse({
        kind: 'source',
        launch: { assistantMessageId: 'message', operationId: 'operation' },
      }).success,
    ).toBe(false);
  });

  it('excludes credentials, raw source data, runtime operation IDs, and schema versions', () => {
    const contractAssertions: [
      HasNoForbiddenKeys<UnderstandingSourceRef>,
      HasNoForbiddenKeys<CollectionDiagnostics>,
      HasNoForbiddenKeys<UnderstandingAnalysis>,
      HasNoForbiddenKeys<OnboardingUnderstandingMessageMetadata>,
      HasNoForbiddenKeys<OnboardingUnderstandingSession>,
      HasNoForbiddenKeys<OnboardingUnderstandingPollingResult>,
    ] = [true, true, true, true, true, true];

    expect(contractAssertions.every(Boolean)).toBe(true);
  });

  it('rejects metadata fields that do not belong to the result kind', () => {
    expectTypeOf<{
      diagnostics: CollectionDiagnostics;
      kind: 'source_error';
      resultId: string;
    }>().not.toMatchTypeOf<OnboardingUnderstandingMessageMetadata>();
    expectTypeOf<{
      analysis: UnderstandingAnalysis;
      diagnostics: CollectionDiagnostics;
      inputThreadIds: string[];
      kind: 'merged';
      resultId: string;
      source: UnderstandingSourceRef;
    }>().not.toMatchTypeOf<OnboardingUnderstandingMessageMetadata>();
  });

  it('accepts lean source and merge business state', () => {
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        id: 'session',
        mergeRun: {
          assistantMessageId: 'merge-message',
          diagnostics: { evidenceCount: 2, failedCount: 0, succeededCount: 2 },
          resultId: 'merge-result',
          status: 'completed',
          threadId: 'merge-thread',
        },
        runs: [
          {
            assistantMessageId: 'message',
            diagnostics: { evidenceCount: 2, failedCount: 0, succeededCount: 2 },
            resultId: 'result',
            source,
            status: 'completed',
            threadId: 'thread',
          },
        ],
        status: 'completed',
        workflowRunId: 'workflow-run',
      }).success,
    ).toBe(true);
  });

  it('accepts bounded discovery errors and rejects an unbounded session error list', () => {
    const error = {
      code: 'SOURCE_DISCOVERY_FAILED',
      message: 'GitHub was unavailable',
      operation: 'discovery',
      provider: 'github',
      retryable: true,
    };
    const session = { id: 'session', runs: [], status: 'failed' };

    expect(
      OnboardingUnderstandingSessionSchema.safeParse({ ...session, errors: [error] }).success,
    ).toBe(true);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        errors: Array.from({ length: MAX_COLLECTION_ERRORS + 1 }, () => error),
      }).success,
    ).toBe(false);
  });

  it.each([
    ['operationId', 'operation'],
    ['collectionAttemptId', 'attempt'],
    ['collectionStartedAt', '2026-07-17T08:30:00.000Z'],
    ['cleanupStatus', 'completed'],
    ['completedAt', '2026-07-17T08:30:00.000Z'],
  ])('rejects runtime-only source field %s', (field, value) => {
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        id: 'session',
        runs: [{ [field]: value, source, status: 'running', threadId: 'thread' }],
        status: 'processing',
      }).success,
    ).toBe(false);
  });

  it.each(['retiredRuns', 'retiredMergeRuns', 'initializationStartedAt', 'initializedAt'])(
    'rejects runtime-only session field %s',
    (field) => {
      expect(
        OnboardingUnderstandingSessionSchema.safeParse({
          [field]: field.startsWith('retired') ? [] : '2026-07-17T08:30:00.000Z',
          id: 'session',
          runs: [],
          status: 'failed',
        }).success,
      ).toBe(false);
    },
  );

  it('uses running for merge progress and rejects source input manifests', () => {
    const session = { id: 'session', runs: [], status: 'merging' };

    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        mergeRun: { status: 'running', threadId: 'merge-thread' },
      }).success,
    ).toBe(true);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        mergeRun: { status: 'processing', threadId: 'merge-thread' },
      }).success,
    ).toBe(false);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        mergeRun: {
          inputThreadIds: ['source-thread'],
          status: 'running',
          threadId: 'merge-thread',
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      'source IDs',
      {
        runs: [
          { source, status: 'pending', threadId: 'thread-a' },
          { source, status: 'pending', threadId: 'thread-b' },
        ],
      },
    ],
    [
      'thread IDs',
      {
        mergeRun: { status: 'pending', threadId: 'thread-a' },
        runs: [{ source, status: 'pending', threadId: 'thread-a' }],
      },
    ],
    [
      'assistant message IDs',
      {
        mergeRun: {
          assistantMessageId: 'message',
          status: 'completed',
          threadId: 'merge-thread',
        },
        runs: [
          { assistantMessageId: 'message', source, status: 'completed', threadId: 'thread-a' },
        ],
      },
    ],
    [
      'result IDs',
      {
        mergeRun: { resultId: 'result', status: 'completed', threadId: 'merge-thread' },
        runs: [{ resultId: 'result', source, status: 'completed', threadId: 'thread-a' }],
      },
    ],
  ])('rejects duplicate active business %s', (_label, manifest) => {
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        id: 'session',
        status: 'processing',
        ...manifest,
      }).success,
    ).toBe(false);
  });

  it('projects polling status from source and merge business state', () => {
    const session = {
      id: 'session',
      runs: [{ source, status: 'running' as const, threadId: 'thread' }],
      status: 'pending' as const,
    };

    expect(projectOnboardingUnderstandingSessionStatus(session)).toBe('processing');
    expect(
      projectOnboardingUnderstandingSessionStatus({
        ...session,
        mergeRun: { status: 'running', threadId: 'merge-thread' },
        runs: [{ ...session.runs[0], status: 'completed' }],
      }),
    ).toBe('merging');
    expect(
      projectOnboardingUnderstandingSessionStatus({
        ...session,
        mergeRun: { status: 'completed', threadId: 'merge-thread' },
        runs: [{ ...session.runs[0], status: 'completed' }],
      }),
    ).toBe('completed');
  });

  it.each(['displayName', 'externalAccountId', 'id', 'provider'] as const)(
    'rejects an oversized source reference %s',
    (field) => {
      expect(
        UnderstandingSourceRefSchema.safeParse({
          ...source,
          displayName: 'Account',
          [field]: 'x'.repeat(10_000),
        }).success,
      ).toBe(false);
    },
  );
});
