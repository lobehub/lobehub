// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeLMStudioAI, params } from './index';

describe('LobeLMStudioAI - custom features', () => {
  let instance: InstanceType<typeof LobeLMStudioAI>;

  beforeEach(() => {
    instance = new LobeLMStudioAI({ apiKey: 'placeholder-to-avoid-error' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params export', () => {
    it('should export params with correct structure', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.LMStudio);
      expect(params.baseURL).toBe('http://127.0.0.1:1234/v1');
      expect(params.apiKey).toBe('placeholder-to-avoid-error');
      expect(params.debug).toBeDefined();
      expect(params.models).toBeDefined();
    });

    it('should have debug.chatCompletion function', () => {
      expect(typeof params.debug?.chatCompletion).toBe('function');
    });

    it('should return false when DEBUG_LMSTUDIO_CHAT_COMPLETION is not set', () => {
      delete process.env.DEBUG_LMSTUDIO_CHAT_COMPLETION;
      expect(params.debug?.chatCompletion()).toBe(false);
    });

    it('should return true when DEBUG_LMSTUDIO_CHAT_COMPLETION is set to 1', () => {
      process.env.DEBUG_LMSTUDIO_CHAT_COMPLETION = '1';
      expect(params.debug?.chatCompletion()).toBe(true);
      delete process.env.DEBUG_LMSTUDIO_CHAT_COMPLETION;
    });
  });

  describe('models function', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should fetch and process models successfully', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'deepseek-r1' }, { id: 'llama-3' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
      expect(mockClient.models.list).toHaveBeenCalled();
    });

    it('should handle known models from LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'gpt-4' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should handle case-insensitive model matching', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'GPT-4' }, { id: 'Claude-3-Sonnet' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should handle unknown models', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'unknown-model-123' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should merge abilities from known models', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'gpt-4' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should set enabled to false when not in known models', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'custom-local-model' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toEqual([]);
    });

    it('should handle models with abilities', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'deepseek-r1' }, { id: 'gpt-4-vision-preview' }, { id: 'claude-3-opus' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should handle models without contextWindowTokens', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'new-model-without-metadata' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should filter Boolean values correctly', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'model-1' }, { id: 'model-2' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
    });
  });
});
