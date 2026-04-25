// @vitest-environment node
import { createAction, createSignal } from '@lobechat/agent-signal';
import { agents, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { describe, expect, it } from 'vitest';

import { UserMemoryModel } from '@/database/models/userMemory';
import { type AgentSignalSourceEnvelope } from '@/server/services/agentSignal';
import { projectAgentSignalObservability } from '@/server/services/agentSignal/observability/projector';
import { createAgentSignalRuntime } from '@/server/services/agentSignal/runtime/AgentSignalRuntime';
import {
  defineActionHandler,
  defineAgentSignalHandlers,
  defineSignalHandler,
  defineSourceHandler,
} from '@/server/services/agentSignal/runtime/middleware';
import { emitSourceEvent } from '@/server/services/agentSignal/sources';
import type { AgentSignalSourceType } from '@/server/services/agentSignal/sourceTypes';
import type { AgentSignalSourceEventStore } from '@/server/services/agentSignal/store/types';
import {
  runAgentSignalWorkflow,
  type RunAgentSignalWorkflowDeps,
} from '@/server/workflows/agentSignal/run';
import { uuid } from '@/utils/uuid';

interface WorkflowScenarioCase {
  expected: {
    memory?: {
      descriptionIncludes: string;
      type: string;
    };
  };
  id: string;
  scenario: {
    payload: {
      agentId?: string;
      documentPayload?: Record<string, unknown>;
      intents?: Array<'document' | 'memory' | 'persona' | 'prompt'>;
      memoryPayload?: Record<string, unknown>;
      message: string;
      messageId: string;
      serializedContext?: string;
      threadId?: string;
      topicId?: string;
      trigger?: string;
    };
    sourceType?: string;
    timestamp?: number;
  };
}

const basicMemoryWorkflowCase = {
  expected: {
    memory: {
      descriptionIncludes: 'User prefers concise answers.',
      type: 'personal',
    },
  },
  id: 'basic-memory',
  scenario: {
    payload: {
      intents: ['memory'],
      memoryPayload: {
        base: { content: 'User prefers concise answers.' },
        identity: {
          description: 'User prefers concise answers.',
          tags: ['response-style'],
          type: 'personal',
        },
      },
      message: 'Remember that I prefer concise answers.',
      messageId: 'msg-basic-memory',
    },
  },
} satisfies WorkflowScenarioCase;

const rejectedNoFeedbackWorkflowCase = {
  expected: {},
  id: 'rejected-no-feedback',
  scenario: {
    payload: {
      message: 'Thanks, that answers my question.',
      messageId: 'msg-rejected-no-feedback',
    },
  },
} satisfies WorkflowScenarioCase;

const createWorkflowContext = <TPayload>(requestPayload: TPayload) => {
  return {
    requestPayload,
    run: async <TRunResult>(_stepId: string, handler: () => Promise<TRunResult>) => handler(),
  };
};

const createInMemorySourceEventStore = (): AgentSignalSourceEventStore => {
  const dedupeKeys = new Set<string>();
  const locks = new Set<string>();
  const windows = new Map<string, Record<string, string>>();

  return {
    acquireScopeLock: async (scopeKey, ttlSeconds) => {
      void ttlSeconds;
      if (locks.has(scopeKey)) return false;

      locks.add(scopeKey);
      return true;
    },
    readWindow: async (scopeKey) => windows.get(scopeKey),
    releaseScopeLock: async (scopeKey) => {
      locks.delete(scopeKey);
    },
    tryDedupe: async (eventId, ttlSeconds) => {
      void ttlSeconds;
      if (dedupeKeys.has(eventId)) return false;

      dedupeKeys.add(eventId);
      return true;
    },
    writeWindow: async (scopeKey, data, ttlSeconds) => {
      void ttlSeconds;
      windows.set(scopeKey, data);
    },
  };
};

const normalizeSourceEvent = (sourceEvent: AgentSignalSourceEnvelope) => {
  return {
    payload: sourceEvent.payload,
    scopeKey: sourceEvent.scopeKey ?? `test-scope:${sourceEvent.sourceId}`,
    sourceId: sourceEvent.sourceId,
    sourceType: sourceEvent.sourceType,
    timestamp: sourceEvent.timestamp ?? Date.now(),
  };
};

const createExecuteSourceEventWithTestPolicies = (
  store: AgentSignalSourceEventStore,
): NonNullable<RunAgentSignalWorkflowDeps['executeSourceEvent']> => {
  return async (sourceEvent, context) => {
    const normalizedSourceEvent = normalizeSourceEvent(sourceEvent);
    const emission = await emitSourceEvent(normalizedSourceEvent, { store });
    if (emission.deduped) return emission;

    const runtime = await createAgentSignalRuntime({
      policies: [
        defineAgentSignalHandlers([
          defineSourceHandler('agent.user.message', {
            async handle(source) {
              const intents = Array.isArray(source.payload.intents)
                ? source.payload.intents.filter(
                    (intent): intent is string => typeof intent === 'string',
                  )
                : [];
              const memoryPayload =
                source.payload.memoryPayload &&
                typeof source.payload.memoryPayload === 'object' &&
                !Array.isArray(source.payload.memoryPayload)
                  ? (source.payload.memoryPayload as Record<string, unknown>)
                  : undefined;

              if (!intents.includes('memory') || !memoryPayload) return;

              return {
                signals: [
                  createSignal({
                    payload: { memoryPayload },
                    signalType: 'signal.memory.request',
                    source,
                  }),
                ],
                status: 'dispatch',
              } as const;
            },
            id: 'test-source-memory-request',
          }),
          defineSignalHandler('signal.memory.request', {
            async handle(signal) {
              const memoryPayload =
                signal.payload.memoryPayload &&
                typeof signal.payload.memoryPayload === 'object' &&
                !Array.isArray(signal.payload.memoryPayload)
                  ? (signal.payload.memoryPayload as Record<string, unknown>)
                  : undefined;

              if (!memoryPayload) return;

              return {
                actions: [
                  createAction({
                    actionType: 'action.memory.persist',
                    payload: { memoryPayload },
                    signal,
                  }),
                ],
                status: 'dispatch',
              } as const;
            },
            id: 'test-signal-memory-request',
          }),
          defineActionHandler('action.memory.persist', {
            async handle(action) {
              const memoryPayload =
                action.payload.memoryPayload &&
                typeof action.payload.memoryPayload === 'object' &&
                !Array.isArray(action.payload.memoryPayload)
                  ? (action.payload.memoryPayload as Record<string, unknown>)
                  : undefined;
              const identity =
                memoryPayload?.identity &&
                typeof memoryPayload.identity === 'object' &&
                !Array.isArray(memoryPayload.identity)
                  ? (memoryPayload.identity as Record<string, unknown>)
                  : undefined;
              const base =
                memoryPayload?.base &&
                typeof memoryPayload.base === 'object' &&
                !Array.isArray(memoryPayload.base)
                  ? (memoryPayload.base as Record<string, unknown>)
                  : undefined;

              if (identity?.description && identity.type) {
                await new UserMemoryModel(context.db, context.userId).addIdentityEntry({
                  base: {
                    details: typeof base?.content === 'string' ? base.content : undefined,
                    summary:
                      typeof identity.description === 'string' ? identity.description : undefined,
                    title:
                      typeof identity.description === 'string' ? identity.description : undefined,
                  },
                  identity: {
                    description:
                      typeof identity.description === 'string' ? identity.description : undefined,
                    tags: Array.isArray(identity.tags)
                      ? identity.tags.filter((tag): tag is string => typeof tag === 'string')
                      : undefined,
                    type: typeof identity.type === 'string' ? identity.type : undefined,
                  },
                });
              }

              return {
                actionId: action.actionId,
                attempt: {
                  completedAt: normalizedSourceEvent.timestamp + 2,
                  current: 1,
                  startedAt: normalizedSourceEvent.timestamp + 1,
                  status: 'succeeded',
                },
                detail: 'memory persisted',
                status: 'applied',
              } as const;
            },
            id: 'test-action-memory-persist',
          }),
        ]),
      ],
    });

    const runtimeResult = await runtime.emitNormalized(emission.source);
    const trace =
      runtimeResult.status === 'completed'
        ? runtimeResult.trace
        : {
            actions: [],
            results: [],
            signals: [],
            source: emission.source,
          };

    return {
      ...emission,
      orchestration: {
        actions: trace.actions,
        emittedSignals: trace.signals,
        observability: projectAgentSignalObservability({
          actions: trace.actions,
          results: trace.results,
          signals: trace.signals,
          source: trace.source,
        }),
        plans: [],
        results: trace.results,
        runtimeResult,
      },
    } as const;
  };
};

const assertScenarioSideEffects = async (input: {
  testCase: WorkflowScenarioCase;
  db: Awaited<ReturnType<typeof getTestDB>>;
  userId: string;
}) => {
  const userMemoryModel = new UserMemoryModel(input.db, input.userId);

  if (input.testCase.expected.memory) {
    const expectedMemory = input.testCase.expected.memory;
    const identities = await userMemoryModel.getIdentitiesByType(expectedMemory.type);
    const hasExpectedMemory = identities.some((identity) =>
      identity.description?.includes(expectedMemory.descriptionIncludes),
    );

    expect(hasExpectedMemory).toBe(true);
    return;
  }

  const identities = await userMemoryModel.getIdentitiesByType('personal');
  expect(identities).toHaveLength(0);
};

const createScenarioPayload = (
  testCase: WorkflowScenarioCase,
  input: { agentId: string; topicId: string; userId: string },
) => {
  const now = Date.now();
  const payload = {
    ...testCase.scenario.payload,
    agentId:
      'agentId' in testCase.scenario.payload &&
      typeof testCase.scenario.payload.agentId === 'string'
        ? testCase.scenario.payload.agentId
        : input.agentId,
    topicId: input.topicId,
  };

  if (
    typeof payload.documentPayload === 'object' &&
    payload.documentPayload !== null &&
    typeof payload.documentPayload.agentId !== 'string'
  ) {
    payload.documentPayload = {
      ...payload.documentPayload,
      agentId: input.agentId,
    };
  }

  return {
    agentId: input.agentId,
    sourceEvent: {
      payload,
      scopeKey: `topic:${input.topicId}`,
      sourceId: `workflow-scenario:${testCase.id}:${now}`,
      sourceType: ('sourceType' in testCase.scenario
        ? (testCase.scenario.sourceType ?? 'agent.user.message')
        : 'agent.user.message') as AgentSignalSourceType,
      timestamp: 'timestamp' in testCase.scenario ? (testCase.scenario.timestamp ?? now) : now,
    },
    userId: input.userId,
  };
};

describe('runAgentSignalWorkflow integration', () => {
  it.each([basicMemoryWorkflowCase, rejectedNoFeedbackWorkflowCase])(
    'handles the %s scenario through the workflow runner',
    async (testCase) => {
      const db = await getTestDB();
      const userId = `eval_${uuid()}`;
      const topicId = `topic_${uuid()}`;
      const sourceEventStore = createInMemorySourceEventStore();
      const executeSourceEvent = createExecuteSourceEventWithTestPolicies(sourceEventStore);

      await db.insert(users).values({ id: userId });

      const [agent] = await db
        .insert(agents)
        .values({
          model: 'gpt-4o-mini',
          plugins: [],
          provider: 'openai',
          systemRole: '',
          title: 'Workflow Scenario Agent',
          userId,
        })
        .returning();

      const result = await runAgentSignalWorkflow(
        createWorkflowContext(
          createScenarioPayload(testCase, { agentId: agent.id, topicId, userId }),
        ),
        {
          executeSourceEvent,
          getDb: async () => db,
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          deduped: false,
          success: true,
        }),
      );

      await expect(
        assertScenarioSideEffects({
          db,
          testCase,
          userId,
        }),
      ).resolves.toBeUndefined();
    },
  );
});
