import { AgentRuntime, type LLMAttemptOutput } from '@lobechat/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY } from '../visibleOutputEnd';
import {
  finalizeServerCallLlmResult,
  persistInterruptedServerCallLlmResult,
} from './serverCallLlmFinalizer';

const createMessageModel = () => {
  const update = vi.fn().mockResolvedValue({ success: true });

  return {
    messageModel: { update } as unknown as RuntimeExecutorContext['messageModel'],
    update,
  };
};

type FinalizerAttemptOutput = Pick<
  LLMAttemptOutput,
  | 'content'
  | 'contentParts'
  | 'hasContentImages'
  | 'hasReasoningImages'
  | 'reasoningParts'
  | 'thinkingContent'
>;

const createStreamOutput = (
  overrides?: Partial<FinalizerAttemptOutput>,
): FinalizerAttemptOutput => ({
  content: 'Answer',
  contentParts: [],
  hasContentImages: false,
  hasReasoningImages: false,
  reasoningParts: [],
  thinkingContent: 'Reasoning',
  ...overrides,
});

describe('serverCallLlmFinalizer', () => {
  it('persists the message and builds replay-safe state with resolved model usage', async () => {
    const { messageModel, update } = createMessageModel();
    const state = AgentRuntime.createInitialState({
      messages: [{ content: 'Question', role: 'user' }],
      metadata: { topicId: 'topic-1' },
      operationId: 'operation-1',
    });
    const currentStepUsage = {
      cost: 0.05,
      totalInputTokens: 10,
      totalOutputTokens: 5,
      totalTokens: 15,
    };

    const newState = await finalizeServerCallLlmResult({
      answerSalvagedFromReasoning: true,
      assistantMessageId: 'assistant-1',
      currentStepSpeed: { tps: 12, ttft: 120 },
      currentStepUsage,
      grounding: { searchQueries: ['query'] },
      imageList: [],
      messageModel,
      model: 'fallback-model',
      provider: 'fallback-provider',
      shouldReplayAssistantReasoning: true,
      state,
      stepLabel: 'research:answer',
      streamOutput: createStreamOutput(),
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
      visibleOutputEndPublishedStepIndex: 3,
    });

    expect(update).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        content: 'Answer',
        metadata: expect.objectContaining({
          answerSalvagedFromReasoning: true,
          performance: { tps: 12, ttft: 120 },
          usage: currentStepUsage,
        }),
        reasoning: { content: 'Reasoning' },
        search: { searchQueries: ['query'] },
        tools: [expect.objectContaining({ arguments: '{}' })],
      }),
    );
    expect(state.messages).toHaveLength(1);
    expect(newState.messages.at(-1)).toEqual({
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
    expect(newState.usage.llm).toMatchObject({
      apiCalls: 1,
      tokens: { input: 10, output: 5, total: 15 },
    });
    expect(newState.cost.llm.byModel).toEqual([
      expect.objectContaining({
        id: 'fallback-provider/fallback-model',
        model: 'fallback-model',
        provider: 'fallback-provider',
      }),
    ]);
    expect(newState.metadata).toMatchObject({
      _stepLabel: 'research:answer',
      [VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY]: 3,
    });
  });

  it('persists multimodal content while keeping reasoning replay gated', async () => {
    const { messageModel, update } = createMessageModel();
    const state = AgentRuntime.createInitialState({ operationId: 'operation-1' });

    const newState = await finalizeServerCallLlmResult({
      answerSalvagedFromReasoning: false,
      assistantMessageId: 'assistant-1',
      grounding: null,
      imageList: [],
      messageModel,
      model: 'gemini',
      provider: 'google',
      shouldReplayAssistantReasoning: false,
      state,
      streamOutput: createStreamOutput({
        content: 'Image answer',
        contentParts: [
          { text: 'Image answer', type: 'text' },
          { image: 'https://example.com/image.png', type: 'image' },
        ],
        hasContentImages: true,
        hasReasoningImages: true,
        reasoningParts: [
          { text: 'Visual reasoning', type: 'text' },
          { image: 'https://example.com/reasoning.png', type: 'image' },
        ],
        thinkingContent: 'Visual reasoning',
      }),
      toolCalls: [],
      toolsCalling: [],
    });

    expect(update).toHaveBeenCalledWith(
      'assistant-1',
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
      }),
    );
    expect(newState.messages.at(-1)).toEqual({
      content: 'Image answer',
      id: 'assistant-1',
      reasoning: undefined,
      role: 'assistant',
      tool_calls: undefined,
    });
  });

  it('persists partial interrupted output and skips empty interruptions', async () => {
    const { messageModel, update } = createMessageModel();

    await persistInterruptedServerCallLlmResult({
      assistantMessageId: 'assistant-empty',
      messageModel,
      operationLogId: 'operation-1:0',
      streamOutput: createStreamOutput({ content: '', thinkingContent: '' }),
      toolsCalling: [],
    });
    expect(update).not.toHaveBeenCalled();

    await persistInterruptedServerCallLlmResult({
      assistantMessageId: 'assistant-partial',
      currentStepSpeed: { tps: 8 },
      currentStepUsage: { totalOutputTokens: 4 },
      messageModel,
      operationLogId: 'operation-1:0',
      streamOutput: createStreamOutput({ content: 'Partial', thinkingContent: 'Thinking' }),
      toolsCalling: [],
    });

    expect(update).toHaveBeenCalledWith('assistant-partial', {
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
});
