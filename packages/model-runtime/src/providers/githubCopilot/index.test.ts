// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { responsesAPIModels } from '../../const/models';
import * as openAIContextBuilders from '../../core/contextBuilders/openai';
import { LobeGithubCopilotAI } from './index';

// Mock console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LobeGithubCopilotAI', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockFetch.mockReset();
  });

  describe('image payload conversion', () => {
    it('should force image base64 conversion in responses mode', async () => {
      const convertResponseInputsSpy = vi
        .spyOn(openAIContextBuilders, 'convertOpenAIResponseInputs')
        .mockRejectedValue({ status: 400 });

      const futureTime = Date.now() + 600_000;
      const instance = new LobeGithubCopilotAI({
        bearerToken: 'cached-bearer-token',
        bearerTokenExpiresAt: futureTime,
        oauthAccessToken: 'ghu_oauth',
      });

      await expect(
        instance.chat({
          messages: [{ content: 'hello', role: 'user' }],
          model: 'gpt-5.1-codex-mini',
        } as any),
      ).rejects.toBeDefined();

      expect(convertResponseInputsSpy).toHaveBeenCalledWith(expect.any(Array), {
        forceImageBase64: true,
        strictToolPairing: true,
      });
    });

    it('should force image base64 conversion in chat completions mode', async () => {
      const convertMessagesSpy = vi
        .spyOn(openAIContextBuilders, 'convertOpenAIMessages')
        .mockRejectedValue({ status: 400 });

      const futureTime = Date.now() + 600_000;
      const instance = new LobeGithubCopilotAI({
        bearerToken: 'cached-bearer-token',
        bearerTokenExpiresAt: futureTime,
        oauthAccessToken: 'ghu_oauth',
      });

      await expect(
        instance.chat({
          messages: [{ content: 'hello', role: 'user' }],
          model: 'gpt-4o',
        } as any),
      ).rejects.toBeDefined();

      expect(convertMessagesSpy).toHaveBeenCalledWith(expect.any(Array), {
        forceImageBase64: true,
      });
    });
  });

  describe('constructor', () => {
    it('should throw error if no token is provided', () => {
      expect(() => new LobeGithubCopilotAI({})).toThrow();
    });

    it('should accept apiKey as PAT', () => {
      const instance = new LobeGithubCopilotAI({ apiKey: 'ghp_test_pat' });
      expect(instance.baseURL).toBe('https://api.githubcopilot.com');
    });

    it('should accept oauthAccessToken', () => {
      const instance = new LobeGithubCopilotAI({ oauthAccessToken: 'ghu_test_oauth' });
      expect(instance.baseURL).toBe('https://api.githubcopilot.com');
    });

    it('should use cached bearer token if still valid', () => {
      const futureTime = Date.now() + 600_000; // 10 minutes from now
      const instance = new LobeGithubCopilotAI({
        bearerToken: 'cached-bearer-token',
        bearerTokenExpiresAt: futureTime,
        oauthAccessToken: 'ghu_test_oauth',
      });
      expect(instance.baseURL).toBe('https://api.githubcopilot.com');
    });

    it('should not use cached bearer token if expired', () => {
      const pastTime = Date.now() - 600_000; // 10 minutes ago
      const instance = new LobeGithubCopilotAI({
        apiKey: 'ghp_fallback',
        bearerToken: 'expired-bearer-token',
        bearerTokenExpiresAt: pastTime,
      });
      expect(instance.baseURL).toBe('https://api.githubcopilot.com');
    });

    it('should prefer oauthAccessToken over apiKey', () => {
      const instance = new LobeGithubCopilotAI({
        apiKey: 'ghp_pat',
        oauthAccessToken: 'ghu_oauth',
      });
      expect(instance.baseURL).toBe('https://api.githubcopilot.com');
    });
  });

  describe('models', () => {
    it('should fetch available models successfully', async () => {
      // Mock token exchange
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token: 'bearer-token-123',
          }),
        ok: true,
        status: 200,
      });

      // Mock models endpoint
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: [
              { id: 'gpt-4o', name: 'GPT-4o' },
              { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
            ],
          }),
        ok: true,
        status: 200,
      });

      const instance = new LobeGithubCopilotAI({ apiKey: 'ghp_test' });
      const models = await instance.models();

      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        displayName: 'GPT-4o',
        enabled: true,
        id: 'gpt-4o',
        type: 'chat',
      });
      expect(models[1]).toMatchObject({
        displayName: 'Claude 3.5 Sonnet',
        enabled: true,
        id: 'claude-3.5-sonnet',
        type: 'chat',
      });
    });

    it('should use cached bearer token for models request', async () => {
      const futureTime = Date.now() + 600_000;

      // Mock models endpoint only (no token exchange needed)
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: [{ id: 'gpt-4o', name: 'GPT-4o' }],
          }),
        ok: true,
        status: 200,
      });

      const instance = new LobeGithubCopilotAI({
        bearerToken: 'cached-bearer-token',
        bearerTokenExpiresAt: futureTime,
        oauthAccessToken: 'ghu_oauth',
      });

      const models = await instance.models();

      // Should only call fetch once for models (no token exchange)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.githubcopilot.com/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer cached-bearer-token',
          }),
        }),
      );
      expect(models).toHaveLength(1);
    });

    it('should handle empty models response', async () => {
      // Mock token exchange
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token: 'bearer-token-123',
          }),
        ok: true,
        status: 200,
      });

      // Mock empty models response
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({}),
        ok: true,
        status: 200,
      });

      const instance = new LobeGithubCopilotAI({ apiKey: 'ghp_test' });
      const models = await instance.models();

      expect(models).toEqual([]);
    });
  });

  describe('error handling in constructor', () => {
    it('should throw InvalidGithubCopilotToken when no credentials provided', () => {
      expect(() => new LobeGithubCopilotAI({})).toThrow();
    });

    it('should throw with descriptive message', () => {
      try {
        new LobeGithubCopilotAI({});
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.errorType).toBe('InvalidGithubCopilotToken');
      }
    });
  });

  describe('baseURL', () => {
    it('should have correct base URL', () => {
      const instance = new LobeGithubCopilotAI({ apiKey: 'test' });
      expect(instance.baseURL).toBe('https://api.githubcopilot.com');
    });
  });

  describe('responses api routing helpers', () => {
    it('should contain codex mini model in responses api model list', () => {
      expect(responsesAPIModels.has('gpt-5.1-codex-mini')).toBe(true);
    });

    it('should not treat gpt-4o as responses-only model', () => {
      expect(responsesAPIModels.has('gpt-4o')).toBe(false);
    });

    it('should convert chat completion tool to responses tool', () => {
      const instance = new LobeGithubCopilotAI({ apiKey: 'ghp_test' });
      const chatTool = {
        function: {
          description: 'Get weather',
          name: 'get_weather',
          parameters: {
            properties: {
              city: { type: 'string' },
            },
            type: 'object',
          },
        },
        type: 'function',
      };

      const responseTool = (instance as any).convertChatCompletionToolToResponseTool(chatTool);

      expect(responseTool).toEqual({
        description: 'Get weather',
        name: 'get_weather',
        parameters: {
          properties: {
            city: { type: 'string' },
          },
          type: 'object',
        },
        type: 'function',
      });
    });

    it('should map verbosity to responses text.verbosity', async () => {
      vi.resetModules();

      const responsesCreateMock = vi.fn().mockRejectedValue({ status: 500 });

      vi.doMock('openai', () => {
        return {
          default: class MockOpenAI {
            responses = {
              create: responsesCreateMock,
            };
          },
        };
      });

      const { LobeGithubCopilotAI: ReloadedLobeGithubCopilotAI } = await import('./index');

      const futureTime = Date.now() + 600_000;
      const instance = new ReloadedLobeGithubCopilotAI({
        bearerToken: 'cached-bearer-token',
        bearerTokenExpiresAt: futureTime,
        oauthAccessToken: 'ghu_oauth',
      });

      await expect(
        instance.chat({
          messages: [{ content: 'hello', role: 'user' }],
          model: 'gpt-5.1-codex-mini',
          verbosity: 'high',
        } as any),
      ).rejects.toBeDefined();

      expect(responsesCreateMock).toHaveBeenCalledTimes(1);

      const payload = responsesCreateMock.mock.calls[0][0];
      expect(payload.text).toEqual({ verbosity: 'high' });
      expect(payload.verbosity).toBeUndefined();

      vi.doUnmock('openai');
    });
  });

  describe('debug env flags', () => {
    it('should enable chat completion request debug with DEBUG_GITHUBCOPILOT_CHAT_COMPLETION', async () => {
      vi.resetModules();

      const chatCompletionCreateMock = vi.fn().mockRejectedValue({ status: 500 });

      vi.doMock('openai', () => {
        return {
          default: class MockOpenAI {
            chat = {
              completions: {
                create: chatCompletionCreateMock,
              },
            };

            responses = {
              create: vi.fn(),
            };
          },
        };
      });

      process.env.DEBUG_GITHUBCOPILOT_CHAT_COMPLETION = '1';
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { LobeGithubCopilotAI: ReloadedLobeGithubCopilotAI } = await import('./index');

      const futureTime = Date.now() + 600_000;
      const instance = new ReloadedLobeGithubCopilotAI({
        bearerToken: 'cached-bearer-token',
        bearerTokenExpiresAt: futureTime,
        oauthAccessToken: 'ghu_oauth',
      });

      await expect(
        instance.chat({
          messages: [{ content: 'hello', role: 'user' }],
          model: 'gpt-4o',
        } as any),
      ).rejects.toBeDefined();

      expect(chatCompletionCreateMock).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('[requestPayload]');

      delete process.env.DEBUG_GITHUBCOPILOT_CHAT_COMPLETION;
      vi.doUnmock('openai');
    });

    it('should enable responses request debug with DEBUG_GITHUBCOPILOT_RESPONSES', async () => {
      vi.resetModules();

      const responsesCreateMock = vi.fn().mockRejectedValue({ status: 500 });

      vi.doMock('openai', () => {
        return {
          default: class MockOpenAI {
            chat = {
              completions: {
                create: vi.fn(),
              },
            };

            responses = {
              create: responsesCreateMock,
            };
          },
        };
      });

      process.env.DEBUG_GITHUBCOPILOT_RESPONSES = '1';
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { LobeGithubCopilotAI: ReloadedLobeGithubCopilotAI } = await import('./index');

      const futureTime = Date.now() + 600_000;
      const instance = new ReloadedLobeGithubCopilotAI({
        bearerToken: 'cached-bearer-token',
        bearerTokenExpiresAt: futureTime,
        oauthAccessToken: 'ghu_oauth',
      });

      await expect(
        instance.chat({
          messages: [{ content: 'hello', role: 'user' }],
          model: 'gpt-5.1-codex-mini',
        } as any),
      ).rejects.toBeDefined();

      expect(responsesCreateMock).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('[requestPayload]');

      delete process.env.DEBUG_GITHUBCOPILOT_RESPONSES;
      vi.doUnmock('openai');
    });
  });

  describe('anthropic mode for claude models', () => {
    it('should route claude models to anthropic messages API', async () => {
      vi.resetModules();

      const openAIChatCreateMock = vi.fn().mockRejectedValue({ status: 500 });
      const openAIResponsesCreateMock = vi.fn().mockRejectedValue({ status: 500 });
      const anthropicMessagesCreateMock = vi.fn().mockRejectedValue({ status: 500 });
      const anthropicCtorSpy = vi.fn();

      vi.doMock('openai', () => {
        return {
          default: class MockOpenAI {
            chat = {
              completions: {
                create: openAIChatCreateMock,
              },
            };

            responses = {
              create: openAIResponsesCreateMock,
            };
          },
        };
      });

      vi.doMock('@anthropic-ai/sdk', () => {
        return {
          default: class MockAnthropic {
            messages = {
              create: anthropicMessagesCreateMock,
            };

            constructor(options: any) {
              anthropicCtorSpy(options);
            }
          },
        };
      });

      const { LobeGithubCopilotAI: ReloadedLobeGithubCopilotAI } = await import('./index');

      const futureTime = Date.now() + 600_000;
      const instance = new ReloadedLobeGithubCopilotAI({
        bearerToken: 'cached-bearer-token',
        bearerTokenExpiresAt: futureTime,
        oauthAccessToken: 'ghu_oauth',
      });

      await expect(
        instance.chat({
          messages: [{ content: 'hello', role: 'user' }],
          model: 'claude-3.7-sonnet',
        } as any),
      ).rejects.toBeDefined();

      expect(anthropicMessagesCreateMock).toHaveBeenCalledTimes(1);
      expect(openAIChatCreateMock).not.toHaveBeenCalled();
      expect(openAIResponsesCreateMock).not.toHaveBeenCalled();

      expect(anthropicCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.githubcopilot.com',
          defaultHeaders: expect.objectContaining({
            'Authorization': 'Bearer cached-bearer-token',
            'Copilot-Integration-Id': 'vscode-chat',
            'anthropic-version': '2023-06-01',
          }),
        }),
      );

      vi.doUnmock('openai');
      vi.doUnmock('@anthropic-ai/sdk');
    });

    it('should preserve explicit thinking and effort for claude models', async () => {
      vi.resetModules();

      const anthropicMessagesCreateMock = vi.fn().mockRejectedValue({ status: 500 });

      vi.doMock('@anthropic-ai/sdk', () => {
        return {
          default: class MockAnthropic {
            messages = {
              create: anthropicMessagesCreateMock,
            };
          },
        };
      });

      const { LobeGithubCopilotAI: ReloadedLobeGithubCopilotAI } = await import('./index');

      const futureTime = Date.now() + 600_000;
      const instance = new ReloadedLobeGithubCopilotAI({
        bearerToken: 'cached-bearer-token',
        bearerTokenExpiresAt: futureTime,
        oauthAccessToken: 'ghu_oauth',
      });

      await expect(
        instance.chat({
          effort: 'high',
          messages: [{ content: 'hello', role: 'user' }],
          model: 'claude-3.7-sonnet',
          thinking: { budget_tokens: 2048, type: 'enabled' },
        } as any),
      ).rejects.toBeDefined();

      const payload = anthropicMessagesCreateMock.mock.calls[0][0];

      expect(payload.output_config).toEqual({ effort: 'high' });
      expect(payload.thinking).toEqual(
        expect.objectContaining({
          budget_tokens: 2048,
          type: 'enabled',
        }),
      );

      vi.doUnmock('@anthropic-ai/sdk');
    });
  });
});
