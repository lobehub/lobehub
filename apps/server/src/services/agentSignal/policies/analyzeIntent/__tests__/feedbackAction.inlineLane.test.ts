// @vitest-environment node
import { RequestTrigger } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { createProcedurePolicyOptions } from '../../../procedure';
import { createRuntimeProcessorContext } from '../../../runtime/context';
import type { AgentSignalPolicyStateStore } from '../../../store/types';
import type { SignalFeedbackDomainSkill } from '../../types';
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

const createServerInboundSkillSignal = (trigger: string): SignalFeedbackDomainSkill => ({
  chain: { chainId: 'chain_1', parentNodeId: 'sig_skill_inline', rootSourceId: 'source_inline' },
  payload: {
    confidence: 0.9,
    conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 80 },
    evidence: [{ cue: 'test', excerpt: 'Research and build an MVP, then write a report.' }],
    message: 'Research and build an MVP, then write a report.',
    messageId: 'msg_skill_inline',
    reason: 'test-domain-signal',
    satisfactionResult: 'not_satisfied',
    skillActionIntent: 'create',
    skillIntentConfidence: 0.9,
    skillIntentExplicitness: 'implicit_strong_learning',
    skillIntentReason: 'a reusable task execution pattern',
    skillRoute: 'direct_decision',
    target: 'skill',
    trigger,
  },
  signalId: 'sig_skill_inline',
  signalType: 'signal.feedback.domain.skill',
  source: {
    payload: {
      serializedContext:
        '<feedback_analysis_context><message>context</message></feedback_analysis_context>',
    },
    sourceId: 'source_inline',
    sourceType: 'agent.user.message',
  },
  timestamp: 1,
});

describe('feedbackActionPlanner inline skill lane', () => {
  /**
   * Agent Signal self-iteration runs and task-result wakeups (whose sub-agents
   * inherit the trigger) are server-started follow-ups: a direct skill decision
   * dispatches inline instead of being parked for completion-stage synthesis.
   */
  it.each([RequestTrigger.AgentSignal, RequestTrigger.TaskCallback])(
    'dispatches a %s skill candidate inline instead of parking it',
    async (trigger) => {
      const procedure = createProcedurePolicyOptions({
        now: () => 123,
        policyStateStore: createStore(),
        ttlSeconds: 3600,
      });
      const writeIntentRecord = vi.spyOn(procedure.procedureState.skillIntentRecords!, 'write');
      const action = {
        actionId: 'action_inline',
        actionType: 'action.skill-management.handle' as const,
        payload: {},
      };
      const skillActions = {
        prepare: vi.fn(() => ({ action, reason: 'inline', risk: 'low' as const })),
      };
      const handler = createFeedbackActionPlannerSignalHandler({
        actionServices: {
          memoryActions: { prepare: vi.fn() },
          skillActions: skillActions as never,
        },
        procedure: { now: () => 123, procedureState: procedure.procedureState },
      });

      const result = await handler.handle(createServerInboundSkillSignal(trigger), context);

      expect(result).toEqual({ actions: [action], status: 'dispatch' });
      expect(writeIntentRecord).not.toHaveBeenCalled();
    },
  );

  it('still parks an ordinary server-inbound skill candidate', async () => {
    const procedure = createProcedurePolicyOptions({
      now: () => 123,
      policyStateStore: createStore(),
      ttlSeconds: 3600,
    });
    const skillActions = { prepare: vi.fn() };
    const handler = createFeedbackActionPlannerSignalHandler({
      actionServices: {
        memoryActions: { prepare: vi.fn() },
        skillActions: skillActions as never,
      },
      procedure: { now: () => 123, procedureState: procedure.procedureState },
    });

    const result = await handler.handle(
      createServerInboundSkillSignal(RequestTrigger.Chat),
      context,
    );

    expect(result).toEqual({
      concluded: { reason: 'skill candidate parked until agent.execution.completed' },
      status: 'conclude',
    });
    expect(skillActions.prepare).not.toHaveBeenCalled();
  });
});
