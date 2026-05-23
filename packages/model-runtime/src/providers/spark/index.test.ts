// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeSparkAI, params } from './index';

const provider = ModelProvider.Spark;
const defaultBaseURL = 'https://spark-api-open.xf-yun.com/v1';

testProvider({
  Runtime: LobeSparkAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_SPARK_CHAT_COMPLETION',
  chatModel: 'spark',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeSparkAI - custom features', () => {
  describe('params object', () => {
    it('should export params with correct structure', () => {
      expect(params).toBeDefined();
      expect(params.baseURL).toBe(defaultBaseURL);
      expect(params.provider).toBe(ModelProvider.Spark);
      expect(params.chatCompletion).toBeDefined();
      expect(params.debug).toBeDefined();
    });

    it('should have chatCompletion configuration', () => {
      expect(params.chatCompletion?.handlePayload).toBeDefined();
      expect(params.chatCompletion?.handleStream).toBeDefined();
      expect(params.chatCompletion?.handleTransformResponseToStream).toBeDefined();
      expect(params.chatCompletion?.noUserId).toBe(true);
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_SPARK_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set to 1', () => {
      process.env.DEBUG_SPARK_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_SPARK_CHAT_COMPLETION;
    });

    it('should disable debug when env is set to other values', () => {
      process.env.DEBUG_SPARK_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
      delete process.env.DEBUG_SPARK_CHAT_COMPLETION;
    });
  });

  describe('handlePayload - web search functionality', () => {
    const handlePayload = params.chatCompletion!.handlePayload!;

    it('should not add web_search tool when enabledSearch is false', () => {
      const payload = {
        model: 'spark',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        enabledSearch: false,
      };

      const result = handlePayload(payload, {});

      expect(result.tools).toBeUndefined();
      expect(result.enabledSearch).toBeUndefined();
    });

    it('should not add web_search tool when enabledSearch is undefined', () => {
      const payload = {
        model: 'spark',
        messages: [{ role: 'user' as const, content: 'Hello' }],
      };

      const result = handlePayload(payload, {});

      expect(result.tools).toBeUndefined();
    });

    it('should add web_search tool when enabledSearch is true', () => {
      const payload = {
        model: 'spark',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        enabledSearch: true,
      };

      const result = handlePayload(payload, {});

      expect(result.tools).toBeDefined();
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toMatchObject({
        type: 'web_search',
        web_search: {
          enable: true,
          search_mode: 'normal',
        },
      });
    });

    it('should use normal search mode by default', () => {
      delete process.env.SPARK_SEARCH_MODE;

      const payload = {
        model: 'spark',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        enabledSearch: true,
      };

      const result = handlePayload(payload, {});

      expect(result.tools[0].web_search.search_mode).toBe('normal');
    });

    it('should use custom search mode from env', () => {
      process.env.SPARK_SEARCH_MODE = 'deep';

      const payload = {
        model: 'spark',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        enabledSearch: true,
      };

      const result = handlePayload(payload, {});

      expect(result.tools[0].web_search.search_mode).toBe('deep');
      delete process.env.SPARK_SEARCH_MODE;
    });

    it('should preserve existing tools when adding web_search', () => {
      const existingTools = [
        {
          type: 'function' as const,
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      const payload = {
        model: 'spark',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        enabledSearch: true,
        tools: existingTools,
      };

      const result = handlePayload(payload, {});

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0]).toEqual(existingTools[0]);
      expect(result.tools[1].type).toBe('web_search');
    });

    it('should preserve existing tools when enabledSearch is false', () => {
      const existingTools = [
        {
          type: 'function' as const,
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      const payload = {
        model: 'spark',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        enabledSearch: false,
        tools: existingTools,
      };

      const result = handlePayload(payload, {});

      expect(result.tools).toEqual(existingTools);
    });

    it('should not include enabledSearch in result payload', () => {
      const payload = {
        model: 'spark',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        enabledSearch: true,
      };

      const result = handlePayload(payload, {});

      expect(result.enabledSearch).toBeUndefined();
    });

    it('should preserve other payload properties', () => {
      const payload = {
        model: 'spark',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 0.9,
        enabledSearch: true,
      };

      const result = handlePayload(payload, {});

      expect(result.model).toBe('spark');
      expect(result.messages).toEqual(payload.messages);
      expect(result.temperature).toBe(0.7);
      expect(result.max_tokens).toBe(1000);
      expect(result.top_p).toBe(0.9);
    });

    it('should handle empty tools array with enabledSearch', () => {
      const payload = {
        model: 'spark',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        enabledSearch: true,
        tools: [],
      };

      const result = handlePayload(payload, {});

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].type).toBe('web_search');
    });

    it('should handle multiple existing tools with enabledSearch', () => {
      const existingTools = [
        {
          type: 'function' as const,
          function: {
            name: 'tool1',
            description: 'Tool 1',
            parameters: { type: 'object', properties: {} },
          },
        },
        {
          type: 'function' as const,
          function: {
            name: 'tool2',
            description: 'Tool 2',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      const payload = {
        model: 'spark',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        enabledSearch: true,
        tools: existingTools,
      };

      const result = handlePayload(payload, {});

      expect(result.tools).toHaveLength(3);
      expect(result.tools[0]).toEqual(existingTools[0]);
      expect(result.tools[1]).toEqual(existingTools[1]);
      expect(result.tools[2].type).toBe('web_search');
    });
  });

  describe('stream configuration', () => {
    it('should configure SparkAIStream as handleStream', async () => {
      const { SparkAIStream } = await import('../../core/streams/spark');
      expect(params.chatCompletion?.handleStream).toBe(SparkAIStream);
    });

    it('should configure transformSparkResponseToStream', async () => {
      const { transformSparkResponseToStream } = await import('../../core/streams/spark');
      expect(params.chatCompletion?.handleTransformResponseToStream).toBe(
        transformSparkResponseToStream,
      );
    });
  });

  describe('noUserId option', () => {
    it('should set noUserId to true', () => {
      expect(params.chatCompletion?.noUserId).toBe(true);
    });
  });

  describe('runtime instantiation', () => {
    it('should create instance with default baseURL', () => {
      const instance = new LobeSparkAI({ apiKey: 'test-api-key' });
      expect(instance).toBeDefined();
      expect(instance.baseURL).toBe(defaultBaseURL);
    });

    it('should create instance with custom baseURL', () => {
      const customBaseURL = 'https://custom.spark.com/v1';
      const instance = new LobeSparkAI({ apiKey: 'test-api-key', baseURL: customBaseURL });
      expect(instance).toBeDefined();
      expect(instance.baseURL).toBe(customBaseURL);
    });

    it('should create instance with custom headers', () => {
      const instance = new LobeSparkAI({
        apiKey: 'test-api-key',
        headers: { 'X-Custom-Header': 'value' },
      });
      expect(instance).toBeDefined();
    });
  });
});
