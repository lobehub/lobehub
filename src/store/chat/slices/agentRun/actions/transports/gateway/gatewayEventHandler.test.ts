import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import * as agentSignalBridge from '@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { createGatewayEventHandler } from './gatewayEventHandler';

const context = {
  agentId: 'agent-1',
  topicId: 'topic-1',
} as ConversationContext;

const makeEvent = (type: AgentStreamEvent['type'], data?: AgentStreamEvent['data']) =>
  ({
    data,
    id: 'event-1',
    operationId: 'op-1',
    stepIndex: 1,
    timestamp: 0,
    type,
  }) as AgentStreamEvent;

const createStore = (dbMessagesMap: Record<string, UIChatMessage[]> = {}) =>
  ({
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    dbMessagesMap,
    internal_dispatchMessage: vi.fn(),
    internal_toggleToolCallingStreaming: vi.fn(),
    operations: {},
    replaceMessages: vi.fn(),
    startOperation: vi.fn(() => ({
      abortController: new AbortController(),
      operationId: 'reasoning-op',
    })),
    updateOperationMetadata: vi.fn(),
  }) as unknown as ChatStore;

// The handler enqueues work on an internal promise chain; flush the microtask
// queue so async event handlers settle before assertions. Each `await` inside a
// queued handler costs a tick, so keep this comfortably above the longest chain
// rather than tuned to today's exact hop count.
const flush = async () => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

describe('createGatewayEventHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(agentSignalBridge, 'emitClientAgentSignalSourceEvent').mockResolvedValue(undefined);
  });

  it('inserts the assistant shell locally when stream_start carries the message seed (new server)', async () => {
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(
      makeEvent('stream_start', {
        assistantMessage: {
          id: 'step2-msg',
          model: 'gpt-4o',
          provider: 'openai',
          role: 'assistant',
        },
      }),
    );
    await flush();

    expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
      {
        id: 'step2-msg',
        type: 'createMessage',
        value: expect.objectContaining({
          content: '',
          model: 'gpt-4o',
          provider: 'openai',
          role: 'assistant',
          topicId: 'topic-1',
        }),
      },
      { operationId: 'op-1' },
    );
    // No DB roundtrip needed when the seed is present.
    expect(store.replaceMessages).not.toHaveBeenCalled();
  });

  it('falls back to a DB refetch when stream_start ships only { id } (old server)', async () => {
    const getMessages = vi
      .spyOn(messageService, 'getMessages')
      .mockResolvedValue([] as unknown as UIChatMessage[]);
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(makeEvent('stream_start', { assistantMessage: { id: 'step2-msg' } }));
    await flush();

    expect(getMessages).toHaveBeenCalled();
    expect(store.replaceMessages).toHaveBeenCalled();
    // No local shell insert when the seed is absent.
    expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
  });

  it('skips tool_end DB refetch for hetero events that already reconciled frontend state', async () => {
    const getMessages = vi
      .spyOn(messageService, 'getMessages')
      .mockResolvedValue([] as unknown as UIChatMessage[]);
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
      runtimeType: 'hetero',
    });

    handler(makeEvent('tool_end', { isSuccess: true, skipMessageFetch: true }));
    await flush();

    expect(getMessages).not.toHaveBeenCalled();
    expect(store.replaceMessages).not.toHaveBeenCalled();
  });

  it('keeps gateway tool_end on the DB-refetch path even if the skip flag is present', async () => {
    const getMessages = vi
      .spyOn(messageService, 'getMessages')
      .mockResolvedValue([] as unknown as UIChatMessage[]);
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(makeEvent('tool_end', { isSuccess: true, skipMessageFetch: true }));
    await flush();

    // Mid-stream tool_end refetches skip the Work-summary assembly and graft
    // previously rendered works back via `preserveWorks`.
    expect(getMessages).toHaveBeenCalledWith({ ...context, skipWorks: true });
    expect(store.replaceMessages).toHaveBeenCalledWith([], { context, preserveWorks: true });
  });

  it('skips hetero execution_complete DB refetch when frontend state is the snapshot', async () => {
    const getMessages = vi
      .spyOn(messageService, 'getMessages')
      .mockResolvedValue([] as unknown as UIChatMessage[]);
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
      runtimeType: 'hetero',
    });

    handler(makeEvent('step_complete', { phase: 'execution_complete', skipMessageFetch: true }));
    await flush();

    expect(getMessages).not.toHaveBeenCalled();
    expect(store.replaceMessages).not.toHaveBeenCalled();
  });

  // The placeholder tool row only reaches the store via the `toolMessageIds`
  // refetch queued by the preceding tools_calling chunk. A fast sub-agent emits
  // its progress event while that fetch is still in flight — dispatched inline it
  // would land on a row that doesn't exist yet and no-op away the whole live
  // readout (a single-step child has no later sample to self-heal with).
  it('queues sub-agent progress behind the placeholder refetch it depends on', async () => {
    const order: string[] = [];
    let resolveFetch: (() => void) | undefined;
    vi.spyOn(messageService, 'getMessages').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = () => {
            order.push('fetch');
            resolve([] as unknown as UIChatMessage[]);
          };
        }),
    );

    const store = createStore();
    (store.internal_dispatchMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (payload: { type?: string }) => {
        if (payload?.type === 'updatePluginState') order.push('progress');
      },
    );

    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(
      makeEvent('stream_chunk', {
        chunkType: 'tools_calling',
        toolMessageIds: { 'call-1': 'tool-msg-sub' },
        toolsCalling: [{ apiName: 'callSubAgent', id: 'call-1' }],
      }),
    );
    handler(
      makeEvent('step_complete', {
        phase: 'subagent_progress',
        toolMessageId: 'tool-msg-sub',
        totalTokens: 4321,
        totalToolCalls: 3,
      }),
    );

    await flush();
    // The fetch is still pending, so the progress patch must not have run yet.
    expect(order).toEqual([]);

    resolveFetch?.();
    await flush();

    expect(order).toEqual(['fetch', 'progress']);
  });

  it('patches live sub-agent progress onto the placeholder tool message, in memory only', async () => {
    const getMessages = vi
      .spyOn(messageService, 'getMessages')
      .mockResolvedValue([] as unknown as UIChatMessage[]);
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(
      makeEvent('step_complete', {
        model: 'claude-sonnet-5',
        phase: 'subagent_progress',
        toolMessageId: 'tool-msg-sub',
        totalTokens: 4321,
        totalToolCalls: 3,
      }),
    );
    await flush();

    expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
      {
        id: 'tool-msg-sub',
        key: 'progress',
        type: 'updatePluginState',
        value: { model: 'claude-sonnet-5', totalTokens: 4321, totalToolCalls: 3 },
      },
      { operationId: 'op-1' },
    );
    // Live progress is advisory — the completion bridge owns the persisted value,
    // so this must never trigger a DB read or write.
    expect(getMessages).not.toHaveBeenCalled();
    expect(store.replaceMessages).not.toHaveBeenCalled();
  });

  it('bootstraps a missing tool once and reapplies the latest snapshot after a stale refetch', async () => {
    const key = messageMapKey(context);
    let resolveFetch: ((messages: UIChatMessage[]) => void) | undefined;
    const getMessages = vi.spyOn(messageService, 'getMessages').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve as (messages: UIChatMessage[]) => void;
        }),
    );
    const store = createStore();
    (store.replaceMessages as ReturnType<typeof vi.fn>).mockImplementation(
      (messages: UIChatMessage[]) => {
        store.dbMessagesMap[key] = messages;
      },
    );
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(
      makeEvent('stream_chunk', {
        chunkType: 'tool_state',
        pluginState: { version: 3 },
        snapshotMode: 'replace',
        snapshotSeq: 3,
        toolCallId: 'todo-1',
      }),
    );
    await flush();
    expect(getMessages).toHaveBeenCalledTimes(1);

    // Arrives while the bootstrap read is still pending. It must update the
    // synchronous latest cache rather than wait behind that read.
    handler(
      makeEvent('stream_chunk', {
        chunkType: 'tool_state',
        pluginState: { version: 4 },
        snapshotMode: 'replace',
        snapshotSeq: 4,
        toolCallId: 'todo-1',
      }),
    );
    resolveFetch?.([
      {
        content: '',
        id: 'tool-msg-1',
        metadata: {
          heterogeneousToolStateOperationId: 'op-1',
          heterogeneousToolStateSeq: 3,
        },
        parentId: 'seed-msg',
        pluginState: { version: 3 },
        role: 'tool',
        tool_call_id: 'todo-1',
      } as UIChatMessage,
    ]);
    await flush();

    expect(getMessages).toHaveBeenCalledTimes(1);
    expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
      {
        id: 'tool-msg-1',
        metadata: {
          heterogeneousToolStateOperationId: 'op-1',
          heterogeneousToolStateSeq: 4,
        },
        type: 'replaceMessagePluginState',
        value: { version: 4 },
      },
      { operationId: 'op-1' },
    );
  });

  it('bootstraps the current tool instead of applying a reused call id to an older run', async () => {
    const key = messageMapKey(context);
    const getMessages = vi.spyOn(messageService, 'getMessages').mockResolvedValue([
      {
        content: '',
        id: 'tool-current',
        parentId: 'seed-msg',
        pluginState: { version: 1 },
        role: 'tool',
        tool_call_id: 'todo-1',
      } as UIChatMessage,
    ]);
    const store = createStore({
      [key]: [
        {
          content: 'Previous run result',
          id: 'tool-previous',
          parentId: 'assistant-previous',
          pluginState: { version: 'previous' },
          role: 'tool',
          tool_call_id: 'todo-1',
        } as UIChatMessage,
      ],
    });
    (store.replaceMessages as ReturnType<typeof vi.fn>).mockImplementation(
      (messages: UIChatMessage[]) => {
        store.dbMessagesMap[key] = messages;
      },
    );
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(
      makeEvent('stream_chunk', {
        chunkType: 'tool_state',
        pluginState: { version: 2 },
        snapshotMode: 'replace',
        snapshotSeq: 2,
        toolCallId: 'todo-1',
      }),
    );
    await flush();

    expect(getMessages).toHaveBeenCalledTimes(1);
    expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
      {
        id: 'tool-current',
        metadata: {
          heterogeneousToolStateOperationId: 'op-1',
          heterogeneousToolStateSeq: 2,
        },
        type: 'replaceMessagePluginState',
        value: { version: 2 },
      },
      { operationId: 'op-1' },
    );
  });

  it('drops a tool-state event at or below the message durable watermark', async () => {
    const key = messageMapKey(context);
    const getMessages = vi.spyOn(messageService, 'getMessages');
    const store = createStore({
      [key]: [
        {
          content: '',
          id: 'tool-msg-1',
          metadata: {
            heterogeneousToolStateOperationId: 'op-1',
            heterogeneousToolStateSeq: 5,
          },
          parentId: 'seed-msg',
          pluginState: { version: 5 },
          role: 'tool',
          tool_call_id: 'todo-1',
        } as UIChatMessage,
      ],
    });
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(
      makeEvent('stream_chunk', {
        chunkType: 'tool_state',
        pluginState: { version: 4 },
        snapshotMode: 'replace',
        snapshotSeq: 4,
        toolCallId: 'todo-1',
      }),
    );
    await flush();

    expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('orders the terminal refresh after a pending bootstrap so the final tool state wins', async () => {
    const key = messageMapKey(context);
    const fetchResolvers: Array<(messages: UIChatMessage[]) => void> = [];
    const getMessages = vi.spyOn(messageService, 'getMessages').mockImplementation(
      () =>
        new Promise((resolve) => {
          fetchResolvers.push(resolve as (messages: UIChatMessage[]) => void);
        }),
    );
    const store = createStore();
    (store.replaceMessages as ReturnType<typeof vi.fn>).mockImplementation(
      (messages: UIChatMessage[]) => {
        store.dbMessagesMap[key] = messages;
      },
    );
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(
      makeEvent('stream_chunk', {
        chunkType: 'tool_state',
        pluginState: { version: 3 },
        snapshotMode: 'replace',
        snapshotSeq: 3,
        toolCallId: 'todo-1',
      }),
    );
    await flush();
    expect(getMessages).toHaveBeenCalledTimes(1);

    handler(
      makeEvent('tool_end', {
        isSuccess: true,
        toolCallId: 'todo-1',
      }),
    );

    await flush();
    // The terminal refresh is queued behind the bootstrap instead of racing it.
    expect(getMessages).toHaveBeenCalledTimes(1);

    fetchResolvers[0]?.([
      {
        content: '',
        id: 'tool-msg-1',
        pluginState: { version: 3 },
        role: 'tool',
        tool_call_id: 'todo-1',
      } as UIChatMessage,
    ]);
    await flush();
    expect(getMessages).toHaveBeenCalledTimes(2);

    fetchResolvers[1]?.([
      {
        content: 'Todo list updated.',
        id: 'tool-msg-1',
        pluginState: { version: 'final' },
        role: 'tool',
        tool_call_id: 'todo-1',
      } as UIChatMessage,
    ]);
    await flush();

    expect(store.dbMessagesMap[key]).toEqual([
      expect.objectContaining({
        content: 'Todo list updated.',
        pluginState: { version: 'final' },
      }),
    ]);
  });

  it('accepts a new tool-state lifecycle when a call id is reused in one operation', async () => {
    const key = messageMapKey(context);
    const store = createStore({
      [key]: [
        {
          content: '',
          id: 'tool-msg-1',
          parentId: 'seed-msg',
          role: 'tool',
          tool_call_id: 'todo-1',
        } as UIChatMessage,
      ],
    });
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
      runtimeType: 'hetero',
    });

    handler(makeEvent('tool_start', { toolCallId: 'todo-1' }));
    handler(
      makeEvent('stream_chunk', {
        chunkType: 'tool_state',
        pluginState: { version: 1 },
        snapshotMode: 'replace',
        snapshotSeq: 1,
        toolCallId: 'todo-1',
      }),
    );
    await flush();

    handler(
      makeEvent('tool_end', {
        isSuccess: true,
        skipMessageFetch: true,
        toolCallId: 'todo-1',
      }),
    );
    await flush();

    handler(makeEvent('tool_start', { toolCallId: 'todo-1' }));
    handler(
      makeEvent('stream_chunk', {
        chunkType: 'tool_state',
        pluginState: { version: 2 },
        snapshotMode: 'replace',
        snapshotSeq: 2,
        toolCallId: 'todo-1',
      }),
    );
    await flush();

    const stateUpdates = (store.internal_dispatchMessage as ReturnType<typeof vi.fn>).mock.calls
      .map(([payload]) => payload)
      .filter((payload) => payload.type === 'replaceMessagePluginState');
    expect(stateUpdates).toMatchObject([{ value: { version: 1 } }, { value: { version: 2 } }]);
  });

  it('retries bootstrap when a newer snapshot arrives before the first fetch fails', async () => {
    const key = messageMapKey(context);
    let rejectBootstrap: ((reason: Error) => void) | undefined;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const getMessages = vi
      .spyOn(messageService, 'getMessages')
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectBootstrap = reject;
          }),
      )
      .mockResolvedValueOnce([
        {
          content: '',
          id: 'tool-msg-1',
          parentId: 'seed-msg',
          pluginState: { version: 1 },
          role: 'tool',
          tool_call_id: 'todo-1',
        } as UIChatMessage,
      ]);
    const store = createStore();
    (store.replaceMessages as ReturnType<typeof vi.fn>).mockImplementation(
      (messages: UIChatMessage[]) => {
        store.dbMessagesMap[key] = messages;
      },
    );
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(
      makeEvent('stream_chunk', {
        chunkType: 'tool_state',
        pluginState: { version: 1 },
        snapshotMode: 'replace',
        snapshotSeq: 1,
        toolCallId: 'todo-1',
      }),
    );
    await flush();
    expect(getMessages).toHaveBeenCalledTimes(1);

    handler(
      makeEvent('stream_chunk', {
        chunkType: 'tool_state',
        pluginState: { version: 2 },
        snapshotMode: 'replace',
        snapshotSeq: 2,
        toolCallId: 'todo-1',
      }),
    );
    rejectBootstrap?.(new Error('bootstrap failed'));
    await flush();

    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
      {
        id: 'tool-msg-1',
        metadata: {
          heterogeneousToolStateOperationId: 'op-1',
          heterogeneousToolStateSeq: 2,
        },
        type: 'replaceMessagePluginState',
        value: { version: 2 },
      },
      { operationId: 'op-1' },
    );
  });

  it('ignores a sub-agent progress event with no tool message anchor', async () => {
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(makeEvent('step_complete', { phase: 'subagent_progress', totalTokens: 10 }));
    await flush();

    expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
  });

  it('preserves existing result_msg_id when a tools_calling chunk omits result links', async () => {
    const store = createStore({
      key: [
        {
          content: '',
          id: 'seed-msg',
          role: 'assistant',
          tools: [
            { apiName: 'Read', id: 'tc-1', result_msg_id: 'tool-msg-1' },
            { apiName: 'Write', id: 'tc-2', result_msg_id: 'tool-msg-2' },
          ],
        } as unknown as UIChatMessage,
      ],
    });
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
      runtimeType: 'hetero',
    });

    handler(
      makeEvent('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [
          { apiName: 'Read', id: 'tc-1' },
          { apiName: 'Write', id: 'tc-2', result_msg_id: 'server-tool-msg-2' },
        ],
      }),
    );
    await flush();

    expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
      {
        id: 'seed-msg',
        type: 'updateMessage',
        value: {
          tools: [
            { apiName: 'Read', id: 'tc-1', result_msg_id: 'tool-msg-1' },
            { apiName: 'Write', id: 'tc-2', result_msg_id: 'server-tool-msg-2' },
          ],
        },
      },
      { operationId: 'op-1' },
    );
  });

  it('does not insert a shell when the assistant row is already in the store', async () => {
    const store = createStore({
      key: [{ content: 'existing', id: 'step2-msg', role: 'assistant' } as UIChatMessage],
    });
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(
      makeEvent('stream_start', {
        assistantMessage: { id: 'step2-msg', role: 'assistant' },
      }),
    );
    await flush();

    expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
  });

  it('skips the visible_output_end hint while the assistant row is missing (LOBE-11501)', async () => {
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'missing-msg',
      context,
      operationId: 'op-1',
    });

    handler(makeEvent('visible_output_end'));
    await flush();

    expect(store.updateOperationMetadata).not.toHaveBeenCalled();
  });

  it('honors the visible_output_end hint once the streamed content has landed', async () => {
    const store = createStore({
      key: [{ content: 'answer', id: 'answer-msg', role: 'assistant' } as UIChatMessage],
    });
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-1',
    });

    handler(makeEvent('visible_output_end'));
    await flush();

    expect(store.updateOperationMetadata).toHaveBeenCalledWith('op-1', {
      visibleLoadingDone: true,
    });
  });

  // ────────────────────────────────────────────────────
  // Gateway completion notification body
  // ────────────────────────────────────────────────────

  const createLifecycle = () => ({
    afterRunComplete: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn().mockResolvedValue({ requeued: false }),
  });

  it('passes the streamed report text as the gateway completion notification body', async () => {
    vi.spyOn(messageService, 'getMessages').mockResolvedValue([] as unknown as UIChatMessage[]);
    const lifecycle = createLifecycle();
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-1',
      runLifecycle: lifecycle as any,
      runtimeType: 'gateway',
    });

    // Stream the report text so `accumulatedContent` (the optimistic in-memory
    // source) holds it, then end the run with no terminal uiMessages snapshot.
    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'The final report.' }));
    handler(makeEvent('agent_runtime_end', { reason: 'completed' }));
    await flush();

    expect(lifecycle.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );
    expect(lifecycle.afterRunComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: { content: 'The final report.' },
        status: 'completed',
      }),
    );
  });

  it('prefers the terminal snapshot final assistant text over the streamed accumulator', async () => {
    vi.spyOn(messageService, 'getMessages').mockResolvedValue([] as unknown as UIChatMessage[]);
    const lifecycle = createLifecycle();
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-1',
      runLifecycle: lifecycle as any,
      runtimeType: 'gateway',
    });

    // The stream dropped the tail; the server-finalized snapshot has the whole
    // report, and the chat is reconciled to it — so must the notification be.
    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'The final rep' }));
    handler(
      makeEvent('agent_runtime_end', {
        reason: 'completed',
        uiMessages: [
          { content: 'run it', id: 'user-msg', role: 'user' },
          { content: 'The final report.', id: 'answer-msg', role: 'assistant' },
        ] as unknown as UIChatMessage[],
      }),
    );
    await flush();

    expect(lifecycle.afterRunComplete).toHaveBeenCalledWith(
      expect.objectContaining({ notification: { content: 'The final report.' } }),
    );
  });

  it('falls back to the streamed accumulator when the terminal snapshot carries no assistant text', async () => {
    vi.spyOn(messageService, 'getMessages').mockResolvedValue([] as unknown as UIChatMessage[]);
    const lifecycle = createLifecycle();
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-1',
      runLifecycle: lifecycle as any,
      runtimeType: 'gateway',
    });

    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'The final report.' }));
    handler(
      makeEvent('agent_runtime_end', {
        reason: 'completed',
        uiMessages: [
          { content: '', id: 'answer-msg', role: 'assistant' },
        ] as unknown as UIChatMessage[],
      }),
    );
    await flush();

    expect(lifecycle.afterRunComplete).toHaveBeenCalledWith(
      expect.objectContaining({ notification: { content: 'The final report.' } }),
    );
  });

  it('passes empty notification content when nothing streamed so afterRunComplete can fall back to the store', async () => {
    vi.spyOn(messageService, 'getMessages').mockResolvedValue([] as unknown as UIChatMessage[]);
    const lifecycle = createLifecycle();
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-1',
      runLifecycle: lifecycle as any,
      runtimeType: 'gateway',
    });

    handler(makeEvent('agent_runtime_end', { reason: 'completed' }));
    await flush();

    expect(lifecycle.afterRunComplete).toHaveBeenCalledWith(
      expect.objectContaining({ notification: { content: '' } }),
    );
  });

  it('does not fire afterRunComplete on a cancelled (non-completed) gateway run', async () => {
    vi.spyOn(messageService, 'getMessages').mockResolvedValue([] as unknown as UIChatMessage[]);
    const lifecycle = createLifecycle();
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-1',
      runLifecycle: lifecycle as any,
      runtimeType: 'gateway',
    });

    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'partial' }));
    handler(makeEvent('agent_runtime_end', { reason: 'interrupted' }));
    await flush();

    expect(lifecycle.afterRunComplete).not.toHaveBeenCalled();
  });
});
