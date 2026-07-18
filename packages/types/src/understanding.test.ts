import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  CollectionDiagnostics,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingPollingResult,
  OnboardingUnderstandingSession,
  UnderstandingAnalysis,
  UnderstandingSourceRef,
} from './understanding';
import {
  OnboardingUnderstandingSessionSchema,
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
  | 'rawContent'
  | 'refreshToken'
  | 'resolutionKey'
  | 'sourceLocator'
  | 'schemaVersion'
  | 'secret'
  | 'sourceBrief'
  | 'token';

type DurableKeys<Value> = Value extends readonly (infer Item)[]
  ? DurableKeys<Item>
  : Value extends object
    ? keyof Value | { [Key in keyof Value]: DurableKeys<Value[Key]> }[keyof Value]
    : never;

type HasNoForbiddenKeys<Value> =
  Extract<DurableKeys<Value>, KnownForbiddenDurableKey> extends never ? true : false;

describe('Understanding durable contracts', () => {
  it('excludes known credential, raw source, and schema version keys', () => {
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
    expectTypeOf<{
      analysis: UnderstandingAnalysis;
      diagnostics: CollectionDiagnostics;
      kind: 'source';
      resultId: string;
      source: UnderstandingSourceRef;
    }>().toMatchTypeOf<OnboardingUnderstandingMessageMetadata>();
  });

  it('accepts optional internal cleanup completion markers', () => {
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        id: 'session',
        mergeRun: {
          assistantMessageId: 'merge-message',
          cleanupStatus: 'completed',
          inputThreadIds: ['thread'],
          operationId: 'merge-operation',
          status: 'completed',
          threadId: 'merge-thread',
        },
        runs: [
          {
            assistantMessageId: 'message',
            cleanupStatus: 'completed',
            operationId: 'operation',
            source: {
              externalAccountId: 'account',
              id: 'github:account',
              provider: 'github',
            },
            status: 'completed',
            threadId: 'thread',
          },
        ],
        status: 'completed',
      }).success,
    ).toBe(true);
  });

  it('accepts an optional ISO completion timestamp only on source runs', () => {
    const session = {
      id: 'session',
      runs: [
        {
          completedAt: '2026-07-17T08:30:00.000Z',
          source: {
            externalAccountId: 'account',
            id: 'github:account',
            provider: 'github',
          },
          status: 'completed',
          threadId: 'thread',
        },
      ],
      status: 'processing',
    };

    expect(OnboardingUnderstandingSessionSchema.safeParse(session).success).toBe(true);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        runs: [{ ...session.runs[0], completedAt: 'not-a-timestamp' }],
      }).success,
    ).toBe(false);
  });

  it('accepts optional collection attempt and ISO lease fields on source runs', () => {
    const session = {
      id: 'session',
      runs: [
        {
          collectionAttemptId: 'attempt-1',
          collectionStartedAt: '2026-07-17T08:30:00.000Z',
          source: {
            externalAccountId: 'account',
            id: 'github:account',
            provider: 'github',
          },
          status: 'collecting',
          threadId: 'thread',
        },
      ],
      status: 'processing',
    };

    expect(OnboardingUnderstandingSessionSchema.safeParse(session).success).toBe(true);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        runs: [{ ...session.runs[0], collectionStartedAt: 'not-a-timestamp' }],
      }).success,
    ).toBe(false);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        runs: [{ ...session.runs[0], collectionAttemptId: '' }],
      }).success,
    ).toBe(false);
  });

  it('accepts compact ISO session initialization lease markers', () => {
    const session = {
      id: 'session',
      initializationStartedAt: '2026-07-17T08:30:00.000Z',
      initializedAt: '2026-07-17T08:30:01.000Z',
      runs: [],
      status: 'failed',
    };

    expect(OnboardingUnderstandingSessionSchema.safeParse(session).success).toBe(true);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        initializationStartedAt: 'not-a-timestamp',
      }).success,
    ).toBe(false);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        initializedAt: 'not-a-timestamp',
      }).success,
    ).toBe(false);
  });

  it('allows retired runs to repeat source IDs while requiring unique runtime IDs', () => {
    const activeRun = {
      assistantMessageId: 'active-message',
      operationId: 'active-operation',
      source: {
        externalAccountId: 'account',
        id: 'github:account',
        provider: 'github',
      },
      status: 'failed',
      threadId: 'active-thread',
    };
    const retiredRun = {
      ...activeRun,
      assistantMessageId: 'retired-message',
      operationId: 'retired-operation',
      threadId: 'retired-thread',
    };
    const session = {
      id: 'session',
      retiredRuns: [retiredRun],
      runs: [activeRun],
      status: 'failed',
    };

    expect(OnboardingUnderstandingSessionSchema.safeParse(session).success).toBe(true);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        retiredRuns: [{ ...retiredRun, threadId: activeRun.threadId }],
      }).success,
    ).toBe(false);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        retiredRuns: [{ ...retiredRun, operationId: activeRun.operationId }],
      }).success,
    ).toBe(false);
  });

  it('accepts retired merge history without projecting it as the active merge', () => {
    const session = {
      id: 'session',
      retiredMergeRuns: [
        {
          assistantMessageId: 'retired-merge-message',
          inputThreadIds: ['historical-source-thread'],
          operationId: 'retired-merge-operation',
          status: 'completed',
          threadId: 'retired-merge-thread',
        },
      ],
      runs: [
        {
          assistantMessageId: 'active-message',
          operationId: 'active-operation',
          source: {
            externalAccountId: 'account',
            id: 'github:account',
            provider: 'github',
          },
          status: 'failed',
          threadId: 'active-thread',
        },
      ],
      status: 'failed',
    };

    const parsed = OnboardingUnderstandingSessionSchema.safeParse(session);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(projectOnboardingUnderstandingSessionStatus(parsed.data)).toBe('failed');
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        retiredMergeRuns: [{ ...session.retiredMergeRuns[0], threadId: 'active-thread' }],
      }).success,
    ).toBe(false);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        retiredMergeRuns: [{ ...session.retiredMergeRuns[0], operationId: 'active-operation' }],
      }).success,
    ).toBe(false);
    expect(
      OnboardingUnderstandingSessionSchema.safeParse({
        ...session,
        retiredMergeRuns: [
          { ...session.retiredMergeRuns[0], assistantMessageId: 'active-message' },
        ],
      }).success,
    ).toBe(false);
  });

  it.each(['displayName', 'externalAccountId', 'id', 'provider'] as const)(
    'rejects an oversized source reference %s in both source and manifest schemas',
    (field) => {
      const source = {
        displayName: 'Account',
        externalAccountId: 'account',
        id: 'github:account',
        provider: 'github',
        [field]: 'x'.repeat(10_000),
      };
      const run = {
        assistantMessageId: 'message',
        operationId: 'operation',
        source,
        status: 'resolving',
        threadId: 'thread',
      };

      expect(UnderstandingSourceRefSchema.safeParse(source).success).toBe(false);
      expect(
        OnboardingUnderstandingSessionSchema.safeParse({
          id: 'session',
          runs: [run],
          status: 'processing',
        }).success,
      ).toBe(false);
    },
  );
});
