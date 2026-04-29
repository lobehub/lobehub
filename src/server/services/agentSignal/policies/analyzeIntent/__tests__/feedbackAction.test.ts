// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AgentSignalProcedureInspector, createProcedurePolicyOptions } from '../../../procedure';
import { createRuntimeProcessorContext } from '../../../runtime/context';
import type { AgentSignalPolicyStateStore } from '../../../store/types';
import type {
  ActionUserMemoryHandle,
  SignalFeedbackDomainMemory,
  SignalFeedbackDomainNone,
  SignalFeedbackDomainPrompt,
  SignalFeedbackDomainSkill,
} from '../../types';
import { createAnalyzeIntentPolicy } from '..';
import { createFeedbackActionPlannerSignalHandler } from '../feedbackAction';

const context = createRuntimeProcessorContext({
  backend: {
    async getGuardState() {
      return {};
    },
    async touchGuardState() {
      return {};
    },
  },
  scopeKey: 'topic:thread_1',
});

const createStore = (): AgentSignalPolicyStateStore => {
  const state = new Map<string, Record<string, string>>();

  return {
    readPolicyState: async (policyId, scopeKey) => state.get(`${policyId}:${scopeKey}`),
    writePolicyState: async (policyId, scopeKey, data) => {
      const key = `${policyId}:${scopeKey}`;
      state.set(key, { ...state.get(key), ...data });
    },
  };
};

type SupportedTask4DomainTarget = 'memory' | 'none' | 'prompt' | 'skill';

type DomainSignalVariantByTarget = {
  memory: SignalFeedbackDomainMemory;
  none: SignalFeedbackDomainNone;
  prompt: SignalFeedbackDomainPrompt;
  skill: SignalFeedbackDomainSkill;
};

type DomainSignalInput<TTarget extends SupportedTask4DomainTarget> = {
  message: string;
  messageId: string;
  satisfactionResult?: 'not_satisfied' | 'neutral' | 'satisfied';
  signalId: string;
  sourceId: string;
  target: TTarget;
};

function createDomainSignal(input: DomainSignalInput<'memory'>): SignalFeedbackDomainMemory;
function createDomainSignal(input: DomainSignalInput<'none'>): SignalFeedbackDomainNone;
function createDomainSignal(input: DomainSignalInput<'prompt'>): SignalFeedbackDomainPrompt;
function createDomainSignal(input: DomainSignalInput<'skill'>): SignalFeedbackDomainSkill;
function createDomainSignal(
  input: DomainSignalInput<SupportedTask4DomainTarget>,
): DomainSignalVariantByTarget[SupportedTask4DomainTarget] {
  const base = {
    chain: {
      chainId: 'chain_1',
      parentNodeId: input.signalId,
      rootSourceId: input.sourceId,
    },
    source: {
      payload: {
        serializedContext:
          '<feedback_analysis_context><message>context</message></feedback_analysis_context>',
      },
      sourceId: input.sourceId,
      sourceType: 'agent.user.message' as const,
    },
    timestamp: 1,
  };

  switch (input.target) {
    case 'memory': {
      return {
        ...base,
        payload: {
          confidence: 0.9,
          conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 100 },
          evidence: [{ cue: 'test', excerpt: input.message }],
          message: input.message,
          messageId: input.messageId,
          reason: 'test-domain-signal',
          satisfactionResult: input.satisfactionResult ?? 'not_satisfied',
          target: 'memory',
        },
        signalId: input.signalId,
        signalType: 'signal.feedback.domain.memory',
        timestamp: 1,
      };
    }
    case 'none': {
      return {
        ...base,
        payload: {
          confidence: 0.9,
          conflictPolicy: {
            forbiddenWith: ['memory', 'prompt', 'skill'],
            mode: 'exclusive',
            priority: 0,
          },
          evidence: [{ cue: 'test', excerpt: input.message }],
          message: input.message,
          messageId: input.messageId,
          reason: 'test-domain-signal',
          satisfactionResult: input.satisfactionResult ?? 'not_satisfied',
          target: 'none',
        },
        signalId: input.signalId,
        signalType: 'signal.feedback.domain.none',
        timestamp: 1,
      };
    }
    case 'prompt': {
      return {
        ...base,
        payload: {
          confidence: 0.9,
          conflictPolicy: {
            forbiddenWith: ['memory', 'none', 'skill'],
            mode: 'exclusive',
            priority: 90,
          },
          evidence: [{ cue: 'test', excerpt: input.message }],
          message: input.message,
          messageId: input.messageId,
          reason: 'test-domain-signal',
          satisfactionResult: input.satisfactionResult ?? 'not_satisfied',
          target: 'prompt',
        },
        signalId: input.signalId,
        signalType: 'signal.feedback.domain.prompt',
        timestamp: 1,
      };
    }
    case 'skill': {
      return {
        ...base,
        payload: {
          confidence: 0.9,
          conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 80 },
          evidence: [{ cue: 'test', excerpt: input.message }],
          message: input.message,
          messageId: input.messageId,
          reason: 'test-domain-signal',
          satisfactionResult: input.satisfactionResult ?? 'not_satisfied',
          target: 'skill',
        },
        signalId: input.signalId,
        signalType: 'signal.feedback.domain.skill',
        timestamp: 1,
      };
    }
  }
}

describe('feedbackActionPlanner', () => {
  /**
   * @example
   * composed procedure dependencies expose the procedure state service and install in policy order.
   */
  it('passes composed procedure state through analyze-intent policy options', async () => {
    const procedure = createProcedurePolicyOptions({
      policyStateStore: createStore(),
      ttlSeconds: 3600,
    });
    const installed: string[] = [];

    await createAnalyzeIntentPolicy({
      feedbackSatisfactionJudge: {
        judge: {
          judgeSatisfaction: async () => ({
            confidence: 0.9,
            evidence: [{ cue: 'test', excerpt: 'test' }],
            reason: 'test-satisfaction-judge',
            result: 'not_satisfied',
          }),
        },
      },
      procedure,
    }).install({
      handleAction: (handler) => {
        installed.push(`${handler.type}:${handler.id}`);
      },
      handleSignal: (handler) => {
        installed.push(`${handler.type}:${handler.id}`);
      },
      handleSource: (handler) => {
        installed.push(`${handler.type}:${handler.id}`);
      },
    });

    expect(procedure.procedureState).toEqual(
      expect.objectContaining({
        accumulators: expect.any(Object),
        markers: expect.any(Object),
        receipts: expect.any(Object),
        records: expect.any(Object),
      }),
    );
    expect(installed).toEqual([
      'source:source.tool-outcome.procedure',
      'source:agent.user.message:feedback-satisfaction-judge',
      'signal:signal.feedback-domain-judge',
      'signal:signal.feedback-action-planner',
    ]);
  });

  it('creates stable idempotency keys for memory actions', async () => {
    const handler = createFeedbackActionPlannerSignalHandler();
    const signal = createDomainSignal({
      message: 'Remember this preference.',
      messageId: 'msg_1',
      signalId: 'sig_1',
      sourceId: 'source_1',
      target: 'memory',
    });

    const first = await handler.handle(signal, context);
    const second = await handler.handle(signal, context);

    expect(first).toEqual(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            actionType: 'action.user-memory.handle',
            payload: expect.objectContaining({
              feedbackHint: 'not_satisfied',
              idempotencyKey: 'source_1:memory:msg_1',
              serializedContext:
                '<feedback_analysis_context><message>context</message></feedback_analysis_context>',
            }),
          }),
        ],
      }),
    );
    expect(second).toEqual(first);
  });

  /**
   * @example
   * action services own memory action preparation while the handler only dispatches the plan.
   */
  it('dispatches memory action plans prepared by injected action services', async () => {
    const action = {
      actionId: 'action:custom-memory',
      actionType: 'action.user-memory.handle' as const,
      chain: {
        chainId: 'chain_1',
        parentNodeId: 'sig_action_service',
        parentSignalId: 'sig_action_service',
        rootSourceId: 'source_action_service',
      },
      payload: {
        agentId: undefined,
        conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout' as const, priority: 100 },
        evidence: [],
        feedbackHint: 'not_satisfied' as const,
        idempotencyKey: 'custom-memory-key',
        message: 'Remember this preference.',
        messageId: 'msg_action_service',
        reason: 'custom action service',
        sourceHints: {},
        topicId: undefined,
      },
      signal: {
        signalId: 'sig_action_service',
        signalType: 'signal.feedback.domain.memory',
      },
      source: {
        sourceId: 'source_action_service',
        sourceType: 'agent.user.message' as const,
      },
      timestamp: 1,
    } satisfies ActionUserMemoryHandle;
    const prepare = vi.fn(() => ({
      action,
      reason: 'custom memory action plan',
      risk: 'low' as const,
    }));
    const handler = createFeedbackActionPlannerSignalHandler({
      actionServices: {
        memoryActions: { prepare },
      },
    });
    const signal = createDomainSignal({
      message: 'Remember this preference.',
      messageId: 'msg_action_service',
      signalId: 'sig_action_service',
      sourceId: 'source_action_service',
      target: 'memory',
    });

    const result = await handler.handle(signal, context);

    expect(prepare).toHaveBeenCalledWith(signal);
    expect(result).toEqual({
      actions: [action],
      status: 'dispatch',
    });
  });

  it('plans skill-management actions for skill domain signals', async () => {
    const handler = createFeedbackActionPlannerSignalHandler();
    const skillResult = await handler.handle(
      createDomainSignal({
        message: 'This successful workflow should become a reusable skill.',
        messageId: 'msg_2',
        signalId: 'sig_2',
        sourceId: 'source_2',
        target: 'skill',
      }),
      context,
    );

    expect(skillResult).toEqual(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            actionType: 'action.skill-management.handle',
            payload: expect.objectContaining({
              idempotencyKey: 'source_2:skill:msg_2',
              message: 'This successful workflow should become a reusable skill.',
              serializedContext:
                '<feedback_analysis_context><message>context</message></feedback_analysis_context>',
            }),
          }),
        ],
        status: 'dispatch',
      }),
    );
  });

  it('does not directly handle satisfied skill domain signals', async () => {
    const handler = createFeedbackActionPlannerSignalHandler();
    const result = await handler.handle(
      createDomainSignal({
        message: 'This successful workflow can be kept as a reference.',
        messageId: 'msg_skill_positive',
        satisfactionResult: 'satisfied',
        signalId: 'sig_skill_positive',
        sourceId: 'source_skill_positive',
        target: 'skill',
      }),
      context,
    );

    expect(result).toBeUndefined();
  });

  /**
   * @example
   * repeated satisfied skill feedback writes candidate records, then emits an accumulated marker.
   */
  it('accumulates satisfied skill feedback into a scored skill procedure bucket', async () => {
    let now = 100;
    const store = createStore();
    const procedure = createProcedurePolicyOptions({
      now: () => now,
      policyStateStore: store,
      ttlSeconds: 3600,
    });
    const handler = createFeedbackActionPlannerSignalHandler({
      markerReader: procedure.markerReader,
      procedure,
    });

    const first = await handler.handle(
      createDomainSignal({
        message: 'This successful workflow can be kept as a reference.',
        messageId: 'msg_skill_positive_1',
        satisfactionResult: 'satisfied',
        signalId: 'sig_skill_positive_1',
        sourceId: 'source_skill_positive_1',
        target: 'skill',
      }),
      context,
    );
    now = 130;
    const second = await handler.handle(
      createDomainSignal({
        message: 'The review flow from earlier is worth reusing next time.',
        messageId: 'msg_skill_positive_2',
        satisfactionResult: 'satisfied',
        signalId: 'sig_skill_positive_2',
        sourceId: 'source_skill_positive_2',
        target: 'skill',
      }),
      context,
    );
    const snapshot = await new AgentSignalProcedureInspector(store).inspectScope('topic:thread_1');

    expect(first).toBeUndefined();
    expect(second).toEqual(
      expect.objectContaining({
        actions: [],
        signals: [
          expect.objectContaining({
            payload: expect.objectContaining({
              bucketKey: 'topic:thread_1:skill',
              domain: 'skill',
              recordIds: [
                'procedure-record:sig_skill_positive_1:skill-candidate',
                'procedure-record:sig_skill_positive_2:skill-candidate',
              ],
              suggestedActions: ['maintain'],
            }),
            signalType: 'signal.procedure.bucket.scored',
          }),
        ],
        status: 'dispatch',
      }),
    );
    expect(snapshot.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accumulatorRole: 'candidate',
          domainKey: 'skill',
          id: 'procedure-record:sig_skill_positive_1:skill-candidate',
        }),
        expect.objectContaining({
          accumulatorRole: 'candidate',
          domainKey: 'skill',
          id: 'procedure-record:sig_skill_positive_2:skill-candidate',
        }),
      ]),
    );
    expect(snapshot.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domainKey: 'skill',
          markerType: 'accumulated',
        }),
      ]),
    );
    expect(snapshot.accumulatorFields).toEqual(
      expect.objectContaining({
        bucketKey: 'topic:thread_1:skill',
        domain: 'skill',
      }),
    );
  });

  /**
   * @example
   * procedureState-only dependencies support weak satisfied skill accumulation.
   */
  it('accumulates satisfied skill feedback through procedure state service', async () => {
    let now = 100;
    const store = createStore();
    const procedure = createProcedurePolicyOptions({
      now: () => now,
      policyStateStore: store,
      ttlSeconds: 3600,
    });
    const handler = createFeedbackActionPlannerSignalHandler({
      procedure: {
        procedureState: procedure.procedureState,
      },
    });

    const first = await handler.handle(
      createDomainSignal({
        message: 'This successful workflow can be kept as a reference.',
        messageId: 'msg_skill_state_positive_1',
        satisfactionResult: 'satisfied',
        signalId: 'sig_skill_state_positive_1',
        sourceId: 'source_skill_state_positive_1',
        target: 'skill',
      }),
      context,
    );
    now = 130;
    const second = await handler.handle(
      createDomainSignal({
        message: 'The review flow from earlier is worth reusing next time.',
        messageId: 'msg_skill_state_positive_2',
        satisfactionResult: 'satisfied',
        signalId: 'sig_skill_state_positive_2',
        sourceId: 'source_skill_state_positive_2',
        target: 'skill',
      }),
      context,
    );
    const snapshot = await new AgentSignalProcedureInspector(store).inspectScope('topic:thread_1');

    expect(first).toBeUndefined();
    expect(second).toEqual(
      expect.objectContaining({
        signals: [
          expect.objectContaining({
            payload: expect.objectContaining({
              bucketKey: 'topic:thread_1:skill',
              domain: 'skill',
              recordIds: [
                'procedure-record:sig_skill_state_positive_1:skill-candidate',
                'procedure-record:sig_skill_state_positive_2:skill-candidate',
              ],
              suggestedActions: ['maintain'],
            }),
            signalType: 'signal.procedure.bucket.scored',
          }),
        ],
        status: 'dispatch',
      }),
    );
    expect(snapshot.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domainKey: 'skill',
          markerType: 'accumulated',
          signalId: 'sig_skill_state_positive_2:signal:procedure-accumulated',
        }),
      ]),
    );
  });

  /**
   * @example
   * one context skill record plus one weak candidate stays below accumulated marker threshold.
   */
  it('does not accumulate context plus one satisfied skill candidate', async () => {
    let now = 100;
    const store = createStore();
    const procedure = createProcedurePolicyOptions({
      now: () => now,
      policyStateStore: store,
      ttlSeconds: 3600,
    });
    const handler = createFeedbackActionPlannerSignalHandler({
      markerReader: procedure.markerReader,
      procedure,
    });

    await procedure.accumulator.appendRecord({
      accumulatorRole: 'context',
      cheapScoreDelta: 0,
      createdAt: 90,
      domainKey: 'skill',
      id: 'procedure-record:direct-skill-context',
      refs: {},
      scopeKey: 'topic:thread_1',
      status: 'handled',
    });
    now = 130;

    const result = await handler.handle(
      createDomainSignal({
        message: 'This workflow was useful and can be kept as reference.',
        messageId: 'msg_skill_positive_single',
        satisfactionResult: 'satisfied',
        signalId: 'sig_skill_positive_single',
        sourceId: 'source_skill_positive_single',
        target: 'skill',
      }),
      context,
    );
    const snapshot = await new AgentSignalProcedureInspector(store).inspectScope('topic:thread_1');

    expect(result).toBeUndefined();
    expect(snapshot.markers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domainKey: 'skill',
          markerType: 'accumulated',
        }),
      ]),
    );
    expect(snapshot.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accumulatorRole: 'candidate',
          domainKey: 'skill',
          id: 'procedure-record:sig_skill_positive_single:skill-candidate',
        }),
      ]),
    );
  });

  it('does not plan actions for unsupported prompt domain yet', async () => {
    const handler = createFeedbackActionPlannerSignalHandler();
    const promptResult = await handler.handle(
      createDomainSignal({
        message: 'Stop saying "Below is a detailed analysis" before every answer.',
        messageId: 'msg_2_prompt',
        signalId: 'sig_2_prompt',
        sourceId: 'source_2_prompt',
        target: 'prompt',
      }),
      context,
    );

    expect(promptResult).toBeUndefined();
  });

  it('dispatches memory actions without requiring preplanned memory payloads', async () => {
    const handler = createFeedbackActionPlannerSignalHandler();
    const result = await handler.handle(
      createDomainSignal({
        message: 'Remember this preference.',
        messageId: 'msg_4',
        signalId: 'sig_4',
        sourceId: 'source_4',
        target: 'memory',
      }),
      context,
    );

    expect(result).toEqual(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            actionType: 'action.user-memory.handle',
            payload: expect.objectContaining({
              evidence: [{ cue: 'test', excerpt: 'Remember this preference.' }],
              feedbackHint: 'not_satisfied',
              idempotencyKey: 'source_4:memory:msg_4',
              message: 'Remember this preference.',
              reason: 'test-domain-signal',
              serializedContext:
                '<feedback_analysis_context><message>context</message></feedback_analysis_context>',
            }),
          }),
        ],
        status: 'dispatch',
      }),
    );
  });

  it('does not plan actions for explicit no-op domain signals', async () => {
    const handler = createFeedbackActionPlannerSignalHandler();
    const result = await handler.handle(
      createDomainSignal({
        message: 'Thanks.',
        messageId: 'msg_3',
        signalId: 'sig_3',
        sourceId: 'source_3',
        target: 'none',
      }),
      context,
    );

    expect(result).toBeUndefined();
  });
});

describe('procedure marker suppression', () => {
  /**
   * @example
   * handled memory marker suppresses action.user-memory.handle.
   */
  it('suppresses memory action when marker reader reports handled same-source procedure', async () => {
    const shouldSuppress = vi.fn(async () => true);
    const handler = createFeedbackActionPlannerSignalHandler({
      markerReader: { shouldSuppress },
    });
    const signal = createDomainSignal({
      message: '记住我喜欢简洁回答',
      messageId: 'msg_1',
      signalId: 'sig_procedure_1',
      sourceId: 'source_procedure_1',
      target: 'memory',
    });

    const result = await handler.handle(signal, {
      now: () => 100,
      scopeKey: 'topic:t1',
    } as never);

    expect(result).toEqual(
      expect.objectContaining({
        signals: [
          expect.objectContaining({
            payload: expect.objectContaining({ suggestedActions: ['suppressed'] }),
            signalType: 'signal.procedure.bucket.scored',
          }),
        ],
        status: 'dispatch',
      }),
    );
    expect(shouldSuppress).toHaveBeenCalledWith(
      expect.objectContaining({ domainKey: 'memory:user-preference' }),
    );
  });

  /**
   * @example
   * absent marker keeps original memory action path.
   */
  it('keeps memory action when marker reader does not suppress', async () => {
    const handler = createFeedbackActionPlannerSignalHandler({
      markerReader: { shouldSuppress: vi.fn(async () => false) },
    });
    const signal = createDomainSignal({
      message: '记住我喜欢简洁回答',
      messageId: 'msg_1',
      signalId: 'sig_procedure_2',
      sourceId: 'source_procedure_2',
      target: 'memory',
    });

    const result = await handler.handle(signal, {
      now: () => 100,
      scopeKey: 'topic:t1',
    } as never);

    expect(result).toEqual(
      expect.objectContaining({
        actions: [expect.objectContaining({ actionType: 'action.user-memory.handle' })],
        status: 'dispatch',
      }),
    );
  });
});
