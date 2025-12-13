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
  LobeOpenAICompatibleRuntime,
  LobeOpenRouterAI,
  LobePerplexityAI,
  LobeQwenAI,
  LobeTogetherAI,
  LobeZeroOneAI,
  LobeZhipuAI,
  ModelRuntime,
} from '@lobechat/model-runtime';
import { merge } from 'lodash-es';
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserStore } from '@/store/user';
import { UserSettingsState, initialSettingsState } from '@/store/user/slices/settings/initialState';

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

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  // 清除所有模块的缓存
  vi.resetModules();

  // 默认设置 isServerMode 为 false
  vi.mock('@/const/version', () => ({
    isServerMode: false,
    isDeprecatedEdition: true,
    isDesktop: false,
  }));

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
        // Mock the global store to return the user's OpenAI API key and endpoint
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              openai: {
                apiKey: 'user-openai-key',
                baseURL: 'user-openai-endpoint',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.OpenAI,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeOpenAI);
        expect(runtime['_runtime'].baseURL).toBe('user-openai-endpoint');
      });

      it('Azure provider: with apiKey, apiVersion, endpoint', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              azure: {
                apiKey: 'user-azure-key',
                endpoint: 'user-azure-endpoint',
                apiVersion: '2024-06-01',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Azure,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeAzureOpenAI);
      });

      it('Google provider: with apiKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              google: {
                apiKey: 'user-google-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Google,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeGoogleAI);
      });

      it('Moonshot AI provider: with apiKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              moonshot: {
                apiKey: 'user-moonshot-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Moonshot,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeMoonshotAI);
      });

      it('Bedrock provider: with accessKeyId, region, secretAccessKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              bedrock: {
                accessKeyId: 'user-bedrock-access-key',
                region: 'user-bedrock-region',
                secretAccessKey: 'user-bedrock-secret',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Bedrock,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeBedrockAI);
      });

      it('Ollama provider: with endpoint', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              ollama: {
                baseURL: 'http://127.0.0.1:1234',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Ollama,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeOllamaAI);
      });

      it('Perplexity provider: with apiKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              perplexity: {
                apiKey: 'user-perplexity-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Perplexity,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobePerplexityAI);
      });

      it('Anthropic provider: with apiKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              anthropic: {
                apiKey: 'user-anthropic-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Anthropic,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeAnthropicAI);
      });

      it('Mistral provider: with apiKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              mistral: {
                apiKey: 'user-mistral-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Mistral,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeMistralAI);
      });

      it('OpenRouter provider: with apiKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              openrouter: {
                apiKey: 'user-openrouter-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.OpenRouter,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeOpenRouterAI);
      });

      it('TogetherAI provider: with apiKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              togetherai: {
                apiKey: 'user-togetherai-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.TogetherAI,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeTogetherAI);
      });

      it('ZeroOneAI provider: with apiKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              zeroone: {
                apiKey: 'user-zeroone-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.ZeroOne,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeZeroOneAI);
      });

      it('Groq provider: with apiKey,endpoint', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              groq: {
                apiKey: 'user-groq-key',
                baseURL: 'user-groq-endpoint',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
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
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              deepseek: {
                apiKey: 'user-deepseek-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.DeepSeek,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeDeepSeekAI);
      });

      it('Qwen provider: with apiKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              qwen: {
                apiKey: 'user-qwen-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
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
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              unknown: {
                apiKey: 'user-unknown-key',
                endpoint: 'user-unknown-endpoint',
              },
            },
          },
        } as any as UserSettingsState) as unknown as UserStore;
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
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              zhipu: {
                apiKey: 'zhipu.user-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
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
