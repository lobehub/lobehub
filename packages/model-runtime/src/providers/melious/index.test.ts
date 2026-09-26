// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { DEFAULT_MELIOUS_BASE_URL, LobeMeliousAI, params } from './index';

const provider = ModelProvider.Melious;

testProvider({
  Runtime: LobeMeliousAI,
  chatDebugEnv: 'DEBUG_MELIOUS_CHAT_COMPLETION',
  chatModel: 'qwen3.5-9b',
  defaultBaseURL: DEFAULT_MELIOUS_BASE_URL,
  provider,
  test: {
    skipAPICall: true,
  },
});

const meliousModel = (id: string, meta: Record<string, any>) => ({ _meta: meta, id });

describe('LobeMeliousAI - custom features', () => {
  describe('params export', () => {
    it('should export params with the expected structure', () => {
      expect(params.provider).toBe(ModelProvider.Melious);
      expect(params.baseURL).toBe('https://api.melious.ai/v1');
      expect(params.debug).toBeDefined();
      expect(params.models).toBeDefined();
    });

    it('should not override the chat payload', () => {
      // Melious accepts the stock OpenAI chat payload, so there is nothing to transform.
      expect((params as any).chatCompletion).toBeUndefined();
    });
  });

  describe('models function', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      global.fetch = vi.fn();
    });

    const mockFetch = (body: unknown) => {
      (global.fetch as any).mockResolvedValue({ json: async () => body, ok: true });
    };

    const client = { apiKey: 'test-key', baseURL: DEFAULT_MELIOUS_BASE_URL } as any;

    it('should request the catalog with include_meta', async () => {
      mockFetch({ data: [] });

      await params.models!({ client });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.melious.ai/v1/models?include_meta=true',
        {
          headers: { Accept: 'application/json', Authorization: 'Bearer test-key' },
          method: 'GET',
        },
      );
    });

    it('should strip a trailing slash from a custom baseURL', async () => {
      mockFetch({ data: [] });

      await params.models!({
        client: { apiKey: 'k', baseURL: 'https://proxy.example/v1/' } as any,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://proxy.example/v1/models?include_meta=true',
        expect.anything(),
      );
    });

    it('should keep only chat models', async () => {
      // Melious serves every model type from the same endpoint; only `_meta.type` separates them.
      mockFetch({
        data: [
          meliousModel('qwen3.5-9b', { type: 'chat' }),
          meliousModel('bge-m3', { type: 'embeddings' }),
          meliousModel('flux-1-dev', { type: 'image' }),
          meliousModel('whisper-large-v3', { type: 'audio' }),
          meliousModel('qwen3guard-gen-8b', { type: 'guardrail' }),
        ],
      });

      const models = await params.models!({ client });

      expect(models.map((model) => model.id)).toEqual(['qwen3.5-9b']);
    });

    it('should treat a model without _meta as chat', async () => {
      mockFetch({ data: [{ id: 'glm-5.3' }] });

      const models = await params.models!({ client });

      expect(models.map((model) => model.id)).toEqual(['glm-5.3']);
    });

    it('should derive vision and video from input modalities', async () => {
      mockFetch({
        data: [
          meliousModel('qwen3.6-27b', {
            input_modalities: ['text', 'image', 'video'],
            type: 'chat',
          }),
          meliousModel('gpt-oss-120b', { input_modalities: ['text'], type: 'chat' }),
        ],
      });

      const models = await params.models!({ client });

      expect(models.find((model) => model.id === 'qwen3.6-27b')).toMatchObject({
        video: true,
        vision: true,
      });
      expect(models.find((model) => model.id === 'gpt-oss-120b')).toMatchObject({
        video: false,
        vision: false,
      });
    });

    it('should map reasoning_type onto the reasoning ability and the effort control', async () => {
      mockFetch({
        data: [
          meliousModel('minimax-m2.5', { reasoning_type: 'reasoning', type: 'chat' }),
          meliousModel('glm-5.3', { reasoning_type: 'hybrid', type: 'chat' }),
          meliousModel('apertus-70b', { reasoning_type: 'non_reasoning', type: 'chat' }),
        ],
      });

      const models = await params.models!({ client });
      const byId = (id: string) => models.find((model) => model.id === id);

      expect(byId('minimax-m2.5')?.reasoning).toBe(true);
      expect(byId('glm-5.3')?.reasoning).toBe(true);
      expect(byId('apertus-70b')?.reasoning).toBe(false);

      // `reasoning_effort` is low|medium|high with no off state, so the slider is the right control.
      expect(byId('glm-5.3')?.settings?.extendParams).toEqual(['reasoningEffort']);
      expect(byId('apertus-70b')?.settings?.extendParams).toBeUndefined();
    });

    it('should distinguish an absent capability from an explicit false', async () => {
      // The catalog populates `capabilities` sparsely: some models omit `function_calling`
      // rather than reporting it as false. Only an explicit false should suppress the
      // ability; an absent key falls back to the model bank.
      mockFetch({
        data: [
          meliousModel('qwen2.5-vl-72b-instruct', {
            capabilities: { streaming: true, vision: true },
            type: 'chat',
          }),
          meliousModel('apertus-70b', {
            capabilities: { function_calling: false, streaming: true },
            type: 'chat',
          }),
        ],
      });

      const models = await params.models!({ client });

      expect(models.find((model) => model.id === 'apertus-70b')?.functionCall).toBe(false);
      expect(models.find((model) => model.id === 'qwen2.5-vl-72b-instruct')?.functionCall).toBe(
        true,
      );
    });

    it('should carry context window, max output and release date', async () => {
      mockFetch({
        data: [
          meliousModel('devstral-2-123b-instruct-2512', {
            capabilities: { function_calling: true },
            context_length: 200_000,
            max_output_tokens: 8192,
            release_date: '2025-12-09',
            type: 'chat',
          }),
        ],
      });

      const [model] = await params.models!({ client });

      expect(model).toMatchObject({
        contextWindowTokens: 200_000,
        functionCall: true,
        maxOutput: 8192,
        releasedAt: '2025-12-09',
      });
    });

    it('should tolerate null metadata values', async () => {
      // The catalog returns `null` (not an absent key) for most `max_output_tokens`.
      mockFetch({
        data: [
          meliousModel('a-model-absent-from-the-model-bank', {
            context_length: null,
            max_output_tokens: null,
            release_date: null,
            type: 'chat',
          }),
        ],
      });

      const [model] = await params.models!({ client });

      expect(model.contextWindowTokens).toBeUndefined();
      expect(model.maxOutput).toBeUndefined();
    });

    it('should fall back to the model bank when metadata is missing', async () => {
      mockFetch({ data: [meliousModel('kimi-k3', { context_length: null, type: 'chat' })] });

      const [model] = await params.models!({ client });

      expect(model.contextWindowTokens).toBeGreaterThan(0);
      expect(model.displayName).toBe('Kimi K3');
    });

    it('should handle a missing data field', async () => {
      mockFetch({});

      await expect(params.models!({ client })).resolves.toEqual([]);
    });

    it('should surface fetch errors', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(params.models!({ client })).rejects.toThrow(
        'Failed to fetch Melious models: 401 Unauthorized',
      );
    });
  });
});
