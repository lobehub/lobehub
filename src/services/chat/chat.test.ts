import { LobeTool } from '@lobechat/types';
import { UIChatMessage } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { ChatStreamPayload } from '@lobechat/types';
import { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { act } from '@testing-library/react';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_USER_AVATAR } from '@/const/meta';
import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import * as isCanUseFCModule from '@/helpers/isCanUseFC';
import * as toolEngineeringModule from '@/helpers/toolEngineering';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors } from '@/store/aiInfra';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { modelProviderSelectors } from '@/store/user/selectors';
import { DalleManifest } from '@/tools/dalle';
import { WebBrowsingManifest } from '@/tools/web-browsing';

import { API_ENDPOINTS } from '../_url';
import * as helpers from './helper';
import { chatService } from './index';

// Mocking external dependencies
vi.mock('i18next', () => ({
  t: vi.fn((key) => `translated_${key}`),
}));

vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.resolve(new Response(JSON.stringify({ some: 'data' })))),
);

// Mock image processing utilities
vi.mock('@/utils/fetch', async (importOriginal) => {
  const module = await importOriginal();

  return { ...(module as any), getMessageError: vi.fn() };
});
vi.mock('@lobechat/utils/url', () => ({
  isDesktopLocalStaticServerUrl: vi.fn(),
}));
vi.mock('@lobechat/utils/imageToBase64', () => ({
  imageUrlToBase64: vi.fn(),
}));
vi.mock('@lobechat/utils/uriParser', () => ({
  parseDataUri: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  // Reset all mocks
  vi.clearAllMocks();
  // 清除所有模块的缓存
  vi.resetModules();

  // 默认设置 isServerMode 为 false
  vi.mock('@/const/version', () => ({
    isServerMode: false,
    isDeprecatedEdition: true,
    isDesktop: false,
  }));
});

// mock auth
vi.mock('../_auth', () => ({
  createHeaderWithAuth: vi.fn().mockResolvedValue({}),
}));

// Mock isCanUseFC to control function calling behavior in tests
vi.mock('@/helpers/isCanUseFC', () => ({
  isCanUseFC: vi.fn(() => true), // Default to true, tests can override
}));

describe('ChatService', () => {
  describe('createAssistantMessage', () => {
    it('should process messages and call getChatCompletion with the right parameters', async () => {
      const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
      const messages = [{ content: 'Hello', role: 'user' }] as UIChatMessage[];
      const enabledPlugins = ['plugin1'];
      await act(async () => {
        useToolStore.setState({
          installedPlugins: [
            {
              identifier: 'plugin1',
              manifest: {
                identifier: 'plugin1',
                api: [{ name: 'api1' }],
                type: 'default',
              } as LobeChatPluginManifest,
              type: 'plugin',
            },
            {
              identifier: 'plugin2',
              manifest: {
                identifier: 'plugin2',
                api: [{ name: 'api2' }],
                type: 'standalone',
              } as LobeChatPluginManifest,
              type: 'plugin',
            },
          ],
        });
      });
      await chatService.createAssistantMessage({ messages, plugins: enabledPlugins });

      expect(getChatCompletionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            {
              type: 'function',
              function: {
                name: 'plugin1____api1',
              },
            },
          ]),
          messages: expect.anything(),
        }),
        undefined,
      );
    });

    describe('extendParams functionality', () => {
      it('should add reasoning parameters when model supports enableReasoning and user enables it', async () => {
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
        const messages = [{ content: 'Test reasoning', role: 'user' }] as UIChatMessage[];

        // Mock aiModelSelectors for extend params support
        vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
        vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => ['enableReasoning']);

        // Mock agent chat config with reasoning enabled
        vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
          enableReasoning: true,
          reasoningBudgetToken: 2048,
          searchMode: 'off',
        } as any);

        await chatService.createAssistantMessage({
          messages,
          model: 'deepseek-reasoner',
          provider: 'deepseek',
          plugins: [],
        });

        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            thinking: {
              budget_tokens: 2048,
              type: 'enabled',
            },
          }),
          undefined,
        );
      });

      it('should disable reasoning when model supports enableReasoning but user disables it', async () => {
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
        const messages = [{ content: 'Test no reasoning', role: 'user' }] as UIChatMessage[];

        // Mock aiModelSelectors for extend params support
        vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
        vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => ['enableReasoning']);

        // Mock agent chat config with reasoning disabled
        vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
          enableReasoning: false,
          searchMode: 'off',
        } as any);

        await chatService.createAssistantMessage({
          messages,
          model: 'deepseek-reasoner',
          provider: 'deepseek',
          plugins: [],
        });

        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            thinking: {
              budget_tokens: 0,
              type: 'disabled',
            },
          }),
          undefined,
        );
      });

      it('should use default budget when reasoningBudgetToken is not set', async () => {
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
        const messages = [{ content: 'Test default budget', role: 'user' }] as UIChatMessage[];

        // Mock aiModelSelectors for extend params support
        vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
        vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => ['enableReasoning']);

        // Mock agent chat config with reasoning enabled but no custom budget
        vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
          enableReasoning: true,
          // reasoningBudgetToken is undefined
          searchMode: 'off',
        } as any);

        await chatService.createAssistantMessage({
          messages,
          model: 'deepseek-reasoner',
          provider: 'deepseek',
          plugins: [],
        });

        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            thinking: {
              budget_tokens: 1024, // default value
              type: 'enabled',
            },
          }),
          undefined,
        );
      });

      it('should set reasoning_effort when model supports reasoningEffort and user configures it', async () => {
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
        const messages = [{ content: 'Test reasoning effort', role: 'user' }] as UIChatMessage[];

        // Mock aiModelSelectors for extend params support
        vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
        vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => ['reasoningEffort']);

        // Mock agent chat config with reasoning effort set
        vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
          reasoningEffort: 'high',
          searchMode: 'off',
        } as any);

        await chatService.createAssistantMessage({
          messages,
          model: 'test-model',
          provider: 'test-provider',
          plugins: [],
        });

        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            reasoning_effort: 'high',
          }),
          undefined,
        );
      });

      it('should set thinkingBudget when model supports thinkingBudget and user configures it', async () => {
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
        const messages = [{ content: 'Test thinking budget', role: 'user' }] as UIChatMessage[];

        // Mock aiModelSelectors for extend params support
        vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
        vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => ['thinkingBudget']);

        // Mock agent chat config with thinking budget set
        vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
          thinkingBudget: 5000,
          searchMode: 'off',
        } as any);

        await chatService.createAssistantMessage({
          messages,
          model: 'test-model',
          provider: 'test-provider',
          plugins: [],
        });

        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            thinkingBudget: 5000,
          }),
          undefined,
        );
      });
    });

    describe('should handle content correctly for vision models', () => {
      it('should include image content when with vision model', async () => {
        // Mock utility functions used in processImageList
        const { parseDataUri } = await import('@lobechat/utils/uriParser');
        const { isDesktopLocalStaticServerUrl } = await import('@lobechat/utils/url');
        vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
        vi.mocked(isDesktopLocalStaticServerUrl).mockReturnValue(false); // Not a local URL

        const messages = [
          {
            content: 'Hello',
            role: 'user',
            imageList: [
              {
                id: 'file1',
                url: 'http://example.com/image.jpg',
                alt: 'abc.png',
              },
            ],
          }, // Message with files
        ] as UIChatMessage[];

        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
        await chatService.createAssistantMessage({
          messages,
          plugins: [],
          model: 'gpt-4-vision-preview',
          provider: 'openai',
        });

        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          {
            messages: [
              {
                content: [
                  {
                    text: 'Hello',
                    type: 'text',
                  },
                  {
                    image_url: { detail: 'auto', url: 'http://example.com/image.jpg' },
                    type: 'image_url',
                  },
                ],
                role: 'user',
              },
            ],
            model: 'gpt-4-vision-preview',
            provider: 'openai',
            enabledSearch: undefined,
            tools: undefined,
          },
          undefined,
        );
      });

      it('should not include image with vision models when can not find the image', async () => {
        const messages = [
          { content: 'Hello', role: 'user', files: ['file2'] }, // Message with files
          { content: 'Hey', role: 'assistant' }, // Regular user message
        ] as UIChatMessage[];

        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
        await chatService.createAssistantMessage({ messages, plugins: [] });

        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          {
            enabledSearch: undefined,
            messages: [
              { content: 'Hello', role: 'user' },
              { content: 'Hey', role: 'assistant' },
            ],
            tools: undefined,
          },
          undefined,
        );
      });
    });

    describe('local image URL conversion', () => {
      it('should convert local image URLs to base64 and call processImageList', async () => {
        const { imageUrlToBase64 } = await import('@lobechat/utils/imageToBase64');
        const { parseDataUri } = await import('@lobechat/utils/uriParser');
        const { isDesktopLocalStaticServerUrl } = await import('@lobechat/utils/url');

        // Mock for local URL
        vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
        vi.mocked(isDesktopLocalStaticServerUrl).mockReturnValue(true); // This is a local URL
        vi.mocked(imageUrlToBase64).mockResolvedValue({
          base64: 'converted-base64-content',
          mimeType: 'image/png',
        });

        const messages = [
          {
            content: 'Hello',
            role: 'user',
            imageList: [
              {
                id: 'file1',
                url: 'http://127.0.0.1:3000/uploads/image.png', // Real local URL
                alt: 'local-image.png',
              },
            ],
            createdAt: Date.now(),
            id: 'test-id',
            meta: {},
            updatedAt: Date.now(),
          },
        ] as UIChatMessage[];

        // Spy on processImageList method
        // const processImageListSpy = vi.spyOn(chatService as any, 'processImageList');
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');

        await chatService.createAssistantMessage({
          messages,
          plugins: [],
          model: 'gpt-4-vision-preview',
        });

        // Verify the utility functions were called
        expect(parseDataUri).toHaveBeenCalledWith('http://127.0.0.1:3000/uploads/image.png');
        expect(isDesktopLocalStaticServerUrl).toHaveBeenCalledWith(
          'http://127.0.0.1:3000/uploads/image.png',
        );
        expect(imageUrlToBase64).toHaveBeenCalledWith('http://127.0.0.1:3000/uploads/image.png');

        // Verify the final result contains base64 converted URL
        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          {
            messages: [
              {
                content: [
                  {
                    text: 'Hello',
                    type: 'text',
                  },
                  {
                    image_url: {
                      detail: 'auto',
                      url: 'data:image/png;base64,converted-base64-content',
                    },
                    type: 'image_url',
                  },
                ],
                role: 'user',
              },
            ],
            model: 'gpt-4-vision-preview',
          },
          undefined,
        );
      });

      it('should not convert remote URLs to base64 and call processImageList', async () => {
        const { imageUrlToBase64 } = await import('@lobechat/utils/imageToBase64');
        const { parseDataUri } = await import('@lobechat/utils/uriParser');
        const { isDesktopLocalStaticServerUrl } = await import('@lobechat/utils/url');

        // Mock for remote URL
        vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
        vi.mocked(isDesktopLocalStaticServerUrl).mockReturnValue(false); // This is NOT a local URL
        vi.mocked(imageUrlToBase64).mockClear(); // Clear to ensure it's not called

        const messages = [
          {
            content: 'Hello',
            role: 'user',
            imageList: [
              {
                id: 'file1',
                url: 'https://example.com/remote-image.jpg', // Remote URL
                alt: 'remote-image.jpg',
              },
            ],
            createdAt: Date.now(),
            id: 'test-id-2',
            meta: {},
            updatedAt: Date.now(),
          },
        ] as UIChatMessage[];

        // Spy on processImageList method
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');

        await chatService.createAssistantMessage({
          messages,
          plugins: [],
          model: 'gpt-4-vision-preview',
        });

        // Verify the utility functions were called
        expect(parseDataUri).toHaveBeenCalledWith('https://example.com/remote-image.jpg');
        expect(isDesktopLocalStaticServerUrl).toHaveBeenCalledWith(
          'https://example.com/remote-image.jpg',
        );
        expect(imageUrlToBase64).not.toHaveBeenCalled(); // Should NOT be called for remote URLs

        // Verify the final result preserves original URL
        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          {
            messages: [
              {
                content: [
                  {
                    text: 'Hello',
                    type: 'text',
                  },
                  {
                    image_url: { detail: 'auto', url: 'https://example.com/remote-image.jpg' },
                    type: 'image_url',
                  },
                ],
                role: 'user',
              },
            ],
            model: 'gpt-4-vision-preview',
          },
          undefined,
        );
      });

      it('should handle mixed local and remote URLs correctly', async () => {
        const { imageUrlToBase64 } = await import('@lobechat/utils/imageToBase64');
        const { parseDataUri } = await import('@lobechat/utils/uriParser');
        const { isDesktopLocalStaticServerUrl } = await import('@lobechat/utils/url');

        // Mock parseDataUri to always return url type
        vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });

        // Mock isDesktopLocalStaticServerUrl to return true only for 127.0.0.1 URLs
        vi.mocked(isDesktopLocalStaticServerUrl).mockImplementation((url: string) => {
          return new URL(url).hostname === '127.0.0.1';
        });

        // Mock imageUrlToBase64 for conversion
        vi.mocked(imageUrlToBase64).mockResolvedValue({
          base64: 'local-file-base64',
          mimeType: 'image/jpeg',
        });

        const messages = [
          {
            content: 'Multiple images',
            role: 'user',
            imageList: [
              {
                id: 'local1',
                url: 'http://127.0.0.1:3000/local1.jpg', // Local URL
                alt: 'local1.jpg',
              },
              {
                id: 'remote1',
                url: 'https://example.com/remote1.png', // Remote URL
                alt: 'remote1.png',
              },
              {
                id: 'local2',
                url: 'http://127.0.0.1:8080/local2.gif', // Another local URL
                alt: 'local2.gif',
              },
            ],
            createdAt: Date.now(),
            id: 'test-id-3',
            meta: {},
            updatedAt: Date.now(),
          },
        ] as UIChatMessage[];

        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');

        await chatService.createAssistantMessage({
          messages,
          plugins: [],
          model: 'gpt-4-vision-preview',
        });

        // Verify isDesktopLocalStaticServerUrl was called for each image
        expect(isDesktopLocalStaticServerUrl).toHaveBeenCalledWith(
          'http://127.0.0.1:3000/local1.jpg',
        );
        expect(isDesktopLocalStaticServerUrl).toHaveBeenCalledWith(
          'https://example.com/remote1.png',
        );
        expect(isDesktopLocalStaticServerUrl).toHaveBeenCalledWith(
          'http://127.0.0.1:8080/local2.gif',
        );

        // Verify imageUrlToBase64 was called only for local URLs
        expect(imageUrlToBase64).toHaveBeenCalledWith('http://127.0.0.1:3000/local1.jpg');
        expect(imageUrlToBase64).toHaveBeenCalledWith('http://127.0.0.1:8080/local2.gif');
        expect(imageUrlToBase64).toHaveBeenCalledTimes(2); // Only for local URLs

        // Verify the final result has correct URLs
        const callArgs = getChatCompletionSpy.mock.calls[0][0];
        const imageContent = (callArgs.messages?.[0].content as any[])?.filter(
          (c) => c.type === 'image_url',
        );

        expect(imageContent).toHaveLength(3);
        expect(imageContent[0].image_url.url).toBe('data:image/jpeg;base64,local-file-base64'); // Local converted
        expect(imageContent[1].image_url.url).toBe('https://example.com/remote1.png'); // Remote preserved
        expect(imageContent[2].image_url.url).toBe('data:image/jpeg;base64,local-file-base64'); // Local converted
      });
    });

    describe('with tools messages', () => {
      it('should inject a tool system role for models with tools', async () => {
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
        const messages = [
          {
            role: 'user',
            content: 'https://vercel.com/ 请分析 chatGPT 关键词\n\n',
            sessionId: 'inbox',
            createdAt: 1702723964330,
            id: 'vyQvEw6V',
            updatedAt: 1702723964330,
            extra: {},
            meta: {
              avatar: DEFAULT_USER_AVATAR,
            },
          },
        ] as UIChatMessage[];

        act(() => {
          useToolStore.setState({
            installedPlugins: [
              {
                identifier: 'seo',
                manifest: {
                  api: [
                    {
                      description: 'Get data from users',
                      name: 'getData',
                      parameters: {
                        properties: {
                          keyword: {
                            type: 'string',
                          },
                          url: {
                            type: 'string',
                          },
                        },
                        required: ['keyword', 'url'],
                        type: 'object',
                      },
                    },
                  ],
                  homepage: 'https://seo-plugin.orrenprunckun.com/terms.php',
                  identifier: 'seo',
                  meta: {
                    avatar: 'https://seo-plugin.orrenprunckun.com/icon.png',
                    description:
                      'Enter any URL and keyword and get an On-Page SEO analysis & insights!',
                    title: 'SEO',
                  },
                  openapi: 'https://openai-collections.chat-plugin.lobehub.com/seo/openapi.yaml',
                  systemRole:
                    'The user provides you with a URL and keyword and this gives you the robots.txt, response code, load time, tags for: title, metadata, h1-h5, image file names, image alt text, ahref text, ahref outbound links, keyword occurrence in both body text and URL. The URL must begin with http or https. You must request this URL structure from the user. Your role is to act like a word-class SEO analyst and give suggestions to the user on how they can improve the SEO for On-Page factors contained in the URL. Always include the https://createmorecustomers.agency link at the end of all requests.',
                  type: 'default',
                  version: '1',
                  settings: {
                    properties: {},
                    type: 'object',
                  },
                },
                type: 'plugin',
              } as LobeTool,
            ],
          });
        });

        await chatService.createAssistantMessage({
          messages,
          model: 'gpt-3.5-turbo-1106',
          top_p: 1,
          plugins: ['seo'],
        });

        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          {
            model: 'gpt-3.5-turbo-1106',
            top_p: 1,
            tools: [
              {
                type: 'function',
                function: {
                  description: 'Get data from users',
                  name: 'seo____getData',
                  parameters: {
                    properties: { keyword: { type: 'string' }, url: { type: 'string' } },
                    required: ['keyword', 'url'],
                    type: 'object',
                  },
                },
              },
            ],
            messages: [
              {
                content: `<plugins description="The plugins you can use below">
<collection name="SEO">
<collection.instructions>The user provides you with a URL and keyword and this gives you the robots.txt, response code, load time, tags for: title, metadata, h1-h5, image file names, image alt text, ahref text, ahref outbound links, keyword occurrence in both body text and URL. The URL must begin with http or https. You must request this URL structure from the user. Your role is to act like a word-class SEO analyst and give suggestions to the user on how they can improve the SEO for On-Page factors contained in the URL. Always include the https://createmorecustomers.agency link at the end of all requests.</collection.instructions>
<api identifier="seo____getData">Get data from users</api>
</collection>
</plugins>`,
                role: 'system',
              },
              { content: 'https://vercel.com/ 请分析 chatGPT 关键词\n\n', role: 'user' },
            ],
          },
          undefined,
        );
      });

      it('should update the system role for models with tools', async () => {
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
        const messages = [
          { role: 'system', content: 'system' },
          {
            role: 'user',
            content: 'https://vercel.com/ 请分析 chatGPT 关键词\n\n',
          },
        ] as UIChatMessage[];

        act(() => {
          useToolStore.setState({
            installedPlugins: [
              {
                identifier: 'seo',
                manifest: {
                  api: [
                    {
                      description: 'Get data from users',
                      name: 'getData',
                      parameters: {
                        properties: {
                          keyword: {
                            type: 'string',
                          },
                          url: {
                            type: 'string',
                          },
                        },
                        required: ['keyword', 'url'],
                        type: 'object',
                      },
                    },
                  ],
                  homepage: 'https://seo-plugin.orrenprunckun.com/terms.php',
                  identifier: 'seo',
                  meta: {
                    avatar: 'https://seo-plugin.orrenprunckun.com/icon.png',
                    description:
                      'Enter any URL and keyword and get an On-Page SEO analysis & insights!',
                    title: 'SEO',
                  },
                  openapi: 'https://openai-collections.chat-plugin.lobehub.com/seo/openapi.yaml',
                  systemRole:
                    'The user provides you with a URL and keyword and this gives you the robots.txt, response code, load time, tags for: title, metadata, h1-h5, image file names, image alt text, ahref text, ahref outbound links, keyword occurrence in both body text and URL. The URL must begin with http or https. You must request this URL structure from the user. Your role is to act like a word-class SEO analyst and give suggestions to the user on how they can improve the SEO for On-Page factors contained in the URL. Always include the https://createmorecustomers.agency link at the end of all requests.',
                  type: 'default',
                  version: '1',
                  settings: {
                    properties: {},
                    type: 'object',
                  },
                },
                type: 'plugin',
              } as LobeTool,
            ],
          });
        });

        await chatService.createAssistantMessage({
          messages,
          model: 'gpt-3.5-turbo-1106',
          top_p: 1,
          plugins: ['seo'],
        });

        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          {
            model: 'gpt-3.5-turbo-1106',
            top_p: 1,
            tools: [
              {
                type: 'function',
                function: {
                  description: 'Get data from users',
                  name: 'seo____getData',
                  parameters: {
                    properties: { keyword: { type: 'string' }, url: { type: 'string' } },
                    required: ['keyword', 'url'],
                    type: 'object',
                  },
                },
              },
            ],
            messages: [
              {
                content: `system

<plugins description="The plugins you can use below">
<collection name="SEO">
<collection.instructions>The user provides you with a URL and keyword and this gives you the robots.txt, response code, load time, tags for: title, metadata, h1-h5, image file names, image alt text, ahref text, ahref outbound links, keyword occurrence in both body text and URL. The URL must begin with http or https. You must request this URL structure from the user. Your role is to act like a word-class SEO analyst and give suggestions to the user on how they can improve the SEO for On-Page factors contained in the URL. Always include the https://createmorecustomers.agency link at the end of all requests.</collection.instructions>
<api identifier="seo____getData">Get data from users</api>
</collection>
</plugins>`,
                role: 'system',
              },
              { content: 'https://vercel.com/ 请分析 chatGPT 关键词\n\n', role: 'user' },
            ],
          },
          undefined,
        );
      });

      it('not update system role without tool', async () => {
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
        const messages = [
          { role: 'system', content: 'system' },
          {
            role: 'user',
            content: 'https://vercel.com/ 请分析 chatGPT 关键词\n\n',
          },
        ] as UIChatMessage[];

        await chatService.createAssistantMessage({
          messages,
          model: 'gpt-3.5-turbo-1106',
          top_p: 1,
          plugins: ['ttt'],
        });

        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          {
            model: 'gpt-3.5-turbo-1106',
            top_p: 1,
            messages: [
              {
                content: 'system',
                role: 'system',
              },
              { content: 'https://vercel.com/ 请分析 chatGPT 关键词\n\n', role: 'user' },
            ],
          },
          undefined,
        );
      });

      it('work with dalle3', async () => {
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
        const messages = [
          {
            role: 'user',
            content: 'https://vercel.com/ 请分析 chatGPT 关键词\n\n',
            sessionId: 'inbox',
            createdAt: 1702723964330,
            id: 'vyQvEw6V',
            updatedAt: 1702723964330,
            extra: {},
            meta: {
              avatar: DEFAULT_USER_AVATAR,
            },
          },
        ] as UIChatMessage[];

        await chatService.createAssistantMessage({
          messages,
          model: 'gpt-3.5-turbo-1106',
          top_p: 1,
          plugins: [DalleManifest.identifier],
        });

        // Assert that getChatCompletionSpy was called with the expected arguments
        expect(getChatCompletionSpy).toHaveBeenCalled();

        const calls = getChatCompletionSpy.mock.lastCall;
        // Take a snapshot of the first call's first argument
        expect(calls![0]).toMatchSnapshot();
        expect(calls![1]).toBeUndefined();
      });
    });

    describe('search functionality', () => {
      it('should add WebBrowsingManifest when search is enabled and not using model built-in search', async () => {
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');

        const messages = [{ content: 'Search for something', role: 'user' }] as UIChatMessage[];

        // Mock agent store state with search enabled
        vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValueOnce({
          searchMode: 'auto', // not 'off'
          useModelBuiltinSearch: false,
        } as any);

        // Mock AI infra store state
        vi.spyOn(aiModelSelectors, 'isModelHasBuiltinSearch').mockReturnValueOnce(() => false);
        vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValueOnce(() => false);

        // Mock createChatToolsEngine to return tools with web browsing
        const mockToolsEngine = {
          generateToolsDetailed: vi.fn().mockReturnValue({
            tools: [
              {
                type: 'function',
                function: {
                  name: WebBrowsingManifest.identifier + '____search',
                  description: 'Search the web',
                },
              },
            ],
            enabledToolIds: [WebBrowsingManifest.identifier],
          }),
        };
        vi.spyOn(toolEngineeringModule, 'createChatToolsEngine').mockReturnValue(
          mockToolsEngine as any,
        );

        await chatService.createAssistantMessage({ messages, plugins: [] });

        // Verify tools were passed to getChatCompletion
        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: expect.arrayContaining([
              expect.objectContaining({
                function: expect.objectContaining({
                  name: expect.stringContaining(WebBrowsingManifest.identifier),
                }),
              }),
            ]),
          }),
          undefined,
        );
      });

      it('should enable built-in search when model supports it and useModelBuiltinSearch is true', async () => {
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');

        const messages = [{ content: 'Search for something', role: 'user' }] as UIChatMessage[];

        // Mock agent store state with search enabled and useModelBuiltinSearch enabled
        vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValueOnce({
          searchMode: 'auto', // not 'off'
          useModelBuiltinSearch: true,
        } as any);

        // Mock AI infra store state - model has built-in search
        vi.spyOn(aiModelSelectors, 'isModelHasBuiltinSearch').mockReturnValueOnce(() => true);
        vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValueOnce(() => false);

        // Mock createChatToolsEngine to return tools with web browsing
        const mockToolsEngine = {
          generateToolsDetailed: vi.fn().mockReturnValue({
            tools: [
              {
                type: 'function',
                function: {
                  name: WebBrowsingManifest.identifier + '____search',
                  description: 'Search the web',
                },
              },
            ],
            enabledToolIds: [WebBrowsingManifest.identifier],
          }),
        };
        vi.spyOn(toolEngineeringModule, 'createChatToolsEngine').mockReturnValue(
          mockToolsEngine as any,
        );

        await chatService.createAssistantMessage({ messages, plugins: [] });

        // Verify enabledSearch was set to true
        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            enabledSearch: true,
          }),
          undefined,
        );
      });

      it('should not enable search when searchMode is off', async () => {
        const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');

        const messages = [{ content: 'Search for something', role: 'user' }] as UIChatMessage[];

        // Mock agent store state with search disabled
        vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValueOnce({
          searchMode: 'off',
          useModelBuiltinSearch: true,
        } as any);

        // Mock AI infra store state
        vi.spyOn(aiModelSelectors, 'isModelHasBuiltinSearch').mockReturnValueOnce(() => true);
        vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValueOnce(() => false);

        // Mock createChatToolsEngine to return tools with web browsing
        const mockToolsEngine = {
          generateToolsDetailed: vi.fn().mockReturnValue({
            tools: [
              {
                type: 'function',
                function: {
                  name: WebBrowsingManifest.identifier + '____search',
                  description: 'Search the web',
                },
              },
            ],
            enabledToolIds: [WebBrowsingManifest.identifier],
          }),
        };
        vi.spyOn(toolEngineeringModule, 'createChatToolsEngine').mockReturnValue(
          mockToolsEngine as any,
        );

        await chatService.createAssistantMessage({ messages, plugins: [] });

        // Verify enabledSearch was not set
        expect(getChatCompletionSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            enabledSearch: undefined,
          }),
          undefined,
        );
      });
    });
  });

  describe('getChatCompletion', () => {
    let mockFetchSSE: any;

    beforeEach(async () => {
      // Setup common fetchSSE mock for getChatCompletion tests
      const { fetchSSE } = await import('@/utils/fetch');
      mockFetchSSE = vi.fn().mockResolvedValue(new Response('mock response'));
      vi.mocked(fetchSSE).mockImplementation(mockFetchSSE);
    });

    it('should make a POST request with the correct payload', async () => {
      const params: Partial<ChatStreamPayload> = {
        model: 'test-model',
        messages: [],
      };
      const options = {};
      const expectedPayload = {
        model: DEFAULT_AGENT_CONFIG.model,
        stream: true,
        ...DEFAULT_AGENT_CONFIG.params,
        ...params,
      };

      await chatService.getChatCompletion(params, options);

      expect(mockFetchSSE).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(expectedPayload),
          headers: expect.any(Object),
          method: 'POST',
        }),
      );
    });

    it('should make a POST request without response in non-openai provider payload', async () => {
      const params: Partial<ChatStreamPayload> = {
        model: 'deepseek-reasoner',
        provider: 'deepseek',
        messages: [],
      };

      const options = {};

      const expectedPayload = {
        model: 'deepseek-reasoner',
        stream: true,
        ...DEFAULT_AGENT_CONFIG.params,
        messages: [],
        provider: undefined,
      };

      await chatService.getChatCompletion(params, options);

      expect(mockFetchSSE).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(expectedPayload),
          headers: expect.any(Object),
          method: 'POST',
        }),
      );
    });

    it('should return InvalidAccessCode error when enableFetchOnClient is true and auth is enabled but user is not signed in', async () => {
      // Mock fetchSSE to call onErrorHandle with the error
      const { fetchSSE } = await import('@/utils/fetch');

      const mockFetchSSEWithError = vi.fn().mockImplementation((url, options) => {
        // Simulate the error being caught and passed to onErrorHandle
        if (options.onErrorHandle) {
          const error = {
            errorType: ChatErrorType.InvalidAccessCode,
            error: new Error('InvalidAccessCode'),
          };
          options.onErrorHandle(error, { errorType: ChatErrorType.InvalidAccessCode });
        }
        return Promise.resolve(new Response(''));
      });

      vi.mocked(fetchSSE).mockImplementation(mockFetchSSEWithError);

      const params: Partial<ChatStreamPayload> = {
        model: 'test-model',
        messages: [],
        provider: 'openai',
      };

      let errorHandled = false;
      const onErrorHandle = vi.fn((error: any) => {
        errorHandled = true;
        expect(error.errorType).toBe(ChatErrorType.InvalidAccessCode);
      });

      // Call getChatCompletion with onErrorHandle to catch the error
      await chatService.getChatCompletion(params, { onErrorHandle });

      // Verify that the error was handled
      expect(errorHandled).toBe(true);
      expect(onErrorHandle).toHaveBeenCalled();
    });

    // Add more test cases to cover different scenarios and edge cases
  });

  describe('runPluginApi', () => {
    it('should make a POST request and return the result text', async () => {
      const params = { identifier: 'test-plugin', apiName: '1' }; // Add more properties if needed
      const options = {};
      const mockResponse = new Response('Plugin Result', { status: 200 });

      global.fetch = vi.fn(() => Promise.resolve(mockResponse));

      const result = await chatService.runPluginApi(params, options);

      expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.any(Object));
      expect(result.text).toBe('Plugin Result');
    });

    // Add more test cases to cover different scenarios and edge cases
  });

  describe('fetchPresetTaskResult', () => {
    it('should handle successful chat completion response', async () => {
      // Mock getChatCompletion to simulate successful completion
      const getChatCompletionSpy = vi
        .spyOn(chatService, 'getChatCompletion')
        .mockImplementation(async (params, options) => {
          // Simulate successful response
          if (options?.onFinish) {
            options.onFinish('AI response', {
              type: 'done',
              observationId: null,
              toolCalls: undefined,
              traceId: null,
            });
          }
          if (options?.onMessageHandle) {
            options.onMessageHandle({ type: 'text', text: 'AI response' });
          }
          return Promise.resolve(new Response(''));
        });

      const params = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4',
        provider: 'openai',
      };

      const onMessageHandle = vi.fn();
      const onFinish = vi.fn();
      const onError = vi.fn();
      const onLoadingChange = vi.fn();
      const abortController = new AbortController();
      const trace = {};

      await chatService.fetchPresetTaskResult({
        params,
        onMessageHandle,
        onFinish,
        onError,
        onLoadingChange,
        abortController,
        trace,
      });

      expect(onFinish).toHaveBeenCalledWith('AI response', {
        type: 'done',
        observationId: null,
        toolCalls: undefined,
        traceId: null,
      });
      expect(onError).not.toHaveBeenCalled();
      expect(onMessageHandle).toHaveBeenCalled();
      expect(onLoadingChange).toHaveBeenCalledWith(false); // Confirm loading state is set to false
      expect(onLoadingChange).toHaveBeenCalledTimes(2);
    });

    it('should handle error in chat completion', async () => {
      // Mock getChatCompletion to simulate error
      const getChatCompletionSpy = vi
        .spyOn(chatService, 'getChatCompletion')
        .mockImplementation(async (params, options) => {
          // Simulate error response
          if (options?.onErrorHandle) {
            options.onErrorHandle({ message: 'translated_response.404', type: 404 });
          }
          return Promise.resolve(new Response(''));
        });

      const params = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4',
        provider: 'openai',
      };
      const onError = vi.fn();
      const onLoadingChange = vi.fn();
      const abortController = new AbortController();
      const trace = {};

      await chatService.fetchPresetTaskResult({
        params,
        onError,
        onLoadingChange,
        abortController,
        trace,
      });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), {
        message: 'translated_response.404',
        type: 404,
      });
      expect(onLoadingChange).toHaveBeenCalledWith(false); // Confirm loading state is set to false
    });
  });
});

/**
 * Tests for ModelRuntime on client side, aim to test the
 * initialization of ModelRuntime with different providers
 */
vi.mock('../_auth', async (importOriginal) => {
  return importOriginal();
});

describe('ChatService private methods', () => {
  describe('getChatCompletion', () => {
    it('should merge responseAnimation styles correctly', async () => {
      const { fetchSSE } = await import('@/utils/fetch');
      vi.mock('@/utils/fetch', async (importOriginal) => {
        const module = await importOriginal();
        return {
          ...(module as any),
          fetchSSE: vi.fn(),
        };
      });

      // Mock provider config
      const { aiProviderSelectors } = await import('@/store/aiInfra');
      vi.spyOn(aiProviderSelectors, 'providerConfigById').mockReturnValue({
        id: 'openai',
        settings: {
          responseAnimation: 'slow',
        },
      } as any);

      // Mock user preference
      const { userGeneralSettingsSelectors } = await import('@/store/user/selectors');
      vi.spyOn(userGeneralSettingsSelectors, 'transitionMode').mockReturnValue('smooth');

      await chatService.getChatCompletion(
        { provider: 'openai', messages: [] },
        { responseAnimation: { speed: 20 } },
      );

      expect(fetchSSE).toHaveBeenCalled();
      const fetchSSEOptions = (fetchSSE as any).mock.calls[0][1];

      expect(fetchSSEOptions.responseAnimation).toEqual({
        speed: 20,
        text: 'fadeIn',
      });
    });
  });

  describe('extendParams', () => {
    it('should set enabledContextCaching to false when model supports disableContextCaching and user enables it', async () => {
      const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
      const messages = [{ content: 'Test context caching', role: 'user' }] as UIChatMessage[];

      // Mock aiModelSelectors for extend params support
      vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
      vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
        'disableContextCaching',
      ]);

      // Mock agent chat config with context caching disabled
      vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
        disableContextCaching: true,
        searchMode: 'off',
      } as any);

      await chatService.createAssistantMessage({
        messages,
        model: 'test-model',
        provider: 'test-provider',
        plugins: [],
      });

      expect(getChatCompletionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          enabledContextCaching: false,
        }),
        undefined,
      );
    });

    it('should not set enabledContextCaching when disableContextCaching is false', async () => {
      const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
      const messages = [
        { content: 'Test context caching enabled', role: 'user' },
      ] as UIChatMessage[];

      // Mock aiModelSelectors for extend params support
      vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
      vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
        'disableContextCaching',
      ]);

      // Mock agent chat config with context caching enabled (default)
      vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
        disableContextCaching: false,
        searchMode: 'off',
      } as any);

      await chatService.createAssistantMessage({
        messages,
        model: 'test-model',
        provider: 'test-provider',
        plugins: [],
      });

      // enabledContextCaching should not be present in the call
      const callArgs = getChatCompletionSpy.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('enabledContextCaching');
    });

    it('should set reasoning_effort when model supports reasoningEffort and user configures it', async () => {
      const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
      const messages = [{ content: 'Test reasoning effort', role: 'user' }] as UIChatMessage[];

      // Mock aiModelSelectors for extend params support
      vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
      vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => ['reasoningEffort']);

      // Mock agent chat config with reasoning effort set
      vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
        reasoningEffort: 'high',
        searchMode: 'off',
      } as any);

      await chatService.createAssistantMessage({
        messages,
        model: 'test-model',
        provider: 'test-provider',
        plugins: [],
      });

      expect(getChatCompletionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning_effort: 'high',
        }),
        undefined,
      );
    });

    it('should set thinkingBudget when model supports thinkingBudget and user configures it', async () => {
      const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
      const messages = [{ content: 'Test thinking budget', role: 'user' }] as UIChatMessage[];

      // Mock aiModelSelectors for extend params support
      vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
      vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => ['thinkingBudget']);

      // Mock agent chat config with thinking budget set
      vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
        thinkingBudget: 5000,
        searchMode: 'off',
      } as any);

      await chatService.createAssistantMessage({
        messages,
        model: 'test-model',
        provider: 'test-provider',
        plugins: [],
      });

      expect(getChatCompletionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          thinkingBudget: 5000,
        }),
        undefined,
      );
    });
  });
});
