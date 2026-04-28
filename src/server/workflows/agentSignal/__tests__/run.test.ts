// @vitest-environment node
import { agents, messages, threads, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { describe, expect, it, vi } from 'vitest';

import type { AgentSignalSourceEnvelope } from '@/server/services/agentSignal';
import {
  AGENT_SIGNAL_SOURCE_TYPES,
  type SourceAgentUserMessage,
} from '@/server/services/agentSignal/sourceTypes';
import {
  runAgentSignalWorkflow,
  type RunAgentSignalWorkflowDeps,
} from '@/server/workflows/agentSignal/run';
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

describe('runAgentSignalWorkflow', () => {
  it('bridges client.runtime.start into agent.user.message with serialized root-topic context', async () => {
    const db = await getTestDB();
    const userId = `eval_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const parentMessageId = `msg_${uuid()}`;
    const baseTimestamp = new Date('2026-01-01T00:00:00.000Z').getTime();
    let capturedSourceEvent: AgentSignalSourceEnvelope | undefined;

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
        capturedSourceEvent = sourceEvent as AgentSignalSourceEnvelope;
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

  it('assembles serializedContext from the matching thread before executing a threaded source event', async () => {
    const db = await getTestDB();
    const userId = `eval_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const threadId = `thread_${uuid()}`;
    const otherThreadId = `thread_${uuid()}`;
    const feedbackMessageId = `msg_${uuid()}`;
    const baseTimestamp = new Date('2026-01-02T00:00:00.000Z').getTime();
    let capturedSourceEvent: AgentSignalSourceEnvelope | undefined;

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
        capturedSourceEvent = sourceEvent as AgentSignalSourceEnvelope;
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
});
