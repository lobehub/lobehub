import { describe, expect, it, vi } from 'vitest';

import type {
  AgentRuntimeHost,
  ContextBuilder,
  ContextBuildOutput,
  LLMAttemptOutput,
  LLMTransport,
  LLMTurnSession,
  MessageTransport,
  OperationStore,
  StreamSink,
} from '../transport';
import type { AgentInstructionCallLlm, AgentState } from '../types';
import { callLlm } from './callLlm';

const createState = (): AgentState => ({
  cost: {
    calculatedAt: new Date().toISOString(),
    currency: 'USD',
    llm: { byModel: [], currency: 'USD', total: 0 },
    tools: { byTool: [], currency: 'USD', total: 0 },
    total: 0,
  },
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
  messages: [],
  metadata: {
    agentId: 'agent-1',
    threadId: 'thread-1',
    topicId: 'topic-1',
  },
  operationId: 'op-1',
  status: 'running',
  stepCount: 0,
  toolManifestMap: {},
  usage: {
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
    llm: {
      apiCalls: 0,
      processingTimeMs: 0,
      tokens: { input: 0, output: 0, total: 0 },
    },
    tools: {
      byTool: [],
      totalCalls: 0,
      totalTimeMs: 0,
    },
  },
});

const instruction: AgentInstructionCallLlm = {
  payload: {
    messages: [{ content: 'hello', role: 'user' }],
    model: 'gpt-4',
    provider: 'openai',
    tools: [],
  },
  type: 'call_llm',
};

const createMessageTransport = (): MessageTransport => ({
  createAssistantMessage: vi.fn().mockResolvedValue({ id: 'assistant-1' }),
  createToolMessage: vi.fn(),
  deleteMessage: vi.fn(),
  findById: vi.fn().mockResolvedValue({ id: 'parent-1' }),
  query: vi.fn(),
  update: vi.fn(),
  updatePluginState: vi.fn(),
  updateToolMessage: vi.fn(),
});

const createStreamSink = (): StreamSink => ({
  publishChunk: vi.fn(),
  publishError: vi.fn(),
  publishEvent: vi.fn(),
});

const contextOutput: ContextBuildOutput = {
  messages: [{ content: 'prepared hello', role: 'user' }],
  replayAssistantReasoning: false,
};

const createContextBuilder = (): ContextBuilder => ({
  build: vi.fn().mockResolvedValue(contextOutput),
});

const createAttemptOutput = (content = 'answer'): LLMAttemptOutput => ({
  answerSalvagedFromReasoning: false,
  content,
  contentParts: [],
  grounding: null,
  hasContentImages: false,
  hasReasoningImages: false,
  imageList: [],
  reasoningParts: [],
  thinkingContent: '',
  toolCalls: [],
  toolsCalling: [],
});

const createTurnSession = (overrides: Partial<LLMTurnSession> = {}): LLMTurnSession => ({
  classifyError: vi.fn().mockReturnValue({ kind: 'stop', message: 'failed' }),
  close: vi.fn(),
  handleError: vi.fn().mockResolvedValue(undefined),
  maxAttempts: 3,
  recordResult: vi.fn(),
  resolveRetryBudget: vi.fn().mockReturnValue(2),
  runAttempt: vi.fn().mockResolvedValue({ ok: true, output: createAttemptOutput() }),
  waitForRetry: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const createHost = (
  llm: LLMTransport,
  messages = createMessageTransport(),
  stream = createStreamSink(),
  context = createContextBuilder(),
  operationStore?: OperationStore,
): AgentRuntimeHost => ({
  operation: { operationId: 'op-1', stepIndex: 0 },
  transports: {
    context,
    llm,
    messages,
    operationStore,
    stream,
  },
});

describe('callLlm executor', () => {
  it('prepares the assistant message and delegates call_llm execution to the LLM transport', async () => {
    const state = createState();
    const session = createTurnSession();
    const openTurn = vi.fn().mockReturnValue(session);
    const messages = createMessageTransport();
    const stream = createStreamSink();
    const context = createContextBuilder();
    const host = createHost(
      {
        openTurn,
        stream: vi.fn(),
      },
      messages,
      stream,
      context,
    );
    const instructionWithParent: AgentInstructionCallLlm = {
      payload: {
        ...instruction.payload,
        parentId: 'parent-1',
      },
      type: 'call_llm',
    };

    const result = await callLlm(host)(instructionWithParent, state);
    expect(messages.findById).toHaveBeenCalledWith('parent-1');
    expect(messages.createAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        content: '',
        model: 'gpt-4',
        parentId: 'parent-1',
        provider: 'openai',
        role: 'assistant',
        threadId: 'thread-1',
        topicId: 'topic-1',
      }),
    );
    expect(stream.publishEvent).toHaveBeenCalledWith({
      data: {
        assistantMessage: { id: 'assistant-1' },
        model: 'gpt-4',
        provider: 'openai',
      },
      stepIndex: 0,
      type: 'stream_start',
    });
    expect(context.build).toHaveBeenCalledWith({
      model: 'gpt-4',
      payload: instructionWithParent.payload,
      provider: 'openai',
      state,
    });
    expect(openTurn).toHaveBeenCalledWith({
      assistantMessage: { id: 'assistant-1' },
      context: contextOutput,
      model: 'gpt-4',
      provider: 'openai',
      state,
      stepLabel: undefined,
    });
    expect(session.runAttempt).toHaveBeenCalledWith({
      attempt: 1,
      events: [expect.objectContaining({ type: 'llm_result' })],
    });
    expect(messages.update).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({ content: 'answer', search: null }),
    );
    expect(result.newState.messages.at(-1)).toMatchObject({
      content: 'answer',
      id: 'assistant-1',
      role: 'assistant',
    });
    expect(session.recordResult).toHaveBeenCalledWith(createAttemptOutput());
    expect(session.close).toHaveBeenCalledWith(undefined);
  });

  it('reuses an existing assistant message without creating a new one', async () => {
    const state = createState();
    const session = createTurnSession();
    const openTurn = vi.fn().mockReturnValue(session);
    const messages = createMessageTransport();
    const host = createHost(
      {
        openTurn,
        stream: vi.fn(),
      },
      messages,
    );
    const reuseInstruction: AgentInstructionCallLlm = {
      payload: {
        ...instruction.payload,
        assistantMessageId: 'assistant-existing',
      },
      type: 'call_llm',
    };

    await expect(callLlm(host)(reuseInstruction, state)).resolves.toMatchObject({
      newState: { messages: [expect.objectContaining({ id: 'assistant-existing' })] },
    });
    expect(messages.createAssistantMessage).not.toHaveBeenCalled();
    expect(openTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessage: { id: 'assistant-existing' },
      }),
    );
  });

  it('throws when the LLM transport does not provide openTurn', async () => {
    const host = createHost({
      stream: vi.fn(),
    });

    await expect(callLlm(host)(instruction, createState())).rejects.toThrow(
      'LLMTransport.openTurn is required for call_llm executor',
    );
  });

  it('publishes context build failures without executing the model turn', async () => {
    const error = new Error('context failed');
    const context: ContextBuilder = { build: vi.fn().mockRejectedValue(error) };
    const openTurn = vi.fn();
    const stream = createStreamSink();
    const host = createHost(
      { openTurn, stream: vi.fn() },
      createMessageTransport(),
      stream,
      context,
    );

    await expect(callLlm(host)(instruction, createState())).rejects.toBe(error);
    expect(stream.publishError).toHaveBeenCalledWith({
      error,
      phase: 'llm_execution',
      stepIndex: 0,
    });
    expect(openTurn).not.toHaveBeenCalled();
  });

  it('fails before creating an assistant message when the parent message is missing', async () => {
    const messages = createMessageTransport();
    vi.mocked(messages.findById).mockResolvedValue(undefined);
    const stream = createStreamSink();
    const host = createHost(
      {
        openTurn: vi.fn(),
        stream: vi.fn(),
      },
      messages,
      stream,
    );
    const instructionWithParent: AgentInstructionCallLlm = {
      payload: {
        ...instruction.payload,
        parentMessageId: 'missing-parent',
      },
      type: 'call_llm',
    };

    await expect(callLlm(host)(instructionWithParent, createState())).rejects.toMatchObject({
      errorType: 'ConversationParentMissing',
      parentId: 'missing-parent',
    });
    expect(messages.createAssistantMessage).not.toHaveBeenCalled();
    expect(stream.publishEvent).toHaveBeenCalledWith({
      data: {
        error:
          'Conversation parent message missing-parent no longer exists. It was likely deleted while the operation was running.',
        errorType: 'ConversationParentMissing',
        phase: 'parent_message_preflight',
      },
      stepIndex: 0,
      type: 'error',
    });
  });

  it('owns retries and publishes stream_retry before finalizing the successful attempt', async () => {
    const state = createState();
    const error = new Error('temporary outage');
    const firstOutput = createAttemptOutput('partial');
    const finalOutput = createAttemptOutput('complete');
    const runAttempt = vi
      .fn()
      .mockResolvedValueOnce({ error, ok: false, output: firstOutput })
      .mockResolvedValueOnce({ ok: true, output: finalOutput });
    const onRetry = vi.fn();
    const session = createTurnSession({
      classifyError: vi.fn().mockReturnValue({
        code: 'UPSTREAM_TIMEOUT',
        kind: 'retry',
        message: error.message,
      }),
      onRetry,
      runAttempt,
    });
    const stream = createStreamSink();
    const operationStore: OperationStore = {
      clearRunningMark: vi.fn(),
      loadState: vi.fn().mockResolvedValue(null),
    };
    const host = createHost(
      { openTurn: vi.fn().mockReturnValue(session), stream: vi.fn() },
      createMessageTransport(),
      stream,
      createContextBuilder(),
      operationStore,
    );

    const result = await callLlm(host)(instruction, state);

    const retryEvent = {
      data: {
        attempt: 2,
        delayMs: 1000,
        errorType: 'UPSTREAM_TIMEOUT',
        kind: 'retry',
        maxAttempts: 3,
      },
      type: 'stream_retry' as const,
    };
    expect(runAttempt).toHaveBeenNthCalledWith(1, {
      attempt: 1,
      events: [retryEvent, expect.objectContaining({ type: 'llm_result' })],
    });
    expect(runAttempt).toHaveBeenNthCalledWith(2, {
      attempt: 2,
      events: [retryEvent, expect.objectContaining({ type: 'llm_result' })],
    });
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      delayMs: 1000,
      error: {
        code: 'UPSTREAM_TIMEOUT',
        kind: 'retry',
        message: error.message,
      },
      maxAttempts: 3,
    });
    expect(stream.publishEvent).toHaveBeenCalledWith({
      data: retryEvent.data,
      stepIndex: 0,
      type: 'stream_retry',
    });
    expect(session.waitForRetry).toHaveBeenCalledWith(1000);
    expect(result.newState.messages.at(-1)).toMatchObject({ content: 'complete' });
    expect(session.recordResult).toHaveBeenCalledWith(finalOutput);
    expect(session.handleError).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledWith(undefined);
  });

  it('stops retrying and persists the partial attempt when the operation is interrupted', async () => {
    const state = createState();
    const error = new Error('stream aborted');
    const output = createAttemptOutput('partial');
    const session = createTurnSession({
      classifyError: vi.fn().mockReturnValue({ kind: 'retry', message: error.message }),
      runAttempt: vi.fn().mockResolvedValue({ error, ok: false, output }),
    });
    const operationStore: OperationStore = {
      clearRunningMark: vi.fn(),
      loadState: vi.fn().mockResolvedValue({ ...state, status: 'interrupted' }),
    };
    const stream = createStreamSink();
    const messages = createMessageTransport();
    const host = createHost(
      { openTurn: vi.fn().mockReturnValue(session), stream: vi.fn() },
      messages,
      stream,
      createContextBuilder(),
      operationStore,
    );

    await expect(callLlm(host)(instruction, state)).rejects.toBe(error);

    expect(session.runAttempt).toHaveBeenCalledTimes(1);
    expect(session.waitForRetry).not.toHaveBeenCalled();
    expect(messages.update).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        content: 'partial',
        metadata: expect.objectContaining({ interruptedMidStream: true }),
      }),
    );
    expect(session.handleError).toHaveBeenCalledWith({
      error,
      events: [],
      interrupted: true,
      output,
      retryBudget: 2,
    });
    expect(session.close).toHaveBeenCalledWith(error);
    expect(stream.publishError).toHaveBeenCalledWith({
      error,
      phase: 'llm_execution',
      stepIndex: 0,
    });
  });
});
