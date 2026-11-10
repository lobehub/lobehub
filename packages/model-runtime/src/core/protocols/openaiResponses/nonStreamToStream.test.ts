// @vitest-environment node
import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { transformResponseAPIToStream } from './nonStreamToStream';

const createInputOnlyUsage = () => ({
  total_tokens: 5,
  input_tokens: 5,
  output_tokens: 0,
  input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
  output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
});

describe('nonStreamToStream', () => {
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
        usage: createInputOnlyUsage(),
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

    it('should preserve function calls in a non-streaming response', async () => {
      const functionCall = {
        arguments: '{"description":"Check menus"}',
        call_id: 'call_001',
        id: 'fc_001',
        name: 'lobe-agent____callSubAgent',
        status: 'completed',
        type: 'function_call',
      };
      const mockResponse = {
        id: 'resp_tool_only',
        output: [{ id: 'rs_001', summary: [], type: 'reasoning' }, functionCall],
        status: 'completed',
      } as unknown as OpenAI.Responses.Response;

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
          item: functionCall,
          output_index: 1,
          sequence_number: 1,
          type: 'response.output_item.added',
        },
        {
          response: mockResponse,
          sequence_number: 999,
          type: 'response.completed',
        },
      ]);
    });

    it('should preserve encrypted reasoning in a non-streaming response', async () => {
      const reasoning = {
        encrypted_content: 'encrypted-signature',
        id: 'reasoning_001',
        summary: [],
        type: 'reasoning',
      };
      const mockResponse = {
        created_at: 1677652288,
        id: 'resp_reasoning',
        model: 'gpt-5.6-sol',
        object: 'response',
        output: [reasoning],
        status: 'completed',
      } as unknown as OpenAI.Responses.Response;

      const stream = transformResponseAPIToStream(mockResponse);
      const events = [];
      const reader = stream.getReader();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        events.push(value);
      }

      expect(events).toEqual([
        {
          item: reasoning,
          output_index: 0,
          sequence_number: 0,
          type: 'response.output_item.done',
        },
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
        usage: createInputOnlyUsage(),
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
        usage: createInputOnlyUsage(),
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
        usage: createInputOnlyUsage(),
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
