import { describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../core/runtime';
import type {
  AgentRuntimeHost,
  LLMAttemptOutput,
  MessageTransport,
  StreamSink,
} from '../transport';
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
  query: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
  updatePluginState: vi.fn(),
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
