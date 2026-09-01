import { describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../core/runtime';
import type {
  AgentRuntimeHost,
  LLMAttemptOutput,
  MessageTransport,
  StreamSink,
} from '../transport';
import { TOOL_CALL_REPEAT_LIMIT } from '../utils/toolCallRepeatGuard';
import {
  finalizeCallLlmTurn,
  persistInterruptedCallLlmResult,
  VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY,
} from './callLlmFinalizer';

const createMessageTransport = (): MessageTransport => ({
  createAssistantMessage: vi.fn(),
  createToolMessage: vi.fn(),
  deleteMessage: vi.fn(),
  findById: vi.fn(),
  findToolMessageIdByToolCallId: vi.fn(),
  query: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
  updatePluginState: vi.fn(),
  updateToolIntervention: vi.fn(),
  updateToolMessage: vi.fn(),
});

const createStreamSink = (): StreamSink => ({
  publishChunk: vi.fn(),
  publishError: vi.fn(),
  publishEvent: vi.fn().mockResolvedValue(undefined),
});

const createHost = (
  messages = createMessageTransport(),
  stream = createStreamSink(),
  allowEarlyFinalAnswerVisibleOutputEnd?: boolean,
): AgentRuntimeHost => ({
  operation: {
    allowEarlyFinalAnswerVisibleOutputEnd,
    operationId: 'operation-1',
    stepIndex: 3,
  },
  transports: { messages, stream },
});

const createOutput = (overrides: Partial<LLMAttemptOutput> = {}): LLMAttemptOutput => ({
  answerSalvagedFromReasoning: false,
  content: 'Answer',
  contentParts: [],
  grounding: null,
  hasContentImages: false,
  hasReasoningImages: false,
  imageList: [],
  reasoningParts: [],
  thinkingContent: 'Reasoning',
  toolCalls: [],
  toolsCalling: [],
  ...overrides,
});

describe('callLlmFinalizer', () => {
  it('blocks the limit-th consecutive identical tool call before it can execute', async () => {
    const messages = createMessageTransport();
    const stream = createStreamSink();
    const state = AgentRuntime.createInitialState({ operationId: 'operation-1' });
    state.toolCallRepeatGuard = {
      counts: {
        '["credentials","inject","{\\"keys\\":[\\"github\\"],\\"scope\\":\\"repo\\"}"]':
          TOOL_CALL_REPEAT_LIMIT - 1,
      },
    };
    const output = createOutput({
      content: '',
      toolCalls: [
        {
          function: {
            arguments: '{"scope":"repo","keys":["github"]}',
            name: 'inject',
          },
          id: 'call-5',
          type: 'function',
        },
      ],
      toolsCalling: [
        {
          apiName: 'inject',
          arguments: '{"scope":"repo","keys":["github"]}',
          id: 'call-5',
          identifier: 'credentials',
          type: 'default',
        },
      ],
    });

    const result = await finalizeCallLlmTurn({
      assistantMessageId: 'assistant-5',
      events: [],
      host: createHost(messages, stream),
      model: 'glm',
      output,
      provider: 'lobehub',
      shouldReplayAssistantReasoning: false,
      state,
    });

    expect(result.nextContext).toMatchObject({
      payload: {
        hasToolsCalling: false,
        result: {
          content: `Stopped after the same tool call was requested ${TOOL_CALL_REPEAT_LIMIT} consecutive times.`,
          tool_calls: [],
        },
        toolsCalling: [],
      },
      phase: 'llm_result',
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({
        result: expect.objectContaining({ finishReason: 'tool_call_repeat_limit' }),
        type: 'llm_result',
      }),
    );
    expect(messages.update).toHaveBeenCalledWith(
      'assistant-5',
      expect.objectContaining({
        content: `Stopped after the same tool call was requested ${TOOL_CALL_REPEAT_LIMIT} consecutive times.`,
        tools: undefined,
      }),
    );
    expect(stream.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toolsCalling: [] }),
        type: 'stream_end',
      }),
    );
  });

  it('preserves user cancellation when an aborted stream emits the limit-th repeated tool call', async () => {
    const state = AgentRuntime.createInitialState({ operationId: 'operation-1' });
    state.toolCallRepeatGuard = {
      counts: {
        '["credentials","inject","{\\"keys\\":[\\"github\\"]}"]': TOOL_CALL_REPEAT_LIMIT - 1,
      },
    };
    const toolCalling = {
      apiName: 'inject',
      arguments: '{"keys":["github"]}',
      id: 'call-5',
      identifier: 'credentials',
      type: 'default' as const,
    };

    const result = await finalizeCallLlmTurn({
      assistantMessageId: 'assistant-5',
      events: [],
      host: createHost(),
      model: 'glm',
      output: createOutput({
        content: '',
        finishReason: 'abort',
        toolCalls: [
          {
            function: { arguments: toolCalling.arguments, name: toolCalling.apiName },
            id: toolCalling.id,
            type: 'function',
          },
        ],
        toolsCalling: [toolCalling],
      }),
      provider: 'lobehub',
      shouldReplayAssistantReasoning: false,
      state,
    });

    expect(result.nextContext).toMatchObject({
      payload: {
        hasToolsCalling: true,
        reason: 'user_cancelled',
        toolsCalling: [toolCalling],
      },
      phase: 'human_abort',
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({
        result: expect.objectContaining({ finishReason: 'abort' }),
        type: 'llm_result',
      }),
    );
  });

  it('persists, builds replay-safe state and usage, and preserves finalization order', async () => {
    const messages = createMessageTransport();
    const stream = createStreamSink();
    const host = createHost(messages, stream);
    const state = AgentRuntime.createInitialState({
      messages: [{ content: 'Question', role: 'user' }],
      metadata: { topicId: 'topic-1' },
      operationId: 'operation-1',
    });
    const usage = {
      cost: 0.05,
      totalInputTokens: 10,
      totalOutputTokens: 5,
      totalTokens: 15,
    };
    const output = createOutput({
      answerSalvagedFromReasoning: true,
      grounding: { searchQueries: ['query'] },
      speed: { tps: 12, ttft: 120 },
      toolCalls: [
        {
          function: { arguments: 'not-json', name: 'search' },
          id: 'call-1',
          type: 'function',
        },
        {
          function: { arguments: '{}', name: '' },
          id: 'call-without-name',
          type: 'function',
        },
      ],
      toolsCalling: [
        {
          apiName: 'search',
          arguments: 'not-json',
          id: 'call-1',
          identifier: 'search-tool',
          type: 'default',
        },
      ],
      usage,
    });
    const recordResult = vi.fn();

    const result = await finalizeCallLlmTurn({
      assistantMessageId: 'assistant-1',
      events: [],
      host,
      model: 'fallback-model',
      output,
      provider: 'fallback-provider',
      recordResult,
      shouldReplayAssistantReasoning: true,
      state,
      stepLabel: 'research:answer',
    });

    expect(messages.update).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        content: 'Answer',
        metadata: expect.objectContaining({
          answerSalvagedFromReasoning: true,
          performance: { tps: 12, ttft: 120 },
          usage,
        }),
        reasoning: { content: 'Reasoning' },
        search: { searchQueries: ['query'] },
        tools: [expect.objectContaining({ arguments: '{}' })],
      }),
    );
    expect(state.messages).toHaveLength(1);
    expect(result.newState.messages.at(-1)).toEqual({
      content: 'Answer',
      id: 'assistant-1',
      model: 'fallback-model',
      provider: 'fallback-provider',
      reasoning: { content: 'Reasoning' },
      role: 'assistant',
      tool_calls: [
        {
          function: { arguments: '{}', name: 'search' },
          id: 'call-1',
          type: 'function',
        },
      ],
    });
    expect(result.newState.usage.llm).toMatchObject({
      apiCalls: 1,
      tokens: { input: 10, output: 5, total: 15 },
    });
    expect(result.newState.cost.llm.byModel).toEqual([
      expect.objectContaining({
        id: 'fallback-provider/fallback-model',
        model: 'fallback-model',
        provider: 'fallback-provider',
      }),
    ]);
    expect(result.newState.metadata).toMatchObject({
      _stepLabel: 'research:answer',
    });
    expect(result.events.at(-1)).toMatchObject({ type: 'llm_result' });
    expect(recordResult).toHaveBeenCalledWith(output);

    const publishedEvents = vi.mocked(stream.publishEvent).mock.calls;
    const streamEndCall = publishedEvents.findIndex(([event]) => event.type === 'stream_end');
    expect(streamEndCall).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(stream.publishEvent).mock.invocationCallOrder[streamEndCall]).toBeLessThan(
      vi.mocked(messages.update).mock.invocationCallOrder[0],
    );
    expect(publishedEvents.some(([event]) => event.type === 'visible_output_end')).toBe(false);
  });

  it('tags replayable reasoning with its source model and provider', async () => {
    const result = await finalizeCallLlmTurn({
      assistantMessageId: 'assistant-1',
      events: [],
      host: createHost(),
      model: 'gpt-5',
      output: createOutput({
        reasoning: { signature: 'encrypted-reasoning' },
        thinkingContent: '',
      }),
      provider: 'chatgpt',
      shouldReplayAssistantReasoning: true,
      state: AgentRuntime.createInitialState({ operationId: 'operation-1' }),
    });

    expect(result.newState.messages.at(-1)).toMatchObject({
      model: 'gpt-5',
      provider: 'chatgpt',
      reasoning: { signature: 'encrypted-reasoning' },
    });
  });

  it('persists complete reasoning response items without visible thinking content', async () => {
    const responseItem = {
      encrypted_content: 'scoped-encrypted',
      id: 'rs_hidden',
      summary: [],
      type: 'reasoning' as const,
    };

    const result = await finalizeCallLlmTurn({
      assistantMessageId: 'assistant-1',
      events: [],
      host: createHost(),
      model: 'gpt-5',
      output: createOutput({
        reasoning: { responseItems: [responseItem] },
        thinkingContent: '',
      }),
      provider: 'chatgpt',
      shouldReplayAssistantReasoning: true,
      state: AgentRuntime.createInitialState({ operationId: 'operation-1' }),
    });

    expect(result.newState.messages.at(-1)).toMatchObject({
      reasoning: { responseItems: [responseItem] },
    });
  });

  it('publishes no-tool visible output end before persistence and records the marker', async () => {
    const messages = createMessageTransport();
    const stream = createStreamSink();

    const result = await finalizeCallLlmTurn({
      assistantMessageId: 'assistant-1',
      events: [],
      host: createHost(messages, stream),
      model: 'gpt-4',
      output: createOutput(),
      provider: 'openai',
      shouldReplayAssistantReasoning: false,
      state: AgentRuntime.createInitialState({ operationId: 'operation-1' }),
    });

    const publishedEvents = vi.mocked(stream.publishEvent).mock.calls;
    const streamEndCall = publishedEvents.findIndex(([event]) => event.type === 'stream_end');
    const visibleEndCall = publishedEvents.findIndex(
      ([event]) => event.type === 'visible_output_end',
    );
    expect(visibleEndCall).toBeGreaterThan(streamEndCall);
    expect(vi.mocked(stream.publishEvent).mock.invocationCallOrder[visibleEndCall]).toBeLessThan(
      vi.mocked(messages.update).mock.invocationCallOrder[0],
    );
    expect(result.newState.metadata).toMatchObject({
      [VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY]: 3,
    });
  });

  it('stamps the work display anchor only on the turn-final message after tool interaction', async () => {
    const messages = createMessageTransport();
    const state = AgentRuntime.createInitialState({
      messages: [
        { content: 'Create a task', id: 'user-1', role: 'user' },
        {
          content: '',
          id: 'assistant-0',
          role: 'assistant',
          tool_calls: [
            { function: { arguments: '{}', name: 'createTask' }, id: 'call-1', type: 'function' },
          ],
        },
        { content: 'created', id: 'tool-1', role: 'tool' },
      ],
      metadata: { sourceMessageId: 'user-1' },
      operationId: 'operation-1',
    });

    await finalizeCallLlmTurn({
      assistantMessageId: 'assistant-1',
      events: [],
      host: createHost(messages),
      model: 'gpt-4',
      output: createOutput(),
      provider: 'openai',
      shouldReplayAssistantReasoning: false,
      state,
    });

    expect(messages.update).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          work: { rootOperationId: 'operation-1', userMessageId: 'user-1' },
        }),
      }),
    );

    // A plain answer with no prior tool interaction must NOT get an anchor.
    const plainMessages = createMessageTransport();
    await finalizeCallLlmTurn({
      assistantMessageId: 'assistant-2',
      events: [],
      host: createHost(plainMessages),
      model: 'gpt-4',
      output: createOutput(),
      provider: 'openai',
      shouldReplayAssistantReasoning: false,
      state: AgentRuntime.createInitialState({
        messages: [{ content: 'Hi', id: 'user-2', role: 'user' }],
        metadata: { sourceMessageId: 'user-2' },
        operationId: 'operation-1',
      }),
    });
    const [, plainUpdate] = vi.mocked(plainMessages.update).mock.calls[0];
    expect(plainUpdate.metadata ?? {}).not.toHaveProperty('work');
  });

  it('serializes multimodal parts and keeps the null grounding sentinel', async () => {
    const messages = createMessageTransport();
    const state = AgentRuntime.createInitialState({ operationId: 'operation-1' });

    const result = await finalizeCallLlmTurn({
      assistantMessageId: 'assistant-existing',
      events: [],
      host: createHost(messages),
      model: 'gemini',
      output: createOutput({
        content: 'Image answer',
        contentParts: [
          { text: 'Image answer', type: 'text' },
          { image: 'https://example.com/image.png', type: 'image' },
        ],
        grounding: null,
        hasContentImages: true,
        hasReasoningImages: true,
        reasoningParts: [
          { text: 'Visual reasoning', type: 'text' },
          { image: 'https://example.com/reasoning.png', type: 'image' },
        ],
        thinkingContent: 'Visual reasoning',
      }),
      provider: 'google',
      shouldReplayAssistantReasoning: false,
      state,
    });

    expect(messages.update).toHaveBeenCalledWith(
      'assistant-existing',
      expect.objectContaining({
        content: JSON.stringify([
          { text: 'Image answer', type: 'text' },
          { image: 'https://example.com/image.png', type: 'image' },
        ]),
        metadata: { isMultimodal: true },
        reasoning: {
          content: JSON.stringify([
            { text: 'Visual reasoning', type: 'text' },
            { image: 'https://example.com/reasoning.png', type: 'image' },
          ]),
          isMultimodal: true,
        },
        search: null,
      }),
    );
    expect(result.newState.messages.at(-1)).toEqual({
      content: 'Image answer',
      id: 'assistant-existing',
      model: 'gemini',
      provider: 'google',
      reasoning: undefined,
      role: 'assistant',
      tool_calls: undefined,
    });
  });

  it('preserves structured client metadata and maps abort completion to human_abort', async () => {
    const messages = createMessageTransport();

    const result = await finalizeCallLlmTurn({
      assistantMessageId: 'assistant-1',
      events: [],
      host: createHost(messages),
      model: 'claude',
      output: createOutput({
        content: 'Partial answer',
        finishReason: 'abort',
        observationId: 'observation-1',
        reasoning: { content: 'Reasoning', duration: 120, signature: 'signature-1' },
        traceId: 'trace-1',
      }),
      provider: 'anthropic',
      shouldReplayAssistantReasoning: true,
      state: AgentRuntime.createInitialState({ operationId: 'operation-1' }),
    });

    expect(messages.update).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        metadata: { finishType: 'abort' },
        observationId: 'observation-1',
        reasoning: { content: 'Reasoning', duration: 120, signature: 'signature-1' },
        traceId: 'trace-1',
      }),
    );
    expect(result.nextContext).toMatchObject({
      payload: {
        parentMessageId: 'assistant-1',
        reason: 'user_cancelled',
      },
      phase: 'human_abort',
    });
  });

  it('persists partial interrupted output and skips empty interruptions', async () => {
    const messages = createMessageTransport();
    const host = createHost(messages);

    await persistInterruptedCallLlmResult({
      assistantMessageId: 'assistant-empty',
      host,
      output: createOutput({ content: '', thinkingContent: '' }),
    });
    expect(messages.update).not.toHaveBeenCalled();

    await persistInterruptedCallLlmResult({
      assistantMessageId: 'assistant-partial',
      host,
      output: createOutput({
        content: 'Partial',
        speed: { tps: 8 },
        thinkingContent: 'Thinking',
        usage: { totalOutputTokens: 4 },
      }),
    });

    expect(messages.update).toHaveBeenCalledWith('assistant-partial', {
      content: 'Partial',
      metadata: expect.objectContaining({
        interruptedMidStream: true,
        performance: { tps: 8 },
        usage: { totalOutputTokens: 4 },
      }),
      reasoning: { content: 'Thinking' },
      tools: undefined,
    });
  });

  it('keeps state finalization tolerant when the message write fails', async () => {
    const messages = createMessageTransport();
    const error = new Error('database unavailable');
    vi.mocked(messages.update).mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await finalizeCallLlmTurn({
      assistantMessageId: 'assistant-1',
      events: [],
      host: createHost(messages),
      model: 'gpt-4',
      output: createOutput(),
      provider: 'openai',
      shouldReplayAssistantReasoning: true,
      state: AgentRuntime.createInitialState({ operationId: 'operation-1' }),
    });

    expect(result.newState.messages.at(-1)).toMatchObject({ id: 'assistant-1' });
    expect(consoleError).toHaveBeenCalledWith('[call_llm] Failed to update message:', error);
    consoleError.mockRestore();
  });

  it('does not publish early visible output end when the host disables it', async () => {
    const stream = createStreamSink();

    await finalizeCallLlmTurn({
      assistantMessageId: 'assistant-1',
      events: [],
      host: createHost(createMessageTransport(), stream, false),
      model: 'gpt-4',
      output: createOutput(),
      provider: 'openai',
      shouldReplayAssistantReasoning: false,
      state: AgentRuntime.createInitialState({ operationId: 'operation-1' }),
    });

    expect(vi.mocked(stream.publishEvent).mock.calls).toEqual([
      [expect.objectContaining({ type: 'stream_end' })],
    ]);
  });
});
