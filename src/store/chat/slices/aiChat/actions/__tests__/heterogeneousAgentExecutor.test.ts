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

function createMockStore() {
  return {
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    internal_dispatchMessage: vi.fn(),
    internal_toggleToolCallingStreaming: vi.fn(),
    replaceMessages: vi.fn(),
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
});
