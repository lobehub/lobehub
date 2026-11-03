// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { SignalFeedbackDomainMemory, SignalFeedbackDomainSkill } from '../../policies/types';
import type { ProcedureAccumulatorScoreResult } from '../../procedure';
import { createRuntimeProcessorContext } from '../../runtime/context';
import type { ProcedureStateService } from '../../services/types';
import {
  accumulateSignal,
  type FeedbackDomainSignal,
  type SatisfiedSkillFeedbackDomainSignal,
  scoreIncrease,
  suppressHandled,
  transitionScoredProcedure,
  transitionSuppressedProcedure,
} from '../procedure';
import { transitionToSignals } from '../runtimeResults';

const context = createRuntimeProcessorContext({
  backend: {
    async getGuardState() {
      return {};
    },
    async touchGuardState() {
      return {};
    },
  },
  now: () => 1000,
  scopeKey: 'topic:thread_1',
});

const createMemorySignal = (
  input: Partial<{
    message: string;
    messageId: string;
    reason: string;
    satisfactionResult: 'neutral' | 'not_satisfied' | 'satisfied';
    signalId: string;
    sourceId: string;
  }> = {},
) =>
  ({
    chain: {
      chainId: 'chain_1',
      parentNodeId: 'source_1',
      rootSourceId: input.sourceId ?? 'source_1',
    },
    payload: {
      confidence: 0.9,
      conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 100 },
      evidence: [{ cue: 'test', excerpt: input.message ?? 'Remember this.' }],
      message: input.message ?? 'Remember this.',
      messageId: input.messageId ?? 'msg_1',
      reason: input.reason ?? 'test-reason',
      satisfactionResult: input.satisfactionResult ?? 'satisfied',
      target: 'memory',
    },
    signalId: input.signalId ?? 'sig_1',
    signalType: 'signal.feedback.domain.memory',
    source: {
      sourceId: input.sourceId ?? 'source_1',
      sourceType: 'agent.user.message',
    },
    timestamp: 1,
  }) satisfies SignalFeedbackDomainMemory;

const createSkillSignal = (
  input: Partial<{
    message: string;
    messageId: string;
    reason: string;
    satisfactionResult: 'neutral' | 'not_satisfied' | 'satisfied';
    signalId: string;
    sourceId: string;
  }> = {},
) =>
  ({
    chain: {
      chainId: 'chain_1',
      parentNodeId: 'source_1',
      rootSourceId: input.sourceId ?? 'source_1',
    },
    payload: {
      confidence: 0.9,
      conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 80 },
      evidence: [{ cue: 'test', excerpt: input.message ?? 'Keep this workflow as a skill.' }],
      message: input.message ?? 'Keep this workflow as a skill.',
      messageId: input.messageId ?? 'msg_1',
      reason: input.reason ?? 'test-reason',
      satisfactionResult: input.satisfactionResult ?? 'not_satisfied',
      target: 'skill',
    },
    signalId: input.signalId ?? 'sig_1',
    signalType: 'signal.feedback.domain.skill',
    source: {
      sourceId: input.sourceId ?? 'source_1',
      sourceType: 'agent.user.message',
    },
    timestamp: 1,
  }) satisfies SignalFeedbackDomainSkill;

const createSatisfiedSkillSignal = (
  input: Parameters<typeof createSkillSignal>[0] = {},
): SatisfiedSkillFeedbackDomainSignal => {
  const signal = createSkillSignal({ ...input, satisfactionResult: 'satisfied' });

  return {
    ...signal,
    payload: {
      ...signal.payload,
      satisfactionResult: 'satisfied',
      target: 'skill',
    },
  };
};

interface ProcedureStateServiceTestOverrides extends Partial<
  Omit<ProcedureStateService, 'markers'>
> {
  markers?: Partial<ProcedureStateService['markers']>;
}

const createProcedureStateService = (
  overrides: ProcedureStateServiceTestOverrides = {},
): ProcedureStateService => {
  const service: ProcedureStateService = {
    accumulators: {
      append: vi.fn(),
      appendAndScore: vi.fn(),
    },
    inspect: {
      scope: vi.fn(),
    },
    markers: {
      shouldSuppress: vi.fn(),
      write: vi.fn(),
      writeAccumulated: vi.fn(),
    },
    receipts: {
      append: vi.fn(),
    },
    records: {
      write: vi.fn(),
    },
  };

  return {
    ...service,
    ...overrides,
    markers: {
      ...service.markers,
      ...overrides.markers,
    },
  };
};

const createScored = (
  overrides: Partial<{
    aggregateScore: number;
    recordIds: string[];
    scoredAt: number;
  }> = {},
): ProcedureAccumulatorScoreResult => {
  const recordIds = overrides.recordIds ?? ['record_1', 'record_2'];

  return {
    bucket: {
      bucketKey: 'topic:thread_1:skill',
      cheapScore: 1.2,
      domain: 'skill',
      firstSeenAt: 900,
      lastSeenAt: 1000,
      recordCount: recordIds.length,
      recordIds,
      scopeKey: 'topic:thread_1',
      version: '1',
    },
    records: [],
    score: {
      aggregateScore: overrides.aggregateScore ?? 1.2,
      confidence: 0.8,
      itemScores: recordIds.map((recordId) => ({
        reasons: ['repeated-positive-feedback'],
        recordId,
        score: 0.6,
        suggestedAction: 'handle',
      })),
      scoredAt: overrides.scoredAt ?? 1200,
      suggestedActions: ['handle'],
    },
  };
};

describe('procedure processors', () => {
  /**
   * @example
   * Exact policy signal fixtures compile against the processor input contracts.
   */
  it('uses exact policy signal fixtures for processor inputs', () => {
    const feedbackSignal: FeedbackDomainSignal = createMemorySignal();
    const skillSignal: SatisfiedSkillFeedbackDomainSignal = createSatisfiedSkillSignal();

    expect(feedbackSignal.signalType).toBe('signal.feedback.domain.memory');
    expect(skillSignal.payload.satisfactionResult).toBe('satisfied');
  });

  /**
   * @example
   * A satisfied memory signal checks `memory:user-preference` handled markers, then stops with a no-op.
   */
  it('stops with noop when an active handled marker exists and no onSuppress is provided', async () => {
    const shouldSuppress = vi.fn().mockResolvedValue(true);
    const procedureState = createProcedureStateService({
      markers: {
        shouldSuppress,
        write: vi.fn(),
      },
    });
    const signal = createMemorySignal();

    const result = await suppressHandled(signal, context, { procedureState });

    expect(shouldSuppress).toHaveBeenCalledWith({
      domainKey: 'memory:user-preference',
      intentClass: 'implicit_positive',
      intentClassCandidates: ['implicit_positive', 'explicit_persistence', 'unknown'],
      procedureKey: 'message:msg_1',
      scopeKey: 'topic:thread_1',
    });
    expect(result).toEqual({
      reason: 'suppressed by handled procedure marker',
      result: {
        concluded: { reason: 'suppressed by handled procedure marker' },
        status: 'conclude',
      },
      type: 'stop',
    });
  });

  /**
   * @example
   * A caller-provided transition is returned when suppression matches.
   */
  it('uses onSuppress transition when provided', async () => {
    const procedureState = createProcedureStateService({
      markers: {
        shouldSuppress: vi.fn().mockResolvedValue(true),
        write: vi.fn(),
      },
    });
    const signal = createSkillSignal();
    const onSuppress = vi.fn(() => transitionSuppressedProcedure(signal, context));

    const result = await suppressHandled(signal, context, { procedureState }, { onSuppress });

    expect(onSuppress).toHaveBeenCalledTimes(1);
    expect(result).toEqual(transitionSuppressedProcedure(signal, context));
  });

  /**
   * @example
   * A signal continues unchanged when no handled marker matches.
   */
  it('continues when no handled marker exists', async () => {
    const procedureState = createProcedureStateService({
      markers: {
        shouldSuppress: vi.fn().mockResolvedValue(false),
        write: vi.fn(),
      },
    });
    const signal = createSkillSignal({ satisfactionResult: 'not_satisfied' });

    await expect(suppressHandled(signal, context, { procedureState })).resolves.toEqual({
      reason: 'no handled marker matched',
      type: 'continue',
      value: signal,
    });
  });

  /**
   * @example
   * Satisfied skill feedback writes a candidate record and exposes the accumulator result.
   */
  it('writes satisfied skill candidates and returns record with scored value', async () => {
    const appendAndScore = vi.fn().mockResolvedValue(undefined);
    const write = vi.fn().mockResolvedValue(undefined);
    const procedureState = createProcedureStateService({
      accumulators: {
        append: vi.fn(),
        appendAndScore,
      },
      records: {
        write,
      },
    });
    const signal = createSatisfiedSkillSignal({
      message: 'Keep this workflow as a reusable skill.',
      reason: 'successful workflow',
      signalId: 'sig_skill',
      sourceId: 'source_skill',
    });

    const result = await accumulateSignal(
      signal,
      context,
      { procedureState },
      { domain: 'skill', scoreDelta: 0.6 },
    );

    const expectedRecord = {
      accumulatorRole: 'candidate',
      cheapScoreDelta: 0.6,
      createdAt: 1000,
      domainKey: 'skill',
      id: 'procedure-record:sig_skill:skill-observation-record',
      intentClass: 'implicit_positive',
      refs: {
        signalIds: ['sig_skill'],
        sourceIds: ['source_skill'],
      },
      scopeKey: 'topic:thread_1',
      status: 'observed',
      summary: 'successful workflow',
    };

    expect(write).toHaveBeenCalledWith(expectedRecord);
    expect(appendAndScore).toHaveBeenCalledWith(expectedRecord);
    expect(result).toEqual({
      reason: 'recorded skill observation',
      type: 'continue',
      value: { record: expectedRecord, scored: undefined },
    });
  });

  /**
   * @example
   * Missing accumulator score data stops with a no-op gate result.
   */
  it('stops score increase when scored value is undefined', () => {
    expect(scoreIncrease(undefined, { minRecords: 2, threshold: 1 })).toEqual({
      reason: 'score gates not met',
      result: { concluded: { reason: 'score gates not met' }, status: 'conclude' },
      type: 'stop',
    });
  });

  /**
   * @example
   * Scores below threshold or record count stop before dispatching.
   */
  it('stops score increase below threshold or below minimum record count', () => {
    expect(
      scoreIncrease(createScored({ aggregateScore: 0.5 }), { minRecords: 2, threshold: 1 }),
    ).toEqual({
      reason: 'score gates not met',
      result: { concluded: { reason: 'score gates not met' }, status: 'conclude' },
      type: 'stop',
    });
    expect(
      scoreIncrease(createScored({ recordIds: ['record_1'] }), { minRecords: 2, threshold: 1 }),
    ).toEqual({
      reason: 'score gates not met',
      result: { concluded: { reason: 'score gates not met' }, status: 'conclude' },
      type: 'stop',
    });
  });

  /**
   * @example
   * Scores meeting both gates continue with the scored bucket.
   */
  it('continues score increase when gates are met', () => {
    const scored = createScored();

    expect(scoreIncrease(scored, { minRecords: 2, threshold: 1 })).toEqual({
      reason: 'score gates met',
      type: 'continue',
      value: scored,
    });
  });

  /**
   * @example
   * Suppressed procedure transitions dispatch a zero-score procedure bucket signal.
   */
  it('dispatches suppressed procedure score signal', () => {
    const signal = createMemorySignal({ signalId: 'sig_memory' });

    expect(transitionSuppressedProcedure(signal, context)).toEqual(
      transitionToSignals(
        {
          chain: {
            chainId: 'chain_1',
            parentNodeId: 'sig_memory',
            parentSignalId: 'sig_memory',
            rootSourceId: 'source_1',
          },
          payload: {
            aggregateScore: 0,
            bucketKey: 'topic:thread_1:memory:user-preference',
            confidence: 1,
            domain: 'memory:user-preference',
            itemScores: [],
            recordIds: [],
            suggestedActions: ['suppressed'],
          },
          signalId: 'sig_memory:signal:procedure-suppressed',
          signalType: 'signal.procedure.bucket.scored',
          source: {
            sourceId: 'source_1',
            sourceType: 'agent.user.message',
          },
          timestamp: 1000,
        },
        { reason: 'dispatch suppressed procedure score signal' },
      ),
    );
  });

  /**
   * @example
   * Scored procedure transitions dispatch the accumulated score payload.
   */
  it('dispatches accumulated procedure score signal', () => {
    const signal = createSatisfiedSkillSignal({
      signalId: 'sig_skill',
      sourceId: 'source_skill',
    });
    const scored = createScored({ scoredAt: 1500 });

    expect(transitionScoredProcedure(signal, scored)).toEqual(
      transitionToSignals(
        {
          chain: {
            chainId: 'chain_1',
            parentNodeId: 'sig_skill',
            parentSignalId: 'sig_skill',
            rootSourceId: 'source_skill',
          },
          payload: {
            aggregateScore: 1.2,
            bucketKey: 'topic:thread_1:skill',
            confidence: 0.8,
            domain: 'skill',
            itemScores: [
              {
                reasons: ['repeated-positive-feedback'],
                recordId: 'record_1',
                score: 0.6,
                suggestedAction: 'handle',
              },
              {
                reasons: ['repeated-positive-feedback'],
                recordId: 'record_2',
                score: 0.6,
                suggestedAction: 'handle',
              },
            ],
            recordIds: ['record_1', 'record_2'],
            suggestedActions: ['handle'],
          },
          signalId: 'sig_skill:signal:procedure-accumulated',
          signalType: 'signal.procedure.bucket.scored',
          source: {
            sourceId: 'source_skill',
            sourceType: 'agent.user.message',
          },
          timestamp: 1500,
        },
        { reason: 'dispatch accumulated procedure score signal' },
      ),
    );
  });
});
