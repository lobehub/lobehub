// @vitest-environment node
import OpenAI from 'openai';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LobeMoonshotAI,
  LobeMoonshotAnthropicAI,
  LobeMoonshotOpenAI,
  anthropicParams,
  params,
} from './index';

const defaultOpenAIBaseURL = 'https://api.moonshot.ai/v1';
const anthropicBaseURL = 'https://api.moonshot.ai/anthropic';

// Mock the console.error and console.warn to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('LobeMoonshotAI', () => {
  describe('RouterRuntime baseURL routing', () => {
    it('should route to OpenAI format by default', async () => {
      const runtime = new LobeMoonshotAI({ apiKey: 'test' });
      expect(runtime).toBeInstanceOf(LobeMoonshotAI);
    });

    it('should route to OpenAI format when baseURL ends with /v1', async () => {
      const runtime = new LobeMoonshotAI({
        apiKey: 'test',
        baseURL: 'https://api.moonshot.ai/v1',
      });
      expect(runtime).toBeInstanceOf(LobeMoonshotAI);
    });

    it('should route to Anthropic format when baseURL ends with /anthropic', async () => {
      const runtime = new LobeMoonshotAI({
        apiKey: 'test',
        baseURL: 'https://api.moonshot.ai/anthropic',
      });
      expect(runtime).toBeInstanceOf(LobeMoonshotAI);
    });

    it('should route to Anthropic format when baseURL ends with /anthropic/', async () => {
      const runtime = new LobeMoonshotAI({
        apiKey: 'test',
        baseURL: 'https://api.moonshot.ai/anthropic/',
      });
      expect(runtime).toBeInstanceOf(LobeMoonshotAI);
    });
  });

  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_MOONSHOT_CHAT_COMPLETION;
      const result = anthropicParams.debug!.chatCompletion!();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_MOONSHOT_CHAT_COMPLETION = '1';
      const result = anthropicParams.debug!.chatCompletion!();
      expect(result).toBe(true);
      delete process.env.DEBUG_MOONSHOT_CHAT_COMPLETION;
    });
  });
});

describe('LobeMoonshotOpenAI', () => {
  let instance: InstanceType<typeof LobeMoonshotOpenAI>;

  const getLastRequestPayload = () => {
    const calls = ((instance as any).client.chat.completions.create as Mock).mock.calls;
    return calls[calls.length - 1]?.[0];
  };

  beforeEach(() => {
    instance = new LobeMoonshotOpenAI({ apiKey: 'test' });

    vi.spyOn((instance as any).client.chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    it('should correctly initialize with an API key', async () => {
      const runtime = new LobeMoonshotOpenAI({ apiKey: 'test_api_key' });
      expect(runtime).toBeInstanceOf(LobeMoonshotOpenAI);
      expect((runtime as any).baseURL).toEqual(defaultOpenAIBaseURL);
    });
  });

  describe('handlePayload', () => {
    describe('empty assistant messages', () => {
      it('should replace empty string assistant message with a space', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: '', role: 'assistant' },
            { content: 'Follow-up', role: 'user' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(assistantMessage?.content).toBe(' ');
      });

      it('should replace null content assistant message with a space', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: null as any, role: 'assistant' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(assistantMessage?.content).toBe(' ');
      });

      it('should not modify non-empty assistant messages', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: 'I am here', role: 'assistant' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(assistantMessage?.content).toBe('I am here');
      });
    });

    describe('web search functionality', () => {
      it('should add web_search tool when enabledSearch is true', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
          enabledSearch: true,
        });

        const payload = getLastRequestPayload();

        expect(payload.tools).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'builtin_function',
              function: { name: '$web_search' },
            }),
          ]),
        );
      });

      it('should not add web_search tool when enabledSearch is false', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
          enabledSearch: false,
        });

        const payload = getLastRequestPayload();
        expect(payload.tools).toBeUndefined();
      });
    });

    describe('temperature normalization', () => {
      it('should normalize temperature (divide by 2)', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0.8,
        });

        const payload = getLastRequestPayload();
        expect(payload.temperature).toBe(0.4);
      });

      it('should normalize temperature to 0.5 when temperature is 1', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 1,
        });

        const payload = getLastRequestPayload();
        expect(payload.temperature).toBe(0.5);
      });

      it('should normalize temperature to 0 when temperature is 0', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        const payload = getLastRequestPayload();
        expect(payload.temperature).toBe(0);
      });

      it('should handle kimi-k2.5 model with thinking enabled by default', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2.5',
          temperature: 0.5,
          top_p: 0.8,
        });

        const payload = getLastRequestPayload();
        expect(payload.temperature).toBe(1);
        expect(payload.top_p).toBe(0.95);
        expect(payload.frequency_penalty).toBe(0);
        expect(payload.presence_penalty).toBe(0);
        expect(payload.thinking).toEqual({ type: 'enabled' });
      });

      it('should handle kimi-k2.5 model with thinking disabled', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2.5',
          thinking: { budget_tokens: 0, type: 'disabled' },
        });

        const payload = getLastRequestPayload();
        expect(payload.temperature).toBe(0.6);
        expect(payload.thinking).toEqual({ type: 'disabled' });
      });
    });

    describe('interleaved thinking', () => {
      it('should convert reasoning to reasoning_content for assistant messages', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            {
              content: 'Response',
              role: 'assistant',
              reasoning: { content: 'My reasoning process' },
            } as any,
          ],
          model: 'moonshot-v1-8k',
          temperature: 0.5,
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(assistantMessage?.reasoning_content).toBe('My reasoning process');
        expect(assistantMessage?.reasoning).toBeUndefined();
      });
    });
  });
});

describe('LobeMoonshotAnthropicAI', () => {
  let instance: InstanceType<typeof LobeMoonshotAnthropicAI>;

  const getLastRequestPayload = () => {
    const calls = ((instance as any).client.messages.create as Mock).mock.calls;
    return calls[calls.length - 1]?.[0];
  };

  beforeEach(() => {
    instance = new LobeMoonshotAnthropicAI({ apiKey: 'test' });

    vi.spyOn((instance as any).client.messages, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    it('should correctly initialize with an API key', async () => {
      const runtime = new LobeMoonshotAnthropicAI({ apiKey: 'test_api_key' });
      expect(runtime).toBeInstanceOf(LobeMoonshotAnthropicAI);
      expect((runtime as any).baseURL).toEqual(anthropicBaseURL);
    });
  });

  describe('handlePayload', () => {
    describe('empty assistant messages', () => {
      it('should replace empty string assistant message with a space', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: '', role: 'assistant' },
            { content: 'Follow-up', role: 'user' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([expect.objectContaining({ text: ' ' })]),
        );
      });
    });

    describe('web search functionality', () => {
      it('should add web_search tool when enabledSearch is true', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
          enabledSearch: true,
        });

        const payload = getLastRequestPayload();

        expect(payload.tools).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'builtin_function',
              function: { name: '$web_search' },
            }),
          ]),
        );
      });
    });

    describe('temperature normalization', () => {
      it('should normalize temperature (divide by 2)', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0.8,
        });

        const payload = getLastRequestPayload();
        expect(payload.temperature).toBe(0.4);
      });
    });

    describe('kimi-k2.5 thinking support', () => {
      it('should add thinking params for kimi-k2.5 model', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2.5',
          temperature: 0.5,
        });

        const payload = getLastRequestPayload();

        expect(payload.thinking).toEqual({
          budget_tokens: 1024,
          type: 'enabled',
        });
        expect(payload.temperature).toBe(1);
        expect(payload.top_p).toBe(0.95);
      });

      it('should disable thinking when type is disabled', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2.5',
          temperature: 0.5,
          thinking: { budget_tokens: 0, type: 'disabled' },
        });

        const payload = getLastRequestPayload();

        expect(payload.thinking).toEqual({ type: 'disabled' });
        expect(payload.temperature).toBe(0.6);
      });

      it('should respect custom thinking budget', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2.5',
          max_tokens: 4096,
          thinking: { budget_tokens: 2048, type: 'enabled' },
        });

        const payload = getLastRequestPayload();

        expect(payload.thinking).toEqual({
          budget_tokens: 2048,
          type: 'enabled',
        });
      });

      it('should not add thinking params for non-kimi-k2.5 models', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0.5,
        });

        const payload = getLastRequestPayload();

        expect(payload.thinking).toBeUndefined();
      });
    });
  });
});

describe('models', () => {
  const fetchModels = params.models as (params: { client: OpenAI }) => Promise<any[]>;

  it('should use OpenAI client to fetch models', async () => {
    const mockClient = {
      models: {
        list: vi.fn().mockResolvedValue({
          data: [{ id: 'moonshot-v1-8k' }, { id: 'moonshot-v1-32k' }],
        }),
      },
    } as unknown as OpenAI;

    const models = await fetchModels({ client: mockClient });

    expect(mockClient.models.list).toHaveBeenCalled();
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('moonshot-v1-8k');
  });

  it('should handle empty model list', async () => {
    const mockClient = {
      models: {
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
    } as unknown as OpenAI;

    const models = await fetchModels({ client: mockClient });

    expect(models).toEqual([]);
  });

  it('should handle fetch error gracefully', async () => {
    const mockClient = {
      models: {
        list: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    } as unknown as OpenAI;

    const models = await fetchModels({ client: mockClient });

    expect(models).toEqual([]);
  });
});
