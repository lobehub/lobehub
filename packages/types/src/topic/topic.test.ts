import { describe, expect, it } from 'vitest';

import { chatTopicMetadataUpdateSchema, parseTopicScheduledRun } from './topic';

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
