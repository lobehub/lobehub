import { type LobeOpenAICompatibleRuntime } from '@lobechat/model-runtime';
import {
  LobeAnthropicAI,
  LobeAzureOpenAI,
  LobeBedrockAI,
  LobeDeepSeekAI,
  LobeGoogleAI,
  LobeGroq,
  LobeMistralAI,
  LobeMoonshotAI,
  LobeOllamaAI,
  LobeOpenAI,
  LobeOpenRouterAI,
  LobePerplexityAI,
  LobeQwenAI,
  LobeTogetherAI,
  LobeZeroOneAI,
  LobeZhipuAI,
  ModelRuntime,
} from '@lobechat/model-runtime';
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeWithClientStore } from './clientModelRuntime';

// Mocking external dependencies
vi.mock('i18next', () => ({
  t: vi.fn((key) => `translated_${key}`),
}));

vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.resolve(new Response(JSON.stringify({ some: 'data' })))),
);

vi.mock('@lobechat/fetch-sse', async (importOriginal) => {
  const module = await importOriginal();

  return { ...(module as any), getMessageError: vi.fn() };
});

// Mock image processing utilities
vi.mock('@/utils/url', () => ({
  isDesktopLocalStaticServerUrl: vi.fn(),
}));

vi.mock('@/utils/imageToBase64', () => ({
  imageUrlToBase64: vi.fn(),
}));

vi.mock('@lobechat/model-runtime', async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...(actual as any),
    parseDataUri: vi.fn(),
  };
});

// Mock version constants
vi.mock('@/const/version', () => ({
  isServerMode: false,
  isDeprecatedEdition: true,
  isDesktop: false,
}));

// Helper function to mock aiInfra store with provider keyVaults
const mockProviderKeyVaults = async (provider: string, keyVaults: any) => {
  const { useAiInfraStore } = await import('@/store/aiInfra');
  // @ts-ignore
  useAiInfraStore.setState((state) => ({
    aiProviderRuntimeConfig: {
      ...state.aiProviderRuntimeConfig,
      [provider]: {
        keyVaults,
      },
    },
  }));
};

afterEach(async () => {
  vi.restoreAllMocks();
  // Clean up store state
  const { useAiInfraStore } = await import('@/store/aiInfra');
  useAiInfraStore.setState({ aiProviderRuntimeConfig: {} } as any);
});

beforeEach(async () => {
  // Reset all mocks
  vi.clearAllMocks();

  // Set default mock return values for image processing utilities
  const { isDesktopLocalStaticServerUrl } = await import('@/utils/url');
  const { imageUrlToBase64 } = await import('@/utils/imageToBase64');
  const { parseDataUri } = await import('@lobechat/model-runtime');

  vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
  vi.mocked(isDesktopLocalStaticServerUrl).mockReturnValue(false);
  vi.mocked(imageUrlToBase64).mockResolvedValue({
    base64: 'mock-base64',
    mimeType: 'image/jpeg',
  });
});

describe('ModelRuntimeOnClient', () => {
  describe('initializeWithClientStore', () => {
    describe('should initialize with options correctly', () => {
      it('OpenAI provider: with apikey and endpoint', async () => {
        await mockProviderKeyVaults(ModelProvider.OpenAI, {
          apiKey: 'user-openai-key',
          baseURL: 'user-openai-endpoint',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.OpenAI,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeOpenAI);
        expect(runtime['_runtime'].baseURL).toBe('user-openai-endpoint');
      });

      it('Azure provider: with apiKey, apiVersion, endpoint', async () => {
        await mockProviderKeyVaults(ModelProvider.Azure, {
          apiKey: 'user-azure-key',
          endpoint: 'user-azure-endpoint',
          apiVersion: '2024-06-01',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Azure,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeAzureOpenAI);
      });

      it('Google provider: with apiKey', async () => {
        await mockProviderKeyVaults(ModelProvider.Google, {
          apiKey: 'user-google-key',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Google,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeGoogleAI);
      });

      it('Moonshot AI provider: with apiKey', async () => {
        await mockProviderKeyVaults(ModelProvider.Moonshot, {
          apiKey: 'user-moonshot-key',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Moonshot,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeMoonshotAI);
      });

      it('Bedrock provider: with accessKeyId, region, secretAccessKey', async () => {
        await mockProviderKeyVaults(ModelProvider.Bedrock, {
          accessKeyId: 'user-bedrock-access-key',
          region: 'user-bedrock-region',
          secretAccessKey: 'user-bedrock-secret',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Bedrock,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeBedrockAI);
      });

      it('Ollama provider: with endpoint', async () => {
        await mockProviderKeyVaults(ModelProvider.Ollama, {
          baseURL: 'http://127.0.0.1:1234',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Ollama,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeOllamaAI);
      });

      it('Perplexity provider: with apiKey', async () => {
        await mockProviderKeyVaults(ModelProvider.Perplexity, {
          apiKey: 'user-perplexity-key',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Perplexity,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobePerplexityAI);
      });

      it('Anthropic provider: with apiKey', async () => {
        await mockProviderKeyVaults(ModelProvider.Anthropic, {
          apiKey: 'user-anthropic-key',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Anthropic,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeAnthropicAI);
      });

      it('Mistral provider: with apiKey', async () => {
        await mockProviderKeyVaults(ModelProvider.Mistral, {
          apiKey: 'user-mistral-key',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Mistral,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeMistralAI);
      });

      it('OpenRouter provider: with apiKey', async () => {
        await mockProviderKeyVaults(ModelProvider.OpenRouter, {
          apiKey: 'user-openrouter-key',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.OpenRouter,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeOpenRouterAI);
      });

      it('TogetherAI provider: with apiKey', async () => {
        await mockProviderKeyVaults(ModelProvider.TogetherAI, {
          apiKey: 'user-togetherai-key',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.TogetherAI,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeTogetherAI);
      });

      it('ZeroOneAI provider: with apiKey', async () => {
        await mockProviderKeyVaults(ModelProvider.ZeroOne, {
          apiKey: 'user-zeroone-key',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.ZeroOne,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeZeroOneAI);
      });

      it('Groq provider: with apiKey,endpoint', async () => {
        await mockProviderKeyVaults(ModelProvider.Groq, {
          apiKey: 'user-groq-key',
          baseURL: 'user-groq-endpoint',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Groq,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        const lobeOpenAICompatibleInstance = runtime['_runtime'] as LobeOpenAICompatibleRuntime;
        expect(lobeOpenAICompatibleInstance).toBeInstanceOf(LobeGroq);
        expect(lobeOpenAICompatibleInstance.baseURL).toBe('user-groq-endpoint');
        expect(lobeOpenAICompatibleInstance.client).toBeInstanceOf(OpenAI);
        expect(lobeOpenAICompatibleInstance.client.apiKey).toBe('user-groq-key');
      });

      it('DeepSeek provider: with apiKey', async () => {
        await mockProviderKeyVaults(ModelProvider.DeepSeek, {
          apiKey: 'user-deepseek-key',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.DeepSeek,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeDeepSeekAI);
      });

      it('Qwen provider: with apiKey', async () => {
        await mockProviderKeyVaults(ModelProvider.Qwen, {
          apiKey: 'user-qwen-key',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Qwen,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeQwenAI);
      });

      /**
       * Should not have a unknown provider in client, but has
       * similar cases in server side
       */
      it('Unknown provider: with apiKey', async () => {
        const { useAiInfraStore } = await import('@/store/aiInfra');
        // @ts-ignore
        useAiInfraStore.setState((state) => ({
          aiProviderRuntimeConfig: {
            ...state.aiProviderRuntimeConfig,
            unknown: {
              keyVaults: {
                apiKey: 'user-unknown-key',
                baseURL: 'user-unknown-endpoint',
              },
              settings: {
                sdkType: 'openai',
              },
            },
          },
        }));

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: 'unknown' as ModelProvider,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeOpenAI);
      });

      /**
       * The following test cases need to be enforce
       */

      it('ZhiPu AI provider: with apiKey', async () => {
        // Mock the generateApiToken function
        vi.mock('@/libs/model-runtime/zhipu/authToken', () => ({
          generateApiToken: vi
            .fn()
            .mockResolvedValue(
              'eyJhbGciOiJIUzI1NiIsInNpZ25fdHlwZSI6IlNJR04iLCJ0eXAiOiJKV1QifQ.eyJhcGlfa2V5IjoiemhpcHUiLCJleHAiOjE3MTU5MTc2NzMsImlhdCI6MTcxMzMyNTY3M30.gt8o-hUDvJFPJLYcH4EhrT1LAmTXI8YnybHeQjpD9oM',
            ),
        }));

        await mockProviderKeyVaults(ModelProvider.ZhiPu, {
          apiKey: 'zhipu.user-key',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.ZhiPu,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeZhipuAI);
      });
    });
  });
});
