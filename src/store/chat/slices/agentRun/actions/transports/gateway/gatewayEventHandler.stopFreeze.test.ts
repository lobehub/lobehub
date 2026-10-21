import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { LOADING_FLAT } from '@lobechat/const';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { INTERRUPT_STOP_SNAPSHOT_MAX_LENGTH } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import * as agentSignalBridge from '@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { createGatewayEventHandler } from './gatewayEventHandler';
import { freezeGatewayRunForStop, unfreezeGatewayRunForStop } from './stopFreeze';

const executorMocks = vi.hoisted(() => ({
  onAfterCall: vi.fn(),
}));

vi.mock('@/store/tool/slices/builtin/executors', () => ({
  getExecutor: vi.fn(() => ({ onAfterCall: executorMocks.onAfterCall })),
  registerBuiltinToolExecutors: vi.fn(),
}));

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
    operationsByContext: {},
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

describe('createGatewayEventHandler — stop freeze', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(agentSignalBridge, 'emitClientAgentSignalSourceEvent').mockResolvedValue(undefined);
  });

  /** A store whose reply text updates land in `dbMessagesMap`, as the real reducer does. */
  const createStreamingStore = () => {
    const key = messageMapKey(context);
    const store = createStore({
      [key]: [{ content: '', id: 'answer-msg', role: 'assistant' } as UIChatMessage],
    });
    vi.mocked(store.internal_dispatchMessage).mockImplementation(((action: any) => {
      if (action.type !== 'updateMessage' || action.value?.content === undefined) return;
      const message = store.dbMessagesMap[key].find((item) => item.id === action.id);
      if (message) message.content = action.value.content;
    }) as any);
    const shownContent = () => store.dbMessagesMap[key][0].content;
    return { shownContent, store };
  };

  it('keeps the reply at the text shown when Stop was pressed and returns it', async () => {
    // LOBE-14836: Stop froze the bubble at ~40 lines, but the server kept
    // streaming until its abort poll and saved all 80; the next send reloaded
    // the longer reply. The frozen text now goes with the interrupt.
    const { shownContent, store } = createStreamingStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-stop',
    });

    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'line 1\n' }));
    await flush();
    // Already received but not yet rendered when Stop lands.
    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'line 2\n' }));

    const snapshot = freezeGatewayRunForStop('op-stop');
    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'line 3\n' }));
    handler(makeEvent('stream_end', { finalContent: 'line 1\nline 2\nline 3\n' }));
    handler(makeEvent('agent_runtime_end', { reason: 'interrupted' }));
    await flush();

    expect(snapshot).toEqual({ assistantMessageId: 'answer-msg', content: 'line 1\n' });
    expect(shownContent()).toBe('line 1\n');
    // The run is over; a later Stop has nothing to freeze.
    expect(freezeGatewayRunForStop('op-stop')).toBeUndefined();
  });

  it('keeps the frozen reply when a patch-mode interrupt ends the run before the trim', async () => {
    // Protocol v2 owner runs: the interrupt publishes agent_runtime_end with
    // a new message revision while the stopped step is still saving its
    // untrimmed reply. Reading the DB then would replace the frozen bubble.
    const getMessages = vi.spyOn(messageService, 'getMessages');
    const { shownContent, store } = createStreamingStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-patch-stop',
    });

    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'line 1\n' }));
    await flush();
    freezeGatewayRunForStop('op-patch-stop');
    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'line 2\n' }));
    handler(
      makeEvent('agent_runtime_end', {
        messagePatchMode: true,
        messageRevision: 2,
        reason: 'interrupted',
      }),
    );
    await flush();

    expect(getMessages).not.toHaveBeenCalled();
    expect(shownContent()).toBe('line 1\n');
  });

  it('renders the whole reply again after a Stop request that did not land', async () => {
    const { shownContent, store } = createStreamingStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-retry',
    });

    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'a' }));
    await flush();
    freezeGatewayRunForStop('op-retry');
    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'b' }));
    await flush();
    expect(shownContent()).toBe('a');

    unfreezeGatewayRunForStop('op-retry');
    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'c' }));
    await flush();

    expect(shownContent()).toBe('abc');
  });

  it('keeps rendering when Stop lands before any server state', async () => {
    // No snapshot goes out, so the server keeps what it streams after Stop;
    // hiding that text would only bring it back on reload.
    const { shownContent, store } = createStreamingStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-empty',
    });

    expect(freezeGatewayRunForStop('op-empty')).toBeUndefined();
    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'late text' }));
    await flush();

    expect(shownContent()).toBe('late text');
  });

  it('releases the Stop control when the session ends without a terminal event', () => {
    const { store } = createStreamingStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-silent-end',
    });
    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'line 1\n' }));

    handler.dispose();

    expect(freezeGatewayRunForStop('op-silent-end')).toBeUndefined();
  });

  it('returns an empty snapshot when Stop lands before the reply text shows', async () => {
    // Stopped while the model was still thinking: the text it streams after
    // Stop is never shown, so the server must drop it too.
    const { shownContent, store } = createStreamingStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-thinking',
    });

    handler(
      makeEvent('stream_start', { assistantMessage: { id: 'answer-msg', role: 'assistant' } }),
    );
    await flush();
    // The bubble shows the loading placeholder until the first text chunk.
    store.dbMessagesMap[messageMapKey(context)][0].content = LOADING_FLAT;

    const snapshot = freezeGatewayRunForStop('op-thinking');
    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'late text' }));
    await flush();

    expect(snapshot).toEqual({ assistantMessageId: 'answer-msg', content: '' });
    expect(shownContent()).toBe(LOADING_FLAT);
  });

  it('sends no snapshot for a reply longer than the interrupt input allows', async () => {
    // An oversized snapshot would get the whole Stop request rejected.
    const { store } = createStreamingStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-huge',
    });

    handler(
      makeEvent('stream_chunk', {
        chunkType: 'text',
        content: 'x'.repeat(INTERRUPT_STOP_SNAPSHOT_MAX_LENGTH + 1),
      }),
    );
    await flush();

    expect(freezeGatewayRunForStop('op-huge')).toBeUndefined();
    // Without a snapshot the server keeps the full reply; so does the bubble.
    handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'more' }));
    await flush();
    expect(store.dbMessagesMap[messageMapKey(context)][0].content.endsWith('more')).toBe(true);
  });
});
