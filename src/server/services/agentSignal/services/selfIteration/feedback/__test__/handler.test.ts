// @vitest-environment node
import { createSource } from '@lobechat/agent-signal';
import type { SourceAgentSelfFeedbackIntentDeclared } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultAgentSignalPolicies } from '../../../../policies';
import type { RuntimeProcessorContext } from '../../../../runtime/context';
import type {
  AgentSignalActionHandlerDefinition,
  AgentSignalSignalHandlerDefinition,
  AgentSignalSourceHandlerDefinition,
} from '../../../../runtime/middleware';
import type { EvidenceRef } from '../../types';
import { ReviewRunStatus } from '../../types';
import type { CreateSelfFeedbackIntentSourceHandlerDependencies } from '../handler';
import {
  createSelfFeedbackIntentSourceHandler,
  createSelfFeedbackIntentSourcePolicyHandler,
} from '../handler';

const intentPayload = {
  action: 'write',
  agentId: 'agent-1',
  confidence: 0.94,
  evidenceRefs: [
    {
      id: 'msg-1',
      summary: 'User asked to remember concise release summaries.',
      type: 'message',
    },
  ],
  kind: 'memory',
  reason: 'The user gave a durable preference.',
  summary: 'User prefers concise release summaries.',
  toolCallId: 'tool-call-1',
  topicId: 'topic-1',
  userId: 'user-1',
} as const;

const intentSourceId = 'self-feedback-intent:user-1:agent-1:topic:topic-1:tool-call-1';

const topicEvidence = {
  id: 'topic-1',
  summary: 'Current topic context.',
  type: 'topic',
} satisfies EvidenceRef;

const runtimeContext = {
  now: () => 100,
  runtimeState: {
    getGuardState: async () => ({}),
    touchGuardState: async () => ({}),
  },
  scopeKey: 'agent:agent-1',
} satisfies RuntimeProcessorContext;

const createIntentSource = (
  payload: Record<string, unknown> = intentPayload,
  sourceId = intentSourceId,
  sourceType = AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared,
): SourceAgentSelfFeedbackIntentDeclared =>
  createSource({
    payload,
    scope: { agentId: 'agent-1', userId: 'user-1' },
    scopeKey: 'topic:topic-1',
    sourceId,
    sourceType,
    timestamp: 100,
  }) as SourceAgentSelfFeedbackIntentDeclared;

const createDependencies = (
  overrides: Partial<CreateSelfFeedbackIntentSourceHandlerDependencies> = {},
): CreateSelfFeedbackIntentSourceHandlerDependencies => ({
  acquireReviewGuard: vi.fn(async () => true),
  canRunReview: vi.fn(async () => true),
  db: {} as never,
  dispatch: vi.fn(async () => ({ operationId: 'op-self-iter-1', topicId: 'topic-1' })),
  enrichEvidence: vi.fn(async () => ({
    evidenceRefs: [topicEvidence],
  })),
  maxSteps: 3,
  ...overrides,
});

describe('self-feedback intent source handler', () => {
  it('enriches evidence then dispatches an async run under the builtin self-feedback-intent slug', async () => {
    const deps = createDependencies();
    const handler = createSelfFeedbackIntentSourceHandler(deps);

    const result = await handler.handle(createIntentSource());

    expect(deps.enrichEvidence).toHaveBeenCalledWith({
      action: 'write',
      agentId: 'agent-1',
      kind: 'memory',
      scopeId: 'topic-1',
      scopeType: 'topic',
      toolCallId: 'tool-call-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });
    expect(deps.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        db: deps.db,
        marker: {
          agentId: 'agent-1',
          kind: 'self-feedback-intent',
          sourceId: intentSourceId,
          topicId: 'topic-1',
        },
        maxSteps: 3,
        // The intent + enrichment evidence is rendered into the prompt.
        prompt: expect.stringContaining(intentSourceId),
        slug: BUILTIN_AGENT_SLUGS.selfFeedbackIntent,
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    );
    // The combined evidence (declared + enrichment) rides in the prompt JSON.
    const dispatchArg = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(dispatchArg.prompt).toContain('topic-1');
    expect(dispatchArg.prompt).toContain('msg-1');

    expect(result).toEqual(
      expect.objectContaining({
        agentId: 'agent-1',
        operationId: 'op-self-iter-1',
        sourceId: intentSourceId,
        status: ReviewRunStatus.Dispatched,
        toolCallId: 'tool-call-1',
        userId: 'user-1',
      }),
    );
  });

  it('validates operation-scoped source ids and forwards operation context', async () => {
    const deps = createDependencies();
    const handler = createSelfFeedbackIntentSourceHandler(deps);
    const operationSourceId =
      'self-feedback-intent:user-1:agent-1:operation:operation-1:tool-call-1';

    await handler.handle(
      createIntentSource(
        {
          ...intentPayload,
          operationId: 'operation-1',
        },
        operationSourceId,
      ),
    );

    expect(deps.enrichEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'operation-1',
        scopeId: 'operation-1',
        scopeType: 'operation',
        topicId: 'topic-1',
      }),
    );
    expect(deps.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        marker: expect.objectContaining({ sourceId: operationSourceId }),
        prompt: expect.stringContaining(operationSourceId),
      }),
    );
  });

  it('requires the service-emitted tool call id for stable source verification', async () => {
    const deps = createDependencies();
    const handler = createSelfFeedbackIntentSourceHandler(deps);

    const result = await handler.handle(
      createIntentSource({
        ...intentPayload,
        toolCallId: undefined,
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('skips without enrichment or dispatch when the review gate is disabled', async () => {
    const deps = createDependencies({
      canRunReview: vi.fn(async () => false),
    });
    const handler = createSelfFeedbackIntentSourceHandler(deps);

    const result = await handler.handle(createIntentSource());

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'gate_disabled',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.acquireReviewGuard).not.toHaveBeenCalled();
    expect(deps.enrichEvidence).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('dedupes without enrichment or dispatch when the declaration guard already exists', async () => {
    const deps = createDependencies({
      acquireReviewGuard: vi.fn(async () => false),
    });
    const handler = createSelfFeedbackIntentSourceHandler(deps);

    const result = await handler.handle(createIntentSource());

    expect(result).toEqual(
      expect.objectContaining({
        guardKey: intentSourceId,
        status: ReviewRunStatus.Deduped,
      }),
    );
    expect(deps.enrichEvidence).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('returns skipped invalid when source id does not match the expected declaration key', async () => {
    const deps = createDependencies();
    const handler = createSelfFeedbackIntentSourceHandler(deps);

    const result = await handler.handle(
      createIntentSource(intentPayload, 'self-feedback-intent:wrong'),
    );

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        sourceId: 'self-feedback-intent:wrong',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('installs an optional self-feedback intent source policy through default policy composition', async () => {
    const sourceHandlers: AgentSignalSourceHandlerDefinition[] = [];
    const deps = createDependencies();
    const policies = createDefaultAgentSignalPolicies({
      feedbackSatisfactionJudge: {
        judge: {
          judgeSatisfaction: async () => ({
            confidence: 1,
            evidence: [],
            reason: 'No feedback in shared registration test.',
            result: 'neutral',
          }),
        },
      },
      selfFeedbackIntent: deps,
    });

    for (const policy of policies) {
      await policy.install({
        handleAction(handler: AgentSignalActionHandlerDefinition) {
          expect(handler.type).toBe('action');
        },
        handleSignal(handler: AgentSignalSignalHandlerDefinition) {
          expect(handler.type).toBe('signal');
        },
        handleSource(handler) {
          sourceHandlers.push(handler);
        },
      });
    }

    const selfFeedbackIntentHandler = sourceHandlers.find(
      (handler) => handler.listen === AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared,
    );

    expect(selfFeedbackIntentHandler).toEqual(
      expect.objectContaining({
        id: `${AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared}:shared-review`,
        type: 'source',
      }),
    );

    const runtimeResult = await selfFeedbackIntentHandler?.handle(
      createIntentSource(),
      runtimeContext,
    );

    expect(runtimeResult).toEqual(
      expect.objectContaining({
        concluded: expect.objectContaining({ status: ReviewRunStatus.Dispatched }),
        status: 'conclude',
      }),
    );
  });
});

describe('self-feedback intent source policy handler', () => {
  it('listens to the self-feedback intent declared source type', () => {
    const handler = createSelfFeedbackIntentSourcePolicyHandler(createDependencies());

    expect(handler.listen).toBe(AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared);
  });
});
