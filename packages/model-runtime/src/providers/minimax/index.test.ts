// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { AgentRuntimeErrorType } from '../../types/error';
import { MaxTokensExceededError } from '../../utils/resolveSafeMaxTokens';
import { LobeMinimaxAI, params } from './index';

const provider = ModelProvider.Minimax;
const defaultBaseURL = 'https://api.minimaxi.com/v1';

testProvider({
  Runtime: LobeMinimaxAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_MINIMAX_CHAT_COMPLETION',
  chatModel: 'abab6.5s-chat',
  test: {
    skipAPICall: true,
  },
});

const handlePayload = params.chatCompletion.handlePayload;
const handleError = params.chatCompletion.handleError;

describe('LobeMinimaxAI - handlePayload', () => {
  it('respects an explicitly provided max_tokens', () => {
    const result = handlePayload({
      max_tokens: 4096,
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M2.7',
      temperature: 1,
    } as any);

    expect(result.max_tokens).toBe(4096);
  });

  it('derives max_tokens from the model maxOutput when input is small', () => {
    const result = handlePayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M2.7',
      temperature: 1,
    } as any);

    // MiniMax-M2.7 maxOutput is 131_072 and contextWindowTokens is 204_800.
    // With a tiny input, max_tokens should equal maxOutput.
    expect(result.max_tokens).toBe(131_072);
  });

  it('caps max_tokens when input + tools fill most of the context window', () => {
    // Mimic the LOBE-7017 scenario: many large tool definitions.
    // MiniMax-M2.7: contextWindow=204_800, maxOutput=131_072. Need >72k tokens
    // of input to push the dynamic cap below maxOutput.
    const heavyTool = {
      function: {
        description: 'x'.repeat(500_000),
        name: 'big_tool',
        parameters: { properties: {}, type: 'object' },
      },
      type: 'function',
    };

    const result = handlePayload({
      messages: [{ content: 'hello', role: 'user' }],
      model: 'MiniMax-M2.7',
      temperature: 1,
      tools: [heavyTool],
    } as any);

    expect(result.max_tokens).toBeDefined();
    expect(result.max_tokens).toBeLessThan(131_072);
    expect(result.max_tokens).toBeGreaterThanOrEqual(1024);
  });

  it('throws MaxTokensExceededError when no headroom remains', () => {
    // M2-her: contextWindow=65_536. With ~67k tokens of input there is no
    // room left for the minimum 1024 output tokens, so we should bail out
    // before the request reaches the upstream API.
    const longContent = 'a'.repeat(450_000);

    expect(() =>
      handlePayload({
        messages: [{ content: longContent, role: 'user' }],
        model: 'M2-her',
        temperature: 1,
      } as any),
    ).toThrow(MaxTokensExceededError);
  });

  it('estimates tokens against the sanitized messages, not the raw payload', () => {
    // Signed reasoning is stripped before sending, so a long signed
    // reasoning trace must NOT count toward the input estimate.
    // M2-her has contextWindow=65_536; ~60k tokens of signed reasoning
    // would otherwise exceed the window and throw.
    const longSignedReasoning = 'r'.repeat(400_000);

    expect(() =>
      handlePayload({
        messages: [
          {
            content: 'short reply',
            reasoning: { content: longSignedReasoning, signature: 'sig-1' },
            role: 'assistant',
          },
          { content: 'next', role: 'user' },
        ],
        model: 'M2-her',
        temperature: 1,
      } as any),
    ).not.toThrow();
  });

  it('preserves existing message and parameter handling', () => {
    const result = handlePayload({
      messages: [
        {
          content: 'reply',
          reasoning: { content: 'thought', signature: undefined },
          role: 'assistant',
        },
        { content: 'next', role: 'user' },
      ],
      model: 'MiniMax-M2.7',
      temperature: 0,
      top_p: 0.9,
    } as any);

    // Reasoning content without a signature should become reasoning_details.
    expect(result.messages[0].reasoning_details).toEqual([
      {
        format: 'MiniMax-response-v1',
        id: 'reasoning-text-0',
        index: 0,
        text: 'thought',
        type: 'reasoning.text',
      },
    ]);
    // Temperature <= 0 is dropped because MiniMax rejects it.
    expect(result.temperature).toBeUndefined();
    // Reasoning split is always enabled.
    expect(result.reasoning_split).toBe(true);
  });
});

describe('LobeMinimaxAI - handleError', () => {
  it('converts MaxTokensExceededError into ExceededContextWindow', () => {
    const error = new MaxTokensExceededError({
      contextWindowTokens: 204_800,
      estimatedInputTokens: 200_000,
      minOutputTokens: 1024,
      modelId: 'MiniMax-M2.7',
    });

    const result = handleError!(error);

    expect(result).toBeDefined();
    expect(result!.errorType).toBe(AgentRuntimeErrorType.ExceededContextWindow);
    expect(result!.message).toContain('context window');
    expect((result!.error as any).estimatedInputTokens).toBe(200_000);
    expect((result!.error as any).modelId).toBe('MiniMax-M2.7');
  });

  it('passes through unrelated errors', () => {
    const result = handleError!(new Error('boom'));
    expect(result).toBeUndefined();
  });
});
