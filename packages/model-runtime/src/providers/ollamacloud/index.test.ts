// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOllamaCloudAI, params } from './index';

describe('LobeOllamaCloudAI', () => {
  let instance: LobeOllamaCloudAI;

  beforeEach(() => {
    vi.clearAllMocks();
    instance = new LobeOllamaCloudAI({ apiKey: 'test_api_key' });
  });

  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      expect(instance).toBeInstanceOf(LobeOllamaCloudAI);
    });

    it('should initialize without an API key (auth optional for Ollama SDK)', () => {
      const instance = new LobeOllamaCloudAI({});
      expect(instance).toBeInstanceOf(LobeOllamaCloudAI);
    });
  });

  describe('params export', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.baseURL).toBe('https://ollama.com');
    });

    it('should have correct structure', () => {
      expect(params).toHaveProperty('debug');
      expect(params.provider).toBe('ollamacloud');
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_OLLAMA_CLOUD_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set to 1', () => {
      process.env.DEBUG_OLLAMA_CLOUD_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
    });

    it('should disable debug when env is set to other values', () => {
      process.env.DEBUG_OLLAMA_CLOUD_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should disable debug when env is empty string', () => {
      process.env.DEBUG_OLLAMA_CLOUD_CHAT_COMPLETION = '';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });
  });
});
