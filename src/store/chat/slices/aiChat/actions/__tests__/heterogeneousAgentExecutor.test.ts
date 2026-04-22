/**
 * Tests for heterogeneousAgentExecutor DB persistence layer.
 *
 * Verifies the critical path: CC stream events → messageService DB writes.
 * Covers:
 *   - Tool 3-phase persistence (pre-register → create → backfill)
 *   - Tool result content updates
 *   - Multi-step assistant message creation with correct parentId chain
 *   - Content/reasoning/model/usage final writes
 *   - Sync snapshot + reset to prevent cross-step content contamination
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGatewayEventHandler } from '../gatewayEventHandler';
import { executeHeterogeneousAgent } from '../heterogeneousAgentExecutor';

// ─── Mocks ───

// messageService — the DB layer under test
const mockCreateMessage = vi.fn();
const mockUpdateMessage = vi.fn();
const mockUpdateToolMessage = vi.fn();
const mockGetMessages = vi.fn();

vi.mock('@/services/message', () => ({
  messageService: {
    createMessage: (...args: any[]) => mockCreateMessage(...args),
    getMessages: (...args: any[]) => mockGetMessages(...args),
    updateMessage: (...args: any[]) => mockUpdateMessage(...args),
    updateToolMessage: (...args: any[]) => mockUpdateToolMessage(...args),
  },
}));

// threadService — subagent Thread creation (CC `Task` tool_use)
const mockCreateThread = vi.fn();
vi.mock('@/services/thread', () => ({
  threadService: {
    createThread: (...args: any[]) => mockCreateThread(...args),
  },
}));

// heterogeneousAgentService — IPC to Electron main
const mockStartSession = vi.fn();
const mockSendPrompt = vi.fn();
const mockStopSession = vi.fn();
const mockGetSessionInfo = vi.fn();

vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: {
    getSessionInfo: (...args: any[]) => mockGetSessionInfo(...args),
    sendPrompt: (...args: any[]) => mockSendPrompt(...args),
    startSession: (...args: any[]) => mockStartSession(...args),
    stopSession: (...args: any[]) => mockStopSession(...args),
  },
}));

// Gateway event handler — we spy on it but let it run (it calls getMessages)
vi.mock('../gatewayEventHandler', () => ({
  createGatewayEventHandler: vi.fn(() => vi.fn()),
}));

// ─── Helpers ───

function setupIpcCapture() {
  // Mock window.electron.ipcRenderer
  const listeners = new Map<string, (...args: any[]) => void>();
  (globalThis as any).window = {
    electron: {
      ipcRenderer: {
        on: vi.fn((channel: string, handler: (...args: any[]) => void) => {
          listeners.set(channel, handler);
        }),
        removeListener: vi.fn(),
      },
    },
  };

  // After subscribeBroadcasts is called, extract the callbacks
  // by intercepting the IPC .on() calls
  return {
    getListeners: () => listeners,
    /** Simulate a raw line broadcast from Electron main */
    emitRawLine: (sessionId: string, line: any) => {
      const handler = listeners.get('heteroAgentRawLine');
      handler?.(null, { line, sessionId });
    },
    /** Simulate session completion */
    emitComplete: (sessionId: string) => {
      const handler = listeners.get('heteroAgentSessionComplete');
      handler?.(null, { sessionId });
    },
    /** Simulate session error */
    emitError: (sessionId: string, error: string) => {
      const handler = listeners.get('heteroAgentSessionError');
      handler?.(null, { error, sessionId });
    },
  };
}

function createMockStore(overrides: Record<string, any> = {}) {
  // Hand out a fresh AbortController + monotonically increasing sub-op id
  // for each subagent run, mirroring `startOperation`'s contract just
  // enough that the executor can build dispatchers + completion calls.
  let subOpCounter = 0;
  return {
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    internal_dispatchMessage: vi.fn(),
    internal_toggleToolCallingStreaming: vi.fn(),
    refreshThreads: vi.fn(async () => {}),
    replaceMessages: vi.fn(),
    startOperation: vi.fn(() => {
      subOpCounter += 1;
      return {
        abortController: new AbortController(),
        operationId: `sub-op-${subOpCounter}`,
      };
    }),
    ...overrides,
  } as any;
}

const defaultContext = {
  agentId: 'agent-1',
  scope: 'main' as const,
  topicId: 'topic-1',
};

const defaultParams = {
  assistantMessageId: 'ast-initial',
  context: defaultContext,
  heterogeneousProvider: { command: 'claude', type: 'claude-code' as const },
  message: 'test prompt',
  operationId: 'op-1',
};

/** Flush async queues */
const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
};

// ─── CC stream-json event factories ───

const ccInit = (sessionId = 'cc-sess-1') => ({
  model: 'claude-sonnet-4-6',
  session_id: sessionId,
  subtype: 'init',
  type: 'system',
});

const ccAssistant = (msgId: string, content: any[], extra?: { model?: string; usage?: any }) => ({
  message: {
    content,
    id: msgId,
    model: extra?.model || 'claude-sonnet-4-6',
    role: 'assistant',
    usage: extra?.usage,
  },
  type: 'assistant',
});

const ccToolUse = (msgId: string, toolId: string, name: string, input: any = {}) =>
  ccAssistant(msgId, [{ id: toolId, input, name, type: 'tool_use' }]);

/**
 * CC subagent assistant event — carries `parent_tool_use_id` pointing back at
 * the outer `Task` tool_use. The adapter routes these through its subagent
 * handler which stamps `parentToolCallId` onto each tool payload.
 */
const ccSubagentToolUse = (
  msgId: string,
  parentToolUseId: string,
  toolId: string,
  name: string,
  input: any = {},
) => ({
  message: {
    content: [{ id: toolId, input, name, type: 'tool_use' }],
    id: msgId,
    role: 'assistant',
  },
  parent_tool_use_id: parentToolUseId,
  type: 'assistant',
});

/** Subagent assistant event with text content (closing summary-style turn). */
const ccSubagentText = (msgId: string, parentToolUseId: string, text: string) => ({
  message: {
    content: [{ text, type: 'text' }],
    id: msgId,
    role: 'assistant',
  },
  parent_tool_use_id: parentToolUseId,
  type: 'assistant',
});

/** The main-agent tool_result for a spawn tool_use (end of a subagent run). */
const ccSubagentSpawnResult = (spawnToolUseId: string, finalText: string) => ({
  message: {
    content: [{ content: finalText, tool_use_id: spawnToolUseId, type: 'tool_result' }],
    role: 'user',
  },
  type: 'user',
});

const ccText = (msgId: string, text: string) => ccAssistant(msgId, [{ text, type: 'text' }]);

const ccThinking = (msgId: string, thinking: string) =>
  ccAssistant(msgId, [{ thinking, type: 'thinking' }]);

const ccToolResult = (toolUseId: string, content: string, isError = false) => ({
  message: {
    content: [{ content, is_error: isError, tool_use_id: toolUseId, type: 'tool_result' }],
    role: 'user',
  },
  type: 'user',
});

const ccResult = (isError = false, result = 'done') => ({
  is_error: isError,
  result,
  type: 'result',
});

/**
 * `stream_event: message_start` — primes adapter's in-flight message.id so a
 * following `message_delta` (which has no message.id of its own) can attach
 * its authoritative usage to the correct turn.
 */
const ccMessageStart = (msgId: string, model = 'claude-sonnet-4-6') => ({
  event: { message: { id: msgId, model }, type: 'message_start' },
  type: 'stream_event',
});

/**
 * `stream_event: message_delta` — the authoritative per-turn usage under
 * `--include-partial-messages` (CC's `assistant` events only echo a stale
 * message_start snapshot, so turn_metadata is driven off this event).
 */
const ccMessageDelta = (usage: {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}) => ({
  event: { type: 'message_delta', usage },
  type: 'stream_event',
});

// ─── Tests ───

describe('heterogeneousAgentExecutor DB persistence', () => {
  let ipc: ReturnType<typeof setupIpcCapture>;

  beforeEach(() => {
    vi.clearAllMocks();
    ipc = setupIpcCapture();
    mockStartSession.mockResolvedValue({ sessionId: 'ipc-sess-1' });
    mockSendPrompt.mockResolvedValue(undefined);
    mockStopSession.mockResolvedValue(undefined);
    mockGetSessionInfo.mockResolvedValue({ agentSessionId: 'cc-sess-1' });
    mockGetMessages.mockResolvedValue([]);
    mockCreateMessage.mockImplementation(async (params: any) => ({
      id: `created-${params.role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    }));
    mockUpdateMessage.mockResolvedValue(undefined);
    mockUpdateToolMessage.mockResolvedValue(undefined);
    mockCreateThread.mockImplementation(async (params: any) => params.id || 'thread-generated');
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  /**
   * Runs the executor in background, then feeds CC events and completes.
   * Returns a promise that resolves when the executor finishes.
   */
  async function runWithEvents(ccEvents: any[], opts?: { params?: Partial<typeof defaultParams> }) {
    const store = createMockStore();
    const get = vi.fn(() => store);

    // sendPrompt will resolve after we emit all events
    let resolveSendPrompt: () => void;
    mockSendPrompt.mockReturnValue(
      new Promise<void>((r) => {
        resolveSendPrompt = r;
      }),
    );

    const executorPromise = executeHeterogeneousAgent(get, {
      ...defaultParams,
      ...opts?.params,
    });

    // Wait for startSession + subscribeBroadcasts to complete
    await flush();

    // Feed CC events
    for (const event of ccEvents) {
      ipc.emitRawLine('ipc-sess-1', event);
    }

    // Signal completion
    ipc.emitComplete('ipc-sess-1');
    await flush();

    // Resolve sendPrompt to let executor continue
    resolveSendPrompt!();
    await flush();

    // Wait for executor to finish
    await executorPromise;
    await flush();

    return { get, store };
  }

  // ────────────────────────────────────────────────────
  // Tool 3-phase persistence
  // ────────────────────────────────────────────────────

  describe('tool 3-phase persistence', () => {
    it('should pre-register tools, create tool messages, then backfill result_msg_id', async () => {
      // Track createMessage call order and IDs
      let toolMsgCounter = 0;
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') {
          toolMsgCounter++;
          return { id: `tool-msg-${toolMsgCounter}` };
        }
        return { id: `msg-${params.role}-${Date.now()}` };
      });

      await runWithEvents([
        ccInit(),
        ccToolUse('msg_01', 'toolu_1', 'Read', { file_path: '/a.ts' }),
        ccToolResult('toolu_1', 'file content'),
        ccText('msg_02', 'Done'),
        ccResult(),
      ]);

      // Phase 1 + Phase 3: updateMessage called with tools[] on the assistant
      // Phase 1 has tools without result_msg_id, Phase 3 has tools with result_msg_id
      const toolUpdateCalls = mockUpdateMessage.mock.calls.filter(
        ([id, val]: any) => id === 'ast-initial' && val.tools?.length > 0,
      );
      // At least 2 calls: phase 1 (pre-register) + phase 3 (backfill)
      expect(toolUpdateCalls.length).toBeGreaterThanOrEqual(2);

      // Phase 2: createMessage called with role='tool'
      const toolCreateCalls = mockCreateMessage.mock.calls.filter(
        ([params]: any) => params.role === 'tool',
      );
      expect(toolCreateCalls.length).toBe(1);
      expect(toolCreateCalls[0][0]).toMatchObject({
        parentId: 'ast-initial',
        role: 'tool',
        tool_call_id: 'toolu_1',
        plugin: expect.objectContaining({ apiName: 'Read' }),
      });

      // Phase 3: the last tools[] write should have result_msg_id backfilled
      const lastToolUpdate = toolUpdateCalls.at(-1)!;
      expect(lastToolUpdate[1].tools[0].result_msg_id).toBe('tool-msg-1');
    });

    it('should deduplicate tool calls (idempotent)', async () => {
      await runWithEvents([
        ccInit(),
        // Same tool_use id sent twice (CC can echo tool blocks)
        ccToolUse('msg_01', 'toolu_1', 'Bash', { command: 'ls' }),
        ccAssistant('msg_01', [
          { id: 'toolu_1', input: { command: 'ls' }, name: 'Bash', type: 'tool_use' },
        ]),
        ccToolResult('toolu_1', 'output'),
        ccResult(),
      ]);

      // Should only create ONE tool message despite two tool_use events with same id
      const toolCreates = mockCreateMessage.mock.calls.filter(([p]: any) => p.role === 'tool');
      expect(toolCreates.length).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────
  // Tool result content persistence
  // ────────────────────────────────────────────────────

  describe('tool result persistence', () => {
    it('should update tool message content on tool_result', async () => {
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') return { id: 'tool-msg-read' };
        return { id: `msg-${Date.now()}` };
      });

      await runWithEvents([
        ccInit(),
        ccToolUse('msg_01', 'toolu_read', 'Read', { file_path: '/x.ts' }),
        ccToolResult('toolu_read', 'the file content here'),
        ccResult(),
      ]);

      expect(mockUpdateToolMessage).toHaveBeenCalledWith(
        'tool-msg-read',
        { content: 'the file content here', pluginError: undefined },
        { agentId: 'agent-1', topicId: 'topic-1' },
      );
    });

    it('should mark error tool results with pluginError', async () => {
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') return { id: 'tool-msg-err' };
        return { id: `msg-${Date.now()}` };
      });

      await runWithEvents([
        ccInit(),
        ccToolUse('msg_01', 'toolu_fail', 'Read', { file_path: '/nope' }),
        ccToolResult('toolu_fail', 'ENOENT: no such file', true),
        ccResult(),
      ]);

      expect(mockUpdateToolMessage).toHaveBeenCalledWith(
        'tool-msg-err',
        { content: 'ENOENT: no such file', pluginError: { message: 'ENOENT: no such file' } },
        { agentId: 'agent-1', topicId: 'topic-1' },
      );
    });
  });

  // ────────────────────────────────────────────────────
  // Multi-step parentId chain
  // ────────────────────────────────────────────────────

  describe('multi-step parentId chain', () => {
    it('should create assistant messages chained: assistant → tool → assistant', async () => {
      const createdIds: string[] = [];
      mockCreateMessage.mockImplementation(async (params: any) => {
        const id =
          params.role === 'tool' ? `tool-${createdIds.length}` : `ast-step-${createdIds.length}`;
        createdIds.push(id);
        return { id };
      });

      await runWithEvents([
        ccInit(),
        // Step 1: tool_use Read (message_start primes turn + model/provider
        // so the executor can stamp step 2's createMessage with them)
        ccMessageStart('msg_01'),
        ccToolUse('msg_01', 'toolu_1', 'Read', { file_path: '/a.ts' }),
        ccMessageDelta({ input_tokens: 10, output_tokens: 5 }),
        ccToolResult('toolu_1', 'content of a.ts'),
        // Step 2 (new message.id): tool_use Write
        ccMessageStart('msg_02'),
        ccToolUse('msg_02', 'toolu_2', 'Write', { file_path: '/b.ts', content: 'new' }),
        ccMessageDelta({ input_tokens: 20, output_tokens: 10 }),
        ccToolResult('toolu_2', 'file written'),
        // Step 3 (new message.id): final text
        ccMessageStart('msg_03'),
        ccText('msg_03', 'All done!'),
        ccMessageDelta({ input_tokens: 30, output_tokens: 15 }),
        ccResult(),
      ]);

      // Collect all createMessage calls with their parentId
      // Tool message for step 1 — parentId should be the initial assistant
      const tool1Create = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'tool' && p.tool_call_id === 'toolu_1',
      );
      expect(tool1Create?.[0].parentId).toBe('ast-initial');

      // Assistant for step 2 — parentId should be step 1's TOOL message (not assistant)
      const step2Assistant = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'assistant' && p.parentId !== undefined,
      );
      expect(step2Assistant).toBeDefined();
      // The parentId should be the tool message ID from step 1
      const tool1Id = createdIds.find((id) => id.startsWith('tool-'));
      expect(step2Assistant![0].parentId).toBe(tool1Id);
      // createMessage should carry the adapter provider so step 2's assistant
      // lands in DB with provider set from the start (no later backfill needed).
      expect(step2Assistant![0].provider).toBe('claude-code');
    });

    it('should fall back to assistant parentId when step has no tools', async () => {
      const ids: string[] = [];
      mockCreateMessage.mockImplementation(async (params: any) => {
        const id = `${params.role}-${ids.length}`;
        ids.push(id);
        return { id };
      });

      await runWithEvents([
        ccInit(),
        // Step 1: just text, no tools
        ccText('msg_01', 'Let me think...'),
        // Step 2: more text (new message.id, no tools in step 1)
        ccText('msg_02', 'Here is the answer.'),
        ccResult(),
      ]);

      // Step 2 assistant should have parentId = initial assistant (no tools to chain through)
      const step2 = mockCreateMessage.mock.calls.find(([p]: any) => p.role === 'assistant');
      expect(step2?.[0].parentId).toBe('ast-initial');
    });
  });

  // ────────────────────────────────────────────────────
  // Final content + usage writes
  // ────────────────────────────────────────────────────

  describe('final content writes (onComplete)', () => {
    it('should write accumulated content + model + provider to the final assistant message', async () => {
      await runWithEvents([
        ccInit(),
        // message_start carries the model for this turn; individual assistant
        // content-block events echo the same model, so the final write should
        // stamp `claude-opus-4-6` (not the init-default sonnet).
        ccMessageStart('msg_01', 'claude-opus-4-6'),
        ccAssistant('msg_01', [{ text: 'Hello ', type: 'text' }], {
          model: 'claude-opus-4-6',
        }),
        ccAssistant('msg_01', [{ text: 'world!', type: 'text' }], {
          model: 'claude-opus-4-6',
        }),
        // message_delta fires the authoritative turn_metadata (with model from
        // the adapter's in-flight state)
        ccMessageDelta({ input_tokens: 100, output_tokens: 20 }),
        ccResult(),
      ]);

      const finalWrite = mockUpdateMessage.mock.calls.find(
        ([id, val]: any) => id === 'ast-initial' && val.content === 'Hello world!',
      );
      expect(finalWrite).toBeDefined();
      expect(finalWrite![1].model).toBe('claude-opus-4-6');
      // provider is emitted by the CC adapter on turn_metadata so it rides
      // along with the final content/model write.
      expect(finalWrite![1].provider).toBe('claude-code');
    });

    it('should write accumulated reasoning', async () => {
      await runWithEvents([
        ccInit(),
        ccThinking('msg_01', 'Let me think about this.'),
        ccText('msg_01', 'Answer.'),
        ccResult(),
      ]);

      const finalWrite = mockUpdateMessage.mock.calls.find(
        ([id, val]: any) => id === 'ast-initial' && val.reasoning,
      );
      expect(finalWrite).toBeDefined();
      expect(finalWrite![1].reasoning.content).toBe('Let me think about this.');
    });

    it('should persist per-step usage to each step assistant message, not accumulated', async () => {
      // Deterministic ids for new-step assistant messages so we can assert per-message usage.
      let astStepCounter = 0;
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'assistant') {
          astStepCounter++;
          return { id: `ast-step-${astStepCounter}` };
        }
        return { id: `tool-${Date.now()}` };
      });

      // Realistic CC partial-messages flow: message_start primes the turn,
      // assistant events echo a stale usage, message_delta carries the final.
      await runWithEvents([
        ccInit(),
        ccMessageStart('msg_01'),
        ccAssistant('msg_01', [{ text: 'a', type: 'text' }]),
        ccToolUse('msg_01', 'toolu_1', 'Bash', {}),
        ccMessageDelta({
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 200,
          input_tokens: 100,
          output_tokens: 50,
        }),
        ccToolResult('toolu_1', 'ok'),
        ccMessageStart('msg_02'),
        ccAssistant('msg_02', [{ text: 'b', type: 'text' }]),
        ccMessageDelta({ input_tokens: 300, output_tokens: 80 }),
        ccResult(),
      ]);

      const usageWrites = mockUpdateMessage.mock.calls.filter(
        ([, val]: any) => val.metadata?.usage?.totalTokens,
      );
      // One usage write per step (msg_01 → ast-initial, msg_02 → ast-step-1)
      expect(usageWrites.length).toBe(2);

      const step1 = usageWrites.find(([id]: any) => id === 'ast-initial');
      expect(step1).toBeDefined();
      const u1 = step1![1].metadata.usage;
      // msg_01: 100 input (miss) + 200 cached + 50 cache_create = 350; 50 output
      expect(u1.totalInputTokens).toBe(350);
      expect(u1.totalOutputTokens).toBe(50);
      expect(u1.totalTokens).toBe(400);
      expect(u1.inputCacheMissTokens).toBe(100);
      expect(u1.inputCachedTokens).toBe(200);
      expect(u1.inputWriteCacheTokens).toBe(50);

      const step2 = usageWrites.find(([id]: any) => id === 'ast-step-1');
      expect(step2).toBeDefined();
      const u2 = step2![1].metadata.usage;
      // msg_02: 300 input (miss, no cache); 80 output
      expect(u2.totalInputTokens).toBe(300);
      expect(u2.totalOutputTokens).toBe(80);
      expect(u2.totalTokens).toBe(380);
      expect(u2.inputCacheMissTokens).toBe(300);
      // No cache tokens for this turn — these fields should be absent
      expect(u2.inputCachedTokens).toBeUndefined();
      expect(u2.inputWriteCacheTokens).toBeUndefined();
    });

    it('should ignore stale usage on assistant events (from message_start echo)', async () => {
      // Regression for LOBE-7258-style bug: under partial-messages mode, CC
      // echoes a stale message_start usage (e.g. output_tokens: 1) on every
      // content-block assistant event. If the adapter picked that up, the DB
      // would record output_tokens=1 instead of the real total. This verifies
      // the stale snapshot is ignored and only the message_delta total lands.
      await runWithEvents([
        ccInit(),
        ccMessageStart('msg_01'),
        // All assistant events below carry the STALE placeholder usage
        ccAssistant('msg_01', [{ text: 'hi', type: 'text' }], {
          usage: { input_tokens: 6, output_tokens: 1 }, // stale
        }),
        ccAssistant('msg_01', [{ id: 'tu', input: {}, name: 'Read', type: 'tool_use' }], {
          usage: { input_tokens: 6, output_tokens: 1 }, // stale echo
        }),
        // Authoritative final usage arrives on message_delta
        ccMessageDelta({ input_tokens: 6, output_tokens: 265 }),
        ccToolResult('tu', 'ok'),
        ccResult(),
      ]);

      const usageWrites = mockUpdateMessage.mock.calls.filter(
        ([, val]: any) => val.metadata?.usage?.totalTokens,
      );
      expect(usageWrites.length).toBe(1);
      expect(usageWrites[0][1].metadata.usage.totalOutputTokens).toBe(265); // not 1
      expect(usageWrites[0][1].metadata.usage.totalInputTokens).toBe(6);
    });
  });

  // ────────────────────────────────────────────────────
  // Sync snapshot prevents cross-step contamination
  // ────────────────────────────────────────────────────

  describe('sync snapshot on step boundary', () => {
    it('should NOT mix new-step content into old-step DB write', async () => {
      // This tests the race condition fix: when adapter produces
      // [stream_end, stream_start(newStep), stream_chunk(text)] from a single raw line,
      // the stream_chunk should go to the NEW step, not the old one.

      const createdIds: string[] = [];
      mockCreateMessage.mockImplementation(async (params: any) => {
        const id = `${params.role}-${createdIds.length}`;
        createdIds.push(id);
        return { id };
      });

      await runWithEvents([
        ccInit(),
        // Step 1: text
        ccText('msg_01', 'Step 1 content'),
        // Step 2: new message.id — adapter emits stream_end + stream_start(newStep) + chunks
        // in the SAME onRawLine call
        ccText('msg_02', 'Step 2 content'),
        ccResult(),
      ]);

      // The old step (ast-initial) should get "Step 1 content", NOT "Step 1 contentStep 2 content"
      const oldStepWrite = mockUpdateMessage.mock.calls.find(
        ([id, val]: any) => id === 'ast-initial' && val.content === 'Step 1 content',
      );
      expect(oldStepWrite).toBeDefined();

      // The new step's final write should have "Step 2 content"
      const newStepId = createdIds.find((id) => id.startsWith('assistant-'));
      if (newStepId) {
        const newStepWrite = mockUpdateMessage.mock.calls.find(
          ([id, val]: any) => id === newStepId && val.content === 'Step 2 content',
        );
        expect(newStepWrite).toBeDefined();
      }
    });
  });

  // ────────────────────────────────────────────────────
  // Error handling
  // ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should persist accumulated content on error', async () => {
      const store = createMockStore();
      const get = vi.fn(() => store);

      let resolveSendPrompt: () => void;
      mockSendPrompt.mockReturnValue(
        new Promise<void>((r) => {
          resolveSendPrompt = r;
        }),
      );

      const executorPromise = executeHeterogeneousAgent(get, defaultParams);
      await flush();

      // Feed some content, then error
      ipc.emitRawLine('ipc-sess-1', ccInit());
      ipc.emitRawLine('ipc-sess-1', ccText('msg_01', 'partial content'));
      ipc.emitError('ipc-sess-1', 'Connection lost');
      await flush();

      resolveSendPrompt!();
      await executorPromise.catch(() => {});
      await flush();

      // Should have written the partial content
      const contentWrite = mockUpdateMessage.mock.calls.find(
        ([id, val]: any) => id === 'ast-initial' && val.content === 'partial content',
      );
      expect(contentWrite).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────
  // Full multi-step E2E
  // ────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────
  // Orphan tool regression (img.png scenario)
  // ────────────────────────────────────────────────────

  describe('orphan tool regression', () => {
    /**
     * Reproduces the orphan tool scenario from img.png:
     *
     * Turn 1 (msg_01): text + Bash(git log)   → assistant1.tools should include git_log
     * tool_result for git log
     * Turn 2 (msg_02): Bash(git diff)          → assistant2.tools should include git_diff
     * tool_result for git diff
     * Turn 3 (msg_03): text summary
     *
     * The orphan happens when assistant2.tools[] does NOT contain
     * the git_diff entry, making the tool message appear orphaned in the UI.
     */
    it('should register tools on the correct assistant in multi-turn tool execution', async () => {
      const idCounter = { tool: 0, assistant: 0 };
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') {
          idCounter.tool++;
          return { id: `tool-${idCounter.tool}` };
        }
        idCounter.assistant++;
        return { id: `ast-new-${idCounter.assistant}` };
      });

      // Track ALL updateMessage calls to inspect tools[] writes
      const toolsUpdates: Array<{ assistantId: string; tools: any[] }> = [];
      mockUpdateMessage.mockImplementation(async (id: string, val: any) => {
        if (val.tools) {
          toolsUpdates.push({ assistantId: id, tools: val.tools });
        }
      });

      await runWithEvents([
        ccInit(),
        // Turn 1: text + Bash (git log) — same message.id
        ccAssistant('msg_01', [
          { text: '没有未提交的修改，看看已提交但未推送的变更：', type: 'text' },
        ]),
        ccToolUse('msg_01', 'toolu_gitlog', 'Bash', { command: 'git log canary..HEAD --oneline' }),
        ccToolResult('toolu_gitlog', 'abc123 feat: something\ndef456 fix: another'),
        // Turn 2: Bash (git diff) — NEW message.id → step boundary
        ccToolUse('msg_02', 'toolu_gitdiff', 'Bash', { command: 'git diff --stat' }),
        ccToolResult('toolu_gitdiff', ' file1.ts | 10 +\n file2.ts | 5 -'),
        // Turn 3: text summary — NEW message.id → step boundary
        ccText('msg_03', '当前分支有2个未推送的提交，修改了2个文件。'),
        ccResult(),
      ]);

      // ── Verify: Turn 1 tool registered on ast-initial ──
      const gitlogToolUpdates = toolsUpdates.filter(
        (u) => u.assistantId === 'ast-initial' && u.tools.some((t: any) => t.id === 'toolu_gitlog'),
      );
      expect(gitlogToolUpdates.length).toBeGreaterThanOrEqual(1);

      // ── Verify: Turn 2 tool registered on ast-new-1 (step 2 assistant) ──
      // This is the critical assertion — if this fails, the tool becomes orphaned
      const gitdiffToolUpdates = toolsUpdates.filter(
        (u) => u.assistantId === 'ast-new-1' && u.tools.some((t: any) => t.id === 'toolu_gitdiff'),
      );
      expect(gitdiffToolUpdates.length).toBeGreaterThanOrEqual(1);

      // ── Verify: tool messages have correct parentId ──
      const gitlogToolCreate = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'tool' && p.tool_call_id === 'toolu_gitlog',
      );
      expect(gitlogToolCreate![0].parentId).toBe('ast-initial');

      const gitdiffToolCreate = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'tool' && p.tool_call_id === 'toolu_gitdiff',
      );
      expect(gitdiffToolCreate![0].parentId).toBe('ast-new-1');
    });

    it('should register tools on correct assistant when turn has ONLY tool_use (no text)', async () => {
      // Edge case: turn 2 has only a tool_use, no text. The step transition creates
      // a new assistant, then the tool_use must be registered on it (not the old one).
      const idCounter = { tool: 0, assistant: 0 };
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') {
          idCounter.tool++;
          return { id: `tool-${idCounter.tool}` };
        }
        idCounter.assistant++;
        return { id: `ast-new-${idCounter.assistant}` };
      });

      const toolsUpdates: Array<{ assistantId: string; toolIds: string[] }> = [];
      mockUpdateMessage.mockImplementation(async (id: string, val: any) => {
        if (val.tools) {
          toolsUpdates.push({
            assistantId: id,
            toolIds: val.tools.map((t: any) => t.id),
          });
        }
      });

      await runWithEvents([
        ccInit(),
        // Turn 1: just text, no tools
        ccText('msg_01', 'Let me check...'),
        // Turn 2: only tool_use (no text in this turn)
        ccToolUse('msg_02', 'toolu_bash', 'Bash', { command: 'ls -la' }),
        ccToolResult('toolu_bash', 'total 100\ndrwx...'),
        // Turn 3: final text
        ccText('msg_03', 'Done.'),
        ccResult(),
      ]);

      // The tool should be registered on ast-new-1 (step 2 assistant), not ast-initial
      const bashToolUpdates = toolsUpdates.filter((u) => u.toolIds.includes('toolu_bash'));
      expect(bashToolUpdates.length).toBeGreaterThanOrEqual(1);
      // All of them should be on ast-new-1
      for (const u of bashToolUpdates) {
        expect(u.assistantId).toBe('ast-new-1');
      }
    });
  });

  // ────────────────────────────────────────────────────
  // Real trace regression: multi-tool per turn (LOBE-7240 scenario)
  // ────────────────────────────────────────────────────

  describe('multi-tool per turn (real trace regression)', () => {
    /**
     * Reproduces the exact CC event pattern from the LOBE-7240 orphan trace.
     * Key pattern: a single turn (same message.id) has text + multiple tool_uses.
     * After step transition, the new turn also has multiple tool_uses with
     * out-of-order tool_results.
     */
    it('should register ALL tools on correct assistant when turn has text + multiple tool_uses', async () => {
      const idCounter = { tool: 0, assistant: 0 };
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') {
          idCounter.tool++;
          return { id: `tool-${idCounter.tool}` };
        }
        idCounter.assistant++;
        return { id: `ast-new-${idCounter.assistant}` };
      });

      const toolsUpdates: Array<{ assistantId: string; toolIds: string[] }> = [];
      mockUpdateMessage.mockImplementation(async (id: string, val: any) => {
        if (val.tools) {
          toolsUpdates.push({
            assistantId: id,
            toolIds: val.tools.map((t: any) => t.id),
          });
        }
      });

      await runWithEvents([
        ccInit(),
        // Turn 1 (msg_01): thinking + tool (Skill)
        ccThinking('msg_01', 'Let me check the issue'),
        ccToolUse('msg_01', 'toolu_skill', 'Skill', { skill: 'linear' }),
        ccToolResult('toolu_skill', 'Launching skill: linear'),

        // Turn 2 (msg_02): tool (ToolSearch) — step boundary
        ccToolUse('msg_02', 'toolu_search', 'ToolSearch', { query: 'select:get_issue' }),
        ccToolResult('toolu_search', 'tool loaded'),

        // Turn 3 (msg_03): tool (get_issue) — step boundary
        ccToolUse('msg_03', 'toolu_getissue', 'mcp__linear__get_issue', { id: 'LOBE-7240' }),
        ccToolResult('toolu_getissue', '{"title":"i18n"}'),

        // Turn 4 (msg_04): thinking + text + Grep + Grep — step boundary
        // This is the critical pattern: same message.id has text AND multiple tools
        ccThinking('msg_04', 'Let me understand the issue'),
        ccText('msg_04', '明白了，需要补充翻译'),
        ccToolUse('msg_04', 'toolu_grep1', 'Grep', { pattern: 'newClaudeCodeAgent' }),
        ccToolResult('toolu_grep1', 'found in chat.ts'),
        ccToolUse('msg_04', 'toolu_grep2', 'Grep', { pattern: 'agentProvider' }),
        ccToolResult('toolu_grep2', 'found in setting.ts'),

        // Turn 5 (msg_05): Grep + Glob + Glob — step boundary
        // Multiple tools, results may arrive out of order
        ccToolUse('msg_05', 'toolu_grep3', 'Grep', { pattern: 'agentProvider', path: 'locales' }),
        ccToolResult('toolu_grep3', 'locales content'),
        ccToolUse('msg_05', 'toolu_glob1', 'Glob', { pattern: 'zh-CN/chat.json' }),
        ccToolUse('msg_05', 'toolu_glob2', 'Glob', { pattern: 'en-US/chat.json' }),
        // Results arrive out of order: glob2 before glob1
        ccToolResult('toolu_glob2', 'locales/en-US/chat.json'),
        ccToolResult('toolu_glob1', 'locales/zh-CN/chat.json'),

        // Turn 6 (msg_06): text summary — step boundary
        ccText('msg_06', 'All translations updated.'),
        ccResult(),
      ]);

      // ── Verify Turn 1: Skill tool on ast-initial ──
      const skillUpdates = toolsUpdates.filter((u) => u.toolIds.includes('toolu_skill'));
      expect(skillUpdates.length).toBeGreaterThanOrEqual(1);
      expect(skillUpdates.every((u) => u.assistantId === 'ast-initial')).toBe(true);

      // ── Verify Turn 4: BOTH Grep tools on same assistant (ast-new-3) ──
      const grep1Updates = toolsUpdates.filter((u) => u.toolIds.includes('toolu_grep1'));
      const grep2Updates = toolsUpdates.filter((u) => u.toolIds.includes('toolu_grep2'));
      expect(grep1Updates.length).toBeGreaterThanOrEqual(1);
      expect(grep2Updates.length).toBeGreaterThanOrEqual(1);

      // Both Grep tools must be registered on the SAME assistant
      const turn4AssistantId = grep1Updates[0].assistantId;
      expect(grep2Updates.some((u) => u.assistantId === turn4AssistantId)).toBe(true);

      // The final tools[] update for Turn 4's assistant should contain BOTH greps
      const turn4FinalUpdate = toolsUpdates.findLast((u) => u.assistantId === turn4AssistantId);
      expect(turn4FinalUpdate!.toolIds).toContain('toolu_grep1');
      expect(turn4FinalUpdate!.toolIds).toContain('toolu_grep2');

      // ── Verify Turn 5: all 3 tools (Grep + 2 Globs) on same assistant ──
      const grep3Updates = toolsUpdates.filter((u) => u.toolIds.includes('toolu_grep3'));
      const glob1Updates = toolsUpdates.filter((u) => u.toolIds.includes('toolu_glob1'));
      const glob2Updates = toolsUpdates.filter((u) => u.toolIds.includes('toolu_glob2'));
      expect(grep3Updates.length).toBeGreaterThanOrEqual(1);
      expect(glob1Updates.length).toBeGreaterThanOrEqual(1);
      expect(glob2Updates.length).toBeGreaterThanOrEqual(1);

      // All three must be on the SAME assistant (Turn 5's assistant)
      const turn5AssistantId = grep3Updates[0].assistantId;
      expect(turn5AssistantId).not.toBe(turn4AssistantId); // Different from Turn 4
      expect(glob1Updates.some((u) => u.assistantId === turn5AssistantId)).toBe(true);
      expect(glob2Updates.some((u) => u.assistantId === turn5AssistantId)).toBe(true);

      // Final tools[] for Turn 5's assistant should contain all 3
      const turn5FinalUpdate = toolsUpdates.findLast((u) => u.assistantId === turn5AssistantId);
      expect(turn5FinalUpdate!.toolIds).toContain('toolu_grep3');
      expect(turn5FinalUpdate!.toolIds).toContain('toolu_glob1');
      expect(turn5FinalUpdate!.toolIds).toContain('toolu_glob2');

      // ── Verify tool messages have correct parentId ──
      // Turn 4 tools should be children of Turn 4's assistant
      const grep1Create = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'tool' && p.tool_call_id === 'toolu_grep1',
      );
      const grep2Create = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'tool' && p.tool_call_id === 'toolu_grep2',
      );
      expect(grep1Create![0].parentId).toBe(turn4AssistantId);
      expect(grep2Create![0].parentId).toBe(turn4AssistantId);

      // Turn 5 tools should be children of Turn 5's assistant
      const grep3Create = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'tool' && p.tool_call_id === 'toolu_grep3',
      );
      const glob1Create = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'tool' && p.tool_call_id === 'toolu_glob1',
      );
      const glob2Create = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'tool' && p.tool_call_id === 'toolu_glob2',
      );
      expect(grep3Create![0].parentId).toBe(turn5AssistantId);
      expect(glob1Create![0].parentId).toBe(turn5AssistantId);
      expect(glob2Create![0].parentId).toBe(turn5AssistantId);
    });

    /**
     * Regression: when a turn has text BEFORE tool_use under the same message.id,
     * the tools[] write must carry the accumulated content too. Otherwise the
     * gateway handler's `tool_end → fetchAndReplaceMessages` reads a tools-only
     * row and clobbers the in-memory streamed text in the UI.
     */
    it('should persist accumulated text alongside tools when turn has text + tool_use', async () => {
      const writes: Array<{ assistantId: string; content?: string; toolIds?: string[] }> = [];
      mockUpdateMessage.mockImplementation(async (id: string, val: any) => {
        if (val.tools) {
          writes.push({
            assistantId: id,
            content: val.content,
            toolIds: val.tools.map((t: any) => t.id),
          });
        }
      });

      await runWithEvents([
        ccInit(),
        // text streams first, then tool_use — same msg.id
        ccText('msg_01', 'Let me check the file...'),
        ccToolUse('msg_01', 'toolu_read', 'Read', { file_path: '/a.ts' }),
        ccToolResult('toolu_read', 'file content'),
        ccResult(),
      ]);

      const toolWrites = writes.filter((w) => w.toolIds?.includes('toolu_read'));
      expect(toolWrites.length).toBeGreaterThanOrEqual(1);
      // Every tools[] write for this assistant must carry the accumulated text
      for (const w of toolWrites) {
        expect(w.content).toBe('Let me check the file...');
      }
    });
  });

  // ────────────────────────────────────────────────────
  // Data-driven regression from real trace (regression.json)
  // ────────────────────────────────────────────────────

  describe('data-driven regression (133 events)', () => {
    it('should have no orphan tools when replaying real CC trace', async () => {
      // Load real trace data
      const fs = await import('node:fs');
      const path = await import('node:path');
      const tracePath = path.join(process.cwd(), 'regression.json');

      let traceData: any[];
      try {
        traceData = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
      } catch {
        // Skip if file doesn't exist (CI)
        console.log('regression.json not found, skipping data-driven test');
        return;
      }

      // Track all createMessage and updateMessage calls
      const idCounter = { tool: 0, assistant: 0 };
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') {
          idCounter.tool++;
          return { id: `tool-${idCounter.tool}` };
        }
        idCounter.assistant++;
        return { id: `ast-${idCounter.assistant}` };
      });

      // Collect tools[] writes per assistant
      const toolsRegistry = new Map<string, Set<string>>();
      mockUpdateMessage.mockImplementation(async (id: string, val: any) => {
        if (val.tools && Array.isArray(val.tools)) {
          if (!toolsRegistry.has(id)) toolsRegistry.set(id, new Set());
          const set = toolsRegistry.get(id)!;
          for (const t of val.tools) {
            if (t.id) set.add(t.id);
          }
        }
      });

      // Collect tool messages: { tool_call_id → parentId (assistant) }
      const toolMessages = new Map<string, string>();
      const origCreate = mockCreateMessage.getMockImplementation()!;
      mockCreateMessage.mockImplementation(async (params: any) => {
        const result = await origCreate(params);
        if (params.role === 'tool' && params.tool_call_id) {
          toolMessages.set(params.tool_call_id, params.parentId);
        }
        return result;
      });

      // Extract raw lines from trace
      const rawLines = traceData.map((entry: any) => entry.rawLine);

      await runWithEvents(rawLines);

      // ── Check for orphans ──
      // An orphan is a tool message whose tool_call_id doesn't appear in ANY
      // assistant's tools[] registry
      const allRegisteredToolIds = new Set<string>();
      for (const toolIds of toolsRegistry.values()) {
        for (const id of toolIds) allRegisteredToolIds.add(id);
      }

      const orphans: string[] = [];
      for (const [toolCallId, parentId] of toolMessages) {
        if (!allRegisteredToolIds.has(toolCallId)) {
          orphans.push(`tool_call_id=${toolCallId} parentId=${parentId}`);
        }
      }

      if (orphans.length > 0) {
        console.error('Orphan tools found:', orphans);
      }
      expect(orphans).toEqual([]);

      // ── Sanity checks ──
      // Should have created many tool messages (trace has ~60 tool calls)
      expect(toolMessages.size).toBeGreaterThan(20);
      // Should have many assistants
      expect(idCounter.assistant).toBeGreaterThan(10);
    });
  });

  // ────────────────────────────────────────────────────
  // LOBE-7258 reproduction: Skill → ToolSearch → MCP tool
  //
  // Mirrors the exact trace from the user-reported screenshot where
  // ToolSearch loads deferred MCP schemas before the MCP tool is called.
  // Verifies tool_result content is persisted for ALL three tools so the
  // UI stops showing "loading" after each tool completes.
  // ────────────────────────────────────────────────────

  describe('LOBE-7258 Skill → ToolSearch → MCP repro', () => {
    it('persists tool_result content for Skill, ToolSearch, and the deferred MCP tool', async () => {
      const idCounter = { tool: 0, assistant: 0 };
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') {
          idCounter.tool++;
          return { id: `tool-${idCounter.tool}` };
        }
        idCounter.assistant++;
        return { id: `ast-new-${idCounter.assistant}` };
      });

      const schemaPayload =
        '<functions><function>{"description":"Get a Linear issue","name":"mcp__linear-server__get_issue","parameters":{}}</function></functions>';

      await runWithEvents([
        ccInit(),
        // Turn 1: Skill invocation
        ccToolUse('msg_01', 'toolu_skill', 'Skill', { skill: 'linear' }),
        ccToolResult('toolu_skill', 'Launching skill: linear'),
        // Turn 2: ToolSearch with select: prefix (deferred schema fetch)
        ccToolUse('msg_02', 'toolu_search', 'ToolSearch', {
          query: 'select:mcp__linear-server__get_issue,mcp__linear-server__save_issue',
          max_results: 3,
        }),
        ccToolResult('toolu_search', schemaPayload),
        // Turn 3: the deferred MCP tool now callable
        ccToolUse('msg_03', 'toolu_get_issue', 'mcp__linear-server__get_issue', {
          id: 'LOBE-7258',
        }),
        ccToolResult('toolu_get_issue', '{"title":"resume error on topic switch"}'),
        ccText('msg_04', 'done'),
        ccResult(),
      ]);

      // All three tool messages should have their content persisted.
      const skillResult = mockUpdateToolMessage.mock.calls.find(([id]: any) => id === 'tool-1');
      const searchResult = mockUpdateToolMessage.mock.calls.find(([id]: any) => id === 'tool-2');
      const getIssueResult = mockUpdateToolMessage.mock.calls.find(([id]: any) => id === 'tool-3');

      expect(skillResult).toBeDefined();
      expect(skillResult![1]).toMatchObject({ content: 'Launching skill: linear' });

      expect(searchResult).toBeDefined();
      expect(searchResult![1]).toMatchObject({ content: schemaPayload });
      expect(searchResult![1].pluginError).toBeUndefined();

      expect(getIssueResult).toBeDefined();
      expect(getIssueResult![1]).toMatchObject({
        content: '{"title":"resume error on topic switch"}',
      });

      // tools[] registry on each step should contain the right tool id so the
      // UI can match tool messages to their assistant (no orphan warnings).
      const skillRegister = mockUpdateMessage.mock.calls.find(
        ([id, val]: any) =>
          id === 'ast-initial' && val.tools?.some((t: any) => t.id === 'toolu_skill'),
      );
      expect(skillRegister).toBeDefined();

      const searchRegister = mockUpdateMessage.mock.calls.find(
        ([id, val]: any) =>
          id === 'ast-new-1' && val.tools?.some((t: any) => t.id === 'toolu_search'),
      );
      expect(searchRegister).toBeDefined();

      const getIssueRegister = mockUpdateMessage.mock.calls.find(
        ([id, val]: any) =>
          id === 'ast-new-2' && val.tools?.some((t: any) => t.id === 'toolu_get_issue'),
      );
      expect(getIssueRegister).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────
  // Full multi-step E2E
  // ────────────────────────────────────────────────────

  describe('full multi-step E2E', () => {
    it('should produce correct DB write sequence for Read → Write → text flow', async () => {
      const idCounter = { tool: 0, assistant: 0 };
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') {
          idCounter.tool++;
          return { id: `tool-${idCounter.tool}` };
        }
        idCounter.assistant++;
        return { id: `ast-new-${idCounter.assistant}` };
      });

      await runWithEvents([
        ccInit(),
        // Turn 1: Read tool
        ccAssistant('msg_01', [{ thinking: 'Need to read the file', type: 'thinking' }]),
        ccToolUse('msg_01', 'toolu_read', 'Read', { file_path: '/src/app.ts' }),
        ccToolResult('toolu_read', 'export default function App() {}'),
        // Turn 2: Write tool (new message.id)
        ccToolUse('msg_02', 'toolu_write', 'Write', { file_path: '/src/app.ts', content: 'fixed' }),
        ccToolResult('toolu_write', 'File written'),
        // Turn 3: final summary (new message.id)
        ccText('msg_03', 'Fixed the bug in app.ts.'),
        ccResult(),
      ]);

      // --- Verify DB write sequence ---

      // 1. Tool message created for Read (parentId = initial assistant)
      const readToolCreate = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'tool' && p.tool_call_id === 'toolu_read',
      );
      expect(readToolCreate![0].parentId).toBe('ast-initial');
      expect(readToolCreate![0].plugin.apiName).toBe('Read');

      // 2. Read tool result written
      expect(mockUpdateToolMessage).toHaveBeenCalledWith(
        'tool-1',
        expect.objectContaining({ content: 'export default function App() {}' }),
        expect.any(Object),
      );

      // 3. Step 2 assistant created with parentId = tool-1 (Read tool message)
      const step2Create = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'assistant' && p.parentId === 'tool-1',
      );
      expect(step2Create).toBeDefined();

      // 4. Write tool message created (parentId = step 2 assistant)
      const writeToolCreate = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'tool' && p.tool_call_id === 'toolu_write',
      );
      expect(writeToolCreate).toBeDefined();
      expect(writeToolCreate![0].parentId).toBe('ast-new-1');

      // 5. Write tool result written
      expect(mockUpdateToolMessage).toHaveBeenCalledWith(
        'tool-2',
        expect.objectContaining({ content: 'File written' }),
        expect.any(Object),
      );

      // 6. Step 3 assistant created with parentId = tool-2 (Write tool message)
      const step3Create = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'assistant' && p.parentId === 'tool-2',
      );
      expect(step3Create).toBeDefined();

      // 7. Final content written to the last assistant message
      const finalContentWrite = mockUpdateMessage.mock.calls.find(
        ([, val]: any) => val.content === 'Fixed the bug in app.ts.',
      );
      expect(finalContentWrite).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────
  // CC subagent thread-container model (LOBE-7392 / LOBE-7319)
  //
  // A subagent Thread is shaped as a nested conversation:
  //   user (prompt) → assistant#1 (tools[]) → tool → assistant#2 (tools[]) → tool → ...
  //
  // The executor creates the Thread lazily on the FIRST subagent event
  // (the adapter announces spawn metadata on that chunk), seeds it with
  // a `role:'user'` message from the Task prompt, then appends an
  // `assistant` message per subagent turn boundary (new `subagentMessageId`).
  //
  // Main assistant.tools[] only ever carries the outer Task tool_use —
  // subagent inner tools live on the in-thread assistants' tools[].
  // ────────────────────────────────────────────────────

  describe('CC subagent thread-container', () => {
    it('does NOT create a Thread on Task tool_use alone (lazy creation)', async () => {
      // Task tool_use without any subagent events should NOT trigger
      // Thread creation — we only know the spawn is real once the
      // adapter starts announcing subagent events.
      await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', {
          description: 'Find failing tests',
          prompt: 'run the suite',
          subagent_type: 'Explore',
        }),
        ccResult(),
      ]);

      expect(mockCreateThread).not.toHaveBeenCalled();
    });

    it('creates Thread + user + assistant messages on FIRST subagent event', async () => {
      await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', {
          description: 'Find failing tests',
          prompt: 'run the suite and list failures',
          subagent_type: 'Explore',
        }),
        ccSubagentToolUse('msg_sub_1', 'toolu_task', 'toolu_child', 'Bash'),
        ccResult(),
      ]);

      // Thread row seeded with adapter-supplied metadata.
      expect(mockCreateThread).toHaveBeenCalledTimes(1);
      expect(mockCreateThread).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^thd_/),
          metadata: expect.objectContaining({
            sourceToolCallId: 'toolu_task',
            subagentType: 'Explore',
            startedAt: expect.any(String),
          }),
          sourceMessageId: 'ast-initial',
          title: 'Find failing tests',
          topicId: 'topic-1',
          type: 'isolation',
        }),
      );
      const threadId = mockCreateThread.mock.calls[0][0].id;

      // Thread gets a `role:'user'` message seeded with the Task prompt.
      const userMsg = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'user' && p.threadId === threadId,
      );
      expect(userMsg).toBeDefined();
      expect(userMsg![0]).toMatchObject({
        content: 'run the suite and list failures',
        parentId: 'ast-initial',
        threadId,
      });

      // Thread gets at least one `role:'assistant'` message scoped to
      // the subagent's first turn.
      const subAssistant = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'assistant' && p.threadId === threadId,
      );
      expect(subAssistant).toBeDefined();
    });

    it('chains subagent inner tool messages to the in-thread assistant', async () => {
      await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', {
          description: 'inspect',
          subagent_type: 'Explore',
        }),
        ccSubagentToolUse('msg_sub_1', 'toolu_task', 'toolu_child', 'Bash', { command: 'ls' }),
        ccResult(),
      ]);

      const threadId = mockCreateThread.mock.calls[0][0].id;
      const subAssistantMsg = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'assistant' && p.threadId === threadId,
      );
      const subAssistantId = subAssistantMsg?.[0];

      const subToolCreate = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'tool' && p.tool_call_id === 'toolu_child',
      );
      expect(subToolCreate).toBeDefined();
      expect(subToolCreate![0]).toMatchObject({
        role: 'tool',
        threadId,
        tool_call_id: 'toolu_child',
        plugin: expect.objectContaining({ apiName: 'Bash' }),
      });
      // Tool messages chain under the in-thread assistant (not the main one).
      expect(subToolCreate![0].parentId).not.toBe('ast-initial');
      // The in-thread assistant + tool messages share the same threadId.
      expect(subAssistantMsg![0]).toMatchObject({ threadId });
    });

    it('opens a NEW in-thread assistant when subagentMessageId changes (turn boundary)', async () => {
      await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', { description: 'x', subagent_type: 'Plan' }),
        // Turn 1
        ccSubagentToolUse('msg_sub_1', 'toolu_task', 'toolu_child_1', 'Read'),
        // Turn 2 — new message.id for subagent
        ccSubagentToolUse('msg_sub_2', 'toolu_task', 'toolu_child_2', 'Write'),
        ccResult(),
      ]);

      const threadId = mockCreateThread.mock.calls[0][0].id;
      const threadAssistants = mockCreateMessage.mock.calls.filter(
        ([p]: any) => p.role === 'assistant' && p.threadId === threadId,
      );
      // One assistant per subagent turn — same shape as the main topic.
      expect(threadAssistants.length).toBeGreaterThanOrEqual(2);
    });

    it('routes delayed tool_result to thread bucket when it arrives after subagent turn has rolled over', async () => {
      // Regression: `findRunByInnerToolCallId` must resolve across ALL
      // turns of a subagent run, not just the current one. Previously
      // it only consulted `state.persistedIds`, which `ensureSubagentRun`
      // wipes on every turn advance — so a `tool_result` for a prior
      // turn's `tool_use` silently skipped `run.stream.update` and left
      // the in-thread tool bubble stuck on its loading spinner until the
      // user re-opened the Thread (main-topic `fetchAndReplaceMessages`
      // does not rehydrate thread buckets).
      const { store } = await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', { description: 'x', subagent_type: 'Plan' }),
        // Turn 1: lifetimeToolCallIds gets `toolu_child_1`.
        ccSubagentToolUse('msg_sub_1', 'toolu_task', 'toolu_child_1', 'Read'),
        // Turn 2: ensureSubagentRun wipes state.persistedIds. The
        // run-lifetime set must still remember `toolu_child_1`.
        ccSubagentToolUse('msg_sub_2', 'toolu_task', 'toolu_child_2', 'Write'),
        // Delayed tool_result for the FIRST turn's tool_use.
        ccToolResult('toolu_child_1', 'turn 1 output'),
        ccResult(),
      ]);

      const startOpMock = (store.startOperation as ReturnType<typeof vi.fn>).mock;
      const subOpIdx = startOpMock.calls.findIndex(([p]: any) => p?.type === 'subagentThread');
      expect(subOpIdx).toBeGreaterThanOrEqual(0);
      const subOperationId = startOpMock.results[subOpIdx].value.operationId;

      const dispatches = (store.internal_dispatchMessage as ReturnType<typeof vi.fn>).mock.calls;
      const delayedResultDispatch = dispatches.find(
        ([payload, ctx]: any) =>
          ctx?.operationId === subOperationId &&
          payload.type === 'updateMessage' &&
          payload.value?.content === 'turn 1 output',
      );
      expect(delayedResultDispatch).toBeDefined();
    });

    it('records subagent tool_uses on IN-THREAD assistant tools[], not on main', async () => {
      await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', { description: 'x', subagent_type: 'Plan' }),
        ccSubagentToolUse('msg_sub_1', 'toolu_task', 'toolu_child', 'Read'),
        ccResult(),
      ]);

      // Main assistant.tools[] only ever carries the outer Task tool_use.
      const mainAssistantToolWrites = mockUpdateMessage.mock.calls.filter(
        ([id, val]: any) => id === 'ast-initial' && val.tools?.length > 0,
      );
      for (const [, val] of mainAssistantToolWrites) {
        const ids = val.tools.map((t: any) => t.id);
        expect(ids).toContain('toolu_task');
        expect(ids).not.toContain('toolu_child');
      }

      // In-thread assistant should receive an updateMessage whose tools[]
      // includes the subagent's inner tool_use.
      const threadAssistantIds = new Set(
        mockCreateMessage.mock.calls
          .filter(
            ([p]: any) =>
              p.role === 'assistant' &&
              typeof p.threadId === 'string' &&
              p.threadId.startsWith('thd_'),
          )
          .map(([, returnValue]: any) => returnValue?.id),
      );
      // The mock returns a generated id — we can't match exactly, but we
      // can assert SOME update carried toolu_child on a non-main assistant.
      const subToolUpdateLanded = mockUpdateMessage.mock.calls.some(
        ([id, val]: any) =>
          id !== 'ast-initial' && val.tools?.some((t: any) => t.id === 'toolu_child'),
      );
      expect(subToolUpdateLanded).toBe(true);
      // (threadAssistantIds unused here but kept to document the intent.)
      expect(threadAssistantIds.size).toBeGreaterThan(0);
    });

    it('does NOT create a Thread when topicId is missing (non-topic-scoped run)', async () => {
      await runWithEvents(
        [
          ccInit(),
          ccToolUse('msg_main', 'toolu_task', 'Task', {
            description: 'x',
            subagent_type: 'Plan',
          }),
          ccSubagentToolUse('msg_sub', 'toolu_task', 'toolu_child', 'Read'),
          ccResult(),
        ],
        {
          params: {
            context: { ...defaultContext, topicId: undefined as any },
          },
        },
      );

      expect(mockCreateThread).not.toHaveBeenCalled();
    });

    it('persists the subagent Thread user message content from spawnMetadata.prompt', async () => {
      // Real CC uses `Agent` for general-purpose subagents — the adapter
      // should still extract `prompt` from the input and seed the user
      // message content with it (earlier bug: user msg content empty).
      await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Agent', {
          description: 'lookup pwd',
          prompt: 'run pwd and summarize',
          subagent_type: 'general-purpose',
        }),
        ccSubagentToolUse('msg_sub', 'toolu_task', 'toolu_child', 'Bash'),
        ccResult(),
      ]);

      const threadId = mockCreateThread.mock.calls[0][0].id;
      const threadUser = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'user' && p.threadId === threadId,
      );
      expect(threadUser).toBeDefined();
      expect(threadUser![0].content).toBe('run pwd and summarize');
    });

    it('accumulates subagent text into the in-thread assistant content', async () => {
      // Subagent emits a closing summary text turn after its tool work.
      // The thread should reflect it as the assistant's content so the
      // Thread view reads as a complete conversation.
      await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', {
          description: 'x',
          prompt: 'go',
          subagent_type: 'Explore',
        }),
        ccSubagentToolUse('msg_sub_1', 'toolu_task', 'toolu_child', 'Bash'),
        ccSubagentText('msg_sub_2', 'toolu_task', 'Here is the summary.'),
        ccSubagentSpawnResult('toolu_task', 'Final answer to main.'),
        ccResult(),
      ]);

      const threadId = mockCreateThread.mock.calls[0][0].id;
      // At least one updateMessage on a subagent-thread assistant with
      // content = "Here is the summary." should have landed.
      const threadAssistantContentWrites = mockUpdateMessage.mock.calls.filter(
        ([id, val]: any) => id !== 'ast-initial' && val.content === 'Here is the summary.',
      );
      expect(threadAssistantContentWrites.length).toBeGreaterThan(0);
      expect(threadAssistantContentWrites[0][2]).toMatchObject({ topicId: 'topic-1' });
      // Sanity — the in-thread assistants exist under the right thread.
      const threadAssistants = mockCreateMessage.mock.calls.filter(
        ([p]: any) => p.role === 'assistant' && p.threadId === threadId,
      );
      expect(threadAssistants.length).toBeGreaterThanOrEqual(1);
    });

    it('does NOT leak subagent text into main assistant accumulatedContent', async () => {
      await runWithEvents([
        ccInit(),
        ccText('msg_main_pre', 'I will delegate.'),
        ccToolUse('msg_main_pre', 'toolu_task', 'Task', {
          description: 'x',
          prompt: 'go',
          subagent_type: 'Explore',
        }),
        ccSubagentText('msg_sub', 'toolu_task', 'Subagent saying things'),
        ccSubagentSpawnResult('toolu_task', 'done'),
        ccResult(),
      ]);

      // Main assistant content writes should contain "I will delegate."
      // but NEVER "Subagent saying things".
      const mainContentWrites = mockUpdateMessage.mock.calls.filter(
        ([id, val]: any) => id === 'ast-initial' && typeof val.content === 'string',
      );
      for (const [, val] of mainContentWrites) {
        expect(val.content).not.toContain('Subagent saying things');
      }
    });

    it('finalizes subagent content when the spawn tool_result lands on main', async () => {
      // Subagent emits text but no subsequent event — normally content
      // only hits DB on the next persist or at onComplete. The spawn
      // tool_result arriving on main should trigger an explicit flush
      // so the final text lands in DB before fetchAndReplace.
      await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', {
          description: 'x',
          prompt: 'go',
          subagent_type: 'Explore',
        }),
        ccSubagentText('msg_sub', 'toolu_task', 'final summary text'),
        ccSubagentSpawnResult('toolu_task', 'returned to main'),
        ccResult(),
      ]);

      const finalizeWrite = mockUpdateMessage.mock.calls.find(
        ([id, val]: any) => id !== 'ast-initial' && val.content === 'final summary text',
      );
      expect(finalizeWrite).toBeDefined();
    });

    it('retains subagent buffers + pinned target when the finalize flush fails', async () => {
      // Transient DB failures on the finalize-time flush used to silently
      // wipe the accumulators (buffer clear was outside the try/catch), so
      // the onComplete fallback had nothing left to retry. With buffers
      // preserved AND the flush target pinned, the retry writes the
      // leftover stream text to the ORIGINAL in-thread assistant — not to
      // the terminal message `resultContent` already advanced
      // `currentAssistantMsgId` onto.
      const idCounter = { tool: 0, assistant: 0, user: 0 };
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') {
          idCounter.tool++;
          return { id: `tool-${idCounter.tool}` };
        }
        if (params.role === 'user') {
          idCounter.user++;
          return { id: `thread-user-${idCounter.user}` };
        }
        idCounter.assistant++;
        return { id: `thread-ast-${idCounter.assistant}` };
      });

      // Make the FIRST write targeting the in-thread streaming assistant
      // fail. The `content === 'streamed text'` check pins the rejection
      // to the finalize-time flush; the onComplete retry uses the same
      // update shape and must succeed.
      let failed = false;
      mockUpdateMessage.mockImplementation(async (_id: string, val: any) => {
        if (!failed && val.content === 'streamed text') {
          failed = true;
          throw new Error('transient DB failure');
        }
      });

      await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', {
          description: 'x',
          prompt: 'go',
          subagent_type: 'Explore',
        }),
        ccSubagentText('msg_sub', 'toolu_task', 'streamed text'),
        ccSubagentSpawnResult('toolu_task', 'terminal result'),
        ccResult(),
      ]);

      // Streamed content landed on the FIRST in-thread assistant
      // (`thread-ast-1`) across the failure+retry — NOT on the terminal
      // assistant created by the resultContent branch.
      const streamedWrites = mockUpdateMessage.mock.calls.filter(
        ([, val]: any) => val.content === 'streamed text',
      );
      // At least the retry must have landed after the original failure.
      expect(streamedWrites.length).toBeGreaterThanOrEqual(2);
      // Every attempt — including the retry — must target the streaming
      // turn's assistant, so the terminal row's content never gets
      // clobbered by the leftover buffer.
      for (const [id] of streamedWrites) {
        expect(id).toBe('thread-ast-1');
      }

      // Terminal assistant carrying the authoritative `resultContent`
      // was still created as a fresh row (not overwritten by the retry).
      const terminalCreate = mockCreateMessage.mock.calls.find(
        ([p]: any) => p.role === 'assistant' && p.content === 'terminal result',
      );
      expect(terminalCreate).toBeDefined();
    });

    it('creates a terminal in-thread assistant with the main tool_result content', async () => {
      // CC never emits the subagent's final summary as a
      // `parent_tool_use_id`-tagged assistant event — the summary only
      // exists on the main side, as the `tool_result.content` of the
      // Agent spawn. Without an explicit terminal-assistant write, the
      // Thread ends mid-conversation (last message = a tool), and the
      // user has no visible result inside the subagent thread.
      //
      // This test covers the pure-tools subagent case (no inner text
      // event) to prove we still get a terminal summary message.
      const spawnResult = 'Here is what I found: ...';
      await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', {
          description: 'x',
          prompt: 'go',
          subagent_type: 'Explore',
        }),
        ccSubagentToolUse('msg_sub', 'toolu_task', 'toolu_child', 'Bash', { command: 'ls' }),
        ccToolResult('toolu_child', 'ls output'),
        ccSubagentSpawnResult('toolu_task', spawnResult),
        ccResult(),
      ]);

      const threadId = mockCreateThread.mock.calls[0][0].id;
      const terminalCreate = mockCreateMessage.mock.calls.find(
        ([payload]: any) =>
          payload.role === 'assistant' &&
          payload.threadId === threadId &&
          payload.content === spawnResult,
      );
      expect(terminalCreate).toBeDefined();

      // Terminal message should chain off the last tool, not off the
      // thread's initial assistant, so the transcript flows
      // user → asst(tools) → tool → asst(result).
      const toolCreate = mockCreateMessage.mock.calls.find(
        ([payload]: any) => payload.role === 'tool' && payload.tool_call_id === 'toolu_child',
      );
      expect(toolCreate).toBeDefined();
      // The tool create returns an id; since the mock returns { id } we
      // just assert the terminal's parentId is NOT the first assistant
      // (id of which was returned earlier in mockCreateMessage).
      const firstAssistantCreate = mockCreateMessage.mock.calls.find(
        ([payload]: any) => payload.role === 'assistant' && payload.threadId === threadId,
      );
      expect(terminalCreate![0].parentId).not.toBe(firstAssistantCreate![0].id);
    });

    it('streams the terminal assistant into the thread messagesMap bucket', async () => {
      // UI relies on internal_dispatchMessage to see the terminal
      // message arrive in the thread bucket — otherwise the Thread view
      // only picks it up on re-open / SWR refresh.
      const spawnResult = 'Final handoff text.';
      const { store } = await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', {
          description: 'x',
          prompt: 'go',
          subagent_type: 'Explore',
        }),
        ccSubagentToolUse('msg_sub', 'toolu_task', 'toolu_child', 'Bash'),
        ccSubagentSpawnResult('toolu_task', spawnResult),
        ccResult(),
      ]);

      // The thread-scoped sub-op opened by `beginSubagentRun` is the
      // dispatchCtx.operationId for every Thread bucket dispatch — so
      // we identify it via the `startOperation` call with type
      // 'subagentThread' and filter dispatches against that id, instead
      // of inspecting threadId directly (the threadId override at the
      // dispatch boundary is gone — context flows through the standard
      // operation registry path now).
      const startOpCalls = (store.startOperation as ReturnType<typeof vi.fn>).mock;
      const subOpIdx = startOpCalls.calls.findIndex(([p]: any) => p?.type === 'subagentThread');
      expect(subOpIdx).toBeGreaterThanOrEqual(0);
      const subOperationId = startOpCalls.results[subOpIdx].value.operationId;

      const dispatches = (store.internal_dispatchMessage as ReturnType<typeof vi.fn>).mock.calls;
      const terminalDispatch = dispatches.find(
        ([payload, ctx]: any) =>
          ctx?.operationId === subOperationId &&
          payload.type === 'createMessage' &&
          payload.value.role === 'assistant' &&
          payload.value.content === spawnResult,
      );
      expect(terminalDispatch).toBeDefined();
    });

    it('does NOT create a terminal assistant when onComplete fires without a spawn tool_result', async () => {
      // CLI closed before the Agent's tool_result arrived (e.g. crash
      // mid-run). The fallback finalize in onComplete should only flush
      // any streamed content — NOT synthesize a terminal message out
      // of thin air, since no authoritative result exists yet.
      await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', {
          description: 'x',
          prompt: 'go',
          subagent_type: 'Explore',
        }),
        ccSubagentToolUse('msg_sub', 'toolu_task', 'toolu_child', 'Bash'),
        ccToolResult('toolu_child', 'ls output'),
        ccResult(),
      ]);

      const threadId = mockCreateThread.mock.calls[0][0].id;
      // Thread assistants created in this run: ONLY the seed assistant.
      // No terminal assistant should have been synthesized.
      const assistantCreatesInThread = mockCreateMessage.mock.calls.filter(
        ([payload]: any) => payload.role === 'assistant' && payload.threadId === threadId,
      );
      expect(assistantCreatesInThread.length).toBe(1);
    });

    it('invokes store.refreshThreads on lazy Thread creation (sidebar auto-refresh)', async () => {
      // Without this hook the new subagent Thread is only visible in the
      // sidebar after the user navigates topics / refreshes — an earlier
      // Electron E2E repro had the Thread land in DB but stay invisible
      // in the list until manual `refreshThreads()` call.
      const { store } = await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', {
          description: 'x',
          prompt: 'go',
          subagent_type: 'Explore',
        }),
        ccSubagentToolUse('msg_sub', 'toolu_task', 'toolu_child', 'Bash'),
        ccResult(),
      ]);

      expect(store.refreshThreads).toHaveBeenCalledTimes(1);
    });

    it('does NOT call refreshThreads when no subagent events land', async () => {
      const { store } = await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_1', 'Read', { file_path: '/a.ts' }),
        ccToolResult('toolu_1', 'content'),
        ccResult(),
      ]);

      expect(store.refreshThreads).not.toHaveBeenCalled();
    });

    /**
     * Thread-scoped in-memory streaming. Per-spawn sub-operation is
     * opened via `startOperation({ type: 'subagentThread',
     * parentOperationId, context: { ..., threadId, scope: 'thread' } })`,
     * and every Thread bucket dispatch carries that sub-op's id —
     * `internal_getConversationContext` resolves the Thread context
     * through the standard operation registry path (no threadId-override
     * hack at the dispatch boundary). Without these dispatches the
     * Thread view would stay empty until SWR re-fetches on next open
     * (`fetchAndReplaceMessages` is main-topic scoped).
     */
    it('streams subagent create/update dispatches via a thread-scoped sub-operation', async () => {
      const { store } = await runWithEvents([
        ccInit(),
        ccToolUse('msg_main', 'toolu_task', 'Task', {
          description: 'inspect',
          prompt: 'go',
          subagent_type: 'Explore',
        }),
        ccSubagentToolUse('msg_sub_1', 'toolu_task', 'toolu_child', 'Bash', { command: 'ls' }),
        ccToolResult('toolu_child', 'ls output'),
        ccSubagentText('msg_sub_2', 'toolu_task', 'final summary'),
        ccSubagentSpawnResult('toolu_task', 'done'),
        ccResult(),
      ]);

      const threadId = mockCreateThread.mock.calls[0][0].id;
      const startOpMock = store.startOperation as ReturnType<typeof vi.fn>;

      // Sub-op opened with `subagentThread` type, parented to the main op,
      // carrying the Thread's ConversationContext (threadId + thread scope)
      // so dispatches resolve into the Thread bucket via the standard
      // `internal_getConversationContext` path.
      const subOpCallIdx = startOpMock.mock.calls.findIndex(
        ([p]: any) => p?.type === 'subagentThread',
      );
      expect(subOpCallIdx).toBeGreaterThanOrEqual(0);
      const subOpCallArg = startOpMock.mock.calls[subOpCallIdx][0];
      expect(subOpCallArg).toMatchObject({
        type: 'subagentThread',
        parentOperationId: 'op-1',
        context: { threadId, scope: 'thread' },
      });
      const subOperationId = startOpMock.mock.results[subOpCallIdx].value.operationId;

      const dispatches = (store.internal_dispatchMessage as ReturnType<typeof vi.fn>).mock.calls;
      const threadDispatches = dispatches.filter(
        ([, ctx]: any) => ctx?.operationId === subOperationId,
      );

      // Seed: user + first in-thread assistant + tool message must each
      // get a createMessage dispatch so the Thread renders the moment
      // the user opens it.
      const threadCreates = threadDispatches.filter(
        ([payload]: any) => payload.type === 'createMessage',
      );
      const threadCreateRoles = threadCreates.map(([p]: any) => (p.value as any).role);
      expect(threadCreateRoles).toContain('user');
      expect(threadCreateRoles).toContain('assistant');
      expect(threadCreateRoles).toContain('tool');

      // The tool createMessage carries the inner tool_use's tool_call_id
      // + apiName so the bubble renders with the right plugin shell.
      const toolCreate = threadCreates.find(([p]: any) => (p.value as any).role === 'tool');
      expect((toolCreate![0].value as any).tool_call_id).toBe('toolu_child');
      expect((toolCreate![0].value as any).plugin?.apiName).toBe('Bash');

      // Streaming: updateMessage dispatches must deliver the assistant's
      // tools[] (so the tool card animates) and the accumulated text
      // (so the closing summary streams).
      const threadUpdates = threadDispatches.filter(
        ([payload]: any) => payload.type === 'updateMessage',
      );
      const anyToolsUpdate = threadUpdates.some(([p]: any) =>
        Array.isArray((p.value as any).tools),
      );
      expect(anyToolsUpdate).toBe(true);
      const anyTextUpdate = threadUpdates.some(
        ([p]: any) =>
          typeof (p.value as any).content === 'string' && (p.value as any).content.length > 0,
      );
      expect(anyTextUpdate).toBe(true);

      // Tool result lands on the thread-scoped tool message id (the
      // DB-generated one captured by the createMessage dispatch above).
      const toolMsgId = toolCreate![0].id;
      const toolResultUpdate = threadUpdates.find(
        ([p]: any) => p.id === toolMsgId && (p.value as any).content === 'ls output',
      );
      expect(toolResultUpdate).toBeDefined();

      // Main bucket must NOT receive updates targeting the in-thread tool
      // message id — keep the main bubble clean of subagent bleed.
      const mainLeaks = dispatches.filter(
        ([payload, ctx]: any) =>
          ctx?.operationId !== subOperationId &&
          payload.type === 'updateMessage' &&
          payload.id === toolMsgId,
      );
      expect(mainLeaks).toHaveLength(0);

      // Sub-op is marked completed once the spawn's tool_result lands +
      // `finalizeSubagentRun` writes the terminal assistant. Cancel /
      // cleanup cascade then flow through the existing parent/child
      // operation linkage instead of any subagent-specific bookkeeping.
      expect(store.completeOperation).toHaveBeenCalledWith(subOperationId);
    });

    /**
     * Regression: parallel main tool_use + subagent inner tool_use rendered
     * Task/Agent as an orphan in the main bubble.
     *
     * The gateway handler is main-agent-only: its `stream_chunk`
     * case dispatches `updateMessage { tools }` to
     * `currentAssistantMessageId` (main). Forwarding a subagent-tagged
     * chunk would overwrite main.tools[] with the subagent's inner tools
     * in the in-memory store. The main's own Task / Agent tool_call_id
     * then has no matching entry in main.tools[], and every tool message
     * under it renders with the "orphan tool call" banner until the next
     * fetchAndReplaceMessages (or forever, if the last corrupting chunk
     * lands after the final fetch).
     *
     * DB persistence is separate (persistSubagent*Chunk writes to the
     * thread scope) and already correct — this guards only the forwarding
     * path.
     */
    it('does NOT forward subagent-tagged stream_chunks to the gateway handler', async () => {
      await runWithEvents([
        ccInit(),
        // Main emits Task + a parallel Read in the same message.id.
        ccToolUse('msg_main', 'toolu_task', 'Task', {
          description: 'inspect',
          prompt: 'go',
          subagent_type: 'Explore',
        }),
        ccToolUse('msg_main', 'toolu_read', 'Read', { file_path: '/a.ts' }),
        // Subagent inner tools + closing text.
        ccSubagentToolUse('msg_sub_1', 'toolu_task', 'toolu_grep', 'Grep'),
        ccSubagentText('msg_sub_2', 'toolu_task', 'subagent summary'),
        ccToolResult('toolu_read', 'content'),
        ccSubagentSpawnResult('toolu_task', 'task done'),
        ccResult(),
      ]);

      const handlerSpy = vi.mocked(createGatewayEventHandler).mock.results[0]?.value as ReturnType<
        typeof vi.fn
      >;
      expect(handlerSpy).toBeDefined();

      // Collect every stream_chunk that reached the handler.
      const forwardedChunks = handlerSpy.mock.calls
        .map((call) => call[0])
        .filter((e: any) => e?.type === 'stream_chunk');

      // None of them may carry subagent context — those are already
      // persisted to the in-thread assistant and must not touch main.
      for (const chunk of forwardedChunks) {
        expect((chunk as any).data?.subagent).toBeUndefined();
      }

      // Sanity: main's parallel tool chunk (Task + Read) still reaches the
      // handler so the in-memory main.tools[] animation still fires.
      const mainToolsCallingChunks = forwardedChunks.filter(
        (e: any) => e.data?.chunkType === 'tools_calling',
      );
      const seenToolIds = new Set<string>();
      for (const c of mainToolsCallingChunks) {
        for (const t of (c as any).data.toolsCalling ?? []) seenToolIds.add(t.id);
      }
      expect(seenToolIds).toContain('toolu_task');
      expect(seenToolIds).toContain('toolu_read');
      expect(seenToolIds).not.toContain('toolu_grep');
    });
  });

  // ────────────────────────────────────────────────────
  // LOBE-7365: Monitor parentId chain regression
  // ────────────────────────────────────────────────────

  describe('LOBE-7365 Monitor parentId chain', () => {
    /**
     * Monitor pattern: initial tool_use returns immediately ("Monitor started"),
     * then Monitor's stdout is fed back as synthetic user content that drives
     * new CC assistant turns. Each step should parent to the previous step's
     * last tool message to form a single assistantGroup in the UI.
     */
    it('basic flow: each step parents to previous step last tool', async () => {
      const idCounter = { tool: 0, assistant: 0 };
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') {
          idCounter.tool++;
          return { id: `tool-${idCounter.tool}` };
        }
        idCounter.assistant++;
        return { id: `ast-new-${idCounter.assistant}` };
      });

      await runWithEvents([
        ccInit(),
        // Step 0: Monitor starts a long-running task
        ccMessageStart('msg_01'),
        ccToolUse('msg_01', 'toolu_mon_0', 'Monitor', {
          shell: 'until curl localhost/health; do sleep 5; done',
        }),
        ccMessageDelta({ input_tokens: 100, output_tokens: 20 }),
        ccToolResult('toolu_mon_0', 'Monitor started, task abc'),
        // Step 1 (new msg id): CC reacts to Monitor stdout with Bash + new Monitor
        ccMessageStart('msg_02'),
        ccToolUse('msg_02', 'toolu_bash_1', 'Bash', { command: 'echo ok' }),
        ccToolUse('msg_02', 'toolu_mon_1', 'Monitor', { shell: 'tail -f log' }),
        ccMessageDelta({ input_tokens: 150, output_tokens: 30 }),
        ccToolResult('toolu_bash_1', 'ok'),
        ccToolResult('toolu_mon_1', 'Monitor started, task def'),
        // Step 2 (new msg id)
        ccMessageStart('msg_03'),
        ccToolUse('msg_03', 'toolu_bash_2', 'Bash', { command: 'date' }),
        ccMessageDelta({ input_tokens: 200, output_tokens: 40 }),
        ccToolResult('toolu_bash_2', 'Mon Apr 21'),
        ccResult(),
      ]);

      const assistantCreates = mockCreateMessage.mock.calls.filter(
        ([p]: any) => p.role === 'assistant',
      );
      // Two new assistants (step 1 + step 2); step 0 uses ast-initial
      expect(assistantCreates.length).toBe(2);

      // Step 1 parent = Monitor tool from step 0 (tool-1)
      expect(assistantCreates[0][0].parentId).toBe('tool-1');
      // Step 2 parent = LAST tool from step 1 = Monitor_1 (tool-3)
      expect(assistantCreates[1][0].parentId).toBe('tool-3');
    });

    /**
     * Hypothesis 2 from the issue: a toolless step in the middle.
     * If Monitor's stdout triggers CC to respond with only text (no tool_use),
     * the next step must still chain through. This test documents current
     * behavior: toolless step breaks tool → next-tool chain.
     */
    it('toolless middle step: chain visibly breaks at text-only step', async () => {
      const idCounter = { tool: 0, assistant: 0 };
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') {
          idCounter.tool++;
          return { id: `tool-${idCounter.tool}` };
        }
        idCounter.assistant++;
        return { id: `ast-new-${idCounter.assistant}` };
      });

      await runWithEvents([
        ccInit(),
        // Step 0: Monitor
        ccToolUse('msg_01', 'toolu_mon_0', 'Monitor', { shell: 'watch -n1 date' }),
        ccToolResult('toolu_mon_0', 'Monitor started'),
        // Step 1 (new msg id): TEXT ONLY — no tool_use
        ccText('msg_02', 'Looks like it started. I will wait for output.'),
        // Step 2 (new msg id): Monitor emits a line, CC reacts with Bash
        ccToolUse('msg_03', 'toolu_bash_2', 'Bash', { command: 'echo reacting' }),
        ccToolResult('toolu_bash_2', 'reacting'),
        ccResult(),
      ]);

      const assistantCreates = mockCreateMessage.mock.calls.filter(
        ([p]: any) => p.role === 'assistant',
      );
      expect(assistantCreates.length).toBe(2);

      // Step 1 parent = Monitor tool from step 0 → this IS correct (tool-1)
      expect(assistantCreates[0][0].parentId).toBe('tool-1');

      // Step 2 parent: step 1 had NO tools, so toolState.payloads is empty.
      // Code falls back to currentAssistantMessageId (= step 1 assistant).
      // BUG: this breaks the assistantGroup chain because collectAssistantChain
      // only walks tool → assistant, never assistant → assistant.
      expect(assistantCreates[1][0].parentId).toBe('ast-new-1');
      // ^ If this assertion passes, the chain IS broken.
    });

    /**
     * Hypothesis: Monitor's tool_result arrives AFTER the next message_start.
     * In CC's stream, tool_result comes from a `user` event AFTER the assistant
     * event that issued the tool_use, and BEFORE the next assistant turn.
     * But what if CC emits the next message_start BEFORE the tool_result lands?
     * (The adapter routes message_start via openMainMessage, which triggers
     * stream_start(newStep); stepParentId is computed in persistQueue —
     * this queue serializes with persistToolBatch but NOT with persistToolResult.)
     */
    it('delayed tool_result: Monitor tool_result arrives after next message_start', async () => {
      const idCounter = { tool: 0, assistant: 0 };
      mockCreateMessage.mockImplementation(async (params: any) => {
        if (params.role === 'tool') {
          idCounter.tool++;
          return { id: `tool-${idCounter.tool}` };
        }
        idCounter.assistant++;
        return { id: `ast-new-${idCounter.assistant}` };
      });

      await runWithEvents([
        ccInit(),
        // Step 0: Monitor
        ccMessageStart('msg_01'),
        ccToolUse('msg_01', 'toolu_mon_0', 'Monitor', { shell: '...' }),
        // Step 1 BEGINS before the Monitor tool_result arrives
        ccMessageStart('msg_02'),
        // NOW Monitor's tool_result arrives (interleaved)
        ccToolResult('toolu_mon_0', 'Monitor started'),
        ccToolUse('msg_02', 'toolu_bash_1', 'Bash', {}),
        ccToolResult('toolu_bash_1', 'ok'),
        ccResult(),
      ]);

      const assistantCreates = mockCreateMessage.mock.calls.filter(
        ([p]: any) => p.role === 'assistant',
      );
      expect(assistantCreates.length).toBe(1);
      // Step 1 parent should be the Monitor tool from step 0
      // result_msg_id is set by persistToolBatch Phase 2 (queued on persistQueue
      // BEFORE the step_boundary persistQueue.then), so this should work.
      expect(assistantCreates[0][0].parentId).toBe('tool-1');
    });
  });
});
