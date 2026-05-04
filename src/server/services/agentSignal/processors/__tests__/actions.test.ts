// @vitest-environment node
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { SignalFeedbackDomainMemory, SignalFeedbackDomainSkill } from '../../policies/types';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES } from '../../policies/types';
import {
  type DirectSkillFeedbackDomainSignal,
  planSkillManagement,
  planUserMemory,
} from '../actions';

const sourceSerializedContext =
  '<feedback_analysis_context><message>source context</message></feedback_analysis_context>';
const payloadSerializedContext =
  '<feedback_analysis_context><message>payload context</message></feedback_analysis_context>';

const createMemorySignal = (
  input: Partial<{
    message: string;
    messageId: string;
    payloadSerializedContext: string;
    reason: string;
    satisfactionResult: 'neutral' | 'not_satisfied' | 'satisfied';
    signalId: string;
    sourceSerializedContext: unknown;
    sourceId: string;
  }> = {},
) => {
  const base = {
    chain: {
      chainId: 'chain_1',
      parentNodeId: 'source_1',
      rootSourceId: input.sourceId ?? 'source_1',
    },
    source: {
      payload:
        'sourceSerializedContext' in input
          ? { serializedContext: input.sourceSerializedContext }
          : { serializedContext: sourceSerializedContext },
      sourceId: input.sourceId ?? 'source_1',
      sourceType: 'agent.user.message',
    },
    timestamp: 1,
  };

  return {
    ...base,
    payload: {
      agentId: 'agent_1',
      confidence: 0.9,
      conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 100 },
      evidence: [{ cue: 'test', excerpt: input.message ?? 'Remember this.' }],
      message: input.message ?? 'Remember this.',
      messageId: input.messageId ?? 'msg_1',
      reason: input.reason ?? 'test-reason',
      satisfactionResult: input.satisfactionResult ?? 'satisfied',
      serializedContext: input.payloadSerializedContext,
      sourceHints: { intents: ['memory'] },
      target: 'memory',
      topicId: 'topic_1',
    },
    signalId: input.signalId ?? 'sig_1',
    signalType: 'signal.feedback.domain.memory',
  } satisfies SignalFeedbackDomainMemory;
};

const createSkillSignal = (
  input: Partial<{
    message: string;
    messageId: string;
    payloadSerializedContext: string;
    reason: string;
    satisfactionResult: 'neutral' | 'not_satisfied' | 'satisfied';
    signalId: string;
    sourceSerializedContext: unknown;
    sourceId: string;
  }> = {},
) => {
  const base = {
    chain: {
      chainId: 'chain_1',
      parentNodeId: 'source_1',
      rootSourceId: input.sourceId ?? 'source_1',
    },
    source: {
      payload:
        'sourceSerializedContext' in input
          ? { serializedContext: input.sourceSerializedContext }
          : { serializedContext: sourceSerializedContext },
      sourceId: input.sourceId ?? 'source_1',
      sourceType: 'agent.user.message',
    },
    timestamp: 1,
  };

  return {
    ...base,
    payload: {
      agentId: 'agent_1',
      confidence: 0.9,
      conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 80 },
      evidence: [{ cue: 'test', excerpt: input.message ?? 'Keep this workflow as a skill.' }],
      message: input.message ?? 'Keep this workflow as a skill.',
      messageId: input.messageId ?? 'msg_1',
      reason: input.reason ?? 'test-reason',
      satisfactionResult: input.satisfactionResult ?? 'not_satisfied',
      serializedContext: input.payloadSerializedContext,
      sourceHints: { intents: ['skill'] },
      target: 'skill',
      topicId: 'topic_1',
    },
    signalId: input.signalId ?? 'sig_1',
    signalType: 'signal.feedback.domain.skill',
  } satisfies SignalFeedbackDomainSkill;
};

const createNonSatisfiedSkillSignal = (
  input: Parameters<typeof createSkillSignal>[0] = {},
): DirectSkillFeedbackDomainSignal => {
  const signal = createSkillSignal({
    ...input,
    satisfactionResult: input.satisfactionResult ?? 'not_satisfied',
  });

  return {
    ...signal,
    payload: {
      ...signal.payload,
      satisfactionResult:
        signal.payload.satisfactionResult === 'satisfied'
          ? 'neutral'
          : signal.payload.satisfactionResult,
      target: 'skill',
    },
  };
};

const createSatisfiedSkillSignal = (
  input: Parameters<typeof createSkillSignal>[0] = {},
): SignalFeedbackDomainSkill & {
  payload: SignalFeedbackDomainSkill['payload'] & { satisfactionResult: 'satisfied' };
} => {
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

describe('action planning processors', () => {
  /**
   * @example
   * planUserMemory(memorySignal) produces a stable user-memory action plan.
   */
  it('plans a user memory action from a memory feedback signal', () => {
    const signal = createMemorySignal({
      message: 'Remember that I prefer concise answers.',
      messageId: 'msg_memory_1',
      payloadSerializedContext,
      reason: 'The user stated a persistent preference.',
      satisfactionResult: 'satisfied',
      signalId: 'sig_memory_1',
      sourceId: 'root_source_1',
    });

    const action = planUserMemory(signal);

    expect(action.actionId).toBe('sig_memory_1:action:memory');
    expect(action.actionType).toBe(AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle);
    expect(action.chain).toEqual({
      chainId: 'chain_1',
      parentNodeId: 'sig_memory_1',
      parentSignalId: 'sig_memory_1',
      rootSourceId: 'root_source_1',
    });
    expect(action.payload).toEqual({
      agentId: 'agent_1',
      conflictPolicy: signal.payload.conflictPolicy,
      evidence: signal.payload.evidence,
      feedbackHint: 'satisfied',
      idempotencyKey: 'root_source_1:memory:msg_memory_1',
      message: 'Remember that I prefer concise answers.',
      messageId: 'msg_memory_1',
      reason: 'The user stated a persistent preference.',
      serializedContext: payloadSerializedContext,
      sourceHints: signal.payload.sourceHints,
      topicId: 'topic_1',
    });
    expect(action.signal).toEqual({
      signalId: 'sig_memory_1',
      signalType: 'signal.feedback.domain.memory',
    });
    expect(action.source).toBe(signal.source);
    expect(action.timestamp).toBe(1);
  });

  /**
   * @example
   * planUserMemory(memorySignal) maps neutral memory feedback to `not_satisfied`.
   */
  it('maps neutral memory feedback to a not-satisfied action hint', () => {
    const signal = createMemorySignal({ satisfactionResult: 'neutral' });

    const action = planUserMemory(signal);

    expect(action.payload.feedbackHint).toBe('not_satisfied');
  });

  /**
   * @example
   * planUserMemory(memorySignal) preserves explicit `not_satisfied` feedback.
   */
  it('maps not-satisfied memory feedback to a not-satisfied action hint', () => {
    const signal = createMemorySignal({ satisfactionResult: 'not_satisfied' });

    const action = planUserMemory(signal);

    expect(action.payload.feedbackHint).toBe('not_satisfied');
  });

  /**
   * @example
   * planUserMemory(memorySignal) falls back to legacy source payload context.
   */
  it('falls back to source serialized context when payload context is absent', () => {
    const signal = createMemorySignal();

    const action = planUserMemory(signal);

    expect(action.payload.serializedContext).toBe(sourceSerializedContext);
  });

  /**
   * @example
   * planUserMemory(memorySignal) preserves an empty payload serialized context instead of falling back.
   */
  it('preserves an empty payload serialized context', () => {
    const signal = createMemorySignal({ payloadSerializedContext: '' });

    const action = planUserMemory(signal);

    expect(action.payload.serializedContext).toBe('');
  });

  /**
   * @example
   * planUserMemory(memorySignal) ignores non-string legacy source context.
   */
  it('omits serialized context when payload context is absent and source context is not a string', () => {
    const signal = createMemorySignal({ sourceSerializedContext: { ignored: true } });

    const action = planUserMemory(signal);

    expect(action.payload.serializedContext).toBeUndefined();
  });

  /**
   * @example
   * Skill action planning accepts skill-domain signals after handler-level route narrowing.
   */
  it('narrows skill action planning to direct skill-domain signals', () => {
    const satisfiedSignal = createSatisfiedSkillSignal();

    expectTypeOf<
      Parameters<typeof planSkillManagement>[0]
    >().toMatchTypeOf<DirectSkillFeedbackDomainSignal>();
    expectTypeOf<typeof satisfiedSignal>().toMatchTypeOf<
      Parameters<typeof planSkillManagement>[0]
    >();
    expect(satisfiedSignal.payload.satisfactionResult).toBe('satisfied');
  });

  /**
   * @example
   * planSkillManagement(skillSignal) produces a stable skill-management action plan.
   */
  it('plans a skill management action from a skill feedback signal', () => {
    const signal = createNonSatisfiedSkillSignal({
      message: 'Turn this workflow into a reusable skill.',
      messageId: 'msg_skill_1',
      payloadSerializedContext,
      reason: 'The user requested durable workflow behavior.',
      signalId: 'sig_skill_1',
      sourceId: 'root_source_2',
    });

    const action = planSkillManagement(signal);

    expect(action.actionId).toBe('sig_skill_1:action:skill-management');
    expect(action.actionType).toBe(AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle);
    expect(action.chain).toEqual({
      chainId: 'chain_1',
      parentNodeId: 'sig_skill_1',
      parentSignalId: 'sig_skill_1',
      rootSourceId: 'root_source_2',
    });
    expect(action.payload).toEqual({
      agentId: 'agent_1',
      conflictPolicy: signal.payload.conflictPolicy,
      evidence: signal.payload.evidence,
      feedbackHint: 'not_satisfied',
      idempotencyKey: 'root_source_2:skill:msg_skill_1',
      message: 'Turn this workflow into a reusable skill.',
      messageId: 'msg_skill_1',
      reason: 'The user requested durable workflow behavior.',
      serializedContext: payloadSerializedContext,
      sourceHints: signal.payload.sourceHints,
      topicId: 'topic_1',
    });
    expect(action.signal).toEqual({
      signalId: 'sig_skill_1',
      signalType: 'signal.feedback.domain.skill',
    });
    expect(action.source).toBe(signal.source);
    expect(action.timestamp).toBe(1);
  });
});
