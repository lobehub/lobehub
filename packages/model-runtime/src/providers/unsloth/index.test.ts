// @vitest-environment node
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeUnslothAI, params } from './index';

const provider = ModelProvider.Unsloth;
const defaultBaseURL = 'http://127.0.0.1:8888/v1';

testProvider({
  Runtime: LobeUnslothAI,
  chatDebugEnv: 'DEBUG_UNSLOTH_CHAT_COMPLETION',
  chatModel: 'unsloth/Qwen3-1.7B-GGUF',
  defaultBaseURL,
  provider,
  test: {
    skipAPICall: true,
  },
});

describe('LobeUnslothAI - custom features', () => {
  it('discovers loaded model abilities from server props without a catalog ID match', async () => {
    const client = new OpenAI({
      apiKey: 'test-key',
      baseURL: 'http://localhost:8000/v1',
      fetch: async (input) => {
        const url = String(input);
        return new Response(
          JSON.stringify(
            url.endsWith('/v1/models')
              ? {
                  data: [
                    { id: 'unsloth/Qwen3.8-27B-GGUF', loaded: true, context_length: 214528 },
                    { id: 'unloaded-model', loaded: false },
                  ],
                }
              : {
                  model_path: 'unsloth/Qwen3.8-27B-GGUF',
                  chat_template_caps: {
                    supports_tools: true,
                    supports_tool_calls: true,
                    supports_reasoning_effort: true,
                  },
                  modalities: { vision: true },
                },
          ),
          { headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    const models = await params.models({ client });
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'unsloth/Qwen3.8-27B-GGUF',
          functionCall: true,
          vision: true,
          reasoning: true,
          contextWindowTokens: 214528,
        }),
        expect.objectContaining({ id: 'unloaded-model', functionCall: false, vision: false }),
      ]),
    );
  });

  describe('params export', () => {
    it('should export params with correct structure', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.Unsloth);
      expect(params.baseURL).toBe(defaultBaseURL);
      expect(params.apiKey).toBe('placeholder-to-avoid-error');
      expect(params.debug).toBeDefined();
      expect(params.models).toBeDefined();
    });

    it('should return false when DEBUG_UNSLOTH_CHAT_COMPLETION is not set', () => {
      delete process.env.DEBUG_UNSLOTH_CHAT_COMPLETION;
      expect(params.debug?.chatCompletion()).toBe(false);
    });

    it('should return true when DEBUG_UNSLOTH_CHAT_COMPLETION is set to 1', () => {
      process.env.DEBUG_UNSLOTH_CHAT_COMPLETION = '1';
      expect(params.debug?.chatCompletion()).toBe(true);
      delete process.env.DEBUG_UNSLOTH_CHAT_COMPLETION;
    });
  });

  describe('models function', () => {
    it.each(['http://localhost:8000/proxy/v1', 'http://localhost:8000/proxy/v1/'])(
      'preserves authentication and proxy prefixes for %s',
      async (baseURL) => {
        const fetchMock = vi.fn(async (input, init) => {
          if (String(input).includes('/models'))
            return new Response(
              JSON.stringify({ data: [{ id: 'unsloth/Qwen3-1.7B-GGUF', loaded: true }] }),
              { headers: { 'Content-Type': 'application/json' } },
            );
          expect(String(input)).toBe('http://localhost:8000/proxy/v1/props');
          expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-key');
          return new Response(
            JSON.stringify({
              model_path: 'unsloth/Qwen3-1.7B-GGUF',
              chat_template_caps: {
                supports_tools: false,
                supports_tool_calls: false,
                supports_reasoning_effort: false,
              },
              modalities: { vision: false },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        });
        const client = new OpenAI({ apiKey: 'test-key', baseURL, fetch: fetchMock });
        const models = await params.models({ client });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        // A template can use enable_thinking without supporting reasoning_effort.
        expect(models[0]).toMatchObject({ functionCall: false, reasoning: true, vision: false });
      },
    );

    it('keeps model discovery working when an older server has no props endpoint', async () => {
      const client = new OpenAI({
        apiKey: 'test-key',
        baseURL: 'http://localhost:8000/v1',
        fetch: async (input) =>
          String(input).endsWith('/models')
            ? Response.json({ data: [{ id: 'unsloth/Qwen3-1.7B-GGUF' }] })
            : new Response('{}', { status: 404 }),
      });
      expect(await params.models({ client })).toEqual([
        expect.objectContaining({ id: 'unsloth/Qwen3-1.7B-GGUF', functionCall: true }),
      ]);
    });

    it('does not query resident model props when all listed models are unloaded', async () => {
      const fetchMock = vi.fn(async () =>
        Response.json({ data: [{ id: 'custom', loaded: false }] }),
      );
      const client = new OpenAI({ apiKey: 'test-key', fetch: fetchMock });
      expect(await params.models({ client })).toEqual([
        expect.objectContaining({ id: 'custom', functionCall: false }),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should fetch and enrich known models from LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'unsloth/Qwen3-1.7B-GGUF' }, { id: 'custom-local-model' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(mockClient.models.list).toHaveBeenCalled();
      expect(models).toHaveLength(2);

      const known = models.find((m) => m.id === 'unsloth/Qwen3-1.7B-GGUF');
      expect(known?.displayName).toBe('Qwen3 1.7B');
      expect(known?.functionCall).toBe(true);

      const unknown = models.find((m) => m.id === 'custom-local-model');
      expect(unknown?.enabled).toBe(false);
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({ data: [] }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toEqual([]);
    });
  });
});
