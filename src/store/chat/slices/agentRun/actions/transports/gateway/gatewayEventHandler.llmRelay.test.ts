import type { AgentStreamEvent, LlmExecuteData } from '@lobechat/agent-gateway-client';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as agentSignalBridge from '@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { createGatewayEventHandler } from './gatewayEventHandler';

const relay = vi.hoisted(() => {
  const owned = new Set<string>();
  return {
    cancel: vi.fn(),
    cancelOperation: vi.fn(),
    execute: vi.fn(),
    owned,
    ownsCall: (callId?: string) => !!callId && owned.has(callId),
  };
});

vi.mock('@/services/llmRelay', () => ({
  llmRelayExecutor: {
    cancel: relay.cancel,
    cancelOperation: relay.cancelOperation,
    execute: relay.execute,
    ownsCall: relay.ownsCall,
  },
}));

vi.mock('@/store/tool/slices/builtin/executors', () => ({
  getExecutor: vi.fn(() => ({})),
  registerBuiltinToolExecutors: vi.fn(),
}));

const context = { agentId: 'agent-1', topicId: 'topic-1' } as ConversationContext;

const makeEvent = (type: AgentStreamEvent['type'], data?: AgentStreamEvent['data']) =>
  ({ data, id: 'e', operationId: 'op-1', stepIndex: 0, timestamp: 0, type }) as AgentStreamEvent;

const execute = (overrides: Partial<LlmExecuteData> = {}): LlmExecuteData => ({
  assistantMessageId: 'msg-1',
  attempt: 1,
  callId: 'op-1:0:1',
  deadlines: { claimMs: 15_000, firstChunkMs: 120_000, idleMs: 60_000, totalMs: 540_000 },
  leaseToken: 'lease',
  model: 'qwen3',
  operationId: 'op-1',
  provider: 'ollama',
  runtimeProvider: 'ollama',
  stepIndex: 0,
  ...overrides,
});

const createStore = () => {
  const dbMessagesMap: Record<string, UIChatMessage[]> = {
    [messageMapKey(context)]: [{ content: '', id: 'msg-1', role: 'assistant' } as UIChatMessage],
  };
  return {
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    dbMessagesMap,
    internal_dispatchMessage: vi.fn(),
    internal_toggleToolCallingStreaming: vi.fn(),
    operations: {},
    operationsByContext: {},
    replaceMessages: vi.fn(),
    startOperation: vi.fn(() => ({ abortController: new AbortController(), operationId: 'r-op' })),
    updateOperationMetadata: vi.fn(),
  } as unknown as ChatStore;
};

const flush = async () => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

const contentUpdates = (store: ChatStore) =>
  vi
    .mocked(store.internal_dispatchMessage)
    .mock.calls.map(([action]) => action as any)
    .filter((action) => action.type === 'updateMessage' && 'content' in action.value)
    .map((action) => [action.id, action.value.content]);

describe('createGatewayEventHandler — LLM relay', () => {
  beforeEach(() => {
    // The handler logs async failures (e.g. `.catch(console.error)` chains)
    // that can still be in flight during worker teardown; real console calls
    // then race the vitest rpc shutdown and fail the shard with
    // "Closing rpc while onUserConsoleLog was pending".
    vi.spyOn(console, 'error').mockImplementation(() => {});
    relay.execute.mockReset();
    relay.cancel.mockReset();
    relay.cancelOperation.mockReset();
    relay.owned.clear();
    vi.spyOn(agentSignalBridge, 'emitClientAgentSignalSourceEvent').mockResolvedValue(undefined);
  });

  it('runs llm_execute locally, renders its output and skips the server echo', async () => {
    let emit!: (chunk: { data: unknown; type: string }) => void;
    relay.execute.mockImplementation((data: LlmExecuteData, options) => {
      relay.owned.add(data.callId);
      emit = options.onOutput;
      return Promise.resolve();
    });
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'msg-1',
      context,
      operationId: 'op-1',
    });

    handler(makeEvent('llm_execute', execute()));
    expect(relay.execute).toHaveBeenCalledWith(execute(), { onOutput: expect.any(Function) });

    emit({ data: 'Hello', type: 'text' });
    emit({ data: ' world', type: 'text' });
    await flush();
    // The server re-publishes the same output tagged with the call id.
    handler(
      makeEvent('stream_chunk', {
        chunkType: 'text',
        content: 'Hello world',
        relayCallId: 'op-1:0:1',
      }),
    );
    await flush();

    expect(contentUpdates(store)).toEqual([
      ['msg-1', 'Hello'],
      ['msg-1', 'Hello world'],
    ]);
  });

  it('keeps handling the run after a parked call error, so a resume streams into it', async () => {
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'msg-1',
      context,
      operationId: 'op-1',
    });

    // No client took the call: the run parks in `waiting_for_client`.
    handler(
      makeEvent('error', {
        body: { reason: 'no_executor', recoverable: true },
        error: 'ClientLlmExecutorUnavailable',
      }),
    );
    await flush();
    // A client resumed it; the replayed call reaches this session.
    handler(makeEvent('llm_execute', execute({ callId: 'op-1:1:1', stepIndex: 1 })));

    expect(relay.execute).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'op-1:1:1' }),
      expect.anything(),
    );
    expect(relay.cancelOperation).not.toHaveBeenCalled();
  });

  it('applies the echo when another client ran the call', async () => {
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'msg-1',
      context,
      operationId: 'op-1',
    });

    handler(
      makeEvent('stream_chunk', {
        chunkType: 'text',
        content: 'From tab 2',
        relayCallId: 'op-1:0:1',
      }),
    );
    await flush();

    expect(contentUpdates(store)).toEqual([['msg-1', 'From tab 2']]);
  });

  it('starts a re-dispatched attempt over instead of appending to the lost one', async () => {
    const emitters: Array<(chunk: { data: unknown; type: string }) => void> = [];
    relay.execute.mockImplementation((data: LlmExecuteData, options) => {
      relay.owned.add(data.callId);
      emitters.push(options.onOutput);
      return Promise.resolve();
    });
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'msg-1',
      context,
      operationId: 'op-1',
    });

    handler(makeEvent('llm_execute', execute()));
    emitters[0]({ data: 'half', type: 'text' });
    handler(makeEvent('llm_execute', execute({ attempt: 2, callId: 'op-1:0:2' })));
    emitters[1]({ data: 'fresh', type: 'text' });
    await flush();

    expect(contentUpdates(store)).toEqual([
      ['msg-1', 'half'],
      ['msg-1', 'fresh'],
    ]);
  });

  it('keeps output rendered ahead of stream_start for the same message', async () => {
    let emit!: (chunk: { data: unknown; type: string }) => void;
    relay.execute.mockImplementation((data: LlmExecuteData, options) => {
      relay.owned.add(data.callId);
      emit = options.onOutput;
      return Promise.resolve();
    });
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed',
      context,
      operationId: 'op-1',
    });

    handler(makeEvent('llm_execute', execute()));
    emit({ data: 'early', type: 'text' });
    handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-1' } }));
    // A server-side chunk for the same message (tool call text, etc.) appends.
    handler(makeEvent('stream_chunk', { chunkType: 'text', content: '!' }));
    await flush();

    expect(contentUpdates(store).at(-1)).toEqual(['msg-1', 'early!']);
  });

  it('puts output that raced ahead of a later step onto its message shell', async () => {
    let emit!: (chunk: { data: unknown; type: string }) => void;
    relay.execute.mockImplementation((data: LlmExecuteData, options) => {
      relay.owned.add(data.callId);
      emit = options.onOutput;
      return Promise.resolve();
    });
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'msg-1',
      context,
      operationId: 'op-1',
    });

    // Step 2's assistant row is not in the store when its relayed output lands.
    handler(makeEvent('llm_execute', execute({ assistantMessageId: 'msg-2', stepIndex: 2 })));
    emit({ data: 'early', type: 'text' });
    emit({ data: 'hmm', type: 'reasoning' });
    handler(
      makeEvent('stream_start', { assistantMessage: { id: 'msg-2', role: 'assistant' } } as any),
    );
    await flush();

    const actions = vi.mocked(store.internal_dispatchMessage).mock.calls.map(([a]) => a as any);
    const created = actions.findIndex((a) => a.type === 'createMessage' && a.id === 'msg-2');
    const after = actions.slice(created + 1).filter((a) => a.id === 'msg-2');
    expect(created).toBeGreaterThanOrEqual(0);
    expect(after).toContainEqual(
      expect.objectContaining({ type: 'updateMessage', value: { content: 'early' } }),
    );
    expect(after).toContainEqual(
      expect.objectContaining({
        type: 'updateMessage',
        value: { reasoning: { content: 'hmm' } },
      }),
    );
  });

  it('forwards llm_cancel to the executor and ignores relays on share visitors', async () => {
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'msg-1',
      context,
      operationId: 'op-1',
    });
    handler(makeEvent('llm_cancel', { callId: 'op-1:0:1', reason: 'interrupted' }));
    expect(relay.cancel).toHaveBeenCalledWith({ callId: 'op-1:0:1', reason: 'interrupted' });

    const visitor = createGatewayEventHandler(() => store, {
      assistantMessageId: 'msg-1',
      context: { ...context, agentShareId: 'share-1' } as ConversationContext,
      operationId: 'op-1',
    });
    visitor(makeEvent('llm_execute', execute()));
    expect(relay.execute).not.toHaveBeenCalled();
  });

  // The terminal event closes the session that would carry a trailing
  // `llm_cancel`, so the run's end itself stops the local attempt.
  it("stops the run's relayed attempts when the run ends", () => {
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'msg-1',
      context,
      operationId: 'op-1',
    });

    handler(makeEvent('agent_runtime_end', { reason: 'interrupted' }));

    expect(relay.cancelOperation).toHaveBeenCalledWith('op-1');
  });
});
