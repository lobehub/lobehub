// @vitest-environment node
import { ModelProvider } from 'model-bank';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import type { OnFinishData } from '../../types';
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
    it.each([true, false])(
      'should preserve every encrypted reasoning item for the next turn (stream=%s)',
      async (stream) => {
        const reasoningItems = ['first', 'second'].map((part) => ({
          encrypted_content: `encrypted-${part}`,
          id: `rs_${part}`,
          summary: [],
          type: 'reasoning' as const,
        }));
        const response = {
          id: 'resp_first',
          model: 'muse-spark-1.3',
          output: [
            ...reasoningItems,
            {
              content: [{ annotations: [], text: 'Paris', type: 'output_text' }],
              id: 'msg_first',
              role: 'assistant',
              status: 'completed',
              type: 'message',
            },
          ],
          status: 'completed',
        };
        const events = [
          ...reasoningItems.map((item, output_index) => ({
            item,
            output_index,
            sequence_number: output_index,
            type: 'response.output_item.done',
          })),
          { delta: 'Paris', type: 'response.output_text.delta' },
          { response, sequence_number: 3, type: 'response.completed' },
        ];
        (instance['client'].responses.create as Mock).mockResolvedValueOnce(
          stream
            ? new ReadableStream({
                start(controller) {
                  events.forEach((event) => controller.enqueue(event));
                  controller.close();
                },
              })
            : response,
        );
        const onFinal = vi.fn<(data: OnFinishData) => void>();
        const firstTurn = await instance.chat(
          {
            messages: [{ content: 'What is the capital of France?', role: 'user' }],
            model: 'muse-spark-1.3',
            stream,
            temperature: 1,
          },
          { callback: { onFinal } },
        );
        await firstTurn.text();

        expect(onFinal).toHaveBeenCalledOnce();
        const completed = onFinal.mock.calls[0][0];
        expect(completed.text).toBe('Paris');
        expect(completed.reasoning?.responseItems).toHaveLength(2);

        await instance.chat({
          messages: [
            { content: 'What is the capital of France?', role: 'user' },
            { content: completed.text, reasoning: completed.reasoning, role: 'assistant' },
            { content: 'What is its population?', role: 'user' },
          ],
          model: 'muse-spark-1.3',
          temperature: 1,
        });

        const request = (instance['client'].responses.create as Mock).mock.calls[1][0];
        expect(request.input).toEqual([
          { content: 'What is the capital of France?', role: 'user' },
          ...reasoningItems,
          { content: 'Paris', role: 'assistant' },
          { content: 'What is its population?', role: 'user' },
        ]);
        expect(request.include).toEqual(['reasoning.encrypted_content']);
        expect(request.store).toBe(false);
        expect(request.previous_response_id).toBeUndefined();
      },
    );

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

  describe('models', () => {
    it('should fetch the Meta model catalog through the SDK models endpoint', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json({
          data: [
            { created: 1788652800, id: 'muse-spark-future', object: 'model', owned_by: 'meta' },
          ],
          object: 'list',
        }),
      );
      const runtime = new LobeMetaAI({ apiKey: 'test_api_key', fetch });

      const models = await runtime.models();

      expect(fetch).toHaveBeenCalledOnce();
      const [input, init] = fetch.mock.calls[0];
      const request = new Request(input, init);
      expect(request.url).toBe('https://api.meta.ai/v1/models');
      expect(request.method).toBe('GET');
      expect(models).toEqual([expect.objectContaining({ id: 'muse-spark-future' })]);
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
