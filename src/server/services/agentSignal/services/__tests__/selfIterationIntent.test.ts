import { describe, expect, it, vi } from 'vitest';

import type { AgentSignalSourceEventInput } from '@/server/services/agentSignal/emitter';

import type { SelfIterationIntentAction, SelfIterationIntentKind } from '../selfIterationIntent';
import { createSelfIterationIntentService } from '../selfIterationIntent';

const createStrongIntentInput = () => ({
  action: 'refine' as const,
  confidence: 0.92,
  evidenceRefs: [{ id: 'msg-1', type: 'message' as const }],
  kind: 'skill' as const,
  reason: 'The agent noticed a reusable release-note correction.',
  summary: 'Refine release note workflow skill.',
});

const createEnqueueSource = () =>
  vi
    .fn<
      (
        input: AgentSignalSourceEventInput<'agent.self_iteration_intent.declared'>,
      ) => Promise<unknown>
    >()
    .mockResolvedValue({ enqueued: true });

describe('selfIterationIntent', () => {
  /**
   * @example
   * declareSelfIterationIntent emits a source and does not mutate resources.
   */
  it('emits declared intent source events', async () => {
    const enqueueSource = createEnqueueSource();
    const service = createSelfIterationIntentService({
      enqueueSource,
      nextToolCallId: () => 'tool-call-1',
    });

    const result = await service.declareIntent({
      agentId: 'agent-1',
      input: createStrongIntentInput(),
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      accepted: true,
      sourceId: 'self-iteration-intent:user-1:agent-1:topic:topic-1:tool-call-1',
      strength: 'strong',
    });
    expect(enqueueSource).toHaveBeenCalledWith({
      payload: {
        action: 'refine',
        agentId: 'agent-1',
        confidence: 0.92,
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        kind: 'skill',
        reason: 'The agent noticed a reusable release-note correction.',
        summary: 'Refine release note workflow skill.',
        toolCallId: 'tool-call-1',
        topicId: 'topic-1',
        userId: 'user-1',
      },
      scopeKey: 'topic:topic-1',
      sourceId: 'self-iteration-intent:user-1:agent-1:topic:topic-1:tool-call-1',
      sourceType: 'agent.self_iteration_intent.declared',
    });
  });

  /**
   * @example
   * Empty evidence is accepted as a source but marked weak for downstream downgrade.
   */
  it('marks evidence-poor declarations as weak', async () => {
    const service = createSelfIterationIntentService({
      enqueueSource: createEnqueueSource(),
      nextToolCallId: () => 'tool-call-1',
    });

    await expect(
      service.declareIntent({
        agentId: 'agent-1',
        input: {
          action: 'write',
          confidence: 0.6,
          kind: 'memory',
          reason: 'Maybe remember this.',
          summary: 'Weak candidate.',
        },
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ accepted: true, strength: 'weak' });
  });

  /**
   * @example
   * The fourth accepted declaration in the same topic returns a rate-limited result.
   */
  it('rate limits after three accepted declarations in one topic scope', async () => {
    const enqueueSource = createEnqueueSource();
    const service = createSelfIterationIntentService({
      enqueueSource,
      nextToolCallId: vi
        .fn()
        .mockReturnValueOnce('tool-call-1')
        .mockReturnValueOnce('tool-call-2')
        .mockReturnValueOnce('tool-call-3')
        .mockReturnValueOnce('tool-call-4'),
    });

    for (const toolCallId of ['tool-call-1', 'tool-call-2', 'tool-call-3']) {
      await expect(
        service.declareIntent({
          agentId: 'agent-1',
          input: createStrongIntentInput(),
          toolCallId,
          topicId: 'topic-1',
          userId: 'user-1',
        }),
      ).resolves.toMatchObject({ accepted: true });
    }

    await expect(
      service.declareIntent({
        agentId: 'agent-1',
        input: createStrongIntentInput(),
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ accepted: false, reason: 'rate_limited', strength: 'strong' });
    expect(enqueueSource).toHaveBeenCalledTimes(3);
  });

  /**
   * @example
   * Caller-provided tool-call ids produce stable source ids and do not consume generated ids.
   */
  it('uses explicit toolCallId without calling nextToolCallId', async () => {
    const nextToolCallId = vi.fn(() => 'generated-tool-call');
    const enqueueSource = createEnqueueSource();
    const service = createSelfIterationIntentService({
      enqueueSource,
      nextToolCallId,
    });

    await expect(
      service.declareIntent({
        agentId: 'agent-1',
        input: createStrongIntentInput(),
        toolCallId: 'explicit-tool-call',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({
      sourceId: 'self-iteration-intent:user-1:agent-1:topic:topic-1:explicit-tool-call',
    });

    expect(nextToolCallId).not.toHaveBeenCalled();
  });

  /**
   * @example
   * Invalid action, kind, or confidence declarations return rejection reasons and do not enqueue.
   */
  it('rejects invalid action kind and confidence declarations', async () => {
    const enqueueSource = createEnqueueSource();
    const service = createSelfIterationIntentService({
      enqueueSource,
      nextToolCallId: () => 'tool-call-1',
    });

    await expect(
      service.declareIntent({
        agentId: 'agent-1',
        input: {
          ...createStrongIntentInput(),
          action: 'delete' as unknown as SelfIterationIntentAction,
        },
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ accepted: false, reason: 'invalid_action', strength: 'weak' });
    await expect(
      service.declareIntent({
        agentId: 'agent-1',
        input: {
          ...createStrongIntentInput(),
          kind: 'preference' as unknown as SelfIterationIntentKind,
        },
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ accepted: false, reason: 'invalid_kind', strength: 'weak' });
    await expect(
      service.declareIntent({
        agentId: 'agent-1',
        input: {
          ...createStrongIntentInput(),
          confidence: 1.1,
        },
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ accepted: false, reason: 'invalid_confidence', strength: 'weak' });
    await expect(
      service.declareIntent({
        agentId: 'agent-1',
        input: {
          ...createStrongIntentInput(),
          action: 'delete' as unknown as SelfIterationIntentAction,
          confidence: Number.NaN,
        },
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ accepted: false, reason: 'invalid_action', strength: 'weak' });
    expect(enqueueSource).not.toHaveBeenCalled();
  });

  /**
   * @example
   * Operation-scoped declarations rate-limit independently from the surrounding topic.
   */
  it('uses operationId as the rate-limit scope when present', async () => {
    const enqueueSource = createEnqueueSource();
    const service = createSelfIterationIntentService({
      enqueueSource,
      nextToolCallId: vi
        .fn()
        .mockReturnValueOnce('op-tool-call-1')
        .mockReturnValueOnce('op-tool-call-2')
        .mockReturnValueOnce('op-tool-call-3')
        .mockReturnValueOnce('topic-tool-call-1'),
    });

    for (const toolCallId of ['op-tool-call-1', 'op-tool-call-2', 'op-tool-call-3']) {
      await service.declareIntent({
        agentId: 'agent-1',
        input: createStrongIntentInput(),
        operationId: 'operation-1',
        toolCallId,
        topicId: 'topic-1',
        userId: 'user-1',
      });
    }

    await expect(
      service.declareIntent({
        agentId: 'agent-1',
        input: createStrongIntentInput(),
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ accepted: true });
    expect(enqueueSource).toHaveBeenLastCalledWith(
      expect.objectContaining({ scopeKey: 'topic:topic-1' }),
    );
    expect(enqueueSource).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ operationId: 'operation-1' }),
        sourceId: 'self-iteration-intent:user-1:agent-1:operation:operation-1:op-tool-call-1',
        scopeKey: 'operation:operation-1',
      }),
    );
  });

  /**
   * @example
   * Matching tool-call ids in different scopes produce different source ids.
   */
  it('includes operation or topic scope identity in source ids', async () => {
    const enqueueSource = createEnqueueSource();
    const service = createSelfIterationIntentService({
      enqueueSource,
      nextToolCallId: () => 'shared-tool-call',
    });

    const operationResult = await service.declareIntent({
      agentId: 'agent-1',
      input: createStrongIntentInput(),
      operationId: 'operation-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });
    const topicResult = await service.declareIntent({
      agentId: 'agent-1',
      input: createStrongIntentInput(),
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(operationResult.sourceId).toBe(
      'self-iteration-intent:user-1:agent-1:operation:operation-1:shared-tool-call',
    );
    expect(topicResult.sourceId).toBe(
      'self-iteration-intent:user-1:agent-1:topic:topic-1:shared-tool-call',
    );
    expect(operationResult.sourceId).not.toBe(topicResult.sourceId);
  });

  /**
   * @example
   * Gates can reject declarations before enqueueing source events.
   */
  it('honors declaration and enqueue gates', async () => {
    const enqueueSource = createEnqueueSource();
    const blockedDeclarationService = createSelfIterationIntentService({
      canDeclareIntent: vi.fn().mockResolvedValue(false),
      enqueueSource,
      nextToolCallId: () => 'tool-call-1',
    });
    const blockedEnqueueService = createSelfIterationIntentService({
      canEnqueue: vi.fn().mockResolvedValue(false),
      enqueueSource,
      nextToolCallId: () => 'tool-call-1',
    });

    await expect(
      blockedDeclarationService.declareIntent({
        agentId: 'agent-1',
        input: createStrongIntentInput(),
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({
      accepted: false,
      reason: 'intent_gate_rejected',
      strength: 'strong',
    });
    await expect(
      blockedEnqueueService.declareIntent({
        agentId: 'agent-1',
        input: createStrongIntentInput(),
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({
      accepted: false,
      reason: 'enqueue_gate_rejected',
      sourceId: 'self-iteration-intent:user-1:agent-1:topic:topic-1:tool-call-1',
      strength: 'strong',
    });
    expect(enqueueSource).not.toHaveBeenCalled();
  });
});
