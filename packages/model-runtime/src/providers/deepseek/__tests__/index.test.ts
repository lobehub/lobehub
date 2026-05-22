// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  LobeDeepSeekAI,
  LobeDeepSeekAnthropicAI,
  LobeDeepSeekOpenAI,
  openAIParams,
} from '../index';
import { anthropicBaseURL, defaultOpenAIBaseURL } from './testUtils';

describe('LobeDeepSeekAI', () => {
  const createRuntime = ({
    baseURL,
    sdkType,
  }: {
    baseURL?: string;
    sdkType?: string;
  } = {}) =>
    new LobeDeepSeekAI({
      apiKey: 'test',
      ...(baseURL ? { baseURL } : {}),
      ...(sdkType ? { sdkType } : {}),
    });

  const resolveRouter = async (baseURL?: string, sdkType?: string) => {
    const runtime = createRuntime({ baseURL, sdkType });

    return (runtime as any).resolveMatchedRouter('deepseek-v4-pro');
  };

  const resolveFirstRouterOption = async (baseURL: string, sdkType: string) => {
    const runtime = createRuntime({ baseURL, sdkType });
    const router = await (runtime as any).resolveMatchedRouter('deepseek-v4-pro');
    const routerOptions = (runtime as any).normalizeRouterOptions(router);

    return {
      option: routerOptions[0],
      router,
    };
  };

  describe('RouterRuntime baseURL routing', () => {
    it('should route to Anthropic format by default', async () => {
      const router = await resolveRouter();

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('anthropic-compatible');
    });

    it('should route to Anthropic format when baseURL ends with /anthropic', async () => {
      const router = await resolveRouter(anthropicBaseURL);

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('anthropic-compatible');
    });

    it('should route to Anthropic format when baseURL ends with /anthropic/', async () => {
      const router = await resolveRouter(`${anthropicBaseURL}/`);

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('anthropic-compatible');
    });

    it('should route to OpenAI format when baseURL ends with /v1', async () => {
      const router = await resolveRouter(defaultOpenAIBaseURL);

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('openai-compatible');
    });

    it('should route custom non-Anthropic baseURL to OpenAI format', async () => {
      const router = await resolveRouter('https://api.deepseek.com');

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('openai-compatible');
    });

    it('should route to Anthropic format when sdkType is anthropic', async () => {
      const router = await resolveRouter('https://aihubmix.com/v1/messages', 'anthropic');

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('anthropic-compatible');
    });

    it('should normalize /v1/messages before creating an Anthropic SDK runtime', async () => {
      const { option } = await resolveFirstRouterOption(
        'https://aihubmix.com/v1/messages',
        'anthropic',
      );
      const runtime = new LobeDeepSeekAnthropicAI({ apiKey: 'test', baseURL: option.baseURL });

      expect(option.baseURL).toBe('https://aihubmix.com');
      expect(runtime).toBeInstanceOf(LobeDeepSeekAnthropicAI);
      expect((runtime as any).baseURL).toBe('https://aihubmix.com');
    });

    it('should let Anthropic-compatible runtime normalize /v1 baseURL', async () => {
      const { option } = await resolveFirstRouterOption('https://aihubmix.com/v1', 'anthropic');
      const runtime = new LobeDeepSeekAnthropicAI({ apiKey: 'test', baseURL: option.baseURL });

      expect(option.baseURL).toBe('https://aihubmix.com/v1');
      expect(runtime).toBeInstanceOf(LobeDeepSeekAnthropicAI);
      expect((runtime as any).baseURL).toBe('https://aihubmix.com');
    });

    it('should normalize /anthropic/v1/messages before creating an Anthropic SDK runtime', async () => {
      const { option } = await resolveFirstRouterOption(
        'https://api.deepseek.com/anthropic/v1/messages',
        'anthropic',
      );
      const runtime = new LobeDeepSeekAnthropicAI({ apiKey: 'test', baseURL: option.baseURL });

      expect(option.baseURL).toBe(anthropicBaseURL);
      expect(runtime).toBeInstanceOf(LobeDeepSeekAnthropicAI);
      expect((runtime as any).baseURL).toBe(anthropicBaseURL);
    });

    it('should let sdkType override legacy baseURL suffix routing', async () => {
      const router = await resolveRouter(anthropicBaseURL, 'openai');

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('openai-compatible');
    });

    it('should reject unsupported sdkType values', async () => {
      await expect(resolveRouter(defaultOpenAIBaseURL, 'invalid')).rejects.toThrow(
        'Unsupported DeepSeek sdkType: invalid',
      );
    });
  });
});

describe('LobeDeepSeekOpenAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      const runtime = new LobeDeepSeekOpenAI({ apiKey: 'test_api_key' });

      expect(runtime).toBeInstanceOf(LobeDeepSeekOpenAI);
      expect((runtime as any).baseURL).toEqual(defaultOpenAIBaseURL);
    });
  });
});

describe('LobeDeepSeekAnthropicAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      const runtime = new LobeDeepSeekAnthropicAI({ apiKey: 'test_api_key' });

      expect(runtime).toBeInstanceOf(LobeDeepSeekAnthropicAI);
      expect((runtime as any).baseURL).toEqual(anthropicBaseURL);
    });
  });
});

describe('Debug Configuration', () => {
  it('should disable debug by default', () => {
    delete process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION;
    const result = openAIParams.debug.chatCompletion();
    expect(result).toBe(false);
  });

  it('should enable debug when env is set', () => {
    process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION = '1';
    const result = openAIParams.debug.chatCompletion();
    expect(result).toBe(true);
    delete process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION;
  });
});
