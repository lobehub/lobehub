// @vitest-environment node
import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { transformResponseAPIToStream, transformResponseToStream } from './nonStreamToStream';

describe('nonStreamToStream', () => {
  describe('transformResponseToStream', () => {
    it('should transform ChatCompletion to stream events correctly', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-3.5-turbo',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you today?',
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 7,
          total_tokens: 20,
        },
      };

      const stream = transformResponseToStream(mockResponse);
      const reader = stream.getReader();
      const chunks: OpenAI.ChatCompletionChunk[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toEqual([
        // First chunk: content chunk
        {
          choices: [
            {
              delta: {
                content: 'Hello! How can I help you today?',
                role: 'assistant',
                tool_calls: undefined,
              },
              finish_reason: null,
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-123',
          model: 'gpt-3.5-turbo',
          object: 'chat.completion.chunk',
        },
        // Second chunk: usage chunk
        {
          choices: [],
          created: 1677652288,
          id: 'chatcmpl-123',
          model: 'gpt-3.5-turbo',
          object: 'chat.completion.chunk',
          usage: {
            prompt_tokens: 13,
            completion_tokens: 7,
            total_tokens: 20,
          },
        },
        // Third chunk: finish chunk
        {
          choices: [
            {
              delta: {
                content: null,
                role: 'assistant',
              },
              finish_reason: 'stop',
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-123',
          model: 'gpt-3.5-turbo',
          object: 'chat.completion.chunk',
          system_fingerprint: undefined,
        },
      ]);
    });

    it('should transform ChatCompletion with reasoning_content to stream events correctly', async () => {
      const mockResponse: unknown = {
        id: 'chatcmpl-reasoning-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'The answer is 42.',
              reasoning_content: 'Let me think about this step by step...',
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 7,
          total_tokens: 20,
        },
      };

      const stream = transformResponseToStream(mockResponse as OpenAI.ChatCompletion);
      const reader = stream.getReader();
      const chunks: OpenAI.ChatCompletionChunk[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toEqual([
        // First chunk: reasoning chunk
        {
          choices: [
            {
              delta: {
                content: null,
                reasoning_content: 'Let me think about this step by step...',
                role: 'assistant',
              },
              finish_reason: null,
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-reasoning-123',
          model: 'deepseek-reasoner',
          object: 'chat.completion.chunk',
        },
        // Second chunk: content chunk
        {
          choices: [
            {
              delta: {
                content: 'The answer is 42.',
                role: 'assistant',
                tool_calls: undefined,
              },
              finish_reason: null,
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-reasoning-123',
          model: 'deepseek-reasoner',
          object: 'chat.completion.chunk',
        },
        // Third chunk: usage chunk
        {
          choices: [],
          created: 1677652288,
          id: 'chatcmpl-reasoning-123',
          model: 'deepseek-reasoner',
          object: 'chat.completion.chunk',
          usage: {
            prompt_tokens: 13,
            completion_tokens: 7,
            total_tokens: 20,
          },
        },
        // Fourth chunk: finish chunk
        {
          choices: [
            {
              delta: {
                content: null,
                role: 'assistant',
              },
              finish_reason: 'stop',
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-reasoning-123',
          model: 'deepseek-reasoner',
          object: 'chat.completion.chunk',
          system_fingerprint: undefined,
        },
      ]);
    });

    it('should transform ChatCompletion with tool_calls to stream events correctly', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-tool-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'I need to check the weather for you.',
              refusal: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "New York"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 7,
          total_tokens: 20,
        },
      };

      const stream = transformResponseToStream(mockResponse);
      const reader = stream.getReader();
      const chunks: OpenAI.ChatCompletionChunk[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toEqual([
        // First chunk: content and tool_calls chunk
        {
          choices: [
            {
              delta: {
                content: 'I need to check the weather for you.',
                role: 'assistant',
                tool_calls: [
                  {
                    function: {
                      name: 'get_weather',
                      arguments: '{"location": "New York"}',
                    },
                    id: 'call_abc123',
                    index: 0,
                    type: 'function',
                  },
                ],
              },
              finish_reason: null,
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-tool-123',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
        },
        // Second chunk: usage chunk
        {
          choices: [],
          created: 1677652288,
          id: 'chatcmpl-tool-123',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          usage: {
            prompt_tokens: 13,
            completion_tokens: 7,
            total_tokens: 20,
          },
        },
        // Third chunk: finish chunk
        {
          choices: [
            {
              delta: {
                content: null,
                role: 'assistant',
              },
              finish_reason: 'tool_calls',
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-tool-123',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          system_fingerprint: undefined,
        },
      ]);
    });

    it('should handle empty choices array', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-empty-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-3.5-turbo',
        choices: [],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 0,
          total_tokens: 13,
        },
      };

      const stream = transformResponseToStream(mockResponse);
      const reader = stream.getReader();
      const chunks: OpenAI.ChatCompletionChunk[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toHaveLength(3);

      // Verify all chunks have empty choices array structure
      expect(chunks[0].choices).toEqual([]);
      expect(chunks[1]).toEqual({
        choices: [],
        created: 1677652288,
        id: 'chatcmpl-empty-123',
        model: 'gpt-3.5-turbo',
        object: 'chat.completion.chunk',
        usage: {
          prompt_tokens: 13,
          completion_tokens: 0,
          total_tokens: 13,
        },
      });
      expect(chunks[2].choices).toEqual([]);
    });
  });

  describe('transformResponseAPIToStream', () => {
    it('should transform Response API with text output to stream events correctly', async () => {
      const mockResponse: OpenAI.Responses.Response = {
        id: 'resp_abc123',
        object: 'response',
        status: 'completed',
        status_details: null,
        output: [
          {
            id: 'msg_001',
            object: 'realtime.item',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Hello! How can I help you today?',
              } as any,
            ],
          },
        ],
        usage: {
          total_tokens: 20,
          input_tokens: 13,
          output_tokens: 7,
          input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
          output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
        },
        created: 1677652288,
        created_at: 1677652288,
        model: 'gpt-4o-realtime-preview',
      } as any;

      const stream = transformResponseAPIToStream(mockResponse);
      const reader = stream.getReader();
      const events: OpenAI.Responses.ResponseStreamEvent[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        events.push(value);
      }

      expect(events).toEqual([
        // First event: response.output_text.delta
        {
          delta: 'Hello! How can I help you today?',
          type: 'response.output_text.delta',
        },
        // Second event: response.completed
        {
          response: mockResponse,
          sequence_number: 999,
          type: 'response.completed',
        },
      ]);
    });

    it('should handle Response API without message output', async () => {
      const mockResponse: OpenAI.Responses.Response = {
        id: 'resp_no_message',
        object: 'response',
        status: 'completed',
        status_details: null,
        output: [
          {
            id: 'audio_001',
            object: 'realtime.item',
            type: 'message' as any,
            status: 'completed',
            // Missing content property
          },
        ],
        usage: {
          total_tokens: 5,
          input_tokens: 5,
          output_tokens: 0,
          input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
          output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
        },
        created: 1677652288,
        created_at: 1677652288,
        model: 'gpt-4o-realtime-preview',
      } as any;

      const stream = transformResponseAPIToStream(mockResponse);
      const reader = stream.getReader();
      const events: OpenAI.Responses.ResponseStreamEvent[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        events.push(value);
      }

      // Should only produce response.completed event, no text deltas
      expect(events).toEqual([
        {
          response: mockResponse,
          sequence_number: 999,
          type: 'response.completed',
        },
      ]);
    });

    it('should handle Response API with message but no text content', async () => {
      const mockResponse: OpenAI.Responses.Response = {
        id: 'resp_no_text',
        object: 'response',
        status: 'completed',
        status_details: null,
        output: [
          {
            id: 'msg_no_text',
            object: 'realtime.item',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text' as any,
                audio: 'base64encodedaudio',
                // No text property
              },
            ],
          },
        ],
        usage: {
          total_tokens: 5,
          input_tokens: 5,
          output_tokens: 0,
          input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
          output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
        },
        created: 1677652288,
        created_at: 1677652288,
        model: 'gpt-4o-realtime-preview',
      } as any;

      const stream = transformResponseAPIToStream(mockResponse);
      const reader = stream.getReader();
      const events: OpenAI.Responses.ResponseStreamEvent[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        events.push(value);
      }

      // Should only produce response.completed event because message has no text content
      expect(events).toEqual([
        {
          response: mockResponse,
          sequence_number: 999,
          type: 'response.completed',
        },
      ]);
    });

    it('should handle Response API with message id missing', async () => {
      const mockResponse: OpenAI.Responses.Response = {
        id: 'resp_missing_id',
        object: 'response',
        status: 'completed',
        status_details: null,
        output: [
          {
            // id is missing
            object: 'realtime.item',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Response without message ID',
              } as any,
            ],
          },
        ],
        usage: {
          total_tokens: 15,
          input_tokens: 10,
          output_tokens: 5,
          input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
          output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
        },
        created: 1677652288,
        created_at: 1677652288,
        model: 'gpt-4o-realtime-preview',
      } as any;

      const stream = transformResponseAPIToStream(mockResponse);
      const reader = stream.getReader();
      const events: OpenAI.Responses.ResponseStreamEvent[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        events.push(value);
      }

      expect(events).toEqual([
        {
          delta: 'Response without message ID',
          type: 'response.output_text.delta',
        },
        {
          response: mockResponse,
          sequence_number: 999,
          type: 'response.completed',
        },
      ]);
    });

    it('should handle empty output array', async () => {
      const mockResponse: OpenAI.Responses.Response = {
        id: 'resp_empty_output',
        object: 'response',
        status: 'completed',
        status_details: null,
        output: [],
        usage: {
          total_tokens: 5,
          input_tokens: 5,
          output_tokens: 0,
          input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
          output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
        },
        created: 1677652288,
        created_at: 1677652288,
        model: 'gpt-4o-realtime-preview',
      } as any;

      const stream = transformResponseAPIToStream(mockResponse);
      const reader = stream.getReader();
      const events: OpenAI.Responses.ResponseStreamEvent[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        events.push(value);
      }

      // Should only produce response.completed event even with empty output
      expect(events).toEqual([
        {
          response: mockResponse,
          sequence_number: 999,
          type: 'response.completed',
        },
      ]);
    });

    it('should handle missing output field', async () => {
      const mockResponse: Partial<OpenAI.Responses.Response> = {
        id: 'resp_no_output',
        object: 'response',
        status: 'completed',
        status_details: null,
        // output field is missing
        usage: {
          total_tokens: 5,
          input_tokens: 5,
          output_tokens: 0,
          input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
          output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
        },
        created: 1677652288,
        created_at: 1677652288,
        model: 'gpt-4o-realtime-preview',
      } as any;

      const stream = transformResponseAPIToStream(mockResponse as OpenAI.Responses.Response);
      const reader = stream.getReader();
      const events: OpenAI.Responses.ResponseStreamEvent[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        events.push(value);
      }

      // Should only produce response.completed event since output is missing
      expect(events).toEqual([
        {
          response: mockResponse,
          sequence_number: 999,
          type: 'response.completed',
        },
      ]);
    });
  });
});
