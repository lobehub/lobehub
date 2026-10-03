import { describe, expect, it } from 'vitest';

import {
  chatTopicCreateMetadataSchema,
  chatTopicMetadataUpdateSchema,
  parseTopicScheduledRun,
} from './topic';

describe.each([chatTopicCreateMetadataSchema, chatTopicMetadataUpdateSchema])(
  'reasoning metadata validation',
  (schema) => {
    /** @example Topic speed survives both creation/model-switch and metadata-update validation. */
    it('retains explicit fast and standard speed pins', () => {
      for (const heteroSpeed of ['fast', 'default']) {
        /** @example Standard is stored as "default", rather than stripped as an unknown field. */
        expect(schema.parse({ heteroSpeed })).toEqual({ heteroSpeed });
      }
      /** @example An absent speed remains inherited; an unknown value is rejected. */
      expect(schema.parse({})).toEqual({});
      /** @example Invalid speed must not reach persisted Topic metadata. */
      expect(schema.safeParse({ heteroSpeed: 'invalid' }).success).toBe(false);
    });

    it('rejects invalid known reasoning enum values', () => {
      expect(
        schema.safeParse({ reasoningConfig: { gpt5ReasoningEffort: 'invalid' } }).success,
      ).toBe(false);
      expect(schema.safeParse({ reasoningConfig: { reasoningMode: 'fast' } }).success).toBe(false);
    });
    it('accepts valid values and an explicit default pin', () => {
      for (const reasoningConfig of [{}, { gpt5ReasoningEffort: 'high', reasoningMode: 'pro' }]) {
        expect(schema.parse({ reasoningConfig })).toEqual({ reasoningConfig });
      }
    });
  },
);

describe('chatTopicMetadataUpdateSchema', () => {
  it('parses a scheduled heterogeneous continuation patch', () => {
    const metadata = {
      scheduledRun: {
        createdAt: '2026-07-12T00:00:00.000Z',
        failedAssistantMessageId: 'assistant-1',
        kind: 'resume_after_rate_limit',
        rateLimit: { rateLimitType: 'seven_day', resetsAt: 1_800_000_000 },
        resume: { sessionId: 'session-1', workingDirectory: '/repo' },
        runAt: '2027-01-15T22:40:00.000Z',
        source: 'heterogeneous_agent',
        updatedAt: '2026-07-12T00:00:00.000Z',
        userMessageId: 'user-1',
      },
    };

    expect(chatTopicMetadataUpdateSchema.parse(metadata)).toEqual(metadata);
    expect(chatTopicMetadataUpdateSchema.parse({ scheduledRun: null })).toEqual({
      scheduledRun: null,
    });
  });

  it('parses a delayed-start patch', () => {
    const metadata = {
      scheduledRun: {
        createdAt: '2026-07-12T00:00:00.000Z',
        kind: 'delayed_start',
        runAt: '2026-07-12T03:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
        userMessageId: 'user-1',
      },
    };

    expect(chatTopicMetadataUpdateSchema.parse(metadata)).toEqual(metadata);
  });

  it('rejects client-written orchestration roles on running operations', () => {
    const metadata = {
      runningOperation: {
        assistantMessageId: 'assistant-supervisor',
        childOperations: [
          {
            assistantMessageId: 'assistant-member',
            operationId: 'operation-member',
            orchestrationRole: 'member' as const,
          },
        ],
        operationId: 'operation-supervisor',
        orchestrationRole: 'supervisor' as const,
      },
    };

    expect(chatTopicMetadataUpdateSchema.safeParse(metadata).success).toBe(false);
  });

  it('accepts clearing a stale running operation and omitting it', () => {
    expect(chatTopicMetadataUpdateSchema.parse({ runningOperation: null })).toEqual({
      runningOperation: null,
    });
    expect(chatTopicMetadataUpdateSchema.parse({})).toEqual({});
  });

  const operation = { assistantMessageId: 'assistant-1', operationId: 'operation-1' };
  const hooks = [
    {
      id: 'client-hook',
      type: 'onComplete',
      webhook: { body: { userId: 'client-supplied' }, url: 'https://example.com/hook' },
    },
  ];

  it.each([
    ['root hooks', { ...operation, hooks }],
    ['child hooks', { ...operation, childOperations: [{ ...operation, hooks }] }],
    ['operation identifiers without hooks', operation],
    ['empty object', {}],
    ['array', []],
    ['string', 'operation-1'],
    ['boolean', false],
    ['number', 1],
  ])('rejects %s instead of silently stripping runtime state', (_, runningOperation) => {
    const result = chatTopicMetadataUpdateSchema.safeParse({
      model: 'test-model',
      runningOperation,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'runningOperation')).toBe(true);
    }
  });

  it('preserves supported metadata patches alongside a stale-marker clear', () => {
    const metadata = {
      boundDeviceId: 'device-1',
      model: 'test-model',
      onboardingSession: { phase: 'summary', finishedAt: '2026-09-29T00:00:00.000Z' },
      provider: 'test-provider',
      reasoningConfig: { gpt5ReasoningEffort: 'high' },
      repos: ['owner/repo'],
      runningOperation: null,
      workingDirectory: '/repo',
    };

    expect(chatTopicMetadataUpdateSchema.parse(metadata)).toEqual(metadata);
  });

  it('preserves the operation-scoped terminal correction marker', () => {
    const metadata = { lastSettledOperationId: 'operation-1' };

    expect(chatTopicMetadataUpdateSchema.parse(metadata)).toEqual(metadata);
  });

  it('rejects a delayed start with no user message — the persisted turn IS the prompt', () => {
    const result = chatTopicMetadataUpdateSchema.safeParse({
      scheduledRun: {
        createdAt: '2026-07-12T00:00:00.000Z',
        kind: 'delayed_start',
        runAt: '2026-07-12T03:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects a scheduled run with no runAt — an absent due gate must not read as "due now"', () => {
    const result = chatTopicMetadataUpdateSchema.safeParse({
      scheduledRun: {
        createdAt: '2026-07-12T00:00:00.000Z',
        kind: 'delayed_start',
        updatedAt: '2026-07-12T00:00:00.000Z',
        userMessageId: 'user-1',
      },
    });

    expect(result.success).toBe(false);
  });

  it('keeps the onboarding feedback comment limit at the shared contract boundary', () => {
    const result = chatTopicMetadataUpdateSchema.safeParse({
      onboardingFeedback: {
        comment: 'x'.repeat(501),
        rating: 'good',
        submittedAt: '2026-07-12T00:00:00.000Z',
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('parseTopicScheduledRun', () => {
  /** What the pre-`kind` version parked: no `kind`, no `runAt`, gated on `resetsAt`. */
  const legacy = {
    createdAt: '2026-07-12T00:00:00.000Z',
    failedAssistantMessageId: 'assistant-1',
    rateLimit: { rateLimitType: 'seven_day', resetsAt: 1_800_000_000 },
    reason: 'rate_limit',
    resume: { sessionId: 'session-1', workingDirectory: '/repo' },
    source: 'heterogeneous_agent',
    updatedAt: '2026-07-12T00:00:00.000Z',
    userMessageId: 'user-1',
  };

  it('returns a current payload unchanged', () => {
    const run = {
      createdAt: '2026-07-12T00:00:00.000Z',
      kind: 'delayed_start' as const,
      runAt: '2026-07-12T03:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
      userMessageId: 'user-1',
    };

    expect(parseTopicScheduledRun(run)).toEqual(run);
  });

  it('upgrades a legacy rate-limit payload, deriving runAt from the reset window', () => {
    // resetsAt is epoch SECONDS — the gate is the instant the window reopens.
    expect(parseTopicScheduledRun(legacy)).toMatchObject({
      failedAssistantMessageId: 'assistant-1',
      kind: 'resume_after_rate_limit',
      runAt: new Date(1_800_000_000 * 1000).toISOString(),
    });
  });

  it('upgrades a legacy payload with no reset window to due-now, as the old gate read it', () => {
    const { rateLimit: _rateLimit, ...noReset } = legacy;

    // `createdAt` is in the past by construction, so this dispatches on the next tick.
    expect(parseTopicScheduledRun(noReset)).toMatchObject({
      kind: 'resume_after_rate_limit',
      runAt: legacy.createdAt,
    });
  });

  it('rejects a payload carrying an unknown kind rather than reading it as legacy', () => {
    expect(parseTopicScheduledRun({ ...legacy, kind: 'who_knows' })).toBeNull();
    expect(parseTopicScheduledRun({ kind: 'delayed_start' })).toBeNull();
    expect(parseTopicScheduledRun(null)).toBeNull();
  });
});
