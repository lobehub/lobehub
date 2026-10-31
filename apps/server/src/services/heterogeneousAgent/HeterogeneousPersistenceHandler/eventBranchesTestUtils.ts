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
  role: 'assistant' | 'user' | 'tool' | 'task' | 'system';
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

export const createHarness = (
  params: {
    assistantMessageId?: string;
    operationId?: string;
    topicAgentId?: string | null;
    topicId?: string;
    userId?: string | null;
  } = {},
) => {
  const operationId = params.operationId ?? 'op-test';
  const topicId = params.topicId ?? 'topic-test';
  const assistantMessageId = params.assistantMessageId ?? 'asst-seeded';
  const topicAgentId = params.topicAgentId ?? null;

  let nextSeq = 0;
  const messages = new Map<string, FakeMessage>();
  const threads = new Map<string, FakeThread>();

  messages.set(assistantMessageId, {
    agentId: topicAgentId,
    content: '',
    id: assistantMessageId,
    role: 'assistant',
    topicId,
  });

  const messageModel = {
    create: vi.fn(async (input: Partial<FakeMessage>, id?: string) => {
      nextSeq += 1;
      const msgId = id ?? `msg_${nextSeq}`;
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
        patch: {
          content?: string;
          heterogeneousToolState?: { operationId: string; snapshotSeq: number };
          metadata?: any;
          pluginError?: any;
          pluginState?: any;
        },
      ) => {
        const existing = messages.get(id);
        if (!existing) return { success: false };
        const snapshot = patch.heterogeneousToolState;
        const currentSeq =
          snapshot && existing.metadata?.heterogeneousToolStateOperationId === snapshot.operationId
            ? (existing.metadata.heterogeneousToolStateSeq ?? 0)
            : 0;
        if (snapshot && snapshot.snapshotSeq <= currentSeq) {
          return { applied: false, snapshotSeq: currentSeq, success: true };
        }
        messages.set(id, {
          ...existing,
          content: patch.content ?? existing.content,
          metadata: snapshot
            ? {
                ...existing.metadata,
                ...patch.metadata,
                heterogeneousToolStateOperationId: snapshot.operationId,
                heterogeneousToolStateSeq: snapshot.snapshotSeq,
              }
            : (patch.metadata ?? existing.metadata),
          pluginError: patch.pluginError,
          pluginState: patch.pluginState ?? existing.pluginState,
        });
        return {
          applied: true,
          snapshotSeq: snapshot?.snapshotSeq,
          success: true,
        };
      },
    ),
    findById: vi.fn(async (id: string) => messages.get(id) ?? null),
    getLatestSpineMessageId: vi.fn(
      async ({ threadId, topicId }: { threadId?: string | null; topicId: string }) => {
        const match = [...messages.values()].findLast(
          (m) =>
            m.topicId === topicId &&
            m.role !== 'tool' &&
            m.threadId === (threadId ?? null) &&
            !(m as any).metadata?.signal,
        );
        return match?.id;
      },
    ),
    listMessagePluginsByTopic: vi.fn(async (_topicId: string) => []),
    updateMessagePlugin: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const existing = messages.get(id);
      if (existing) messages.set(id, { ...existing, plugin: { ...existing.plugin, ...patch } });
    }),
    updatePluginState: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const existing = messages.get(id);
      if (existing) {
        messages.set(id, { ...existing, pluginState: { ...existing.pluginState, ...patch } });
      }
    }),
  };

  const threadModel = {
    create: vi.fn(async (input: Partial<FakeThread>) => {
      const thread: FakeThread = {
        id: input.id!,
        metadata: input.metadata,
        sourceMessageId: input.sourceMessageId,
        status: input.status ?? 'active',
        title: input.title ?? '',
        topicId: input.topicId ?? topicId,
        type: input.type ?? 'isolation',
      };
      threads.set(thread.id, thread);
      return thread;
    }),
    update: vi.fn(async (id: string, patch: Partial<FakeThread>) => {
      const existing = threads.get(id);
      if (existing) threads.set(id, { ...existing, ...patch });
    }),
  };

  const topicModel = {
    findById: vi.fn(async () => ({
      agentId: topicAgentId,
      id: topicId,
      metadata: { runningOperation: { assistantMessageId, operationId } },
    })),
    updateMetadata: vi.fn(async (_topicId: string, _patch: any) => {}),
  };

  const handler = new HeterogeneousPersistenceHandler({
    messageModel: messageModel as any,
    threadModel: threadModel as any,
    topicModel: topicModel as any,
    userId: params.userId === null ? undefined : (params.userId ?? 'user-test'),
  });

  return {
    assistantMessageId,
    handler,
    messageModel,
    messages,
    operationId,
    threadModel,
    threads,
    topicId,
    topicModel,
  };
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

export const ingest = async (h: ReturnType<typeof createHarness>, events: AgentStreamEvent[]) =>
  h.handler.ingest({ events, operationId: h.operationId, topicId: h.topicId });
