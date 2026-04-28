// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createRuntimeProcessorContext } from '../../../runtime/context';
import type {
  SignalFeedbackDomainMemory,
  SignalFeedbackDomainNone,
  SignalFeedbackDomainPrompt,
  SignalFeedbackDomainSkill,
} from '../../types';
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
          satisfactionResult: 'not_satisfied',
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
          satisfactionResult: 'not_satisfied',
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
          satisfactionResult: 'not_satisfied',
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
          satisfactionResult: 'not_satisfied',
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

  it('does not plan actions for unsupported future domains yet', async () => {
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

    expect(skillResult).toBeUndefined();
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
