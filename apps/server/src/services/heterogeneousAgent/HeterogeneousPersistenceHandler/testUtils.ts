import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { vi } from 'vitest';

import { HeterogeneousPersistenceHandler } from '.';

interface FakeMessage {
  agentId: string | null;
  content: string;
  error?: any;
  id: string;
  metadata?: any;
  model?: string;
  parentId?: string | null;
  plugin?: any;
  pluginError?: any;
  pluginState?: any;
  provider?: string;
  reasoning?: any;
  role: 'user' | 'assistant' | 'tool' | 'task' | 'system';
  threadId?: string | null;
  tool_call_id?: string;
  tools?: any[];
  topicId: string | null;
}

interface FakeThread {
  id: string;
  metadata?: any;
  sourceMessageId?: string | null;
  status: string;
  title: string;
  topicId: string;
  type: string;
}

export interface FakeTopicMetadata {
  heteroCurrentMsgId?: { msgId: string; operationId: string };
  runningOperation?: {
    assistantMessageId: string;
    operationId: string;
    threadId?: string;
  };
}

interface FakeTopic {
  agentId: string | null;
  id: string;
  metadata: FakeTopicMetadata;
}

export const createHarness = (params: {
  assistantAgentId?: string | null;
  assistantMessageId: string;
  /** Stands in for the operation row: is this run still live on this topic? */
  isOperationLiveOnTopic?: (operationId: string, topicId: string) => Promise<boolean>;
  operationId: string;
  topicAgentId?: string | null;
  topicId: string;
  threadId?: string;
}) => {
  let nextMsgIdSeq = 0;
  const messages = new Map<string, FakeMessage>();
  const threads = new Map<string, FakeThread>();

  // Seed the initial assistant message that the orchestrator would have
  // created before triggering the CLI ingest.
  messages.set(params.assistantMessageId, {
    agentId: params.assistantAgentId ?? params.topicAgentId ?? null,
    content: '',
    id: params.assistantMessageId,
    role: 'assistant',
    threadId: params.threadId ?? null,
    topicId: params.topicId,
  });

  const messageModel = {
    create: vi.fn(async (input: Partial<FakeMessage>, id?: string) => {
      nextMsgIdSeq += 1;
      const msgId = id ?? `msg_${nextMsgIdSeq}`;
      const msg: FakeMessage = {
        agentId: input.agentId ?? null,
        content: input.content ?? '',
        id: msgId,
        metadata: input.metadata,
        model: input.model,
        parentId: input.parentId ?? null,
        plugin: input.plugin,
        provider: input.provider,
        role: input.role!,
        threadId: input.threadId ?? null,
        tool_call_id: input.tool_call_id,
        topicId: input.topicId ?? null,
      };
      messages.set(msgId, msg);
      return msg;
    }),
    update: vi.fn(async (id: string, patch: Partial<FakeMessage>) => {
      const existing = messages.get(id);
      if (!existing) return { success: false };
      messages.set(id, { ...existing, ...patch });
      return { success: true };
    }),
    updateToolMessage: vi.fn(
      async (
        id: string,
        patch: { content?: string; metadata?: any; pluginError?: any; pluginState?: any },
      ) => {
        const existing = messages.get(id);
        if (!existing) return { success: false };
        messages.set(id, {
          ...existing,
          content: patch.content ?? existing.content,
          metadata: patch.metadata ?? existing.metadata,
          pluginError: patch.pluginError,
          pluginState: patch.pluginState ?? existing.pluginState,
        });
        return { success: true };
      },
    ),
    findById: vi.fn(async (id: string) => messages.get(id) ?? null),
    getLatestSpineMessageId: vi.fn(
      async ({
        operationId,
        threadId,
      }: {
        operationId?: string;
        threadId?: string | null;
        topicId: string;
      }) => {
        const match = [...messages.values()].findLast(
          (m) =>
            m.role !== 'tool' &&
            (!operationId || m.metadata?.operationId === operationId) &&
            (m.threadId ?? null) === (threadId ?? null) &&
            !(m as any).metadata?.signal,
        );
        return match?.id;
      },
    ),
    listMessagePluginsByTopic: vi.fn(async (_topicId: string) => []),
  };

  const threadModel = {
    create: vi.fn(async (input: Partial<FakeThread>) => {
      const thread: FakeThread = {
        id: input.id!,
        metadata: input.metadata,
        sourceMessageId: input.sourceMessageId,
        status: input.status ?? 'active',
        title: input.title ?? '',
        topicId: input.topicId ?? params.topicId,
        type: input.type ?? 'isolation',
      };
      threads.set(thread.id, thread);
      return thread;
    }),
    findById: vi.fn(async (id: string) => threads.get(id) ?? null),
    update: vi.fn(async (id: string, patch: Partial<FakeThread>) => {
      const existing = threads.get(id);
      if (!existing) return;
      threads.set(id, { ...existing, ...patch });
    }),
  };

  const topicModel = {
    findById: vi.fn(async (id: string): Promise<FakeTopic | null> => {
      if (id !== params.topicId) return null;
      return {
        agentId: params.topicAgentId ?? null,
        id,
        metadata: {
          runningOperation: {
            assistantMessageId: params.assistantMessageId,
            operationId: params.operationId,
            threadId: params.threadId,
          },
        } satisfies FakeTopicMetadata,
      };
    }),
    updateMetadata: vi.fn(async (_topicId: string, _patch: any) => {}),
  };

  const handler = new HeterogeneousPersistenceHandler({
    isOperationLiveOnTopic: params.isOperationLiveOnTopic,
    messageModel: messageModel as any,
    threadModel: threadModel as any,
    topicModel: topicModel as any,
  });

  return { handler, messageModel, messages, threadModel, threads, topicModel };
};

export const buildEvent = (
  type: AgentStreamEvent['type'],
  stepIndex: number,
  data: Record<string, unknown>,
  timestamp = 1_700_000_000_000 + stepIndex,
): AgentStreamEvent => ({
  data,
  operationId: 'op-test',
  stepIndex,
  timestamp,
  type,
});
