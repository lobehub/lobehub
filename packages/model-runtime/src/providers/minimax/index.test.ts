// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { ContextExceededPreFlightError } from '../../utils/resolveSafeMaxTokens';
import {
  anthropicParams,
  LobeMinimaxAI,
  LobeMinimaxAnthropicAI,
  LobeMinimaxOpenAI,
  openAIParams,
} from './index';

const loadModelsMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue([
    {
      id: 'abab6.5s-chat',
      providerId: 'minimax',
    },
    {
      id: 'MiniMax-M3',
      maxOutput: 524_288,
      providerId: 'minimax',
    },
  ]),
);

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const provider = ModelProvider.Minimax;
const defaultOpenAIBaseURL = 'https://api.minimaxi.com/v1';
const anthropicBaseURL = 'https://api.minimax.io/anthropic';

testProvider({
  Runtime: LobeMinimaxOpenAI,
  provider,
  defaultBaseURL: defaultOpenAIBaseURL,
  chatDebugEnv: 'DEBUG_MINIMAX_CHAT_COMPLETION',
  chatModel: 'abab6.5s-chat',
  test: {
    skipAPICall: true,
  },
});

const handlePayload = openAIParams.chatCompletion!.handlePayload!;
const handleAnthropicPayload = anthropicParams.chatCompletion!.handlePayload!;

describe('LobeMinimaxAI', () => {
  const createRuntime = ({
    baseURL,
    sdkType,
  }: {
    baseURL?: string;
    sdkType?: string;
  } = {}) =>
    new LobeMinimaxAI({
      apiKey: 'test',
      ...(baseURL ? { baseURL } : {}),
      ...(sdkType ? { sdkType } : {}),
    });

  const resolveRouter = async (baseURL?: string, sdkType?: string) => {
    const runtime = createRuntime({ baseURL, sdkType });

    return (runtime as any).resolveMatchedRouter('MiniMax-M3');
  };

  const resolveFirstRouterOption = async (baseURL: string, sdkType: string) => {
    const runtime = createRuntime({ baseURL, sdkType });
    const router = await (runtime as any).resolveMatchedRouter('MiniMax-M3');
    const routerOptions = (runtime as any).normalizeRouterOptions(router);

    return {
      option: routerOptions[0],
      router,
    };
  };

  describe('RouterRuntime baseURL routing', () => {
    it('should route to OpenAI format by default', async () => {
      const router = await resolveRouter();

      expect(router.apiType).toBe('openai');
      expect(router.id).toBe('openai-compatible');
      expect(router.runtime).toBe(LobeMinimaxOpenAI);
    });

    it('should route to OpenAI format when baseURL ends with /v1', async () => {
      const router = await resolveRouter(defaultOpenAIBaseURL);

      expect(router.apiType).toBe('openai');
      expect(router.id).toBe('openai-compatible');
      expect(router.runtime).toBe(LobeMinimaxOpenAI);
    });

    it('should route to Anthropic format when baseURL ends with /anthropic', async () => {
      const router = await resolveRouter(anthropicBaseURL);

      expect(router.apiType).toBe('anthropic');
      expect(router.id).toBe('anthropic-compatible');
      expect(router.runtime).toBe(LobeMinimaxAnthropicAI);
    });

    it('should route to Anthropic format when sdkType is anthropic', async () => {
      const router = await resolveRouter(
        'https://api.minimax.io/anthropic/v1/messages',
        'anthropic',
      );

      expect(router.apiType).toBe('anthropic');
      expect(router.id).toBe('anthropic-compatible');
      expect(router.runtime).toBe(LobeMinimaxAnthropicAI);
    });

    it('should normalize /v1/messages before creating an Anthropic SDK runtime', async () => {
      const { option } = await resolveFirstRouterOption(
        'https://api.minimax.io/anthropic/v1/messages',
        'anthropic',
      );
      const runtime = new LobeMinimaxAnthropicAI({ apiKey: 'test', baseURL: option.baseURL });

      expect(option.baseURL).toBe(anthropicBaseURL);
      expect(runtime).toBeInstanceOf(LobeMinimaxAnthropicAI);
      expect((runtime as any).baseURL).toBe(anthropicBaseURL);
    });

    it('should let sdkType override legacy baseURL suffix routing', async () => {
      const router = await resolveRouter(anthropicBaseURL, 'openai');

      expect(router.apiType).toBe('openai');
      expect(router.id).toBe('openai-compatible');
      expect(router.runtime).toBe(LobeMinimaxOpenAI);
    });

    it('should reject unsupported sdkType values', async () => {
      await expect(resolveRouter(defaultOpenAIBaseURL, 'invalid')).rejects.toThrow(
        'Unsupported MiniMax sdkType: invalid',
      );
    });

    it('should pass modelIdMapping to the OpenAI-compatible runtime', async () => {
      const modelIdMapping = { 'minimax-public': 'MiniMax-M3' };
      const chatSpy = vi
        .spyOn(LobeMinimaxOpenAI.prototype as any, 'chat')
        .mockResolvedValue(new Response());

      try {
        const runtime = new LobeMinimaxAI({
          apiKey: 'test',
          modelIdMapping,
          sdkType: 'openai',
        });

        await runtime.chat({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'minimax-public',
        });

        expect((chatSpy.mock.contexts[0] as any).modelIdMappingOptions.modelIdMapping).toEqual(
          modelIdMapping,
        );
      } finally {
        chatSpy.mockRestore();
      }
    });

    it('should pass modelIdMapping to the Anthropic-compatible runtime', async () => {
      const modelIdMapping = { 'minimax-public': 'MiniMax-M3' };
      const chatSpy = vi
        .spyOn(LobeMinimaxAnthropicAI.prototype as any, 'chat')
        .mockResolvedValue(new Response());

      try {
        const runtime = new LobeMinimaxAI({
          apiKey: 'test',
          modelIdMapping,
          sdkType: 'anthropic',
        });

        await runtime.chat({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'minimax-public',
        });

        expect((chatSpy.mock.contexts[0] as any).modelIdMappingOptions.modelIdMapping).toEqual(
          modelIdMapping,
        );
      } finally {
        chatSpy.mockRestore();
      }
    });
  });
});

describe('LobeMinimaxAnthropicAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      const runtime = new LobeMinimaxAnthropicAI({ apiKey: 'test_api_key' });

      expect(runtime).toBeInstanceOf(LobeMinimaxAnthropicAI);
      expect((runtime as any).baseURL).toEqual(anthropicBaseURL);
    });
  });

  it('should derive Anthropic params from logical model while sending mapped model id', async () => {
    const runtime = new LobeMinimaxAnthropicAI({
      apiKey: 'test',
      modelIdMapping: { 'MiniMax-M3': 'upstream-minimax-m3' },
    });
    const createSpy = vi
      .spyOn((runtime as any).client.messages, 'create')
      .mockResolvedValue({ content: [] } as any);

    await runtime.chat({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M3',
      responseMode: 'json',
      stream: false,
    } as any);

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 524_288,
        model: 'upstream-minimax-m3',
      }),
      expect.anything(),
    );
  });
});

describe('LobeMinimaxOpenAI', () => {
  it('should keep MiniMax-M3 payload handling on logical model while sending mapped model id', async () => {
    const runtime = new LobeMinimaxOpenAI({
      apiKey: 'test',
      modelIdMapping: { 'MiniMax-M3': 'upstream-minimax-m3' },
    });
    const createSpy = vi
      .spyOn(runtime['client'].chat.completions, 'create')
      .mockResolvedValue(new ReadableStream() as any);

    await runtime.chat({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M3',
      thinking: { type: 'disabled' },
    } as any);

    const requestPayload = createSpy.mock.calls[0][0] as any;
    expect(requestPayload.model).toBe('upstream-minimax-m3');
    expect(requestPayload).toHaveProperty('max_completion_tokens');
    expect(requestPayload).not.toHaveProperty('max_tokens');
    expect(requestPayload.thinking).toEqual({ type: 'disabled' });
  });
});

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
    // Mimic the scenario: many large tool definitions.
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

  it('throws ContextExceededPreFlightError when no headroom remains', () => {
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
    ).toThrow(ContextExceededPreFlightError);
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
    // Non-M3 MiniMax models keep the existing friendly reasoning format.
    expect(result.reasoning_split).toBe(true);
  });

  it('enables Interleaved Thinking friendly format for MiniMax-M3', () => {
    const result = handlePayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M3',
      max_tokens: 4096,
      n: 2,
      temperature: 0,
      thinking: { budget_tokens: 1024, type: 'enabled' },
      top_p: 1.5,
    } as any);

    expect(result.max_completion_tokens).toBe(4096);
    expect(result.max_tokens).toBeUndefined();
    expect(result.reasoning_split).toBe(true);
    expect(result.preserveThinking).toBeUndefined();
    expect(result.temperature).toBe(0);
    expect(result.thinking).toEqual({ type: 'adaptive' });
    expect(result.top_p).toBe(1);
  });

  it('maps disabled enableReasoning payload to MiniMax-M3 thinking disabled', () => {
    const result = handlePayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M3',
      thinking: { budget_tokens: 0, type: 'disabled' },
    } as any);

    expect(result.thinking).toEqual({ type: 'disabled' });
  });

  it('passes through MiniMax-M3 multimodal user content', () => {
    const content = [
      { text: 'describe this media', type: 'text' },
      { image_url: { url: 'https://example.com/image.png' }, type: 'image_url' },
      { type: 'video_url', video_url: { url: 'https://example.com/video.mp4' } },
    ];

    const result = handlePayload({
      messages: [{ content, role: 'user' }],
      model: 'MiniMax-M3',
    } as any);

    expect(result.messages[0].content).toBe(content);
  });

  it('keeps reasoning_split enabled for non-M3 MiniMax models', () => {
    const result = handlePayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M2.7',
      preserveThinking: false,
    } as any);

    expect(result.reasoning_split).toBe(true);
  });
});

describe('LobeMinimaxAnthropicAI - handlePayload', () => {
  it('normalizes MiniMax sampling params consistently with the OpenAI runtime', async () => {
    const result = await handleAnthropicPayload(
      {
        max_tokens: 4096,
        messages: [{ content: 'hi', role: 'user' }],
        model: 'MiniMax-M3',
        temperature: 1.6,
        top_p: 0.9,
      } as any,
      {} as any,
    );

    expect(result.temperature).toBe(0.8);
    expect(result.top_p).toBe(0.9);
  });

  it('converts assistant reasoning history to Anthropic thinking blocks', async () => {
    const result = await handleAnthropicPayload(
      {
        max_tokens: 4096,
        messages: [
          {
            content: 'answer',
            reasoning: { content: 'thinking history' },
            role: 'assistant',
          },
          { content: 'next', role: 'user' },
        ],
        model: 'MiniMax-M3',
      } as any,
      {} as any,
    );

    expect(result.messages[0]).toEqual({
      content: [
        { thinking: 'thinking history', type: 'thinking' },
        { text: 'answer', type: 'text' },
      ],
      role: 'assistant',
    });
  });
});
