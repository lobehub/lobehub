// @vitest-environment node
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as debugStreamModule from '../../utils/debugStream';
import { LobeStraicoAI } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const mockFetch = vi.fn();

describe('LobeStraicoAI', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('provider configuration', () => {
    it.each([
      [undefined, 'https://api.straico.com/v0'],
      ['https://proxy.example.com/straico/v0', 'https://proxy.example.com/straico/v0'],
    ])('uses the expected endpoint with baseURL=%s', (baseURL, expectedURL) => {
      const instance = new LobeStraicoAI({ apiKey: 'test', baseURL });

      expect(instance.baseURL).toBe(expectedURL);
      expect(instance.client.baseURL).toBe(expectedURL);
    });

    it('identifies Straico and its endpoint in API errors', async () => {
      const instance = new LobeStraicoAI({ apiKey: 'test' });
      vi.spyOn(instance.client.chat.completions, 'create').mockRejectedValue(
        new OpenAI.APIError(401, { message: 'Unauthorized' }, 'Unauthorized', new Headers()),
      );

      await expect(
        instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'openai/gpt-4o-mini',
        }),
      ).rejects.toMatchObject({
        endpoint: 'https://api.straico.com/v0',
        errorType: 'InvalidProviderAPIKey',
        provider: ModelProvider.Straico,
      });
    });

    it.each([undefined, '0', '1'])(
      'enables non-streaming debug output only for DEBUG_STRAICO_CHAT_COMPLETION=1 (%s)',
      async (value) => {
        vi.stubEnv('DEBUG_STRAICO_CHAT_COMPLETION', value);
        const debugResponse = vi
          .spyOn(debugStreamModule, 'debugResponse')
          .mockImplementation(() => {});
        vi.spyOn(debugStreamModule, 'debugPayload').mockImplementation(() => {});
        const instance = new LobeStraicoAI({ apiKey: 'test' });
        const completion: OpenAI.ChatCompletion = {
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              logprobs: null,
              message: { content: 'Hi', refusal: null, role: 'assistant' },
            },
          ],
          created: 0,
          id: 'test-completion',
          model: 'openai/gpt-4o-mini',
          object: 'chat.completion',
        };
        const create = vi
          .spyOn(instance.client.chat.completions, 'create')
          .mockResolvedValue(completion);

        const response = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'openai/gpt-4o-mini',
          stream: true,
        });
        await response.text();

        expect(create.mock.calls[0][0].stream).toBe(false);
        expect(debugResponse).toHaveBeenCalledTimes(value === '1' ? 1 : 0);
        if (value === '1') expect(debugResponse).toHaveBeenCalledWith(completion);
      },
    );
  });

  describe('models', () => {
    it('should throw a regular Error when the API request fails', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const instance = new LobeStraicoAI({ apiKey: 'test-api-key' });

      await expect(instance.models()).rejects.toThrow('HTTP 401');
    });
  });
});
