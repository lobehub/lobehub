// @vitest-environment node
import type { AgentSignalSourceEvent, SourceAgentUserMessage } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES, createSourceEvent } from '@lobechat/agent-signal/source';
import type { ISnapshotStore } from '@lobechat/agent-tracing';
import { agents, messages, threads, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { describe, expect, it, vi } from 'vitest';

import type { SelfReflectionReviewContext } from '@/server/services/agentSignal/policies/reviewNightly/selfReflection';
import { createProcedurePolicyOptions as createProcedurePolicyOptionsFixture } from '@/server/services/agentSignal/procedure';
import { MaintenanceReviewScope, ReviewRunStatus } from '@/server/services/agentSignal/services';
import type { NightlyReviewContext } from '@/server/services/agentSignal/services/maintenance/nightlyCollector';
import type { AgentSignalPolicyStateStore } from '@/server/services/agentSignal/store/types';
import type { RunAgentSignalWorkflowDeps } from '@/server/workflows/agentSignal/run';
import { runAgentSignalWorkflow } from '@/server/workflows/agentSignal/run';
import { uuid } from '@/utils/uuid';

vi.mock('@/server/services/agentSignal/featureGate', () => ({
  isAgentSignalEnabledForUser: vi.fn().mockResolvedValue(true),
}));

const createWorkflowContext = <TPayload>(requestPayload: TPayload) => {
  return {
    requestPayload,
    run: async <TRunResult>(_stepId: string, handler: () => Promise<TRunResult>) => handler(),
  };
};

const createPolicyStateStore = (): AgentSignalPolicyStateStore => {
  const state = new Map<string, Record<string, string>>();

  return {
    readPolicyState: async (policyId, scopeKey) => state.get(`${policyId}:${scopeKey}`),
    writePolicyState: async (policyId, scopeKey, data) => {
      state.set(`${policyId}:${scopeKey}`, { ...state.get(`${policyId}:${scopeKey}`), ...data });
    },
  };
};

const createNightlyReviewContext = (input: {
  agentId: string;
  reviewWindowEnd: string;
  reviewWindowStart: string;
  userId: string;
}): NightlyReviewContext => ({
  agentId: input.agentId,
  documentActivity: {
    ambiguousBucket: [],
    excludedSummary: { count: 0, reasons: [] },
    generalDocumentBucket: [],
    skillBucket: [],
  },
  feedbackActivity: {
    neutralCount: 0,
    notSatisfied: [],
    satisfied: [],
  },
  maintenanceSignals: [],
  managedSkills: [],
  proposalActivity: {
    active: [],
    dismissedCount: 0,
    expiredCount: 0,
    staleCount: 0,
    supersededCount: 0,
  },
  receiptActivity: {
    appliedCount: 0,
    duplicateGroups: [],
    failedCount: 0,
    pendingProposalCount: 0,
    recentReceipts: [],
    reviewCount: 0,
  },
  relevantMemories: [],
  reviewWindowEnd: input.reviewWindowEnd,
  reviewWindowStart: input.reviewWindowStart,
  toolActivity: [],
  topics: [],
  userId: input.userId,
});

describe('runAgentSignalWorkflow', () => {
  it('hydrates client.runtime.start into agent.user.message with serialized root-topic context', async () => {
    const db = await getTestDB();
    const userId = `eval_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const parentMessageId = `msg_${uuid()}`;
    const baseTimestamp = new Date('2026-01-01T00:00:00.000Z').getTime();
    let capturedSourceEvent:
      | AgentSignalSourceEvent<typeof AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage>
      | undefined;

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

    await db.insert(topics).values({
      id: topicId,
      title: 'Workflow Topic',
      userId,
    });

    await db.insert(messages).values([
      {
        agentId: agent.id,
        content: 'Old question that should be truncated from the serialized context.',
        createdAt: new Date(baseTimestamp + 1_000),
        id: `msg_${uuid()}`,
        role: 'user',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Old assistant reply that should be truncated from the serialized context.',
        createdAt: new Date(baseTimestamp + 2_000),
        id: `msg_${uuid()}`,
        role: 'assistant',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Need a summary of the discussion so far.',
        createdAt: new Date(baseTimestamp + 3_000),
        id: `msg_${uuid()}`,
        role: 'user',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Summary draft with a lot of extra detail.',
        createdAt: new Date(baseTimestamp + 4_000),
        id: `msg_${uuid()}`,
        role: 'assistant',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Can you make it shorter?',
        createdAt: new Date(baseTimestamp + 5_000),
        id: `msg_${uuid()}`,
        role: 'user',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Here is a shorter version.',
        createdAt: new Date(baseTimestamp + 6_000),
        id: `msg_${uuid()}`,
        role: 'assistant',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Still a bit dense.',
        createdAt: new Date(baseTimestamp + 7_000),
        id: `msg_${uuid()}`,
        role: 'user',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'I can switch to bullet points.',
        createdAt: new Date(baseTimestamp + 8_000),
        id: `msg_${uuid()}`,
        role: 'assistant',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'That would help.',
        createdAt: new Date(baseTimestamp + 9_000),
        id: `msg_${uuid()}`,
        role: 'user',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Here is a bullet-first structure.',
        createdAt: new Date(baseTimestamp + 10_000),
        id: `msg_${uuid()}`,
        role: 'assistant',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Latest assistant reply before the feedback message.',
        createdAt: new Date(baseTimestamp + 11_000),
        id: `msg_${uuid()}`,
        role: 'assistant',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Going forward, I prefer concise answers with the conclusion first.',
        createdAt: new Date(baseTimestamp + 12_000),
        id: parentMessageId,
        role: 'user',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Future assistant reply that should be excluded from the anchored root context.',
        createdAt: new Date(baseTimestamp + 13_000),
        id: `msg_${uuid()}`,
        role: 'assistant',
        topicId,
        userId,
      },
    ]);

    const now = Date.now();
    const executeSourceEvent: NonNullable<RunAgentSignalWorkflowDeps['executeSourceEvent']> = vi.fn(
      async (sourceEvent) => {
        capturedSourceEvent = sourceEvent as AgentSignalSourceEvent<
          typeof AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage
        >;
        return undefined;
      },
    );

    const result = await runAgentSignalWorkflow(
      createWorkflowContext({
        agentId: agent.id,
        sourceEvent: {
          payload: {
            agentId: agent.id,
            operationId: `op_${uuid()}`,
            parentMessageId,
            parentMessageType: 'user',
            serializedContext: 'malicious client supplied context',
            topicId,
          },
          scopeKey: `topic:${topicId}`,
          sourceId: `client.runtime.start:${now}`,
          sourceType: 'client.runtime.start',
          timestamp: now,
        },
        userId,
      }),
      {
        executeSourceEvent,
        getDb: async () => db,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        sourceId: parentMessageId,
        success: true,
      }),
    );
    expect(executeSourceEvent).toHaveBeenCalledTimes(1);
    expect(executeSourceEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({
        policyOptions: {
          skillManagement: {
            selfIterationEnabled: true,
          },
        },
      }),
    );
    expect(capturedSourceEvent?.sourceType).toBe('agent.user.message');
    expect(capturedSourceEvent?.payload.serializedContext).toContain('<feedback_analysis_context>');
    expect(capturedSourceEvent?.payload.serializedContext).not.toContain(
      'malicious client supplied context',
    );
    expect(capturedSourceEvent?.payload.serializedContext).not.toContain(
      'Old question that should be truncated from the serialized context.',
    );
    expect(capturedSourceEvent?.payload.serializedContext).not.toContain(
      'Old assistant reply that should be truncated from the serialized context.',
    );
    expect(capturedSourceEvent?.payload.serializedContext).toContain(
      'Latest assistant reply before the feedback message.',
    );
    expect(capturedSourceEvent?.payload.serializedContext).toContain(
      'Going forward, I prefer concise answers with the conclusion first.',
    );
    expect(capturedSourceEvent?.payload.serializedContext).not.toContain(
      'Future assistant reply that should be excluded from the anchored root context.',
    );
  }, 10_000);

  it('records hydration skipped diagnostics in workflow snapshots', async () => {
    const db = await getTestDB();
    const userId = `eval_${uuid()}`;
    const agentId = `agent_${uuid()}`;
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const snapshotStore = {
      get: vi.fn(),
      getLatest: vi.fn(),
      list: vi.fn(),
      listPartials: vi.fn(),
      loadPartial: vi.fn(),
      removePartial: vi.fn(),
      save: saveSnapshot,
      savePartial: vi.fn(),
    } satisfies ISnapshotStore;

    await db.insert(users).values({ id: userId });

    const executeSourceEvent: NonNullable<RunAgentSignalWorkflowDeps['executeSourceEvent']> = vi.fn(
      async () => undefined,
    );

    await runAgentSignalWorkflow(
      createWorkflowContext({
        agentId,
        sourceEvent: {
          payload: {
            agentId,
            operationId: `op_${uuid()}`,
            parentMessageId: `msg_${uuid()}`,
            parentMessageType: 'assistant',
            topicId: 'topic_1',
          },
          scopeKey: 'topic:topic_1',
          sourceId: 'client:start:assistant-parent',
          sourceType: 'client.runtime.start',
          timestamp: Date.now(),
        },
        userId,
      }),
      {
        createSnapshotStore: () => snapshotStore,
        executeSourceEvent,
        getDb: async () => db,
      },
    );

    expect(saveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: [
          expect.objectContaining({
            context: expect.objectContaining({
              payload: expect.objectContaining({
                hydration: expect.objectContaining({
                  kind: 'client.runtime.start',
                  reason: 'non-user-parent',
                  status: 'skipped',
                }),
              }),
            }),
            events: [
              expect.objectContaining({
                data: expect.objectContaining({
                  hydrationKind: 'client.runtime.start',
                  hydrationReason: 'non-user-parent',
                  hydrationStatus: 'skipped',
                }),
                type: 'agent_signal.workflow.hydration',
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('hydrates client.runtime.complete into paired user feedback with assistant-bound serialized context', async () => {
    const db = await getTestDB();
    const userId = `eval_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const userMessageId = `msg_${uuid()}`;
    const assistantMessageId = `msg_${uuid()}`;
    const baseTimestamp = new Date('2026-01-03T00:00:00.000Z').getTime();
    let capturedSourceEvent:
      | AgentSignalSourceEvent<typeof AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage>
      | undefined;

    await db.insert(users).values({ id: userId });

    const [agent] = await db
      .insert(agents)
      .values({
        model: 'gpt-4o-mini',
        plugins: [],
        provider: 'openai',
        systemRole: '',
        title: 'Completion Workflow Agent',
        userId,
      })
      .returning();

    await db.insert(topics).values({
      id: topicId,
      title: 'Completion Topic',
      userId,
    });

    await db.insert(messages).values([
      {
        agentId: agent.id,
        content: 'Please keep this exact workflow as a reusable skill.',
        createdAt: new Date(baseTimestamp + 1_000),
        id: userMessageId,
        role: 'user',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'I created the reusable workflow and attached the result.',
        createdAt: new Date(baseTimestamp + 2_000),
        id: assistantMessageId,
        parentId: userMessageId,
        role: 'assistant',
        topicId,
        updatedAt: new Date(baseTimestamp + 5_000),
        userId,
      },
      {
        agentId: agent.id,
        content: 'Same-turn document outcome that must be visible after the user parent.',
        createdAt: new Date(baseTimestamp + 3_000),
        id: `msg_${uuid()}`,
        role: 'document',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Same-turn tool outcome that must be visible after the user parent.',
        createdAt: new Date(baseTimestamp + 4_000),
        id: `msg_${uuid()}`,
        role: 'tool',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Later message that must be excluded from completion-bound context.',
        createdAt: new Date(baseTimestamp + 6_000),
        id: `msg_${uuid()}`,
        role: 'user',
        topicId,
        userId,
      },
    ]);

    const executeSourceEvent: NonNullable<RunAgentSignalWorkflowDeps['executeSourceEvent']> = vi.fn(
      async (sourceEvent) => {
        capturedSourceEvent = sourceEvent as AgentSignalSourceEvent<
          typeof AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage
        >;
        return undefined;
      },
    );

    const result = await runAgentSignalWorkflow(
      createWorkflowContext({
        agentId: agent.id,
        sourceEvent: {
          payload: {
            agentId: agent.id,
            assistantMessageId,
            operationId: 'op_completion_hydration',
            serializedContext: 'client context must not be trusted',
            status: 'completed',
            topicId,
          },
          scopeKey: `topic:${topicId}`,
          sourceId: 'op_completion_hydration:client:complete',
          sourceType: 'client.runtime.complete',
          timestamp: Date.now(),
        },
        userId,
      }),
      {
        executeSourceEvent,
        getDb: async () => db,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        sourceId: `${assistantMessageId}:completion:${userMessageId}`,
        success: true,
      }),
    );
    expect(executeSourceEvent).toHaveBeenCalledTimes(1);
    expect(capturedSourceEvent?.sourceType).toBe('agent.user.message');
    expect(capturedSourceEvent?.payload.trigger).toBe('client.runtime.complete');
    expect(capturedSourceEvent?.payload.messageId).toBe(userMessageId);
    expect(capturedSourceEvent?.payload.serializedContext).toContain(
      'Please keep this exact workflow as a reusable skill.',
    );
    expect(capturedSourceEvent?.payload.serializedContext).toContain(
      'I created the reusable workflow and attached the result.',
    );
    expect(capturedSourceEvent?.payload.serializedContext).toContain(
      'Same-turn document outcome that must be visible after the user parent.',
    );
    expect(capturedSourceEvent?.payload.serializedContext).toContain(
      'Same-turn tool outcome that must be visible after the user parent.',
    );
    expect(capturedSourceEvent?.payload.serializedContext).not.toContain(
      'client context must not be trusted',
    );
    expect(capturedSourceEvent?.payload.serializedContext).not.toContain(
      'Later message that must be excluded from completion-bound context.',
    );
  });

  it('skips cancelled client.runtime.complete hydration and records diagnostics without hydrated feedback', async () => {
    const db = await getTestDB();
    const userId = `eval_${uuid()}`;
    const agentId = `agent_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const snapshotStore = {
      get: vi.fn(),
      getLatest: vi.fn(),
      list: vi.fn(),
      listPartials: vi.fn(),
      loadPartial: vi.fn(),
      removePartial: vi.fn(),
      save: saveSnapshot,
      savePartial: vi.fn(),
    } satisfies ISnapshotStore;
    let capturedSourceEvent: AgentSignalSourceEvent | undefined;

    await db.insert(users).values({ id: userId });

    const executeSourceEvent: NonNullable<RunAgentSignalWorkflowDeps['executeSourceEvent']> = vi.fn(
      async (sourceEvent) => {
        capturedSourceEvent = sourceEvent;
        return undefined;
      },
    );

    await runAgentSignalWorkflow(
      createWorkflowContext({
        agentId,
        sourceEvent: {
          payload: {
            agentId,
            assistantMessageId: `msg_${uuid()}`,
            operationId: 'op_cancelled_completion',
            status: 'cancelled',
            topicId,
          },
          scopeKey: `topic:${topicId}`,
          sourceId: 'op_cancelled_completion:client:complete',
          sourceType: 'client.runtime.complete',
          timestamp: Date.now(),
        },
        userId,
      }),
      {
        createSnapshotStore: () => snapshotStore,
        executeSourceEvent,
        getDb: async () => db,
      },
    );

    expect(executeSourceEvent).toHaveBeenCalledTimes(1);
    expect(capturedSourceEvent?.sourceType).toBe('client.runtime.complete');
    expect(capturedSourceEvent?.sourceId).toBe('op_cancelled_completion:client:complete');
    expect(saveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: [
          expect.objectContaining({
            context: expect.objectContaining({
              payload: expect.objectContaining({
                hydration: {
                  kind: 'client.runtime.complete',
                  reason: 'non-completed-status',
                  status: 'skipped',
                },
              }),
            }),
            events: [
              expect.objectContaining({
                data: expect.objectContaining({
                  hydrationKind: 'client.runtime.complete',
                  hydrationReason: 'non-completed-status',
                  hydrationStatus: 'skipped',
                }),
                type: 'agent_signal.workflow.hydration',
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('assembles serializedContext from the matching thread before executing a threaded source event', async () => {
    const db = await getTestDB();
    const userId = `eval_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const threadId = `thread_${uuid()}`;
    const otherThreadId = `thread_${uuid()}`;
    const feedbackMessageId = `msg_${uuid()}`;
    const baseTimestamp = new Date('2026-01-02T00:00:00.000Z').getTime();
    let capturedSourceEvent: AgentSignalSourceEvent | undefined;

    await db.insert(users).values({ id: userId });

    const [agent] = await db
      .insert(agents)
      .values({
        model: 'gpt-4o-mini',
        plugins: [],
        provider: 'openai',
        systemRole: '',
        title: 'Threaded Workflow Scenario Agent',
        userId,
      })
      .returning();

    await db.insert(topics).values({
      id: topicId,
      title: 'Threaded Workflow Topic',
      userId,
    });

    await db.insert(threads).values([
      {
        agentId: agent.id,
        id: threadId,
        title: 'Target Thread',
        topicId,
        type: 'standalone',
        userId,
      },
      {
        agentId: agent.id,
        id: otherThreadId,
        title: 'Other Thread',
        topicId,
        type: 'standalone',
        userId,
      },
    ]);

    await db.insert(messages).values([
      {
        agentId: agent.id,
        content: 'Root topic message that should not appear in the threaded context.',
        createdAt: new Date(baseTimestamp + 1_000),
        id: `msg_${uuid()}`,
        role: 'user',
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Different thread message that should be excluded.',
        createdAt: new Date(baseTimestamp + 2_000),
        id: `msg_${uuid()}`,
        role: 'assistant',
        threadId: otherThreadId,
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Thread message one that should be included.',
        createdAt: new Date(baseTimestamp + 3_000),
        id: `msg_${uuid()}`,
        role: 'user',
        threadId,
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Thread message two that should be included.',
        createdAt: new Date(baseTimestamp + 4_000),
        id: `msg_${uuid()}`,
        role: 'assistant',
        threadId,
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Going forward, keep using this format in this thread.',
        createdAt: new Date(baseTimestamp + 5_000),
        id: feedbackMessageId,
        role: 'user',
        threadId,
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Later reply in the same thread that should be excluded by the anchor window.',
        createdAt: new Date(baseTimestamp + 6_000),
        id: `msg_${uuid()}`,
        role: 'assistant',
        threadId,
        topicId,
        userId,
      },
      {
        agentId: agent.id,
        content: 'Later root message that should still be excluded from the threaded context.',
        createdAt: new Date(baseTimestamp + 7_000),
        id: `msg_${uuid()}`,
        role: 'assistant',
        topicId,
        userId,
      },
    ]);

    const executeSourceEvent: NonNullable<RunAgentSignalWorkflowDeps['executeSourceEvent']> = vi.fn(
      async (sourceEvent) => {
        capturedSourceEvent = sourceEvent as AgentSignalSourceEvent;
        return undefined;
      },
    );

    const result = await runAgentSignalWorkflow(
      createWorkflowContext({
        agentId: agent.id,
        sourceEvent: {
          payload: {
            agentId: agent.id,
            message: 'Going forward, keep using this format in this thread.',
            messageId: feedbackMessageId,
            threadId,
            topicId,
          },
          scopeKey: `topic:${topicId}`,
          sourceId: `workflow-threaded:${threadId}`,
          sourceType: 'agent.user.message',
          timestamp: Date.now(),
        },
        userId,
      }),
      {
        executeSourceEvent,
        getDb: async () => db,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        sourceId: `workflow-threaded:${threadId}`,
        success: true,
      }),
    );
    expect(executeSourceEvent).toHaveBeenCalledTimes(1);
    expect(capturedSourceEvent?.sourceType).toBe('agent.user.message');

    if (capturedSourceEvent?.sourceType !== AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage) {
      throw new Error('Expected captured source event to be an agent user message');
    }

    const userMessageSource = capturedSourceEvent as SourceAgentUserMessage;

    expect(userMessageSource.payload.threadId).toBe(threadId);
    expect(userMessageSource.payload.serializedContext).toContain('<feedback_analysis_context>');
    expect(userMessageSource.payload.serializedContext).toContain(
      'Thread message one that should be included.',
    );
    expect(userMessageSource.payload.serializedContext).toContain(
      'Thread message two that should be included.',
    );
    expect(userMessageSource.payload.serializedContext).toContain(
      'Going forward, keep using this format in this thread.',
    );
    expect(userMessageSource.payload.serializedContext).not.toContain(
      'Root topic message that should not appear in the threaded context.',
    );
    expect(userMessageSource.payload.serializedContext).not.toContain(
      'Different thread message that should be excluded.',
    );
    expect(userMessageSource.payload.serializedContext).not.toContain(
      'Later reply in the same thread that should be excluded by the anchor window.',
    );
    expect(userMessageSource.payload.serializedContext).not.toContain(
      'Later root message that should still be excluded from the threaded context.',
    );
  });

  it('installs nightly review policy dependencies only for nightly review sources', async () => {
    const db = await getTestDB();
    const userId = `eval_${uuid()}`;
    const agentId = `agent_${uuid()}`;
    const localDate = '2026-05-04';
    const sourceId = `nightly-review:${userId}:${agentId}:${localDate}`;
    const nightlyReviewPolicyOptions = {
      acquireReviewGuard: vi.fn(async () => true),
      canRunReview: vi.fn(async () => true),
      collectContext: vi.fn(async () =>
        createNightlyReviewContext({
          agentId,
          reviewWindowEnd: '2026-05-04T14:30:00.000Z',
          reviewWindowStart: '2026-05-03T16:00:00.000Z',
          userId,
        }),
      ),
      runMaintenanceReviewAgent: vi.fn(async () => ({
        execution: { actions: [], status: ReviewRunStatus.Completed },
        projectionPlan: {
          actions: [],
          plannerVersion: 'test',
          reviewScope: MaintenanceReviewScope.Nightly,
          summary: 'Noop',
        },
      })),
    };
    const createNightlyReviewPolicyOptions: NonNullable<
      RunAgentSignalWorkflowDeps['createNightlyReviewPolicyOptions']
    > = vi.fn(() => nightlyReviewPolicyOptions);
    const executeSourceEvent: NonNullable<RunAgentSignalWorkflowDeps['executeSourceEvent']> = vi.fn(
      async () => undefined,
    );
    const sourceEvent = createSourceEvent({
      payload: {
        agentId,
        localDate,
        requestedAt: '2026-05-04T14:30:00.000Z',
        reviewWindowEnd: '2026-05-04T14:30:00.000Z',
        reviewWindowStart: '2026-05-03T16:00:00.000Z',
        timezone: 'Asia/Shanghai',
        userId,
      },
      scopeKey: `agent:${agentId}`,
      sourceId,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
      timestamp: Date.now(),
    });

    await runAgentSignalWorkflow(createWorkflowContext({ agentId, sourceEvent, userId }), {
      createNightlyReviewPolicyOptions,
      executeSourceEvent,
      getDb: async () => db,
    });

    expect(createNightlyReviewPolicyOptions).toHaveBeenCalledWith({
      agentId,
      db,
      selfIterationEnabled: true,
      userId,
    });
    expect(executeSourceEvent).toHaveBeenCalledWith(
      sourceEvent,
      expect.any(Object),
      expect.objectContaining({
        policyOptions: expect.objectContaining({
          nightlyReview: nightlyReviewPolicyOptions,
          skillManagement: {
            selfIterationEnabled: true,
          },
        }),
      }),
    );
  });

  it('installs self-reflection policy dependencies for self-reflection sources', async () => {
    const db = await getTestDB();
    const userId = `eval_${uuid()}`;
    const agentId = `agent_${uuid()}`;
    const sourceId = `self-reflection:${userId}:${agentId}:topic:topic-1:failed_tool_count:2026-05-04T14:30:00.000Z`;
    const selfReflectionContext: SelfReflectionReviewContext = {
      agentId,
      scopeId: 'topic-1',
      scopeType: 'topic',
      userId,
      windowEnd: '2026-05-04T14:30:00.000Z',
      windowStart: '2026-05-04T14:00:00.000Z',
    };
    const selfReflectionPolicyOptions = {
      acquireReviewGuard: vi.fn(async () => true),
      canRunReview: vi.fn(async () => true),
      collectContext: vi.fn(async () => selfReflectionContext),
      executePlan: vi.fn(async () => ({ actions: [], status: ReviewRunStatus.Completed })),
      planReviewOutput: vi.fn(() => ({
        actions: [],
        plannerVersion: 'test',
        reviewScope: MaintenanceReviewScope.SelfReflection,
        summary: 'Noop',
      })),
      runMaintenanceReviewAgent: vi.fn(async () => ({
        actions: [],
        findings: [],
        summary: 'Noop',
      })),
      writeReceipt: vi.fn(async () => {}),
    };
    const createSelfReflectionPolicyOptions: NonNullable<
      RunAgentSignalWorkflowDeps['createSelfReflectionPolicyOptions']
    > = vi.fn(() => selfReflectionPolicyOptions);
    const executeSourceEvent: NonNullable<RunAgentSignalWorkflowDeps['executeSourceEvent']> = vi.fn(
      async () => undefined,
    );
    const sourceEvent = createSourceEvent({
      payload: {
        agentId,
        reason: 'failed_tool_count',
        scopeId: 'topic-1',
        scopeType: 'topic',
        topicId: 'topic-1',
        userId,
        windowEnd: '2026-05-04T14:30:00.000Z',
        windowStart: '2026-05-04T14:00:00.000Z',
      },
      scopeKey: 'topic:topic-1',
      sourceId,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
      timestamp: Date.now(),
    });

    await runAgentSignalWorkflow(createWorkflowContext({ agentId, sourceEvent, userId }), {
      createSelfReflectionPolicyOptions,
      executeSourceEvent,
      getDb: async () => db,
    });

    expect(createSelfReflectionPolicyOptions).toHaveBeenCalledWith({
      agentId,
      db,
      selfIterationEnabled: true,
      userId,
    });
    expect(executeSourceEvent).toHaveBeenCalledWith(
      sourceEvent,
      expect.any(Object),
      expect.objectContaining({
        policyOptions: expect.objectContaining({
          selfReflection: selfReflectionPolicyOptions,
          skillManagement: {
            selfIterationEnabled: true,
          },
        }),
      }),
    );
  });

  it('installs self-iteration intent policy dependencies for declared intent sources', async () => {
    const db = await getTestDB();
    const userId = `eval_${uuid()}`;
    const agentId = `agent_${uuid()}`;
    const sourceId = `self-iteration-intent:${userId}:${agentId}:topic:topic-1:tool-call-1`;
    const selfIterationIntentPolicyOptions = {
      acquireReviewGuard: vi.fn(async () => true),
      canRunReview: vi.fn(async () => true),
      executePlan: vi.fn(async () => ({ actions: [], status: ReviewRunStatus.Completed })),
      planReviewOutput: vi.fn(() => ({
        actions: [],
        plannerVersion: 'test',
        reviewScope: MaintenanceReviewScope.SelfIterationIntent,
        summary: 'Noop',
      })),
      writeReceipt: vi.fn(async () => {}),
    };
    const createSelfIterationIntentPolicyOptions: NonNullable<
      RunAgentSignalWorkflowDeps['createSelfIterationIntentPolicyOptions']
    > = vi.fn(() => selfIterationIntentPolicyOptions);
    const executeSourceEvent: NonNullable<RunAgentSignalWorkflowDeps['executeSourceEvent']> = vi.fn(
      async () => undefined,
    );
    const sourceEvent = createSourceEvent({
      payload: {
        action: 'refine',
        agentId,
        confidence: 0.9,
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        kind: 'skill',
        reason: 'Reusable correction.',
        skillId: 'skill-1',
        summary: 'Refine release-note workflow.',
        toolCallId: 'tool-call-1',
        topicId: 'topic-1',
        userId,
      },
      scopeKey: 'topic:topic-1',
      sourceId,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfIterationIntentDeclared,
      timestamp: Date.now(),
    });

    await runAgentSignalWorkflow(createWorkflowContext({ agentId, sourceEvent, userId }), {
      createSelfIterationIntentPolicyOptions,
      executeSourceEvent,
      getDb: async () => db,
    });

    expect(createSelfIterationIntentPolicyOptions).toHaveBeenCalledWith({
      agentId,
      db,
      selfIterationEnabled: true,
      userId,
    });
    expect(executeSourceEvent).toHaveBeenCalledWith(
      sourceEvent,
      expect.any(Object),
      expect.objectContaining({
        policyOptions: expect.objectContaining({
          selfIterationIntent: selfIterationIntentPolicyOptions,
          skillManagement: {
            selfIterationEnabled: true,
          },
        }),
      }),
    );
  });

  it('installs procedure self-reflection dependencies for tool outcome sources', async () => {
    const db = await getTestDB();
    const userId = `eval_${uuid()}`;
    const agentId = `agent_${uuid()}`;
    const procedurePolicyOptions = createProcedurePolicyOptionsFixture({
      policyStateStore: createPolicyStateStore(),
      ttlSeconds: 60,
    });
    const createProcedurePolicyOptions: NonNullable<
      RunAgentSignalWorkflowDeps['createProcedurePolicyOptions']
    > = vi.fn(() => procedurePolicyOptions);
    const executeSourceEvent: NonNullable<RunAgentSignalWorkflowDeps['executeSourceEvent']> = vi.fn(
      async () => undefined,
    );
    const sourceEvent = createSourceEvent({
      payload: {
        agentId,
        domainKey: 'skill:tool-call',
        outcome: {
          status: 'failed',
          summary: 'Tool failed twice.',
        },
        tool: { apiName: 'writeFile', identifier: 'filesystem' },
        toolCallId: 'tool-call-1',
        topicId: 'topic-1',
      },
      scopeKey: 'topic:topic-1',
      sourceId: 'tool-outcome:filesystem:writeFile:failed:tool-call-1',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed,
      timestamp: Date.now(),
    });

    await runAgentSignalWorkflow(createWorkflowContext({ agentId, sourceEvent, userId }), {
      createProcedurePolicyOptions,
      executeSourceEvent,
      getDb: async () => db,
    });

    expect(createProcedurePolicyOptions).toHaveBeenCalledWith({
      agentId,
      db,
      selfIterationEnabled: true,
      userId,
    });
    expect(executeSourceEvent).toHaveBeenCalledWith(
      sourceEvent,
      expect.any(Object),
      expect.objectContaining({
        policyOptions: expect.objectContaining({
          procedure: procedurePolicyOptions,
          skillManagement: {
            selfIterationEnabled: true,
          },
        }),
      }),
    );
  });
});
