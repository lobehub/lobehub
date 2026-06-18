// @vitest-environment node
import { createSource } from '@lobechat/agent-signal';
import type { SourceAgentSelfReflectionRequested } from '@lobechat/agent-signal/source';
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
import { ReviewRunStatus } from '../../types';
import type {
  CreateSelfReflectionSourceHandlerDependencies,
  SelfReflectionReviewContext,
} from '../handler';
import {
  createSelfReflectionSourceHandler,
  createSelfReflectionSourcePolicyHandler,
} from '../handler';

const reflectionPayload = {
  agentId: 'agent-1',
  operationId: 'operation-1',
  reason: 'failed_tool_count',
  scopeId: 'task-1',
  scopeType: 'task',
  taskId: 'task-1',
  topicId: 'topic-1',
  userId: 'user-1',
  windowEnd: '2026-05-04T14:30:00.000Z',
  windowStart: '2026-05-04T14:00:00.000Z',
} as const;

const reflectionSourceId =
  'self-reflection:user-1:agent-1:task:task-1:failed_tool_count:2026-05-04T14:00:00.000Z:2026-05-04T14:30:00.000Z';

const runtimeContext = {
  now: () => 100,
  runtimeState: {
    getGuardState: async () => ({}),
    touchGuardState: async () => ({}),
  },
  scopeKey: 'agent:agent-1',
} satisfies RuntimeProcessorContext;

const createReflectionSource = (
  payload: Record<string, unknown> = reflectionPayload,
  sourceType = AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
): SourceAgentSelfReflectionRequested =>
  createSource({
    payload,
    scope: { agentId: 'agent-1', userId: 'user-1' },
    scopeKey: 'agent:agent-1',
    sourceId: reflectionSourceId,
    sourceType,
    timestamp: 100,
  }) as SourceAgentSelfReflectionRequested;

const reflectionContext = {
  agentId: 'agent-1',
  evidence: [{ id: 'task-1', type: 'task' }],
  operationId: 'operation-1',
  scopeId: 'task-1',
  scopeType: 'task',
  taskId: 'task-1',
  topicId: 'topic-1',
  userId: 'user-1',
  windowEnd: reflectionPayload.windowEnd,
  windowStart: reflectionPayload.windowStart,
} satisfies SelfReflectionReviewContext;

const createDependencies = (
  overrides: Partial<CreateSelfReflectionSourceHandlerDependencies> = {},
): CreateSelfReflectionSourceHandlerDependencies => ({
  acquireReviewGuard: vi.fn(async () => true),
  canRunReview: vi.fn(async () => true),
  collectContext: vi.fn(async () => reflectionContext),
  db: {} as never,
  dispatch: vi.fn(async () => ({ operationId: 'op-self-iter-1', topicId: 'topic-1' })),
  maxSteps: 3,
  ...overrides,
});

describe('self-reflection source handler', () => {
  it('dispatches an async self-iteration run under the builtin self-reflection slug', async () => {
    const deps = createDependencies();
    const handler = createSelfReflectionSourceHandler(deps);

    const result = await handler.handle(createReflectionSource());

    expect(deps.collectContext).toHaveBeenCalledWith({
      agentId: 'agent-1',
      operationId: 'operation-1',
      scopeId: 'task-1',
      scopeType: 'task',
      taskId: 'task-1',
      topicId: 'topic-1',
      userId: 'user-1',
      windowEnd: reflectionPayload.windowEnd,
      windowStart: reflectionPayload.windowStart,
    });
    expect(deps.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        db: deps.db,
        marker: {
          agentId: 'agent-1',
          kind: 'self-reflection',
          sourceId: reflectionSourceId,
          topicId: 'topic-1',
        },
        maxSteps: 3,
        // The bounded evidence is rendered into the prompt (no collector at run time).
        prompt: expect.stringContaining(reflectionSourceId),
        slug: BUILTIN_AGENT_SLUGS.selfReflection,
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        agentId: 'agent-1',
        operationId: 'op-self-iter-1',
        sourceId: reflectionSourceId,
        status: ReviewRunStatus.Dispatched,
        userId: 'user-1',
      }),
    );
  });

  it('re-checks the gate then acquires the idempotency guard before dispatching', async () => {
    const deps = createDependencies();
    const handler = createSelfReflectionSourceHandler(deps);

    await handler.handle(createReflectionSource());

    expect(deps.canRunReview).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        guardKey: reflectionSourceId,
        reason: 'failed_tool_count',
        scopeId: 'task-1',
        scopeType: 'task',
        userId: 'user-1',
      }),
    );
    expect(deps.acquireReviewGuard).toHaveBeenCalledWith(
      expect.objectContaining({ guardKey: reflectionSourceId }),
    );
  });

  it('returns deduped without collecting or dispatching when the review guard is held', async () => {
    const deps = createDependencies({
      acquireReviewGuard: vi.fn(async () => false),
    });
    const handler = createSelfReflectionSourceHandler(deps);

    const result = await handler.handle(createReflectionSource());

    expect(result).toEqual(
      expect.objectContaining({
        guardKey: reflectionSourceId,
        status: ReviewRunStatus.Deduped,
      }),
    );
    expect(deps.collectContext).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('returns skipped without acquiring the guard when gates reject the review', async () => {
    const deps = createDependencies({
      canRunReview: vi.fn(async () => false),
    });
    const handler = createSelfReflectionSourceHandler(deps);

    const result = await handler.handle(createReflectionSource());

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'gate_disabled',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.acquireReviewGuard).not.toHaveBeenCalled();
    expect(deps.collectContext).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('returns skipped invalid without throwing for invalid payloads', async () => {
    const deps = createDependencies();
    const handler = createSelfReflectionSourceHandler(deps);

    const result = await handler.handle(
      createReflectionSource({ agentId: 'agent-1', userId: 'user-1' }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
    expect(deps.acquireReviewGuard).not.toHaveBeenCalled();
    expect(deps.collectContext).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('returns skipped invalid when scope type is outside the supported set', async () => {
    const deps = createDependencies();
    const handler = createSelfReflectionSourceHandler(deps);

    const result = await handler.handle(
      createReflectionSource({
        ...reflectionPayload,
        scopeType: 'session',
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
  });

  it('returns skipped invalid when source id does not match the expected self-reflection key', async () => {
    const deps = createDependencies();
    const handler = createSelfReflectionSourceHandler(deps);

    const mismatchedSource = {
      ...createReflectionSource(),
      sourceId:
        'self-reflection:user-1:agent-1:task:task-1:wrong:2026-05-04T14:00:00.000Z:2026-05-04T14:30:00.000Z',
    } satisfies SourceAgentSelfReflectionRequested;
    const result = await handler.handle(mismatchedSource);

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        sourceId:
          'self-reflection:user-1:agent-1:task:task-1:wrong:2026-05-04T14:00:00.000Z:2026-05-04T14:30:00.000Z',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
    expect(deps.acquireReviewGuard).not.toHaveBeenCalled();
    expect(deps.collectContext).not.toHaveBeenCalled();
  });

  it('installs an optional self-reflection source policy through default policy composition', async () => {
    const sourceHandlers: AgentSignalSourceHandlerDefinition[] = [];
    const deps = createDependencies();
    const policies = createDefaultAgentSignalPolicies({
      feedbackSatisfactionJudge: {
        judge: {
          judgeSatisfaction: async () => ({
            confidence: 1,
            evidence: [],
            reason: 'No feedback in self-reflection registration test.',
            result: 'neutral',
          }),
        },
      },
      selfReflection: deps,
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

    const selfReflectionHandler = sourceHandlers.find(
      (handler) => handler.listen === AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
    );

    expect(selfReflectionHandler).toEqual(
      expect.objectContaining({
        id: `${AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested}:shared-review`,
        type: 'source',
      }),
    );

    const runtimeResult = await selfReflectionHandler?.handle(
      createReflectionSource(),
      runtimeContext,
    );

    expect(runtimeResult).toEqual(
      expect.objectContaining({
        concluded: expect.objectContaining({ status: ReviewRunStatus.Dispatched }),
        status: 'conclude',
      }),
    );
  });

  it('does not install self-reflection source handlers without self-reflection dependencies', async () => {
    const sourceHandlers: AgentSignalSourceHandlerDefinition[] = [];
    const policies = createDefaultAgentSignalPolicies({
      feedbackSatisfactionJudge: {
        judge: {
          judgeSatisfaction: async () => ({
            confidence: 1,
            evidence: [],
            reason: 'No feedback in self-reflection registration test.',
            result: 'neutral',
          }),
        },
      },
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

    const selfReflectionHandler = sourceHandlers.find(
      (handler) => handler.listen === AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
    );

    expect(selfReflectionHandler).toBeUndefined();
  });
});

describe('self-reflection source policy handler', () => {
  it('listens to the self-reflection requested source type', () => {
    const handler = createSelfReflectionSourcePolicyHandler(createDependencies());

    expect(handler.listen).toBe(AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested);
  });
});
