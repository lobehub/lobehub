// @vitest-environment node
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeMoonshotAI, params, type MoonshotModelCard } from './index';

const defaultBaseURL = 'https://api.moonshot.ai/anthropic';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: { [key: string]: any };

const getLastRequestPayload = () => {
  const calls = (instance['client'].messages.create as Mock).mock.calls;
  return calls[calls.length - 1]?.[0];
};

beforeEach(() => {
  instance = new LobeMoonshotAI({ apiKey: 'test' });

  vi.spyOn(instance['client'].messages, 'create').mockResolvedValue(new ReadableStream() as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeMoonshotAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', async () => {
      const runtime = new LobeMoonshotAI({ apiKey: 'test_api_key' });
      expect(runtime).toBeInstanceOf(LobeMoonshotAI);
      expect(runtime.baseURL).toEqual(defaultBaseURL);
    });
  });

  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_MOONSHOT_CHAT_COMPLETION;
      const result = params.debug!.chatCompletion!();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_MOONSHOT_CHAT_COMPLETION = '1';
      const result = params.debug!.chatCompletion!();
      expect(result).toBe(true);
      delete process.env.DEBUG_MOONSHOT_CHAT_COMPLETION;
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
        const assistantMessage = payload.messages.find((message: any) => message.role === 'assistant');

        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([expect.objectContaining({ text: ' ' })]),
        );
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
        const assistantMessage = payload.messages.find((message: any) => message.role === 'assistant');

        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([expect.objectContaining({ text: ' ' })]),
        );
      });

      it('should replace undefined content assistant message with a space', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: undefined as any, role: 'assistant' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find((message: any) => message.role === 'assistant');

        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([expect.objectContaining({ text: ' ' })]),
        );
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
        const assistantMessage = payload.messages.find((message: any) => message.role === 'assistant');

        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([expect.objectContaining({ text: 'I am here' })]),
        );
      });

      it('should not modify user or system messages', async () => {
        await instance.chat({
          messages: [
            { content: '', role: 'system' },
            { content: '', role: 'user' },
            { content: '', role: 'assistant' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        const payload = getLastRequestPayload();
        const userMessage = payload.messages.find((message: any) => message.role === 'user');
        const assistantMessage = payload.messages.find((message: any) => message.role === 'assistant');

        expect(payload.system).toBeUndefined();
        expect(userMessage?.content).toBe('');
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

      it('should add web_search tool along with existing tools when enabledSearch is true', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
          enabledSearch: true,
          tools: [
            {
              type: 'function',
              function: { name: 'custom_tool', description: 'A custom tool', parameters: {} },
            },
          ],
        });

        const payload = getLastRequestPayload();

        expect(payload.tools).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'custom_tool' }),
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

      it('should not add web_search tool when enabledSearch is not specified', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
        });

        const payload = getLastRequestPayload();
        expect(payload.tools).toBeUndefined();
      });

      it('should preserve existing tools when enabledSearch is false', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0,
          enabledSearch: false,
          tools: [
            {
              type: 'function',
              function: { name: 'custom_tool', description: 'A custom tool', parameters: {} },
            },
          ],
        });

        const payload = getLastRequestPayload();

        expect(payload.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'custom_tool' })]));
        expect(payload.tools).not.toEqual(
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

      it('should handle high temperature values (2.0 normalized to 1.0)', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 2,
        });

        const payload = getLastRequestPayload();
        expect(payload.temperature).toBe(1);
      });

      it('should normalize negative temperature values', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: -1,
        });

        const payload = getLastRequestPayload();
        expect(payload.temperature).toBe(-0.5);
      });
    });

    describe('other payload properties', () => {
      it('should preserve other payload properties', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'moonshot-v1-8k',
          temperature: 0.5,
          max_tokens: 100,
          top_p: 0.9,
        });

        const payload = getLastRequestPayload();

        expect(payload.max_tokens).toBe(100);
        expect(payload.model).toBe('moonshot-v1-8k');
        expect(payload.temperature).toBe(0.25);
        expect(payload.top_p).toBe(0.9);
        expect(payload.messages).toEqual([
          {
            content: [
              {
                cache_control: { type: 'ephemeral' },
                text: 'Hello',
                type: 'text',
              },
            ],
            role: 'user',
          },
        ]);
      });

      it('should combine all features together', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: '', role: 'assistant' },
            { content: 'Question?', role: 'user' },
          ],
          model: 'moonshot-v1-8k',
          temperature: 0.7,
          max_tokens: 2000,
          enabledSearch: true,
          tools: [
            {
              type: 'function',
              function: { name: 'custom_tool', description: 'A custom tool', parameters: {} },
            },
          ],
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find((message: any) => message.role === 'assistant');

        expect(payload.max_tokens).toBe(2000);
        expect(payload.temperature).toBe(0.35);
        expect(payload.tools).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'custom_tool' }),
            expect.objectContaining({
              type: 'builtin_function',
              function: { name: '$web_search' },
            }),
          ]),
        );
        expect(payload.messages).toHaveLength(3);
        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([expect.objectContaining({ text: ' ' })]),
        );
      });
    });
  });

  describe('models', () => {
    const mockFetchResponse = (data: MoonshotModelCard[]) =>
      Promise.resolve({
        ok: true,
        json: async () => ({ data }),
        status: 200,
        statusText: 'OK',
      } as Response);

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should fetch and process models successfully', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        await mockFetchResponse([
          { id: 'moonshot-v1-8k' },
          { id: 'moonshot-v1-32k' },
          { id: 'moonshot-v1-128k' },
        ]),
      );

      const models = await params.models!({ apiKey: 'test', baseURL: defaultBaseURL, client: {} as any });

      expect(fetchSpy).toHaveBeenCalledWith(`${defaultBaseURL}/v1/models`, {
        headers: {
          Authorization: 'Bearer test',
          'anthropic-version': '2023-06-01',
          'x-api-key': 'test',
        },
        method: 'GET',
      });
      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('moonshot-v1-8k');
      expect(models[1].id).toBe('moonshot-v1-32k');
      expect(models[2].id).toBe('moonshot-v1-128k');

      fetchSpy.mockRestore();
    });

    it('should handle single model', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        await mockFetchResponse([{ id: 'moonshot-v1-8k' }]),
      );

      const models = await params.models!({ apiKey: 'test', baseURL: defaultBaseURL, client: {} as any });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('moonshot-v1-8k');

      fetchSpy.mockRestore();
    });

    it('should handle empty model list', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        await mockFetchResponse([]),
      );

      const models = await params.models!({ apiKey: 'test', baseURL: defaultBaseURL, client: {} as any });

      expect(models).toEqual([]);

      fetchSpy.mockRestore();
    });

    it('should process models with MODEL_LIST_CONFIGS', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        await mockFetchResponse([{ id: 'moonshot-v1-8k' }]),
      );

      const models = await params.models!({ apiKey: 'test', baseURL: defaultBaseURL, client: {} as any });

      expect(models[0]).toHaveProperty('id');
      expect(models[0].id).toBe('moonshot-v1-8k');

      fetchSpy.mockRestore();
    });

    it('should preserve model properties from API response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        await mockFetchResponse([
          { id: 'moonshot-v1-8k', extra_field: 'value' } as MoonshotModelCard,
          { id: 'moonshot-v1-32k', another_field: 123 } as MoonshotModelCard,
        ]),
      );

      const models = await params.models!({ apiKey: 'test', baseURL: defaultBaseURL, client: {} as any });

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('moonshot-v1-8k');
      expect(models[1].id).toBe('moonshot-v1-32k');

      fetchSpy.mockRestore();
    });
  });
});
