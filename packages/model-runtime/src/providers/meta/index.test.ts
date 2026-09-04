// @vitest-environment node
import { ModelProvider } from 'model-bank';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeMetaAI } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

const provider = ModelProvider.Meta;
const defaultBaseURL = 'https://api.meta.ai/v1';

testProvider({
  Runtime: LobeMetaAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_META_CHAT_COMPLETION',
  responseDebugEnv: 'DEBUG_META_RESPONSES',
  chatModel: 'muse-spark-1.3',
  test: {
    useResponsesAPI: true,
  },
});

describe('LobeMetaAI - custom features', () => {
  let instance: InstanceType<typeof LobeMetaAI>;

  beforeEach(() => {
    instance = new LobeMetaAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
    vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(new ReadableStream() as any);
  });

  describe('Responses API routing', () => {
    it('should send every request through the Responses API', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'muse-spark-1.3',
        temperature: 1,
      });

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.stream).toBe(true);
      expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();
    });

    it('should ignore a caller-supplied chatCompletion apiMode', async () => {
      await instance.chat({
        apiMode: 'chatCompletion',
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'muse-spark-1.3',
        temperature: 1,
      } as any);

      expect(instance['client'].responses.create).toHaveBeenCalled();
      expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();
    });

    it('should request encrypted reasoning so the chain of thought can be replayed', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'muse-spark-1.3',
        temperature: 1,
      });

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.include).toEqual(['reasoning.encrypted_content']);
      expect(createCall.store).toBe(false);
      expect(createCall.previous_response_id).toBeUndefined();
    });
  });

  describe('generateObject', () => {
    it('should generate structured output through the Responses API', async () => {
      (instance['client'].responses.create as Mock).mockResolvedValue({
        output_text: '{"city":"Hangzhou"}',
      });

      const result = await instance.generateObject({
        messages: [{ content: 'Extract the city', role: 'user' }],
        model: 'muse-spark-1.3',
        schema: {
          name: 'location',
          schema: {
            properties: { city: { type: 'string' } },
            required: ['city'],
            type: 'object',
          },
        },
      });

      const request = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(result).toEqual({ city: 'Hangzhou' });
      expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();
      expect(request.text).toEqual({
        format: {
          name: 'location',
          schema: {
            properties: { city: { type: 'string' } },
            required: ['city'],
            type: 'object',
          },
          strict: true,
          type: 'json_schema',
        },
      });
    });
  });

  describe('responses.handlePayload', () => {
    it('should add the web_search tool alongside existing tools when enabledSearch is true', async () => {
      await instance.chat({
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'muse-spark-1.3',
        temperature: 1,
        tools: [{ function: { description: 'test', name: 'test' }, type: 'function' as const }],
      });

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.tools).toEqual([
        { description: 'test', name: 'test', type: 'function' },
        { type: 'web_search' },
      ]);
    });

    it('should add the web_search tool without existing tools', async () => {
      await instance.chat({
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'muse-spark-1.3',
        temperature: 1,
      });

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.tools).toEqual([{ type: 'web_search' }]);
    });

    it('should leave tools untouched when enabledSearch is not set', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'muse-spark-1.3',
        temperature: 1,
        tools: [{ function: { description: 'test', name: 'test' }, type: 'function' as const }],
      });

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.tools).toEqual([{ description: 'test', name: 'test', type: 'function' }]);
    });

    it('should map a json_schema response_format to text.format', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'muse-spark-1.3',
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
        temperature: 1,
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

    it('should map a json_object response_format to text.format', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'muse-spark-1.3',
        response_format: { type: 'json_object' },
        temperature: 1,
      } as any);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.response_format).toBeUndefined();
      expect(createCall.text).toEqual({ format: { type: 'json_object' } });
    });

    it('should keep an explicit text payload when no response_format is given', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'muse-spark-1.3',
        temperature: 1,
        text: { verbosity: 'low' },
      } as any);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

      expect(createCall.text).toEqual({ verbosity: 'low' });
    });
  });
});
