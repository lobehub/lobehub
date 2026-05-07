// @vitest-environment node
import { ModelProvider } from 'model-bank';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import type { XAIModelCard } from './index';
import { LobeXAI } from './index';

testProvider({
  Runtime: LobeXAI,
  provider: ModelProvider.XAI,
  defaultBaseURL: 'https://api.x.ai/v1',
  chatDebugEnv: 'DEBUG_XAI_CHAT_COMPLETION',
  responseDebugEnv: 'DEBUG_XAI_RESPONSES',
  chatModel: 'grok',
  test: { useResponsesAPI: true },
});

describe('LobeXAI - custom features', () => {
  let instance: InstanceType<typeof LobeXAI>;

  beforeEach(() => {
    instance = new LobeXAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
    vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(new ReadableStream() as any);
  });

  describe('Responses API routing', () => {
    it('should ignore chatCompletion apiMode and remove camelCase penalty parameters', async () => {
      await instance.chat({
        apiMode: 'chatCompletion',
        frequencyPenalty: 0.4,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-4.20-beta-0309-reasoning',
        presencePenalty: 0.6,
      } as any);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.frequencyPenalty).toBeUndefined();
      expect(createCall.presencePenalty).toBeUndefined();
      expect(createCall.stream).toBe(true);
      expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();
    });

    it('should remove snake_case penalty parameters via forced Responses API', async () => {
      await instance.chat({
        apiMode: 'chatCompletion',
        frequency_penalty: 0.4,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-4-fast-non-reasoning',
        presence_penalty: 0.6,
      } as any);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.frequency_penalty).toBeUndefined();
      expect(createCall.presence_penalty).toBeUndefined();
    });

    it('should remove penalty parameters for Grok 3 models via Responses API', async () => {
      await instance.chat({
        apiMode: 'chatCompletion',
        frequency_penalty: 0.4,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-3',
        presence_penalty: 0.6,
      } as any);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.frequency_penalty).toBeUndefined();
      expect(createCall.presence_penalty).toBeUndefined();
    });

    it('should map chat response_format to Responses API text.format', async () => {
      await instance.chat({
        apiMode: 'chatCompletion',
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-4',
        response_format: {
          json_schema: {
            name: 'answer',
            schema: {
              additionalProperties: false,
              properties: { answer: { type: 'string' } },
              required: ['answer'],
              type: 'object',
            },
            strict: true,
          },
          type: 'json_schema',
        },
      } as any);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.response_format).toBeUndefined();
      expect(createCall.text).toEqual({
        format: {
          name: 'answer',
          schema: {
            additionalProperties: false,
            properties: { answer: { type: 'string' } },
            required: ['answer'],
            type: 'object',
          },
          strict: true,
          type: 'json_schema',
        },
      });
    });
  });

  describe('responses.handlePayload', () => {
    it('should remove unsupported penalty parameters via Responses API', async () => {
      await instance.chat({
        apiMode: 'responses',
        frequency_penalty: 0.4,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-4.3',
        presence_penalty: 0.6,
      } as any);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.frequency_penalty).toBeUndefined();
      expect(createCall.presence_penalty).toBeUndefined();
      expect(createCall.stream).toBe(true);
    });

    it('should remove camelCase penalty parameters for grok-4.20 reasoning variants', async () => {
      await instance.chat({
        apiMode: 'responses',
        frequencyPenalty: 0.4,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-4.20-beta-0309-reasoning',
        presencePenalty: 0.6,
      } as any);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.frequencyPenalty).toBeUndefined();
      expect(createCall.presencePenalty).toBeUndefined();
    });

    it('should add web_search and x_search tools when enabledSearch is true', async () => {
      await instance.chat({
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-2',
        tools: [{ function: { description: 'test', name: 'test' }, type: 'function' as const }],
      });

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(createCall.tools).toEqual([
        { description: 'test', name: 'test', type: 'function' },
        { type: 'web_search' },
        { type: 'x_search' },
      ]);
    });

    it('should add web_search and x_search without existing tools', async () => {
      await instance.chat({
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-2',
      });

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(createCall.tools).toEqual([{ type: 'web_search' }, { type: 'x_search' }]);
    });

    it('should sanitize slash-delimited enum values from function tool schemas', async () => {
      await instance.chat({
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-4.20-beta-0309-reasoning',
        tools: [
          {
            function: {
              description: 'Send an email',
              name: 'gmail____gmail_send_email',
              parameters: {
                additionalProperties: false,
                properties: {
                  mimeType: {
                    default: 'text/plain',
                    enum: ['text/plain', 'text/html', 'multipart/alternative'],
                    type: 'string',
                  },
                  mode: {
                    enum: ['plain', 'html'],
                    type: 'string',
                  },
                },
                required: ['mimeType'],
                type: 'object',
              },
            },
            type: 'function' as const,
          },
        ],
      });

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.tools).toEqual([
        {
          description: 'Send an email',
          name: 'gmail____gmail_send_email',
          parameters: {
            additionalProperties: false,
            properties: {
              mimeType: {
                default: 'text/plain',
                type: 'string',
              },
              mode: {
                enum: ['plain', 'html'],
                type: 'string',
              },
            },
            required: ['mimeType'],
            type: 'object',
          },
          type: 'function',
        },
        { type: 'web_search' },
        { type: 'x_search' },
      ]);
    });
  });

  describe('models', () => {
    it('should fetch and process model list correctly', async () => {
      const mockModelList: XAIModelCard[] = [
        { id: 'grok-2' },
        { id: 'grok-3-mini' },
        { id: 'grok-4' },
      ];

      vi.spyOn(instance['client'].models, 'list').mockResolvedValue({
        data: mockModelList,
      } as any);

      const models = await instance.models();

      expect(instance['client'].models.list).toHaveBeenCalled();
      expect(models.length).toBeGreaterThan(0);
    });
  });
});
